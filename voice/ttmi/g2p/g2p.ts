// Text to Kokoro's phonemes with no eSpeak (docs/plan-voice-g2p.md): misaki's
// G2P (hexgrad/misaki, misaki/en.py, Apache License 2.0) without spaCy. A
// word is looked up in misaki's dictionaries; a word they do not know goes to
// the fallback, which is misaki's own small BART model (bart.ts). A word
// with several readings takes the one for its part of speech when a tagger
// is given (tagger.ts). A word written with its phonemes, "[Redis](/ɹˈɛdɪs/)"
// as misaki writes it, is said with them (docs/plan-voice-phonemes.md).
import { phonemePieces, plainText } from "@ttmi/model";
import { cardinal, ordinal } from "./numbers";
import { applyStress, Lexicon, stressWeight, type Context, type Dictionary } from "./lexicon";
import type { Tagger } from "./tagger";
import { flipMoney, pointNum, splitNum } from "../normalize";

export type G2POptions = { gold: Dictionary; silver: Dictionary; fallback?: (word: string) => string | undefined; tag?: Tagger };
// The words said just before and after the text, when it is one piece of a
// longer sentence: they are tagged with it, not said.
export type Around = { before?: string; after?: string };

type Token = { text: string; space: boolean; phonemes?: string; prespace?: boolean; tag?: string };
type Word = Token | Token[];

const PUNCTS = ';:,.!?—…"“”';
const BRACKETS = "()";
const EDGE = new RegExp(`^([${PUNCTS}${BRACKETS}]*)(.*?)([${PUNCTS}${BRACKETS}]*)$`, "su");
const SUBTOKEN = /^['‘’]+|\p{Lu}(?=\p{Lu}\p{Ll})|(?:^-)?(?:\d?[,.]?\d)+|[-_]+|['‘’]{2,}|\p{L}*?(?:['‘’]\p{L})*?\p{Ll}(?=\p{Lu})|\p{L}+(?:['‘’]\p{L})*|[^-_\p{L}'‘’\d]|['‘’]+$/gu;
const JUNK = new Set("',-._‘’/");
const VOWELS = new Set("AIOQWYaiuæɑɒɔəɛɜɪʊʌᵻ");
const CONSONANTS = new Set("bdfhjklmnpstvwzðŋɡɹɾʃʒʤʧθ");
const NON_QUOTE_PUNCTS = new Set(";:,.!?—…");

const isJunk = (text: string) => [...text].every((c) => JUNK.has(c));

// Numbers, times and money as words, before the words are looked up.
function prepare(text: string) {
  return text
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, " ")
    .replace(/\d*\.\d+|\b\d{4}s?\b|(?<!:)\b(?:[1-9]|1[0-2]):[0-5]\d\b(?!:)/g, splitNum)
    .replace(/(?<=\d),(?=\d)/g, "")
    .replace(/[$£]\d+(?:\.\d+)?(?: hundred| thousand| (?:[bm]|tr)illion)*\b|[$£]\d+\.\d\d?\b/gi, flipMoney)
    .replace(/\d*\.\d+/g, pointNum)
    .replace(/(?<=\d)-(?=\d)/g, " to ")
    .replace(/\b(\d+)(st|nd|rd|th)\b/g, (_, n: string) => ordinal(Number(n)).replaceAll("-", " "))
    .replace(/\b\d+\b/g, (n) => cardinal(Number(n)).replaceAll("-", " "))
    .trim();
}

