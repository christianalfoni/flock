// The open phonemizer (docs/plan-voice-g2p.md): misaki's lexicon with its
// neural fallback, no eSpeak. A small dictionary here; the real one is
// measured in compare.test.ts when its data has been fetched.
import nlp from "compromise/two";
import { describe, expect, test } from "vitest";
import { createG2P } from "./g2p";
import { createTagger } from "./tagger";
import { applyStress } from "./lexicon";
import { cardinal, ordinal } from "./numbers";

const gold = {
  the: "ðə",
  to: "tˈu",
  a: "ˈA",
  worker: "wˈɜɹkəɹ",
  fail: "fˈAl",
  cache: "kˈæʃ",
  retry: "ɹitɹˈI",
  write: "ɹˈIt",
  read: { DEFAULT: "ɹˈid", VBD: "ɹˈɛd" },
  wait: "wˈAt",
  type: "tˈIp",
  script: "skɹˈɪpt",
  three: "θɹˈi",
  twenty: "twˈɛnti",
  six: "sˈɪks",
  hundred: "hˈʌndɹəd",
  one: "wˈʌn",
  first: "fˈɜɹst",
  C: "sˈi",
  L: "ˈɛl",
  I: "ˈI",
  P: "pˈi",
  A: "ˈA",
  O: "ˈO",
  S: "ˈɛs",
  apple: "ˈæpəl",
  Q: "kjˈu",
  use: { DEFAULT: "jˈuz", NOUN: "jˈus" },
  effect: "ɪfˈɛkt",
  get: "ɡˈɛt",
  server: "sˈɜɹvəɹ",
  side: "sˈId",
  prop: "pɹˈɑp",
};
const silver = { backoff: "bˈækɔf" };

const asked: string[] = [];
const g2p = createG2P({
  gold,
  silver,
  fallback: (word) => {
    asked.push(word);
    return "ɹˈɛdɪs";
  },
});

describe("the lexicon", () => {
  test("a known word is looked up, in either dictionary", () => {
    expect(g2p("worker")).toBe("wˈɜɹkəɹ");
    expect(g2p("backoff")).toBe("bˈækɔf");
  });

  test("a capitalised word finds its lower-case entry", () => {
    expect(g2p("Worker")).toBe("wˈɜɹkəɹ");
  });

  test("regular endings come from the stem", () => {
    expect(g2p("fails")).toBe("fˈAlz");
    expect(g2p("caches")).toBe("kˈæʃᵻz");
    expect(g2p("failed")).toBe("fˈAld");
    expect(g2p("waited")).toBe("wˈATᵻd");
    expect(g2p("failing")).toBe("fˈAlɪŋ");
    expect(g2p("writing")).toBe("ɹˈITɪŋ");
  });

  test("a word with several readings takes its default when nothing tags it", () => {
    expect(g2p("read")).toBe("ɹˈid");
  });

  test("an unknown all-capitals word is spelled", () => {
    expect(g2p("CLI")).toBe("sˌiˌɛlˈI");
    expect(g2p("APIs")).toBe("ˌApˌiˈIz");
  });

  test("camel case is split into words it knows, the first one stressed less", () => {
    expect(g2p("TypeScript")).toBe("tˌIpskɹˈɪpt");
  });

  test("the and a depend on the next sound", () => {
    expect(g2p("the worker")).toBe("ðə wˈɜɹkəɹ");
    expect(g2p("the apple")).toBe("ði ˈæpəl");
    expect(g2p("a worker")).toBe("ɐ wˈɜɹkəɹ");
  });

  test("a flap is written T, as Kokoro 1.0 was trained", () => {
    expect(g2p("waited")).not.toContain("ɾ");
  });
});

describe("parts of speech", () => {
  const dictionary = {
    ...gold,
    live: { DEFAULT: "lˈIv", VERB: "lˈɪv" },
    lives: { DEFAULT: "lˈIvz", VERB: "lˈɪvz" },
    read: { DEFAULT: "ɹˈid", VBD: "ɹˈɛd", VBN: "ɹˈɛd" },
    there: { DEFAULT: "ðɛɹ", None: "ðˈɛɹ" },
    data: "dˈATə",
    board: "bˈɔɹd",
    it: "ɪt",
    is: "ɪz",
    are: "ˈɑɹ",
    now: "nˈW",
    we: "wi",
    has: "hˈæz",
    file: "fˈIl",
    comments: "kˈɑmɛnts",
    on: "ˈɔn",
    in: "ɪn",
  };
  const tagged = createG2P({ gold: dictionary, silver, tag: createTagger(nlp, dictionary) });

  test("a word takes the reading for its tag, then its parent tag's, then the default", () => {
    expect(tagged("The data lives in the board.")).toContain("lˈɪvz");
    expect(tagged("the live board")).toContain("lˈIv");
    expect(tagged("It has read the file.")).toContain("ɹˈɛd");
    expect(tagged("We read the file.")).toContain("ɹˈid");
  });

  test("a bare verb after a form of be is a participle when it has one, else an adjective", () => {
    expect(tagged("It is read.")).toContain("ɹˈɛd");
    expect(tagged("We are now live.")).toContain("lˈIv");
  });

  test("at the end of a phrase a word takes its stressed reading", () => {
    expect(tagged("It is in there.")).toContain("ðˈɛɹ");
    expect(tagged("there it is")).not.toContain("ðˈɛɹ");
  });

  test("a piece is tagged with the words around it", () => {
    expect(tagged("live", { before: "Where does the data", after: "?" })).toBe("lˈɪv");
    expect(tagged("live", { before: "Comments are", after: "on the board." })).toBe("lˈIv");
  });
});

