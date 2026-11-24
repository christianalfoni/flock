// An orchestrator's canvas in its agent view: TTMI's board, showing the one
// picture the orchestrator talks to you with (main/canvas.ts), its
// walkthrough read aloud in the orchestrator's own voice (TTMI's voice,
// made on this machine). What it drew and this window has not laid out yet
// is merged in, in order, keeping where you put things; the walkthrough
// then plays from the step it asked you to hear. The board saves itself
// (600 ms after a change, your moves as much as a merge), and each save
// says which drawings it has.
//
// A box linked to a pull request is that pull request's canvas: its
// worker's drawing of the change inside it (shared/pullRequestCanvas.ts),
// to dive into and play, under a badge with where it stands, from Flock's
// own facts, so it is current without a redraw.
import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ArrowLeft, Sparkles, Square, Volume2, VolumeX } from "lucide-react";
import { COLORS, firstStep, ON_COLORS, SketchBoard, stepTitle, type SketchApi } from "@ttmi/board";
import { parseSketch, sketchTitle, stepParts, textMeasure, type Shape, type SketchGroup, type SketchStep } from "@ttmi/format";
import { DEFAULT_VOICE, pausedClip, pausePlayback, resumePlayback, speakStep, stepLoads, stopPlayback, useNarration, useVoiceStatus, voice, type Preparation } from "ttmi-voice";
import { asksToHear, grantVoice, guardVoice, revokeVoice, voiceAllowed } from "./voiceGate";
import { setCanvasFocus } from "./canvasStep";
import { newSteps, stepWords, withHeard } from "../shared/canvasHeard";
import { CanvasSkeleton } from "./canvasSkeleton";
import type { Canvas, CanvasAsk, CanvasBoard } from "../shared/canvas";
import { canvasesToLinks, linksToCanvases, pullBadge, pullCanvasId, pullStanding, type CanvasPullRequest, type PullRequestDrawing } from "../shared/pullRequestCanvas";
import type { CanvasAsk as Ask } from "../shared/canvas";

const MUTED_KEY = "flock.voiceMuted";

const remember = (key: string, value: string) => {
  try { window.localStorage.setItem(key, value); } catch { /* not kept */ }
};

// voice: the agent's own (chosen when it was made); one made before has
// TTMI's default.
// A worker's drawing, laid out the way TTMI lays out a canvas it has not
// opened: by its text, with its own measure. The same text, the same layout.
type Laid = { shapes: Shape[]; steps: SketchStep[]; groups: SketchGroup[] };
const laidOut = new Map<string, Laid | undefined>();
function layOut(source: string): Laid | undefined {
  if (!laidOut.has(source)) {
    try {
      const parsed = parseSketch(source, textMeasure(), []);
      laidOut.set(source, { shapes: parsed.shapes, steps: parsed.steps, groups: parsed.groups });
    } catch {
      laidOut.set(source, undefined);
    }
  }
  return laidOut.get(source);
}

const TONES: Record<string, { color: string; on: string }> = {
  orange: { color: COLORS.orange, on: ON_COLORS.orange },
  violet: { color: COLORS.violet, on: ON_COLORS.violet },
  green: { color: COLORS.green, on: ON_COLORS.green },
  red: { color: COLORS.red, on: ON_COLORS.red },
  yellow: { color: COLORS.yellow, on: ON_COLORS.yellow },
  blue: { color: COLORS.blue, on: ON_COLORS.blue },
  muted: { color: "var(--border-strong)", on: "var(--fg)" },
};

// activity: what the agent is doing now, as the chat's working row says it
// (the tool in use, and what it runs).
// onOpenPull: Flock's pull request panel, from a pull request's badge.
// working: its session is at work (a message waiting for it counts).
type CanvasProps = { agentId: string; name: string; voice?: string; pullRequests?: CanvasPullRequest[]; activity?: { label: string; tool?: string }; working?: boolean; onOpenPull?(url: string): void;
  // Writes a message the way the chat does (markdown): the ask's question and
  // its answer. Given by the page, which owns the chat's markdown.
  renderText?(text: string): React.ReactNode;
  // The agent's avatar, at work or not, for the ask's dock.
  avatar?(working: boolean): React.ReactNode;
  // Who is at work now, with its latest line: the agent while it works,
  // else the worker that did something last (main.tsx, liveRows).
  live?: LiveRow[] };

// more: how many others are at work too.
export type LiveRow = { id: string; name: string; avatar: React.ReactNode; line: string; detail?: string; more?: number };

// The canvases you have looked at stay drawn, each in its own element, so
// coming back to an agent shows its canvas at once, as you left it. The slot
// in the agent's view takes the agent's element; one not shown is silent and
// paused, and still merges what its orchestrator draws. The least recently
// shown go past KEEP.
const KEEP = 8;
type Kept = { element: HTMLDivElement; root: Root; shownAt: number; shown: boolean };
const kept = new Map<string, Kept>();

// The step bar's previous step button (TTMI's, by its title).
const PREVIOUS_STEP = ".sketch-steps button[title^='Previous step']";

// The board moves its camera on every wheel turn over it (a listener on its
// root, which calls preventDefault). Over the ask's thread the wheel is the
// thread's: it scrolls the bubble, and never reaches the board.
const wheelKept = new WeakSet<Element>();
function keepWheel(node: HTMLElement | null) {
  if (!node || wheelKept.has(node)) return;
  wheelKept.add(node);
  node.addEventListener("wheel", (event) => event.stopPropagation(), { passive: true });
}

export function CanvasSlot(props: CanvasProps) {
  const slot = useRef<HTMLDivElement>(null);
  const { agentId } = props;
  const latest = useRef(props);
  latest.current = props;
  const draw = (active: boolean) => kept.get(agentId)?.root.render(<AgentCanvas {...latest.current} active={active} />);
  useLayoutEffect(() => {
    let host = kept.get(agentId);
    if (!host) {
      const element = document.createElement("div");
      element.className = "agent-canvas-host";
      host = { element, root: createRoot(element), shownAt: 0, shown: false };
      kept.set(agentId, host);
      const idle = [...kept.entries()].filter(([, item]) => !item.shown && item !== host).sort((a, b) => a[1].shownAt - b[1].shownAt);
      for (const [id, item] of idle.slice(0, Math.max(0, kept.size - KEEP))) {
        item.root.unmount();
        kept.delete(id);
      }
    }
    host.shown = true;
    host.shownAt = Date.now();
    slot.current?.appendChild(host.element);
    draw(true);
    const shown = host;
    return () => {
      shown.shown = false;
      shown.element.remove();
      draw(false);
    };
  }, [agentId]);
  // New names, voice or pull request states reach the canvas shown.
  const pulls = JSON.stringify(props.pullRequests ?? []);
  useEffect(() => draw(true), [props.name, props.voice, pulls, JSON.stringify(props.activity), props.working, JSON.stringify((props.live ?? []).map((row) => [row.id, row.line, row.detail, row.more]))]);
  // Under the kept canvas, the skeleton: until the canvas has drawn itself
  // (its element is filled a frame after it is put here), the slot is never
  // empty.
  return <div ref={slot} className="agent-canvas-slot"><CanvasSkeleton /></div>;
}

