// Flock's window, laid out as Flock is: the header (the app's mark, the
// selected agent in the middle), the left bar of agents (their avatars; it
// opens while a new agent is made), the agent's page (its Canvas or Chat,
// and the message box under it), and its workers as cards on the right.
// Tool calls that need your yes show at the top right.
import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ArrowLeft, ArrowUp, AudioLines, Bot, ChevronDown, FolderGit2, Trash2, Users, PanelRight, Plus, RotateCcw, Settings as SettingsIcon, ShieldCheck, ShieldQuestion, TerminalSquare, X } from "lucide-react";
import { DEFAULT_VOICE, VOICES } from "ttmi-voices";
import type { Agent, AppState, CliId, CliStatus, PermissionMode, SessionSetup, SessionState, Settings, TranscriptEntry, Worker, WorkerKind } from "../shared/types";
import type { CanvasPullRequest } from "../shared/pullRequestCanvas";
import { canvasFocus, useCanvasFocus } from "./canvasStep";
import { AGENT_COLORS, AgentAvatar, agentColor } from "./avatar";
import { Onboarding, VoiceCheck } from "./onboarding";
import markUrl from "./mark.svg";
import "./style.css";

const CanvasSlot = React.lazy(() => import("./canvas").then((module) => ({ default: module.CanvasSlot })));

// The left bar's width, closed (icons only), and the workers panel's.
const SIDEBAR_WIDTH = 74;
const RIGHT_WIDTH = 400;

const remember = (key: string, value: string) => { try { localStorage.setItem(key, value); } catch { /* not kept */ } };
const recall = (key: string) => { try { return localStorage.getItem(key) ?? undefined; } catch { return undefined; } };
const errorMessage = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause)).replace(/^Error invoking remote method '[^']+': (Error: )?/, "");
const working = (session?: SessionState) => session?.status === "working" || session?.status === "starting";

// The one work row on the canvas: the orchestrator while it works, else
// the worker that did something last; how many others are at work too.
function liveRows(agent: Agent, workers: Worker[], state: AppState) {
  const asking = (id: string) => state.permissions.some((request) => request.session === id);
  const atWork = (id: string) => working(state.sessions[id]) || asking(id);
  const busyWorkers = workers.filter((item) => atWork(item.id)).sort((a, b) => (state.sessions[b.id]?.activeAt ?? 0) - (state.sessions[a.id]?.activeAt ?? 0));
  const lead = atWork(agent.id)
    ? { id: agent.id, name: agent.name, avatar: <AgentAvatar seed={agent.id} color={agentColor(agent)} size={22} working />, ...liveLine(state.sessions[agent.id], asking(agent.id)) }
    : busyWorkers[0] && { id: busyWorkers[0].id, name: busyWorkers[0].id, avatar: <AgentAvatar seed={busyWorkers[0].id} color={agentColor(agent)} size={22} working />, ...liveLine(state.sessions[busyWorkers[0].id], asking(busyWorkers[0].id)) };
  if (!lead) return [];
  const more = busyWorkers.filter((item) => item.id !== lead.id).length;
  return [{ ...lead, ...(more ? { more } : {}) }];
}

// The tools, as what the session is doing.
const TOOL_WORDS: Record<string, string> = {
  Read: "Reading", Edit: "Editing", Write: "Writing a file", MultiEdit: "Editing", NotebookEdit: "Editing a notebook",
  Bash: "Running", Shell: "Running", Grep: "Searching", Glob: "Looking for files", LS: "Looking around",
  WebFetch: "Reading the web", WebSearch: "Searching the web", ToolSearch: "Getting its tools", TodoWrite: "Planning", Task: "Asking a helper",
  draw: "Drawing the canvas", get_canvas: "Looking at the canvas", start_worker: "Starting a worker", message_worker: "Messaging a worker",
  workers: "Checking on its workers", remove_worker: "Removing a worker", report: "Reporting", permission: "Asking you",
};

// A session's latest line while it works: the tool it runs and on what,
// else the first line of what it last wrote, else that it is starting.
function liveLine(session: SessionState | undefined, asking: boolean): { line: string; detail?: string } {
  if (asking) return { line: "Waiting for your permission", ...(session?.activity?.tool ? { detail: session.activity.tool } : {}) };
  if (session?.status === "starting") return { line: "Starting…" };
  const label = session?.activity?.label;
  if (label && label !== "Writing…" && label !== "Working…") return { line: TOOL_WORDS[label] ?? label, ...(session?.activity?.tool ? { detail: session.activity.tool } : {}) };
  return { line: session?.lastLine || label || "Working…" };
}

function ChatMarkdown({ text }: { text: string }) {
  return (
    <div className="chat-markdown">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ a: ({ href, children }) => <a href={href} onClick={(event) => { event.preventDefault(); if (href) void window.dispatch.openExternal(href); }}>{children}</a> }}>{text}</ReactMarkdown>
    </div>
  );
}