describe("the fallback", () => {
  test("takes a word the lexicon does not know, as written", () => {
    asked.length = 0;
    expect(g2p("Redis caches")).toBe("ɹˈɛdɪs kˈæʃᵻz");
    expect(asked).toEqual(["Redis"]);
  });

  test("guesses only the piece of a camel-case word it does not know", () => {
    asked.length = 0;
    // "Postgre" is guessed; "SQL" is still spelled from the dictionary.
    expect(g2p("PostgreSQL")).toBe("ɹˌɛdɪsˌɛskjˌuˈɛl");
    expect(asked).toEqual(["Postgre"]);
    asked.length = 0;
    expect(g2p("fooWorker")).toBe("ɹˌɛdɪswˈɜɹkəɹ");
    expect(asked).toEqual(["foo"]);
  });

  test("takes a camel-case word whole when it knows none of its pieces", () => {
    asked.length = 0;
    expect(g2p("fooBar")).toBe("ɹˈɛdɪs");
    expect(asked).toEqual(["fooBar"]);
  });

  test("camel case made of known words never asks it", () => {
    asked.length = 0;
    expect(g2p("useEffect")).toBe("jˌuzɪfˈɛkt");
    expect(g2p("getServerSideProps")).toBe("ɡˌɛtsˈɜɹvəɹsˌIdpɹˈɑps");
    expect(asked).toEqual([]);
  });
});

// A word kept with its phonemes (docs/plan-voice-phonemes.md) is said with
// them: never looked up, never guessed, whatever the dictionaries say.
describe("a word with its phonemes", () => {
  test("is said with them, the rest of the text as ever", () => {
    asked.length = 0;
    expect(g2p("[Redis](/ɹˈɛdɪʃ/) caches")).toBe("ɹˈɛdɪʃ kˈæʃᵻz");
    expect(g2p("the [worker](/wˈɜɹkɚ/) fails, [Kafka](/kˈɑfkə/).")).toBe("ðə wˈɜɹkɚ fˈAlz, kˈɑfkə.");
    expect(asked).toEqual([]);
  });

  test("even a word the dictionary knows", () => {
    expect(g2p("[worker](/wˈʌɹkəɹ/)")).toBe("wˈʌɹkəɹ");
  });

  test("phonemes with spaces, and next to punctuation", () => {
    expect(g2p("Run [stdout](/stˈændəɹd ˈWt/), then [CLI](/sˌiˌɛlˈI/)!")).toBe(`${g2p("Run")} stˈændəɹd ˈWt, ${g2p("then")} sˌiˌɛlˈI!`);
  });

  test("the word before hears its first sound", () => {
    expect(g2p("the [Ubuntu](/ubˈʊntu/)")).toBe("ði ubˈʊntu");
    expect(g2p("the [Kafka](/kˈɑfkə/)")).toBe("ðə kˈɑfkə");
  });

  test("numbers in the rest of the text are said, the phonemes left alone", () => {
    expect(g2p("3 [workers](/wˈʌɹkəɹz/)")).toBe("θɹˈi wˈʌɹkəɹz");
  });
});

describe("punctuation and numbers", () => {
  test("punctuation is kept, with the spacing Kokoro expects", () => {
    expect(g2p("When the worker fails, a backoff.")).toBe(`${"ɹˈɛdɪs"} ðə wˈɜɹkəɹ fˈAlz, ɐ bˈækɔf.`);
  });

  test("numbers are said as words", () => {
    expect(cardinal(3)).toBe("three");
    expect(cardinal(126)).toBe("one hundred twenty-six");
    expect(cardinal(2026)).toBe("two thousand twenty-six");
    expect(ordinal(21)).toBe("twenty-first");
    expect(g2p("3 workers")).toBe("θɹˈi wˈɜɹkəɹz");
    expect(g2p("126")).toBe("wˈʌn hˈʌndɹəd twˈɛnti sˈɪks");
  });
});

test("stress moves the way misaki moves it", () => {
  expect(applyStress("sˈiˈɛl", 0)).toBe("sˌiˌɛl");
  expect(applyStress("ɹitɹˈI", -2)).toBe("ɹitɹI");
  expect(applyStress("kæʃ", 2)).toBe("kˈæʃ");
});
