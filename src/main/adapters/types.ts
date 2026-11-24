// One interface over the coding CLIs (one module per CLI): start a session
// in a folder with a prompt's worth of instructions and the app's tools,
// send it messages, stream back what it does, stop it. The app never calls
// a model itself; the CLI does, with the user's own login.
import type { CliId, CliStatus, PermissionMode } from "../../shared/types";

export type StartOptions = {
  cwd: string;
  // The role's guide, through the CLI's system-prompt option.
  instructions: string;
  // The app's MCP server for this session: its address and its token.
  mcp: { url: string; token: string };
  permission: PermissionMode;
  // The orchestrator plans and does not edit files itself.
  readOnly?: boolean;
  // Folders the session may write to beside cwd (a worktree's git folder).
  writableDirs?: string[];
  // The CLI's own session id, to carry on a session from before.
  resume?: string;
};

// What a session does, as the adapter streams it.
export type SessionEvent =
  | { type: "session"; id: string } // the CLI's own id, to resume it later
  | { type: "turn-start" }
  | { type: "text"; text: string }
  | { type: "tool"; name: string; summary?: string }
  | { type: "tool-error"; name?: string; message: string }
  | { type: "turn-end"; error?: string }
  | { type: "exit"; code: number | null; error?: string };

export interface CliSession {
  // A message from you, the orchestrator, or the app. A session at work
  // takes it after its turn.
  send(text: string): void;
  stop(): void;
}

export interface Adapter {
  id: CliId;
  name: string;
  detect(): Promise<CliStatus>;
  start(options: StartOptions, on: (event: SessionEvent) => void): CliSession;
}

// The name of the app's MCP server in every CLI's config, and so the prefix
// of its tools ("mcp__flock__draw").
export const MCP_NAME = "flock";

// A tool call in a line, for the transcript and the working row.
export function summarize(input: unknown): string | undefined {
  if (!input || typeof input !== "object") return undefined;
  const value = input as Record<string, unknown>;
  for (const key of ["command", "file_path", "path", "pattern", "url", "query", "description", "title"]) {
    if (typeof value[key] === "string" && value[key]) return (value[key] as string).split("\n")[0]!.slice(0, 200);
  }
  return undefined;
}
