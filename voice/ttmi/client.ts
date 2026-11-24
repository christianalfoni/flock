// The page's side of the voice engine (docs/plan-voice.md): one connection
// per tab to the shared engine, the status every page shows, and spoken
// steps as object URLs to play.
import { useSyncExternalStore } from "react";
import { track } from "../analytics";
import { firebase } from "../firebase";
import { voiceDebug } from "./debug";
import { forgetUnsupported, rememberUnsupported, shouldRememberFailure, unsupportedMark, type MarkStore } from "./mark";
import { armStream, completeStream, pushStream } from "./stream";
import { CLIP_CACHE, clipKey, clipUrl, isHostedVoice, type Cue, type EngineStatus, type FakeOptions, type FromEngine, type Step, type ToEngine } from "./protocol";

declare global {
  interface Window {
    // Set by the browser tests before the page loads: the engine makes
    // silence with the fake backend instead of loading Kokoro.
    ttmiVoiceFake?: FakeOptions;
    // What the board spoke, in order, for the tests.
    ttmiVoiceSpoken?: string[];
    // The names the voice pointed at, in order, for the tests.
    ttmiVoicePointed?: string[];
    // Set by a test when a note opening itself moved the walkthrough on.
    ttmiNoteAdvanced?: boolean;
    // When the engine started making a step ("making") and when a clip
    // started and stopped playing ("play", "end"), in order, for the tests.
    ttmiVoiceLog?: string[];
    // One clip's rate while it played, and how long the wall clock took,
    // for the playback-speed tests.
    ttmiClip?: Promise<{ rate: number; def: number; duration: number; wall: number }>;
    // Clips asked for, so a test can see a nested canvas preloaded beside
    // the sketch on screen. Absent, nothing is recorded.
    ttmiVoiceAsked?: { sketch: string; urgent: boolean; at: number }[];
    // How many voice engines the page started, for the tests.
    ttmiVoiceWorkers?: number;
    // Audio chunks the engine streamed while a clip was still being made.
    ttmiVoiceChunks?: number;
    ttmiVoiceChunkSamples?: number;
  }
}

// A CPU failure is remembered for this engine and a few days
// (src/voice/mark.ts). An older mark, or a WebGPU miss, is not.
function storage(): MarkStore | undefined {
  try {
    return localStorage;
  } catch {
    return undefined;
  }
}
function marked() {
  const box = storage();
  if (!box) return false;
  try {
    return unsupportedMark(box, navigator.userAgent);
  } catch {
    return false;
  }
}
function mark() {
  const box = storage();
  if (!box) return;
  try {
    rememberUnsupported(box, navigator.userAgent);
  } catch {
    // Storage blocked: the check runs again next time.
  }
}
function forget() {
  const box = storage();
  if (!box) return;
  try {
    forgetUnsupported(box);
  } catch {
    // The next visit tries again anyway.
  }
}

export type Clip = { url: string; seconds: number; cues: Cue[] };
type Waiting = { promise: Promise<Clip>; resolve(clip: Clip): void; reject(error: Error): void; cloud: boolean };
// Object URLs kept for the steps a reader is likely to replay. Older ones
// are revoked; the clip is still in the engine's cache.
const CLIP_URLS = 12;

class Voice {
  status: EngineStatus = { state: "checking", queued: 0 };
  private listeners = new Set<() => void>();
  private port?: MessagePort;
  private clips = new Map<string, Clip>();
  private urls: string[] = [];
  private waiting = new Map<string, Waiting>();
  private liveKey?: string;
  private liveStep?: Step;
  readonly fake = typeof window !== "undefined" ? window.ttmiVoiceFake : undefined;

  constructor() {
    const reason = typeof SharedWorker !== "function"
      ? "This browser cannot share one voice between tabs."
      : !isSecureContext ? "Voice needs a secure page (https)." : marked() ? "The voice did not work in this browser before." : undefined;
    if (reason) {
      this.status = { state: "unsupported", reason, queued: 0 };
      return;
    }
    this.connect();
    window.addEventListener("pagehide", () => this.post({ type: "bye" }));
  }

  private connect() {
    try {
      const worker = new SharedWorker(new URL("./engine.worker.ts", import.meta.url), { type: "module", name: "ttmi-voice" });
      worker.onerror = () => this.set({ state: "unsupported", reason: "The voice engine did not start.", queued: 0 });
      this.port = worker.port;
      this.port.onmessage = (event: MessageEvent<FromEngine>) => this.receive(event.data);
      this.port.start();
      this.post({ type: "hello", ...(this.fake ? { fake: this.fake } : {}) });
    } catch {
      this.set({ state: "unsupported", reason: "The voice engine did not start.", queued: 0 });
    }
  }

  // Clears a remembered failure and asks the engine to start again.
  retry() {
    forget();
    this.status = { state: "checking", queued: 0 };
    for (const listener of this.listeners) listener();
    if (!this.port) this.connect();
    else this.post({ type: "retry" });
  }

