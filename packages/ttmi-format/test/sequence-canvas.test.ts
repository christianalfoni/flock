// The canvas the up arrow opens (docs/plan-portals.md): the first canvas
// on the arrows this step itself names that the reader has not entered.
// The step does not follow arrows past its own. Appearing on an earlier
// step is not the same as being entered.
import { describe, expect, it } from "vitest";
import { parseSketch, sequenceCanvas, type SketchStep } from "../src/index";

function hop(source: string, seq: string, entered?: readonly string[]): string | undefined {
  const { shapes, steps } = parseSketch(source);
  const index = steps.findIndex((step) => step.names.includes(`#${seq}`));
  return sequenceCanvas(shapes, steps, index, undefined, entered ? new Set(entered) : undefined);
}

const OVERVIEW = `# sketch PR 15165 overview
problem: box "Problem"
outbox: box "Outbox" link "skout"
trace: box "Trace" link "sktrace"
coalesce: box "Coalesce" link "skcoal"
fixed: box "Fixed"
problem -> outbox "file" seq 1
  A problem is filed in the outbox.
outbox -> trace "follow" seq 2
  The outbox is traced.
trace -> coalesce "join" seq 3
  Traces coalesce.
coalesce -> fixed "done" seq 4
  The fix lands.`;

describe("the canvas a step opens", () => {
  it("opens the first canvas on this step when the reader has not entered one", () => {
    expect(hop(OVERVIEW, "1")).toBe("skout");
    // Step 2 starts on the outbox. Step 1 drew it, and the reader never entered it.
    expect(hop(OVERVIEW, "2")).toBe("skout");
    expect(hop(OVERVIEW, "3")).toBe("sktrace");
    expect(hop(OVERVIEW, "4")).toBe("skcoal");
  });

  it("skips a canvas the reader entered and opens the next one on this step", () => {
    expect(hop(OVERVIEW, "2", ["skout"])).toBe("sktrace");
    expect(hop(OVERVIEW, "3", ["skout", "sktrace"])).toBe("skcoal");
    // Step 4's only canvas is coalesce, which the reader entered on step 3.
    expect(hop(OVERVIEW, "4", ["skcoal"])).toBe("skcoal");
    // Every canvas on the step was entered, so the step's first opens again.
    expect(hop(OVERVIEW, "2", ["skout", "sktrace"])).toBe("skout");
  });

  it("after the canvas at the end of a step was entered, the next step opens its later canvas", () => {
    const source = `# sketch T
plain: box "Plain"
end: box "End" link "skend"
next: box "Next" link "sknext"
plain -> end "go" seq 1
  The canvas is at the end.
end -> next "on" seq 2
  The next sequence starts there.`;
    expect(hop(source, "1")).toBe("skend");
    // Not entered: the next step still opens its start, which is that canvas.
    expect(hop(source, "2")).toBe("skend");
    expect(hop(source, "2", ["skend"])).toBe("sknext");
  });

  it("opens the first of two canvases, and the first canvas of the next sequence", () => {
    const source = `# sketch T
one: box "One" link "skone"
two: box "Two" link "sktwo"
three: box "Three" link "skthree"
four: box "Four" link "skfour"
one -> two "go" seq 1
  Two canvases.
three -> four "on" seq 2
  The next sequence.`;
    expect(hop(source, "1")).toBe("skone");
    expect(hop(source, "1", ["skone"])).toBe("sktwo");
    // The next sequence's first canvas, whether or not the previous sequence was entered.
    expect(hop(source, "2")).toBe("skthree");
    expect(hop(source, "2", ["skone"])).toBe("skthree");
  });

  it("a later step that also attaches an entered canvas skips it", () => {
    const source = `# sketch T
one: box "One" link "skone"
mid: box "Mid"
other: box "Other" link "skother"
late: box "Late" link "sklate"
one -> mid "go" seq 1
  One is entered.
mid -> other "on" seq 2
  Something else.
one -> late "back" seq 3
  One again, then late.`;
    expect(hop(source, "3")).toBe("skone");
    expect(hop(source, "3", ["skone"])).toBe("sklate");
    expect(hop(source, "2", ["skone"])).toBe("skother");
  });

  it("opens the first node when the step starts on a fresh canvas", () => {
    const source = `# sketch T
fresh: box "Fresh" link "skfresh"
next: box "Next" link "sknext"
fresh -> next "go" seq 1
  It starts on the canvas.`;
    expect(hop(source, "1")).toBe("skfresh");
  });

  it("on a shared stop, opens the first fresh canvas in branch order", () => {
    const source = `# sketch T
a: box "A"
b: box "B"
c: box "C" link "skc"
d: box "D" link "skd"
a -> b "start" seq 1
  Start.
b -> c "left" seq 2a
  Left.
b -> d "right" seq 2b
  Right.`;
    expect(hop(source, "1")).toBeUndefined();
    expect(hop(source, "2a")).toBe("skc");
  });

  it("does not follow a branch, or a later arrow, that this step does not name", () => {
    const oneBranch = `# sketch T
b: box "B"
c: box "C" link "skc"
d: box "D" link "skd"
b -> c seq 2a
b -> d seq 2b
step: #2a
  The short branch.`;
    const { shapes, steps } = parseSketch(oneBranch);
    const index = steps.findIndex((step) => step.names.includes("#2a"));
    expect(sequenceCanvas(shapes, steps, index)).toBe("skc");
    const right = parseSketch(oneBranch.replace("step: #2a\n  The short branch.", "step: #2b\n  The right branch."));
    const rightAt = right.steps.findIndex((step) => step.names.includes("#2b"));
    expect(sequenceCanvas(right.shapes, right.steps, rightAt)).toBe("skd");

    const onward = `# sketch T
b: box "B"
c: box "C" link "skc"
e: box "E" link "ske"
b -> c "left" seq 2
  Left.
c -> e "on" seq 3
  Further.`;
    expect(hop(onward, "2")).toBe("skc");
    // Step 3 starts on c. It was drawn on step 2, and it stays the one to
    // open until the reader has entered it.
    expect(hop(onward, "3")).toBe("skc");
    expect(hop(onward, "3", ["skc"])).toBe("ske");
  });

  it("has none when the step's arrows touch no canvas", () => {
    const source = `# sketch T
only: box "Only" link "skonly"
mid: box "Mid"
end: box "End"
loose: box "Loose" link "skloose"
only -> mid "go" seq 1
  First.
mid -> end "on" seq 2
  Second.`;
    expect(hop(source, "1")).toBe("skonly");
    expect(hop(source, "2")).toBeUndefined();
  });

  it("ignores a canvas on a hop this step does not name", () => {
    const source = `# sketch T
a: box "A" link "ska"
b: box "B"
c: box "C"
d: box "D"
a -> b "one" seq 1
  One.
c -> d "two" seq 2
  Two.`;
    expect(hop(source, "1")).toBe("ska");
    expect(hop(source, "2")).toBeUndefined();
  });

  it("has none when the step names no hop", () => {
    const { shapes, steps } = parseSketch(`# sketch T
a: box "A" link "ska"
b: box "B" link "skb"
a -> b "go" seq 1
overview:
  Why this exists.
summary:
  Done.`);
    const at = (name: SketchStep["kind"]) => steps.findIndex((step) => step.kind === name);
    expect(sequenceCanvas(shapes, steps, at("overview"))).toBeUndefined();
    expect(sequenceCanvas(shapes, steps, at("summary"))).toBeUndefined();
    expect(sequenceCanvas(shapes, steps, -1)).toBeUndefined();
  });

  it("reads a canvas written as a sketch url", () => {
    const source = `# sketch T
start: box "Start"
end: box "https://ttmi.ai/s/skend"
start -> end "go" seq 1
  Onward.`;
    expect(hop(source, "1")).toBe("skend");
    const local = parseSketch(source.replace("https://ttmi.ai/s/skend", "http://localhost:5173/s/skend"));
    const index = local.steps.findIndex((step) => step.names.includes("#1"));
    expect(sequenceCanvas(local.shapes, local.steps, index, "localhost")).toBe("skend");
    expect(sequenceCanvas(local.shapes, local.steps, index, "localhost", new Set(["skend"]))).toBe("skend");
  });
});
