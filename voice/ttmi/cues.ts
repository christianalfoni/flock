// When a step's references are said (docs/plan-voice-cues.md, The engine).
// Each piece of the step becomes phonemes on its own; the pieces are joined
// into one input for one call, so we know where each starts, and the
// model's duration for every token adds up to when it is said.

// hold: silence put in before the piece is said (docs/plan-voice-pacing.md).
export type Segment = { text: string; name?: string; hold?: number };
export type Cue = { name: string; from: number; to: number };

// The pieces' phonemes joined into one input, with a space where the text
// had one between them, and where each piece starts in it.
export function joinPieces(segments: Segment[], phonemes: string[]): { input: string; starts: number[] } {
  let input = "";
  const starts: number[] = [];
  segments.forEach((segment, index) => {
    const said = phonemes[index] ?? "";
    const before = segments[index - 1];
    if (input && said && (/\s$/.test(before?.text ?? "") || /^\s/.test(segment.text))) input += " ";
    starts.push(input.length);
    input += said;
  });
  return { input, starts };
}

// Seconds from token durations. durations has one entry per input token,
// the padding at either end included; tokenStarts is the first token of
// each piece, counting from the first real token. The durations add up to
// the clip's length, in frames of a fixed number of samples.
export function cueTimes({ segments, tokenStarts, durations, samples, rate }: { segments: Segment[]; tokenStarts: number[]; durations: ArrayLike<number>; samples: number; rate: number }): Cue[] {
  const frames = Array.from(durations, Number);
  const total = frames.reduce((sum, value) => sum + value, 0);
  const seconds = samples / rate;
  if (!total) return [];
  // Before token i (counting from the first real one): the padding plus
  // the tokens ahead of it. A piece cut off by the length limit is at the end.
  const at = (token: number) => {
    const end = Math.min(token + 1, frames.length);
    let sum = 0;
    for (let index = 0; index < end; index++) sum += frames[index]!;
    return Math.min(seconds, (sum / total) * seconds);
  };
  const cues: Cue[] = [];
  segments.forEach((segment, index) => {
    if (!segment.name) return;
    const from = at(tokenStarts[index]!);
    const next = tokenStarts[index + 1];
    const to = next === undefined ? at(frames.length - 2) : at(next);
    cues.push({ name: segment.name, from: round(from), to: round(Math.max(from, to)) });
  });
  return cues;
}

// Cues moved by the silence put into the clip before them: the lead-in,
// and every hold up to and including their own piece's. The cues are the
// named pieces', in order.
export function heldCues(cues: Cue[], segments: Segment[], leadIn = 0): Cue[] {
  let held = leadIn;
  let next = 0;
  const out: Cue[] = [];
  for (const segment of segments) {
    held += segment.hold ?? 0;
    if (!segment.name) continue;
    const cue = cues[next++];
    if (cue) out.push({ name: cue.name, from: round(cue.from + held), to: round(cue.to + held) });
  }
  return out;
}

// Cues inside a clip of this length, after its tail is trimmed.
export function capCues(cues: Cue[], seconds: number): Cue[] {
  return cues.map((cue) => ({ ...cue, from: round(Math.max(0, Math.min(cue.from, seconds))), to: round(Math.max(0, Math.min(cue.to, seconds))) }));
}

// The cue a moment of the clip belongs to: the latest one started. A shape
// stays pointed at until the next reference, and the last one until the
// step changes.
export function cueAt(cues: Cue[], seconds: number): Cue | undefined {
  let found: Cue | undefined;
  for (const cue of cues) if (cue.from <= seconds) found = cue;
  return found;
}

const round = (value: number) => Math.round(value * 1000) / 1000;

// The fake voice's cues: in proportion to characters.
export function cuesByLength(segments: Segment[], seconds: number): Cue[] {
  const total = segments.reduce((sum, segment) => sum + segment.text.length, 0) || 1;
  const cues: Cue[] = [];
  let at = 0;
  for (const segment of segments) {
    const from = (at / total) * seconds;
    at += segment.text.length;
    if (segment.name) cues.push({ name: segment.name, from: round(from), to: round((at / total) * seconds) });
  }
  return cues;
}
