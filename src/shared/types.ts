// What the app keeps and the window shows: orchestrator agents, their
// workers, the CLI sessions under both, and the settings.

// A coding CLI the app can drive (main/adapters).
export type CliId = "claude" | "codex";

// Whether a CLI is on this machine and ready to use.
// models: what it can run, as its --model takes them (the first, "", is
// the CLI's own default).
export type CliStatus = { id: CliId; name: string; installed: boolean; loggedIn: boolean; version?: string; note?: string; models?: CliModel[] };
export type CliModel = { id: string; label: string; detail?: string };

// How a session runs: its CLI, model, and instructions of your own on top
// of Flock's.
export type SessionSetup = { cli: CliId; model?: string; instructions?: string };

// A kind of worker the orchestrator can start (start_worker's kind): what
// it is for, said to the orchestrator, and how it runs.
export type WorkerKind = SessionSetup & { id: string; name: string; description: string };

// What a session may do without asking you:
//   ask:   file edits are fine; anything else comes to you in the app.
//   edits: file edits are fine; anything else is refused.
//   all:   anything, no questions (Claude's bypassPermissions, Codex's full access).
export type PermissionMode = "ask" | "edits" | "all";

export type Settings = {
  // How every orchestrator runs, and the kinds of workers they can start.
  orchestrator: SessionSetup;
  workerKinds: WorkerKind[];
  permissions: { orchestrator: PermissionMode; worker: PermissionMode };
  // The voice new agents get, chosen when you tried it (TTMI's voice ids).
  voice?: string;
  // The first-run guide is done: the CLIs found, the voice tried.
  onboarded?: boolean;
};

export type PullRequestState = "open" | "draft" | "conflict" | "queued" | "merged" | "closed";
// none: the pull request has no checks at all (a repository without CI);
// unknown: not looked at yet.
export type PullRequestCiState = "pending" | "passing" | "failing" | "none" | "unknown";
export type PullRequest = { url: string; number: number; title?: string; state?: PullRequestState; ciState?: PullRequestCiState };

// An orchestrator: one long CLI session you talk to, in one repository.
export type Agent = {
  id: string; // O1
  name: string;
  repo: string; // the repository's folder
  cli: CliId;
  // Its avatar's colour (renderer/avatar.tsx); one from its id when not chosen.
  color?: string;
  voice?: string;
  sessionId?: string; // the CLI's own id, to resume it
  createdAt: number;
};

// A worker: a git worktree with its own CLI session, doing one task for
// its orchestrator.
export type Worker = {
  id: string; // W3
  orchestrator: string; // O1
  title: string;
  task: string;
  // The kind it was started as (Settings), and how it runs: fixed for it.
  kind?: string;
  cli: CliId;
  model?: string;
  branch: string;
  worktree: string;
  base: string; // the commit its branch started from
  sessionId?: string;
  lastReport?: { text: string; at: number };
  pullRequests: PullRequest[];
  createdAt: number;
};

// One line of a session's transcript, as the Chat view shows it.
export type TranscriptEntry =
  | { id: string; at: number; kind: "user"; text: string; from?: string }
  | { id: string; at: number; kind: "assistant"; text: string }
  | { id: string; at: number; kind: "tool"; name: string; summary?: string; error?: boolean }
  | { id: string; at: number; kind: "notice"; text: string; tone?: "warn" }
  // A turn ended: Flock's "Done" line, with how long it took.
  | { id: string; at: number; kind: "turn"; durationMs?: number; error?: boolean };

// Where a session stands: whether it is at work, and what it does now.
export type SessionState = {
  id: string; // the agent's or worker's id
  status: "starting" | "working" | "idle" | "stopped" | "error";
  activity?: { label: string; tool?: string };
  // The first line of what it last wrote, for the canvas's work rows.
  lastLine?: string;
  // When it last did anything (a tool, a line).
  activeAt?: number;
  error?: string;
};

// A tool call that waits for your yes or no (permission mode "ask").
export type PermissionRequest = { id: string; session: string; tool: string; input: unknown; summary: string; at: number };

// What the window gets in one go, and again on every change.
export type AppState = {
  agents: Agent[];
  workers: Worker[];
  sessions: Record<string, SessionState>;
  permissions: PermissionRequest[];
  settings: Settings;
  clis: CliStatus[];
};
