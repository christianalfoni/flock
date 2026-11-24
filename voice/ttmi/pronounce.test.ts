// The pronunciation list a board speaks with (docs/plan-voice.md,
// Pronunciations; docs/plan-voice-phonemes.md): ttmi's list, then the
// context's own words, each said with the phonemes kept for it.
import { applyPronunciations, markPhonemes, phonemePieces, phonemesOk, plainText, PRONUNCIATIONS, pronunciationList, samePronunciations, SKETCH_PRONUNCIATIONS, sketchPronunciations, soundsOnly } from "@ttmi/model";
import { describe, expect, test } from "vitest";

// Every symbol misaki's American phonemes use, and the stress marks.
const MISAKI = new Set([..."AIOWYTbdfhijklmnpstuvwzæðŋɑɔəɛɜɡɪɹʃʊʌʒʤʧθᵊᵻɐɾʔ", "ˈ", "ˌ", "ː", " "]);

describe("ttmi's list", () => {
  test("each word once, its spelling and its phonemes kept", () => {
    const words = PRONUNCIATIONS.map((item) => item.word.toLowerCase());
    expect(new Set(words).size).toBe(words.length);
    for (const item of PRONUNCIATIONS) {
      expect(item.word.trim()).toBe(item.word);
      expect(item.say.length).toBeGreaterThan(0);
      expect(item.say.length).toBeLessThanOrEqual(60);
      expect(phonemesOk(item.phonemes)).toBe(true);
      // misaki's symbols only: what Kokoro was trained on.
      expect([...item.phonemes].filter((symbol) => !MISAKI.has(symbol))).toEqual([]);
      expect(item.phonemes).toMatch(/ˈ/);
    }
  });

  test("has the words Kokoro gets wrong, frozen as phonemes", () => {
    const said = new Map(PRONUNCIATIONS.map((item) => [item.word, item]));
    expect(said.get("Redis")).toEqual({ word: "Redis", say: "Reddiss", phonemes: "ɹˈɛdɪs" });
    // "a-sink" is "uh-sink" to misaki; it is "ay-sink".
    expect(said.get("async")).toEqual({ word: "async", say: "ay-sink", phonemes: "ˈAsɪŋk" });
    expect(said.get("WorkOS")?.phonemes).toBe("wˈɜɹk ˌOˈɛs");
    expect(said.get("Kubernetes")?.phonemes).toBe("kˌubəɹnˈɛtiz");
  });
});

describe("the list", () => {
  test("ttmi's list alone without words of the context's own", () => {
    const none = pronunciationList([]);
    expect(none).toHaveLength(PRONUNCIATIONS.length);
    expect(none.every((item) => item.source.kind === "ttmi")).toBe(true);
  });

  test("the context's own words win", () => {
    const list = pronunciationList([{ word: "redis", say: "Reddish", phonemes: "ɹˈɛdɪʃ" }, { word: "PSP", say: "P S P", phonemes: "pˌiˌɛspˈi" }]);
    const redis = list.filter((item) => item.word.toLowerCase() === "redis");
    expect(redis).toHaveLength(1);
    expect(redis[0]).toMatchObject({ say: "Reddish", phonemes: "ɹˈɛdɪʃ", source: { kind: "own" } });
    expect(list.find((item) => item.word === "PSP")?.source).toEqual({ kind: "own" });
  });

  test("ttmi's defaults made on /admin/words join its list, and the context's own words still win", () => {
    const defaults = [{ word: "Kafka", say: "kaf-ka", phonemes: "kˈæfkə" }, { word: "Redis", say: "ree-dis", phonemes: "ɹˈidɪs" }];
    const list = pronunciationList([{ word: "kafka", say: "kahf-ka", phonemes: "kˈɑfkə" }], defaults);
    expect(list.find((item) => item.word.toLowerCase() === "redis")).toMatchObject({ phonemes: "ɹˈidɪs", source: { kind: "ttmi" } });
    expect(list.filter((item) => item.word.toLowerCase() === "kafka")).toEqual([{ word: "kafka", say: "kahf-ka", phonemes: "kˈɑfkə", source: { kind: "own" } }]);
    expect(pronunciationList([], defaults).find((item) => item.word === "Kafka")?.source).toEqual({ kind: "ttmi" });
    // A broken default is left out, like a broken own word.
    expect(pronunciationList([], [{ word: "Odd", say: "odd", phonemes: "](/ɑd" }]).some((item) => item.word === "Odd")).toBe(false);
  });

  test("broken entries are left out", () => {
    const list = pronunciationList([
      { word: " ", say: "x", phonemes: "ˈɛks" },
      { word: "Fine", say: "", phonemes: "fˈIn" },
      { word: 3, say: "x", phonemes: "ˈɛks" } as never,
      { word: "Odd", say: "odd", phonemes: "](/ɑd" },
      { word: "Long", say: "long", phonemes: "ˈɑ".repeat(81) },
    ]);
    expect(list.some((item) => item.source.kind !== "ttmi")).toBe(false);
  });

  test("a spelling without phonemes, as words were kept before, is not read", () => {
    const list = pronunciationList([{ word: "Redis", say: "Red is" } as never, { word: "worker", say: "wurker" } as never]);
    expect(list.find((item) => item.word === "Redis")).toMatchObject({ say: "Reddiss", source: { kind: "ttmi" } });
    expect(list.find((item) => item.word === "worker")).toBeUndefined();
  });

  test("sorted by word", () => {
    const words = pronunciationList([]).map((item) => item.word.toLowerCase());
    expect(words).toEqual([...words].sort((a, b) => a.localeCompare(b)));
  });
});

