import { describe, expect, it } from "vitest";
import { pace } from "./pacing";
import { SKETCHES } from "./samples";

// The lab plays a walkthrough exactly as the board paces it (pace.test.ts
// covers the pacing); this is the lab's view of it.
describe("the lab's walkthrough", () => {
  const { steps, names } = pace(SKETCHES[0]!.source);

  it("shows what each step brings in and points at again", () => {
    expect(steps.map((step) => step.fresh.map((shape) => shape.name))).toEqual([["api", "queue"], ["worker"], ["retry", "dlq"], []]);
    expect(steps[3]!.again).toEqual(["api", "worker"]);
  });

  it("shows the holds where the board puts them", () => {
    expect(steps[0]!.compiled.shown).toBe("A request comes in. ⏸0.24 The API server doesn't do the work itself. ⏸0.30 It puts a job on the queue, ⏸0.30 and answers straight away.");
  });

  it("names a note by its heading", () => {
    expect(names.get("retry")?.label).toBe("Retry rule");
  });
});
