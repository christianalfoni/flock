// The voice engine: one SharedWorker for every tab on the origin, so ten
// open boards load Phonon once (docs/plan-voice.md, The voice engine). It
// keeps one queue of steps to speak, in the order asked, the step on screen
// first, makes one at a time, never while a tab plays a clip, and keeps what it made in Cache Storage for every tab and the
// next visit.
import type { Backend } from "./backend";
import { BUILD_ID } from "../build";
import { voiceLoadPhase } from "./installOffer";
import { ClipStore, readClip } from "./clipStore";
import { cancelled, failureKind } from "./phonon/support";
import { CLIP_CACHE, DEFAULT_VOICE, isHostedVoice, type Cue, type EngineStatus, type FakeOptions, type FromEngine, type Step, type ToEngine } from "./protocol";
import { jobBudget, withTimeout } from "./watch";

type Port = MessagePort;
type Job = { key: string; step: Step; voice: string; ports: Set<Port>; token?: string; sketch?: string; abort?: AbortController; urgentPort?: Port };

const ports = new Set<Port>();
// A newer build's engine announces itself. This one, if it is older, finishes
// the step in hand and tells its tabs to refresh (src/version.ts).
let retiring = false;
const voiceChannel = typeof BroadcastChannel === "function" ? new BroadcastChannel("ttmi-voice") : undefined;
function buildStamp(id: string) {
  const tail = id.slice(id.lastIndexOf("-") + 1);
  const value = Number.parseInt(tail, 36);
  return Number.isFinite(value) ? value : 0;
}
voiceChannel?.addEventListener("message", (event: MessageEvent<{ build?: string }>) => {
  const other = event.data?.build;
  if (!other || other === BUILD_ID) return;
  if (buildStamp(other) > buildStamp(BUILD_ID)) retiring = true;
  maybeRetire();
});
voiceChannel?.postMessage({ build: BUILD_ID });

function maybeRetire() {
  if (!retiring || working || inHand || order.length) return;
  for (const port of ports) send(port, { type: "reload" });
  voiceChannel?.close();
  (self as unknown as { close?: () => void }).close?.();
}
let backend: Backend | undefined;
let starting: Promise<void> | undefined;
let status: EngineStatus = { state: "checking", queued: 0 };
// Bumped by retry, so a start or load already in flight cannot overwrite it.
let epoch = 0;
let fakeOptions: FakeOptions | undefined;
let sweepArmed = false;
const jobs = new Map<string, Job>();
const order: string[] = [];
// The step on screen, last asked for urgently: it goes first.
let urgentKey: string | undefined;
let working = false;
// The step being made now: off the queue, its job kept until delivered.
// Asked for again meanwhile, it is not queued a second time (it was, and
// the second turn found no job and stopped the engine, 2026-10-22).
let inHand: string | undefined;
// Until when each tab is starting the step on screen, or sounding a clip
// (it says so, and says when it ends): nothing else starts meanwhile, so
// making speech on the GPU never starves the sound. The rest is made in
// the pauses (docs/plan-voice.md, Playback). A deadline rather than a flag,
// so a tab closed mid-clip lets go.
const speaking = new Map<Port, number>();
const GRACE_MS = 1500;
let wake: ReturnType<typeof setTimeout> | undefined;
// Where each queued step sits: the one on screen is 0, then the steps
// after it, then the ones before (src/voice/schedule.ts).
const ranks = new Map<string, number>();
let loading: Promise<void> | undefined;
const clips = new ClipStore(() => caches.open(CLIP_CACHE));
// The clips of the sketch open in each tab, and when the tab last said so:
// a tab that has not said so for half an hour is closed.
const open = new Map<Port, { keys: string[]; at: number }>();
const OPEN_MS = 30 * 60 * 1000;
// Old clips are swept a little after the engine starts, once the open tabs
// have said what they show, then every quarter of an hour.
const FIRST_SWEEP_MS = 30 * 1000;
const SWEEP_MS = 15 * 60 * 1000;

