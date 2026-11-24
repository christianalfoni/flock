// When Flock's canvases may make a sound: only after you asked for it.
//
// The voice is TTMI's (ttmi-voice). It sounds in three ways, and each has
// let a voice play by itself before:
//
//   1. A walkthrough's narration (useNarration, one per canvas kept in the
//      window) speaks the step on screen whenever its step effect runs and
//      the step is not held. That effect runs again on much more than a
//      press: the step changing, its words changing (a redraw), the voice
//      coming on (an agent shown again, an ask closed), the engine ready.
//   2. Speaking a step arms a stream for its clip. When the effect runs
//      again and finds the step held, it returns without disarming it, and
//      the stream starts by itself when the clip's audio arrives: a step
//      of a canvas left behind, heard on another one.
//   3. An ask's answer, read aloud by speakStep when you press Listen.
//   4. A step press: the narration primes the step's clip, and priming plays
//      it, loud, to start inside a key press. The board presses not only
//      for you: Flock opening a step itself (a drawing's play_from) is one
//      too, and that sounded with the walkthrough standing still.
//
// So there is one rule, kept here: you open the voice with a press on a
// canvas (grant), and it is closed when you leave the agent, or a drawing
// merges while the walkthrough is not playing (revoke).
// Closing also stops whatever is sounding and disarms what is armed (2).
// The narration asks voiceAllowed() at the moment it would speak (canvas.tsx,
// its hold), a step press reaches it only while the voice is open (4), and
// as a last line, anything that starts sounding while the
// voice is closed is stopped as it starts (guard).
import { stopPlayback, watchStream } from "ttmi-voice";

let open = false;

// The voice may sound now.
export function voiceAllowed() {
  return open;
}

// You pressed something on a canvas that asks to hear it.
export function grantVoice() {
  open = true;
}

// Closed, and silent at once: what sounds is stopped, what is armed
// is dropped.
export function revokeVoice() {
  open = false;
  stopPlayback();
}

// The keys and the controls on a canvas that ask to hear it.
// Going back (← or the previous step button) does not: the step before opens
// paused, for Space to play.
const KEYS = new Set([" ", "Enter", "ArrowRight"]);
const CONTROLS = ".sketch-steps button:not([title^='Previous step']), .sketch-start, .sketch-ask-send, .sketch-link, .sketch-ref";

export function asksToHear(event: Event): boolean {
  const target = event.target as Element | null;
  if (event instanceof KeyboardEvent) return KEYS.has(event.key) && !target?.closest?.("textarea, input");
  return Boolean(target?.closest?.(CONTROLS));
}

// The last line: a sound that starts while the voice is closed is stopped.
// Once for the window: every audio element's play, and the stream.
let guarded = false;
export function guardVoice() {
  if (guarded) return;
  guarded = true;
  const play = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function (this: HTMLMediaElement) {
    const started = play.call(this);
    if (!open) void started.then(() => { if (!open) stopPlayback(); }, () => undefined);
    return started;
  };
  watchStream((snap) => {
    if (snap.playing && !open) stopPlayback();
  });
}
