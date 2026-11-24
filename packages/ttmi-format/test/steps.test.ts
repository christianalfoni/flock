// What a walkthrough shows at each step (docs/format.md, Steps semantics),
// on the three-step example from steps-run.cjs.
import { describe, expect, it } from "vitest";
import { parseSketch, serializeSketch, stepView, type Shape } from "../src/index";
import { arrows, boxesByName, example } from "./helpers";

describe("stepView", () => {
  const { shapes, steps } = parseSketch(example("job-retries-steps.sketch"));
  const by = boxesByName(shapes);
  const id = (name: string) => by.get(name)!.id;
  const arrow = (label: string) => arrows(shapes).find((item) => item.label === label)!.id;
  const retryArrow = arrows(shapes).find((item) => !item.label)!.id;

  it("has three steps", () => {
    expect(steps.map((step) => step.names)).toEqual([["api", "queue"], ["worker"], ["retry", "dlq"]]);
  });

  it("shows only the first step's shapes and the arrow between them at step 1", () => {
    const view = stepView(shapes, steps, 0);
    expect([...view.visible].sort()).toEqual([id("api"), id("queue"), arrow("enqueue")].sort());
    expect([...view.highlighted].sort()).toEqual([id("api"), id("queue")].sort());
  });

  it("adds each step's shapes, and arrows once both ends show", () => {
    const second = stepView(shapes, steps, 1);
    expect([...second.visible].sort()).toEqual([id("api"), id("queue"), id("worker"), arrow("enqueue"), arrow("take job")].sort());
    expect([...second.highlighted]).toEqual([id("worker")]);
    const third = stepView(shapes, steps, 2);
    expect(third.visible.size).toBe(shapes.length);
    expect([...third.highlighted].sort()).toEqual([id("retry"), id("dlq")].sort());
    expect(third.visible.has(retryArrow)).toBe(true);
    expect(third.visible.has(arrow("after 2 retries"))).toBe(true);
  });

  it("shows shapes no step names from the start", () => {
    const { shapes: some, steps: two } = parseSketch('a: box "A"\nb: box "B"\nfree: box "Free"\nstep: a\n  One.\nstep: b\n  Two.');
    const first = stepView(some, two, 0);
    expect(first.visible.has(boxesByName(some).get("free")!.id)).toBe(true);
    expect(first.visible.has(boxesByName(some).get("b")!.id)).toBe(false);
  });

  it("shows the user's own unnamed shapes from the start", () => {
    const own: Shape = { kind: "rect", id: "mine", x: 5000, y: 5000, w: 100, h: 50, color: "white", label: "" };
    const { shapes: some, steps: two } = parseSketch('a: box "A"\nb: box "B"\nstep: a\n  One.\nstep: b\n  Two.', undefined, [own]);
    expect(stepView(some, two, 0).visible.has("mine")).toBe(true);
  });

  it("counts an arrow end that is on no shape as showing", () => {
    const { shapes: some, steps: two } = parseSketch('a: box "A"\nb: box "B"\n-500,-500 -> a\nb -> 9000,9000\nstep: a\n  One.\nstep: b\n  Two.');
    const first = stepView(some, two, 0);
    const [toA, fromB] = arrows(some);
    expect(first.visible.has(toA!.id)).toBe(true);
    expect(first.visible.has(fromB!.id)).toBe(false);
  });

  it("highlights a shape named again, which was already showing", () => {
    const { shapes: some, steps: two } = parseSketch('a: box "A"\nb: box "B"\nstep: a\n  One.\nstep: a b\n  Again.');
    const second = stepView(some, two, 1);
    expect([...second.highlighted].sort()).toEqual([boxesByName(some).get("a")!.id, boxesByName(some).get("b")!.id].sort());
  });

  // Steps may name a group (docs/format.md, Groups).
  it("naming a group shows and highlights its members", () => {
    const { shapes: some, steps: two, groups } = parseSketch('a: box "A"\nb: box "B"\nc: box "C"\ng: group "G" of a, b\nstep: g\n  One.\nstep: c\n  Two.');
    const by2 = boxesByName(some);
    const first = stepView(some, two, 0, groups);
    expect([...first.visible].sort()).toEqual([by2.get("a")!.id, by2.get("b")!.id].sort());
    expect([...first.highlighted].sort()).toEqual([by2.get("a")!.id, by2.get("b")!.id].sort());
    expect([...first.added].sort()).toEqual([by2.get("a")!.id, by2.get("b")!.id].sort());
    expect([...first.regions]).toEqual(["g"]);
    expect(stepView(some, two, 1, groups).visible.size).toBe(3);
  });

  it("lists a group's region only while a member is visible", () => {
    const { shapes: some, steps: two, groups } = parseSketch('a: box "A"\nb: box "B"\ng: group "G" of a\nstep: b\n  One.\nstep: a\n  Two.');
    expect(stepView(some, two, 0, groups).regions.size).toBe(0);
    expect([...stepView(some, two, 1, groups).regions]).toEqual(["g"]);
  });

  it("shows everything past the last step, and nothing is highlighted", () => {
    const view = stepView(shapes, steps, 99);
    expect(view.visible.size).toBe(shapes.length);
    expect(view.highlighted.size).toBe(0);
    expect(view.added.size).toBe(0);
  });

  // What a step brings in for the first time, which the board fades in
  // (docs/plan-elements.md, item 3).
  it("lists the current shapes that were not showing at the step before as added", () => {
    expect([...stepView(shapes, steps, 0).added].sort()).toEqual([id("api"), id("queue")].sort());
    expect([...stepView(shapes, steps, 1).added]).toEqual([id("worker")]);
    expect([...stepView(shapes, steps, 2).added].sort()).toEqual([id("retry"), id("dlq")].sort());
  });

  it("adds nothing for a shape pointed at again", () => {
    const { shapes: some, steps: two } = parseSketch('a: box "A"\nb: box "B"\nstep: a\n  One.\nstep: a b\n  Again.\nstep: b\n  Once more.');
    const by2 = boxesByName(some);
    expect([...stepView(some, two, 0).added]).toEqual([by2.get("a")!.id]);
    expect([...stepView(some, two, 1).added]).toEqual([by2.get("b")!.id]);
    expect(stepView(some, two, 2).added.size).toBe(0);
  });
});

