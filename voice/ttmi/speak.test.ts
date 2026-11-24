// A step's speaker stops naming shapes once the walkthrough leaves the
// step (docs/plan-voice-cues.md). A clip that starts late, or a frame
// already queued, must not point after that.
import { afterEach, describe, expect, test, vi } from "vitest";

const play = vi.hoisted(() => vi.fn());
vi.mock("./player", () => ({
  play,
  release: vi.fn(),
  playedFraction: () => 1,
  playedSeconds: () => 10,
  onFirstGesture: () => () => {},
}));

import { speakStep } from "./speak";

const frames = new Map<number, FrameRequestCallback>();
let nextFrame = 1;

describe("a step's speaker", () => {
  afterEach(() => {
    frames.clear();
    play.mockReset();
    vi.unstubAllGlobals();
  });

  test("does not point after it is stopped, not from a late start and not from a queued frame", async () => {
    vi.stubGlobal("window", { ttmiVoiceSpoken: [] as string[], ttmiVoicePointed: [] as string[] });
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      const id = nextFrame++;
      frames.set(id, callback);
      return id;
    });
    vi.stubGlobal("cancelAnimationFrame", (id: number) => {
      frames.delete(id);
    });
    let start: (() => void) | undefined;
    play.mockImplementation((_url: string, onStart?: () => void) => {
      start = onStart;
      return new Promise(() => {});
    });
    const pointing = vi.fn();
    const stop = speakStep(Promise.resolve({ url: "blob:step", cues: [{ name: "capture", from: 0, to: 1 }] }), "Capturing keeps it.", {
      speaking: () => {},
      needsGesture: () => {},
      pointing,
      heard: () => {},
    });
    await Promise.resolve();
    start?.();
    expect(pointing).toHaveBeenCalledWith("capture");
    const queued = [...frames.values()];
    expect(queued.length).toBe(1);
    pointing.mockClear();
    stop();
    start?.();
    for (const callback of queued) callback(0);
    expect(pointing).not.toHaveBeenCalled();
  });
});
