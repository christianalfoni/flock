// Every sentence on the listening page says its word with the reading it is
// there for, after the patch. Needs `node scripts/fetch-g2p.mjs`; skipped
// without it.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import nlp from "compromise/two";
import { describe, expect, test } from "vitest";
import { createG2P } from "./g2p/g2p";
import { PATCHES, PROPOSED, withPatches, type Dictionary } from "./g2p/lexicon";
import { createTagger } from "./g2p/tagger";
import { PATCH_SENTENCES } from "./patchSentences";

const DATA = join(__dirname, "../../.g2p");
const has = existsSync(join(DATA, "us_gold.json"));

describe.skipIf(!has)("the listening page's sentences", () => {
  const gold = has ? (JSON.parse(readFileSync(join(DATA, "us_gold.json"), "utf8")) as Dictionary) : {};
  const silver = has ? (JSON.parse(readFileSync(join(DATA, "us_silver.json"), "utf8")) as Dictionary) : {};
  const make = (dictionary: Dictionary) => createG2P({ gold: dictionary, silver, tag: createTagger(nlp, dictionary) });
  const patches = { ...PATCHES, ...PROPOSED };
  const after = make(withPatches(gold, patches));
  const dictionary = withPatches(gold, patches);

  test("every patched word is heard", () => {
    const heard = new Set(PATCH_SENTENCES.map((entry) => entry.word));
    for (const word of Object.keys(patches)) if (!/(s|ed|ing)$/.test(word) || word === "updated") expect(heard, word).toContain(word);
  });

  test.each(PATCH_SENTENCES)("$sentence says $word as $reading", ({ word, reading, sentence }) => {
    const entry = dictionary[word]!;
    const expected = (typeof entry === "string" ? entry : entry[reading]!).replaceAll("ɾ", "T");
    expect(after(sentence).split(/[\s,.?!]+/)).toContain(expected);
  });
});
