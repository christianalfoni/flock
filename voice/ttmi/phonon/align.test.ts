import { describe, expect, test } from "vitest";
import { attentionWordTimes, cuesFromWords, durationDelta, heuristicWordTimes, mapTokensToWords, mergeShortFinal, modelText, monotonicPath, placeBlixtTimings, placeSpokenTimings, respell, segmentWords, speakable, speechBounds, splitSentences, spokenPlan, timingDrift, wordTimesFromPath, wordsOf } from "./align";
import { encode, type TokenizerModel } from "./tokenize";
import tokenizerJson from "./tokenizer.json";

const NODE = "A node runs the agent CLIs, Claude Code and Codex, as one OS process per chat.";
const FILE = "Each node keeps its chats in its own node.db.";

describe("speakable", () => {
  test("turns a dash between words into a comma pause, and leaves a dash inside a word", () => {
    expect(speakable("a picture instead -- one you can play")).toBe("a picture instead, one you can play.");
    expect(speakable("a picture instead – one you can play")).toBe("a picture instead, one you can play.");
    expect(speakable("a picture instead — one you can play")).toBe("a picture instead, one you can play.");
    expect(speakable("building the mental image — not reading text")).toBe("building the mental image, not reading text.");
    expect(speakable("already paused, -- then on")).toBe("already paused, then on.");
    expect(speakable("already paused; — then on")).toBe("already paused; then on.");
    expect(speakable("already paused: -- then on")).toBe("already paused: then on.");
    expect(speakable("ranges 1–3 and a--b stay")).toBe("ranges 1–3 and a--b stay.");
    expect(speakable("Open the test-run controls.")).toBe("Open the testrun controls.");
    expect(speakable("Open the test-run controls")).toBe("Open the testrun controls.");
    expect(speakable("Are the controls on?")).toBe("Are the controls on?");
  });
});

describe("what Gradium is given", () => {
  test("keeps a hyphen, a short last sentence and a spaced double hyphen, and pauses at an em dash", () => {
    expect(modelText("Open the test-run controls.")).toBe("Open the test-run controls.");
    expect(modelText("Nothing changes on screen when ids are unique. Click a canvas to dive in.")).toBe("Nothing changes on screen when I-Ds are unique. Click a canvas to dive in.");
    expect(modelText("a picture instead -- one you can play")).toBe("a picture instead -- one you can play.");
    expect(modelText("building the mental image — not reading text.")).toBe("building the mental image, not reading text.");
    expect(modelText("a picture instead – one you can play")).toBe("a picture instead, one you can play.");
    expect(modelText("already paused, — then on")).toBe("already paused, then on.");
    expect(modelText("ranges 1–3 stay")).toBe("ranges 1–3 stay.");
    expect(modelText("Open TTMI next, and ttmi too.")).toBe("Open TTMI next, and ttmi too.");
  });

  test("a hyphen stays one shown word, and the words around an em dash stay themselves", () => {
    const original = "Open the test-run controls. Building the mental image — not reading text.";
    const plan = spokenPlan(original);
    expect(plan.spoken).toBe("Open the test-run controls. Building the mental image, not reading text.");
    expect(plan.links).toHaveLength(wordsOf(plan.spoken).length);
    const shown = wordsOf(original);
    const link = (surface: string) => plan.links.find((item) => plan.spoken.slice(item.start, item.end) === surface)!;
    expect(shown[link("test-run")!.origin]!.text).toBe("test-run");
    expect(shown[link("not")!.origin]!.text).toBe("not");
    const placed = placeSpokenTimings(original, plan.links, [
      { start: link("test-run")!.start, end: link("test-run")!.end, from: 1.1, to: 1.5 },
    ]);
    expect(placed.find((word) => word.text === "test-run")).toMatchObject({ from: 1.1, to: 1.5, start: shown.find((word) => word.text === "test-run")!.start });
  });

  test("blixt timings drop glued punctuation and land on the shown word", () => {
    const original = "Open the test-run controls. The same id holds.";
    const placed = placeBlixtTimings(original, [
      { text: "Open", start: 0.1, end: 0.4 },
      { text: "the", start: 0.4, end: 0.5 },
      { text: "test-run", start: 0.5, end: 1.1 },
      { text: "controls.", start: 1.1, end: 1.6 },
      { text: "The", start: 1.7, end: 1.9 },
      { text: "same", start: 1.9, end: 2.1 },
      { text: "I-D", start: 2.1, end: 2.5 },
      { text: "holds.", start: 2.5, end: 3 },
    ]);
    expect(placed.find((word) => word.text === "test-run")).toMatchObject({ from: 0.5, to: 1.1 });
    expect(placed.find((word) => word.text === "controls")).toMatchObject({ from: 1.1, to: 1.6 });
    expect(placed.find((word) => word.text === "id")).toMatchObject({ from: 2.1, to: 2.5 });
  });

  test("a word's token times stay inside the word highlight", () => {
    const placed = placeBlixtTimings("Open the test-run controls.", [
      { text: "Open", start: 0.1, end: 0.3, tokens: [{ text: "Open", start: 0.1, end: 0.3 }] },
      { text: "the", start: 0.3, end: 0.4 },
      {
        text: "test-run",
        start: 0.4,
        end: 0.9,
        tokens: [
          { text: "test", start: 0.4, end: 0.6 },
          { text: "-", start: 0.6, end: 0.65 },
          { text: "run", start: 0.65, end: 0.9 },
        ],
      },
      { text: "controls.", start: 0.9, end: 1.3 },
    ]);
    expect(placed.find((word) => word.text === "test-run")).toMatchObject({ from: 0.4, to: 0.9 });
    expect(placed.find((word) => word.text === "controls")).toMatchObject({ from: 0.9, to: 1.3 });
  });
});

