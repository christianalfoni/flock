// The Phonon checkpoint's Unigram tokenizer, including the normalizer it
// ships in tokenizer.json (quotes, parentheses, a capital and a final
// stop). The published package does this in Rust; the lab and the board
// need the same ids so the attention lines up with the words.

type Replace = { type: "Replace"; pattern?: { Regex?: string; String?: string }; content?: string };
type Strip = { type: "Strip"; strip_left?: boolean; strip_right?: boolean };
type Prepend = { type: "Prepend"; prepend?: string };
type Rule = Replace | Strip | Prepend | { type: string };

export type TokenizerModel = {
  normalizer?: { normalizers?: Rule[] };
  model: { vocab: [string, number][]; byte_fallback?: boolean };
};

type Piece = { text: string; id: number; score: number; length: number };

export function normalize(model: TokenizerModel, text: string): string {
  let out = text;
  for (const rule of model.normalizer?.normalizers ?? []) {
    if (rule.type === "Strip") {
      const strip = rule as Strip;
      if (strip.strip_left) out = out.trimStart();
      if (strip.strip_right) out = out.trimEnd();
    } else if (rule.type === "Prepend") {
      out = `${(rule as Prepend).prepend ?? ""}${out}`;
    } else if (rule.type === "Replace") {
      const replace = rule as Replace;
      const content = replace.content ?? "";
      if (replace.pattern?.String !== undefined) out = out.split(replace.pattern.String).join(content);
      else if (replace.pattern?.Regex) out = out.replace(new RegExp(replace.pattern.Regex, "gu"), content);
    }
  }
  return out;
}

export function encode(model: TokenizerModel, text: string): { ids: number[]; tokens: string[] } {
  const pieces = index(model);
  const ids: number[] = [];
  const tokens: string[] = [];
  for (const part of pretokens(normalize(model, text))) {
    const encoded = viterbi(part, pieces);
    ids.push(...encoded.ids);
    tokens.push(...encoded.tokens);
  }
  return { ids, tokens };
}

function pretokens(normalized: string): string[] {
  const replaced = normalized.replaceAll(" ", "▁");
  const parts: string[] = [];
  let buffer = "";
  for (const char of replaced) {
    if (char === "▁" && buffer) {
      parts.push(buffer);
      buffer = "▁";
    } else buffer += char;
  }
  if (buffer) parts.push(buffer);
  return parts;
}

const cache = new WeakMap<TokenizerModel, { byFirst: Map<string, Piece[]>; bytes: { id: number; score: number }[] }>();

function index(model: TokenizerModel) {
  const found = cache.get(model);
  if (found) return found;
  const byFirst = new Map<string, Piece[]>();
  const bytes = Array.from({ length: 256 }, () => ({ id: 0, score: -100 }));
  model.model.vocab.forEach(([text, score], id) => {
    if (text.startsWith("\u0000")) return;
    const chars = [...text];
    const piece = { text, id, score, length: chars.length };
    const first = chars[0] ?? "";
    byFirst.set(first, [...(byFirst.get(first) ?? []), piece]);
    const byte = /^<0x([0-9A-Fa-f]{2})>$/.exec(text);
    if (byte) bytes[Number.parseInt(byte[1]!, 16)] = { id, score };
  });
  for (const list of byFirst.values()) list.sort((a, b) => b.length - a.length || b.score - a.score);
  const built = { byFirst, bytes };
  cache.set(model, built);
  return built;
}

function viterbi(part: string, pieces: { byFirst: Map<string, Piece[]>; bytes: { id: number; score: number }[] }): { ids: number[]; tokens: string[] } {
  const chars = [...part];
  const count = chars.length;
  const best = Array<number>(count + 1).fill(-Infinity);
  const back = Array<{ at: number; ids: number[]; tokens: string[] } | undefined>(count + 1);
  best[0] = 0;
  for (let at = 0; at < count; at++) {
    if (best[at] === -Infinity) continue;
    const rest = chars.slice(at).join("");
    let matched = false;
    for (const piece of pieces.byFirst.get(chars[at] ?? "") ?? []) {
      if (!rest.startsWith(piece.text)) continue;
      matched = true;
      const next = at + piece.length;
      const score = best[at]! + piece.score;
      if (score > best[next]!) {
        best[next] = score;
        back[next] = { at, ids: [piece.id], tokens: [piece.text] };
      }
    }
    // Byte tokens are only for a character no vocabulary piece covers.
    if (matched) continue;
    const encoded = new TextEncoder().encode(chars[at] ?? "");
    const ids = [...encoded].map((byte) => pieces.bytes[byte]!.id);
    const tokens = [...encoded].map((byte) => `<0x${byte.toString(16).toUpperCase().padStart(2, "0")}>`);
    const score = best[at]! + [...encoded].reduce((sum, byte) => sum + pieces.bytes[byte]!.score, 0);
    if (score > best[at + 1]!) {
      best[at + 1] = score;
      back[at + 1] = { at, ids, tokens };
    }
  }
  const ids: number[] = [];
  const tokens: string[] = [];
  let cursor = count;
  const steps: { ids: number[]; tokens: string[] }[] = [];
  while (cursor > 0) {
    const step = back[cursor];
    if (!step) break;
    steps.push(step);
    cursor = step.at;
  }
  for (const step of steps.reverse()) {
    ids.push(...step.ids);
    tokens.push(...step.tokens);
  }
  return { ids, tokens };
}
