// The silences put into Kokoro's clips (audio.ts), on synthetic audio: a
// tone with quiet stretches where a model would have paused.
import { describe, expect, test } from "vitest";
import { coldOnsetCut, holdAt, openColdTrim, quietNear, tightenCompoundGaps, trimColdOnset, trimTail } from "./audio";

const RATE = 1000;
// A loud 50 Hz tone, silent where asked.
function clip(seconds: number, quiet: [number, number][] = []): Float32Array {
  const out = new Float32Array(Math.round(seconds * RATE));
  for (let i = 0; i < out.length; i++) {
    const t = i / RATE;
    out[i] = quiet.some(([from, to]) => t >= from && t < to) ? 0 : 0.5 * Math.sin(2 * Math.PI * 50 * t + 0.3);
  }
  return out;
}

describe("quietNear", () => {
  test("looks both ways by default, for cutting off the context", () => {
    const samples = clip(2, [[1.02, 1.04]]);
    expect(quietNear(samples, RATE, 1000)).toBeGreaterThan(1000);
  });

  test("looks only before the token when asked, so a gap never lands inside a word", () => {
    const samples = clip(2, [[0.9, 0.92], [1.02, 1.04]]);
    const at = quietNear(samples, RATE, 1000, 0);
    expect(at).toBeLessThanOrEqual(1000);
    expect(at).toBeGreaterThanOrEqual(900);
    expect(at).toBeLessThan(920);
  });
});

describe("the cold opening", () => {
  const rate = 1000;

  test("drops the tick and the quiet before the voice, and fades what remains", () => {
    const samples = new Float32Array(200);
    for (let i = 0; i < 20; i++) samples[i] = 0.003;
    for (let i = 100; i < samples.length; i++) samples[i] = 0.2;
    const cut = coldOnsetCut(samples, rate);
    expect(cut).toBe(88);
    const trimmed = trimColdOnset(samples, rate);
    expect(trimmed.skipped).toBe(88);
    expect(trimmed.samples[0]).toBe(0);
    expect(trimmed.samples.at(-1)).toBeCloseTo(0.2);
  });

  test("leaves a voice that is already there", () => {
    const samples = new Float32Array(50).fill(0.2);
    expect(coldOnsetCut(samples, rate)).toBe(0);
    expect(trimColdOnset(samples, rate).samples).toBe(samples);
  });

  test("waits, while a stream is still in the quiet opening", () => {
    const trim = openColdTrim(rate);
    expect(trim.push(new Float32Array(40), false).length).toBe(0);
    const tone = new Float32Array(80);
    for (let i = 40; i < tone.length; i++) tone[i] = 0.2;
    const out = trim.push(tone, true);
    expect(trim.skipped()).toBeGreaterThan(0);
    expect(out[0]).toBe(0);
    expect(out.at(-1)).toBeCloseTo(0.2);
    expect(trim.push(Float32Array.from([0.2, 0.2]), false)).toEqual(Float32Array.from([0.2, 0.2]));
  });
});

describe("a hyphenated word", () => {
  test("joins the syllable to the restart and moves the later words back", () => {
    const rate = 1000;
    const samples = new Float32Array(400);
    samples.fill(0.2);
    samples.fill(0, 100, 300);
    const closed = tightenCompoundGaps(samples, rate, [{ text: "test-run", from: 0, to: 0.4 }, { text: "controls", from: 0.4, to: 0.5 }]);
    expect(closed.samples.length).toBeLessThan(200);
    expect(closed.samples.length).toBeGreaterThan(100);
    expect(closed.words[1]!.from).toBeLessThan(0.3);
    const quiet = closed.samples.filter((sample) => Math.abs(sample) < 0.001).length;
    expect(quiet).toBe(0);
    // The join stays at the level of the syllable, with no step up to the old hole.
    let step = 0;
    for (let index = 1; index < closed.samples.length; index++) step = Math.max(step, Math.abs(closed.samples[index]! - closed.samples[index - 1]!));
    expect(step).toBeLessThan(0.05);
  });

  test("leaves a pause that does not restart", () => {
    const rate = 1000;
    const samples = new Float32Array(400);
    samples.fill(0.2);
    samples.fill(0, 100, 400);
    const closed = tightenCompoundGaps(samples, rate, [{ text: "test-run", from: 0, to: 0.4 }]);
    expect(closed.samples).toBe(samples);
  });
});

describe("holdAt", () => {
  // Two "tokens", the second starting at 1 s: durations in frames.
  const durations = [0, 100, 100];

  test("puts the silence before the token's start, so the token moves by exactly the hold", () => {
    const samples = clip(2, [[1.02, 1.06]]);
    const out = holdAt(samples, RATE, durations, [{ token: 1, seconds: 0.5 }]);
    expect(out.length).toBe(samples.length + 500);
    // Everything from the token's start on is the original, 0.5 s later.
    for (let i = 1000; i < 2000; i++) expect(out[i + 500]).toBeCloseTo(samples[i]!, 6);
  });

  test("fades out before each silence and in after it", () => {
    const samples = clip(2);
    const out = holdAt(samples, RATE, durations, [{ token: 1, seconds: 0.2 }]);
    // No quiet spot: the gap goes somewhere in the 0.25 s before 1 s.
    let start = -1;
    for (let i = 700; i < 1100; i++) if (out.slice(i, i + 200).every((value) => value === 0)) { start = i; break; }
    expect(start).toBeGreaterThanOrEqual(750);
    expect(start).toBeLessThanOrEqual(1000);
    const fade = Math.round(RATE * 0.005);
    // The last sample before the gap and the first after it are near zero,
    // where the tone itself is loud.
    expect(Math.abs(out[start - 1]!)).toBeLessThan(0.5 / fade + 1e-6);
    expect(Math.abs(out[start + 200]!)).toBe(0);
    expect(Math.abs(out[start + 200 + 1]!)).toBeLessThan(0.5 / fade + 1e-6);
    // Outside the fades, untouched.
    const at = start + 200 + fade + 5;
    expect(out[at]).toBeCloseTo(samples[at - 200]!, 6);
  });
});

describe("trimTail", () => {
  test("keeps 150 ms after the last sound and fades the last 10 ms", () => {
    const samples = clip(2, [[1, 2]]);
    const out = trimTail(samples, RATE);
    expect(out.length).toBe(1150);
    expect(out.at(-1)).toBe(0);
    expect(out.slice(0, 990)).toEqual(samples.slice(0, 990));
  });

  test("leaves a clip that ends on sound alone, but for the fade", () => {
    const samples = clip(1);
    const out = trimTail(samples, RATE);
    expect(out.length).toBe(1000);
    expect(Math.abs(out.at(-1)!)).toBeLessThan(0.06);
    expect(out.slice(0, 990)).toEqual(samples.slice(0, 990));
  });

  test("ignores a near-silent hiss after the last word", () => {
    const samples = clip(2, [[1, 2]]);
    for (let i = 1000; i < 2000; i++) samples[i] = 0.001 * Math.sin(i);
    expect(trimTail(samples, RATE).length).toBe(1150);
  });
});
