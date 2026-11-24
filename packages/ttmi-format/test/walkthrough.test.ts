// A walkthrough as an overview, the numbered arrows in order, and a
// summary (docs/format.md, Walkthrough): the drawing is shown in full and
// the camera does the focusing.
import { describe, expect, it } from "vitest";
import { parseSketch, serializeSketch, stepView, type Shape } from "../src/index";

const SOURCE = `# sketch Opening a sketch
direction: right

overview:
  Let's meet the parts. Your agent works in [the chat](chat).

chat: box "Chat"
chrome: box "Chrome"
app: box "App"
hosting: box "Hosting"
cache: box "Voice model"
capture: note
  ## Navigation capturing
manifest: note
  ## Manifest

chat -> chrome seq 1 "click link"
  It starts when you click a sketch link.
chrome -> app seq 2 "open window"
  Chrome hands it to the app window.
app -> hosting seq 3a "GET page"
  The window asks Hosting for the page,
app -> cache seq 3b "read model"
  and reads the voice model at the same time.
cache -> hosting seq 4 "never"
capture -> chrome
manifest -> app
chat -> app "aside"

summary:
  Nothing downloads twice: [the manifest](manifest) says why.`;

const named = (shapes: Shape[], name: string) => shapes.find((shape) => shape.kind !== "arrow" && shape.name === name)!.id;
const numbered = (shapes: Shape[], seq: string) => shapes.find((shape) => shape.kind === "arrow" && shape.seq === seq)!.id;

describe("a walkthrough of overview, hops and summary", () => {
  const { shapes, steps, groups } = parseSketch(SOURCE);

  it("is the overview, every numbered arrow in order (branches together), then the summary", () => {
    expect(steps).toEqual([
      { kind: "overview", names: [], narration: "Let's meet the parts. Your agent works in [the chat](chat)." },
      { kind: "hop", names: ["#1"], narration: "It starts when you click a sketch link." },
      { kind: "hop", names: ["#2"], narration: "Chrome hands it to the app window." },
      { kind: "hop", names: ["#3a", "#3b"], narration: "The window asks Hosting for the page, and reads the voice model at the same time." },
      { kind: "hop", names: ["#4"], narration: "" },
      { kind: "summary", names: [], narration: "Nothing downloads twice: [the manifest](manifest) says why." },
    ]);
  });

  it("keeps each hop's narration on its arrow", () => {
    const arrow = shapes.find((shape) => shape.kind === "arrow" && shape.seq === "3b");
    expect(arrow).toMatchObject({ narration: "and reads the voice model at the same time." });
  });

  it("shows the whole drawing at every stop, and adds nothing", () => {
    const everything = shapes.map((shape) => shape.id).sort();
    for (let index = 0; index < steps.length; index++) {
      const view = stepView(shapes, steps, index, groups);
      expect([...view.visible].sort()).toEqual(everything);
      expect(view.added.size).toBe(0);
    }
  });

  it("makes a hop's two ends its current shapes, no notes, and the overview none", () => {
    expect(stepView(shapes, steps, 0, groups).highlighted.size).toBe(0);
    const first = stepView(shapes, steps, 1, groups);
    expect([...first.highlighted].sort()).toEqual([named(shapes, "chat"), named(shapes, "chrome")].sort());
    expect([...first.hops]).toEqual([numbered(shapes, "1")]);
    const branches = stepView(shapes, steps, 3, groups);
    expect([...branches.hops].sort()).toEqual([numbered(shapes, "3a"), numbered(shapes, "3b")].sort());
    expect(stepView(shapes, steps, 5, groups).highlighted.size).toBe(0);
  });

  it("round-trips through export as written", () => {
    const text = serializeSketch(shapes, "Opening a sketch", steps, groups).text;
    expect(text).toMatch(/^overview:\n  Let's meet the parts/m);
    expect(text).toContain('chat -> chrome seq 1 "click link"\n  It starts when you click a sketch link.');
    expect(text).toContain('cache -> hosting seq 4 "never"\n');
    expect(text).toMatch(/summary:\n  Nothing downloads twice/);
    expect(text).not.toContain("step:");
    const again = parseSketch(text);
    expect(again.steps).toEqual(steps);
    expect(serializeSketch(again.shapes, "Opening a sketch", again.steps, again.groups).text).toBe(text);
  });

  it("is refused next to steps, and narration needs a numbered arrow", () => {
    expect(() => parseSketch(`${SOURCE}\nstep: chat\n  Hi.`)).toThrow(/either steps or an overview/);
    expect(() => parseSketch(SOURCE.replace('chat -> app "aside"', 'chat -> app "aside"\n  Said about nothing.'))).toThrow(/narration under an arrow needs its number/);
  });

  it("starts on a silent overview when the sketch has no overview, and exports none", () => {
    const silent = parseSketch(`# sketch Silent\na: box "A"\nb: box "B"\na -> b seq 1 "go"\n  Off it goes.\nsummary:\n  Done.`);
    expect(silent.steps.map((step) => [step.kind, step.narration])).toEqual([["overview", ""], ["hop", "Off it goes."], ["summary", "Done."]]);
    const text = serializeSketch(silent.shapes, "Silent", silent.steps, silent.groups).text;
    expect(text).not.toContain("overview:");
    expect(parseSketch(text).steps).toEqual(silent.steps);
  });

  it("leaves a sketch without overview, summary or arrow narration as it was", () => {
    const plain = parseSketch(`# sketch Plain\na: box "A"\nb: box "B"\na -> b seq 1 "go"`);
    expect(plain.steps).toEqual([]);
  });
});
