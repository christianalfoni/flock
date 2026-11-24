// Playing spoken steps. Browsers refuse sound before the page has had a
// click or a key, and Safari also plays later only from an element that
// first played inside one. So the press that moves to a step starts its
// clip itself when it is made (prime), on the one element every step uses;
// the step's speaker then takes over the sound already playing (play). A
// clip that arrives later plays on that element, which the press unlocked
// (docs/plan-voice.md, Playback). There is no silent unlocking clip: it
// was swapped for the real one within milliseconds of the same press.
import { voiceDebug, voiceDebugTrace } from "./debug";
import { mediaTime, pauseStream, resumeStream, setStreamRate, stopStream, streamDone, streamFraction, streamOwnsClock, streamPaused, unlockStream, warmStream } from "./stream";

let element: HTMLAudioElement | undefined;
let unlocked = false;
let rate = 1;
// A silent play inside the gesture that opened a canvas, so the step that
// starts when the zoom lands may speak. The gesture's call stack is gone
// by then. Cleared once a real clip takes the element.
let unlocking = false;
const SILENT_WAV = "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=";

// Call from the click or key that zooms into a canvas. The element is then
// allowed to play the step when the zoom finishes.
export function unlockPlayback() {
  unlocked = true;
  const player = audio();
  if (current || primed) return;
  unlocking = true;
  applyRate(player);
  player.src = SILENT_WAV;
  void player.play().then(() => {
    if (!unlocking) return;
    unlocking = false;
    player.pause();
  }, () => {
    unlocking = false;
  });
}

// Client-side speed for a clip (Inworld or Kokoro). Pitch stays put.
export function setPlaybackRate(next: number) {
  rate = next;
  setStreamRate(next);
  if (!element) audio();
  applyRate(element!);
}

function applyRate(player: HTMLAudioElement) {
  const pitched = player as HTMLAudioElement & { preservesPitch?: boolean; webkitPreservesPitch?: boolean; mozPreservesPitch?: boolean };
  pitched.preservesPitch = true;
  pitched.webkitPreservesPitch = true;
  pitched.mozPreservesPitch = true;
  // Assigning src runs the media load algorithm, which sets playbackRate
  // back to defaultPlaybackRate (1 unless we say otherwise). The press
  // that starts a step sets the rate and then the clip, so a rate kept
  // only on playbackRate is gone before the first sample: 1.25×, 1.5× and
  // 2× all play at 1×. defaultPlaybackRate is what the load keeps.
  if (Math.abs(player.defaultPlaybackRate - rate) > 0.001) player.defaultPlaybackRate = rate;
  if (Math.abs(player.playbackRate - rate) > 0.001) player.playbackRate = rate;
}
const gestures = new Set<() => void>();

// The press is about to stream. The context has to resume inside the
// gesture, and not on a clip the element will play: opening it there
// drops the start of that clip.
export function prepareStream() {
  warmStream();
}

const audio = () => {
  if (!element) {
    element = new Audio();
    element.className = "ttmi-voice";
    element.setAttribute("aria-hidden", "true");
    applyRate(element);
    // A load can still put the rate back after src, including on a browser
    // that does it once metadata arrives. Put the chosen rate back. A set
    // that does not stick must not retry forever.
    let restoring = false;
    const keepRate = () => {
      const player = element;
      if (!player || restoring) return;
      if (Math.abs(player.playbackRate - rate) <= 0.001 && Math.abs(player.defaultPlaybackRate - rate) <= 0.001) return;
      restoring = true;
      try {
        applyRate(player);
      } finally {
        restoring = false;
      }
    };
    for (const type of ["loadedmetadata", "play", "ratechange"] as const) element.addEventListener(type, keepRate);
    if (typeof document !== "undefined") document.body.appendChild(element);
    // What the element itself says, for the debug log.
    for (const type of ["play", "playing", "pause", "ended", "error", "stalled", "waiting", "emptied", "abort", "suspend"]) {
      element.addEventListener(type, () => voiceDebug(`audio ${type}`, { at: element!.currentTime, duration: element!.duration, src: element!.src.slice(0, 40), error: element!.error?.message }));
    }
  }
  return element;
};

// When a gesture last started waiting sound: the click it belongs to is
// not also a click on what it landed on (the chip would mute).
let consumedAt = -Infinity;
export const justStartedSound = () => performance.now() - consumedAt < 1000;

function onGesture() {
  if (gestures.size) consumedAt = performance.now();
  unlocked = true;
  unlockStream();
  for (const listener of [...gestures]) listener();
  gestures.clear();
}

if (typeof window !== "undefined") {
  for (const type of ["pointerdown", "keydown"] as const) window.addEventListener(type, onGesture, { capture: true });
}

// Runs once at the next click or key on the page.
export function onFirstGesture(listener: () => void) {
  gestures.add(listener);
  return () => gestures.delete(listener);
}

let current: { resolve(): void } | undefined;
// A clip the reader's press started, until its step's speaker takes it
// over: whether it began, or was refused.
let primed: { url: string; started: Promise<boolean> } | undefined;

// The test build can act as a browser that refuses sound before a click
// (window.ttmiVoiceFake.needsGesture); headless Chromium never refuses.
const refusesSound = () => !unlocked && typeof window !== "undefined" && window.ttmiVoiceFake?.needsGesture === true;

