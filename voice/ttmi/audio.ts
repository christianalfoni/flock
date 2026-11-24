// Silence put into a clip Kokoro made (docs/plan-voice-pacing.md): before
// the tokens that start held pieces, at the quietest 10 ms in the quarter
// second before where the model says they start. That is the pause Kokoro
// already made there, so it only gets longer, and the melody of the step is
// left whole. Never after the start, so a gap never lands inside a word and
// the piece moves by exactly its hold; the sound fades out over 5 ms before
// the gap and in after it, so it does not click.
const EDGE = 0.005;
export function holdAt(samples: Float32Array, rate: number, durations: ArrayLike<number>, holds: { token: number; seconds: number }[]): Float32Array {
  if (!holds.length) return samples;
  const cuts = holds.map(({ token, seconds }) => ({ at: quietNear(samples, rate, tokenSample(samples, durations, token), 0), length: Math.round(seconds * rate) }));
  const out = new Float32Array(samples.length + cuts.reduce((sum, cut) => sum + cut.length, 0));
  const fade = Math.round(rate * EDGE);
  let from = 0;
  let to = 0;
  const gaps: [number, number][] = [];
  for (const cut of cuts.sort((a, b) => a.at - b.at)) {
    out.set(samples.subarray(from, cut.at), to);
    to += cut.at - from;
    gaps.push([to, to + cut.length]);
    to += cut.length;
    from = cut.at;
  }
  out.set(samples.subarray(from), to);
  for (const [start, end] of gaps) {
    for (let k = 0; k < fade; k++) {
      if (start - fade + k >= 0) out[start - fade + k]! *= (fade - 1 - k) / fade;
      if (end + k < out.length) out[end + k]! *= k / fade;
    }
  }
  return out;
}

// Where token t starts: durations has one entry per input token, the
// padding first, and they add up to the clip.
export function tokenSample(samples: Float32Array, durations: ArrayLike<number>, token: number): number {
  const frames = Array.from(durations, Number);
  const total = frames.reduce((sum, value) => sum + value, 0);
  if (!total) return 0;
  let sum = 0;
  for (let index = 0; index <= Math.min(token, frames.length - 1); index++) sum += frames[index]!;
  return Math.round((sum / total) * samples.length);
}

// The middle of the quietest 10 ms from 0.25 s before to 0.05 s after (or
// as far after as asked).
export function quietNear(samples: Float32Array, rate: number, at: number, after = 0.05): number {
  const window = Math.round(rate / 100);
  let best = at;
  let quietest = Infinity;
  const end = Math.min(samples.length, at + Math.round(rate * after));
  for (let from = Math.max(0, at - Math.round(rate * 0.25)); from + window <= end; from += window >> 1) {
    let energy = 0;
    for (let index = from; index < from + window; index++) energy += samples[index]! ** 2;
    if (energy < quietest) {
      quietest = energy;
      best = from + (window >> 1);
    }
  }
  return best;
}

// The clip from the quiet point before token t: the words said only as
// context are cut off (docs/plan-voice-context.md).
export function cutBefore(samples: Float32Array, rate: number, durations: ArrayLike<number>, token: number): Float32Array {
  return cutAt(samples, rate, quietNear(samples, rate, tokenSample(samples, durations, token)));
}

// The clip from a sample on, faded in over 5 ms so it does not click.
export function cutAt(samples: Float32Array, rate: number, at: number): Float32Array {
  if (at <= 0) return samples;
  const out = samples.slice(at);
  const fade = Math.min(Math.round(rate * 0.005), out.length);
  for (let index = 0; index < fade; index++) out[index]! *= index / fade;
  return out;
}

// The decoder opens cold: the first samples of a clip are a short tick and
// then near-silence, and the voice itself begins about a tenth of a second
// in (measured on the CPU build, Miles, 2026-11-01). A 10 ms window is
// speech once it is louder than that tick. Never look further than this,
// so a quiet word is not eaten.
const COLD_GATE = 0.008;
const COLD_CAP = 0.15;
const COLD_BACK = 0.012;
const COLD_FADE = 0.008;

