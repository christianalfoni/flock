import { narrationParts, parseSketch } from "@ttmi/format";
import { describe, expect, it } from "vitest";
import { heldCues } from "./cues";
import { BASE_SPEED, density, lastSentence, paceStep, paceWalkthrough, stepLoads } from "./pace";
import { clipKey } from "./protocol";
import { SKETCHES } from "./samples";

const sketch = (index: number) => {
  const { shapes, steps, groups } = parseSketch(SKETCHES[index]!.source);
  const names = [...shapes.flatMap((shape) => (shape.kind !== "arrow" && shape.name ? [shape.name] : [])), ...groups.map((group) => group.name)];
  return { loads: stepLoads(shapes, steps, groups), parts: steps.map((step) => narrationParts(step.narration, names)) };
};

describe("what a step brings in", () => {
  it("is what it names that was not showing, its group's members too", () => {
    const { loads } = sketch(0);
    expect(loads.map((load) => [...load.fresh.keys()])).toEqual([["api", "queue"], ["worker"], ["retry", "dlq"], []]);
    const signIn = sketch(1).loads;
    expect([...signIn[2]!.fresh]).toEqual([["edge", "group"], ["fn", "box"], ["store", "box"], ["claims", "note"]]);
  });

  it("weighs a note more than a box, and the first step most", () => {
    const { loads } = sketch(0);
    expect(loads.map((load) => load.load)).toEqual([3, 1, loads[2]!.load, 0]);
    expect(loads[2]!.load).toBeGreaterThan(2.5);
  });
});

describe("a paced step", () => {
  const { loads, parts } = sketch(0);
  const paced = parts.map((step, index) => paceStep(step, loads[index]!));

  it("keeps the words exactly, only cut where the holds are", () => {
    paced.forEach((step, index) => expect(step.segments.map((segment) => segment.text).join("")).toBe(parts[index]!.map((part) => part.text).join("")));
  });

  it("breathes between sentences and holds the pause after a new shape's name", () => {
    expect(paced[0]!.segments).toEqual([
      { text: "A request comes in. " },
      { text: "The ", hold: 0.24 },
      { text: "API server", name: "api" },
      { text: " doesn't do the work itself. " },
      { text: "It puts a job on the ", hold: 0.3 },
      { text: "queue", name: "queue" },
      { text: ", " },
      { text: "and answers straight away.", hold: 0.3 },
    ]);
    // A note's name holds longer.
    expect(paced[2]!.segments.find((segment) => segment.text.startsWith(" but only twice") || segment.text.startsWith("but only twice"))?.hold).toBe(0.5);
  });

  it("holds nothing after a shape that is only pointed at again", () => {
    expect(paced[3]!.segments.every((segment) => !segment.hold)).toBe(true);
  });

  it("gives a heavier step a longer lead-in and a slower voice, and the viewer's speed on top", () => {
    const [first, light, heavy, recap] = paced;
    expect(first!.leadIn).toBeGreaterThan(heavy!.leadIn!);
    expect(heavy!.leadIn).toBeGreaterThan(light!.leadIn!);
    expect(recap!.leadIn).toBe(0.3);
    expect(heavy!.speed).toBeLessThan(light!.speed!);
    expect(recap!.speed).toBeCloseTo(BASE_SPEED * density(parts[3]!.map((part) => part.text).join("")), 3);
    expect(paceStep(parts[3]!, loads[3]!, 1.1).speed).toBeCloseTo(recap!.speed! * 1.1, 2);
    // Out of bounds, the viewer's speed is held to them.
    expect(paceStep(parts[3]!, loads[3]!, 5).speed).toBeCloseTo(recap!.speed! * 1.2, 2);
  });
});