describe("words", () => {
  test("keeps acronyms, file names and the words inside parentheses", () => {
    const words = wordsOf("It adds the kit (a card and a skill) to every chat and compiles the boxes agents write.");
    expect(words.map((word) => word.text)).toEqual(["It", "adds", "the", "kit", "a", "card", "and", "a", "skill", "to", "every", "chat", "and", "compiles", "the", "boxes", "agents", "write"]);
    expect(wordsOf(FILE).map((word) => word.text)).toContain("node.db");
    expect(wordsOf(NODE).map((word) => word.text)).toContain("CLIs");
    expect(wordsOf("Open the test-run controls.").map((word) => word.text)).toContain("test-run");
  });

  test("does not split a file name into its own sentence", () => {
    const text = `${NODE} ${FILE}`;
    expect(splitSentences(text)).toEqual([NODE, FILE]);
  });

  test("joins a short final sentence onto the one before, so it can fall", () => {
    const sentences = ["Nothing changes on screen when ids are unique.", "Click a canvas to dive in."];
    expect(mergeShortFinal(sentences)).toEqual(["Nothing changes on screen when ids are unique, click a canvas to dive in."]);
    expect(mergeShortFinal(["Only one."])).toEqual(["Only one."]);
    expect(mergeShortFinal(["This change names every record by its slot, from the document's change log through the shared indexes to each reader."])).toEqual(["This change names every record by its slot, from the document's change log through the shared indexes to each reader."]);
  });
});

describe("token to word", () => {
  test("maps pieces of CLIs and node.db onto those words, and leaves the comma out", () => {
    const tokens = ["▁A", "▁no", "de", "▁run", "s", "▁the", "▁agent", "▁C", "L", "I", "s", ",", "▁chat"];
    const text = "A node runs the agent CLIs, chat.";
    const words = wordsOf(text).map((word) => word.text);
    const owners = mapTokensToWords(tokens, text);
    expect(words[owners[7]!]!).toBe("CLIs");
    expect(words[owners[8]!]!).toBe("CLIs");
    expect(words[owners[10]!]!).toBe("CLIs");
    expect(owners[11]).toBeNull();
    const fileTokens = ["▁E", "ach", "▁no", "de", "▁keep", "s", "▁it", "s", "▁ch", "at", "s", "▁in", "▁it", "s", "▁own", "▁no", "de", ".", "d", "b", "."];
    const fileWords = wordsOf(FILE).map((word) => word.text);
    const fileOwners = mapTokensToWords(fileTokens, FILE);
    expect(fileWords[fileOwners[15]!]!).toBe("node.db");
    expect(fileWords[fileOwners[18]!]!).toBe("node.db");
    expect(fileWords[fileOwners[19]!]!).toBe("node.db");
    expect(fileOwners[20]).toBeNull();
  });
});

