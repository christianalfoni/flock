// Playback camera moves run one at a time. A step's opening glide and the
// arrow draw that belongs to it both finish before a highlight's camera
// move starts. User navigation drops the queue. A narration that runs
// ahead keeps only the latest waiting highlight, and at most one waiting
// step refit, so the queue cannot grow without bound.
import { describe, expect, it } from "vitest";
import { CAMERA_GLIDE_MS, clearMoves, createPlaybackQueue, enqueueMove, finishMove, type PlaybackMove, type PlaybackQueue } from "../src/playbackQueue";

function step(target: string, arrowKey?: string): PlaybackMove<string> {
  return { kind: "step", target, ...(arrowKey ? { arrowKey } : {}) };
}

function highlight(target: string): PlaybackMove<string> {
  return { kind: "highlight", target };
}

function enqueue(queue: PlaybackQueue<string>, move: PlaybackMove<string>, cameraDone = false) {
  return enqueueMove(queue, move, { cameraDone });
}

describe("playback camera queue", () => {
  it("keeps the camera glide at the duration the board already waited", () => {
    expect(CAMERA_GLIDE_MS).toBe(450);
  });

  it("runs moves in order, and a later highlight replaces one that is still waiting", () => {
    let queue = createPlaybackQueue<string>();
    const opening = enqueue(queue, step("frame"));
    expect(opening.start?.move.target).toBe("frame");
    queue = opening.queue;
    queue = enqueue(queue, highlight("worker")).queue;
    queue = enqueue(queue, highlight("queue")).queue;
    expect(queue.active?.move.target).toBe("frame");
    expect(queue.pendingHighlight?.target).toBe("queue");
    const done = finishMove(queue, "camera");
    expect(done.start?.move.target).toBe("queue");
    expect(done.queue.pendingHighlight).toBeNull();
  });

  it("finishes a step's camera glide and its arrow draw before a highlight move starts", () => {
    let queue = createPlaybackQueue<string>();
    queue = enqueue(queue, step("frame", "hop:1")).queue;
    queue = enqueue(queue, highlight("worker")).queue;
    const camera = finishMove(queue, "camera");
    expect(camera.start).toBeNull();
    expect(camera.queue.active?.move.target).toBe("frame");
    expect(camera.queue.active?.cameraDone).toBe(true);
    expect(camera.queue.active?.arrowDone).toBe(false);
    const arrow = finishMove(camera.queue, "arrow");
    expect(arrow.start?.move.target).toBe("worker");
    expect(arrow.queue.active?.move.kind).toBe("highlight");
  });

  it("runs a waiting step refit before the highlight, after the opening move", () => {
    let queue = createPlaybackQueue<string>();
    queue = enqueue(queue, step("frame", "hop:1")).queue;
    queue = enqueue(queue, highlight("worker")).queue;
    queue = enqueue(queue, step("frame-open")).queue;
    expect(queue.pendingStep?.target).toBe("frame-open");
    expect(queue.pendingHighlight?.target).toBe("worker");
    const opened = finishMove(finishMove(queue, "camera").queue, "arrow");
    expect(opened.start?.move.target).toBe("frame-open");
    expect(opened.queue.pendingHighlight?.target).toBe("worker");
    const next = finishMove(opened.queue, "camera");
    expect(next.start?.move.target).toBe("worker");
  });

  it("starts a highlight immediately once nothing is running", () => {
    const queue = createPlaybackQueue<string>();
    const started = enqueue(queue, highlight("worker"));
    expect(started.start?.move.target).toBe("worker");
    expect(started.start?.animate).toBe(true);
    expect(started.queue.pendingHighlight).toBeNull();
  });

  it("drops the active move and anything waiting when the user takes over, and the next playback move starts at once", () => {
    let queue = createPlaybackQueue<string>();
    queue = enqueue(queue, step("frame", "hop:1")).queue;
    queue = enqueue(queue, highlight("worker")).queue;
    queue = enqueue(queue, step("frame-open")).queue;
    queue = clearMoves(queue);
    expect(queue.active).toBeNull();
    expect(queue.pendingStep).toBeNull();
    expect(queue.pendingHighlight).toBeNull();
    // A finish signal from the move that was cancelled starts nothing.
    expect(finishMove(queue, "camera").start).toBeNull();
    expect(finishMove(queue, "arrow").start).toBeNull();
    const again = enqueue(queue, highlight("queue"));
    expect(again.start?.move.target).toBe("queue");
  });

  it("does not grow when the narration runs ahead of the picture", () => {
    let queue = createPlaybackQueue<string>();
    queue = enqueue(queue, step("frame", "hop:1")).queue;
    for (let n = 0; n < 40; n++) queue = enqueue(queue, highlight(`shape-${n}`)).queue;
    expect(queue.active?.move.target).toBe("frame");
    expect(queue.pendingHighlight?.target).toBe("shape-39");
    expect(queue.pendingStep).toBeNull();
    const names = [queue.active?.move.target, queue.pendingStep?.target, queue.pendingHighlight?.target].filter((name) => name !== undefined);
    expect(names).toEqual(["frame", "shape-39"]);
  });
});
