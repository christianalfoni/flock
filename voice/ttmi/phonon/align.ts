// Word timing for Phonon. The flow LM's layer 3, head 0 attends along the
// transcript as it speaks (measured on the node.db sentence: the argmax is
// monotonic, reaches the last token, and the peak weight averages 0.78).
// These functions turn that attention, or a silence-trimmed guess, into
// word times. They do not touch the model.
import { speechText } from "../speechText";

export const FRAME_SEC = 0.08;
export const ATTENTION_LAYER = 3;
export const ATTENTION_HEAD = 0;

// A word in the text the listener sees, and when it is said.
export type TimedWord = { text: string; start: number; end: number; from: number; to: number };

const WORD = /[\p{L}\p{N}]+(?:[-._'’]*[\p{L}\p{N}]+)*/gu;

// Words a highlight can land on. "CLIs" stays one word, and so does
// "node.db". Parentheses and commas are the pauses around them.
export function wordsOf(text: string): { text: string; start: number; end: number }[] {
  return [...text.matchAll(WORD)].map((match) => ({ text: match[0], start: match.index, end: match.index + match[0].length }));
}

// Bump when the dash rule changes what Phonon is given. The lexicon is
// named on its own in the clip variant, so a new spelling invalidates
// clips without this number moving.
export const SPEAKABLE_REV = 2;

// Words Phonon says wrong as written, and a spelling it says right, checked
// with whisper small.en on WebGPU (voice miles). Keys are lower case; a word
// matches whole, in any case, with or without a trailing 's. Lower-case
// "ttmi" comes out "teamy"; in capitals it is spelled out, T T M I.
export const PHONON_LEXICON: Record<string, string> = {
  ttmi: "TTMI",
  workos: "work O S",
  nginx: "engine X",
  kubectl: "cube control",
  stdout: "standard out",
  stderr: "standard error",
  vitest: "veet test",
};

// Stable text of the lexicon, part of every clip's key.
export function lexiconRevision(lexicon: Record<string, string> = PHONON_LEXICON): string {
  return Object.entries(lexicon).map(([word, said]) => `${word}=${said}`).join(",");
}

// The text with the lexicon's spellings in, and for every word of it the
// index of the word it came from in `text`. A spelling can be several
// words ("work O S"); they all point back to the one word shown.
export function respell(text: string, lexicon: Record<string, string> = PHONON_LEXICON): { text: string; origin: number[] } {
  let out = "";
  let at = 0;
  const origin: number[] = [];
  wordsOf(text).forEach((word, index) => {
    const [, base = word.text, suffix = ""] = /^(.+?)(['’]s)?$/u.exec(word.text) ?? [];
    const said = lexicon[base.toLowerCase()];
    const spoken = said === undefined ? word.text : said + suffix;
    out += text.slice(at, word.start) + spoken;
    at = word.end;
    for (let count = wordsOf(spoken).length; count > 0; count--) origin.push(index);
  });
  return { text: out + text.slice(at), origin };
}

// The text the model is given. The lexicon runs first, then a spaced dash
// becomes a comma: the tokenizer drops "—" and "–" as whitespace and reads
// "--" as two hyphens, so a dash would run straight on. A comma is the
// pause it knows. A single hyphen inside a word ("test-run") is removed,
// so the compound is one word and not a pause; "a--b" and "1–3" stay.
// A sentence with no stop of its own is given one, so a statement falls
// instead of rising as if it were going on.
export function speakable(text: string): string {
  return closeStatement(joinCompounds(pauseAtDashes(respell(text).text)));
}

// Text the voice is given, and which shown word each spoken word came from.
// speechText writes the words. A respelling can be several spoken words
// only when the rewriter splits one; they all point at the word shown.
export function spokenPlan(text: string): { spoken: string; links: { start: number; end: number; origin: number }[] } {
  const spoken = modelText(text);
  const shown = wordsOf(text);
  const said = wordsOf(spoken);
  const links = said.map((word, index) => {
    const origin = shown.findIndex((item, at) => at >= index && item.text === word.text);
    return { start: word.start, end: word.end, origin: origin < 0 ? Math.min(index, shown.length - 1) : origin };
  });
  return { spoken, links };
}

export function modelText(text: string): string {
  return speechText(text);
}

// Gradium's timings address the spoken text. Fold them onto the words the
// sketch shows: one shown word keeps every spoken piece of a respelling,
// and the times are the union.
export function placeSpokenTimings(original: string, links: { start: number; end: number; origin: number }[], timings: { start: number; end: number; from: number; to: number }[]): TimedWord[] {
  const shown = wordsOf(original);
  const acc = new Map<number, { from: number; to: number }>();
  for (const timing of timings) {
    const link = links.find((item) => timing.start < item.end && timing.end > item.start);
    if (!link || link.origin < 0 || link.origin >= shown.length) continue;
    const prev = acc.get(link.origin);
    acc.set(link.origin, {
      from: prev ? Math.min(prev.from, timing.from) : timing.from,
      to: prev ? Math.max(prev.to, timing.to) : timing.to,
    });
  }
  return [...acc.entries()].sort((a, b) => a[0] - b[0]).map(([index, time]) => {
    const word = shown[index]!;
    return { text: word.text, start: word.start, end: word.end, from: time.from, to: time.to };
  });
}

function bare(text: string): string {
  return text.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
}

// blixt's words are the spoken text, with punctuation stuck to them
// ("controls.", "in."). A word may also carry its token times. The
// highlight uses the word's own span, so a compound stays one word.
// Strip the punctuation and lay the times on the words shown, in order.
// One shown word keeps every spoken piece that points at it.
export function placeBlixtTimings(original: string, timings: { text: string; start: number; end: number; tokens?: { text: string; start: number; end: number }[] }[]): TimedWord[] {
  const plan = spokenPlan(original);
  const heard = timings.map((word) => ({ ...word, text: bare(word.text) })).filter((word) => word.text);
  const shown = wordsOf(original);
  const acc = new Map<number, { from: number; to: number }>();
  heard.forEach((word, index) => {
    const link = plan.links[index];
    if (!link || link.origin < 0 || link.origin >= shown.length) return;
    const prev = acc.get(link.origin);
    acc.set(link.origin, {
      from: prev ? Math.min(prev.from, word.start) : word.start,
      to: prev ? Math.max(prev.to, word.end) : word.end,
    });
  });
  return [...acc.entries()].sort((a, b) => a[0] - b[0]).map(([index, time]) => {
    const word = shown[index]!;
    return { text: word.text, start: word.start, end: word.end, from: time.from, to: time.to };
  });
}

function pauseAtDashes(text: string): string {
  return text.replace(/([,;:]?)(?:\s+(?:-{2,}|–)\s+|\s*—\s*)(?=\S)/g, (_match, mark: string) => `${mark || ","} `);
}

function joinCompounds(text: string): string {
  return text.replace(/(?<=\p{L})-(?=\p{L})/gu, "");
}

function closeStatement(text: string): string {
  const trimmed = text.trim();
  if (!trimmed || /[.!?…]["')\]]*$/u.test(trimmed)) return text;
  return `${trimmed}.`;
}

// Sentences, cut only where a stop is followed by a space. "node.db" stays
// in the sentence it belongs to; the full stop after it still ends one.
export function splitSentences(text: string): string[] {
  const parts = text
    .trim()
    .split(/(?<=[.!?])\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
  return parts.length ? parts : [text.trim()].filter(Boolean);
}

// The last sentence of a step, when it is this short, rises if it is
// generated alone ("Click a canvas to dive in." measured 115 Hz to 155 Hz).
// Joined to the sentence before with a comma, the same words fall.
export function mergeShortFinal(sentences: string[], maxWords = 6): string[] {
  if (sentences.length < 2) return sentences;
  const last = sentences[sentences.length - 1]!;
  const words = last.replace(/[.!?…]+["')\]]*$/u, "").trim().split(/\s+/).filter(Boolean);
  if (!words.length || words.length > maxWords) return sentences;
  const prev = sentences[sentences.length - 2]!;
  const head = last.replace(/^[A-Z](?![A-Z])/u, (letter) => letter.toLowerCase());
  const merged = `${prev.replace(/[.!?…]+(["')\]]*)\s*$/u, ",$1")} ${head}`;
  return [...sentences.slice(0, -2), merged];
}

// Which word each tokenizer piece belongs to. A piece is the tokenizer's
// own surface, with a leading ▁ where a word starts. Pieces that are only
// punctuation between words belong to no word; the dot inside "node.db"
// belongs to that word. `text` is the sentence that was spoken.
export function mapTokensToWords(tokens: string[], text: string): (number | null)[] {
  const words = wordsOf(text);
  let rebuilt = "";
  const spans: { from: number; to: number }[] = [];
  tokens.forEach((token, index) => {
    const body = token.startsWith("▁") ? token.slice(1) : token;
    const shown = decodePiece(body);
    const gap = token.startsWith("▁") && index > 0 ? " " : "";
    const from = rebuilt.length + (gap && shown === "" ? 0 : gap.length);
    rebuilt += gap + shown;
    spans.push({ from, to: rebuilt.length });
  });
  const spoken = wordsOf(rebuilt);
  // The tokens are of the respelled text: map its words back to the shown ones.
  const { origin } = respell(text);
  const respelled = spoken.length === origin.length && origin.length !== words.length;
  const same = spoken.length === words.length;
  return spans.map((span) => {
    const hit = spoken.findIndex((word) => span.from < word.end && span.to > word.start);
    if (hit < 0) return null;
    if (respelled) return origin[hit] ?? null;
    return same || hit < words.length ? hit : null;
  });
}

function decodePiece(token: string): string {
  const byte = /^<0x([0-9A-Fa-f]{2})>$/.exec(token);
  return byte ? String.fromCharCode(Number.parseInt(byte[1]!, 16)) : token;
}

// The token each 80 ms frame is saying. The path only moves forward, and
// it finishes on the last token when there are enough frames to get there.
// A jump costs more than waiting, so a frame that glances at a later token
// does not skip the word in between unless it has to.
export function monotonicPath(frameWeights: number[][]): number[] {
  const frames = frameWeights.length;
  const tokens = frameWeights[0]?.length ?? 0;
  if (!frames || !tokens) return [];
  const cost = frameWeights.map((row) => {
    const sum = row.reduce((total, value) => total + Math.max(0, value), 0) || 1;
    return row.map((value) => -Math.log(Math.max(0, value) / sum + 1e-8));
  });
  const huge = 1e12;
  const allowJump = frames < tokens;
  const dp = Array.from({ length: frames }, () => Array<number>(tokens).fill(huge));
  const from = Array.from({ length: frames }, () => Array<number>(tokens).fill(0));
  dp[0]![0] = cost[0]![0]!;
  for (let frame = 1; frame < frames; frame++) {
    for (let token = 0; token < tokens; token++) {
      let best = dp[frame - 1]![token]!;
      let prev = token;
      const earliest = allowJump ? 0 : Math.max(0, token - 1);
      for (let candidate = earliest; candidate <= token; candidate++) {
        const jump = token - candidate;
        const penalty = jump > 1 ? (jump - 1) * 1.5 : 0;
        const score = dp[frame - 1]![candidate]! + penalty;
        if (score < best) {
          best = score;
          prev = candidate;
        }
      }
      dp[frame]![token] = best + cost[frame]![token]!;
      from[frame]![token] = prev;
    }
  }
  const path = Array<number>(frames);
  let token = tokens - 1;
  for (let frame = frames - 1; frame >= 0; frame--) {
    path[frame] = token;
    token = frame > 0 ? from[frame]![token]! : 0;
  }
  return path;
}

// Word times from a frame-to-token path. A frame on a comma or a stop stays
// with the word before it, so the highlight holds through the pause.
export function wordTimesFromPath(tokens: string[], path: number[], text: string, frameSec = FRAME_SEC, origin = 0): TimedWord[] {
  const words = wordsOf(text);
  const owners = mapTokensToWords(tokens, text);
  const spoken = Array<number | null>(path.length).fill(null);
  let previous: number | null = null;
  path.forEach((token, frame) => {
    const owner = owners[token] ?? null;
    if (owner !== null) previous = owner;
    spoken[frame] = owner ?? previous;
  });
  return words.map((word, index) => {
    let first = spoken.findIndex((owner) => owner === index);
    if (first < 0) first = spoken.findIndex((owner) => owner !== null && owner > index);
    if (first < 0) first = Math.max(0, spoken.length - 1);
    let last = first;
    for (let frame = first; frame < spoken.length; frame++) if (spoken[frame] === index) last = frame;
    const next = spoken.findIndex((owner, frame) => frame > last && owner !== null && owner !== index);
    const from = origin + first * frameSec;
    const to = origin + (next < 0 ? spoken.length * frameSec : next * frameSec);
    return { ...word, from: round(from), to: round(Math.max(from, to)) };
  });
}

export type AttentionSentence = { text: string; tokens: string[]; weights: number[][]; samples: number };

// One head's weights, sentence by sentence, become word times on the clock
// of the audio those sentences were joined into.
export function attentionWordTimes(sentences: AttentionSentence[], sampleRate: number, frameSec = FRAME_SEC): TimedWord[] {
  const out: TimedWord[] = [];
  let origin = 0;
  for (const sentence of sentences) {
    const path = monotonicPath(sentence.weights);
    out.push(...wordTimesFromPath(sentence.tokens, path, sentence.text, frameSec, origin));
    origin += sentence.samples / sampleRate;
  }
  return out;
}

const PAUSE: Record<string, number> = { ",": 2, ";": 2.5, ":": 2.5, ".": 4, "!": 4, "?": 4, "…": 4, "—": 3, "–": 3, "(": 1.5, ")": 1.5 };

// The quiet edges of a clip, in seconds. A window is speech when its RMS
// is above a small fraction of the loudest window.
export function speechBounds(samples: Float32Array, sampleRate: number): { start: number; end: number } {
  const seconds = samples.length / sampleRate;
  if (!samples.length) return { start: 0, end: 0 };
  const window = Math.max(1, Math.round(sampleRate / 100));
  const levels: number[] = [];
  for (let at = 0; at < samples.length; at += window) {
    let energy = 0;
    const end = Math.min(samples.length, at + window);
    for (let index = at; index < end; index++) energy += samples[index]! ** 2;
    levels.push(Math.sqrt(energy / (end - at)));
  }
  const peak = levels.reduce((max, level) => Math.max(max, level), 0);
  const gate = Math.max(0.01, peak * 0.08);
  const first = levels.findIndex((level) => level >= gate);
  let last = -1;
  levels.forEach((level, index) => {
    if (level >= gate) last = index;
  });
  if (first < 0 || last < first) return { start: 0, end: seconds };
  return { start: (first * window) / sampleRate, end: Math.min(seconds, ((last + 1) * window) / sampleRate) };
}

function wordWeights(text: string): { word: { text: string; start: number; end: number }; weight: number }[] {
  return wordsOf(text).map((word) => {
    let weight = Math.max(1, word.text.length);
    const before = text.slice(Math.max(0, word.start - 2), word.start);
    if (/\(\s*$/.test(before)) weight += PAUSE["("] ?? 0;
    const after = /^\s*([,.;:!?…—–)(])/.exec(text.slice(word.end));
    if (after) weight += PAUSE[after[1]!] ?? 0;
    return { word, weight };
  });
}

// Timing that cannot leave its sentence. Silence at the edges is dropped,
// and what remains is shared by the words, with extra time where the
// punctuation asks for a pause.
export function heuristicWordTimes(sentences: { text: string; samples: Float32Array }[], sampleRate: number): TimedWord[] {
  const out: TimedWord[] = [];
  let origin = 0;
  for (const sentence of sentences) {
    const weighted = wordWeights(sentence.text);
    const bounds = speechBounds(sentence.samples, sampleRate);
    const span = Math.max(0, bounds.end - bounds.start);
    const total = weighted.reduce((sum, entry) => sum + entry.weight, 0) || 1;
    let cursor = bounds.start;
    for (const entry of weighted) {
      const share = (entry.weight / total) * span;
      out.push({ ...entry.word, from: round(origin + cursor), to: round(origin + cursor + share) });
      cursor += share;
    }
    origin += sentence.samples.length / sampleRate;
  }
  return out;
}

// How far two readings of the same words are, in milliseconds. When `scale`
// is set, the reference is stretched to the candidate's length first, so a
// slower voice is not punished for taking longer.
export function timingDrift(reference: TimedWord[], candidate: TimedWord[], scale = false): { medianMs: number; maxMs: number; pairs: number } {
  const pairs = Math.min(reference.length, candidate.length);
  if (!pairs) return { medianMs: 0, maxMs: 0, pairs: 0 };
  const refEnd = reference[pairs - 1]?.to ?? 0;
  const candEnd = candidate[pairs - 1]?.to ?? 0;
  const factor = scale && refEnd > 0 ? candEnd / refEnd : 1;
  const gaps: number[] = [];
  for (let index = 0; index < pairs; index++) gaps.push(Math.abs((candidate[index]?.from ?? 0) - (reference[index]?.from ?? 0) * factor) * 1000);
  gaps.sort((a, b) => a - b);
  const mid = gaps.length % 2 ? gaps[(gaps.length - 1) / 2]! : ((gaps[gaps.length / 2 - 1] ?? 0) + (gaps[gaps.length / 2] ?? 0)) / 2;
  return { medianMs: Math.round(mid), maxMs: Math.round(gaps[gaps.length - 1] ?? 0), pairs };
}

// The model's conditioner. Measured on the node step: duration_delta 0 was
// 15.8 s, and −0.15 was 13.6 s, so a negative value shortens the words.
// A step at the listener's 1× is paced to about 0.92, which used to become
// −0.12 and hurried the voice. It now lands just under 0, about a tenth
// slower. The /voice slider is this same speed: above 1 shortens. The
// useful range is about −0.5 to 0.2.
export function durationDelta(speed: number): number {
  return Math.max(-0.5, Math.min(0.2, (1 - speed) * 1.15 - 0.11));
}

export type CuePiece = { text: string; name?: string };
export type NamedCue = { name: string; from: number; to: number };

// Which timed words begin inside each piece of the joined text. A word that
// was split across two pieces ("hel" + "lo") belongs to the piece where it
// starts, so later holds and cues stay on the words that follow.
export function segmentWords<T extends { start: number }>(segments: { text: string }[], words: T[]): T[][] {
  let cursor = 0;
  return segments.map((segment) => {
    const from = cursor;
    const to = cursor + segment.text.length;
    cursor = to;
    return words.filter((word) => word.start >= from && word.start < to);
  });
}

// When each named piece of a step is said, from word times on the whole step.
export function cuesFromWords(segments: CuePiece[], words: TimedWord[]): NamedCue[] {
  const cues: NamedCue[] = [];
  const groups = segmentWords(segments, words);
  let cursor = 0;
  segments.forEach((segment, segmentIndex) => {
    const toChar = cursor + segment.text.length;
    cursor = toChar;
    const mine = groups[segmentIndex] ?? [];
    if (!segment.name || !mine.length) return;
    const from = mine[0]!.from;
    const next = words.find((word) => word.start >= toChar);
    const to = next ? next.from : mine[mine.length - 1]!.to;
    cues.push({ name: segment.name, from: round(from), to: round(Math.max(from, to)) });
  });
  return cues;
}

const round = (value: number) => Math.round(value * 1000) / 1000;
