// Flock's window: your agents on the left (each orchestrator, its workers
// under it), the one you picked in the middle as its Canvas or its Chat,
// and the message box under it. Tool calls that need your yes show at the
// top right.
import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Bot, FolderGit2, GitBranch, LayoutDashboard, MessageSquare, Plus, RotateCcw, Settings as SettingsIcon, ShieldQuestion, Trash2, X } from "lucide-react";
import { DEFAULT_VOICE, VOICES } from "ttmi-voices";
import type { Agent, AppState, CliId, PermissionMode, SessionState, Settings, TranscriptEntry, Worker } from "../shared/types";
import type { CanvasPullRequest } from "../shared/pullRequestCanvas";
import { canvasFocus } from "./canvasStep";
import "./style.css";

const CanvasSlot = React.lazy(() => import("./canvas").then((module) => ({ default: module.CanvasSlot })));

const remember = (key: string, value: string) => { try { localStorage.setItem(key, value); } catch { /* not kept */ } };
const recall = (key: string) => { try { return localStorage.getItem(key) ?? undefined; } catch { return undefined; } };

function Markdown({ text }: { text: string }) {
  return (
    <div className="chat-markdown">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ a: ({ href, children }) => <a href={href} onClick={(event) => { event.preventDefault(); if (href) void window.dispatch.openExternal(href); }}>{children}</a> }}>{text}</ReactMarkdown>
    </div>
  );
}

function App() {
  const [state, setState] = useState<AppState>();
  const [selected, setSelected] = useState<string | undefined>(() => recall("flock.selected"));
  const [panel, setPanel] = useState<"new" | "settings" | undefined>();
  useEffect(() => {
    void window.dispatch.getState().then(setState);
    return window.dispatch.onState(setState);
  }, []);
  useEffect(() => { if (selected) remember("flock.selected", selected); }, [selected]);
  if (!state) return <div className="app-loading" />;
  const agent = state.agents.find((item) => item.id === selected);
  const worker = state.workers.find((item) => item.id === selected);
  const shown = agent ?? worker ?? state.agents[0];
  const showPanel = panel ?? (!state.agents.length ? "new" : undefined);
  return (
    <div className="app">
      <Sidebar state={state} selected={shown?.id} onSelect={(id) => { setSelected(id); setPanel(undefined); }} onNew={() => setPanel("new")} onSettings={() => setPanel(panel === "settings" ? undefined : "settings")} />
      <main className="app-main">
        {showPanel === "new" ? (
          <NewAgent state={state} onCancel={state.agents.length ? () => setPanel(undefined) : undefined} onCreated={(made) => { setSelected(made.id); setPanel(undefined); }} />
        ) : showPanel === "settings" ? (
          <SettingsPanel state={state} onClose={() => setPanel(undefined)} />
        ) : shown && "repo" in shown ? (
          <AgentView key={shown.id} agent={shown} state={state} />
        ) : shown ? (
          <WorkerView key={shown.id} worker={shown} state={state} onRemoved={() => setSelected(shown.orchestrator)} />
        ) : null}
      </main>
      <Permissions state={state} />
    </div>
  );
}

function statusClass(session: SessionState | undefined) {
  return `status-dot status-${session?.status ?? "stopped"}`;
}

function Sidebar({ state, selected, onSelect, onNew, onSettings }: { state: AppState; selected?: string; onSelect(id: string): void; onNew(): void; onSettings(): void }) {
  return (
    <nav className="sidebar">
      <div className="sidebar-top">
        <span className="sidebar-title">Flock</span>
        <button type="button" className="icon-button" title="New agent" onClick={onNew}><Plus size={16} /></button>
      </div>
      <div className="sidebar-list">
        {state.agents.map((agent) => (
          <div key={agent.id} className="sidebar-group">
            <button type="button" className={`sidebar-row ${selected === agent.id ? "sidebar-row-active" : ""}`} onClick={() => onSelect(agent.id)}>
              <span className={statusClass(state.sessions[agent.id])} />
              <span className="sidebar-name">{agent.name}</span>
              <span className="id-badge id-orchestrator">{agent.id}</span>
            </button>
            {state.workers.filter((worker) => worker.orchestrator === agent.id).map((worker) => (
              <button key={worker.id} type="button" className={`sidebar-row sidebar-row-worker ${selected === worker.id ? "sidebar-row-active" : ""}`} onClick={() => onSelect(worker.id)}>
                <span className={statusClass(state.sessions[worker.id])} />
                <span className="sidebar-name">{worker.title}</span>
                <span className="id-badge id-worker">{worker.id}</span>
              </button>
            ))}
          </div>
        ))}
      </div>
      <div className="sidebar-bottom">
        <button type="button" className="sidebar-row" onClick={onSettings}><SettingsIcon size={15} /> <span className="sidebar-name">Settings</span></button>
      </div>
    </nav>
  );
}

