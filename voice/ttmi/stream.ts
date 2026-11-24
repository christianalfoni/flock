// Playing a clip while it is still being made. Chunks are kept as they
// arrive and scheduled on a clock only once this clip is armed, which is
// when the reader starts the walkthrough (or asks to hear a sentence).
// A click that only unlocks the context does not arm anything, so frames
// made ahead of Play stay silent. A replay plays the finished clip through
// the ordinary element, which keeps the pitch when the speed changes. The
// streamed first play keeps the pitch too: a rate other than 1 stretches
// the samples before they are scheduled, and the clock still reads the
// original timeline, so the highlights stay on the words.
import { cuesFromWords, type TimedWord } from "./phonon/align";
import { capCues, type Cue } from "./cues";
import type { Step } from "./protocol";
import { timeStretch } from "./stretch";

export type StreamSnap = { playing: boolean; ended: boolean; cues: Cue[] };

type Buffer = { pcm: Float32Array[]; sampleRate: number; words: TimedWord[]; step?: Step };
type Active = {
  key: string;
  sampleRate: number;
  // Original samples, in order. A speed change plays from here again.
  chunks: Float32Array[];
  // Original samples already handed to a source in this generation.
  covered: number;
  // Seconds of audio those sources occupy, at the rate they were stretched.
  queued: number;
  sources: AudioBufferSourceNode[];
  anchor?: number;
  // Original time the anchor stands for.
  origin: number;
  finished: boolean;
  tailEnded: boolean;
  duration?: number;
  cues: Cue[];
  ended: boolean;
};

// Resume settles for about this long before the first sample, or the device
// clips the onset. The samples themselves are not faded.
const ARM_DELAY = 0.04;

let ctx: AudioContext | undefined;
let rate = 1;
let armed: string | undefined;
let active: Active | undefined;
// The last audio-clock reading and the wall clock beside it. A device that
// slept reports one currentTime for a long quiet stretch, then leaps
// forward when it wakes. The leap is not time the clip played.
let observed: { audio: number; wall: number } | undefined;
let noting = false;
const buffers = new Map<string, Buffer>();
const listeners = new Set<(snap: StreamSnap) => void>();
let endWait: (() => void) | undefined;

function context(): AudioContext | undefined {
  if (typeof window === "undefined" || typeof AudioContext !== "function") return undefined;
  try {
    return (ctx ??= new AudioContext());
  } catch {
    return undefined;
  }
}

export function unlockStream() {
  // A gesture may resume a context that is already streaming. It must not
  // create one: a cached clip plays through the element, and opening a
  // context beside that start drops the first sound. A stream that has
  // already been said must not be woken either. After a quiet gap the
  // device is suspended, and resuming it on the key that starts the next
  // step cuts off the element that key is about to play.
  if (!ctx || !armed || active?.ended) return;
  if (active && (streamFraction() ?? 0) >= 1) return;
  void ctx.resume().then(() => {
    if (armed && !active) start(armed);
  }).catch(() => undefined);
}

// Inside the press that will stream (the clip is not ready yet). Creates
// and resumes the context while the gesture still counts, without playing.
export function warmStream() {
  const audio = context();
  if (!audio || audio.state === "running") return;
  void audio.resume().catch(() => undefined);
}

export function setStreamRate(next: number) {
  const at = active ? mediaTime() : undefined;
  rate = next;
  if (!active || !ctx || at === undefined) return;
  for (const source of active.sources) {
    try {
      source.onended = null;
      source.stop();
    } catch {
      // Not started.
    }
  }
  active.sources = [];
  active.origin = at;
  active.anchor = ctx.currentTime;
  active.covered = Math.min(total(active.chunks), Math.max(0, Math.round(at * active.sampleRate)));
  active.queued = 0;
  active.tailEnded = false;
  schedulePending(ctx);
}

export function watchStream(listener: (snap: StreamSnap) => void) {
  listeners.add(listener);
  if (active) listener(snapshot());
  return () => listeners.delete(listener);
}

function snapshot(): StreamSnap {
  return { playing: streamAudible(), ended: Boolean(active?.ended), cues: active?.cues ?? [] };
}

function emit() {
  const snap = snapshot();
  for (const listener of listeners) listener(snap);
  if (snap.ended) {
    endWait?.();
    endWait = undefined;
  }
}

export function streamAudible() {
  return Boolean(active && !active.ended && active.sources.length);
}

export function mediaTime(): number | undefined {
  if (!active || !ctx) return active ? active.origin : undefined;
  // Reading the clock is what notices a device that slept and then caught
  // up. The fraction the board sees has to be the place in the clip, not
  // the jump, or the step is already over on the first look.
  noteClock(ctx);
  if (!active || active.anchor === undefined) return active ? active.origin : undefined;
  return Math.max(0, active.origin + (ctx.currentTime - active.anchor) * rate);
}

