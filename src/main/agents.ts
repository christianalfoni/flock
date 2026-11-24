// Orchestrators, their workers, and the CLI session under each.
//
// An orchestrator is one long session you talk to, in a repository. A
// worker is a git worktree with a session of its own, started by its
// orchestrator's start_worker. Sessions start when they are first needed
// (your first message, a worker's task) and resume from the CLI's own
// session id after a restart. What a session does is kept as a transcript
// (the Chat view); what its orchestrator should know (a report, a pull
// request changing) reaches it as a "[Flock]" message.
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Agent, AppState, CliId, CliStatus, PermissionMode, PermissionRequest, PullRequest, SessionState, Settings, TranscriptEntry, Worker } from "../shared/types";
import { drawnPullNumbers, pullsInScope } from "../shared/pullRequestCanvas";
import { ADAPTERS, detectClis, firstReady } from "./adapters";
import { summarize, type CliSession } from "./adapters/types";
import { addAsk, addDrawing, addPullDrawing, canvasText, readCanvas } from "./canvas";
import { createWorktree, removeWorktree, repositoryRoot, unsavedWork } from "./git";
import { pullRequestStatus } from "./github";
import { orchestratorGuide, workerGuide } from "./guides";
import { revokeTokens, setMcpDeps, tokenFor, type Caller } from "./mcp";

type Store = { agents: Agent[]; workers: Worker[]; settings: Settings; next: { O: number; W: number } };

let dataDir = "";
let store: Store = { agents: [], workers: [], settings: { permissions: { orchestrator: "ask", worker: "ask" } }, next: { O: 1, W: 1 } };
let clis: CliStatus[] = [];
let notify: (channel: string, payload?: unknown) => void = () => undefined;

const sessions = new Map<string, { cli: CliSession; id: string }>();
const states = new Map<string, SessionState>();
const transcripts = new Map<string, TranscriptEntry[]>();
const permissions = new Map<string, { request: PermissionRequest; resolve(decision: { allow: boolean; message?: string }): void }>();

// ---------------------------------------------------------------- storage

const storeFile = () => join(dataDir, "flock.json");
let writes = 0;

async function writeAtomic(path: string, value: unknown) {
  const temporary = `${path}.${process.pid}.${writes++}.tmp`;
  await writeFile(temporary, JSON.stringify(value), { mode: 0o600 });
  await rename(temporary, path);
}

let saving: Promise<void> = Promise.resolve();
function save() {
  saving = saving.then(() => writeAtomic(storeFile(), store)).catch((error) => console.warn("[store]", error));
  emitState();
}

const transcriptFile = (id: string) => join(dataDir, "transcripts", `${id}.json`);
const transcriptTimers = new Map<string, ReturnType<typeof setTimeout>>();
const TRANSCRIPT_LIMIT = 600;

export async function transcriptOf(id: string): Promise<TranscriptEntry[]> {
  const known = transcripts.get(id);
  if (known) return known;
  let entries: TranscriptEntry[] = [];
  try { entries = JSON.parse(await readFile(transcriptFile(id), "utf8")) as TranscriptEntry[]; } catch { /* none yet */ }
  transcripts.set(id, entries);
  return entries;
}

// An entry as it is added: the id and time come here.
type NewEntry = TranscriptEntry extends infer Entry ? (Entry extends TranscriptEntry ? Omit<Entry, "id" | "at"> : never) : never;

async function append(id: string, entry: NewEntry) {
  const entries = await transcriptOf(id);
  const full = { id: randomUUID(), at: Date.now(), ...entry } as TranscriptEntry;
  entries.push(full);
  if (entries.length > TRANSCRIPT_LIMIT) entries.splice(0, entries.length - TRANSCRIPT_LIMIT);
  notify("session:entry", { id, entry: full });
  clearTimeout(transcriptTimers.get(id));
  transcriptTimers.set(id, setTimeout(() => {
    void mkdir(join(dataDir, "transcripts"), { recursive: true }).then(() => writeAtomic(transcriptFile(id), entries)).catch((error) => console.warn("[transcript]", error));
  }, 500));
}