async function sweep() {
  const now = Date.now();
  const keep = new Set<string>();
  for (const [port, entry] of open) {
    if (entry.at < now - OPEN_MS) open.delete(port);
    else for (const key of entry.keys) keep.add(key);
  }
  // Nor what is queued or being made.
  for (const key of jobs.keys()) keep.add(key);
  await clips.sweep(keep).catch(() => undefined);
}

function send(port: Port, message: FromEngine, transfer: Transferable[] = []) {
  port.postMessage(message, transfer);
}

function set(next: Partial<EngineStatus>) {
  const kind = next.state && next.state !== "unsupported" ? undefined : next.kind;
  status = { ...status, ...next, kind, queued: order.length };
  for (const port of ports) send(port, { type: "status", status });
}

function armSweep() {
  if (sweepArmed) return;
  sweepArmed = true;
  setTimeout(() => void sweep(), FIRST_SWEEP_MS);
  setInterval(() => void sweep(), SWEEP_MS);
}

async function start(fake?: FakeOptions) {
  const mine = epoch;
  armSweep();
  const next = fake ? (await import("./fake")).fakeBackend(fake) : (await import("./blixtBackend")).blixtBackend();
  const reason = await next.unsupported();
  if (mine !== epoch) return;
  backend = next;
  if (reason) return set({ state: "unsupported", reason });
  const installed = await next.installed();
  if (mine !== epoch) return;
  set({ state: installed ? "installed" : "absent" });
}

// Install and load are one path: load downloads what is missing. The
// warm-up speaks a word. Without a real GPU, load throws and the voice
// stays off. There is no CPU tier.
function load(install: boolean) {
  if (!backend || status.state === "unsupported" || status.state === "ready") return;
  if (!install && status.state !== "installed") return;
  const mine = epoch;
  loading ??= (async () => {
    // A cached model reports progress too (the cache read). Only a real
    // download is "installing"; a load from the cache stays "loading", or
    // the install panel opens on every reload.
    const phase = voiceLoadPhase(install, status.state);
    set({ state: phase, progress: 0 });
    try {
      // The model reports every chunk it reads, thousands of them; each
      // status re-renders every open board, so only a new percent is sent.
      let percent = -1;
      await backend!.load((progress) => {
        if (mine !== epoch) return;
        const now = Math.floor(progress * 100);
        if (now === percent) return;
        percent = now;
        set({ state: phase, progress: now / 100 });
      });
      if (mine !== epoch) return;
      set({ state: "loading", progress: 1, making: { since: Date.now(), chars: 6 } });
      await backend!.synth({ segments: [{ text: "Ready." }] }, DEFAULT_VOICE);
      if (mine !== epoch) return;
      set({ state: "ready", reason: undefined, making: undefined, device: backend!.device?.() });
      void work();
    } catch (error) {
      if (mine !== epoch) return;
      set({ state: "unsupported", reason: error instanceof Error ? error.message : String(error), kind: failureKind(error), making: undefined, device: backend?.device?.() });
    } finally {
      if (mine === epoch) loading = undefined;
    }
  })();
}

// Try again: drop the unsupported latch and start over. A page that was
// blocked by a remembered failure connects and asks for this.
async function retry() {
  epoch += 1;
  loading = undefined;
  for (const job of jobs.values()) job.abort?.abort();
  const previous = backend;
  backend = undefined;
  starting = undefined;
  await previous?.remove().catch(() => undefined);
  starting = start(fakeOptions);
  await starting;
  for (const port of ports) send(port, { type: "status", status });
  if (status.state === "absent") load(true);
  else if (status.state === "installed") load(false);
}


// Until when some tab is starting its step, or 0.
function speakingUntil() {
  const now = Date.now();
  let until = 0;
  for (const [port, at] of speaking) {
    if (at <= now) speaking.delete(port);
    else until = Math.max(until, at);
  }
  return until;
}

