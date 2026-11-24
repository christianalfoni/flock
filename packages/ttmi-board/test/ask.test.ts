import { describe, expect, it } from "vitest";
import { askPrompt, askResume, askSummaryKey, ASK_CONTINUE_HINT, ASK_INSTRUCTION, countedStepAt, firstCountedStep, indexForCountedStep, stepLink } from "../src/ask";

const hops = [
  { kind: "overview" },
  { kind: "hop", narration: "The API answers at once." },
  { kind: "hop", narration: "A worker takes the job." },
  { kind: "summary", narration: "That is the path." },
];

describe("counted steps", () => {
  it("skips a silent overview, the way the step bar does", () => {
    expect(firstCountedStep(hops)).toBe(1);
    expect(countedStepAt(hops, 0)).toBeUndefined();
    expect(countedStepAt(hops, 2)).toEqual({ step: 2, count: 3 });
    expect(indexForCountedStep(hops, 2)).toBe(2);
    expect(indexForCountedStep(hops, 4)).toBeUndefined();
    expect(indexForCountedStep(hops, 0)).toBeUndefined();
  });

  it("counts an overview that has words as step 1", () => {
    const steps = [{ kind: "overview", narration: "Why this exists." }, { kind: "step", narration: "Then the work." }];
    expect(firstCountedStep(steps)).toBe(0);
    expect(indexForCountedStep(steps, 1)).toBe(0);
  });
});

describe("askPrompt", () => {
  it("is the question, the sketch, the ask, and one instruction", () => {
    const text = askPrompt({
      question: "Why does the worker get its own step?",
      id: "sk2",
      url: stepLink("http://localhost:5173", "sk2", 2),
      askId: "ask1",
    });
    expect(text).toBe([
      "Why does the worker get its own step?",
      "",
      "Sketch ID: sk2",
      "URL: http://localhost:5173/s/sk2?step=2",
      "Ask ID: ask1",
      "",
      ASK_INSTRUCTION,
    ].join("\n"));
    expect(text).toContain("get_sketch");
    expect(text).toContain("save_sketch");
    expect(text).not.toContain("Title:");
    expect(text).not.toContain("Box:");
  });
});

describe("an answered ask waits for the reader", () => {
  it("resumes at the agent's step, or the one they asked about", () => {
    expect(askResume({ step: 1, resumeStep: 2 })).toEqual({ step: 2 });
    expect(askResume({ step: 4 })).toEqual({ step: 4 });
    expect(askResume({ step: 2, resumeStep: 2, resumeCanvas: "sk2" }, "sk2")).toEqual({ step: 2 });
    expect(askResume({ step: 1, resumeStep: 3, resumeCanvas: "canvas" }, "sk2")).toEqual({ step: 3, canvas: "canvas" });
  });

  it("Space continues, including while the summary is still being said", () => {
    expect(askSummaryKey(" ")).toBe("continue");
    expect(askSummaryKey("ArrowRight")).toBeUndefined();
    expect(askSummaryKey("Enter")).toBeUndefined();
    expect(askSummaryKey("c")).toBeUndefined();
    expect(`${ASK_CONTINUE_HINT.key} ${ASK_CONTINUE_HINT.label}`).toBe("Space to continue");
  });
});