let stateTimer: ReturnType<typeof setTimeout> | undefined;
function emitState() {
  clearTimeout(stateTimer);
  stateTimer = setTimeout(() => notify("app:state", appState()), 30);
}

export function appState(): AppState {
  return {
    agents: store.agents,
    workers: store.workers,
    sessions: Object.fromEntries(states),
    permissions: [...permissions.values()].map((item) => item.request),
    settings: store.settings,
    clis,
  };
}

function setSession(id: string, next: Partial<SessionState>) {
  const was = states.get(id) ?? { id, status: "stopped" as const };
  states.set(id, { ...was, ...next, id });
  emitState();
}

// ---------------------------------------------------------------- lookups

const agentOf = (id: string) => {
  const agent = store.agents.find((item) => item.id === id);
  if (!agent) throw new Error(`There is no agent ${id}.`);
  return agent;
};
const workerOf = (id: string) => {
  const worker = store.workers.find((item) => item.id === id);
  if (!worker) throw new Error(`There is no worker ${id}.`);
  return worker;
};
const ownWorker = (caller: Caller, id: string) => {
  const worker = store.workers.find((item) => item.id === id && item.orchestrator === caller.id);
  if (!worker) throw new Error(`You have no worker ${id}. Call workers to see yours.`);
  return worker;
};
const working = (id: string) => states.get(id)?.status === "working";

// ---------------------------------------------------------------- sessions

function permissionFor(role: "orchestrator" | "worker"): PermissionMode {
  return store.settings.permissions[role];
}

// Starts the session for an agent or a worker, unless it runs already.
function ensureSession(id: string): CliSession {
  const running = sessions.get(id);
  if (running) return running.cli;
  const isWorker = id.startsWith("W");
  const worker = isWorker ? workerOf(id) : undefined;
  const agent = agentOf(worker ? worker.orchestrator : id);
  const role = isWorker ? "worker" : "orchestrator";
  const adapter = ADAPTERS[worker?.cli ?? agent.cli];
  const record = worker ?? agent;
  const token = tokenFor({ role, id });
  const turn: { reported: boolean; startedAt?: number } = { reported: false };
  turnState.set(id, turn);
  setSession(id, { status: "starting", error: undefined, activity: undefined });
  let lastText = "";
  const cli = adapter.start({
    cwd: worker ? worker.worktree : agent.repo,
    instructions: worker ? workerGuide(worker, agent) : orchestratorGuide(agent),
    mcp: token,
    permission: permissionFor(role),
    readOnly: !isWorker,
    ...(worker ? { writableDirs: [gitDirs.get(worker.id) ?? join(agent.repo, ".git")] } : {}),
    ...(record.sessionId ? { resume: record.sessionId } : {}),
  }, (event) => {
    switch (event.type) {
      case "session":
        if (record.sessionId !== event.id) {
          record.sessionId = event.id;
          save();
        }
        break;
      case "turn-start":
        turn.reported = false;
        turn.startedAt = Date.now();
        lastText = "";
        setSession(id, { status: "working", activity: { label: "Working…" }, error: undefined });
        break;
      case "text":
        lastText = event.text;
        void append(id, { kind: "assistant", text: event.text });
        setSession(id, { activity: { label: "Writing…" } });
        break;
      case "tool":
        void append(id, { kind: "tool", name: event.name, ...(event.summary ? { summary: event.summary } : {}) });
        setSession(id, { activity: { label: event.name, ...(event.summary ? { tool: event.summary } : {}) } });
        break;
      case "tool-error":
        void append(id, { kind: "tool", name: event.name ?? "Tool", summary: event.message, error: true });
        break;
      case "turn-end":
        setSession(id, { status: "idle", activity: undefined, ...(event.error ? { error: event.error } : {}) });
        if (event.error) void append(id, { kind: "notice", text: event.error, tone: "warn" });
        void append(id, { kind: "turn", ...(turn.startedAt ? { durationMs: Date.now() - turn.startedAt } : {}), ...(event.error ? { error: true } : {}) });
        // A worker that stops without saying where it is: its orchestrator
        // hears that, with its last words.
        if (worker && !turn.reported && store.workers.includes(worker)) {
          news(worker.orchestrator, `${worker.id} stopped without a report${event.error ? ` (${event.error})` : ""}.${lastText ? ` Its last words: ${lastText.slice(0, 600)}` : ""}`);
        }
        break;
      case "exit":
        if (sessions.get(id)?.cli === cli) sessions.delete(id);
        setSession(id, { status: event.error ? "error" : "stopped", activity: undefined, ...(event.error ? { error: event.error } : {}) });
        if (event.error) void append(id, { kind: "notice", text: `The session ended: ${event.error}`, tone: "warn" });
        break;
    }
  });
  sessions.set(id, { cli, id });
  return cli;
}

