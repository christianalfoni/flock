// Terms (docs/format.md, Terms): finding a sketch's terms in the text the
// board shows, so it can mark them and show what they mean.
import type { SketchTerm } from "./types";

// Two spellings are one term when they differ only in case and spacing.
export function termKey(term: string) {
  return term.trim().toLowerCase().replace(/\s+/g, " ");
}

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// The text cut into plain runs and the terms in it: whole words, any case,
// the longest term first where two overlap ("Dead letters" before
// "Dead"). The runs joined give the text back.
export type TermRun = { text: string; term?: SketchTerm };

export function termRuns(text: string, terms: SketchTerm[]): TermRun[] {
  if (!text) return [];
  const byKey = new Map(terms.filter((term) => term.term.trim()).map((term) => [termKey(term.term), term]));
  if (byKey.size === 0) return [{ text }];
  const words = [...byKey.values()].sort((a, b) => b.term.trim().length - a.term.trim().length).map((term) => escape(term.term.trim()).replace(/\s+/g, "\\s+"));
  // A letter, digit or _ next to a match makes it part of a longer word.
  const pattern = new RegExp(`(?<![\\p{L}\\p{N}_])(?:${words.join("|")})(?![\\p{L}\\p{N}_])`, "giu");
  const runs: TermRun[] = [];
  let at = 0;
  for (const match of text.matchAll(pattern)) {
    if (match.index > at) runs.push({ text: text.slice(at, match.index) });
    runs.push({ text: match[0], term: byKey.get(termKey(match[0]))! });
    at = match.index + match[0].length;
  }
  if (at < text.length) runs.push({ text: text.slice(at) });
  return runs;
}