  private post(message: ToEngine) {
    this.port?.postMessage(message);
  }

  private set(status: EngineStatus) {
    if (status.charsPerSecond && status.charsPerSecond !== this.status.charsPerSecond) rememberSpeed(status.charsPerSecond);
    if (status.state !== this.status.state || status.making?.key !== this.status.making?.key) voiceDebug("engine", status.state, status.making ? `making ${status.making.key?.slice(0, 8) ?? "(warm-up)"}` : "idle", `queued ${status.queued}`);
    if (status.making && status.making.since !== this.status.making?.since) window.ttmiVoiceLog?.push("making");
    // A CPU failure after the engine started is remembered for a few days.
    // A WebGPU miss falls back and is not remembered. One before the engine
    // started (no SharedWorker) is checked again next visit.
    if (shouldRememberFailure(this.status.state, status)) mark();
    this.status = status;
    // Nothing will be made now: whatever waits for a clip hears so. A
    // hosted voice's clip is not Kokoro's to make, and still comes.
    if (status.state === "unsupported") {
      for (const [key, waiting] of this.waiting) {
        if (waiting.cloud) continue;
        waiting.reject(new Error(status.reason ?? "Voice is not available in this browser."));
        this.waiting.delete(key);
      }
    }
    for (const listener of this.listeners) listener();
  }

  private receive(message: FromEngine) {
    if (message.type === "reload") {
      window.dispatchEvent(new Event("ttmi:stale-build"));
      return;
    }
    if (message.type === "status") return this.set(message.status);
    // A chunk of the clip still being made. The buffer was transferred, so
    // this is a view, not a copy. It is kept for the step this tab is
    // making ahead of the others, and played only once that step is armed
    // (the reader started the walkthrough, or asked to hear a sentence).
    // Counting it shows the page stayed on the receiving side.
    if (message.type === "audio") {
      window.ttmiVoiceChunks = (window.ttmiVoiceChunks ?? 0) + 1;
      const pcm = new Float32Array(message.pcm);
      window.ttmiVoiceChunkSamples = (window.ttmiVoiceChunkSamples ?? 0) + pcm.length;
      if (message.key === this.liveKey) pushStream(message.key, pcm, message.sampleRate, message.words, this.liveStep);
      return;
    }
    const waiting = this.waiting.get(message.key);
    this.waiting.delete(message.key);
    voiceDebug(`engine ${message.type}`, message.key.slice(0, 8), message.type === "failed" ? message.reason : `${message.seconds.toFixed(1)} s`);
    if (message.type === "failed") return waiting?.reject(new Error(message.reason));
    completeStream(message.key, message.seconds, message.cues ?? []);
    const clip = { url: URL.createObjectURL(new Blob([message.wav], { type: "audio/wav" })), seconds: message.seconds, cues: message.cues ?? [] };
    this.remember(message.key, clip);
    waiting?.resolve(clip);
  }