// A step can be a hop of the flow: "step: #2" names the arrow numbered
// seq 2 (docs/format.md, Steps).
describe("a step that names a hop", () => {
  const SOURCE = `# sketch Hops
chat: box "Chat"
chrome: box "Chrome"
app: box "App"
manifest: note
  ## Manifest
chat -> chrome seq 1 "click link"
chrome -> app seq 2 "open window"
manifest -> app

step: chat chrome app
  The parts.
step: #1
  You click the link.
step: #2 manifest
  Chrome opens the window.`;

  it("parses, and keeps the hop through export", () => {
    const { shapes, steps, groups } = parseSketch(SOURCE);
    expect(steps.map((step) => step.names)).toEqual([["chat", "chrome", "app"], ["#1"], ["#2", "manifest"]]);
    const text = serializeSketch(shapes, "Hops", steps, groups).text;
    expect(text).toContain("step: #2 manifest");
    expect(parseSketch(text).steps).toEqual(steps);
  });

  it("is refused for a number no arrow has", () => {
    expect(() => parseSketch(SOURCE.replace("step: #2 manifest", "step: #3"))).toThrow(/Line 15: no arrow is numbered 3/);
  });

  it("brings in the shapes at both ends, which are the step's own, and names the hop", () => {
    const { shapes, steps, groups } = parseSketch(SOURCE.replace("step: chat chrome app\n  The parts.\n", ""));
    const id = (name: string) => shapes.find((shape) => shape.kind !== "arrow" && shape.name === name)!.id;
    const arrow = (seq: string) => shapes.find((shape) => shape.kind === "arrow" && shape.seq === seq)!.id;
    const first = stepView(shapes, steps, 0, groups);
    expect([...first.highlighted].sort()).toEqual([id("chat"), id("chrome")].sort());
    expect(first.visible.has(id("app"))).toBe(false);
    expect([...first.hops]).toEqual([arrow("1")]);
    const second = stepView(shapes, steps, 1, groups);
    expect([...second.highlighted].sort()).toEqual([id("chrome"), id("app"), id("manifest")].sort());
    expect([...second.added].sort()).toEqual([id("app"), id("manifest")].sort());
    expect([...second.hops]).toEqual([arrow("2")]);
  });

  it("drops on export when its arrow is no longer numbered", () => {
    const { shapes, steps, groups } = parseSketch(SOURCE);
    const unnumbered = shapes.map((shape) => (shape.kind === "arrow" && shape.seq === "1" ? { ...shape, seq: undefined } : shape));
    expect(serializeSketch(unnumbered, "Hops", steps, groups).text).toContain("step:\n  You click the link.");
  });
});
