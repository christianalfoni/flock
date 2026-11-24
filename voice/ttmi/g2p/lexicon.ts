// misaki's English lexicon (hexgrad/misaki, misaki/en.py, Apache License
// 2.0), ported without spaCy: a word with several readings takes the one for
// its part of speech when the caller tags it (tagger.ts), else its default.
// Its dictionaries are written in Kokoro's own
// phonemes (A = eɪ, I = aɪ, O = oʊ, W = aʊ, Y = ɔɪ), the ones Kokoro 1.0 was
// trained on.
export type Entry = string | Record<string, string | null>;
export type Dictionary = Record<string, Entry>;

// Where misaki's gold dictionary says a software word wrong, ttmi's own
// entries over it; the pinned files in .g2p are left as fetched. Each one
// was heard before and after on /voice-patches, said by Kokoro, and
// approved by ear: a reading is never trusted from what it should be.
export const PATCHES: Dictionary = {
  // The verb's reading was the noun's: up-DATE, not UP-date.
  update: { DEFAULT: "ˈʌpdˌAt", VERB: "ʌpdˈAt" },
  updates: { DEFAULT: "ˈʌpdˌAts", VERB: "ʌpdˈAts" },
  updated: "ʌpdˈAɾᵻd",
  updating: "ʌpdˈAɾɪŋ",
  // Only the noun: ex-PORT as a verb.
  export: { DEFAULT: "ˈɛkspˌɔɹt", VERB: "ɪkspˈɔɹt" },
  // The adjective was the default: CON-tent unless it is "content with".
  content: { DEFAULT: "kˈɑntɛnt", ADJ: "kəntˈɛnt" },
  contents: "kˈɑntɛnts",
  // Approved 2026-10-22: verbs stressed on the second syllable, reset's
  // noun on the first.
  transfer: { DEFAULT: "tɹˈænsfəɹ", VERB: "tɹænsfˈɜɹ" },
  transfers: { DEFAULT: "tɹˈænsfəɹz", VERB: "tɹænsfˈɜɹz" },
  upgrade: { DEFAULT: "ˈʌpɡɹˌAd", VERB: "ʌpɡɹˈAd" },
  upgrades: { DEFAULT: "ˈʌpɡɹˌAdz", VERB: "ʌpɡɹˈAdz" },
  upgraded: "ʌpɡɹˈAdᵻd",
  upgrading: "ʌpɡɹˈAdɪŋ",
  downgrade: { DEFAULT: "dˈWnɡɹˌAd", VERB: "dWnɡɹˈAd" },
  reset: { DEFAULT: "ɹisˈɛt", NOUN: "ɹˈisˌɛt" },
};

// Proposed the same way, from a scan of the gold dictionary, and heard on
// /voice-patches before they move into PATCHES.
export const PROPOSED: Dictionary = {};

export function withPatches(gold: Dictionary, patches: Dictionary = PATCHES): Dictionary {
  return { ...gold, ...patches };
}

