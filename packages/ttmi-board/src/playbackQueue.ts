// Playback camera moves wait their turn (docs/board.md, Walkthrough).
// The picture eases for 0.4s; the board already waited 450ms before it
// treated that glide as finished. The queue holds the camera leg for the
// same 450ms. An arrow draw that starts with the move has to finish too,
// and the board says when that draw is done. Only one highlight and one
// step refit wait: a newer one replaces the one of its kind, so a
// narration that runs ahead cannot grow the queue. A waiting step runs
// before a waiting highlight.

/** How long a playback camera glide owns the queue, matching the timer the board already used. */
export const CAMERA_GLIDE_MS = 450;

export type PlaybackKind = "step" | "highlight";

export type PlaybackMove<T> = {
  kind: PlaybackKind;
  target: T;
  /** An arrow draw that starts with this camera move and must finish with it. */
  arrowKey?: string;
};

export type PlaybackQueue<T> = {
  active: { move: PlaybackMove<T>; cameraDone: boolean; arrowDone: boolean } | null;
  /** A step move waiting. A newer step move replaces it. It runs before a waiting highlight. */
  pendingStep: PlaybackMove<T> | null;
  /** The latest highlight waiting. A newer highlight replaces it. */
  pendingHighlight: PlaybackMove<T> | null;
};

export type Started<T> = { move: PlaybackMove<T>; animate: boolean };

export type QueueChange<T> = { queue: PlaybackQueue<T>; start: Started<T> | null };

export function createPlaybackQueue<T>(): PlaybackQueue<T> {
  return { active: null, pendingStep: null, pendingHighlight: null };
}

function arm<T>(move: PlaybackMove<T>, cameraDone: boolean) {
  return { move, cameraDone, arrowDone: move.arrowKey === undefined };
}

// The step refit, if one is waiting, then the highlight.
function promote<T>(queue: PlaybackQueue<T>): QueueChange<T> {
  const next = queue.pendingStep ?? queue.pendingHighlight;
  if (!next) return { queue: createPlaybackQueue(), start: null };
  const tookStep = queue.pendingStep != null;
  return {
    queue: { active: arm(next, false), pendingStep: null, pendingHighlight: tookStep ? queue.pendingHighlight : null },
    start: { move: next, animate: true },
  };
}

/**
 * Add a playback move.
 * Nothing running: it starts now. `cameraDone` means the picture is already
 * there (a dive that landed on the step) and only an arrow draw can hold it.
 * Something running: a step waits behind it, and a highlight waits behind
 * that step. A second move of the same kind replaces the one that is waiting.
 */
export function enqueueMove<T>(queue: PlaybackQueue<T>, move: PlaybackMove<T>, options?: { cameraDone?: boolean }): QueueChange<T> {
  if (move.kind === "highlight" && (queue.active || queue.pendingStep)) {
    return { queue: { ...queue, pendingHighlight: move }, start: null };
  }
  if (move.kind === "step" && queue.active) {
    return { queue: { ...queue, pendingStep: move }, start: null };
  }
  const cameraDone = options?.cameraDone ?? false;
  if (cameraDone && move.arrowKey === undefined) return promote(queue);
  return {
    queue: { active: arm(move, cameraDone), pendingStep: queue.pendingStep, pendingHighlight: queue.pendingHighlight },
    start: { move, animate: !cameraDone },
  };
}

/** The camera glide or the arrow draw of the active move finished. The next move starts when both have. */
export function finishMove<T>(queue: PlaybackQueue<T>, part: "camera" | "arrow"): QueueChange<T> {
  const active = queue.active;
  if (!active) return { queue, start: null };
  const cameraDone = active.cameraDone || part === "camera";
  const arrowDone = active.arrowDone || part === "arrow";
  if (!cameraDone || !arrowDone) {
    return { queue: { ...queue, active: { move: active.move, cameraDone, arrowDone } }, start: null };
  }
  return promote({ ...queue, active: null });
}

/** User navigation: drop the move on screen and anything waiting. */
export function clearMoves<T>(queue: PlaybackQueue<T>): PlaybackQueue<T> {
  return createPlaybackQueue();
}