// Starts a clip inside the reader's press, before the board has moved to
// its step; the step's speaker calls play with the same url and takes it
// over. Whatever played before falls silent, its speaker let go by release.
export function prime(url: string) {
  unlocking = false;
  const player = audio();
  if (refusesSound()) return;
  voiceDebug("prime", url.slice(0, 40));
  applyRate(player);
  if (!player.paused) player.pause();
  player.onended = null;
  player.onerror = null;
  window.ttmiVoiceLog?.push("play");
  player.src = url;
  applyRate(player);
  player.volume = 1;
  primed = {
    url,
    started: player.play().then(() => true, (error: unknown) => {
      voiceDebug("prime refused", error);
      return false;
    }),
  };
}

// Plays a clip; resolves when it ends or is stopped, or with "blocked"
// when the browser refuses sound until the page gets a click or a key.
const waitingForGesture = (error: unknown) => error === undefined || (error instanceof DOMException && (error.name === "NotAllowedError" || error.name === "AbortError"));

export function play(url: string, onStart?: () => void): Promise<"done" | "blocked"> {
  if (streamOwnsClock()) {
    // Reading the fraction settles a device clock that jumped while the
    // page was quiet: the stream is put back to where the clip actually
    // is. A fraction that is still at the end belongs to audio that has
    // already been said. Following it would finish this step at once.
    if ((streamFraction() ?? 0) < 1) {
      onStart?.();
      return streamDone().then(() => "done" as const);
    }
    stopStream();
  }
  unlocking = false;
  const adopted = primed?.url === url ? primed : undefined;
  if (adopted) {
    // Started by the press: only the old speaker is let go.
    primed = undefined;
    current?.resolve();
    current = undefined;
  } else stop();
  const player = audio();
  voiceDebug(adopted ? "play (started by the press)" : "play", url.slice(0, 40));
  if (!adopted && refusesSound()) return Promise.resolve("blocked");
  return new Promise((resolve) => {
    const done = (result: "done" | "blocked" = "done") => {
      if (current?.resolve === finish) current = undefined;
      window.ttmiVoiceLog?.push("end");
      resolve(result);
    };
    const finish = () => done();
    current = { resolve: finish };
    // One retry when the element reports the clip over before it has
    // sounded: a stale ended flag, or the device waking under the start.
    let retried = false;
    const endedBeforeItPlayed = () => player.ended && !(player.currentTime > 0.05);
    const started = (ok: boolean, error?: unknown) => {
      if (current?.resolve !== finish) return;
      if (ok) {
        voiceDebug("play started");
        return onStart?.();
      }
      voiceDebug("play refused", error);
      if (!retried && error instanceof DOMException && error.name === "AbortError") {
        retried = true;
        player.currentTime = 0;
        void player.play().then(() => started(true), (again: unknown) => started(false, again));
        return;
      }
      done(waitingForGesture(error) ? "blocked" : "done");
    };
    player.onended = finish;
    player.onerror = () => {
      if (!retried && endedBeforeItPlayed()) {
        retried = true;
        player.currentTime = 0;
        void player.play().then(() => started(true), (error: unknown) => started(false, error));
        return;
      }
      finish();
    };
    if (adopted) {
      applyRate(player);
      if (endedBeforeItPlayed()) {
        retried = true;
        player.currentTime = 0;
        void player.play().then(() => started(true), (error: unknown) => started(false, error));
        return;
      }
      if (player.ended) return finish();
      void adopted.started.then((ok) => started(ok));
      return;
    }
    window.ttmiVoiceLog?.push("play");
    applyRate(player);
    player.src = url;
    applyRate(player);
    player.volume = 1;
    player.play().then(() => {
      if (endedBeforeItPlayed()) {
        retried = true;
        player.currentTime = 0;
        void player.play().then(() => started(true), (error: unknown) => started(false, error));
        return;
      }
      started(true);
    }, (error: unknown) => started(false, error));
  });
}

// How far the clip playing now has got, in seconds.
export function playedSeconds() {
  if (streamOwnsClock()) return mediaTime() ?? 0;
  return element && current ? element.currentTime : 0;
}

// How much of the clip playing now has been said, 0 to 1.
export function playedFraction() {
  if (streamOwnsClock()) return streamFraction() ?? 0;
  const duration = element?.duration;
  return element && current && duration && Number.isFinite(duration) ? Math.min(1, element.currentTime / duration) : 0;
}

// Holds the clip where it is. The step's speaker keeps following it, so
// the fraction stays put until resumePlayback.
export function pausePlayback() {
  if (streamOwnsClock()) return pauseStream();
  const player = element;
  if (player && current && !player.paused) player.pause();
}

// A clip held in the middle, so a resume continues it. A step the reader
// came back to has nothing sounding yet.
export function pausedClip() {
  if (streamPaused()) return true;
  return Boolean(element && current && element.paused && element.currentTime > 0 && !element.ended);
}

export function resumePlayback() {
  if (streamOwnsClock()) return resumeStream();
  const player = element;
  if (player && current && player.paused) void player.play();
}

export function stop() {
  stopStream();
  const player = element;
  if (current || primed || (player && !player.paused)) voiceDebugTrace("stop", { at: player?.currentTime });
  if (player && !player.paused) player.pause();
  primed = undefined;
  current?.resolve();
  current = undefined;
}

// A step's speaker letting go as the board leaves its step. The press may
// already have started the next clip on the element: that keeps playing.
// The stream does not. A clip that has said everything can still own the
// clock afterwards, while its end event is on the way (the worker is
// finishing the clip, or the source has not closed). The next play() would
// follow that leftover and finish the new step at once.
export function release() {
  if (!primed) return stop();
  stopStream();
  current?.resolve();
  current = undefined;
}
