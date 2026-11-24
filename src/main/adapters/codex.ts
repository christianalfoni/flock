// Codex, headless: `codex exec --json`, one process per turn, the first
// starting a thread and each next one resuming it (`exec … resume <id>`).
// Messages that come while a turn runs wait, and go together as the next
// turn. Events, one JSON object a line:
//
//   {"type":"thread.started","thread_id":…}
//   {"type":"item.started"|"item.completed","item":{"type":"agent_message"|"command_execution"|"mcp_tool_call"|…}}
//   {"type":"turn.completed"} | {"type":"turn.failed","error":{"message":…}}
//
// The app's MCP server is given with -c overrides, its tools approved ahead
// (Codex's own approval prompts cannot reach the app from exec), and the
// role's guide as developer_instructions. Codex has no way to ask from
// exec: permission "ask" runs as "edits" (its workspace-write sandbox).
import { spawn, type ChildProcess } from "node:child_process";
import type { CliStatus } from "../../shared/types";
import { lines, run } from "./shell";
import { MCP_NAME, type Adapter, type CliSession, type StartOptions } from "./types";

const TOKEN_ENV = "FLOCK_MCP_TOKEN";

export function codexArgs(options: StartOptions, thread: string | undefined): string[] {
  const toml = (value: string) => JSON.stringify(value);
  const args = [
    "exec", "--json", "--skip-git-repo-check",
    "-c", `developer_instructions=${toml(options.instructions)}`,
    "-c", `mcp_servers.${MCP_NAME}.url=${toml(options.mcp.url)}`,
    "-c", `mcp_servers.${MCP_NAME}.bearer_token_env_var=${toml(TOKEN_ENV)}`,
    "-c", `mcp_servers.${MCP_NAME}.default_tools_approval_mode="approve"`,
  ];
  if (options.permission === "all") args.push("--dangerously-bypass-approvals-and-sandbox");
  else {
    args.push("-s", options.readOnly ? "read-only" : "workspace-write", "-c", `approval_policy="never"`);
    for (const dir of options.writableDirs ?? []) args.push("--add-dir", dir);
  }
  if (options.model) args.push("-m", options.model);
  if (thread) args.push("resume", thread);
  // The prompt comes on stdin.
  args.push("-");
  return args;
}

function itemTool(item: Record<string, any>): { name: string; summary?: string } | undefined {
  switch (item.type) {
    case "command_execution": return { name: "Shell", summary: String(item.command ?? "").slice(0, 200) };
    case "mcp_tool_call": return { name: item.server === MCP_NAME ? String(item.tool) : `${item.server}.${item.tool}` };
    case "file_change": return { name: "Edit", summary: (item.changes ?? []).map((change: { path?: string }) => change.path).filter(Boolean).join(", ").slice(0, 200) };
    case "web_search": return { name: "WebSearch", summary: item.query };
    default: return undefined;
  }
}

export const codex: Adapter = {
  id: "codex",
  name: "Codex",

  async detect(): Promise<CliStatus> {
    const version = await run("codex", ["--version"]);
    if (version.code !== 0) return { id: "codex", name: "Codex", installed: false, loggedIn: false };
    const login = await run("codex", ["login", "status"]);
    const loggedIn = login.code === 0 && /logged in/i.test(login.stdout + login.stderr);
    // Codex's own catalog: the models it lists for people to pick.
    const models = [{ id: "", label: "Default", detail: "What Codex is set to use" }];
    const catalog = await run("codex", ["debug", "models"], { timeout: 20_000 });
    try {
      const listed = (JSON.parse(catalog.stdout) as { models?: Array<{ slug: string; display_name?: string; description?: string; visibility?: string }> }).models ?? [];
      for (const model of listed) if (model.visibility === "list") models.push({ id: model.slug, label: model.display_name ?? model.slug, detail: model.description ?? "" });
    } catch { /* only the default */ }
    return { id: "codex", name: "Codex", installed: true, loggedIn, version: version.stdout.trim().split(" ").pop(), models, ...(loggedIn ? {} : { note: "Run `codex login` in a terminal." }) };
  },

  start(options, on): CliSession {
    let thread = options.resume;
    let child: ChildProcess | undefined;
    let queue: string[] = [];
    let stopped = false;
    if (thread) on({ type: "session", id: thread });

    const turn = (prompt: string) => {
      on({ type: "turn-start" });
      const started = new Set<string>();
      let failure: string | undefined;
      let ended = false;
      let stderr = "";
      const proc = spawn("codex", codexArgs(options, thread), { cwd: options.cwd, env: { ...process.env, [TOKEN_ENV]: options.mcp.token }, stdio: ["pipe", "pipe", "pipe"] });
      child = proc;
      proc.stdin.end(prompt);
      proc.stdout.on("data", lines((line) => {
        let event: Record<string, any>;
        try { event = JSON.parse(line); } catch { return; }
        if (event.type === "thread.started" && event.thread_id) {
          thread = String(event.thread_id);
          on({ type: "session", id: thread });
        } else if (event.type === "item.started" || event.type === "item.completed") {
          const item = event.item ?? {};
          if (item.type === "agent_message" && event.type === "item.completed" && item.text?.trim()) on({ type: "text", text: item.text });
          else if (item.type === "error") on({ type: "tool-error", message: String(item.message ?? "") });
          else {
            const tool = itemTool(item);
            if (tool && !started.has(item.id)) {
              started.add(item.id);
              on({ type: "tool", ...tool });
            }
            if (event.type === "item.completed" && (item.status === "failed" || item.error)) on({ type: "tool-error", name: tool?.name, message: String(item.error?.message ?? item.aggregated_output ?? "failed").slice(0, 500) });
          }
        } else if (event.type === "turn.completed") {
          ended = true;
        } else if (event.type === "turn.failed") {
          ended = true;
          failure = String(event.error?.message ?? "The turn failed.");
        } else if (event.type === "error") {
          failure = String(event.message ?? "Codex reported an error.");
        }
      }));
      proc.stderr.on("data", (chunk) => { stderr = (stderr + chunk.toString()).slice(-4000); });
      proc.on("error", (error) => { failure = error.message; });
      proc.on("close", (code) => {
        child = undefined;
        if (stopped) {
          on({ type: "exit", code });
          return;
        }
        if (!ended && !failure && code) failure = stderr.trim().split("\n").filter((text) => !text.startsWith("Reading additional input")).slice(-3).join("\n") || `codex exited with ${code}`;
        on({ type: "turn-end", ...(failure ? { error: failure } : {}) });
        next();
      });
    };

    const next = () => {
      if (stopped || child || !queue.length) return;
      const prompt = queue.join("\n\n");
      queue = [];
      turn(prompt);
    };

    return {
      send(text) {
        if (stopped) return;
        queue.push(text);
        next();
      },
      stop() {
        stopped = true;
        queue = [];
        if (child) child.kill();
        else on({ type: "exit", code: 0 });
      },
    };
  },
};
