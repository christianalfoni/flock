// Claude Code, headless: one long-running `claude --print` process per
// session, with stream-json in and out. Messages are written to its stdin
// as they come (it queues those that arrive mid-turn); events are read from
// its stdout, one JSON object a line:
//
//   {"type":"system","subtype":"init","session_id":…}
//   {"type":"assistant","message":{"content":[{"type":"text"…}|{"type":"tool_use"…}]}}
//   {"type":"user","message":{"content":[{"type":"tool_result","is_error":…}]}}
//   {"type":"result","is_error":…,"queued_turn_count":…}   (a turn ended)
//
// The app's tools come from its MCP server alone (--strict-mcp-config), and
// in permission mode "ask" Claude asks the app's `permission` tool before a
// call that needs a yes (--permission-prompt-tool), which the app shows you.
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CliStatus } from "../../shared/types";
import { lines, run } from "./shell";
import { MCP_NAME, summarize, type Adapter, type CliSession, type SessionEvent, type StartOptions } from "./types";

const instructionsDir = mkdtempSync(join(tmpdir(), "flock-guides-"));

export function claudeArgs(options: StartOptions, sessionId: string, guideFile: string): string[] {
  const mcp = { mcpServers: { [MCP_NAME]: { type: "http", url: options.mcp.url, headers: { Authorization: `Bearer ${options.mcp.token}` } } } };
  const args = [
    "--print", "--verbose",
    "--input-format", "stream-json",
    "--output-format", "stream-json",
    "--mcp-config", JSON.stringify(mcp),
    "--strict-mcp-config",
    // The app's own tools never need a yes.
    "--allowedTools", `mcp__${MCP_NAME}`,
    "--append-system-prompt-file", guideFile,
    // The guide as it is now, on every start: by default a resumed session
    // replays the one it was first made with, and would not know of new
    // kinds of workers or instructions from Settings.
    "--system-prompt-snapshot", "off",
  ];
  if (options.model) args.push("--model", options.model);
  if (options.resume) args.push("--resume", options.resume);
  else args.push("--session-id", sessionId);
  if (options.permission === "all") args.push("--dangerously-skip-permissions");
  else if (options.permission === "ask") args.push("--permission-mode", "acceptEdits", "--permission-prompt-tool", `mcp__${MCP_NAME}__permission`);
  else args.push("--permission-mode", "acceptEdits", "--permission-prompts", "none");
  // Claude Code's own question dialog has no one to answer it here: what an
  // agent needs from you goes on its canvas (or to its orchestrator).
  args.push("--disallowedTools", options.readOnly ? "AskUserQuestion,Edit,Write,NotebookEdit" : "AskUserQuestion");
  for (const dir of options.writableDirs ?? []) args.push("--add-dir", dir);
  return args;
}

// The name a tool is shown by: the app's own without their prefix.
const toolName = (name: string) => name.replace(`mcp__${MCP_NAME}__`, "");

export const claude: Adapter = {
  id: "claude",
  name: "Claude Code",

  async detect(): Promise<CliStatus> {
    const version = await run("claude", ["--version"]);
    if (version.code !== 0) return { id: "claude", name: "Claude Code", installed: false, loggedIn: false };
    const auth = await run("claude", ["auth", "status"]);
    let loggedIn = false;
    try { loggedIn = Boolean((JSON.parse(auth.stdout) as { loggedIn?: boolean }).loggedIn); } catch { loggedIn = auth.code === 0; }
    // Claude Code takes these names for its latest models.
    const models = [
      { id: "", label: "Default", detail: "What Claude Code is set to use" },
      { id: "opus", label: "Opus", detail: "The most capable" },
      { id: "sonnet", label: "Sonnet", detail: "Fast and capable" },
      { id: "haiku", label: "Haiku", detail: "The fastest" },
    ];
    return { id: "claude", name: "Claude Code", installed: true, loggedIn, version: version.stdout.trim().split(" ")[0], models, ...(loggedIn ? {} : { note: "Run `claude` in a terminal and log in." }) };
  },

  start(options, on): CliSession {
    const sessionId = options.resume ?? randomUUID();
    const guideFile = join(instructionsDir, `${sessionId}.md`);
    writeFileSync(guideFile, options.instructions, { mode: 0o600 });
    // Not a session nested in the one that may have started the app.
    const env = { ...process.env };
    delete env.CLAUDECODE;
    delete env.CLAUDE_CODE_ENTRYPOINT;
    // A permission prompt is a tool call that waits for you (up to 30 minutes).
    env.MCP_TOOL_TIMEOUT = String(31 * 60_000);
    const child = spawn("claude", claudeArgs(options, sessionId, guideFile), { cwd: options.cwd, env, stdio: ["pipe", "pipe", "pipe"] });
    let stderr = "";
    let busy = false;
    let stopped = false;
    on({ type: "session", id: sessionId });

    child.stdout.on("data", lines((line) => {
      let event: Record<string, any>;
      try { event = JSON.parse(line); } catch { return; }
      if (event.type === "system" && event.subtype === "init" && typeof event.session_id === "string") {
        on({ type: "session", id: event.session_id });
      } else if (event.type === "assistant") {
        for (const part of event.message?.content ?? []) {
          if (part.type === "text" && part.text?.trim()) on({ type: "text", text: part.text });
          else if (part.type === "tool_use") on({ type: "tool", name: toolName(String(part.name)), summary: summarize(part.input) });
        }
      } else if (event.type === "user") {
        for (const part of event.message?.content ?? []) {
          if (part.type === "tool_result" && part.is_error) {
            const text = typeof part.content === "string" ? part.content : (part.content ?? []).map((item: { text?: string }) => item.text ?? "").join(" ");
            on({ type: "tool-error", message: text.slice(0, 500) });
          }
        }
      } else if (event.type === "result") {
        // Messages that came mid-turn are taken now, as more of the turn.
        if ((event.queued_turn_count ?? 0) > 0) return;
        busy = false;
        const failed = event.is_error || (typeof event.subtype === "string" && event.subtype.startsWith("error"));
        on({ type: "turn-end", ...(failed ? { error: String(event.result ?? event.subtype ?? "The turn failed.") } : {}) });
      }
    }));
    child.stderr.on("data", (chunk) => { stderr = (stderr + chunk.toString()).slice(-4000); });
    child.on("error", (error) => on({ type: "exit", code: null, error: error.message }));
    child.on("close", (code) => {
      if (busy && !stopped) on({ type: "turn-end", error: "The session ended mid-turn." });
      on({ type: "exit", code, ...(code && !stopped ? { error: stderr.trim().split("\n").slice(-3).join("\n") || `claude exited with ${code}` } : {}) });
    });

    return {
      send(text) {
        if (stopped || !child.stdin.writable) return;
        if (!busy) on({ type: "turn-start" });
        busy = true;
        child.stdin.write(`${JSON.stringify({ type: "user", message: { role: "user", content: text } })}\n`);
      },
      stop() {
        stopped = true;
        child.stdin.end();
        child.kill();
      },
    };
  },
};