function App() {
  const [state, setState] = useState<AppState>();
  const [selected, setSelected] = useState<string | undefined>(() => recall("flock.selected"));
  const [settings, setSettings] = useState(false);
  const [workersPanel, setWorkersPanel] = useState(() => recall("flock.workersPanel") === "true");
  const [unheard, setUnheard] = useState<Record<string, number>>({});
  // Each agent's view, Canvas or Chat, as you left it.
  const [views, setViews] = useState<Record<string, "canvas" | "chat">>({});
  useEffect(() => {
    void window.dispatch.getState().then(setState);
    return window.dispatch.onState(setState);
  }, []);
  useEffect(() => { if (selected) remember("flock.selected", selected); }, [selected]);
  useEffect(() => remember("flock.workersPanel", String(workersPanel)), [workersPanel]);
  // How many steps of each canvas you have not heard: a dot on its avatar.
  useEffect(() => {
    const load = () => void window.dispatch.canvasUnheard().then(setUnheard);
    load();
    return window.dispatch.onCanvasUpdated(load);
  }, []);
  // ⌘1 to ⌘9: the agents in the left bar, in order.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!event.metaKey || event.altKey || event.ctrlKey || !/^[1-9]$/.test(event.key)) return;
      const agent = state?.agents[Number(event.key) - 1];
      if (!agent) return;
      event.preventDefault();
      setSelected(agent.id);
      setSettings(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [state?.agents]);
  const windowBar = useWindowBar();
  if (!state) return <div className="app-loading" />;
  const worker = state.workers.find((item) => item.id === selected);
  const agent = state.agents.find((item) => item.id === (worker ? worker.orchestrator : selected)) ?? state.agents[0];
  // Its own view: Canvas or Chat, as you left it.
  const view = agent ? views[agent.id] ?? (recall(`flock.view.${agent.id}`) as "canvas" | "chat" | undefined) ?? "canvas" : "chat";
  const onCanvas = Boolean(agent && !worker && view === "canvas");
  // The first run, before any agent: the guide (onboarding.tsx).
  const onboarding = !state.settings.onboarded && !state.agents.length;
  const showWorkers = Boolean(agent && (!onCanvas || workersPanel));
  return (
    <main className={`h-screen overflow-hidden bg-[var(--bg)] text-[var(--fg)] ${onCanvas && !onboarding ? "app-canvas" : ""}`} style={{ "--sidebar": `${SIDEBAR_WIDTH}px`, "--page-right": `${showWorkers ? RIGHT_WIDTH : 0}px` } as React.CSSProperties}>
      {/* The window's title bar: dragging it moves the window, a double-click
          zooms it (windowBar). Over the canvas, which goes under it. */}
      <header className="app-header relative flex h-[60px] items-center px-4" {...windowBar}>
        {agent && (
          <div className="header-agent no-drag" title={`${agent.id} · ${agent.repo} · ${agent.cli}${worker ? `\n${worker.id}: ${worker.worktree}` : ""}`}>
            <AgentAvatar seed={agent.id} color={agentColor(agent)} size={28} working={working(state.sessions[agent.id])} />
            <span className="agent-bar-name">{agent.name}</span>
            {worker && <span className="source-badge source-badge-worker">{worker.id}</span>}
            {worker && <span className="agent-bar-meta">{worker.title}</span>}
          </div>
        )}
        <div className="no-drag header-actions">
          {agent && (
            <button type="button" className="icon-button" title="Restart its session (it resumes where it was)" onClick={() => void window.dispatch.restartSession(worker?.id ?? agent.id)}><RotateCcw size={15} /></button>
          )}
          <button type="button" className="icon-button" title="Settings" aria-pressed={settings} onClick={() => setSettings((open) => !open)}><SettingsIcon size={16} /></button>
        </div>
      </header>

      {!onboarding && <AgentsSidebar state={state} unheard={unheard} selectedId={agent?.id} onSelect={setSelected} />}

      <section className="content-area" style={{ right: onCanvas ? 0 : "var(--page-right)" }}>
        {onboarding ? (
          <Onboarding state={state} onDone={(next) => void window.dispatch.saveSettings(next)} />
        ) : !agent ? (
          <div className="grid h-full place-items-center">
            <div className="agents-welcome">
              <p className="agents-welcome-title">Create your first agent</p>
              <p>Give it a name and pick its git repository in the form on the left. You talk to it; it answers by drawing on its canvas, and starts workers, each in its own git worktree, to build.</p>
            </div>
          </div>
        ) : worker ? (
          <Conversation key={worker.id} id={worker.id} agent={agent} worker={worker} state={state} view="chat" onView={() => undefined} onBack={() => setSelected(agent.id)} />
        ) : (
          <Conversation key={agent.id} id={agent.id} agent={agent} state={state} view={view} onView={(next) => { remember(`flock.view.${agent.id}`, next); setViews((all) => ({ ...all, [agent.id]: next })); }} panel={{ open: workersPanel, toggle: () => setWorkersPanel((open) => !open) }} />
        )}
      </section>

      {showWorkers && agent && <WorkersPanel agent={agent} state={state} selected={worker?.id} onSelect={setSelected} onRemoved={() => setSelected(agent.id)} />}
      <Permissions state={state} />
      {settings && <SettingsModal state={state} onClose={() => setSettings(false)} />}
    </main>
  );
}

// The header as the window's title bar: a press on it (not on a button)
// drags the window, following the pointer even outside the window; a
// double-click zooms it, as macOS is set to.
function useWindowBar() {
  const drag = useRef<{ id: number; x: number; y: number; moved: boolean }>(undefined);
  const frame = useRef(0);
  const interactive = (target: EventTarget | null) => Boolean((target as Element | null)?.closest?.("button, a, input, select, textarea, [role='tab']"));
  return {
    onPointerDown(event: React.PointerEvent<HTMLElement>) {
      if (event.button !== 0 || interactive(event.target)) return;
      drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY, moved: false };
      event.currentTarget.setPointerCapture(event.pointerId);
      window.dispatch.startWindowDrag();
    },
    onPointerMove(event: React.PointerEvent<HTMLElement>) {
      const held = drag.current;
      if (!held || held.id !== event.pointerId) return;
      // A press is not a drag until the pointer has moved a little (a
      // double-click stays a double-click).
      if (!held.moved && Math.abs(event.clientX - held.x) + Math.abs(event.clientY - held.y) < 3) return;
      held.moved = true;
      cancelAnimationFrame(frame.current);
      frame.current = requestAnimationFrame(() => window.dispatch.moveWindow());
    },
    onPointerUp(event: React.PointerEvent<HTMLElement>) {
      if (drag.current?.id === event.pointerId) drag.current = undefined;
    },
    onDoubleClick(event: React.MouseEvent<HTMLElement>) {
      if (!interactive(event.target)) window.dispatch.zoomWindow();
    },
  };
}