// pullRequests: its workers' pull requests, as Flock follows them. active:
// shown; one kept while another agent is shown is silent and paused.
// The pull requests a canvas has known, as it last knew them: a worker is
// removed once its pull requests are merged or closed, and its merged ones
// stay on the canvas, merged (violet), not unknown. Kept per orchestrator.
function useKnownPulls(agentId: string, current: CanvasPullRequest[]): CanvasPullRequest[] {
  const key = `flock.canvasPulls.${agentId}`;
  return useMemo(() => {
    let known: Record<string, CanvasPullRequest> = {};
    try { known = JSON.parse(window.localStorage.getItem(key) ?? "{}") as Record<string, CanvasPullRequest>; } catch { /* none kept */ }
    // What it knows now wins; one no longer followed is not being worked on.
    const all: Record<string, CanvasPullRequest> = Object.fromEntries(Object.entries(known).map(([url, pull]) => [url, { ...pull, working: false }]));
    for (const pull of current) all[pull.url] = pull;
    try { window.localStorage.setItem(key, JSON.stringify(all)); } catch { /* not kept */ }
    return Object.values(all);
  }, [key, JSON.stringify(current)]);
}

export function AgentCanvas({ agentId, name, voice: agentVoice, pullRequests: followed = [], activity, working = false, onOpenPull, renderText = (text) => <p>{text}</p>, avatar = () => null, live = [], active = true }: CanvasProps & { active?: boolean }) {
  const pullRequests = useKnownPulls(agentId, followed);
  const [loaded, setLoaded] = useState<Canvas>();
  const [title, setTitle] = useState<string>();
  const [error, setError] = useState<string>();
  const [empty, setEmpty] = useState(false);
  const [dark, setDark] = useState(() => window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false);
  // What is on the board, for what its walkthrough says.
  const [drawn, setDrawn] = useState<CanvasBoard>({ shapes: [], steps: [], groups: [], terms: [] });
  const api = useRef<SketchApi>(undefined);
  // The newest drawing the board has; what is newer is still to merge.
  const applied = useRef(0);
  // The board as last saved, for marking a drawing done that changed nothing.
  const saved = useRef<CanvasBoard>(undefined);
  const merging = useRef(false);
  // The shapes before a merge, the names it changed, and when it last came.
  const beforeMerge = useRef<Shape[]>(undefined);
  const [changed, setChanged] = useState<ChangedShape[]>([]);
  const [updatedAt, setUpdatedAt] = useState<number>();
  const again = useRef(false);
  // Its asks (what you wrote while it was shown), and the newest drawing the
  // board has, as state: an answer is said once its drawing is in.
  const [asks, setAsks] = useState<CanvasAsk[]>([]);
  // Closes the asks still waiting on a canvas (by its agent id, or a pull
  // request's link) that were made before `before`, quietly.
  function closeWaiting(canvasId: string, list: CanvasAsk[], before: number) {
    const ids = new Set(list.filter((item) => item.status === "waiting" && item.at < before).map((item) => item.id));
    if (!ids.size) return;
    const done = (all: CanvasAsk[]) => all.map((item) => ids.has(item.id) ? { ...item, status: "done" as const } : item);
    if (canvasId === agentId) setAsks(done);
    else setPullDrawings((all) => all[canvasId] ? { ...all, [canvasId]: { ...all[canvasId]!, asks: done(all[canvasId]!.asks ?? []) } } : all);
    for (const id of ids) void window.dispatch.closeCanvasAsk(canvasId, id);
  }
  // The words of the steps you have heard (main/canvas.ts keeps them).
  const [heardWords, setHeardWords] = useState<string[]>([]);
  const [appliedShown, setAppliedShown] = useState(0);

  // Pull requests' canvases: each one's drawing, and the ids the board knows
  // them by (to turn back into links in the text the orchestrator reads).
  const [pullDrawings, setPullDrawings] = useState<Record<string, PullRequestDrawing>>({});
  const ids = useRef(new Map<string, string>());
  // Canvas ids Flock gave a box written as "#N", taken off again in the text
  // the orchestrator reads.
  const added = useRef(new Set<string>());
  useEffect(() => {
    let live = true;
    const load = () => void window.dispatch.getPullDrawings().then((drawings) => { if (live) setPullDrawings(drawings); });
    load();
    const stop = window.dispatch.onPullDrawingsUpdated(load);
    return () => { live = false; stop(); };
  }, []);
  const pullsByUrl = useMemo(() => new Map(pullRequests.map((pull) => [pull.url, pull])), [pullRequests]);
  const numbers = useMemo(() => new Map(pullRequests.map((pull) => [pull.number, pull.url])), [pullRequests]);
  const portals = useMemo(() => {
    const cards: Record<string, { status: "open"; title: string; shapes: Shape[]; steps: SketchStep[]; groups: SketchGroup[] }> = {};
    for (const url of new Set([...pullsByUrl.keys(), ...Object.keys(pullDrawings), ...ids.current.values()])) {
      const id = pullCanvasId(url);
      if (!id) continue;
      ids.current.set(id, url);
      const drawing = pullDrawings[url] ? layOut(pullDrawings[url].source) : undefined;
      cards[id] = { status: "open", title: pullBadge(url), shapes: drawing?.shapes ?? [], steps: drawing?.steps ?? [], groups: drawing?.groups ?? [] };
    }
    return cards;
  }, [pullsByUrl, pullDrawings]);
  // Where each stands, as its badge's and frame's colour (yellow while its
  // worker is at it).
  const tones = useMemo(() => Object.entries(portals).map(([id]) => {
    const pull = pullsByUrl.get(ids.current.get(id) ?? "");
    const standing = pullStanding(pull, pull?.working);
    const tone = TONES[standing.tone]!;
    const box = `.agent-canvas .sketch-rect[data-link="${id}"]`;
    // Its review, a pill on the frame's other corner.
    const review = pull?.review ? TONES[pull.review.tone]! : undefined;
    const ink = pull?.review?.tone === "muted" ? "var(--fg-2)" : review?.on;
    const reviewPill = pull?.review && review ? `${box}::after { content: ${JSON.stringify(pull.review.label || "\u00a0")}; border-color: ${review.color}; background: ${pull.review.tone === "muted" ? "var(--surface-3)" : review.color}; color: ${ink}; ${pull.review.label ? "" : "padding-left: 4px; padding-right: 21px;"} } ${box}::before { content: ""; background: ${ink}; ${pull.review.running ? "animation: agent-review-running 1.2s ease-in-out infinite;" : ""} }` : "";
    return `${box} { border-color: ${tone.color} !important; } ${box} > .sketch-tag { border-color: ${tone.color} !important; background: ${tone.color} !important; color: ${tone.on} !important; } ${reviewPill}`;
  }).join("\n"), [portals, pullsByUrl]);

  // The canvas the board shows: its own (null), or a pull request's it dove
  // into. Inside one, nothing is saved and new drawings wait for the way back.
  const [hosted, setHosted] = useState<string | null>(null);
  const hostedRef = useRef<string | null>(null);
  const focused = hosted ? portals[hosted] : undefined;
  // Inside a pull request's canvas: its link, its worker and its asks.
  const hostedUrl = hosted ? ids.current.get(hosted) : undefined;
  const hostedWorker = hostedUrl ? pullDrawings[hostedUrl]?.worker ?? pullsByUrl.get(hostedUrl)?.worker : undefined;
  const shownAsks: Ask[] = hostedUrl ? pullDrawings[hostedUrl]?.asks ?? [] : asks;

  // The voice: this agent's, muted for every agent with one switch.
  const voiceName = agentVoice || DEFAULT_VOICE;
  const [muted, setMuted] = useState(() => {
    try { return window.localStorage.getItem(MUTED_KEY) === "true"; } catch { return false; }
  });
  const [playing, setPlaying] = useState<number>();
  // Where the walkthrough is, and whether an ask is on show, for going back.
  const backRef = useRef<{ playing?: number; asking: boolean }>({ asking: false });
  // A pause the board told of: the voice waits (TTMI's hold), and a paused
  // clip resumes where it was.
  const holdVoice = useRef(false);
  useEffect(() => guardVoice(), []);
  // What the narration asks when it would speak a step (voiceGate.ts): it
  // speaks only if the voice is open (you asked), the board did not pause,
  // and the board's walkthrough is playing. A step whose voice was said
  // rests "done", not paused, and a merging drawing rebuilds the panel (no
  // state at all): neither is playing, so neither is spoken again.
  const voiceHold = useMemo(() => ({
    get current() {
      const beat = host.current?.querySelector(".sketch-steps:not(.sketch-steps-ask)")?.getAttribute("data-playback");
      return !voiceAllowed() || holdVoice.current || beat !== "playing";
    },
    set current(value: boolean) {
      holdVoice.current = value;
    },
  }), []);
  const [voiceKick, setVoiceKick] = useState(0);
  const said = focused ?? drawn;
  // A step (from 1, as the step bar counts) as the board names it.
  const titleOf = (at: number | undefined) => {
    const first = firstStep(said.steps);
    const index = at === undefined ? -1 : at - 1 + first;
    return index >= first && index < said.steps.length ? stepTitle(said.steps, index, first) : undefined;
  };
  const spoken = useMemo(() => ({ parts: stepParts(said.shapes, said.steps, said.groups), loads: stepLoads(said.shapes, said.steps, said.groups) }), [said]);
  // While an ask is open the walkthrough's own voice is still: an answer
  // that changes the step's words does not start it.
  const asking = shownAsks.some((item) => item.status !== "done");
  // What is new on its own canvas: steps whose words you have not heard. A
  // step is heard when its voice ends, or when you go on past it.
  const words = useMemo(() => drawn.steps.map((step) => stepWords(step.narration)), [drawn]);
  const fresh = useMemo(() => newSteps(words, heardWords), [words, heardWords]);
  const hear = (step: number | undefined) => {
    if (hostedRef.current || step === undefined) return;
    const text = words[step];
    if (!text || heardWords.includes(text)) return;
    setHeardWords((list) => withHeard(list, [text]));
    void window.dispatch.markCanvasHeard(agentId, [text]);
  };
  // A canvas switch reported, its first press not yet seen.
  const hostSwitch = useRef(false);
  const hearRef = useRef(hear);
  hearRef.current = hear;
  // Without a voice (muted, or none here), a step is heard once it has been
  // on, playing, about as long as its words take to say (2 s at least).
  const [paused, setPaused] = useState(false);
  // One narration at a time: only the canvas on show has one (the voice's
  // player is one for the window, and a hidden canvas's would reach it).
  const narration = useNarration({ ...spoken, playing, sketchId: hosted ? `${agentId}/${hosted}` : agentId, voiceName, muted: muted || asking, enabled: active, hold: voiceHold, kick: voiceKick, onEnded: (step) => hearRef.current(step) });
  // The voice is made on this machine: its model comes once (44 MB), the
  // first time a canvas is open with the voice on.
  const voiceState = narration.status.state;
  // The engine's own status, as it changes (the narration's stands in as
  // unsupported while it is muted, as during an ask).
  const engine = useVoiceStatus(!muted, voiceName);
  useEffect(() => {
    if (!muted && voiceState === "absent") voice().install();
    // Installed before (the onboarding, or another canvas): loaded now, so
    // an answer can be played without waiting for a walkthrough to ask.
    if (!muted && engine.state === "installed") voice().load();
  }, [muted, voiceState, engine.state]);
  // Out of view: its voice stops, and its walkthrough waits on the step it
  // was on, for when you come back.
  const playingRef = useRef(playing);
  playingRef.current = playing;
  const saidRef = useRef(said);
  saidRef.current = said;
  useEffect(() => {
    if (active) return;
    const at = playingRef.current;
    if (at === undefined) return;
    pausePlayback();
    api.current?.openAt(at - firstStep(saidRef.current.steps) + 1);
  }, [active]);
  // Until the board has drawn its first picture: the skeleton.
  const [drawnIn, setDrawnIn] = useState(false);

  useEffect(() => {
    const query = window.matchMedia?.("(prefers-color-scheme: dark)");
    const change = () => setDark(Boolean(query?.matches));
    query?.addEventListener("change", change);
    return () => query?.removeEventListener("change", change);
  }, []);

  useEffect(() => {
    let live = true;
    setLoaded(undefined);
    void window.dispatch.getCanvas(agentId).then((canvas) => {
      if (!live) return;
      applied.current = canvas.applied;
      setAppliedShown(canvas.applied);
      setAsks(canvas.asks ?? []);
      setHeardWords(canvas.heard ?? []);
      saved.current = canvas.board;
      if (canvas.board) setDrawn(canvas.board);
      setTitle(sketchTitle(canvas.boardText ?? canvas.pending.at(-1)?.source ?? "") ?? undefined);
      setEmpty(!canvas.board?.shapes.length && !canvas.pending.length);
      setLoaded(canvas);
    });
    return () => { live = false; };
  }, [agentId]);

  const save = (board: CanvasBoard) => {
    if (hostedRef.current) return;
    // The first save after a merge: what that drawing changed, ringed on
    // the board until you play the walkthrough.
    if (beforeMerge.current) {
      const names = changedShapes(beforeMerge.current, board.shapes);
      beforeMerge.current = undefined;
      if (names.length) setChanged(names);
    }
    saved.current = board;
    setDrawn(board);
    void window.dispatch.saveCanvas(agentId, board, canvasesToLinks(api.current?.toSketch() ?? "", ids.current, added.current), applied.current);
  };

  // Merges what the orchestrator drew since, oldest first; a drawing that
  // arrives meanwhile is merged right after.
  async function mergePending() {
    const board = api.current;
    if (!board) return;
    // Inside a pull request, or not shown (its element is off the page, where
    // text measures nothing: a note would fold to nothing): merged later.
    if (hostedRef.current || !activeRef.current) {
      again.current = true;
      void window.dispatch.getCanvas(agentId).then((canvas) => setAsks(canvas.asks ?? []));
      return;
    }
    if (merging.current) {
      again.current = true;
      return;
    }
    merging.current = true;
    try {
      do {
        again.current = false;
        const canvas = await window.dispatch.getCanvas(agentId);
        setAsks(canvas.asks ?? []);
        setHeardWords(canvas.heard ?? []);
        const todo = canvas.pending.filter((item) => item.version > applied.current);
        if (!todo.length) continue;
        let playFrom: number | undefined;
        // A drawing merging is not you asking to hear it; one that comes
        // while you are playing the walkthrough leaves it playing.
        if (host.current?.querySelector(".sketch-steps:not(.sketch-steps-ask)")?.getAttribute("data-playback") !== "playing") revokeVoice();
        // What the board had before: compared with what it has after.
        beforeMerge.current ??= saved.current?.shapes ?? [];
        for (const item of todo) {
          const result = await board.import(linksToCanvases(item.source, ids.current, numbersRef.current, added.current), false);
          setError(result.error);
          applied.current = item.version;
          const named = sketchTitle(item.source);
          if (named) setTitle(named);
          // An answer resumes when they continue past its summary.
          if (item.playFrom && !item.ask) playFrom = item.playFrom;
          // A drawing that answers no ask is the response to the asks still
          // waiting from before it: they close (an answer already there
          // stays until you go past it).
          if (!item.ask) closeWaiting(agentId, canvas.asks ?? [], item.at);
        }
        setEmpty(false);
        await board.settled();
        setAppliedShown(applied.current);
        setUpdatedAt(Date.now());
        // The board saves the merge itself; a drawing that changed nothing
        // gives no save, so this one marks it done.
        setTimeout(() => save(saved.current ?? { shapes: [], steps: [], groups: [], terms: [] }), 900);
        // Nothing plays by itself: the walkthrough waits on the step they
        // should hear, for them to press play.
        if (playFrom) board.openAt(playFrom);
      } while (again.current);
    } finally {
      merging.current = false;
    }
  }
  const numbersRef = useRef(numbers);
  numbersRef.current = numbers;
  const activeRef = useRef(active);
  activeRef.current = active;
  // Shown again: what was drawn meanwhile is merged now, on the page.
  useEffect(() => {
    if (active) void mergeRef.current();
    // Another agent shown: this one is silent, and nothing it armed sounds.
    else revokeVoice();
  }, [active]);
  const mergeRef = useRef(mergePending);
  mergeRef.current = mergePending;

  // Always in the walkthrough: there is no other mode. Whenever its panel
  // is gone (the board opened, it was stopped, a drawing came with no
  // walkthrough before), it is opened again, ready to play.
  const host = useRef<HTMLDivElement>(null);
  // Whether the board shows its walkthrough panel now: while it does not
  // (a zoom into a pull request's canvas, nothing drawn yet), a placeholder
  // holds its place on the message box.
  const [hasPanel, setHasPanel] = useState(false);
  useEffect(() => {
    const node = host.current;
    if (!node) return;
    // A zoom into or out of a pull request's canvas has no panel for a
    // moment: it is reopened only once it has been gone a while.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const keep = () => {
      setHasPanel(Boolean(node.querySelector(".sketch-steps")));
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        const board = api.current;
        if (!board || node.querySelector(".sketch-steps")) return;
        const steps = hostedRef.current ? portals[hostedRef.current]?.steps : saved.current?.steps;
        if (!steps?.length) return;
        board.play();
      }, 700);
    };
    const watcher = new MutationObserver(keep);
    watcher.observe(node, { childList: true, subtree: true });
    keep();
    return () => {
      watcher.disconnect();
      if (timer) clearTimeout(timer);
    };
  }, [loaded, portals]);

  useEffect(() => window.dispatch.onCanvasUpdated((update) => {
    if (update.agentId === agentId) void mergeRef.current();
  }), [agentId]);

  // Where it is, for the message box: what you write is an ask on that
  // step, to the orchestrator, or inside a pull request to its worker.
  useEffect(() => {
    const step = playing === undefined ? undefined : playing - firstStep(said.steps) + 1;
    const shown = shownAsks.find((item) => item.status !== "done");
    const phase = shown?.status;
    // While an ask is on show the walkthrough stands still: a follow-up is
    // about the step that ask was on.
    const at = step ?? shown?.step;
    const title = titleOf(at);
    setCanvasFocus(agentId, { ...(at ? { step: at, ...(title ? { title } : {}) } : {}), ...(hostedUrl && hostedWorker ? { pull: { url: hostedUrl, worker: hostedWorker } } : {}), ...(phase === "waiting" || phase === "answered" ? { ask: phase } : {}) });
  }, [agentId, playing, said, hostedUrl, hostedWorker, shownAsks]);

  // A pull request's canvas drawn again while you are inside it: the board
  // shows the new drawing in place (TTMI's board follows the canvas it is
  // in), on the same step.

  // The ask on screen: the oldest not yet done. Waiting, it shows your
  // question; answered (and its drawing in), the summary, said aloud, and
  // Continue resumes the walkthrough where the answer says.
  const open = shownAsks.find((item) => item.status !== "done");
  // A pull request's drawing is laid out from its text: there is nothing to
  // wait for.
  const answered = open?.status === "answered" && (hostedUrl ? true : (open.version ?? 0) <= appliedShown);
  // Nothing is said by itself: Space (or Enter, or the button) reads the
  // answer aloud; Esc goes back to the walkthrough, paused.
  const stopSummary = useRef<() => void>(undefined);
  const canSpeak = !muted && engine.state === "ready";
  const finishAsk = (resume: boolean) => {
    if (!open) return;
    stopSummary.current?.();
    stopSummary.current = undefined;
    const done = (list: Ask[]) => list.map((item) => item.id === open.id ? { ...item, status: "done" as const } : item);
    if (hostedUrl) setPullDrawings((all) => all[hostedUrl] ? { ...all, [hostedUrl]: { ...all[hostedUrl]!, asks: done(all[hostedUrl]!.asks ?? []) } } : all);
    else setAsks(done);
    void window.dispatch.closeCanvasAsk(hostedUrl ?? agentId, open.id);
    setAnswerSounding(false);
    // Another ask still open shows next. After the last of them the
    // walkthrough is back, paused on the step the answer names (or the one
    // asked on): nothing plays until you press Space. The voice closes
    // first, so opening the step does not sound it (voiceGate.ts).
    const more = shownAsks.some((item) => item.id !== open.id && item.status !== "done");
    const at = open.resumeStep ?? open.step;
    if (resume && !more && at) {
      revokeVoice();
      api.current?.openAt(at);
    }
  };
  // Esc leaves the ask, back to the walkthrough, wherever the focus is (the
  // board takes it only when it has the focus, and you are often in the
  // reply field). Not when the board took it already, or a menu is open.
  backRef.current = { playing, asking: Boolean(open) };
  const finishRef = useRef(finishAsk);
  finishRef.current = finishAsk;
  useEffect(() => {
    if (!active || !open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      if (document.querySelector("[role='dialog'][data-state='open'], [role='menu'][data-state='open'], [role='listbox'][data-state='open']")) return;
      event.preventDefault();
      finishRef.current(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, open?.id]);
  // An ask its agent's turn ended without answering (with draw) closes
  // quietly: what it drew is marked new, and nothing it wrote is shown.
  // Once the agent has been at work on it, a few seconds after it stops.
  const answering = hostedUrl ? Boolean(pullsByUrl.get(hostedUrl)?.working) : working;
  const workedOn = useRef<string>(undefined);
  useEffect(() => {
    if (!open || open.status !== "waiting") return;
    if (answering) {
      workedOn.current = open.id;
      return;
    }
    if (workedOn.current !== open.id) return;
    const timer = setTimeout(() => finishAsk(false), 4000);
    return () => clearTimeout(timer);
  }, [open?.id, open?.status, answering]);
  const waitRow = hostedWorker ? { label: `${hostedWorker} · Working…` } : activity ?? { label: "Working…" };
  useEffect(() => {
    if (playing === undefined || paused || hosted || (!muted && narration.on)) return;
    const text = words[playing];
    if (!text) return;
    const step = playing;
    const timer = setTimeout(() => hearRef.current(step), Math.max(2000, text.split(" ").length * 300));
    return () => clearTimeout(timer);
  }, [playing, paused, hosted, muted, narration.on, words]);
  // A pull request's drawing drawn again by its worker, answering no ask:
  // the asks on it still waiting from before close, as on the orchestrator's.
  const pullDrawn = useRef(new Map<string, number>());
  useEffect(() => {
    for (const [url, drawing] of Object.entries(pullDrawings)) {
      const was = pullDrawn.current.get(url);
      pullDrawn.current.set(url, drawing.at);
      if (was === undefined || drawing.at === was) continue;
      closeWaiting(url, drawing.asks ?? [], drawing.at);
    }
  }, [pullDrawings]);
  // A new ask made while an answer is still on show counts as having heard
  // that answer: the answers there are when it is made close, and the new
  // ask shows. One still waiting keeps its place (its answer shows later).
  // (Per canvas: asks are numbered on each, and going into a pull request
  // shows another list, which is not a new ask.)
  const newestAsk = useRef<{ canvas: string; id?: string }>(undefined);
  useEffect(() => {
    const opened = shownAsks.filter((item) => item.status !== "done");
    const newest = opened.at(-1);
    const canvas = hostedUrl ?? agentId;
    const was = newestAsk.current;
    newestAsk.current = { canvas, id: newest?.id };
    if (!newest || !was || was.canvas !== canvas || was.id === undefined || newest.id === was.id || newest.status !== "waiting") return;
    const heard = opened.filter((item) => item.id !== newest.id && item.status === "answered");
    if (!heard.length) return;
    stopSummary.current?.();
    stopSummary.current = undefined;
    const ids = new Set(heard.map((item) => item.id));
    const done = (list: Ask[]) => list.map((item) => ids.has(item.id) ? { ...item, status: "done" as const } : item);
    if (hostedUrl) setPullDrawings((all) => all[hostedUrl] ? { ...all, [hostedUrl]: { ...all[hostedUrl]!, asks: done(all[hostedUrl]!.asks ?? []) } } : all);
    else setAsks(done);
    for (const id of ids) void window.dispatch.closeCanvasAsk(hostedUrl ?? agentId, id);
  }, [shownAsks]);
  // The answer, said in the agent's voice: Space (or Listen) plays it, and
  // stops it while it sounds. Nothing else happens: Esc goes back.
  const [answerSounding, setAnswerSounding] = useState(false);
  const toggleAnswer = () => {
    if (!open?.summary || !answered) return;
    if (answerSounding) {
      stopSummary.current?.();
      stopSummary.current = undefined;
      setAnswerSounding(false);
      return;
    }
    if (!canSpeak) return;
    grantVoice();
    pausePlayback();
    const text = open.summary;
    const done = () => { stopSummary.current?.(); stopSummary.current = undefined; setAnswerSounding(false); };
    setAnswerSounding(true);
    stopSummary.current = speakStep(voice().clip({ segments: [{ text }] }, voiceName, true, agentId), text, {
      speaking() {}, needsGesture() {}, pointing() {}, heard() {},
      ended: done,
      failed: done,
    });
  };
  const askPanel = open ? {
    phase: answered ? "summary" as const : "waiting" as const,
    question: open.question,
    copied: false,
    ...(answered && open.summary ? { summary: open.summary } : {}),
    onQuestion: () => undefined,
    onCopy: () => undefined,
    onCancel: () => finishAsk(true),
    onClose: () => finishAsk(true),
    onContinue: toggleAnswer,
    view: (
      <AskDock
        key={open.id}
        question={open.question}
        step={open.step}
        stepName={titleOf(open.step)}
        resumeName={titleOf(open.resumeStep ?? open.step)}
        who={hostedWorker ?? name}
        where={hostedUrl ? `#${hostedUrl.split("/").pop()}` : undefined}
        answer={answered ? open.summary : undefined}
        resumeStep={open.resumeStep ?? open.step}
        activity={waitRow}
        avatar={avatar}
        renderText={renderText}
        canListen={canSpeak}
        sounding={answerSounding}
        onListen={toggleAnswer}
      />
    ),
  } : undefined;

  const toggleMuted = () => {
    setMuted((was) => {
      remember(MUTED_KEY, String(!was));
      if (!was) pausePlayback();
      return !was;
    });
  };

  // Into a pull request's canvas: its walkthrough plays. One with no
  // drawing yet opens on GitHub.
  // The names of the boxes that are pull requests' canvases, with their ids:
  // a word naming one opens it.
  const canvasNamed = useRef(new Map<string, string>());
  canvasNamed.current = new Map((hosted ? [] : drawn.shapes).flatMap((shape) => shape.kind === "rect" && shape.name && shape.link && portals[shape.link] ? [[shape.name, shape.link] as const] : []));
  const openPullRef = useRef<(id: string) => void>(() => undefined);
  const openPull = (id: string) => {
    const card = portals[id];
    if (card?.shapes.length) api.current?.setPortalFocus(id);
    else {
      const url = ids.current.get(id);
      if (url) void window.dispatch.openExternal(url);
    }
  };
  openPullRef.current = openPull;
  const back = () => api.current?.setPortalFocus(null);
  // New steps, marked on the step bar; the ready line says how many; Play
  // (or Space) there starts at the first of them.
  const first = firstStep(drawn.steps);
  const freshShown = hosted ? [] : fresh.filter((index) => index >= first);
  const freshMarks = freshShown.map((index) => `.agent-canvas .sketch-step-progress > span:nth-child(${index - first + 1})`).join(", ");
  const freshRef = useRef(freshShown);
  freshRef.current = freshShown;
  // Playing the walkthrough is looking at what changed: the rings go.
  // Playing: the walkthrough moving (a step opened paused, as a drawing's
  // play_from opens it, is not playing yet).
  const isPlaying = playing !== undefined && !paused;
  useEffect(() => {
    if (isPlaying && changed.length) setChanged([]);
  }, [isPlaying]);
  // The dock's first line: who is at work and on what, else what is new for
  // you, else whose canvas this is (DockHeader).
  const news = !hosted && freshShown.length > 0 ? { steps: freshShown.length, updated: Boolean(updatedAt) } : undefined;
  const dockHeader = <DockHeader name={name} avatar={avatar} live={live} news={news} hosted={hostedWorker} />;
  const playNew = () => {
    const start = freshRef.current[0];
    if (start === undefined) return;
    grantVoice();
    api.current?.playFrom(start - firstStep(saidRef.current.steps) + 1);
  };
  useEffect(() => {
    const node = host.current;
    if (!node) return;
    const fromNew = (event: Event) => {
      const start = freshRef.current[0];
      if (start === undefined || !node.querySelector(".sketch-steps-ready")) return;
      // Space or Enter (the board plays on both), not a held one.
      if (event instanceof KeyboardEvent && ((event.key !== " " && event.key !== "Enter") || event.repeat || (event.target as Element).closest("textarea, input"))) return;
      if (event instanceof MouseEvent && !(event.target as Element).closest(".sketch-start")) return;
      event.preventDefault();
      event.stopPropagation();
      api.current?.playFrom(start - firstStep(saidRef.current.steps) + 1);
    };
    node.addEventListener("click", fromNew, true);
    node.addEventListener("keydown", fromNew, true);
    return () => {
      node.removeEventListener("click", fromNew, true);
      node.removeEventListener("keydown", fromNew, true);
    };
  }, [loaded]);
  // A pull request's badge opens Flock's pull request panel; the rest of its
  // frame zooms in. The board's button covers the whole frame, so the click
  // is taken on its way down, where it lands on the badge.
  const onOpenPullRef = useRef(onOpenPull);
  onOpenPullRef.current = onOpenPull;
  useEffect(() => {
    const node = host.current;
    if (!node) return;
    const onBadge = (event: MouseEvent) => {
      for (const badge of node.querySelectorAll<HTMLElement>(".sketch-portal > .sketch-tag")) {
        const box = badge.getBoundingClientRect();
        if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) continue;
        const url = ids.current.get(badge.parentElement?.getAttribute("data-link") ?? "");
        if (!url || !onOpenPullRef.current) return;
        event.preventDefault();
        event.stopPropagation();
        onOpenPullRef.current(url);
        return;
      }
    };
    node.addEventListener("click", onBadge, true);
    const grant = (event: Event) => {
      if (asksToHear(event)) grantVoice();
    };
    // An Enter held down repeats. Sending from the message box moves the
    // focus onto the board while the key is still down, and its repeats
    // then reach the board: they started the walkthrough, or pressed an
    // answer's Listen. The board's Enter is a press, never a held key.
    const heldEnter = (event: KeyboardEvent) => {
      if (event.key !== "Enter" || !event.repeat) return;
      event.preventDefault();
      event.stopPropagation();
    };
    // In the walkthrough Enter does what Space does (play, pause, go on):
    // the board takes only Space there, and Enter only on its start.
    const enterPlays = (event: KeyboardEvent) => {
      if (event.key !== "Enter" || event.repeat || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
      if (backRef.current.playing === undefined || backRef.current.asking) return;
      const target = event.target as Element | null;
      if (!target || target.closest("textarea, input, [contenteditable='true'], button")) return;
      event.preventDefault();
      event.stopPropagation();
      grantVoice();
      target.dispatchEvent(new KeyboardEvent("keydown", { key: " ", code: "Space", bubbles: true, cancelable: true }));
    };
    // C goes to the message box, where you ask (the board's own C opens an
    // ask of its own, which Flock does not use). ↑ on its first line
    // comes back.
    const toPrompt = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== "c" || event.repeat || event.metaKey || event.ctrlKey || event.altKey) return;
      if ((event.target as Element | null)?.closest?.("textarea, input, [contenteditable='true']")) return;
      const field = document.querySelector<HTMLTextAreaElement>(".convo-box textarea");
      if (!field) return;
      event.preventDefault();
      event.stopPropagation();
      field.focus();
      field.setSelectionRange(field.value.length, field.value.length);
    };
    node.addEventListener("keydown", heldEnter, true);
    node.addEventListener("keydown", enterPlays, true);
    node.addEventListener("keydown", toPrompt, true);
    node.addEventListener("keydown", grant, true);
    node.addEventListener("pointerdown", grant, true);
    // Going back (← or the step bar's previous) opens the step before,
    // paused and silent: Space plays it. The board's own back plays it. The
    // voice closes first, so the press opening the step does not prime it.
    // From the first step the board's own back stands (to the start).
    const onBack = (event: Event) => {
      const at = backRef.current.playing;
      if (at === undefined || backRef.current.asking) return;
      if (event instanceof KeyboardEvent) {
        if (event.key !== "ArrowLeft" || event.metaKey || event.ctrlKey || event.altKey) return;
        if ((event.target as Element | null)?.closest?.("textarea, input, [contenteditable='true']")) return;
      } else if (!(event.target as Element | null)?.closest?.(PREVIOUS_STEP)) return;
      const first = firstStep(saidRef.current.steps);
      if (at <= first) return;
      event.preventDefault();
      event.stopPropagation();
      revokeVoice();
      api.current?.openAt(at - 1 - first + 1);
    };
    node.addEventListener("keydown", onBack, true);
    node.addEventListener("click", onBack, true);
    // A word in the narration that names a pull request's canvas zooms
    // into it, as its frame does.
    const onWord = (event: MouseEvent) => {
      const word = (event.target as Element).closest?.(".sketch-ref");
      const id = word ? canvasNamed.current.get(word.getAttribute("data-ref") ?? "") : undefined;
      if (!id) return;
      event.preventDefault();
      event.stopPropagation();
      openPullRef.current(id);
    };
    node.addEventListener("click", onWord, true);
    return () => {
      node.removeEventListener("click", onBadge, true);
      node.removeEventListener("keydown", heldEnter, true);
      node.removeEventListener("keydown", enterPlays, true);
      node.removeEventListener("keydown", toPrompt, true);
      node.removeEventListener("keydown", grant, true);
      node.removeEventListener("pointerdown", grant, true);
      node.removeEventListener("keydown", onBack, true);
      node.removeEventListener("click", onBack, true);
      node.removeEventListener("click", onWord, true);
    };
  }, [loaded]);

  if (!loaded) return <div className="agent-canvas"><CanvasSkeleton /></div>;
  // Notes a hidden canvas merged off the page have no size (a folded one
  // shows as an empty sliver): they get a note's width back, and the board's
  // own text is merged again on the page, which measures them.
  const unsized = (loaded.board?.shapes ?? []).some((shape) => shape.kind === "note" && (shape.w <= 2 || shape.h <= 0));
  const board = loaded.board && unsized
    ? { ...loaded.board, shapes: loaded.board.shapes.map((shape) => shape.kind === "note" && (shape.w <= 2 || shape.h <= 0) ? { ...shape, w: 420, h: 120, minWidth: undefined } : shape) }
    : loaded.board;
  const on = narration.on;
  return (
    <div
      ref={host}
      className={`agent-canvas ${dark ? "dark" : ""}`}
      style={{
      } as React.CSSProperties}
      // Enter does what Space does on an answer.
      onKeyDown={(event) => {
        if (event.key !== "Enter" || !answered || (event.target as Element).closest("textarea, input")) return;
        event.preventDefault();
        toggleAnswer();
      }}
    >
      {tones && <style>{tones}</style>}
      {canvasNamed.current.size > 0 && <style>{`${[...canvasNamed.current.keys()].map((name) => `.agent-canvas .sketch-ref[data-ref="${name}"]`).join(", ")} { cursor: pointer; }`}</style>}
      {!hosted && changed.length > 0 && <ChangeBadges host={host} changed={changed} />}
      {freshMarks && <style>{`${freshMarks} { box-shadow: inset 0 0 0 1.5px var(--board-accent); background-color: color-mix(in srgb, var(--board-accent) 30%, transparent); }`}</style>}
      <SketchBoard
        key={agentId}
        // Only the walkthrough: nothing on it is edited here.
        readOnly
        initial={board?.shapes ?? []}
        initialSteps={board?.steps ?? []}
        initialGroups={board?.groups ?? []}
        initialTerms={board?.terms ?? []}
        title={title}
        onApi={(next) => {
          api.current = next;
          if (!next) return;
          void mergeRef.current();
          if (unsized && loaded.boardText) void next.import(linksToCanvases(loaded.boardText, ids.current, numbersRef.current, added.current), false);
          // Gone once the board has placed its drawing (it is hidden while
          // it places it), a frame later: the drawing does not move under it.
          void next.settled().then(() => {
            const placed = (tries: number) => {
              if (tries > 0 && host.current?.querySelector(".sketch-placing")) {
                requestAnimationFrame(() => placed(tries - 1));
                return;
              }
              requestAnimationFrame(() => requestAnimationFrame(() => setDrawnIn(true)));
            };
            placed(120);
          });
        }}
        onSave={(shapes, steps, groups, terms) => save({ shapes, steps, groups, terms })}
        portals={portals}
        panelHeader={dockHeader}
        {...(news && !isPlaying ? { startLabel: "Play what's new" } : {})}
        {...(askPanel ? { ask: askPanel } : {})}
        onOpenLink={openPull}
        onHost={(id) => {
          const next = id && portals[id] ? id : null;
          // Into or out of a canvas: what the last one was saying stops
          // (a clip, or a step it was still streaming), so only the new
          // canvas's step is heard.
          if (next !== hostedRef.current) {
            stopPlayback();
            // Only for the press that comes with it, in this same moment.
            hostSwitch.current = true;
            setTimeout(() => { hostSwitch.current = false; }, 0);
          }
          const leaving = hostedRef.current && !next;
          hostedRef.current = next;
          setHosted(next);
          // Drawings that came while it was inside are merged now.
          if (leaving) void mergeRef.current();
        }}
        {...(hosted ? { onBack: back } : {})}
        topLeft={hosted ? (
          <button type="button" className="agent-canvas-back" title={`Back to ${name}'s canvas (Esc)`} onClick={back}>
            <ArrowLeft size={14} />{name}
          </button>
        ) : undefined}
        // The walkthrough and its voice keep in step: the voice follows the
        // step shown, pausing holds it, and the board waits for its words.
        onPlaying={(step) => {
          // No step (between canvases as the board zooms, or ready): the
          // narration says nothing, and the voice stays as you left it (a
          // zoom you clicked keeps it open for the canvas it lands on).
          if (step === undefined) holdVoice.current = false;
          if (step !== undefined && playingRef.current !== undefined && step > playingRef.current) hearRef.current(playingRef.current);
          setPlaying(step);
        }}
        // The board presses the first step of a canvas it has just gone into
        // (or out to), in the same moment it says so: before this re-renders,
        // so that press would start the last canvas's step too (two voices,
        // the new one streamed beside the old one's clip). That press is
        // left out; the new canvas's step starts its voice as it plays.
        // A press primes the step's clip, which plays it (voiceGate.ts, 4):
        // only a press you made reaches the narration. The board also
        // presses when Flock opens a step itself (a drawing's play_from),
        // and when it lands in a canvas, before this re-renders (that one
        // would start the last canvas's step).
        onStepPress={(step) => {
          if (hostSwitch.current) {
            hostSwitch.current = false;
            return;
          }
          if (!voiceAllowed()) return;
          narration.press(step);
        }}
        onPlayback={(paused) => {
          setPaused(paused);
          const wasHeld = holdVoice.current;
          holdVoice.current = paused;
          if (paused) pausePlayback();
          else if (pausedClip()) resumePlayback();
          else if (wasHeld) setVoiceKick((count) => count + 1);
        }}
        onReplay={() => setVoiceKick((count) => count + 1)}
        voiced={on}
        quiet={false}
        {...(on ? { stepFill: narration.fill, holding: (step: number) => narration.sounding !== step } : {})}
        {...(on ? { waiting: { step: narration.waiting, view: <VoiceWait preparation={narration.stepPreparation} /> } } : {})}
        {...(on && narration.preparation ? { preparing: <VoiceWait preparation={narration.preparation} /> } : {})}
        {...(narration.pointing ? { pointing: narration.pointing } : {})}
        // Beside play: the voice on or off, for every canvas.
        speedControl={
          <button type="button" className="agent-canvas-mute" title={muted ? "Turn the voice on" : "Mute the voice (every canvas)"} aria-pressed={muted} onClick={toggleMuted}>
            {muted ? <VolumeX size={16} /> : <Volume2 size={16} />}
          </button>
        }
      />
      <CanvasSkeleton leaving={drawnIn} />
      {!hasPanel && (
        <div className="agent-canvas-dock-placeholder" aria-hidden={!empty}>
          {dockHeader}
          {empty && !hosted ? <p>{name} has not drawn anything yet. What it wants you to see shows here.</p> : (
            <>
              <span className="agent-canvas-skeleton-text" />
              <span className="agent-canvas-skeleton-text agent-canvas-skeleton-text-short" />
              <span className="agent-canvas-skeleton-bar" />
            </>
          )}
        </div>
      )}
      {error && <p className="agent-canvas-error" title="The board could not merge the newest drawing">{error}</p>}
      {/* The engine's own status: a muted narration (as during an ask) stands in as unsupported. */}
      {!muted && voice().status.state === "unsupported" && <p className="agent-canvas-note">No voice: {voice().status.reason ?? "it could not start here."} The walkthrough plays with captions.</p>}
    </div>
  );
}

