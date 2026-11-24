import { describe, expect, test } from "vitest";
import { heardRate, nextPlaybackSpeed, PLAYBACK_SPEEDS } from "./playbackSpeed";

describe("playback speed", () => {
  test("the button cycles and comes back to 1×", () => {
    let speed: (typeof PLAYBACK_SPEEDS)[number] = 1;
    const seen: (typeof PLAYBACK_SPEEDS)[number][] = [speed];
    for (let step = 0; step < PLAYBACK_SPEEDS.length; step++) {
      speed = nextPlaybackSpeed(speed);
      seen.push(speed);
    }
    expect(seen).toEqual([1, 1.25, 1.5, 2, 1]);
  });

  test("the voice adjustment multiplies the button, and 1× at 1.00 is native", () => {
    expect(heardRate(1, 1)).toBe(1);
    expect(heardRate(1, 0.8)).toBeCloseTo(0.8);
    expect(heardRate(1.25, 1.2)).toBeCloseTo(1.5);
    expect(heardRate(2, 0.9)).toBeCloseTo(1.8);
    expect(heardRate(1, 4)).toBe(1.2);
  });
});