describe("attention path", () => {
  test("stays monotonic and finishes on the last token", () => {
    const weights = [
      [0.9, 0.1, 0],
      [0.2, 0.7, 0.1],
      [0.8, 0.1, 0.1],
      [0, 0.2, 0.8],
      [0, 0.1, 0.9],
    ];
    const path = monotonicPath(weights);
    expect(path[0]).toBe(0);
    expect(path[path.length - 1]).toBe(2);
    for (let index = 1; index < path.length; index++) expect(path[index]!).toBeGreaterThanOrEqual(path[index - 1]!);
  });

  test("a frame on a comma keeps the highlight on the word before it", () => {
    const tokens = ["▁CL", "I", "s", ",", "▁chat"];
    const path = [0, 1, 2, 3, 3, 4];
    const times = wordTimesFromPath(tokens, path, "CLIs, chat.", 0.08);
    const clis = times.find((word) => word.text === "CLIs")!;
    const chat = times.find((word) => word.text === "chat")!;
    expect(clis.to).toBeCloseTo(chat.from);
    expect(chat.from).toBeCloseTo(5 * 0.08);
  });

  test("joins sentences on the audio clock", () => {
    const times = attentionWordTimes(
      [
        { text: "Hello.", tokens: ["▁Hello", "."], weights: [[1, 0], [0.2, 0.8]], samples: 1600 },
        { text: "Go.", tokens: ["▁Go", "."], weights: [[1, 0], [0, 1]], samples: 1600 },
      ],
      8000,
    );
    expect(times.map((word) => word.text)).toEqual(["Hello", "Go"]);
    expect(times[1]!.from).toBeGreaterThanOrEqual(1600 / 8000);
  });
});

describe("heuristic timing", () => {
  test("drops the silence and gives a comma more time than a short word", () => {
    const samples = new Float32Array(8000);
    for (let index = 1000; index < 7000; index++) samples[index] = Math.sin(index / 8) * 0.5;
    expect(speechBounds(samples, 8000).start).toBeGreaterThan(0);
    expect(speechBounds(samples, 8000).end).toBeLessThan(1);
    const times = heuristicWordTimes([{ text: "Hello, hi.", samples }], 8000);
    const hello = times.find((word) => word.text === "Hello")!;
    const hi = times.find((word) => word.text === "hi")!;
    expect(hello.to - hello.from).toBeGreaterThan(hi.to - hi.from);
    expect(hello.from).toBeGreaterThan(0);
    expect(hi.to).toBeLessThan(1);
  });

  test("a sentence's words stay inside that sentence's audio", () => {
    const tone = (length: number) => {
      const samples = new Float32Array(length);
      samples.fill(0.2);
      return samples;
    };
    const times = heuristicWordTimes(
      [
        { text: "One two.", samples: tone(8000) },
        { text: "Three.", samples: tone(8000) },
      ],
      8000,
    );
    expect(times.find((word) => word.text === "One")!.to).toBeLessThanOrEqual(1);
    expect(times.find((word) => word.text === "Three")!.from).toBeGreaterThanOrEqual(1);
  });
});