// The ask, in the walkthrough's dock: where you asked and what, then the
// agent at work on it (its avatar, what it does now), then its answer, said
// in its voice, with Continue taking you back into the walkthrough where the
// answer says. One layout from asking to answered, so nothing jumps.
function AskDock({ question, step, stepName, resumeName, who, where, answer, resumeStep, activity, avatar, renderText, canListen, sounding, onListen }: {
  question: string;
  step?: number;
  stepName?: string;
  resumeName?: string;
  who: string;
  where?: string;
  answer?: string;
  resumeStep?: number;
  activity: { label: string; tool?: string };
  avatar(working: boolean): React.ReactNode;
  renderText(text: string): React.ReactNode;
  canListen: boolean;
  sounding: boolean;
  onListen(): void;
}) {
  const place = [stepName ? stepName.replace(/^Step/, "step").replace(/^Overview$/, "the overview").replace(/^Summary$/, "the summary") : step ? `step ${step}` : "", where ?? ""].filter(Boolean).join(" of ");
  return (
    <div className="ask-dock" ref={keepWheel}>
      <p className="ask-dock-eyebrow">
        {answer ? <><strong>{who}</strong> answered</> : <>You asked{place ? <> about <strong>{place}</strong></> : ""}</>}
      </p>
      <div className="ask-dock-question">{renderText(question)}</div>
      {answer ? (
        <div className="ask-dock-answer">
          <span className="ask-dock-avatar">{avatar(sounding)}</span>
          <div className="ask-dock-answer-text">{renderText(answer)}</div>
        </div>
      ) : (
        <div className="ask-dock-working">
          <span className="ask-dock-avatar">{avatar(true)}</span>
          <span className="ask-dock-working-label">{activity.label}</span>
          {activity.tool && <span className="ask-dock-working-tool">{activity.tool}</span>}
        </div>
      )}
      <div className="ask-dock-foot">
        {answer && canListen && (
          <button type="button" className={`ask-dock-listen ${sounding ? "ask-dock-listen-on" : ""}`} onClick={onListen}>
            {sounding ? <Square size={13} /> : <Volume2 size={15} />}{sounding ? "Stop" : "Play the answer"}<kbd>Space</kbd>
          </button>
        )}
        <span className="ask-dock-hint"><kbd>Esc</kbd> back to the walkthrough{resumeName ? `, at ${resumeName.replace(/^Step/, "step").replace(/^Overview$/, "the overview").replace(/^Summary$/, "the summary")}` : resumeStep ? `, at step ${resumeStep}` : ""}</span>
      </div>
    </div>
  );
}