export function streamFraction(): number | undefined {
  const at = mediaTime();
  if (at === undefined || !active) return undefined;
  const duration = active.duration ?? total(active.chunks) / active.sampleRate;
  if (!duration) return 0;
  return Math.min(1, at / duration);
}

export function streamDone(): Promise<void> {
  if (!active || active.ended) return Promise.resolve();
  return new Promise((resolve) => {
    endWait = resolve;
  });
}

// The reader started this clip. Buffered frames play now; later ones
// follow. If the context is still suspended (the Play click's resume has
// not landed yet), play when it does.
export function armStream(key: string) {
  armed = key;
  const audio = context();
  if (!audio) return;
  const begin = () => {
    if (armed === key) start(key);
  };
  if (audio.state === "running") {
    begin();
    return;
  }
  void audio.resume().then(begin).catch(() => undefined);
}

export function pushStream(key: string, pcm: Float32Array, sampleRate: number, words: TimedWord[], step?: Step) {
  const buf = buffers.get(key) ?? { pcm: [], sampleRate, words: [], step };
  buf.pcm.push(pcm);
  buf.sampleRate = sampleRate;
  buf.words = words;
  if (step) buf.step = step;
  buffers.set(key, buf);
  if (active?.key === key && !active.ended) scheduleNew();
  else if (armed === key) start(key);
}

export function completeStream(key: string, seconds: number, cues: Cue[]) {
  const buf = buffers.get(key);
  buffers.delete(key);
  if (active?.key !== key) return;
  if (buf) for (let index = active.chunks.length; index < buf.pcm.length; index++) active.chunks.push(new Float32Array(buf.pcm[index]!));
  active.finished = true;
  active.duration = seconds;
  active.cues = cues;
  if (ctx) schedulePending(ctx);
  if (active.tailEnded || !active.sources.length) {
    active.ended = true;
    if (armed === active.key) armed = undefined;
  }
  emit();
}

export function streamOwnsClock() {
  return Boolean(active && !active.ended);
}

export function streamPaused() {
  return streamOwnsClock() && ctx?.state === "suspended";
}

export function stopStream() {
  for (const source of active?.sources ?? []) {
    try {
      source.onended = null;
      source.stop();
    } catch {
      // Not started.
    }
  }
  if (active) active.ended = true;
  active = undefined;
  armed = undefined;
  observed = undefined;
  endWait?.();
  endWait = undefined;
  // A suspended device stays suspended. The next stream resumes it when
  // it arms. Resuming here is the moment a cached clip starts on the
  // element, and waking the device under that start drops the clip.
}

function start(key: string) {
  const audio = context();
  const buf = buffers.get(key);
  if (!audio || audio.state !== "running" || !buf?.pcm.length) return;
  // Arming again, or the gesture's resume landing after arm, must not
  // schedule the same frames a second time.
  if (active?.key === key && !active.ended) {
    scheduleNew();
    return;
  }
  active = { key, sampleRate: buf.sampleRate, chunks: [], covered: 0, queued: 0, sources: [], origin: 0, finished: false, tailEnded: false, cues: cuesFor(buf.step, buf.words), ended: false };
  scheduleNew();
  emit();
}

function scheduleNew() {
  const audio = ctx;
  const buf = active ? buffers.get(active.key) : undefined;
  if (!audio || !active || !buf) return;
  for (let index = active.chunks.length; index < buf.pcm.length; index++) active.chunks.push(new Float32Array(buf.pcm[index]!));
  schedulePending(audio);
  active.cues = cuesFor(buf.step, buf.words);
  emit();
}

// Original samples not yet in a source. At 1× each chunk plays as it
// arrives. Any other rate waits until a fifth of a second is in hand, so
// the stretch has a waveform to follow, and the end of the clip flushes
// the rest.
function schedulePending(audio: AudioContext) {
  if (!active) return;
  const pending = total(active.chunks) - active.covered;
  const min = Math.abs(rate - 1) < 1e-3 ? 1 : Math.round(active.sampleRate * 0.2);
  if (pending < min && !active.finished) return;
  const pcm = slice(active.chunks, active.covered, total(active.chunks));
  if (!pcm.length) return;
  active.covered += pcm.length;
  schedule(audio, pcm);
}

// How far currentTime may run ahead of the wall clock between two readings
// before it is a wake-up jump rather than playback. Half a second: a render
// quantum and a stalled main thread stay under it, and the gap after a
// finished step is many times longer.
const CLOCK_JUMP = 0.5;

function sampleClock(audio: AudioContext) {
  observed = { audio: audio.currentTime, wall: performance.now() };
}