  private remember(key: string, clip: Clip) {
    const previous = this.clips.get(key);
    if (previous && previous.url !== clip.url) URL.revokeObjectURL(previous.url);
    this.clips.set(key, clip);
    this.urls = this.urls.filter((url) => url !== clip.url);
    this.urls.push(clip.url);
    while (this.urls.length > CLIP_URLS) {
      const old = this.urls.shift();
      if (!old) break;
      URL.revokeObjectURL(old);
      for (const [known, stored] of this.clips) if (stored.url === old) this.clips.delete(known);
    }
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  install() {
    track("voice_installed");
    // The model is about 44 MB: asked to be kept when storage runs short. Only a
    // page can ask, and the browser may say no; clips are kept short-lived
    // by the engine either way.
    void navigator.storage?.persist?.().catch(() => false);
    this.post({ type: "install" });
  }
  load() {
    this.post({ type: "load" });
  }
  remove() {
    for (const clip of this.clips.values()) URL.revokeObjectURL(clip.url);
    this.clips.clear();
    this.post({ type: "remove" });
  }

  // Whether this tab reached the engine at all: a hosted voice needs
  // nothing more (docs/plan-cloud-voice.md).
  get connected() {
    return Boolean(this.port);
  }

  key(step: Step, voice: string) {
    return clipKey(step, voice, Boolean(this.fake));
  }

  // The step spoken: from this tab, from the shared cache, or made by the
  // engine. urgent puts it ahead of everything baking and keeps its frames
  // as they arrive. hear plays those frames. A step made before Play is
  // urgent and not heard; the walkthrough hears it when the reader starts.
  async clip(step: Step, voice: string, urgent = false, sketch?: string, priority?: number, hear = false): Promise<Clip> {
    const key = await this.key(step, voice);
    const known = this.clips.get(key);
    if (known) return known;
    let waiting = this.waiting.get(key);
    if (waiting && !urgent && priority === undefined) return waiting.promise;
    if (!waiting) {
      let resolve!: (clip: Clip) => void;
      let reject!: (error: Error) => void;
      const promise = new Promise<Clip>((yes, no) => {
        resolve = yes;
        reject = no;
      });
      waiting = { promise, resolve, reject, cloud: isHostedVoice(voice) };
      this.waiting.set(key, waiting);
    }
    // Ahead of Play the frames are buffered under this key. They are not
    // armed, so nothing reaches the speakers until hear is asked.
    if (urgent || hear) {
      this.liveKey = key;
      this.liveStep = step;
    }
    if (hear) armStream(key);
    voiceDebug(urgent ? "asked (on screen)" : "asked", key.slice(0, 8));
    window.ttmiVoiceAsked?.push({ sketch: sketch ?? "", urgent, at: performance.now() });
    // A hosted voice is said by the function as this user.
    const token = isHostedVoice(voice) && !this.fake ? await firebase().auth.currentUser?.getIdToken().catch(() => undefined) : undefined;
    this.post({ type: "speak", key, step, voice, urgent, ...(priority !== undefined ? { priority } : {}), ...(token ? { token } : {}), ...(sketch ? { sketch } : {}) });
    return waiting.promise;
  }

  // A step's clip already in this tab, at once: the reader's press plays
  // it inside the press.
  known(key: string): Clip | undefined {
    return this.clips.get(key);
  }

  // This tab sounds a clip for at most this long: the engine starts
  // nothing new but the step on screen until it ends (0).
  speaking(ms: number) {
    this.post({ type: "speaking", ms: Math.ceil(ms) });
  }

  // The clips of the sketch open in this tab, kept while it is open.
  open(keys: string[]) {
    this.post({ type: "open", keys });
  }

  // Stop making these steps. The one on screen stops at its next pause.
  cancel(keys: string[]) {
    if (keys.length) this.post({ type: "cancel", keys });
  }

  // This tab is going away.
  bye() {
    this.post({ type: "bye" });
  }

  // Whether a step is already made, without asking for it.
  async made(step: Step, voice: string) {
    const key = await this.key(step, voice);
    if (this.clips.has(key)) return true;
    try {
      return Boolean(await (await caches.open(CLIP_CACHE)).match(clipUrl(key)));
    } catch {
      return false;
    }
  }
}

// How fast this machine makes speech, kept in this browser: the engine only
// measures once it has made a step, so a board opened later estimates its
// first step's wait with the last speed instead of a guess.
const SPEED = "ttmiVoiceSpeed";
function rememberSpeed(charsPerSecond: number) {
  try {
    localStorage.setItem(SPEED, String(Math.round(charsPerSecond)));
  } catch {
    // Private windows: the guess will do.
  }
}
// Characters of narration a second: measured now, or last time, or a guess
// at a GPU's (about 95 on the owner's; 15 filled two bars, 2026-10-22).
export function speechSpeed(): number {
  const measured = voice().status.charsPerSecond;
  if (measured) return measured;
  try {
    const kept = Number(localStorage.getItem(SPEED));
    if (kept > 0) return kept;
  } catch {
    // Unreadable: guess.
  }
  return 80;
}

let instance: Voice | undefined;
export function voice(): Voice {
  return (instance ??= new Voice());
}

// The engine if this page has started it; letting go of it never starts it.
export function startedVoice(): Voice | undefined {
  return instance;
}

const unsupported: EngineStatus = { state: "unsupported", queued: 0 };
// The engine's status as a board with this voice sees it: a hosted voice
// (docs/plan-cloud-voice.md) is ready whenever the engine is reached,
// whether or not Kokoro is installed or this browser can run it.
// Only whether the engine is there and ready, for a board: the status
// changes three times for every step made (the step in hand, the speed, the
// queue), and each change re-rendered the whole board, a 50 ms hitch with
// a repaint after it (2026-10-22). What a board reads of those it reads
// from voice().status as it draws a frame.
export type VoiceState = Pick<EngineStatus, "state" | "reason">;
const stateViews = new WeakMap<EngineStatus, VoiceState>();
let lastView: VoiceState = { state: "unsupported" };
function stateView(status: EngineStatus): VoiceState {
  let view = stateViews.get(status);
  if (!view) {
    view = lastView.state === status.state && lastView.reason === status.reason ? lastView : { state: status.state, ...(status.reason !== undefined ? { reason: status.reason } : {}) };
    stateViews.set(status, view);
  }
  return (lastView = view);
}
export function useVoiceState(enabled = true, _voiceName?: string): VoiceState {
  const engine = enabled ? voice() : undefined;
  return useSyncExternalStore(engine?.subscribe ?? (() => () => {}), () => stateView(engine?.status ?? unsupported));
}

export function useVoiceStatus(enabled = true, _voiceName?: string): EngineStatus {
  const engine = enabled ? voice() : undefined;
  return useSyncExternalStore(engine?.subscribe ?? (() => () => {}), () => engine?.status ?? unsupported);
}
