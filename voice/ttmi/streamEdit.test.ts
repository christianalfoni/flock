import { describe, expect, test } from "vitest";
import { createStreamEdit } from "./streamEdit";

describe("silence in a stream", () => {
  test("puts the lead-in and a hold in front of the word they belong to", () => {
    const edit = createStreamEdit(
      [{ text: "Hello " }, { text: "there.", hold: 0.5 }],
      0.2,
      10,
    );
    const samples = new Float32Array(20);
    samples.fill(0.2);
    const words = [
      { text: "Hello", start: 0, end: 5, from: 0.2, to: 0.8 },
      { text: "there", start: 6, end: 11, from: 1, to: 1.8 },
    ];
    const out = edit.emit(samples, words);
    // 0.2 s of lead-in and 0.5 s of hold, at 10 Hz.
    expect(out.samples.length).toBe(20 + 2 + 5);
    expect(out.samples[0]).toBe(0);
    expect(out.words[0]!.from).toBeCloseTo(0.4);
    expect(out.words[1]!.from).toBeCloseTo(1.7);
  });
});