// Whether a session reported in its current turn.
const turnState = new Map<string, { reported: boolean; startedAt?: number }>();
// Each worker's repository git folder, which its sandbox may write to.
const gitDirs = new Map<string, string>();

// A message into a session: from you, its orchestrator, or the app.
export async function sendTo(id: string, text: string, from?: string) {
  const cli = ensureSession(id);
  await append(id, { kind: "user", text, ...(from ? { from } : {}) });
  cli.send(text);
}

export function stopSession(id: string) {
  const running = sessions.get(id);
  sessions.delete(id);
  running?.cli.stop();
  setSession(id, { status: "stopped", activity: undefined });
}

// Stops a session; the next message starts it again, resuming.
export function restartSession(id: string) {
  stopSession(id);
}

// ---------------------------------------------------------------- news

// News for an orchestrator, gathered for a moment so a burst is one turn.
const pendingNews = new Map<string, { items: string[]; timer: ReturnType<typeof setTimeout> }>();
function news(orchestrator: string, item: string) {
  if (!store.agents.some((agent) => agent.id === orchestrator)) return;
  const pending = pendingNews.get(orchestrator) ?? { items: [], timer: setTimeout(() => flushNews(orchestrator), 1500) };
  pending.items.push(item);
  pendingNews.set(orchestrator, pending);
}

function flushNews(orchestrator: string) {
  const pending = pendingNews.get(orchestrator);
  pendingNews.delete(orchestrator);
  if (!pending?.items.length) return;
  const agent = store.agents.find((item) => item.id === orchestrator);
  if (!agent) return;
  const missing = missingPulls(agent.id, latestSources.get(agent.id));
  const canvas = missing.length
    ? `Draw ${missing.map((pull) => `#${pull.number}`).join(", ")} into your canvas now: every open or draft pull request of your workers is a box labelled with its number (pr${missing[0]!.number}: box "#${missing[0]!.number}").`
    : "If this changes the picture, redraw your canvas with draw (play_from at what is new for them).";
  const text = `[Flock] News from your workers:\n\n${pending.items.map((item) => `- ${item.replace(/\n/g, "\n  ")}`).join("\n")}\n\n${canvas} Then end your turn; the next news wakes you.`;
  void sendTo(orchestrator, text, "Flock").catch((error) => console.warn(`[news] ${orchestrator}`, error));
}

// ---------------------------------------------------------------- canvas rules

// Each orchestrator's newest drawing, for what news reminds it of.
const latestSources = new Map<string, string>();

function pullsOnCanvas(orchestrator: string) {
  return pullsInScope(store.workers.filter((worker) => worker.orchestrator === orchestrator).flatMap((worker) => worker.pullRequests.map((pull) => ({ ...pull, worker: worker.id }))));
}

function missingPulls(orchestrator: string, source: string | undefined) {
  const drawn = source === undefined ? new Set<number>() : drawnPullNumbers(source);
  return pullsOnCanvas(orchestrator).filter((pull) => !drawn.has(pull.number));
}

// ---------------------------------------------------------------- pull requests

function addPull(worker: Worker, url: string): boolean {
  if (worker.pullRequests.some((pull) => pull.url === url)) return false;
  worker.pullRequests.push({ url, number: Number(url.split("/").pop()) });
  void refreshPull(worker, url);
  return true;
}

const standing = (pull: PullRequest) => `${pull.state ?? "state not known yet"}${pull.ciState && pull.ciState !== "unknown" ? `, CI ${pull.ciState}` : ""}`;

