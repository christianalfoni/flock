// How a board says the words its voice would get wrong (docs/plan-voice.md,
// Pronunciations). A word is said with phonemes kept for it: misaki's
// symbols, the ones Kokoro was trained on, given to the voice as
// "[Redis](/ɹˈɛdɪs/)" so its phonemizer never guesses at them again. They
// are made once, from a spelling of how the word sounds, when someone
// hears it and saves it (docs/plan-voice-phonemes.md), so a change to the
// phonemizer cannot change a word anyone accepted. ttmi ships a list; a
// user fixes a word on a sketch, which keeps it in their own list and on
// the sketch, so everyone who opens the sketch hears it; the viewer's own win.

// say: the spelling it was made from, shown and edited again; phonemes:
// what the voice says.
export type Said = { word: string; say: string; phonemes: string };
// { word: "Redis", say: "Reddiss", phonemes: "ɹˈɛdɪs" }

export type PronunciationSource = { kind: "ttmi" } | { kind: "own" };
export type Pronunciation = Said & { source: PronunciationSource };

// What a user may store; the security rules hold the same numbers.
export const PRONUNCIATION_LIMITS = { word: 60, say: 60, phonemes: 160 } as const;

// How many a sketch carries at most; the rules hold the same number.
export const SKETCH_PRONUNCIATIONS = 200;

// Frozen: made from the spelling once, corrected by hand where misaki's
// reading of it was off, and checked by ear (docs/plan-voice-phonemes.md,
// ttmi's list). Never made again from `say`.
export const PRONUNCIATIONS: Said[] = [
  { word: "Redis", say: "Reddiss", phonemes: "ɹˈɛdɪs" },
  { word: "CLI", say: "C L I", phonemes: "sˌiˌɛlˈI" },
  { word: "SaaS", say: "sass", phonemes: "sˈæs" },
  { word: "async", say: "ay-sink", phonemes: "ˈAsɪŋk" },
  { word: "enum", say: "ee-num", phonemes: "ˈinˌʌm" },
  { word: "JSON", say: "Jason", phonemes: "ʤˈAsᵊn" },
  { word: "OAuth", say: "oh-auth", phonemes: "ˈOˌɔθ" },
  { word: "OIDC", say: "O I D C", phonemes: "ˌOˌIdˌisˈi" },
  { word: "stdout", say: "standard out", phonemes: "stˈændəɹd ˈWt" },
  { word: "stderr", say: "standard error", phonemes: "stˈændəɹd ˈɛɹəɹ" },
  { word: "kubectl", say: "cube control", phonemes: "kjˈub kəntɹˈOl" },
  { word: "Kubernetes", say: "koo-ber-net-eez", phonemes: "kˌubəɹnˈɛtiz" },
  { word: "PostgreSQL", say: "post-gress Q L", phonemes: "pˈOstɡɹɛs kjˌuˈɛl" },
  { word: "ttmi", say: "T T M I", phonemes: "tˌitˌiˌɛmˈI" },
  { word: "Vite", say: "veet", phonemes: "vˈit" },
  { word: "Vitest", say: "veet test", phonemes: "vˈit tˌɛst" },
  { word: "Next.js", say: "Next J S", phonemes: "nˈɛkst ʤˌAˈɛs" },
  { word: "Deno", say: "Dee-no", phonemes: "dˈinO" },
  { word: "WorkOS", say: "work O S", phonemes: "wˈɜɹk ˌOˈɛs" },
  { word: "SPA", say: "S P A", phonemes: "ˌɛspˌiˈA" },
  { word: "I2C", say: "I squared C", phonemes: "ˌI skwˌɛɹd sˈi" },
  { word: "SPI", say: "S P I", phonemes: "ˌɛspˌiˈI" },
  { word: "MCU", say: "M C U", phonemes: "ˌɛmsˌijˈu" },
  { word: "ADC", say: "A D C", phonemes: "ˌAdˌisˈi" },
  { word: "RTOS", say: "R toss", phonemes: "ˈɑɹtˌɔs" },
];