// What a drawing changed: shapes that are new, or whose words, colour or
// tag changed (by name; where they sit is the reader's, not news).
type ChangedShape = { name: string; fresh: boolean };
function changedShapes(before: Shape[], after: Shape[]): ChangedShape[] {
  const words = (shape: Shape) => JSON.stringify(Object.entries(shape).filter(([key, value]) => key !== "id" && (typeof value === "string" || typeof value === "boolean")).sort());
  const named = (shape: Shape) => (shape.kind !== "arrow" && "name" in shape && typeof shape.name === "string" ? shape.name : undefined);
  const was = new Map(before.flatMap((shape) => { const name = named(shape); return name ? [[name, words(shape)] as const] : []; }));
  return after.flatMap((shape) => {
    const name = named(shape);
    if (!name || was.get(name) === words(shape)) return [];
    return [{ name, fresh: !was.has(name) }];
  });
}

// A badge on each shape a drawing added or changed (New, Updated), at its
// top right corner, following it as the board pans and zooms. They go when
// the walkthrough plays.
function ChangeBadges({ host, changed }: { host: React.RefObject<HTMLDivElement | null>; changed: ChangedShape[] }) {
  const badges = useRef(new Map<string, HTMLSpanElement>());
  useEffect(() => {
    let frame = 0;
    const place = () => {
      const node = host.current;
      if (node) {
        const box = node.getBoundingClientRect();
        for (const item of changed) {
          const badge = badges.current.get(item.name);
          if (!badge) continue;
          const name = JSON.stringify(item.name);
          const shape = node.querySelector(`.sketch-rect[data-name=${name}], [data-shape-id][data-name=${name}]`);
          const rect = shape?.getBoundingClientRect();
          if (!rect || !rect.width) {
            badge.style.visibility = "hidden";
            continue;
          }
          badge.style.visibility = "visible";
          badge.style.transform = `translate(${Math.round(rect.right - box.left - 10)}px, ${Math.round(rect.top - box.top)}px) translate(-100%, -55%)`;
        }
      }
      frame = requestAnimationFrame(place);
    };
    frame = requestAnimationFrame(place);
    return () => cancelAnimationFrame(frame);
  }, [host, changed]);
  return (
    <div className="change-badges" aria-hidden>
      {changed.map((item) => (
        <span key={item.name} className={`change-badge ${item.fresh ? "change-badge-new" : ""}`} ref={(element) => { if (element) badges.current.set(item.name, element); else badges.current.delete(item.name); }}>
          {item.fresh ? "New" : "Updated"}
        </span>
      ))}
    </div>
  );
}