describe("applying it", () => {
  const list = [
    { word: "Vite", say: "veet", phonemes: "vˈit" },
    { word: "Vitest", say: "veet test", phonemes: "vˈit tˌɛst" },
    { word: "Redis", say: "Reddiss", phonemes: "ɹˈɛdɪs" },
    { word: "Next.js", say: "Next J S", phonemes: "nˈɛkst ʤˌAˈɛs" },
  ];

  test("whole words, any case, marked with their phonemes the way misaki reads them", () => {
    expect(applyPronunciations("We keep jobs in Redis and redis.", list)).toBe("We keep jobs in [Redis](/ɹˈɛdɪs/) and [redis](/ɹˈɛdɪs/).");
    expect(applyPronunciations("Rediscover RedisX", list)).toBe("Rediscover RedisX");
  });

  test("the longest word first, and one pass, so a word inside another is not marked", () => {
    expect(applyPronunciations("Vitest runs on Vite.", list)).toBe("[Vitest](/vˈit tˌɛst/) runs on [Vite](/vˈit/).");
    expect(applyPronunciations("Built with Next.js, served by Vite", list)).toBe("Built with [Next.js](/nˈɛkst ʤˌAˈɛs/), served by [Vite](/vˈit/)");
  });

  test("a plural says the word with its s, the way English says it after the word's last sound", () => {
    const words = [...list, { word: "id", say: "i,d", phonemes: "ˈI dˈi" }, { word: "SaaS", say: "sass", phonemes: "sˈæs" }];
    expect(applyPronunciations("Two IDs and two ids.", words)).toBe("Two [IDs](/ˈI dˈiz/) and two [ids](/ˈI dˈiz/).");
    expect(applyPronunciations("Many Vites", words)).toBe("Many [Vites](/vˈits/)");
    expect(applyPronunciations("Two SaaSes", words)).toBe("Two [SaaSes](/sˈæsᵻz/)");
    // A word ending in a hiss takes "es", any other only "s".
    expect(applyPronunciations("SaaSs Vitees", words)).toBe("SaaSs Vitees");
  });

  test("a plural fixed of its own wins over the word's", () => {
    const words = [{ word: "id", say: "i,d", phonemes: "ˈI dˈi" }, { word: "ids", say: "eye dees", phonemes: "ˈI dˈis" }];
    expect(applyPronunciations("ids and id", words)).toBe("[ids](/ˈI dˈis/) and [id](/ˈI dˈi/)");
  });

  test("inside hyphenated words, the longest fixed word first", () => {
    const words = [{ word: "id", say: "i,d", phonemes: "ˈI dˈi" }, { word: "id-token", say: "i,d token", phonemes: "ˈI dˈi tˈOkən" }];
    expect(applyPronunciations("the user-id and id-based lookups", words)).toBe("the user-[id](/ˈI dˈi/) and [id](/ˈI dˈi/)-based lookups");
    expect(applyPronunciations("an id-token, two user-ids", words)).toBe("an [id-token](/ˈI dˈi tˈOkən/), two user-[ids](/ˈI dˈiz/)");
    expect(applyPronunciations("user_id sessionId", words)).toBe("user_id sessionId");
  });

  test("the spelling is never what is said", () => {
    expect(applyPronunciations("Redis", list)).not.toContain("Reddiss");
  });

  test("no list, the text as it is", () => {
    expect(applyPronunciations("Plain words.", [])).toBe("Plain words.");
  });

  test("the marked text in pieces, and as written", () => {
    const marked = applyPronunciations("Jobs wait in Redis, built with Vite.", list);
    expect(phonemePieces(marked)).toEqual([
      { text: "Jobs wait in " },
      { text: "Redis", phonemes: "ɹˈɛdɪs" },
      { text: ", built with " },
      { text: "Vite", phonemes: "vˈit" },
      { text: "." },
    ]);
    expect(plainText(marked)).toBe("Jobs wait in Redis, built with Vite.");
    expect(phonemePieces("Plain words.")).toEqual([{ text: "Plain words." }]);
    expect(markPhonemes("Redis", "ɹˈɛdɪs")).toBe("[Redis](/ɹˈɛdɪs/)");
  });
});

