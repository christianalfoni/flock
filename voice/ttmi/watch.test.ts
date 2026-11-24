import { describe, expect, test } from "vitest";
import { fakeBackend } from "./fake";
import { OrtRunError, shouldUseCpu } from "./phonon/support";
import { jobBudget, withTimeout } from "./watch";

describe("a voice run that never finishes", () => {
  test("the deadline rejects, so a fallback can run", async () => {
    const hung = new Promise(() => {});
    await expect(withTimeout(hung, 20, "The voice model")).rejects.toBeInstanceOf(OrtRunError);
  });

  test("a backend that never speaks loses to the step's budget", async () => {
    const backend = fakeBackend({ hang: true, deadlineMs: 20 });
    const hung = backend.synth({ segments: [{ text: "Hello." }] }, "miles");
    await expect(withTimeout(hung, jobBudget(6, undefined, 20), "Speaking this step")).rejects.toThrow(/timed out/);
  });

  test("the budget is three times the machine's pace, and at least ten seconds", () => {
    expect(jobBudget(30, 10)).toBe(10_000);
    expect(jobBudget(100, 5)).toBe(60_000);
    expect(jobBudget(100, undefined, 15)).toBe(15);
  });

  test("only a WebGPU runtime failure falls back to the CPU", () => {
    expect(shouldUseCpu("webgpu", false, new OrtRunError("timed out"))).toBe(true);
    expect(shouldUseCpu("webgpu", true, new OrtRunError("timed out"))).toBe(false);
    expect(shouldUseCpu("wasm", false, new OrtRunError("timed out"))).toBe(false);
    expect(shouldUseCpu("webgpu", false, new TypeError("align"))).toBe(false);
  });
});