describe("quality and cues", () => {
  test("scaling removes a voice that is simply slower", () => {
    const reference = [
      { text: "Hi", start: 0, end: 2, from: 0, to: 0.4 },
      { text: "there", start: 3, end: 8, from: 0.4, to: 1 },
    ];
    const slower = reference.map((word) => ({ ...word, from: word.from * 2, to: word.to * 2 }));
    expect(timingDrift(reference, slower, true).medianMs).toBe(0);
    expect(timingDrift(reference, slower).medianMs).toBeGreaterThan(0);
  });

  test("a word split across pieces does not shift the later cues", () => {
    const words = [
      { text: "hello", start: 0, end: 5, from: 0.1, to: 0.4 },
      { text: "there", start: 6, end: 11, from: 0.5, to: 0.9 },
    ];
    const segments = [{ text: "hel" }, { text: "lo ", name: "split" }, { text: "there", name: "there" }];
    expect(segmentWords(segments, words).map((group) => group.map((word) => word.text))).toEqual([["hello"], [], ["there"]]);
    expect(cuesFromWords(segments, words)).toEqual([{ name: "there", from: 0.5, to: 0.9 }]);
  });

  test("a named piece starts when its first word does", () => {
    const words = wordTimesFromPath(["▁the", "▁worker"], [0, 0, 1, 1], "the worker", 0.1);
    const cues = cuesFromWords([{ text: "the " }, { text: "worker", name: "worker" }], words);
    expect(cues).toEqual([{ name: "worker", from: words[1]!.from, to: words[1]!.to }]);
  });

  test("duration delta stays inside the range the model likes", () => {
    // The paced 1× (about 0.92) sits just under the conditioner's neutral.
    // Above that, the words get shorter.
    expect(durationDelta(0.92)).toBeCloseTo(-0.018);
    expect(durationDelta(1)).toBeCloseTo(-0.11);
    expect(durationDelta(1.2)).toBeCloseTo(-0.34);
    expect(durationDelta(0.5)).toBe(0.2);
  });
});

describe("the pronunciation lexicon", () => {
  test("respells whole words in any case, keeping a trailing 's", () => {
    expect(speakable("Open ttmi's sketch in TTMI or Ttmi.")).toBe("Open TTMI's sketch in TTMI or TTMI.");
    expect(speakable("Pipe stdout to nginx, then kubectl.")).toBe("Pipe standard out to engine X, then cube control.");
    expect(speakable("ttmis and myttmi stay")).toBe("ttmis and myttmi stay.");
  });

  test("every spoken word points back to the word it came from", () => {
    expect(respell("Then WorkOS signs in.").origin).toEqual([0, 1, 1, 1, 2, 3]);
  });

  test("tokens of a respelled word belong to the one word shown", () => {
    const text = "Pipe stdout to nginx, then WorkOS and ttmi.";
    const { tokens } = encode(tokenizerJson as unknown as TokenizerModel, speakable(text));
    const owners = mapTokensToWords(tokens, text);
    const words = wordsOf(text).map((word) => word.text);
    const said = (word: string) => tokens.filter((_, index) => owners[index] !== null && words[owners[index]!] === word).join("").replace(/▁/g, " ").trim();
    expect(said("stdout")).toBe("standard out");
    expect(said("nginx")).toBe("engine X");
    expect(said("WorkOS")).toBe("work O S");
    expect(said("ttmi")).toBe("TTMI");
    expect(owners.filter((owner) => owner !== null).every((owner) => owner! < words.length)).toBe(true);
  });

  test("streaming word times stay on the shown words", () => {
    const text = "Then WorkOS signs in.";
    const { tokens } = encode(tokenizerJson as unknown as TokenizerModel, speakable(text));
    const path = tokens.map((_, index) => index);
    const times = wordTimesFromPath(tokens, path, text, 0.08);
    expect(times.map((word) => word.text)).toEqual(["Then", "WorkOS", "signs", "in"]);
    for (let index = 1; index < times.length; index++) expect(times[index]!.from).toBeGreaterThanOrEqual(times[index - 1]!.to - 1e-9);
    expect(times[1]!.to - times[1]!.from).toBeGreaterThan(0.08 * 2);
  });
});
