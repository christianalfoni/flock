// Speaking the step on screen, once its clip is there: played at once if
// the browser lets it, otherwise at the page's first click or key, and
// followed from cue to cue while it plays, so the shape its words are about
// is pointed at (docs/plan-voice-cues.md). The board's engine makes the
// clip (useNarration.ts); the front page's demo has it ready made
// (docs/plan-landing-demo.md). Returns what stops it.
import { cueAt } from "./cues";
import { onFirstGesture, play, playedFraction, playedSeconds, release } from "./player";
import type { Cue } from "./protocol";
import { watchStream } from "./stream";

export type SpeakHandlers = {
  // The clip is there, or could not be made.
  made?(): void;
  failed?(): void;
  speaking(yes: boolean): void;
  needsGesture(yes: boolean): void;
  pointing(name: string): void;
  // The first sound of the step.
  heard(): void;
  // It played to its end.
  ended?(): void;
  // How much of the clip has been said, 0 to 1, every frame while it plays.
  progress?(fraction: number): void;
};

// A cue fires this much before its word, so the board's marker sets off
// early and arrives as the word is said (a pointing gesture leads its
// word, median 0.75 s: Morrel-Samuels & Krauss 1992; docs/board.md, Marker).
export const CUE_LEAD = 0.45;

export function speakStep(clip: Promise<{ url: string; cues: Cue[] }>, text: string, on: SpeakHandlers): () => void {
  let live = true;
  let started = false;
  let stopGesture: (() => void) | undefined;
  const shownCues: { current: Cue[] } = { current: [] };
  // While the clip plays, follow it from cue to cue; when it ends the
  // last one stays.
  let frame = 0;
  const follow = () => {
    cancelAnimationFrame(frame);
    if (!live || (!shownCues.current.length && !on.progress)) return;
    let shown: string | undefined;
    const tick = () => {
      if (!live) return;
      on.progress?.(playedFraction());
      const cues = shownCues.current;
      const name = cues.length ? cueAt(cues, playedSeconds() + CUE_LEAD)?.name : undefined;
      if (name && name !== shown) {
        shown = name;
        if (!live) return;
        on.pointing(name);
        window.ttmiVoicePointed?.push(name);
      }
      // A stop that landed inside this tick must not schedule another.
      if (!live) return;
      frame = requestAnimationFrame(tick);
    };
    tick();
  };
  const begin = () => {
    if (!live || started) return;
    started = true;
    on.speaking(true);
    on.heard();
    window.ttmiVoiceSpoken?.push(text);
    follow();
  };
  const stopWatch = watchStream((snap) => {
    if (!live) return;
    if (snap.cues.length) shownCues.current = snap.cues;
    if (snap.playing) begin();
  });
  const speak = (url: string, cues: Cue[]) => {
    if (!live) return;
    shownCues.current = cues;
    on.speaking(true);
    void play(url, () => {
      // The clip can start after the walkthrough has left this step.
      if (!live) return;
      begin();
    }).then((result) => {
      if (!live) return;
      on.speaking(false);
      if (result === "done") {
        cancelAnimationFrame(frame);
        on.progress?.(1);
        return on.ended?.();
      }
      on.needsGesture(true);
      stopGesture = onFirstGesture(() => {
        if (!live) return;
        on.needsGesture(false);
        started = false;
        speak(url, cues);
      });
    });
  };
  void clip.then((made) => {
    if (!live) return;
    on.made?.();
    shownCues.current = made.cues;
    speak(made.url, made.cues);
  }, () => {
    if (!live) return;
    on.failed?.();
    // No voice for this step: show its words rather than wait for ever.
    if (!live) return;
    on.heard();
  });
  return () => {
    live = false;
    cancelAnimationFrame(frame);
    stopWatch();
    stopGesture?.();
    // The press that left this step may have started the next one's clip.
    release();
  };
}