// misaki's retokenize: punctuation on its own, the rest of a chunk split
// into subtokens that are looked up together when they can be.
function words(text: string): Word[] {
  const out: Word[] = [];
  const chunks = text.split(" ").filter(Boolean);
  chunks.forEach((chunk, i) => {
    const space = i < chunks.length - 1;
    if (chunk === "-" || chunk === "–") {
      out.push({ text: chunk, space, phonemes: "—" });
      return;
    }
    const [, lead = "", core = "", tail = ""] = chunk.match(EDGE)!;
    const punct = (c: string): Token => ({ text: c, space: false, phonemes: c });
    const group = (core.match(SUBTOKEN) ?? []).map((sub): Token => ({ text: sub, space: false }));
    const tokens: Word[] = [...[...lead].map(punct), ...(group.length > 1 ? [group] : group), ...[...tail].map(punct)];
    const last = tokens.at(-1);
    if (last) (Array.isArray(last) ? last.at(-1)! : last).space = space;
    out.push(...tokens);
  });
  return out;
}

// The words of a text in which some come with their phonemes: those are
// one token each, said as given, and the rest is split as ever.
function marked(text: string): Word[] {
  const pieces = phonemePieces(text);
  const out: Word[] = [];
  pieces.forEach((piece, i) => {
    const more = i < pieces.length - 1;
    if (piece.phonemes !== undefined) {
      out.push({ text: piece.text, space: more && /^\s/.test(pieces[i + 1]!.text), phonemes: piece.phonemes });
      return;
    }
    const list = words(prepare(piece.text));
    const last = list.at(-1);
    if (last) (Array.isArray(last) ? last.at(-1)! : last).space = more && /\s$/.test(piece.text);
    out.push(...list);
  });
  return out;
}

// misaki's token_context: what the word before this one will see.
function nextContext(ctx: Context, ps: string | undefined, text: string): Context {
  const futureTo = text === "to" || text === "To";
  if (!ps) return { futureVowel: ctx.futureVowel, futureTo };
  for (const c of ps) {
    if (NON_QUOTE_PUNCTS.has(c)) return { futureVowel: undefined, futureTo };
    if (VOWELS.has(c)) return { futureVowel: true, futureTo };
    if (CONSONANTS.has(c)) return { futureVowel: false, futureTo };
  }
  return { futureVowel: ctx.futureVowel, futureTo };
}

// The tags of the text's own words, in order, matched to its tokens by
// spelling. Numbers said as words have no tag, and a token that matches
// nothing near is skipped.
const AHEAD = 6;
function applyTags(list: Word[], text: string, { before = "", after = "" }: Around, tagger: Tagger) {
  const lead = before.trim() ? `${before.trim()} ` : "";
  const from = lead.length;
  const to = from + text.length;
  const tags = tagger(lead + text + (after.trim() ? ` ${after.trim()}` : "")).filter((tagged) => tagged.start >= from && tagged.end <= to && tagged.text);
  let next = 0;
  for (const word of list) {
    const group = Array.isArray(word) ? word : [word];
    const spelled = group.map((tk) => tk.text).join("").toLowerCase();
    if (!/\p{L}/u.test(spelled)) continue;
    for (let i = next; i < Math.min(tags.length, next + AHEAD); i++) {
      if (tags[i]!.text.toLowerCase() !== spelled) continue;
      group[0]!.tag = tags[i]!.tag;
      next = i + 1;
      break;
    }
  }
}

// misaki's resolve_tokens: a group said as one word keeps one main stress.
function resolve(group: Token[]) {
  const text = group.map((tk) => tk.text).join("");
  const kinds = new Set([...text].filter((c) => !JUNK.has(c)).map((c) => (/\p{L}/u.test(c) ? 0 : /\d/.test(c) ? 1 : 2)));
  const prespace = text.includes(" ") || text.includes("/") || kinds.size > 1;
  group.forEach((tk, i) => {
    if (tk.phonemes === undefined) {
      if (i === group.length - 1 && NON_QUOTE_PUNCTS.has(tk.text)) tk.phonemes = tk.text;
      else if (isJunk(tk.text)) tk.phonemes = "";
    } else if (i > 0) tk.prespace = prespace;
  });
  if (prespace) return;
  let stressed = group.flatMap((tk, i) => (tk.phonemes ? [{ primary: tk.phonemes.includes("ˈ") ? 1 : 0, weight: stressWeight(tk.phonemes), i }] : []));
  if (stressed.length === 2 && group[stressed[0]!.i]!.text.length === 1) {
    const tk = group[stressed[1]!.i]!;
    tk.phonemes = applyStress(tk.phonemes!, -0.5);
    return;
  }
  if (stressed.length < 2 || stressed.reduce((sum, s) => sum + s.primary, 0) <= Math.floor((stressed.length + 1) / 2)) return;
  stressed = stressed.sort((a, b) => a.primary - b.primary || a.weight - b.weight || a.i - b.i).slice(0, Math.floor(stressed.length / 2));
  for (const { i } of stressed) group[i]!.phonemes = applyStress(group[i]!.phonemes!, -0.5);
}

