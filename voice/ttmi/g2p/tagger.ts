// Parts of speech for misaki's heteronyms (docs/plan-voice-g2p.md,
// Heteronyms). misaki tags with spaCy; in the browser compromise (MIT) does
// it, and its tags are mapped to the Penn ones misaki's dictionary is keyed
// by: "live" is lˈIv by default and lˈɪv as a VERB, "read" ɹˈɛd as VBD/VBN.
import type { Dictionary } from "./lexicon";

export type Tagged = { start: number; end: number; text: string; tag: string };
export type Tagger = (text: string) => Tagged[];

type Term = { text: string; tags: string[]; offset: { start: number; length: number } };
type Nlp = (text: string) => { json: (options: { offset: true }) => { terms: Term[] }[] };

const ADVERB = new Set(["now", "not", "still", "already", "always", "never", "also", "just", "often", "usually"]);
// After these a word with several readings is a noun ("the update", "each
// record"), and after these a verb ("to export", "will update"); before
// them, at the start of a sentence, a verb ("Export the sketch").
const DETERMINER = new Set(["the", "a", "an", "this", "each"]);
const MODAL = new Set(["to", "will", "can", "should", "must", "let's"]);
// "read" after these is its participle: "has read", "was read", "been read".
// Verbs an adjective can follow as an adjective ("seems content"); after
// any other verb, a lone adjective is its object ("fetch content").
const LINKING = /^(?:seem|feel|felt|becom|became|remain|stay|look|sound|appear|keep|kept|get|got|grow|grew|turn)/i;
const PERFECT = new Set(["has", "have", "had", "was", "were", "been", "being", "is", "are", "be"]);

function penn({ text, tags }: Term): string {
  const is = (tag: string) => tags.includes(tag);
  if (is("Verb")) {
    if (is("Participle")) return "VBN";
    if (is("PastTense") || (is("Auxiliary") && /^used$/i.test(text))) return "VBD";
    if (is("Gerund")) return "VBG";
    return "VB";
  }
  if (is("Adjective")) return "JJ";
  if (is("Adverb")) return "RB";
  if (is("Determiner")) return "DT";
  if (is("Preposition")) return "IN";
  if (is("ProperNoun")) return "NNP";
  if (is("Noun")) return "NN";
  return "";
}

// context: false leaves out the rules on the word before (the listening
// page's "before", what the board said until they came).
export function createTagger(nlp: Nlp, gold: Dictionary, { context = true }: { context?: boolean } = {}): Tagger {
  const readings = (word: string) => {
    const entry = gold[word.toLowerCase()];
    return typeof entry === "object" ? entry : undefined;
  };
  return (text) => {
    const sentences = nlp(text).json({ offset: true });
    const terms = sentences.flatMap((sentence) => sentence.terms);
    // Where each sentence starts, for the imperative.
    const starts = new Set<number>();
    sentences.reduce((at, sentence) => (starts.add(at), at + sentence.terms.length), 0);
    // The word before term i, adverbs skipped; compromise splits "let's"
    // into "let's" and an empty term.
    const previous = (i: number) => {
      let j = i - 1;
      while (j >= 0 && (!terms[j]!.text || ADVERB.has(terms[j]!.text.toLowerCase()))) j--;
      return j >= 0 ? terms[j] : undefined;
    };
    const tags = terms.map((term) => penn(term));
    return terms.map((term, i) => {
      let tag = tags[i]!;
      // compromise reads a bare verb after a form of "be" as a verb ("is
      // read", "are now live"). It is a participle when the word has one,
      // else an adjective.
      const bare = tag === "VB" && !term.tags.includes("Copula") && !term.tags.includes("Auxiliary");
      if (bare && readings(term.text)) {
        let j = i - 1;
        while (j >= 0 && ADVERB.has(terms[j]!.text.toLowerCase())) j--;
        if (j >= 0 && terms[j]!.tags.includes("Copula")) tag = readings(term.text)!.VBN ? "VBN" : "JJ";
      }
      // Where compromise is often wrong about a word with several readings,
      // the word before it decides.
      const before = previous(i);
      const word = before?.text.toLowerCase();
      if (context && readings(term.text) && before && word) {
        const at = terms.indexOf(before);
        if ((DETERMINER.has(word) || tags[at] === "JJ") && !tag.startsWith("NN")) tag = "NN";
        else if (MODAL.has(word)) tag = "VB";
        else if (PERFECT.has(word) && /^read$/i.test(term.text)) tag = "VBN";
        else if (tag === "JJ" && before.tags.includes("Verb") && !before.tags.includes("Copula") && !LINKING.test(before.text) && !terms[i + 1]?.tags.includes("Noun")) tag = "NN";
      }
      // A sentence that starts with it, then "the": an imperative ("Reset
      // the password"), which compromise often takes for a noun.
      const after = terms[i + 1]?.text.toLowerCase();
      if (context && readings(term.text) && starts.has(i) && after && DETERMINER.has(after) && tag.startsWith("NN")) tag = "VB";
      return { start: term.offset.start, end: term.offset.start + term.offset.length, text: term.text, tag };
    });
  };
}
