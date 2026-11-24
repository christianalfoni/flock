// Words with two readings, picked by part of speech the way misaki picks them
// with spaCy (docs/plan-voice-g2p.md, Heteronyms): compromise tags the
// sentence and misaki's dictionary has a reading per tag. Needs
// `node scripts/fetch-g2p.mjs`; skipped without it.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import nlp from "compromise/two";
import { describe, expect, test } from "vitest";
import { createG2P } from "./g2p";
import { PATCHES, withPatches } from "./lexicon";
import { createTagger } from "./tagger";

const DATA = join(__dirname, "../../../.g2p");
const has = existsSync(join(DATA, "us_gold.json"));

// Sentence, the word, the dictionary reading it should take (or, after a
// slash, its phonemes, for a word made from its stem). The dictionary is
// misaki's with ttmi's patches (lexicon.ts, PATCHES).
const CASES: [string, string, string][] = [
  ["The data lives in Firestore.", "lives", "VERB"],
  ["The function lives in us-central1.", "lives", "VERB"],
  ["Where does the state live?", "live", "VERB"],
  ["Users live in their own collection.", "live", "VERB"],
  ["The sketch goes live when you save.", "live", "DEFAULT"],
  ["Comments show up on the live board.", "live", "DEFAULT"],
  ["We are now live.", "live", "DEFAULT"],
  ["The board is now live on the site.", "live", "DEFAULT"],
  ["It is live.", "live", "DEFAULT"],
  ["Live updates reach every tab.", "Live", "DEFAULT"],
  ["The worker reads the queue.", "reads", "/ɹˈidz"],
  ["Read the config, then start.", "Read", "DEFAULT"],
  ["We read the file first.", "read", "DEFAULT"],
  ["Once the file is read, we parse it.", "read", "VBN"],
  ["It was read twice.", "read", "VBN"],
  ["The agent has read the file.", "read", "VBN"],
  ["We record every event.", "record", "VERB"],
  ["Each record has an id.", "record", "DEFAULT"],
  ["The server will object.", "object", "VERB"],
  ["Pass the object to the handler.", "object", "DEFAULT"],
  ["Close the connection.", "Close", "VERB"],
  ["The two boxes are close.", "close", "DEFAULT"],
  ["Use the cache.", "Use", "DEFAULT"],
  ["The main use is caching.", "use", "NOUN"],
  ["Project the rows onto the view.", "Project", "VERB"],
  ["The project has three packages.", "project", "DEFAULT"],
  ["The page shows the content.", "content", "DEFAULT"],
  ["The user is content with the result.", "content", "ADJ"],
  ["We present the result to the user.", "present", "VERB"],
  ["The flag is present.", "present", "DEFAULT"],
  ["Separate the two concerns.", "Separate", "VERB"],
  ["They run on separate machines.", "separate", "DEFAULT"],
  ["We increase the limit.", "increase", "DEFAULT"],
  ["The increase is small.", "increase", "NOUN"],
  ["The token is invalid.", "invalid", "DEFAULT"],
  ["We used to poll.", "used", "VBD"],
  // The patches: update and export are said as verbs, content as a noun.
  ["We will update the sketch.", "update", "VERB"],
  ["Let's update it.", "update", "VERB"],
  ["The update is small.", "update", "DEFAULT"],
  ["The last update wins.", "update", "DEFAULT"],
  ["The agent updates the sketch.", "updates", "VERB"],
  ["The agent updated the sketch.", "updated", "/ʌpdˈATᵻd"],
  ["Updating the board is quick.", "Updating", "/ʌpdˈATɪŋ"],
  ["Export the sketch as a picture.", "Export", "VERB"],
  ["We need to export it.", "export", "VERB"],
  ["An export runs every night.", "export", "DEFAULT"],
  ["Each export is a picture.", "export", "DEFAULT"],
  ["The board exported a picture.", "exported", "/ɪkspˈɔɹTᵻd"],
  ["Show the content.", "content", "DEFAULT"],
  // The context rules, where compromise alone is wrong: a noun after a
  // determiner or an adjective, a verb after to, will, can, should, must or
  // let's, a participle after a form of have or be.
  ["This contract.", "contract", "DEFAULT"],
  ["The new content.", "content", "DEFAULT"],
  ["Show new content.", "content", "DEFAULT"],
  ["Updates to content.", "content", "DEFAULT"],
  ["The data had been read.", "read", "VBN"],
  ["The file is being read.", "read", "VBN"],
  // An adjective straight after a verb other than a linking one, with no
  // noun after it, is the verb's object: a noun.
  ["We update content daily.", "content", "DEFAULT"],
  ["Fetch content first.", "content", "DEFAULT"],
  ["Show content.", "content", "DEFAULT"],
  ["Edit content in the panel.", "content", "DEFAULT"],
  ["The user seems content.", "content", "ADJ"],
  ["They feel content with it.", "content", "ADJ"],
  ["Compress the file.", "Compress", "DEFAULT"],
  ["It is small. Rerun the job.", "Rerun", "DEFAULT"],
  ["The compress step is slow.", "compress", "NOUN"],
];

describe.skipIf(!has)("heteronyms with misaki's dictionary", () => {
  const gold = has ? JSON.parse(readFileSync(join(DATA, "us_gold.json"), "utf8")) : {};
  const silver = has ? JSON.parse(readFileSync(join(DATA, "us_silver.json"), "utf8")) : {};
  const dictionary = withPatches(gold);
  const g2p = createG2P({ gold: dictionary, silver, tag: createTagger(nlp, dictionary) });
  const words = (ps: string) => ps.split(/[\s,.?!]+/);

  test.each(CASES)("%s → %s as %s", (sentence, word, reading) => {
    const entry = (dictionary[word.toLowerCase()] ?? dictionary.read) as Record<string, string>;
    const expected = reading.startsWith("/") ? reading.slice(1) : entry[reading]!;
    const others = new Set(reading.startsWith("/") ? ["ɹˈɛdz", "ˈʌpdˌATᵻd", "ˈʌpdˌATɪŋ", "ˈɛkspˌɔɹTᵻd"] : Object.values(entry).filter(Boolean));
    others.delete(expected);
    const said = words(g2p(sentence));
    expect(said).toContain(expected);
    for (const other of others) expect(said).not.toContain(other);
  });

  test("a word at the end of a phrase takes its stressed reading", () => {
    expect(g2p("It is in there.")).toContain("ðˈɛɹ");
    expect(g2p("There is one.")).not.toContain("ðˈɛɹ");
  });

  test("the words around a piece decide its tags", () => {
    // A step is said in pieces, split at its references; "live" alone
    // would be a verb.
    expect(g2p("live", { before: "Comments are", after: "on the board." })).toBe(gold.live.DEFAULT);
    expect(g2p("lives", { before: "The data", after: "in Firestore." })).toBe(gold.lives.VERB);
  });

  test("a patch only adds or replaces whole entries, and each is a real word", () => {
    for (const word of Object.keys(PATCHES)) expect(gold[word], word).toBeDefined();
    expect(withPatches(gold).update).toEqual(PATCHES.update);
    expect(gold.update.VERB).toBe("ˈʌpdˌAt");
  });
});