const PRIMARY = "ˈ";
const SECONDARY = "ˌ";
const STRESSES = PRIMARY + SECONDARY;
const VOWELS = new Set("AIOQWYaiuæɑɒɔəɛɜɪʊʌᵻ");
const US_TAUS = new Set("AIOWYiuæɑəɛɪɹʊʌ");
const LETTERS = /^[A-Za-z']+$/;
export const SYMBOLS: Record<string, string> = { "%": "percent", "&": "and", "+": "plus", "@": "at" };

const isLower = (word: string) => word === word.toLowerCase();
const isUpper = (word: string) => word === word.toUpperCase();
const capitalize = (word: string) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
const isAlpha = (word: string) => /^\p{L}+$/u.test(word);

function restress(ps: string) {
  const chars = [...ps].map((c, i) => ({ c, at: i as number }));
  chars.forEach((item, i) => {
    if (!STRESSES.includes(item.c)) return;
    const vowel = chars.findIndex((other, j) => j >= i && VOWELS.has(other.c));
    if (vowel >= 0) item.at = vowel - 0.5;
  });
  return chars
    .sort((a, b) => a.at - b.at)
    .map((item) => item.c)
    .join("");
}

const hasVowel = (ps: string) => [...ps].some((c) => VOWELS.has(c));
const hasStress = (ps: string) => ps.includes(PRIMARY) || ps.includes(SECONDARY);

export function applyStress(ps: string, stress: number | undefined): string {
  if (stress === undefined) return ps;
  if (stress < -1) return ps.replaceAll(PRIMARY, "").replaceAll(SECONDARY, "");
  if (stress === -1 || ((stress === 0 || stress === -0.5) && ps.includes(PRIMARY))) return ps.replaceAll(SECONDARY, "").replaceAll(PRIMARY, SECONDARY);
  if ((stress === 0 || stress === 0.5 || stress === 1) && !hasStress(ps)) return hasVowel(ps) ? restress(SECONDARY + ps) : ps;
  if (stress >= 1 && !ps.includes(PRIMARY) && ps.includes(SECONDARY)) return ps.replaceAll(SECONDARY, PRIMARY);
  if (stress > 1 && !hasStress(ps)) return hasVowel(ps) ? restress(PRIMARY + ps) : ps;
  return ps;
}

export function stressWeight(ps: string) {
  let weight = 0;
  for (const c of ps) weight += "AIOQWYʤʧ".includes(c) ? 2 : 1;
  return weight;
}

// misaki's grow_dictionary: "Word" finds "word" and the other way round.
function grow(dictionary: Dictionary): Map<string, Entry> {
  const out = new Map<string, Entry>();
  for (const [key, value] of Object.entries(dictionary)) {
    if (key.length < 2) continue;
    if (isLower(key)) {
      if (key !== capitalize(key)) out.set(capitalize(key), value);
    } else if (key === capitalize(key)) out.set(key.toLowerCase(), value);
  }
  for (const [key, value] of Object.entries(dictionary)) out.set(key, value);
  return out;
}

// What follows the word: whether it starts with a vowel (undefined at the
// end of a phrase) and whether it is "to".
export type Context = { futureVowel: boolean | undefined; futureTo?: boolean };

// misaki's get_parent_tag: VBD finds VERB, NNS finds NOUN.
function parentTag(tag: string | undefined) {
  if (!tag) return tag;
  if (tag.startsWith("VB")) return "VERB";
  if (tag.startsWith("NN")) return "NOUN";
  if (tag.startsWith("ADV") || tag.startsWith("RB") || tag === "RP") return "ADV";
  if (tag.startsWith("ADJ") || tag.startsWith("JJ")) return "ADJ";
  return tag;
}

export class Lexicon {
  private golds: Map<string, Entry>;
  private silvers: Map<string, Entry>;

  constructor(gold: Dictionary, silver: Dictionary) {
    this.golds = grow(gold);
    this.silvers = grow(silver);
  }

  private nnp(word: string): string | undefined {
    const letters = [...word].filter((c) => isAlpha(c)).map((c) => this.golds.get(c.toUpperCase()));
    if (letters.some((ps) => typeof ps !== "string")) return undefined;
    const ps = applyStress(letters.join(""), 0);
    const at = ps.lastIndexOf(SECONDARY);
    return at < 0 ? ps : ps.slice(0, at) + PRIMARY + ps.slice(at + 1);
  }

  private special(word: string, tag: string | undefined, ctx: Context): string | undefined {
    if (word in SYMBOLS) return this.lookup(SYMBOLS[word]!, undefined, undefined, ctx);
    const dotted = word.replace(/^\.+|\.+$/g, "");
    if (dotted.includes(".") && isAlpha(word.replaceAll(".", "")) && Math.max(...word.split(".").map((part) => part.length)) < 3) return this.nnp(word);
    if (word === "a" || word === "A") return "ɐ";
    if (word === "an" || word === "An") return "ɐn";
    if (word === "I") return `${SECONDARY}I`;
    if (/^by$/i.test(word) && parentTag(tag) === "ADV") return "bˈI";
    if (word === "to" || word === "To") return ctx.futureVowel === undefined ? this.entry(this.golds.get("to"), undefined, ctx) : ctx.futureVowel ? "tʊ" : "tə";
    if (word === "in" || word === "In") return "ɪn";
    if (word === "the" || word === "The") return ctx.futureVowel ? "ði" : "ðə";
    if (/^vs\.?$/i.test(word)) return this.lookup("versus", undefined, undefined, ctx);
    if (/^used$/i.test(word)) return this.entry(this.golds.get("used"), (tag === "VBD" || tag === "JJ") && ctx.futureTo ? "VBD" : "DEFAULT", ctx);
    return undefined;
  }

  // misaki's lookup: the reading for the tag, then for its parent tag, then
  // the default; at the end of a phrase a word's stressed "None" reading.
  private entry(entry: Entry | undefined, tag: string | undefined, ctx: Context): string | undefined {
    if (entry === undefined) return undefined;
    if (typeof entry === "string") return entry;
    if (ctx.futureVowel === undefined && "None" in entry) tag = "None";
    else if (!tag || !(tag in entry)) tag = parentTag(tag);
    return (tag && tag in entry ? entry[tag] : entry.DEFAULT) ?? undefined;
  }

  private isKnown(word: string) {
    if (this.golds.has(word) || word in SYMBOLS || this.silvers.has(word)) return true;
    if (!isAlpha(word) || !LETTERS.test(word)) return false;
    if (word.length === 1) return true;
    if (isUpper(word) && this.golds.has(word.toLowerCase())) return true;
    return isUpper(word.slice(1));
  }

  private lookup(word: string, tag: string | undefined, stress: number | undefined, ctx: Context): string | undefined {
    if (isUpper(word) && !this.golds.has(word)) word = word.toLowerCase();
    const ps = this.entry(this.golds.get(word), tag, ctx) ?? this.entry(this.silvers.get(word), tag, ctx);
    if (ps === undefined) return this.nnp(word);
    return applyStress(ps, stress);
  }

  private s(stem: string | undefined) {
    if (!stem) return undefined;
    const last = stem.at(-1)!;
    if ("ptkfθ".includes(last)) return stem + "s";
    if ("szʃʒʧʤ".includes(last)) return stem + "ᵻz";
    return stem + "z";
  }

  private stemS(word: string, tag: string | undefined, stress: number | undefined, ctx: Context) {
    if (word.length < 3 || !word.endsWith("s")) return undefined;
    let stem: string;
    if (!word.endsWith("ss") && this.isKnown(word.slice(0, -1))) stem = word.slice(0, -1);
    else if ((word.endsWith("'s") || (word.length > 4 && word.endsWith("es") && !word.endsWith("ies"))) && this.isKnown(word.slice(0, -2))) stem = word.slice(0, -2);
    else if (word.length > 4 && word.endsWith("ies") && this.isKnown(word.slice(0, -3) + "y")) stem = word.slice(0, -3) + "y";
    else return undefined;
    return this.s(this.lookup(stem, tag, stress, ctx));
  }

  private ed(stem: string | undefined) {
    if (!stem) return undefined;
    const last = stem.at(-1)!;
    if ("pkfθʃsʧ".includes(last)) return stem + "t";
    if (last === "d") return stem + "ᵻd";
    if (last !== "t") return stem + "d";
    if (stem.length < 2) return stem + "ɪd";
    if (US_TAUS.has(stem.at(-2)!)) return stem.slice(0, -1) + "ɾᵻd";
    return stem + "ᵻd";
  }

  private stemEd(word: string, tag: string | undefined, stress: number | undefined, ctx: Context) {
    if (word.length < 4 || !word.endsWith("d")) return undefined;
    let stem: string;
    if (!word.endsWith("dd") && this.isKnown(word.slice(0, -1))) stem = word.slice(0, -1);
    else if (word.length > 4 && word.endsWith("ed") && !word.endsWith("eed") && this.isKnown(word.slice(0, -2))) stem = word.slice(0, -2);
    else return undefined;
    return this.ed(this.lookup(stem, tag, stress, ctx));
  }

  private ing(stem: string | undefined) {
    if (!stem) return undefined;
    if (stem.length > 1 && stem.at(-1) === "t" && US_TAUS.has(stem.at(-2)!)) return stem.slice(0, -1) + "ɾɪŋ";
    return stem + "ɪŋ";
  }

  private stemIng(word: string, tag: string | undefined, stress: number | undefined, ctx: Context) {
    if (word.length < 5 || !word.endsWith("ing")) return undefined;
    let stem: string;
    if (word.length > 5 && this.isKnown(word.slice(0, -3))) stem = word.slice(0, -3);
    else if (this.isKnown(word.slice(0, -3) + "e")) stem = word.slice(0, -3) + "e";
    else if (word.length > 5 && /([bcdgklmnprstvxz])\1ing$|cking$/.test(word) && this.isKnown(word.slice(0, -4))) stem = word.slice(0, -4);
    else return undefined;
    return this.ing(this.lookup(stem, tag, stress, ctx));
  }

  private word(word: string, tag: string | undefined, stress: number | undefined, ctx: Context): string | undefined {
    const special = this.special(word, tag, ctx);
    if (special !== undefined) return special;
    const lower = word.toLowerCase();
    if (
      word.length > 1 &&
      isAlpha(word.replaceAll("'", "")) &&
      !isLower(word) &&
      !this.golds.has(word) &&
      !this.silvers.has(word) &&
      (isUpper(word) || isLower(word.slice(1))) &&
      (this.golds.has(lower) || this.silvers.has(lower) || this.stemS(lower, tag, stress, ctx) || this.stemEd(lower, tag, stress, ctx) || this.stemIng(lower, tag, stress, ctx))
    )
      word = lower;
    if (this.isKnown(word)) return this.lookup(word, tag, stress, ctx);
    if (word.endsWith("s'") && this.isKnown(word.slice(0, -2) + "'s")) return this.lookup(word.slice(0, -2) + "'s", tag, stress, ctx);
    if (word.endsWith("'") && this.isKnown(word.slice(0, -1))) return this.lookup(word.slice(0, -1), tag, stress, ctx);
    return this.stemS(word, tag, stress, ctx) ?? this.stemEd(word, tag, stress, ctx) ?? this.stemIng(word, tag, stress === undefined ? 0.5 : stress, ctx);
  }

  // Phonemes for one word, or undefined when the fallback should guess. The
  // tag is a Penn part of speech (VB, VBD, NN, JJ, ...), when known.
  get(text: string, ctx: Context, tag?: string): string | undefined {
    const word = text.replace(/[‘’]/g, "'").normalize("NFKC");
    const stress = isLower(word) ? undefined : isUpper(word) ? 2 : 0.5;
    return this.word(word, tag, stress, ctx);
  }
}
