// When a step's references are said (docs/plan-voice-cues.md, The engine).
import { describe, expect, test } from "vitest";
import { capCues, cueAt, cuesByLength, cueTimes, joinPieces, type Segment } from "./cues";

const segments: Segment[] = [{ text: "When " }, { text: "the worker", name: "worker" }, { text: " fails, " }, { text: "a backoff", name: "retry" }, { text: "." }];

describe("joining the pieces", () => {
  test("keeps a space where the text had one, and none before punctuation", () => {
    const { input, starts } = joinPieces(segments, ["wɛn", "ðə wˈɜːkɚ", "fˈeɪlz,", "ɐ bˈækɔf", "."]);
    expect(input).toBe("wɛn ðə wˈɜːkɚ fˈeɪlz, ɐ bˈækɔf.");
    expect(starts).toEqual([0, 4, 14, 22, 30]);
  });

  test("skips a piece with no sound", () => {
    expect(joinPieces([{ text: "A " }, { text: " ", name: "x" }, { text: " b" }], ["ɐ", "", "bˈi"]).input).toBe("ɐ bˈi");
  });
});

describe("cue times", () => {
  // Padding, then ten tokens of 2 frames, then padding; 24 frames in all,
  // 600 samples a frame.
  const durations = [1, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 3];
  const timed = (tokenStarts: number[]) => cueTimes({ segments, tokenStarts, durations, samples: 24 * 600, rate: 24000 });

  test("a reference starts after the padding and the tokens ahead of it, and ends where the next piece starts", () => {
    expect(timed([0, 2, 5, 7, 9])).toEqual([
      { name: "worker", from: 0.125, to: 0.275 },
      { name: "retry", from: 0.375, to: 0.475 },
    ]);
  });

  test("a reference at the end ends before the last padding", () => {
    const end = cueTimes({ segments: [{ text: "Look at " }, { text: "it", name: "it" }], tokenStarts: [0, 8], durations, samples: 24 * 600, rate: 24000 });
    expect(end).toEqual([{ name: "it", from: 0.425, to: 0.525 }]);
  });

  test("a reference cut off by the length limit is at the clip's end", () => {
    expect(timed([0, 2, 5, 400, 401])[1]).toEqual({ name: "retry", from: 0.6, to: 0.6 });
  });
});

test("a shape stays pointed at until the next reference, and the last one stays", () => {
  const cues = [{ name: "queue", from: 0.5, to: 0.9 }, { name: "worker", from: 2, to: 2.4 }];
  expect(cueAt(cues, 0.2)).toBeUndefined();
  expect(cueAt(cues, 0.6)?.name).toBe("queue");
  expect(cueAt(cues, 1.5)?.name).toBe("queue");
  expect(cueAt(cues, 2.1)?.name).toBe("worker");
  expect(cueAt(cues, 9)?.name).toBe("worker");
});

test("the fake voice times references by their length", () => {
  expect(cuesByLength([{ text: "abcd" }, { text: "ef", name: "x" }, { text: "gh" }], 4)).toEqual([{ name: "x", from: 2, to: 3 }]);
});

test("cues end where the trimmed clip ends", () => {
  const cues = [{ name: "a", from: 0.2, to: 1.1 }, { name: "b", from: 1.1, to: 2.4 }, { name: "c", from: 2.6, to: 2.8 }];
  expect(capCues(cues, 2.3)).toEqual([{ name: "a", from: 0.2, to: 1.1 }, { name: "b", from: 1.1, to: 2.3 }, { name: "c", from: 2.3, to: 2.3 }]);
});