// The dock's first line, the same in every state of the walkthrough: the
// agent (or the worker at work), and what is going on. At work: what it
// does now, its avatar bobbing (and how many others work too). Else, when a
// drawing brought steps you have not heard: that it updated the canvas, and
// how many are new (the dock's Play then plays those). Else, quietly, whose
// canvas this is.
function DockHeader({ name, avatar, live, news, hosted }: { name: string; avatar(working: boolean): React.ReactNode; live: LiveRow[]; news?: { steps: number; updated: boolean }; hosted?: string }) {
  const row = live[0];
  return (
    <div className={`dock-header ${row ? "dock-header-working" : news ? "dock-header-news" : ""}`} aria-live="polite">
      <span className="dock-header-avatar">{row ? row.avatar : avatar(false)}</span>
      <span className="dock-header-name">{row ? row.name : hosted ?? name}</span>
      {row ? (
        <>
          <span className="dock-header-line">{row.line}</span>
          {row.detail && <span className="dock-header-detail">{row.detail}</span>}
          {row.more ? <span className="dock-header-more" title={`${row.more} more at work`}>+{row.more}</span> : null}
        </>
      ) : news ? (
        <span className="dock-header-line">{news.updated ? "updated the canvas" : "has news for you"}</span>
      ) : (
        <span className="dock-header-line dock-header-quiet">{hosted ? "drew this pull request" : "is waiting for you"}</span>
      )}
      {news && <span className="dock-header-new"><Sparkles size={12} />{news.steps} new</span>}
    </div>
  );
}

// While the voice is on its way (its model downloading, or a step's words
// being made): a line in the caption, filling as it goes.
function VoiceWait({ preparation }: { preparation: Preparation }) {
  const bar = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    let frame = 0;
    const tick = () => {
      if (bar.current) bar.current.style.width = `${Math.round(Math.min(1, preparation.progress()) * 100)}%`;
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [preparation]);
  const label = preparation.phase === "loading" ? "Getting the voice ready" : preparation.phase === "celebrating" ? "The voice is ready" : "Preparing the voice";
  return (
    <span className="agent-canvas-voice-wait">
      <span>{label}</span>
      <span className="agent-canvas-voice-bar"><span ref={bar} /></span>
    </span>
  );
}