// A word said with its phonemes (docs/plan-voice-phonemes.md) is one word
// to the pacing: never cut, and as long as it is written.
describe("a word with its phonemes", () => {
  const load = { fresh: new Map([["api", "box" as const]]), load: 1, first: false };
  const parts = [{ text: "The " }, { text: "API", name: "api" }, { text: " runs [Next.js](/nˈɛkst ʤˌAˈɛs/). It answers." }];

  it("is never cut by a hold", () => {
    const step = paceStep(parts, load);
    expect(step.segments.map((segment) => segment.text).join("")).toBe(parts.map((part) => part.text).join(""));
    for (const segment of step.segments) expect(segment.text.split("[").length).toBe(segment.text.split("](/").length);
    expect(step.segments.at(-1)).toEqual({ text: "It answers.", hold: expect.any(Number) });
  });

  it("is paced as the word, not its phonemes", () => {
    const plain = [{ text: "The " }, { text: "API", name: "api" }, { text: " runs Next.js. It answers." }];
    expect(paceStep(parts, load).speed).toBe(paceStep(plain, load).speed);
  });
});

describe("cues in a held clip", () => {
  it("move by the lead-in and every hold before them", () => {
    const segments = [{ text: "A " }, { text: "box", name: "a" }, { text: ". ", hold: 0.2 }, { text: "Then ", hold: 0.3 }, { text: "this", name: "b" }];
    const cues = [{ name: "a", from: 0.1, to: 0.5 }, { name: "b", from: 1, to: 1.4 }];
    expect(heldCues(cues, segments, 0.4)).toEqual([{ name: "a", from: 0.5, to: 0.9 }, { name: "b", from: 1.9, to: 2.3 }]);
  });
});

describe("the words before a step", () => {
  const { loads, parts } = sketch(0);
  const steps = paceWalkthrough(parts, loads);

  it("are the last sentence of the step before, said first and cut off", () => {
    expect(steps[0]!.before).toBeUndefined();
    expect(steps[1]!.before).toBe("It puts a job on the queue, and answers straight away.");
    expect(steps[2]!.before).toBe("A worker takes jobs off the queue, one at a time.");
    // The steps are paced as on their own.
    expect(steps[1]!.segments).toEqual(paceStep(parts[1]!, loads[1]!).segments);
  });

  it("are the sentence's end, not the words of a reference cut in two", () => {
    expect(lastSentence("One. Two, three.")).toBe("Two, three.");
    expect(lastSentence("No stop at the end")).toBe("No stop at the end");
    expect(lastSentence("")).toBeUndefined();
  });

  it("are not part of the clip: they are no longer spoken", async () => {
    const step = { segments: [{ text: "A worker." }] };
    expect(await clipKey({ ...step, before: "One." }, "af_heart")).toBe(await clipKey(step, "af_heart"));
    expect(await clipKey({ segments: [{ text: "A worker!" }] }, "af_heart")).not.toBe(await clipKey(step, "af_heart"));
  });
});

describe("a step that names a hop", () => {
  it("brings in the shapes at both its ends", () => {
    const { shapes, steps, groups } = parseSketch(`# sketch Hops
chat: box "Chat"
chrome: box "Chrome"
app: box "App"
chat -> chrome seq 1 "click link"
chrome -> app seq 2 "open window"

step: #1
  You click the link.
step: #2
  Chrome opens the window.`);
    expect(stepLoads(shapes, steps, groups).map((load) => [...load.fresh.keys()])).toEqual([["chat", "chrome"], ["app"]]);
  });
});

describe("a walkthrough of overview, hops and summary", () => {
  it("introduces every part in the overview, a hop's ends at the hop, nothing in the summary", () => {
    const { shapes, steps, groups } = parseSketch(`# sketch Hops
overview:
  The parts.
chat: box "Chat"
chrome: box "Chrome"
app: box "App"
chat -> chrome seq 1 "click link"
  You click the link.
chrome -> app seq 2 "open window"
summary:
  That is all.`);
    const loads = stepLoads(shapes, steps, groups);
    expect(loads.map((load) => [...load.fresh.keys()])).toEqual([["chat", "chrome", "app"], ["chat", "chrome"], ["chrome", "app"], []]);
    expect(loads[0]!.first).toBe(true);
    expect(loads[3]!.load).toBe(1);
  });
});