export function createG2P({ gold, silver, fallback, tag }: G2POptions) {
  const lexicon = new Lexicon(gold, silver);
  const guess = (text: string) => fallback?.(text) ?? "";

  return function g2p(text: string, around: Around = {}): string {
    const list = marked(text);
    if (tag) applyTags(list, prepare(plainText(text)), { before: around.before && prepare(plainText(around.before)), after: around.after && prepare(plainText(around.after)) }, tag);
    let ctx: Context = { futureVowel: undefined };
    for (let n = list.length - 1; n >= 0; n--) {
      const word = list[n]!;
      if (!Array.isArray(word)) {
        if (word.phonemes === undefined) word.phonemes = lexicon.get(word.text, ctx, word.tag) ?? guess(word.text);
        ctx = nextContext(ctx, word.phonemes, word.text);
        continue;
      }
      let left = 0;
      let right = word.length;
      // A piece no dictionary knows ("Postgre" in PostgreSQL) is guessed on
      // its own, and the pieces it knows keep their readings; a word made
      // only of unknown pieces is guessed whole.
      let known = false;
      const guessed: Token[] = [];
      while (left < right) {
        const span = word.slice(left, right);
        const whole = left === 0 && right === word.length;
        const spelled = span.map((tk) => tk.text).join("");
        const ps = span.some((tk) => tk.phonemes !== undefined) ? undefined : lexicon.get(spelled, ctx, whole ? word[0]!.tag : undefined);
        if (ps !== undefined) {
          known = true;
          word[left]!.phonemes = ps;
          for (const tk of word.slice(left + 1, right)) tk.phonemes = "";
          ctx = nextContext(ctx, ps, spelled);
          right = left;
          left = 0;
        } else if (left + 1 < right) left++;
        else {
          right--;
          const tk = word[right]!;
          if (tk.phonemes === undefined) {
            if (isJunk(tk.text)) tk.phonemes = "";
            else {
              tk.phonemes = "";
              guessed.push(tk);
            }
          }
          left = 0;
        }
      }
      if (known) {
        for (const tk of guessed) tk.phonemes = guess(tk.text);
        const first = word.find((tk) => tk.phonemes);
        if (first && guessed.includes(first)) ctx = nextContext(ctx, first.phonemes, first.text);
      }
      if (guessed.length && !known) {
        word[0]!.phonemes = guess(word.map((tk) => tk.text).join(""));
        for (const tk of word.slice(1)) tk.phonemes = "";
        ctx = nextContext(ctx, word[0]!.phonemes, word.map((tk) => tk.text).join(""));
      } else resolve(word);
    }
    let out = "";
    for (const word of list) {
      const group = Array.isArray(word) ? word : [word];
      for (const tk of group) {
        if (tk.prespace && out && !out.endsWith(" ") && tk.phonemes) out += " ";
        out += tk.phonemes ?? "";
      }
      if (group.at(-1)!.space) out += " ";
    }
    // Kokoro 1.0 was trained with the flap as T and the glottal stop as t.
    return out.replaceAll("ɾ", "T").replaceAll("ʔ", "t").replace(/ +/g, " ").trim();
  };
}