// What a sketch carries (docs/plan-voice.md, A sketch's own words): the
// entries of the lists given for the words its text uses, later lists
// winning, so whoever opens it hears what its owner set up.
describe("a sketch's words", () => {
  const text = "# sketch Jobs\nstep: queue\n  Jobs wait in Redis until a worker built with Vite is free.";
  const redis = { word: "redis", say: "Reddiss", phonemes: "ɹˈɛdɪs" };
  const vite = { word: "Vite", say: "veet", phonemes: "vˈit" };

  test("only the words the text uses, whole words, any case", () => {
    expect(sketchPronunciations(text, [redis, { word: "Postgres", say: "post-gress", phonemes: "pˈOstɡɹɛs" }, { word: "Vit", say: "x", phonemes: "ˈɛks" }])).toEqual([redis]);
  });

  test("a word the text uses only as a plural or inside a hyphenated word", () => {
    const id = { word: "id", say: "i,d", phonemes: "ˈI dˈi" };
    expect(sketchPronunciations("Jobs keep their IDs.", [id, redis])).toEqual([id]);
    expect(sketchPronunciations("Look up the user-id.", [id, redis])).toEqual([id]);
  });

  test("later lists win, one entry per word, sorted by word", () => {
    const kept = [vite, { word: "Redis", say: "Red is", phonemes: "ɹˈɛd ɪz" }];
    expect(sketchPronunciations(text, kept, [redis])).toEqual([redis, vite]);
  });

  test("broken entries are left out, a spelling alone among them, and a word no longer used goes", () => {
    expect(sketchPronunciations("Plain words.", [redis, { word: " ", say: "x", phonemes: "ˈɛks" }, { word: "Plain", say: 3, phonemes: "x" } as never])).toEqual([]);
    expect(sketchPronunciations(text, [{ word: "Redis", say: "Red is" } as never, vite])).toEqual([vite]);
  });

  test("at most SKETCH_PRONUNCIATIONS of them", () => {
    const many = Array.from({ length: SKETCH_PRONUNCIATIONS + 20 }, (_, index) => ({ word: `w${index}`, say: "x", phonemes: "ˈɛks" }));
    expect(sketchPronunciations(many.map((item) => item.word).join(" "), many)).toHaveLength(SKETCH_PRONUNCIATIONS);
  });

  test("the same list twice is the same", () => {
    expect(samePronunciations([vite], [{ ...vite }])).toBe(true);
    expect(samePronunciations([vite], [{ ...vite, phonemes: "vˈIt" }])).toBe(false);
    expect(samePronunciations(undefined, [])).toBe(true);
  });
});

describe("phonemes", () => {
  test("are sounds alone", () => {
    expect(phonemesOk("ɹˈɛdɪs")).toBe(true);
    expect(phonemesOk("stˈændəɹd ˈWt")).toBe(true);
    for (const odd of ["", " ɹˈɛdɪs", "ɹˈɛdɪs ", "a  b", "ɹˈɛ/dɪs", "ɹ](/x", "nˈɛkst.ʤˈA", "a, b", "a\nb"]) expect(phonemesOk(odd)).toBe(false);
  });

  test("what the phonemizer made, its punctuation dropped", () => {
    expect(soundsOnly("nˈɛkst ʤˈA. ˈɛs!")).toBe("nˈɛkst ʤˈA ˈɛs");
    expect(soundsOnly(" ˈAsɪŋk, ")).toBe("ˈAsɪŋk");
  });
});