// currentTime leapt past the clip. Put the playhead back where the jump
// found it and schedule what is left at the clock's new time, so the step
// is heard instead of reported finished.
function restartAt(audio: AudioContext, at: number) {
  if (!active || active.ended) return;
  for (const source of active.sources) {
    try {
      source.onended = null;
      source.stop();
    } catch {
      // Not started, or already stopped by the device.
    }
  }
  active.sources = [];
  active.tailEnded = false;
  active.origin = Math.max(0, at);
  active.anchor = undefined;
  active.covered = Math.min(total(active.chunks), Math.max(0, Math.round(active.origin * active.sampleRate)));
  active.queued = 0;
  schedulePending(audio);
}

function noteClock(audio: AudioContext) {
  if (noting) return;
  noting = true;
  try {
    const now = audio.currentTime;
    const wall = performance.now();
    const prev = observed;
    observed = { audio: now, wall };
    if (!prev || !active || active.ended || active.anchor === undefined) return;
    const dAudio = now - prev.audio;
    const dWall = (wall - prev.wall) / 1000;
    if (dAudio <= dWall + CLOCK_JUMP) return;
    const jump = dAudio - Math.max(0, dWall);
    active.anchor += jump;
    const at = Math.max(0, active.origin + (now - active.anchor) * rate);
    restartAt(audio, at);
  } finally {
    noting = false;
  }
}

function markEnded() {
  if (!active) return;
  active.ended = true;
  if (armed === active.key) armed = undefined;
  emit();
}

function schedule(audio: AudioContext, pcm: Float32Array) {
  if (!active || !pcm.length) return;
  const played = timeStretch(pcm, rate, active.sampleRate);
  const buffer = audio.createBuffer(1, played.length, active.sampleRate);
  buffer.getChannelData(0).set(played);
  const source = audio.createBufferSource();
  source.buffer = buffer;
  source.playbackRate.value = 1;
  source.connect(audio.destination);
  const when = active.anchor === undefined ? audio.currentTime + ARM_DELAY : active.anchor + active.queued;
  if (active.anchor === undefined) active.anchor = when;
  const before = audio.currentTime;
  source.start(when);
  // The device can wake inside start() and move currentTime past the whole
  // buffer. That source never sounds, and Chrome then drops it without an
  // end event. Schedule again on the clock it woke to.
  if (active && audio.currentTime > before + CLOCK_JUMP) {
    try {
      source.onended = null;
      source.stop();
    } catch {
      // Already gone.
    }
    const jump = audio.currentTime - before;
    if (active.anchor !== undefined) active.anchor += jump;
    const at = Math.max(0, active.origin + (audio.currentTime - active.anchor) * rate);
    sampleClock(audio);
    restartAt(audio, at);
    return;
  }
  active.tailEnded = false;
  const mark = performance.now();
  const dur = played.length / active.sampleRate;
  const from = (active.covered - pcm.length) / active.sampleRate;
  source.onended = () => {
    if (!active || !active.sources.includes(source)) return;
    const heard = (performance.now() - mark) / 1000;
    // Ended before it could have been said: the start time was already
    // behind the device clock. Play this audio from where it was missed.
    if (dur > 0.05 && heard < dur * 0.5) {
      noteClock(audio);
      if (active && active.sources.includes(source) && !active.ended) restartAt(audio, Math.max(0, from));
      return;
    }
    if (source !== active.sources.at(-1)) return;
    if (!active.finished || active.covered < total(active.chunks)) {
      active.tailEnded = true;
      return;
    }
    markEnded();
  };
  active.sources.push(source);
  active.queued += played.length / active.sampleRate;
  sampleClock(audio);
}

function total(chunks: Float32Array[]): number {
  return chunks.reduce((sum, chunk) => sum + chunk.length, 0);
}

function slice(chunks: Float32Array[], from: number, to: number): Float32Array {
  const out = new Float32Array(Math.max(0, to - from));
  let written = 0;
  let cursor = 0;
  for (const chunk of chunks) {
    const chunkFrom = cursor;
    const chunkTo = cursor + chunk.length;
    cursor = chunkTo;
    if (chunkTo <= from || chunkFrom >= to) continue;
    const lo = Math.max(from, chunkFrom) - chunkFrom;
    const hi = Math.min(to, chunkTo) - chunkFrom;
    out.set(chunk.subarray(lo, hi), written);
    written += hi - lo;
  }
  return out;
}

function cuesFor(step: Step | undefined, words: TimedWord[]): Cue[] {
  if (!step || !words.length) return [];
  const end = words[words.length - 1]?.to ?? 0;
  return capCues(cuesFromWords(step.segments, words), Math.max(end, 0));
}

export function pauseStream() {
  if (!active || !ctx || ctx.state !== "running") return;
  void ctx.suspend();
}

export function resumeStream() {
  if (!active || !ctx || ctx.state !== "suspended") return;
  void ctx.resume();
}
