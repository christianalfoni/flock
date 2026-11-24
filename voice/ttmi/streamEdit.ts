// Lead-in and holds for audio that is played while it is still being made.
// The finished clip inserts the same silences. Here they are inserted into
// each chunk, at the word the chunk's timings point at, so the playback
// clock and the highlights agree before the clip exists.
import type { TimedWord } from "./phonon/align";

type Cut = { at: number; samples: number };

export function createStreamEdit(segments: { text: string; hold?: number }[], leadInSec: number, rate: number) {
  let cursor = 0;
  const ranges = segments.map((segment) => {
    const from = cursor;
    const to = cursor + segment.text.length;
    cursor = to;
    return { from, to, hold: segment.hold ?? 0, used: false };
  });
  let raw = 0;
  let lead = Math.max(0, Math.round(leadInSec * rate));
  const inserted: Cut[] = [];
  return {
    emit(samples: Float32Array, words: TimedWord[]): { samples: Float32Array; words: TimedWord[] } {
      const start = raw;
      const end = raw + samples.length;
      const cuts: { at: number; length: number }[] = [];
      for (const range of ranges) {
        if (range.used || range.hold <= 0) continue;
        const word = words.find((item) => item.start >= range.from && item.start < range.to);
        if (!word) continue;
        const at = Math.round(word.from * rate);
        if (at < start || at > end) continue;
        range.used = true;
        const length = Math.round(range.hold * rate);
        cuts.push({ at: at - start, length });
        inserted.push({ at, samples: length });
      }
      const parts: Float32Array[] = [];
      if (lead > 0) {
        parts.push(new Float32Array(lead));
        inserted.push({ at: 0, samples: lead });
        lead = 0;
      }
      const ordered = cuts.sort((a, b) => a.at - b.at);
      let from = 0;
      for (const cut of ordered) {
        const at = Math.max(from, Math.min(samples.length, cut.at));
        parts.push(samples.subarray(from, at));
        parts.push(new Float32Array(cut.length));
        from = at;
      }
      parts.push(samples.subarray(from));
      raw = end;
      const shift = (time: number) => {
        const sample = Math.round(time * rate);
        let extra = 0;
        for (const cut of inserted) if (cut.at <= sample) extra += cut.samples;
        return time + extra / rate;
      };
      return {
        samples: concat(parts),
        words: words.map((word) => ({ ...word, from: shift(word.from), to: shift(word.to) })),
      };
    },
  };
}

function concat(parts: Float32Array[]): Float32Array {
  const length = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Float32Array(length);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}