function deliver(job: Job, wav: ArrayBuffer, seconds: number, cues: Cue[], truncated?: { tokens: number }) {
  // The step on screen: its tab plays it next.
  if (job.key === urgentKey) for (const port of job.ports) speaking.set(port, Math.max(speaking.get(port) ?? 0, Date.now() + GRACE_MS));
  let first = true;
  for (const port of job.ports) {
    const copy = wav.slice(0);
    send(port, { type: "clip", key: job.key, wav: copy, seconds, cues, ...(truncated && first ? { truncated } : {}) }, [copy]);
    first = false;
  }
}

// One step at a time, from the front of the queue.
async function work() {
  if (working || status.state !== "ready") return;
  working = true;
  try {
    while (order.length && status.state === "ready") {
      // A tab is starting its step: nothing starts but the step on
      // screen until the grace passes.
      const until = speakingUntil();
      if (until && order[0] !== urgentKey) {
        clearTimeout(wake);
        wake = setTimeout(() => void work(), until - Date.now());
        return;
      }
      const key = order.shift()!;
      const job = jobs.get(key);
      if (!job) continue;
      inHand = key;
      const chars = job.step.segments.reduce((sum, segment) => sum + segment.text.length, 0);
      set({ making: { key, since: Date.now(), chars } });
      const started = performance.now();
      const budget = jobBudget(chars, status.charsPerSecond, fakeOptions?.deadlineMs);
      try {
        const { wav, seconds, cues, tokens, truncated } = await withTimeout(backend!.synth(job.step, job.voice, (chunk) => {
          // Only the tab that is playing this step. The others wait for the clip.
          const port = job.urgentPort;
          if (!port || !ports.has(port)) return;
          const pcm = new ArrayBuffer(chunk.samples.byteLength);
          new Float32Array(pcm).set(chunk.samples);
          send(port, { type: "audio", key: job.key, pcm, sampleRate: 24000, words: chunk.words }, [pcm]);
        }, job.abort?.signal), budget, "Speaking this step");
        const spent = (performance.now() - started) / 1000;
        const rate = chars / Math.max(spent, 0.05);
        set({ charsPerSecond: status.charsPerSecond ? status.charsPerSecond * 0.6 + rate * 0.4 : rate, making: undefined });
        // The cues go with the clip, in a header, so a hit needs nothing else.
        // The tab hears the clip even when storing it fails (a full disk).
        const headers = { "content-type": "audio/wav", "x-seconds": String(seconds), "x-cues": JSON.stringify(cues) };
        deliver(job, wav, seconds, cues, truncated ? { tokens: tokens ?? 0 } : undefined);
        void clips.put(key, new Response(wav.slice(0), { headers })).catch(() => undefined);
      } catch (error) {
        set({ making: undefined });
        if (!cancelled(error)) for (const port of job.ports) send(port, { type: "failed", key, reason: error instanceof Error ? error.message : String(error) });
        else for (const port of job.ports) send(port, { type: "failed", key, reason: "cancelled" });
      }
      jobs.delete(key);
      ranks.delete(key);
      inHand = undefined;
    }
  } finally {
    inHand = undefined;
    working = false;
    maybeRetire();
  }
}

// Lower rank first. The step on screen is unshifted ahead of the rest.
function place(key: string, urgent: boolean, priority?: number) {
  if (urgent) ranks.set(key, 0);
  else if (priority !== undefined) ranks.set(key, priority);
  const existing = order.indexOf(key);
  if (existing >= 0) {
    if (!urgent && priority === undefined) return;
    order.splice(existing, 1);
  }
  if (urgent) {
    order.unshift(key);
    return;
  }
  const rank = ranks.get(key);
  if (rank === undefined) {
    order.push(key);
    return;
  }
  const index = order.findIndex((item) => (ranks.get(item) ?? Number.POSITIVE_INFINITY) > rank);
  if (index < 0) order.push(key);
  else order.splice(index, 0, key);
}

function readCues(header: string | null): Cue[] {
  try {
    const cues = JSON.parse(header ?? "[]") as unknown;
    return Array.isArray(cues) ? (cues as Cue[]) : [];
  } catch {
    return [];
  }
}

