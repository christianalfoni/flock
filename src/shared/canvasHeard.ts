// What you have heard of a canvas's walkthrough. A step is new while its
// words (its narration) are not among the words you heard: redrawn with
// other words, or added. Its picture alone changing does not make it new.
// A step without words (a silent overview) is never new.

// A step's words, as they are compared: trimmed, one space between words.
export function stepWords(narration: string | undefined): string {
  return (narration ?? "").replace(/\s+/g, " ").trim();
}

// The words of a text, as a set: lower case, without punctuation or
// references' targets ("[the fix](pr18492)" is "the fix").
function wordSet(text: string): Set<string> {
  return new Set(text.replace(/\]\([^)]*\)/g, "]").toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []);
}

// How alike two texts' words are: the words they share, of all their words
// (0 to 1).
export function likeness(a: string, b: string): number {
  const one = wordSet(a);
  const two = wordSet(b);
  if (!one.size && !two.size) return 1;
  let shared = 0;
  for (const word of one) if (two.has(word)) shared += 1;
  return shared / (one.size + two.size - shared);
}

// A step you have heard, reworded a little (the same news), is not new:
// its words are at least this alike to words you heard.
export const SAME_STEP = 0.8;

// Which steps are new (their indexes), given every step's words and the
// words heard.
export function newSteps(words: string[], heard: Iterable<string>): number[] {
  const known = [...heard];
  const exact = new Set(known);
  return words.flatMap((text, index) => (text && !exact.has(text) && !known.some((before) => likeness(text, before) >= SAME_STEP) ? [index] : []));
}

// The words heard, with these added: the newest last, at most `limit`.
export function withHeard(heard: string[], words: string[], limit = 400): string[] {
  const added = words.filter((text) => text);
  const kept = heard.filter((text) => !added.includes(text));
  return [...kept, ...new Set(added)].slice(-limit);
}