// ---------------------------------------------------------------- new agent

function NewAgent({ state, onCancel, onCreated }: { state: AppState; onCancel?(): void; onCreated(agent: Agent): void }) {
  const ready = state.clis.filter((cli) => cli.installed);
  const [repo, setRepo] = useState<string>();
  const [name, setName] = useState("");
  const [cli, setCli] = useState<CliId | undefined>(state.settings.defaultCli ?? state.clis.find((item) => item.installed && item.loggedIn)?.id ?? ready[0]?.id);
  const [voice, setVoice] = useState(DEFAULT_VOICE);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const create = async () => {
    if (!repo) return;
    setBusy(true);
    setError(undefined);
    try {
      onCreated(await window.dispatch.createAgent({ repo, name, cli, voice }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "") : String(cause));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="panel">
      <div className="panel-card">
        <div className="panel-head">
          <h1>{state.agents.length ? "New agent" : "Welcome to Flock"}</h1>
          {onCancel && <button type="button" className="icon-button" onClick={onCancel} title="Close"><X size={16} /></button>}
        </div>
        <p className="panel-lead">An agent works on one git repository. You talk to it; it answers by drawing on its canvas, and starts workers (each in its own git worktree) to build.</p>
        <label className="field">
          <span>Repository</span>
          <button type="button" className="folder-pick" onClick={async () => { const picked = await window.dispatch.pickFolder(); if (picked) { setRepo(picked); if (!name) setName(picked.split("/").pop() ?? ""); } }}>
            <FolderGit2 size={16} /> {repo ?? "Pick a folder…"}
          </button>
        </label>
        <label className="field"><span>Name</span><input value={name} onChange={(event) => setName(event.target.value)} placeholder="What it works on" /></label>
        <label className="field">
          <span>Coding CLI</span>
          <select value={cli ?? ""} onChange={(event) => setCli(event.target.value as CliId)}>
            {state.clis.map((item) => <option key={item.id} value={item.id} disabled={!item.installed}>{item.name}{!item.installed ? " (not installed)" : !item.loggedIn ? " (not logged in)" : item.version ? ` ${item.version}` : ""}</option>)}
          </select>
        </label>
        <label className="field">
          <span>Voice</span>
          <select value={voice} onChange={(event) => setVoice(event.target.value)}>
            {VOICES.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </label>
        {!ready.length && <p className="panel-error">No coding CLI found. Install Claude Code (claude) or Codex (codex), log in, then <button type="button" className="link-button" onClick={() => void window.dispatch.refreshClis()}>look again</button>.</p>}
        {error && <p className="panel-error">{error}</p>}
        <div className="panel-actions">
          <button type="button" className="primary-button" disabled={!repo || !cli || busy} onClick={() => void create()}>{busy ? "Starting…" : "Start agent"}</button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- settings

const MODES: { id: PermissionMode; label: string; detail: string }[] = [
  { id: "ask", label: "Ask me", detail: "File edits are fine; anything else (shell commands, web) asks you here first. Codex cannot ask from its headless mode, so it runs as Edits only." },
  { id: "edits", label: "Edits only", detail: "File edits are fine; anything that would need a yes is refused." },
  { id: "all", label: "Everything", detail: "No questions asked (Claude's bypassPermissions, Codex without its sandbox). Fast, and fully trusting." },
];

function SettingsPanel({ state, onClose }: { state: AppState; onClose(): void }) {
  const [settings, setSettings] = useState<Settings>(state.settings);
  const update = (next: Settings) => {
    setSettings(next);
    void window.dispatch.saveSettings(next);
  };
  return (
    <div className="panel">
      <div className="panel-card">
        <div className="panel-head">
          <h1>Settings</h1>
          <button type="button" className="icon-button" onClick={onClose} title="Close"><X size={16} /></button>
        </div>
        <h2>Coding CLIs</h2>
        <ul className="cli-list">
          {state.clis.map((cli) => (
            <li key={cli.id}>
              <span className={`status-dot ${cli.installed && cli.loggedIn ? "status-idle" : cli.installed ? "status-working" : "status-stopped"}`} />
              <strong>{cli.name}</strong>
              <span className="muted">{cli.installed ? `${cli.version ?? ""}${cli.loggedIn ? "" : " · not logged in"}` : "not installed"}</span>
              {cli.note && <span className="muted">{cli.note}</span>}
            </li>
          ))}
        </ul>
        <button type="button" className="link-button" onClick={() => void window.dispatch.refreshClis()}>Look again</button>
        <label className="field">
          <span>Default for new agents</span>
          <select value={settings.defaultCli ?? ""} onChange={(event) => update({ ...settings, defaultCli: (event.target.value || undefined) as CliId | undefined })}>
            <option value="">The first one ready</option>
            {state.clis.filter((cli) => cli.installed).map((cli) => <option key={cli.id} value={cli.id}>{cli.name}</option>)}
          </select>
        </label>
        <h2>What agents may do without asking</h2>
        {(["orchestrator", "worker"] as const).map((role) => (
          <label key={role} className="field">
            <span>{role === "orchestrator" ? "Orchestrators (they plan; they never edit files)" : "Workers (in their own worktree)"}</span>
            <select value={settings.permissions[role]} onChange={(event) => update({ ...settings, permissions: { ...settings.permissions, [role]: event.target.value as PermissionMode } })}>
              {MODES.map((mode) => <option key={mode.id} value={mode.id}>{mode.label}</option>)}
            </select>
            <small className="muted">{MODES.find((mode) => mode.id === settings.permissions[role])?.detail}</small>
          </label>
        ))}
        <p className="muted">A change applies to each session from its next start (sessions not at work restart on their next message).</p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- permissions

function Permissions({ state }: { state: AppState }) {
  if (!state.permissions.length) return null;
  const name = (id: string) => state.agents.find((agent) => agent.id === id)?.name ?? state.workers.find((worker) => worker.id === id)?.title ?? id;
  return (
    <div className="permissions">
      {state.permissions.map((request) => (
        <div key={request.id} className="permission">
          <div className="permission-head"><ShieldQuestion size={16} /> <strong>{request.session}</strong> <span className="muted">{name(request.session)}</span></div>
          <div className="permission-what">wants to use <strong>{request.tool}</strong></div>
          <pre className="permission-input">{request.summary}</pre>
          <div className="permission-actions">
            <button type="button" className="ghost-button" onClick={() => void window.dispatch.answerPermission(request.id, false)}>Deny</button>
            <button type="button" className="primary-button" onClick={() => void window.dispatch.answerPermission(request.id, true)}>Allow</button>
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- sessions

function useTranscript(id: string) {
  const [entries, setEntries] = useState<TranscriptEntry[]>([]);
  useEffect(() => {
    let live = true;
    const early: TranscriptEntry[] = [];
    let loaded = false;
    const stop = window.dispatch.onEntry((update) => {
      if (update.id !== id) return;
      if (!loaded) early.push(update.entry);
      else setEntries((list) => [...list, update.entry]);
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

function Chat({ id, session }: { id: string; session?: SessionState }) {
  const entries = useTranscript(id);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => end.current?.scrollIntoView({ block: "end" }), [entries.length, session?.status]);
  return (
    <div className="chat">
      <div className="chat-inner">
        {!entries.length && <p className="chat-empty">Nothing yet. What you write goes to its session.</p>}
        {entries.map((entry) => {
          if (entry.kind === "user") return <div key={entry.id} className={`msg-user ${entry.from && entry.from !== "you" ? "msg-user-from" : ""}`}>{entry.from && entry.from !== "you" && <span className="msg-from">{entry.from}</span>}<Markdown text={entry.text} /></div>;
          if (entry.kind === "assistant") return <div key={entry.id} className="msg-assistant"><Markdown text={entry.text} /></div>;
          if (entry.kind === "tool") return <div key={entry.id} className={`msg-tool ${entry.error ? "msg-tool-error" : ""}`}><span className="msg-tool-name">{entry.name}</span>{entry.summary && <span className="msg-tool-summary">{entry.summary}</span>}</div>;
          return <div key={entry.id} className={`msg-notice ${entry.tone === "warn" ? "msg-notice-warn" : ""}`}>{entry.text}</div>;
        })}
        {session?.status === "working" && <WorkingRow session={session} />}
        <div ref={end} />
      </div>
    </div>
  );
}

function WorkingRow({ session }: { session: SessionState }) {
  return (
    <div className="convo-working">
      <span className="convo-working-dot" />
      <span className="convo-working-label">{session.activity?.label ?? "Working…"}</span>
      {session.activity?.tool && <span className="convo-working-tool">{session.activity.tool}</span>}
    </div>
  );
}

// The message box. On a canvas, what you write is an ask on the step you
// are on (to the orchestrator, or inside a pull request's canvas to its
// worker), and the focus goes back to the board to hear the answer.
function Composer({ id, session, canvas, placeholder }: { id: string; session?: SessionState; canvas: boolean; placeholder: string }) {
  const [draft, setDraft] = useState(() => recall(`flock.draft.${id}`) ?? "");
  const [error, setError] = useState<string>();
  useEffect(() => remember(`flock.draft.${id}`, draft), [id, draft]);
  const send = async () => {
    const text = draft.trim();
    if (!text) return;
    setDraft("");
    setError(undefined);
    try {
      if (canvas) {
        const focus = canvasFocus(id);
        await window.dispatch.sendMessage({ id, text, ask: { ...(focus.step ? { step: focus.step } : {}), ...(focus.pull ? { pull: focus.pull.url } : {}) } });
        (document.activeElement as HTMLElement | null)?.blur();
        document.querySelector<HTMLElement>(".agent-canvas-slot .sketch")?.focus({ preventScroll: true });
      } else {
        await window.dispatch.sendMessage({ id, text });
      }
    } catch (cause) {
      setDraft((current) => current || text);
      setError(cause instanceof Error ? cause.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "") : String(cause));
    }
  };
  return (
    <div className="convo-composer">
      {error && <p className="composer-error">{error}</p>}
      <div className={`convo-box ${session?.status === "working" ? "convo-box-working" : ""}`}>
        <textarea
          rows={1}
          value={draft}
          placeholder={placeholder}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
            event.preventDefault();
            // A held Enter repeats: only its first press sends.
            if (!event.repeat) void send();
          }}
        />
      </div>
    </div>
  );
}

function sessionLine(session: SessionState | undefined) {
  if (!session || session.status === "stopped") return "Not running; your next message starts it.";
  if (session.status === "error") return session.error ?? "The session stopped with an error.";
  if (session.status === "starting") return "Starting…";
  if (session.status === "working") return session.activity?.label ?? "Working…";
  return "Waiting for you.";
}

function AgentView({ agent, state }: { agent: Agent; state: AppState }) {
  const [view, setView] = useState<"canvas" | "chat">(() => (recall(`flock.view.${agent.id}`) as "canvas" | "chat") ?? "canvas");
  useEffect(() => remember(`flock.view.${agent.id}`, view), [agent.id, view]);
  const session = state.sessions[agent.id];
  const workers = state.workers.filter((worker) => worker.orchestrator === agent.id);
  const pulls = useMemo<CanvasPullRequest[]>(() => workers.flatMap((worker) => worker.pullRequests.map((pull) => ({ ...pull, worker: worker.id, working: state.sessions[worker.id]?.status === "working" }))), [JSON.stringify(workers), JSON.stringify(workers.map((worker) => state.sessions[worker.id]?.status))]);
  const [error, setError] = useState<string>();
  return (
    <div className={`agent-view ${view === "canvas" ? "convo-canvas-mode" : ""} ${session?.status === "working" ? "convo-busy" : ""}`}>
      <header className="agent-header">
        <div className="agent-header-title">
          <Bot size={18} />
          <strong>{agent.name}</strong>
          <span className="id-badge id-orchestrator">{agent.id}</span>
          <span className="muted agent-header-meta" title={agent.repo}>{agent.repo.replace(/^\/Users\/[^/]+/, "~")} · {agent.cli}</span>
        </div>
        <div className="agent-header-actions">
          <span className="muted session-line">{sessionLine(session)}</span>
          <div className="view-switch">
            <button type="button" className={view === "canvas" ? "active" : ""} onClick={() => setView("canvas")}><LayoutDashboard size={14} /> Canvas</button>
            <button type="button" className={view === "chat" ? "active" : ""} onClick={() => setView("chat")}><MessageSquare size={14} /> Chat</button>
          </div>
          <button type="button" className="icon-button" title="Restart its session (it resumes where it was)" onClick={() => void window.dispatch.restartSession(agent.id)}><RotateCcw size={15} /></button>
          <button type="button" className="icon-button" title="Remove this agent" onClick={async () => {
            if (!confirm(`Remove ${agent.name}? Its canvas and conversation stay on disk.`)) return;
            try { await window.dispatch.removeAgent(agent.id); } catch (cause) { setError(cause instanceof Error ? cause.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "") : String(cause)); }
          }}><Trash2 size={15} /></button>
        </div>
      </header>
      {error && <p className="composer-error">{error}</p>}
      {view === "canvas" ? (
        <React.Suspense fallback={<div className="agent-canvas" />}>
          <CanvasSlot
            agentId={agent.id}
            name={agent.name}
            voice={agent.voice}
            pullRequests={pulls}
            working={session?.status === "working"}
            {...(session?.status === "working" ? { activity: { label: session.activity?.label ?? "Working…", ...(session.activity?.tool ? { tool: session.activity.tool } : {}) } } : {})}
            onOpenPull={(url) => void window.dispatch.openExternal(url)}
            renderText={(text) => <Markdown text={text} />}
          />
        </React.Suspense>
      ) : (
        <Chat id={agent.id} session={session} />
      )}
      <Composer id={agent.id} session={session} canvas={view === "canvas"} placeholder={view === "canvas" ? `Ask ${agent.name} about this step…` : `Message ${agent.name}…`} />
    </div>
  );
}

function WorkerView({ worker, state, onRemoved }: { worker: Worker; state: AppState; onRemoved(): void }) {
  const session = state.sessions[worker.id];
  const [error, setError] = useState<string>();
  const remove = async () => {
    try {
      let result = await window.dispatch.removeWorker(worker.id);
      if (!result.removed) {
        if (!confirm(`${result.message}\n\nRemove it anyway? The worktree goes; the branch ${worker.branch} is kept, with its commits.`)) return;
        result = await window.dispatch.removeWorker(worker.id, true);
      }
      if (result.removed) onRemoved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "") : String(cause));
    }
  };
  return (
    <div className="agent-view">
      <header className="agent-header">
        <div className="agent-header-title">
          <GitBranch size={18} />
          <strong>{worker.title}</strong>
          <span className="id-badge id-worker">{worker.id}</span>
          <span className="muted agent-header-meta" title={worker.worktree}>{worker.branch} · {worker.cli}</span>
          {worker.pullRequests.map((pull) => (
            <a key={pull.url} className={`pr-chip pr-${pull.state ?? "unknown"}`} href={pull.url} onClick={(event) => { event.preventDefault(); void window.dispatch.openExternal(pull.url); }}>#{pull.number}{pull.state ? ` ${pull.state}` : ""}{pull.ciState && pull.ciState !== "unknown" ? ` · CI ${pull.ciState}` : ""}</a>
          ))}
        </div>
        <div className="agent-header-actions">
          <span className="muted session-line">{sessionLine(session)}</span>
          <button type="button" className="icon-button" title="Restart its session (it resumes where it was)" onClick={() => void window.dispatch.restartSession(worker.id)}><RotateCcw size={15} /></button>
          <button type="button" className="icon-button" title="Remove this worker and its worktree" onClick={() => void remove()}><Trash2 size={15} /></button>
        </div>
      </header>
      {worker.lastReport && <div className="worker-report"><span className="muted">Last report</span> {worker.lastReport.text}</div>}
      {error && <p className="composer-error">{error}</p>}
      <Chat id={worker.id} session={session} />
      <Composer id={worker.id} session={session} canvas={false} placeholder={`Message ${worker.id} directly…`} />
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