// How many leading samples to drop, or undefined when the buffer is still
// too short to tell. 0 when the voice is already there.
export function coldOnsetCut(samples: Float32Array, rate: number): number | undefined {
  if (!samples.length || rate <= 0) return 0;
  const window = Math.max(1, Math.round(rate * 0.01));
  const cap = Math.round(rate * COLD_CAP);
  const back = Math.round(rate * COLD_BACK);
  const limit = Math.min(samples.length, cap + window);
  for (let at = 0; at + window <= limit; at += window) {
    let energy = 0;
    for (let index = at; index < at + window; index++) energy += samples[index]! ** 2;
    if (Math.sqrt(energy / window) >= COLD_GATE) return Math.max(0, Math.min(cap, at - back));
  }
  if (samples.length >= cap) return cap;
  return undefined;
}

function fadeHead(samples: Float32Array, rate: number): Float32Array {
  const out = new Float32Array(samples);
  const fade = Math.min(out.length, Math.max(1, Math.round(rate * COLD_FADE)));
  for (let index = 0; index < fade; index++) out[index]! *= index / fade;
  return out;
}

// The q4 decoder breaks a compound in two: the first syllable, a hole, then
// a hard restart ("test", silence, "run"). The official f32 runtime does not.
// Join the syllable onto the restart and drop the hole, and move the later
// word times back by what was removed. A pause that never comes back loudly
// is left alone.
export function tightenCompoundGaps<T extends { text: string; from: number; to: number }>(samples: Float32Array, rate: number, words: T[]): { samples: Float32Array; words: T[] } {
  const hop = Math.max(1, Math.round(rate * 0.01));
  const minGap = Math.round(rate * 0.08);
  const fade = Math.round(rate * 0.02);
  const ahead = Math.round(rate * 0.12);
  const maxCut = Math.round(rate * 0.45);
  const gate = 0.025;
  const restartAt = 0.045;
  const cuts: { from: number; to: number }[] = [];
  let runStart = -1;
  let run = 0;
  const level = (at: number) => {
    let energy = 0;
    const end = Math.min(samples.length, at + hop);
    for (let index = at; index < end; index++) energy += samples[index]! ** 2;
    return Math.sqrt(energy / Math.max(1, end - at));
  };
  const consider = (endAt: number) => {
    if (runStart < 0 || run < minGap || runStart < fade) return;
    const mid = (runStart + run / 2) / rate;
    if (!words.some((word) => /\p{L}-\p{L}/u.test(word.text) && mid >= word.from && mid <= word.to)) return;
    let cutTo = endAt;
    const limit = Math.min(samples.length - fade, endAt + ahead);
    for (let at = endAt; at + hop <= limit; at += hop) {
      if (level(at) >= restartAt) {
        cutTo = at;
        break;
      }
    }
    if (level(cutTo) < restartAt) return;
    const removed = cutTo - runStart;
    if (removed < hop || removed > maxCut || cutTo + fade > samples.length) return;
    let energy = 0;
    for (let index = runStart - fade; index < runStart; index++) energy += samples[index]! ** 2;
    if (Math.sqrt(energy / fade) < 0.03) return;
    cuts.push({ from: runStart, to: cutTo });
  };
  for (let at = 0; at + hop <= samples.length; at += hop) {
    if (level(at) < gate) {
      if (runStart < 0) runStart = at;
      run += hop;
    } else {
      consider(at);
      runStart = -1;
      run = 0;
    }
  }
  consider(Math.max(0, samples.length - hop));
  if (!cuts.length) return { samples, words };
  let out = samples;
  let shifted = words.map((word) => ({ ...word }));
  for (const cut of [...cuts].reverse()) {
    const next = bridge(out, cut.from, cut.to, fade);
    const removed = out.length - next.length;
    const seconds = removed / rate;
    const at = (cut.from - fade) / rate;
    shifted = shifted.map((word) => {
      if (word.to <= at) return word;
      if (word.from >= at) return { ...word, from: Math.max(0, word.from - seconds), to: Math.max(0, word.to - seconds) };
      return { ...word, to: Math.max(word.from, word.to - seconds) };
    });
    out = next;
  }
  return { samples: out, words: shifted as T[] };
}