async function speak(port: Port, message: Extract<ToEngine, { type: "speak" }>) {
  if (message.urgent) urgentKey = message.key;
  // Made before, in any tab or visit: no model needed. A cache that throws
  // is a miss, not a step that never answers.
  const hit = await readClip(clips, message.key);
  if (hit) {
    if (message.urgent) speaking.set(port, Math.max(speaking.get(port) ?? 0, Date.now() + GRACE_MS));
    const wav = await hit.arrayBuffer();
    send(port, { type: "clip", key: message.key, wav, seconds: Number(hit.headers.get("x-seconds") ?? 0), cues: readCues(hit.headers.get("x-cues")) }, [wav]);
    return;
  }
  const job = jobs.get(message.key) ?? { key: message.key, step: message.step, voice: isHostedVoice(message.voice) ? DEFAULT_VOICE : message.voice, ports: new Set<Port>(), abort: new AbortController() };
  job.voice = isHostedVoice(message.voice) ? DEFAULT_VOICE : message.voice;
  job.ports.add(port);
  if (message.urgent) job.urgentPort = port;
  jobs.set(message.key, job);
  // Being made now: it comes to every tab that asked when it is done.
  if (message.key === inHand) return set({});
  place(message.key, Boolean(message.urgent), message.priority);
  set({});
  void work();
}

function cancelKeys(keys: string[]) {
  const wanted = new Set(keys);
  for (const key of [...order]) if (wanted.has(key)) order.splice(order.indexOf(key), 1);
  for (const [key, job] of jobs) {
    if (!wanted.has(key)) continue;
    job.abort?.abort();
    if (key !== inHand) {
      jobs.delete(key);
      ranks.delete(key);
    }
  }
  set({});
}

function bye(port: Port) {
  ports.delete(port);
  speaking.delete(port);
  open.delete(port);
  const alone: string[] = [];
  for (const [key, job] of jobs) {
    job.ports.delete(port);
    if (job.urgentPort === port) job.urgentPort = undefined;
    if (!job.ports.size) alone.push(key);
  }
  if (alone.length) cancelKeys(alone);
  port.close();
}

async function remove() {
  epoch += 1;
  loading = undefined;
  order.length = 0;
  for (const job of jobs.values()) job.abort?.abort();
  jobs.clear();
  ranks.clear();
  const previous = backend;
  backend = undefined;
  if (previous) await previous.remove().catch(() => undefined);
  else {
    const { removePhonon } = await import("./phonon/runtime");
    await removePhonon().catch(() => undefined);
  }
  await caches.delete(CLIP_CACHE).catch(() => undefined);
  clips.forget();
  set({ state: "absent", progress: undefined, making: undefined });
}

function connect(port: Port) {
  ports.add(port);
  port.onmessage = (event: MessageEvent<ToEngine>) => {
    const message = event.data;
    if (message.type === "hello") {
      if (message.fake) fakeOptions = message.fake;
      const mine = epoch;
      starting ??= start(fakeOptions);
      void starting.then(() => {
        if (mine === epoch) send(port, { type: "status", status });
      });
    } else if (message.type === "retry") void retry();
    else if (message.type === "install") void starting?.then(() => load(true));
    else if (message.type === "load") void starting?.then(() => load(false));
    else if (message.type === "remove") void remove();
    else if (message.type === "cancel") cancelKeys(message.keys);
    else if (message.type === "bye") bye(port);
    else if (message.type === "speak") {
      void starting?.then(() => speak(port, message)).catch((error: unknown) => {
        send(port, { type: "failed", key: message.key, reason: error instanceof Error ? error.message : String(error) });
      });
    }
    else if (message.type === "open") {
      if (message.keys.length) open.set(port, { keys: message.keys, at: Date.now() });
      else open.delete(port);
    } else if (message.type === "speaking") {
      if (message.ms > 0) speaking.set(port, Math.max(speaking.get(port) ?? 0, Date.now() + message.ms));
      else {
        speaking.delete(port);
        void work();
      }
    }
  };
  port.start();
}

(self as unknown as { onconnect: (event: MessageEvent) => void }).onconnect = (event) => connect(event.ports[0]!);
