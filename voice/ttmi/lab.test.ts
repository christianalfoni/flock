import { describe, expect, it } from "vitest";
import { compile, measure, TODAY, type LabOptions } from "./lab";

const calm: LabOptions = { ...TODAY, speed: 0.9, beat: ",", pause: "…", long: ". …", paragraph: "…" };
const held: LabOptions = { ...calm, hold: { sentence: 0.2, beat: 0, pause: 0.25, long: 0.6, paragraph: 0.5 } };

describe("the voice lab", () => {
  it("says the step as the board does when nothing is set", () => {
    expect(compile("So… [pause] it *waits*.\n\nThen it goes.", TODAY)).toMatchObject({ text: "So… it waits. Then it goes.", speed: 1 });
  });

  it("turns pauses and paragraphs into Kokoro's own punctuation", () => {
    expect(compile("One [beat] two. [pause] Three.\n\nFour. [long] Five.", calm).text).toBe("One, two… Three… Four. … Five.");
  });

  it("keeps a question's mark over a written pause", () => {
    expect(compile("Why? [pause] Because.", calm).text).toBe("Why? Because.");
  });

  it("emphasizes with punctuation, or with stress in the phonemes", () => {
    expect(compile("It lands in *dead letters*.", { ...calm, emphasis: "dash" }).text).toBe("It lands in — dead letters.");
    expect(compile("It lands in *dead letters*.", { ...calm, emphasis: "commas" }).text).toBe("It lands in, dead letters.");
    expect(compile("It lands in *dead letters*, and waits.", { ...calm, emphasis: "commas" }).text).toBe("It lands in, dead letters, and waits.");
    expect(compile("It lands in *dead letters*.", { ...calm, emphasis: "stress" }).pieces).toEqual([{ text: "It lands in " }, { text: "dead letters", emphasis: true }, { text: "." }]);
  });

  it("holds pauses in the one clip, before the words that follow them", () => {
    const step = compile("One. [pause] Two, [beat] three. Four.\n\nFive.", held);
    expect(step.text).toBe("One… Two, three. Four… Five.");
    expect(step.pieces).toEqual([
      { text: "One… " },
      { text: "Two, three. ", hold: 0.25 },
      { text: "Four… ", hold: 0.2 },
      { text: "Five.", hold: 0.5 },
    ]);
    expect(step.shown).toBe("One… ⏸0.25 Two, three. ⏸0.20 Four… ⏸0.50 Five.");
  });

  it("holds nothing when no hold is set", () => {
    expect(compile("One. Two.\n\nThree.", calm).pieces).toEqual([{ text: "One. Two… Three." }]);
  });

  it("slows a dense step and speeds a light one", () => {
    const light = measure("The API takes a job. It puts it on the queue.");
    const dense = measure("The WorkerPool dequeues each RetryableJob, deserializes its payload, validates the idempotencyKey, and acquires a distributed lease before execution begins.");
    expect(light.factor).toBeGreaterThan(1);
    expect(dense.factor).toBeLessThan(0.92);
    expect(compile("The API takes a job.", { ...calm, paced: true }).speed).toBeCloseTo(0.9 * light.factor, 2);
  });
});