async function refreshPull(worker: Worker, url: string) {
  const status = await pullRequestStatus(url);
  if (!status) return;
  const pull = worker.pullRequests.find((item) => item.url === url);
  if (!pull) return;
  const was = { state: pull.state, ciState: pull.ciState };
  Object.assign(pull, status);
  if (was.state === pull.state && was.ciState === pull.ciState) return;
  save();
  // The first look is not news; a change after it is.
  if (was.state !== undefined) news(worker.orchestrator, `#${pull.number} (${worker.id}) is now ${standing(pull)}.`);
}

// Every open pull request of every worker, now and then each minute. A
// change since the last look (one made while the app was closed too) is
// news for its orchestrator; the canvas's badges follow the same facts.
const POLL_MS = 60_000;
let polling: ReturnType<typeof setInterval> | undefined;
function pollPullRequests() {
  for (const worker of store.workers) {
    for (const pull of worker.pullRequests) if (pull.state !== "merged" && pull.state !== "closed") void refreshPull(worker, pull.url);
  }
}
function followPullRequests() {
  if (polling) return;
  pollPullRequests();
  polling = setInterval(pollPullRequests, POLL_MS);
}

// ---------------------------------------------------------------- the tools

function describeWorker(worker: Worker): string {
  const state = states.get(worker.id)?.status ?? "stopped";
  const report = worker.lastReport ? `last report (${new Date(worker.lastReport.at).toLocaleTimeString()}): ${worker.lastReport.text}` : "no report yet";
  const pulls = worker.pullRequests.length ? worker.pullRequests.map((pull) => `#${pull.number} ${standing(pull)} ${pull.url}`).join("; ") : "no pull requests";
  return `${worker.id} "${worker.title}" (${worker.cli}, ${state === "working" ? "working now" : state}), branch ${worker.branch}, worktree ${worker.worktree}\n  ${report}\n  ${pulls}`;
}

async function startWorker(orchestrator: string, input: { title: string; task: string; cli?: string }): Promise<Worker> {
  const agent = agentOf(orchestrator);
  const cli = (input.cli === "claude" || input.cli === "codex" ? input.cli : agent.cli) as CliId;
  if (!clis.find((item) => item.id === cli)?.installed) throw new Error(`${cli} is not installed on this machine.`);
  const id = `W${store.next.W++}`;
  save();
  const made = await createWorktree(agent.repo, join(dataDir, "worktrees"), id, input.title);
  gitDirs.set(id, made.gitDir);
  const worker: Worker = { id, orchestrator, title: input.title, task: input.task, cli, branch: made.branch, worktree: made.worktree, base: made.base, pullRequests: [], createdAt: Date.now() };
  store.workers.push(worker);
  save();
  await sendTo(id, `[${orchestrator}] Your task: ${input.title}\n\n${input.task}`, orchestrator);
  return worker;
}

export async function removeWorker(id: string, force: boolean): Promise<{ removed: boolean; message: string; unsaved?: { uncommitted: number; unpushed: number } }> {
  const worker = workerOf(id);
  const agent = agentOf(worker.orchestrator);
  const unsaved = await unsavedWork(worker.worktree, worker.base);
  if ((unsaved.uncommitted || unsaved.unpushed) && !force) {
    const what = [unsaved.uncommitted ? `${unsaved.uncommitted} uncommitted change${unsaved.uncommitted === 1 ? "" : "s"}` : "", unsaved.unpushed ? `${unsaved.unpushed} commit${unsaved.unpushed === 1 ? "" : "s"} not pushed anywhere` : ""].filter(Boolean).join(" and ");
    return { removed: false, unsaved, message: `${id} has ${what} in ${worker.worktree}. Not removed.` };
  }
  stopSession(id);
  revokeTokens(id);
  const { keptBranch } = await removeWorktree(agent.repo, worker.worktree, worker.branch, worker.base);
  store.workers = store.workers.filter((item) => item !== worker);
  states.delete(id);
  transcripts.delete(id);
  await rm(transcriptFile(id), { force: true });
  save();
  return { removed: true, message: `Removed ${id} and its worktree.${keptBranch ? ` Its branch ${worker.branch} is kept.` : ""}` };
}