// Overlap the voice before the hole with the restart after it, so the join
// is one slope instead of a fade down to silence and back up.
function bridge(samples: Float32Array, from: number, to: number, fade: number): Float32Array {
  const left = samples.subarray(from - fade, from);
  const right = samples.subarray(to, to + fade);
  const tail = samples.subarray(to + fade);
  const out = new Float32Array(from + tail.length);
  out.set(samples.subarray(0, from - fade), 0);
  for (let index = 0; index < fade; index++) {
    const blend = index / Math.max(1, fade - 1);
    out[from - fade + index] = left[index]! * Math.cos(blend * Math.PI / 2) + right[index]! * Math.sin(blend * Math.PI / 2);
  }
  out.set(tail, from);
  // The restart can still take one steeper step than the syllable. Hold it
  // to that syllable's own steepest step. One pass is enough: the next sample
  // was already on the far side of the same rise.
  let cap = 0;
  for (let index = Math.max(1, from - fade * 4); index < from; index++) cap = Math.max(cap, Math.abs(samples[index]! - samples[index - 1]!));
  const limit = Math.min(out.length, from + fade * 2);
  if (cap > 0) {
    for (let index = from - fade + 1; index < limit; index++) {
      const delta = out[index]! - out[index - 1]!;
      if (Math.abs(delta) > cap) out[index] = out[index - 1]! + Math.sign(delta) * cap;
    }
  }
  return out;
}

// The clip without its cold opening. A full buffer: a short one that has
// not reached the voice yet is left whole.
export function trimColdOnset(samples: Float32Array, rate: number): { samples: Float32Array; skipped: number } {
  const cut = coldOnsetCut(samples, rate);
  if (!cut) return { samples, skipped: 0 };
  return { samples: fadeHead(samples.subarray(cut), rate), skipped: cut };
}

// Streaming: the same cut, decided once the voice has appeared or the cap
// is buffered. Later chunks pass through. The first samples out are faded.
export function openColdTrim(rate: number) {
  let held = new Float32Array(0);
  let decided = false;
  let skipped = 0;
  return {
    skipped: () => skipped,
    push(samples: Float32Array, done: boolean): Float32Array {
      if (decided) return samples;
      const next = new Float32Array(held.length + samples.length);
      next.set(held, 0);
      next.set(samples, held.length);
      held = next;
      const cut = coldOnsetCut(held, rate);
      if (cut === undefined && !done) return new Float32Array(0);
      decided = true;
      skipped = cut ?? 0;
      const out = held.subarray(Math.min(skipped, held.length));
      held = new Float32Array(0);
      return skipped > 0 ? fadeHead(out, rate) : new Float32Array(out);
    },
  };
}

// Silence before a clip.
export function leadIn(samples: Float32Array, rate: number, seconds: number): Float32Array {
  if (seconds <= 0) return samples;
  const out = new Float32Array(Math.round(seconds * rate) + samples.length);
  out.set(samples, out.length - samples.length);
  return out;
}

// The clip's end: 150 ms after the last sound above 1% of its peak, the
// last 10 ms faded out. Kokoro often trails off into near-silence.
export function trimTail(samples: Float32Array, rate: number, keep = 0.15, fade = 0.01): Float32Array {
  let peak = 0;
  for (const sample of samples) peak = Math.max(peak, Math.abs(sample));
  if (!peak) return samples;
  let last = samples.length - 1;
  while (last >= 0 && Math.abs(samples[last]!) <= peak * 0.01) last--;
  const out = samples.slice(0, Math.min(samples.length, last + 1 + Math.round(keep * rate)));
  const length = Math.min(Math.round(fade * rate), out.length);
  for (let k = 0; k < length; k++) out[out.length - length + k]! *= (length - 1 - k) / length;
  return out;
}