// Phonemes are sounds alone: none of the markup, no punctuation (Kokoro
// pauses at it, and the pacing cuts at it), one space between words, none at
// either end. The security rules hold the markup part.
const NOT_A_SOUND = /[[\]()/\\;:,.!?—…"“”«»¡¿\n\r\t]/u;
export const phonemesOk = (phonemes: string) => Boolean(phonemes) && !NOT_A_SOUND.test(phonemes) && phonemes === phonemes.trim() && !phonemes.includes("  ");

// What the phonemizer made of a spelling, as sounds alone: its punctuation
// dropped.
export const soundsOnly = (phonemes: string) => phonemes.replace(new RegExp(NOT_A_SOUND, "gu"), " ").replace(/\s+/g, " ").trim();

const clean = (item: unknown): Said | undefined => {
  if (!item || typeof item !== "object") return undefined;
  const { word, say, phonemes } = item as Partial<Said>;
  if (typeof word !== "string" || typeof say !== "string" || typeof phonemes !== "string") return undefined;
  const w = word.trim().slice(0, PRONUNCIATION_LIMITS.word);
  const s = say.trim().slice(0, PRONUNCIATION_LIMITS.say);
  const p = phonemes.trim();
  return w && s && p.length <= PRONUNCIATION_LIMITS.phonemes && phonemesOk(p) ? { word: w, say: s, phonemes: p } : undefined;
};

// A word, its spelling and its phonemes, trimmed and within the limits, or
// undefined when it is not one.
export const cleanSaid = (item: unknown): Said | undefined => clean(item);

// The list a context's boards speak with, one entry per word (case
// ignored), sorted by word: ttmi's shipped list, then the defaults made on
// /admin/words, then the context's own words, which win. An entry without
// phonemes (a spelling alone, as they were stored before 2026-10-22) is
// left out.
export function pronunciationList(own: Said[], defaults: Said[] = []): Pronunciation[] {
  const byWord = new Map<string, Pronunciation>();
  const put = (said: Said | undefined, source: PronunciationSource) => {
    if (said) byWord.set(said.word.toLowerCase(), { ...said, source });
  };
  for (const said of PRONUNCIATIONS) put(said, { kind: "ttmi" });
  for (const said of defaults) put(clean(said), { kind: "ttmi" });
  for (const said of own) put(clean(said), { kind: "own" });
  return [...byWord.values()].sort((a, b) => a.word.toLowerCase().localeCompare(b.word.toLowerCase()));
}

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// A word whose plural is written with "es": it ends in a hiss.
const takesEs = (word: string) => /(?:s|x|z|sh|ch)$/i.test(word);

// Any of these words, whole or as its plural, any case, the longest first;
// a hyphen joins two words, so each is found on its own.
const wordsPattern = (words: string[]) => new RegExp(`(?<![\\p{L}\\p{N}_])(${[...words].sort((a, b) => b.length - a.length).map((word) => `${escape(word)}(?:${takesEs(word) ? "es" : "s"})?`).join("|")})(?![\\p{L}\\p{N}_])`, "giu");

// The word of the list a match is: itself, or the word its plural is of.
const listed = (match: string, words: Map<string, unknown>) => {
  const word = match.toLowerCase();
  if (words.has(word)) return word;
  const single = word.replace(takesEs(word.slice(0, -2)) ? /es$/ : /s$/, "");
  return words.has(single) ? single : undefined;
};

// The phonemes with the plural's s: "s" after a voiceless sound, "ᵻz"
// after a hiss, "z" after anything else, as misaki says them.
const pluralPhonemes = (phonemes: string) => {
  const last = phonemes.at(-1) ?? "";
  if ("szʃʒʧʤ".includes(last)) return `${phonemes}ᵻz`;
  return `${phonemes}${"ptkfθ".includes(last) ? "s" : "z"}`;
};

// A word with its phonemes, as misaki writes it: "[Redis](/ɹˈɛdɪs/)".
export const PHONEME_MARK = /\[([^\]\n]+)\]\(\/([^/)\n]+)\/\)/gu;
export const markPhonemes = (word: string, phonemes: string) => `[${word}](/${phonemes}/)`;

// The text in pieces: as written, or a word with its phonemes.
export function phonemePieces(text: string): { text: string; phonemes?: string }[] {
  const pieces: { text: string; phonemes?: string }[] = [];
  let at = 0;
  for (const match of text.matchAll(PHONEME_MARK)) {
    if (match.index > at) pieces.push({ text: text.slice(at, match.index) });
    pieces.push({ text: match[1]!, phonemes: match[2]! });
    at = match.index + match[0].length;
  }
  if (at < text.length) pieces.push({ text: text.slice(at) });
  return pieces;
}

// The words as written, the phonemes taken out.
export const plainText = (text: string) => text.replace(PHONEME_MARK, "$1");

// The narration as the voice should read it: each word of the list, whole,
// any case, its plural too and either side of a hyphen, marked with its
// phonemes; the longest word first and in one pass, so a word inside
// another is never marked.
export function applyPronunciations(text: string, list: Said[]): string {
  const usable = list.filter((item) => item.phonemes);
  if (!usable.length) return text;
  const said = new Map(usable.map((item) => [item.word.toLowerCase(), item.phonemes]));
  return text.replace(wordsPattern([...said.keys()]), (match) => {
    const word = listed(match, said);
    if (!word) return match;
    const phonemes = said.get(word)!;
    return markPhonemes(match, word === match.toLowerCase() ? phonemes : pluralPhonemes(phonemes));
  });
}

// What a sketch carries (docs/plan-voice.md, A sketch's own words): of
// these lists, later ones winning, the entries for words the sketch's text
// uses, one per word, sorted by word. Whoever opens the sketch hears them,
// without reading anyone's list.
export function sketchPronunciations(text: string, ...lists: Said[][]): Said[] {
  const byWord = new Map<string, Said>();
  for (const list of lists) for (const item of list) {
    const said = clean(item);
    if (said) byWord.set(said.word.toLowerCase(), said);
  }
  if (!byWord.size) return [];
  const used = new Set((text.match(wordsPattern([...byWord.keys()])) ?? []).map((match) => listed(match, byWord)));
  return [...byWord.entries()]
    .filter(([word]) => used.has(word))
    .map(([, said]) => said)
    .sort((a, b) => a.word.toLowerCase().localeCompare(b.word.toLowerCase()))
    .slice(0, SKETCH_PRONUNCIATIONS);
}

export const samePronunciations = (a: Said[] | undefined, b: Said[] | undefined) => JSON.stringify(a ?? []) === JSON.stringify(b ?? []);
