import { describe, expect, test } from "vitest";
import { timeStretch } from "./stretch";

const RATE = 24000;

function tone(hz: number, seconds: number, harmonics = 1): Float32Array {
  const samples = new Float32Array(Math.round(RATE * seconds));
  for (let i = 0; i < samples.length; i++) {
    let value = 0;
    for (let n = 1; n <= harmonics; n++) value += Math.sin((2 * Math.PI * hz * n * i) / RATE) / n;
    samples[i] = value * 0.4;
  }
  return samples;
}

function pitch(samples: Float32Array): number {
  const frame = Math.round(RATE * 0.05);
  const at = Math.max(0, Math.round(samples.length / 2 - frame / 2));
  const lo = Math.round(RATE / 400);
  const hi = Math.round(RATE / 80);
  let best = Number.NEGATIVE_INFINITY;
  let lag = lo;
  for (let candidate = lo; candidate <= hi; candidate++) {
    let acc = 0;
    for (let i = 0; i < frame - candidate; i += 2) acc += samples[at + i]! * samples[at + i + candidate]!;
    if (acc > best) {
      best = acc;
      lag = candidate;
    }
  }
  return RATE / lag;
}

describe("playback time stretch", () => {
  test("leaves a clip untouched at 1×", () => {
    const samples = tone(180, 0.3);
    expect(timeStretch(samples, 1, RATE)).toBe(samples);
  });

  test("keeps the pitch when the clip is slowed or sped, and the length follows the rate", () => {
    const samples = tone(180, 0.6, 3);
    const original = pitch(samples);
    for (const rate of [0.8, 1.2, 1.8]) {
      const stretched = timeStretch(samples, rate, RATE);
      expect(stretched.length).toBe(Math.round(samples.length / rate));
      expect(pitch(stretched)).toBeGreaterThan(original - 8);
      expect(pitch(stretched)).toBeLessThan(original + 8);
    }
  });
});