// ---------------------------------------------------------------- the left bar

function AgentStatus({ agent, state }: { agent: Agent; state: AppState }) {
  const workers = state.workers.filter((worker) => worker.orchestrator === agent.id);
  const busy = workers.filter((worker) => working(state.sessions[worker.id])).length;
  const ci = workers.flatMap((worker) => worker.pullRequests).filter((pull) => pull.ciState === "pending" && pull.state !== "merged" && pull.state !== "closed").length;
  const asking = state.permissions.some((request) => request.session === agent.id || workers.some((worker) => worker.id === request.session));
  const parts: Array<{ text: string; tone: string }> = [];
  if (working(state.sessions[agent.id]) || busy) parts.push({ text: "Working", tone: "working" });
  if (ci) parts.push({ text: ci === 1 ? "CI running" : `CI running ×${ci}`, tone: "ci" });
  if (asking) parts.unshift({ text: "Needs you", tone: "you" });
  return (
    <span className="agent-meta agent-status">
      {parts[0] ? <span className={`agent-status-${parts[0].tone}`}>{parts[0].text}</span> : <span className="agent-status-idle">Idle</span>}
    </span>
  );
}

function AgentsSidebar({ state, unheard, selectedId, onSelect }: { state: AppState; unheard: Record<string, number>; selectedId?: string; onSelect(id: string): void }) {
  const [creating, setCreating] = useState(false);
  const [removing, setRemoving] = useState<string>();
  const [error, setError] = useState("");
  const ready = state.clis.filter((item) => item.installed);
  const [name, setName] = useState("");
  const [repo, setRepo] = useState<string>();
  const [color, setColor] = useState(AGENT_COLORS[0]!);
  const [voice, setVoice] = useState(state.settings.voice ?? DEFAULT_VOICE);
  const [busy, setBusy] = useState(false);
  // Every orchestrator runs as Settings say.
  const setup = state.settings.orchestrator;
  const setupCli = state.clis.find((item) => item.id === setup.cli);
  const chosenCli = setupCli?.installed ? setup.cli : undefined;
  // No agents yet: the form is open from the start.
  const open = creating || !state.agents.length;

  async function create() {
    if (!repo || !chosenCli) return;
    setBusy(true);
    setError("");
    try {
      const agent = await window.dispatch.createAgent({ repo, name, color, voice });
      setCreating(false);
      setName("");
      setRepo(undefined);
      onSelect(agent.id);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <aside className={`agents-sidebar ${open ? "agents-sidebar-open" : ""}`}>
      {/* The app's mark, at the top of its agents. */}
      <div className="sidebar-mark" title="Flock">
        <img src={markUrl} alt="Flock" />
        <span className="app-title">Flock</span>
      </div>
      <div className="agents-list">
        {state.agents.map((agent, index) => {
          const workers = state.workers.filter((worker) => worker.orchestrator === agent.id);
          const own = working(state.sessions[agent.id]);
          const others = workers.some((worker) => working(state.sessions[worker.id]));
          const ci = workers.some((worker) => worker.pullRequests.some((pull) => pull.ciState === "pending" && pull.state !== "merged" && pull.state !== "closed"));
          return (
            <div key={agent.id} className={`agent-row ${agent.id === selectedId ? "agent-row-active" : ""}`} onClick={() => onSelect(agent.id)} title={`${agent.name} (${agent.id})${index < 9 ? ` · ⌘${index + 1}` : ""}`}>
              <AgentAvatar seed={agent.id} color={agentColor(agent)} size={34} working={own} busy={own || others || ci} unheard={unheard[agent.id] ?? 0} />
              <div className="agent-row-main">
                <span className="agent-name">{agent.name}</span>
                <AgentStatus agent={agent} state={state} />
              </div>
              <button
                className={`agent-remove ${removing === agent.id ? "agent-remove-armed" : ""}`}
                title="Remove the agent; its canvas and conversation stay on disk"
                onClick={(event) => {
                  event.stopPropagation();
                  if (removing === agent.id) {
                    void window.dispatch.removeAgent(agent.id).catch((cause) => setError(errorMessage(cause)));
                    setRemoving(undefined);
                  } else {
                    setRemoving(agent.id);
                    setTimeout(() => setRemoving((value) => (value === agent.id ? undefined : value)), 3000);
                  }
                }}
              >
                {removing === agent.id ? "Remove?" : <X size={12} />}
              </button>
            </div>
          );
        })}
        {!open ? (
          <button className="agent-row agent-row-new" onClick={() => { setCreating(true); setError(""); }} title="New agent">
            <span className="agent-new-orb"><Plus size={16} /></span>
            <span className="agent-name">New agent</span>
          </button>
        ) : (
          <form className="agent-form" onSubmit={(event) => { event.preventDefault(); void create(); }}>
            <div className="agent-form-name">
              <AgentAvatar seed={name || "new"} color={color} size={34} />
              <input autoFocus value={name} placeholder="What it works on, like Faster search" onChange={(event) => { setName(event.target.value); setError(""); }} />
            </div>
            <div className="agent-swatches" role="radiogroup" aria-label="Colour">
              {AGENT_COLORS.map((option) => (
                <button key={option} type="button" role="radio" aria-checked={option === color} className={`agent-swatch ${option === color ? "agent-swatch-on" : ""}`} style={{ background: option }} onClick={() => setColor(option)} />
              ))}
            </div>
            <button type="button" className={`agent-repo ${repo ? "agent-repo-set" : ""}`} title={repo} onClick={async () => {
              const picked = await window.dispatch.pickFolder();
              if (!picked) return;
              setRepo(picked);
              if (!name) setName(picked.split("/").pop() ?? "");
              setError("");
            }}>
              <FolderGit2 size={15} /> {repo ? repo.replace(/^\/Users\/[^/]+/, "~") : "Pick its git repository…"}
            </button>
            <label className="agent-voice">
              <span>Voice</span>
              <select value={voice} onChange={(event) => setVoice(event.target.value)} aria-label="The voice its canvas is read in">
                {VOICES.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
              </select>
            </label>
            <p className="agent-runs-on">
              Runs on <strong>{setupCli?.name ?? setup.cli}</strong>{setup.model ? <> · {setupCli?.models?.find((model) => model.id === setup.model)?.label ?? setup.model}</> : ""}
              {!setupCli?.installed && " (not installed)"} · set in Settings
            </p>
            {!ready.length && <p className="agent-error">No coding CLI found. Install Claude Code or Codex, log in, then <button type="button" className="link-button" onClick={() => void window.dispatch.refreshClis()}>look again</button>.</p>}
            {error && <p className="agent-error">{error}</p>}
            <div className="agent-form-actions">
              {state.agents.length > 0 && <button type="button" className="ghost" onClick={() => setCreating(false)}>Cancel</button>}
              <button type="submit" className="primary" disabled={busy || !repo || !chosenCli}>{busy ? "Starting…" : "Create agent"}</button>
            </div>
          </form>
        )}
      </div>
    </aside>
  );
}

// ---------------------------------------------------------------- the workers panel

function workerSession(worker: Worker, state: AppState) {
  const session = state.sessions[worker.id];
  const asking = state.permissions.some((request) => request.session === worker.id);
  if (asking) return { label: "Needs you", tone: "working", said: "said-working" };
  if (session?.status === "starting") return { label: "Starting", tone: "working", said: "said-working" };
  if (session?.status === "working") return { label: "Working", tone: "working", said: "said-working" };
  if (session?.status === "error") return { label: "Stopped on an error", tone: "error", said: "said-stopped" };
  if (session?.status === "idle") return { label: "Waiting", tone: "idle", said: "" };
  return { label: "Not running", tone: "none", said: "" };
}

function WorkersPanel({ agent, state, selected, onSelect, onRemoved }: { agent: Agent; state: AppState; selected?: string; onSelect(id: string): void; onRemoved(): void }) {
  const workers = state.workers.filter((worker) => worker.orchestrator === agent.id);
  const [error, setError] = useState<string>();
  const remove = async (worker: Worker) => {
    try {
      let result = await window.dispatch.removeWorker(worker.id);
      if (!result.removed) {
        if (!confirm(`${result.message}\n\nRemove it anyway? Its worktree goes; its branch ${worker.branch} is kept, with its commits.`)) return;
        result = await window.dispatch.removeWorker(worker.id, true);
      }
      if (result.removed && selected === worker.id) onRemoved();
    } catch (cause) {
      setError(errorMessage(cause));
    }
  };
  return (
    <aside className="sub-issues" style={{ width: RIGHT_WIDTH }}>
      {error && <p className="agent-error">{error}</p>}
      <div className="sub-issues-list">
        {!workers.length && <p className="agent-note">No workers yet. When {agent.name} starts one, it shows here: its task, where it stands, and its pull requests.</p>}
        {workers.map((worker) => {
          const session = workerSession(worker, state);
          return (
            <div key={worker.id} className={`sub-issue ${selected === worker.id ? "sub-issue-active" : ""}`} onClick={() => onSelect(worker.id)} title="Open its conversation">
              <p className="sub-issue-title sub-issue-heading">
                <span className="sub-issue-session"><AgentAvatar seed={worker.id} color={agentColor(agent)} size={22} working={session.tone === "working"} /></span>
                <span className="source-badge source-badge-worker issue-badge">{worker.id}</span>
                {worker.title}
              </p>
              <div className="sub-issue-top">
                <span className="sub-issue-meta" title={worker.worktree}>{state.settings.workerKinds.find((kind) => kind.id === worker.kind)?.name ?? "Worker"} · {worker.cli}{worker.model ? ` ${worker.model}` : ""} · {worker.branch}</span>
                <span className="sub-issue-session">{session.label}</span>
              </div>
              {worker.pullRequests.length > 0 && (
                <div className="sub-issue-pulls">
                  {worker.pullRequests.map((pull) => (
                    <span key={pull.url} className={`source-badge source-badge-pr ${pull.state ? `source-badge-pr-${pull.state}` : ""}`} title={`${pull.title ?? pull.url}${pull.state ? ` · ${pull.state}` : ""}${pull.ciState ? ` · CI ${pull.ciState}` : ""}`} onClick={(event) => { event.stopPropagation(); void window.dispatch.openExternal(pull.url); }}>
                      {pull.ciState && pull.ciState !== "none" && pull.state !== "merged" && pull.state !== "closed" && <span className={`ci-indicator ci-${pull.ciState}`} />}
                      #{pull.number}
                    </span>
                  ))}
                </div>
              )}
              {session.tone === "working" ? (
                <p className={`sub-issue-said ${session.said}`}>{(() => { const live = liveLine(state.sessions[worker.id], state.permissions.some((request) => request.session === worker.id)); return live.detail ? `${live.line} · ${live.detail}` : live.line; })()}</p>
              ) : worker.lastReport && <p className={`sub-issue-said ${session.said}`}>{worker.lastReport.text}</p>}
              <button type="button" className="ghost sub-issue-remove" onClick={(event) => { event.stopPropagation(); void remove(worker); }}>Remove</button>
            </div>
          );
        })}
      </div>
    </aside>
  );
}

// ---------------------------------------------------------------- an agent's page

function useTranscript(id: string) {
  const [entries, setEntries] = useState<TranscriptEntry[]>();
  useEffect(() => {
    let live = true;
    const early: TranscriptEntry[] = [];
    let loaded = false;
    const stop = window.dispatch.onEntry((update) => {
      if (update.id !== id) return;
      if (!loaded) early.push(update.entry);
      else setEntries((list) => [...(list ?? []), update.entry]);
    });
    void window.dispatch.getTranscript(id).then((list) => {
      if (!live) return;
      loaded = true;
      const known = new Set(list.map((entry) => entry.id));
      setEntries([...list, ...early.filter((entry) => !known.has(entry.id))]);
    });
    return () => { live = false; stop(); };
  }, [id]);
  return entries;
}

function durationLabel(ms: number) {
  const seconds = Math.round(ms / 1000);
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

function Transcript({ id, session }: { id: string; session?: SessionState }) {
  const entries = useTranscript(id);
  const scroll = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  useEffect(() => {
    const node = scroll.current;
    if (node && stick.current) node.scrollTop = node.scrollHeight;
  }, [entries?.length, session?.status, session?.activity?.label]);
  return (
    <div className="convo-scroll" ref={scroll} onScroll={(event) => { const node = event.currentTarget; stick.current = node.scrollHeight - node.scrollTop - node.clientHeight < 80; }}>
      <div className="convo-inner">
        {!entries && <p className="convo-empty">Loading the conversation…</p>}
        {entries && !entries.length && !working(session) && <p className="convo-empty">No messages yet. What you write goes to its session.</p>}
        {entries?.map((entry) => {
          if (entry.kind === "user") {
            const relayed = entry.from && entry.from !== "you";
            return (
              <div key={entry.id} className={`msg-user ${relayed ? "msg-user-relayed" : ""}`}>
                {relayed && <span className="msg-user-label">{entry.from === "Flock" ? "Flock" : `From ${entry.from}`}</span>}
                <span className="msg-user-text">{entry.text}</span>
              </div>
            );
          }
          if (entry.kind === "assistant") return <ChatMarkdown key={entry.id} text={entry.text} />;
          // Tool calls are not listed; the one in use shows on the working line.
          if (entry.kind === "tool") return entry.error ? <div key={entry.id} className="msg-tool-error">{entry.name} failed: {entry.summary}</div> : null;
          if (entry.kind === "turn") return <div key={entry.id} className={`turn-end ${entry.error ? "turn-end-error" : ""}`}><span>{entry.error ? "Stopped with an error" : "Done"}{entry.durationMs !== undefined ? ` · ${durationLabel(entry.durationMs)}` : ""}</span></div>;
          return <div key={entry.id} className={`msg-notice ${entry.tone === "warn" ? "msg-notice-warn" : ""}`}>{entry.text}</div>;
        })}
        {working(session) && (
          <div className="convo-working">
            <span className="convo-working-dot" />
            <span className="convo-working-label">{session?.activity?.label ?? "Working…"}</span>
            {session?.activity?.tool && <span className="convo-working-tool">{session.activity.tool}</span>}
          </div>
        )}
      </div>
    </div>
  );
}

function Conversation({ id, agent, worker, state, view, onView, onBack, panel }: {
  id: string;
  agent: Agent;
  worker?: Worker;
  state: AppState;
  view: "canvas" | "chat";
  onView(view: "canvas" | "chat"): void;
  onBack?(): void;
  panel?: { open: boolean; toggle(): void };
}) {
  const session = state.sessions[id];
  const showCanvas = !worker && view === "canvas";
  const busy = working(session);
  const workers = state.workers.filter((item) => item.orchestrator === agent.id);
  const pulls = useMemo<CanvasPullRequest[]>(
    () => workers.flatMap((item) => item.pullRequests.map((pull) => ({ ...pull, worker: item.id, working: working(state.sessions[item.id]) }))),
    [JSON.stringify(workers.map((item) => [item.id, item.pullRequests, state.sessions[item.id]?.status]))],
  );
  const [draft, setDraft] = useState(() => recall(`flock.draft.${id}`) ?? "");
  // On the canvas: where what you write goes (the step you are on, or a
  // pull request's canvas), and whether an ask is on show.
  const focus = useCanvasFocus(agent.id);
  const target = showCanvas ? [focus.pull ? `#${focus.pull.url.split("/").pop()} · ${focus.pull.worker}` : "", focus.title ?? (focus.step ? `Step ${focus.step}` : "")].filter(Boolean).join(" · ") : "";
  const placeholder = !showCanvas ? (worker ? `Message ${worker.id}…` : `Message ${agent.name}…`)
    : focus.ask === "answered" ? "Ask a follow-up…"
      : focus.ask === "waiting" ? "Add to your question…"
        : focus.step ? "Ask about this step…" : `Ask ${focus.pull ? focus.pull.worker : agent.name} about the canvas…`;
  const [error, setError] = useState<string>();
  useEffect(() => remember(`flock.draft.${id}`, draft), [id, draft]);
  // On a canvas, what you write is an ask on the step you are on (to the
  // orchestrator, or inside a pull request's canvas to its worker); the
  // focus goes back to the board, to hear the answer.
  const send = async () => {
    const text = draft.trim();
    if (!text) return;
    setDraft("");
    setError(undefined);
    try {
      if (showCanvas) {
        const focus = canvasFocus(id);
        await window.dispatch.sendMessage({ id, text, ask: { ...(focus.step ? { step: focus.step } : {}), ...(focus.pull ? { pull: focus.pull.url } : {}) } });
        (document.activeElement as HTMLElement | null)?.blur();
        document.querySelector<HTMLElement>(".agent-canvas-slot .sketch")?.focus({ preventScroll: true });
      } else {
        await window.dispatch.sendMessage({ id, text });
      }
    } catch (cause) {
      setDraft((current) => current || text);
      setError(errorMessage(cause));
    }
  };
  return (
    <div className={`convo ${showCanvas ? "convo-canvas-mode" : ""} ${busy ? "convo-busy" : ""}`}>
      <div className="convo-views" role="tablist">
        {worker ? (
          <>
            <button type="button" className="convo-views-back" onClick={onBack} title={`Back to ${agent.name}`}><ArrowLeft size={13} /> {agent.name}</button>
            <span className="convo-views-divider" aria-hidden />
            <button role="tab" aria-selected className="convo-view-on">{worker.id} · Chat</button>
          </>
        ) : (
          <>
            {(["canvas", "chat"] as const).map((option) => (
              <button key={option} role="tab" aria-selected={view === option} className={view === option ? "convo-view-on" : ""} onClick={() => onView(option)}>
                {option === "canvas" ? "Canvas" : "Chat"}
              </button>
            ))}
            {showCanvas && panel && (
              <>
                <span className="convo-views-divider" aria-hidden />
                <button type="button" className={`convo-views-panel ${panel.open ? "convo-view-on" : ""}`} aria-pressed={panel.open} title={panel.open ? "Hide the workers panel" : "Show the workers panel"} onClick={panel.toggle}>
                  <PanelRight size={15} />
                </button>
              </>
            )}
          </>
        )}
      </div>
      {showCanvas ? (
        <React.Suspense fallback={<div className="agent-canvas" />}>
          <CanvasSlot
            agentId={agent.id}
            name={agent.name}
            voice={agent.voice}
            pullRequests={pulls}
            working={busy}
            {...(busy ? { activity: { label: session?.activity?.label ?? "Working…", ...(session?.activity?.tool ? { tool: session.activity.tool } : {}) } } : {})}
            onOpenPull={(url) => void window.dispatch.openExternal(url)}
            renderText={(text) => <ChatMarkdown text={text} />}
            avatar={(atWork) => <AgentAvatar seed={agent.id} color={agentColor(agent)} size={28} working={atWork} />}
            live={liveRows(agent, workers, state)}
          />
        </React.Suspense>
      ) : (
        <Transcript id={id} session={session} />
      )}
      <div className="convo-composer">
        <div className={`convo-box ${busy ? "convo-box-working" : ""}`}>
          {target && <span className="convo-target" title="What you write is an ask about this">{target}</span>}
          <div className="convo-input">
            <textarea
              rows={1}
              value={draft}
              placeholder={placeholder}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                // ↑ on the first line: out of the message box, back to the
                // walkthrough's keys (Space plays, ← → move, Esc leaves an ask).
                if (event.key === "ArrowUp" && showCanvas && !event.shiftKey && !event.metaKey && !event.altKey) {
                  const field = event.currentTarget;
                  if (!field.value.slice(0, field.selectionStart).includes("\n")) {
                    event.preventDefault();
                    field.blur();
                    document.querySelector<HTMLElement>(".agent-canvas-slot .sketch")?.focus({ preventScroll: true });
                    return;
                  }
                }
                if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
                // Yours to send, and nobody else's (the canvas plays on Enter);
                // a held Enter repeats, and only its first press sends.
                event.preventDefault();
                event.stopPropagation();
                if (!event.repeat) void send();
              }}
            />
          </div>
          <button className="convo-send" title="Send (Enter)" disabled={!draft.trim()} onClick={() => void send()}>
            <ArrowUp size={15} />
          </button>
        </div>
        {error && <p className="convo-error">{error}</p>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- settings

const ROLES: { id: "orchestrator" | "worker"; label: string; detail: string }[] = [
  { id: "orchestrator", label: "Orchestrators", detail: "plan only" },
  { id: "worker", label: "Workers", detail: "build in worktrees" },
];

const MODES: { id: PermissionMode; label: string; detail: string }[] = [
  { id: "ask", label: "Ask me", detail: "File edits go ahead. Shell commands and the web wait for your Allow." },
  { id: "edits", label: "Edits only", detail: "File edits go ahead. Anything else is refused, without asking." },
  { id: "all", label: "Everything", detail: "Nothing is asked. Fast, and fully trusting." },
];

type SettingsTab = "clis" | "orchestrator" | "workers" | "voice" | "permissions";
const SETTINGS_TABS: { id: SettingsTab; label: string; icon: React.ReactNode; lead: string }[] = [
  { id: "clis", label: "Coding CLIs", icon: <TerminalSquare size={16} />, lead: "Flock runs your agents on the coding CLIs on this machine, with your own login." },
  { id: "orchestrator", label: "Orchestrator", icon: <Bot size={16} />, lead: "How every orchestrator runs: the one you talk to, who plans and starts workers. A change applies from each orchestrator's next start." },
  { id: "workers", label: "Workers", icon: <Users size={16} />, lead: "The kinds of workers orchestrators can start. Each is for some kind of work: the orchestrator reads what each is for, and picks one per task." },
  { id: "voice", label: "Voice", icon: <AudioLines size={16} />, lead: "Agents read their walkthroughs aloud. The voice new agents get; each agent keeps the one it was made with." },
  { id: "permissions", label: "Permissions", icon: <ShieldCheck size={16} />, lead: "What agents may do without asking you. A change applies to each session from its next start: sessions not at work restart on their next message." },
];

const CLI_ABOUT: Record<CliId, { by: string; install: string }> = {
  claude: { by: "Anthropic's coding agent", install: "npm install -g @anthropic-ai/claude-code" },
  codex: { by: "OpenAI's coding agent", install: "npm install -g @openai/codex" },
};

// A text field that saves when you leave it (not on every key).
function Draft({ value, multiline, rows = 5, placeholder, onSave }: { value: string; multiline?: boolean; rows?: number; placeholder?: string; onSave(value: string): void }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const props = { value: draft, placeholder, onChange: (event: React.ChangeEvent<HTMLInputElement & HTMLTextAreaElement>) => setDraft(event.target.value), onBlur: () => { if (draft !== value) onSave(draft); } };
  return multiline ? <textarea className={rows > 2 ? "setup-instructions" : "setup-short"} rows={rows} {...props} /> : <input {...props} />;
}

// How a session runs: its CLI, its model (from that CLI's own list), and
// instructions of your own.
function SetupEditor({ clis, setup, instructionsHint, onChange }: { clis: CliStatus[]; setup: SessionSetup; instructionsHint: string; onChange(setup: SessionSetup): void }) {
  const cli = clis.find((item) => item.id === setup.cli);
  const models = cli?.models ?? [{ id: "", label: "Default" }];
  return (
    <div className="setup">
      <div className="setup-row">
        <span className="setup-label">CLI</span>
        <div className="setup-segments" role="radiogroup">
          {clis.map((item) => (
            <button key={item.id} type="button" role="radio" aria-checked={item.id === setup.cli} disabled={!item.installed} className={`setup-segment ${item.id === setup.cli ? "setup-segment-on" : ""}`} onClick={() => onChange({ ...setup, cli: item.id, model: undefined })}>
              {item.name}{!item.installed && <small>not installed</small>}
            </button>
          ))}
        </div>
      </div>
      <div className="setup-row setup-row-top">
        <span className="setup-label">Model</span>
        <div className="setup-models" role="radiogroup">
          {models.map((model) => (
            <button key={model.id || "default"} type="button" role="radio" aria-checked={(setup.model ?? "") === model.id} className={`setup-model ${(setup.model ?? "") === model.id ? "setup-model-on" : ""}`} onClick={() => onChange({ ...setup, model: model.id || undefined })} title={model.detail}>
              <strong>{model.label}</strong>
              {model.detail && <small>{model.detail}</small>}
            </button>
          ))}
        </div>
      </div>
      <div className="setup-row setup-row-top">
        <span className="setup-label">Instructions</span>
        <Draft multiline value={setup.instructions ?? ""} placeholder={instructionsHint} onSave={(instructions) => onChange({ ...setup, instructions: instructions.trim() || undefined })} />
      </div>
    </div>
  );
}

// The kinds of workers: each a card, opened to edit it.
function WorkerKinds({ clis, kinds, onChange }: { clis: CliStatus[]; kinds: WorkerKind[]; onChange(kinds: WorkerKind[]): void }) {
  const [openId, setOpenId] = useState<string | undefined>(kinds.length === 1 ? kinds[0]!.id : undefined);
  const put = (kind: WorkerKind) => onChange(kinds.map((item) => (item.id === kind.id ? kind : item)));
  const add = () => {
    const base = clis.find((item) => item.installed)?.id ?? "claude";
    let id = "kind";
    for (let n = 2; kinds.some((item) => item.id === id); n += 1) id = `kind-${n}`;
    onChange([...kinds, { id, name: "New kind", description: "What this kind of worker is for.", cli: base }]);
    setOpenId(id);
  };
  const runsOn = (kind: WorkerKind) => {
    const cli = clis.find((item) => item.id === kind.cli);
    return `${cli?.name ?? kind.cli}${kind.model ? ` · ${cli?.models?.find((model) => model.id === kind.model)?.label ?? kind.model}` : ""}`;
  };
  return (
    <div className="kinds">
      {kinds.map((kind) => {
        const open = openId === kind.id;
        return (
          <div key={kind.id} className={`kind ${open ? "kind-open" : ""}`}>
            <button type="button" className="kind-head" onClick={() => setOpenId(open ? undefined : kind.id)} aria-expanded={open}>
              <span className="kind-title"><strong>{kind.name}</strong><code>{kind.id}</code></span>
              <span className="kind-description">{kind.description}</span>
              <span className="kind-runs">{runsOn(kind)}{kind.instructions ? " · instructions" : ""}</span>
              <ChevronDown size={16} className="kind-chevron" />
            </button>
            {open && (
              <div className="kind-body">
                <div className="setup-row">
                  <span className="setup-label">Name</span>
                  <Draft value={kind.name} onSave={(name) => put({ ...kind, name: name.trim() || kind.name })} />
                </div>
                <div className="setup-row setup-row-top">
                  <span className="setup-label">For</span>
                  <Draft multiline rows={2} value={kind.description} placeholder="What it is for: the orchestrator reads this to pick a kind." onSave={(description) => put({ ...kind, description: description.trim() || kind.description })} />
                </div>
                <SetupEditor clis={clis} setup={kind} instructionsHint="For this kind of worker, after Flock's own: how to test, which files to stay out of, how to write commits…" onChange={(setup) => put({ ...kind, ...setup })} />
                {kinds.length > 1 && <button type="button" className="ghost kind-remove" onClick={() => onChange(kinds.filter((item) => item.id !== kind.id))}><Trash2 size={13} /> Remove this kind</button>}
              </div>
            )}
          </div>
        );
      })}
      <button type="button" className="kind-add" onClick={add}><Plus size={15} /> Add a kind of worker</button>
    </div>
  );
}

// Settings, over the page: a modal with its sections as tabs on the left.
// Esc or a click outside closes it.
function SettingsModal({ state, onClose }: { state: AppState; onClose(): void }) {
  const [settings, setSettings] = useState<Settings>(state.settings);
  const [tab, setTab] = useState<SettingsTab>(() => (recall("flock.settingsTab") as SettingsTab) ?? "clis");
  useEffect(() => remember("flock.settingsTab", tab), [tab]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);
  const update = (next: Settings) => {
    setSettings(next);
    void window.dispatch.saveSettings(next);
  };
  const shown = SETTINGS_TABS.find((item) => item.id === tab)!;
  return (
    <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="modal settings" role="dialog" aria-modal="true" aria-label="Settings">
        <nav className="settings-nav">
          <h1>Settings</h1>
          {SETTINGS_TABS.map((item) => (
            <button key={item.id} type="button" className={`settings-tab ${tab === item.id ? "settings-tab-on" : ""}`} aria-current={tab === item.id ? "page" : undefined} onClick={() => setTab(item.id)}>
              {item.icon}{item.label}
            </button>
          ))}
        </nav>
        <section className="settings-body">
          <div className="settings-head">
            <h2>{shown.label}</h2>
            <button type="button" className="icon-button" onClick={onClose} title="Close (Esc)"><X size={16} /></button>
          </div>
          <p className="settings-lead">{shown.lead}</p>

          {tab === "clis" && (
            <div className="cli-cards">
              {state.clis.map((cli) => {
                const about = CLI_ABOUT[cli.id];
                return (
                  <div key={cli.id} className={`cli-card ${cli.installed && cli.loggedIn ? "" : "cli-card-off"}`}>
                    <span className="cli-card-mark"><TerminalSquare size={20} /></span>
                    <div className="cli-card-main">
                      <div className="cli-card-title"><strong>{cli.name}</strong>{cli.version && <span className="muted">{cli.version}</span>}</div>
                      <span className="cli-card-about">{about.by}{cli.models && cli.models.length > 1 ? ` · ${cli.models.length - 1} models` : ""}</span>
                      {!cli.installed && <code className="cli-card-install">{about.install}</code>}
                      {cli.installed && !cli.loggedIn && cli.note && <span className="cli-card-about">{cli.note}</span>}
                    </div>
                    <span className={`settings-pill ${cli.installed && cli.loggedIn ? "settings-pill-ok" : cli.installed ? "settings-pill-warn" : ""}`}>{cli.installed ? (cli.loggedIn ? "Ready" : "Not logged in") : "Not installed"}</span>
                  </div>
                );
              })}
              <button type="button" className="ghost cli-cards-again" onClick={() => void window.dispatch.refreshClis()}><RotateCcw size={13} /> Look again</button>
            </div>
          )}

          {tab === "orchestrator" && <SetupEditor clis={state.clis} setup={settings.orchestrator} instructionsHint="For every orchestrator, after Flock's own: how you like plans drawn, what to check before starting workers, your team's conventions…" onChange={(orchestrator) => update({ ...settings, orchestrator })} />}

          {tab === "workers" && <WorkerKinds clis={state.clis} kinds={settings.workerKinds} onChange={(workerKinds) => update({ ...settings, workerKinds })} />}

          {tab === "voice" && <VoiceCheck voiceId={settings.voice ?? DEFAULT_VOICE} onVoice={(id) => update({ ...settings, voice: id })} />}

          {tab === "permissions" && (
            // The modes as rows, each said once; the two roles as columns.
            <div className="perm-table" role="table">
              <div className="perm-head" role="row">
                <span role="columnheader" />
                {ROLES.map((role) => <span key={role.id} role="columnheader"><strong>{role.label}</strong><small>{role.detail}</small></span>)}
              </div>
              {MODES.map((mode) => (
                <div key={mode.id} className="perm-row" role="row">
                  <span className="perm-mode" role="rowheader"><strong>{mode.label}</strong><small>{mode.detail}</small></span>
                  {ROLES.map((role) => {
                    const on = settings.permissions[role.id] === mode.id;
                    return (
                      <button key={role.id} type="button" role="radio" aria-checked={on} aria-label={`${role.label}: ${mode.label}`} className={`perm-cell ${on ? "perm-cell-on" : ""}`} onClick={() => update({ ...settings, permissions: { ...settings.permissions, [role.id]: mode.id } })}>
                        <span className="perm-radio" />
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          )}
          {tab === "permissions" && <p className="settings-footnote">Codex cannot ask from its headless mode: with Ask me it runs as Edits only. Everything is Claude Code's bypassPermissions, and Codex without its sandbox.</p>}
        </section>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- permissions

function Permissions({ state }: { state: AppState }) {
  if (!state.permissions.length) return null;
  return (
    <div className="permissions">
      {state.permissions.map((request) => {
        const worker = state.workers.find((item) => item.id === request.session);
        const agent = state.agents.find((item) => item.id === (worker?.orchestrator ?? request.session));
        return (
          <div key={request.id} className="permission">
            <div className="permission-head">
              {agent && <AgentAvatar seed={agent.id} color={agentColor(agent)} size={22} />}
              <ShieldQuestion size={15} />
              <span><strong>{worker ? worker.id : agent?.name ?? request.session}</strong> wants to use <strong>{request.tool}</strong></span>
            </div>
            <pre className="permission-input">{request.summary}</pre>
            <div className="permission-actions">
              <button type="button" className="ghost" onClick={() => void window.dispatch.answerPermission(request.id, false)}>Deny</button>
              <button type="button" className="primary" onClick={() => void window.dispatch.answerPermission(request.id, true)}>Allow</button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
