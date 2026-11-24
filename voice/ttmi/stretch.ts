// Playback-only time stretch. The samples Gradium made are not changed in
// the clip. A rate under 1 takes longer, over 1 takes less, and the pitch
// stays: overlap-add follows the waveform instead of resampling it.
// `rate` is how fast the original timeline is heard (1 is unchanged).

const WINDOW_SEC = 0.02;
const SEEK_SEC = 0.01;

export function timeStretch(input: Float32Array, rate: number, sampleRate: number): Float32Array {
  if (input.length === 0 || !(rate > 0) || Math.abs(rate - 1) < 1e-3) return input;
  const target = Math.max(1, Math.round(input.length / rate));
  let win = Math.round(sampleRate * WINDOW_SEC);
  if (input.length < win * 4) win = Math.max(32, Math.floor(input.length / 4));
  if (win < 8 || input.length < win) return fit(input, target);
  const synth = Math.max(1, Math.round(win / 2));
  const analysis = Math.max(1, Math.round(synth * rate));
  const seek = Math.max(1, Math.round(sampleRate * SEEK_SEC));
  const out = new Float32Array(target + win);
  const norm = new Float32Array(out.length);
  const hann = new Float32Array(win);
  for (let i = 0; i < win; i++) hann[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / win);
  const place = (inAt: number, outAt: number) => {
    const n = Math.min(win, input.length - inAt, out.length - outAt);
    for (let i = 0; i < n; i++) {
      const weight = hann[i]!;
      out[outAt + i] = (out[outAt + i] ?? 0) + input[inAt + i]! * weight;
      norm[outAt + i] = (norm[outAt + i] ?? 0) + weight;
    }
  };
  let inAt = 0;
  let outAt = 0;
  place(0, 0);
  while (outAt + synth < target && inAt + win < input.length) {
    const nominal = Math.min(input.length - win, inAt + analysis);
    const prev = outAt + synth;
    let best = nominal;
    let bestScore = Number.NEGATIVE_INFINITY;
    const from = Math.max(0, nominal - seek);
    const to = Math.min(input.length - win, nominal + seek);
    const overlap = Math.min(synth, win);
    for (let cand = from; cand <= to; cand++) {
      let score = 0;
      for (let i = 0; i < overlap; i += 2) {
        const weight = norm[prev + i] ?? 0;
        const heard = weight > 1e-6 ? (out[prev + i] ?? 0) / weight : 0;
        score += heard * input[cand + i]!;
      }
      if (score > bestScore) {
      bestScore = score;
      best = cand;
    }
    }
    if (best <= inAt) best = Math.min(input.length - win, inAt + Math.max(1, analysis));
    if (best <= inAt) break;
    inAt = best;
    outAt = prev;
    place(inAt, outAt);
  }
  const result = new Float32Array(target);
  const end = Math.min(target, out.length);
  for (let i = 0; i < end; i++) {
    const weight = norm[i] ?? 0;
    result[i] = weight > 1e-6 ? (out[i] ?? 0) / weight : 0;
  }
  return result;
}

// A snippet shorter than a window. Resampling would change the pitch, so
// this only pads or trims, which a tail of a few milliseconds can stand.
function fit(input: Float32Array, target: number): Float32Array {
  const out = new Float32Array(target);
  out.set(input.subarray(0, Math.min(input.length, target)));
  return out;
}