setMcpDeps({
  async draw(caller, input) {
    if (caller.role === "worker") {
      const worker = workerOf(caller.id);
      const url = input.pullRequest!;
      if (addPull(worker, url)) save();
      const version = await addPullDrawing(url, worker.id, input.source, input.playFrom, input.ask ? { ask: input.ask, summary: input.summary ?? "" } : undefined);
      const number = url.split("/").pop();
      if (input.ask) return `Answered ${input.ask} on #${number}. They hear your summary, then it resumes at step ${input.playFrom ?? "they asked on"} when they continue.`;
      return `Drawn: version ${version} of #${number}'s canvas. It shows inside #${number}'s box on your orchestrator's canvas.`;
    }
    if (input.source !== undefined) {
      const missing = missingPulls(caller.id, input.source);
      if (missing.length) throw new Error(`Missing pull requests: ${missing.map((pull) => `#${pull.number} (${pull.worker})`).join(", ")}. Every open or draft pull request of your workers is on your canvas, as a box labelled with its number (pr${missing[0]!.number}: box "#${missing[0]!.number}"). Nothing was drawn; add them and draw again.`);
    }
    const version = await addDrawing(caller.id, input.source, input.playFrom, input.ask ? { ask: input.ask, summary: input.summary ?? "" } : undefined);
    if (input.source !== undefined) latestSources.set(caller.id, input.source);
    if (input.ask) return `Answered ${input.ask}${input.source ? ` with version ${version} of your canvas` : ""}. They hear your summary, then it resumes at step ${input.playFrom ?? "they asked on"} when they continue.`;
    return `Drawn: version ${version} of your canvas. Flock lays it out and shows it to them${input.playFrom ? `, opened at step ${input.playFrom}` : ""}.`;
  },
  getCanvas: async (caller) => canvasText(caller.id),
  async startWorker(caller, input) {
    const worker = await startWorker(caller.id, input);
    return `Started ${worker.id} (${worker.cli}) on branch ${worker.branch}, in ${worker.worktree}. It has its task; it reports when it has news.`;
  },
  async messageWorker(caller, input) {
    const worker = ownWorker(caller, input.worker);
    await sendTo(worker.id, `[${caller.id}] ${input.text}`, caller.id);
    return working(worker.id) ? `Sent to ${worker.id}; it is at work and reads it when its turn ends.` : `Sent to ${worker.id}.`;
  },
  async workers(caller) {
    const mine = store.workers.filter((worker) => worker.orchestrator === caller.id);
    return mine.length ? mine.map(describeWorker).join("\n\n") : "You have no workers.";
  },
  async removeWorker(caller, input) {
    ownWorker(caller, input.worker);
    const result = await removeWorker(input.worker, input.force);
    if (!result.removed) throw new Error(`${result.message} Ask the person you work for; with their yes, call again with force.`);
    return result.message;
  },
  async report(caller, input) {
    const worker = workerOf(caller.id);
    worker.lastReport = { text: input.text, at: Date.now() };
    for (const url of input.pullRequests) addPull(worker, url);
    save();
    const turn = turnState.get(worker.id);
    if (turn) turn.reported = true;
    news(worker.orchestrator, `${worker.id} reported: ${input.text}${input.pullRequests.length ? `\n  Pull requests: ${input.pullRequests.join(", ")}` : ""}`);
    void append(worker.orchestrator, { kind: "notice", text: `${worker.id} reported: ${input.text}` });
    return `Reported to ${worker.orchestrator}.`;
  },
  permission(caller, input) {
    return new Promise((resolve) => {
      const id = randomUUID();
      const summary = summarize(input.input);
      const request: PermissionRequest = { id, session: caller.id, tool: input.tool, input: input.input, summary: summary ?? JSON.stringify(input.input).slice(0, 300), at: Date.now() };
      // Unanswered for long, it is a no: the session should not hang forever.
      const timer = setTimeout(() => answerPermission(id, false, "No answer came in 30 minutes."), 30 * 60_000);
      permissions.set(id, { request, resolve: (decision) => { clearTimeout(timer); resolve(decision); } });
      setSession(caller.id, { activity: { label: "Waiting for your permission", tool: `${input.tool}: ${request.summary}` } });
      emitState();
    });
  },
});

export function answerPermission(id: string, allow: boolean, message?: string) {
  const pending = permissions.get(id);
  if (!pending) return;
  permissions.delete(id);
  pending.resolve({ allow, ...(message ? { message } : {}) });
  void append(pending.request.session, { kind: "notice", text: `${allow ? "Allowed" : "Denied"}: ${pending.request.tool} ${pending.request.summary}` });
  emitState();
}

// ---------------------------------------------------------------- the window's actions

export async function createAgent(input: { name?: string; repo: string; cli?: CliId; color?: string; voice?: string }): Promise<Agent> {
  const repo = await repositoryRoot(input.repo);
  const cli = input.cli ?? store.settings.defaultCli ?? firstReady(clis);
  if (!cli) throw new Error("No coding CLI found. Install Claude Code or Codex, log in, and try again.");
  const id = `O${store.next.O++}`;
  const agent: Agent = { id, name: input.name?.trim() || repo.split("/").pop() || id, repo, cli, ...(input.color ? { color: input.color } : {}), ...(input.voice ? { voice: input.voice } : {}), createdAt: Date.now() };
  store.agents.push(agent);
  save();
  return agent;
}

export async function removeAgent(id: string) {
  const agent = agentOf(id);
  const left = store.workers.filter((worker) => worker.orchestrator === id);
  if (left.length) throw new Error(`${agent.name} still has workers (${left.map((worker) => worker.id).join(", ")}). Remove them first.`);
  stopSession(id);
  revokeTokens(id);
  store.agents = store.agents.filter((item) => item !== agent);
  states.delete(id);
  save();
}

// What you write: to an orchestrator (an ask, when on its canvas) or a
// worker. On a pull request's canvas it is an ask to that worker.
export async function sendMessage(input: { id: string; text: string; ask?: { step?: number; pull?: string } }) {
  const text = input.text.trim();
  if (!text) return;
  if (input.ask) {
    const on = input.ask.step ? `, on step ${input.ask.step}` : "";
    if (input.ask.pull) {
      const worker = store.workers.find((item) => item.pullRequests.some((pull) => pull.url === input.ask!.pull));
      if (!worker) throw new Error("No worker has that pull request.");
      const ask = await addAsk(input.ask.pull, text, input.ask.step);
      await sendTo(worker.id, `[Ask ${ask.id}${on} of #${input.ask.pull.split("/").pop()} (${input.ask.pull})] ${text}`, "you");
      return;
    }
    const ask = await addAsk(input.id, text, input.ask.step);
    await sendTo(input.id, `[Ask ${ask.id}${on}] ${text}`, "you");
    return;
  }
  await sendTo(input.id, text, "you");
}

export async function saveSettings(settings: Settings) {
  const changed = settings.permissions.orchestrator !== store.settings.permissions.orchestrator || settings.permissions.worker !== store.settings.permissions.worker;
  store.settings = settings;
  save();
  // Permissions are given at start: running sessions restart on their next message.
  if (changed) for (const id of [...sessions.keys()]) if (!working(id)) stopSession(id);
}

export async function refreshClis() {
  clis = await detectClis();
  emitState();
  return clis;
}

export async function startAgents(dir: string, broadcast: (channel: string, payload?: unknown) => void) {
  dataDir = dir;
  notify = broadcast;
  await mkdir(dataDir, { recursive: true });
  try {
    const loaded = JSON.parse(await readFile(storeFile(), "utf8")) as Partial<Store>;
    store = { ...store, ...loaded, settings: { ...store.settings, ...loaded.settings, permissions: { ...store.settings.permissions, ...loaded.settings?.permissions } } };
  } catch { /* a first start */ }
  for (const agent of store.agents) {
    const canvas = await readCanvas(agent.id);
    latestSources.set(agent.id, canvas.pending.at(-1)?.source ?? canvas.boardText ?? "");
  }
  await refreshClis();
  followPullRequests();
}

export function stopAll() {
  for (const id of [...sessions.keys()]) stopSession(id);
  for (const id of [...permissions.keys()]) answerPermission(id, false, "Flock is closing.");
}
