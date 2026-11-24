// Writing the board out (docs/format.md, Export).
import { describe, expect, it } from "vitest";
import { parseSketch, serializeSketch, sketchBlock, type Shape, type SketchGroup } from "../src/index";
import { boxesByName } from "./helpers";

const rect = (id: string, x: number, y: number, extra: Partial<Shape> = {}): Shape => ({ kind: "rect", id, x, y, w: 140, h: 70, color: "white", label: id, ...extra } as Shape);

describe("serializeSketch", () => {
  it("starts with the marker, title and direction", () => {
    expect(serializeSketch([], "Job retries").text).toBe("# sketch Job retries\ndirection: right");
    expect(serializeSketch([]).text).toBe("# sketch\ndirection: right");
  });

  it("writes boxes with at and size, and only non-default attributes", () => {
    const shapes: Shape[] = [
      { kind: "rect", id: "1", name: "a", x: 10.4, y: 20.6, w: 140, h: 70, color: "white", label: "A" },
      { kind: "rect", id: "2", name: "b", x: 0, y: 0, w: 200, h: 80, color: "blue", label: 'Say "hi"\nnow', tag: "Service" },
    ];
    expect(serializeSketch(shapes).text.split("\n").slice(2)).toEqual([
      'a: box "A" at 10,21 size 140,70',
      'b: box "Say \\"hi\\"\\nnow" blue tag "Service" at 0,0 size 200,80',
    ]);
  });

  it("writes notes with at and width, their markdown indented, blank lines empty", () => {
    const shapes: Shape[] = [
      { kind: "note", id: "1", name: "n", x: 5, y: 6, w: 460, h: 100, color: "violet", size: 18, tag: "Data model", html: '<h2>Job</h2><pre><code class="language-ts">type Job = {\n  id: string;\n};\n</code></pre><p>Some <strong>bold</strong> and <em>em</em> and <code>code</code>.</p><ul><li>one</li><li>two</li></ul>' },
    ];
    expect(serializeSketch(shapes).text.split("\n").slice(2)).toEqual([
      // A note's tag, from a board saved before notes lost it, is not written.
      'n: note violet text 18 at 5,6 width 460',
      "  ## Job",
      "",
      "  ```ts",
      "  type Job = {",
      "    id: string;",
      "  };",
      "  ```",
      "",
      "  Some **bold** and *em* and `code`.",
      "",
      // Turndown pads a bullet to a four-wide marker.
      "  -   one",
      "  -   two",
    ]);
  });

  it("leaves out text 14, and writes an empty body as one empty line", () => {
    const shapes: Shape[] = [{ kind: "note", id: "1", name: "n", x: 0, y: 0, w: 340, h: 30, color: "white", size: 14, html: "" }];
    expect(serializeSketch(shapes).text.split("\n").slice(2)).toEqual(["n: note at 0,0 width 340", ""]);
  });

  it("writes groups after the shapes and before the arrows, dropping one whose members are gone, and keeps steps that name them", () => {
    const shapes: Shape[] = [rect("1", 0, 0, { name: "a" } as Partial<Shape>), rect("2", 300, 0, { name: "b" } as Partial<Shape>), { kind: "arrow", id: "3", from: { x: 140, y: 35 }, to: { x: 300, y: 35 }, color: "white" }];
    const groups: SketchGroup[] = [{ name: "g", label: "Group", color: "blue", tag: "Domain", members: ["a", "b"] }, { name: "gone", label: "Gone", color: "white", members: ["zzz"] }];
    expect(serializeSketch(shapes, "T", [{ names: ["g", "gone"], narration: "Hi." }], groups).text.split("\n").slice(2)).toEqual([
      'a: box "1" at 0,0 size 140,70',
      'b: box "2" at 300,0 size 140,70',
      'g: group "Group" blue tag "Domain" of a, b',
      "a -> b",
      "",
      "step: g",
      "  Hi.",
    ]);
  });

  it("round-trips groups", () => {
    const source = 'a: box "A"\nb: box "B"\ng: group "G" green of a, b\na -> b';
    const first = parseSketch(source);
    const text = serializeSketch(first.shapes, "T", first.steps, first.groups).text;
    expect(text).toContain('g: group "G" green of a, b');
    const again = parseSketch(text, undefined, first.shapes);
    expect(again.groups).toEqual(first.groups);
    expect(serializeSketch(again.shapes, "T", again.steps, again.groups).text).toBe(text);
  });

  it("names unnamed shapes box1, note1, … in order, and returns every name by id", () => {
    // Names are handed out in shape order: the unnamed box takes box1 before
    // the later shape already called box1 is seen, which is then renamed.
    const shapes: Shape[] = [rect("x", 0, 0), { kind: "note", id: "y", x: 0, y: 0, w: 340, h: 30, color: "white", html: "<p>hi</p>" }, rect("z", 0, 0, { name: "box1" } as Partial<Shape>)];
    const { text, names } = serializeSketch(shapes);
    expect(names).toEqual(new Map([["x", "box1"], ["y", "note1"], ["z", "box2"]]));
    expect(text.split("\n").filter((line) => /^[\w-]+: (box|note)\b/.test(line)).map((line) => line.split(":")[0])).toEqual(["box1", "note1", "box2"]);
  });

  it("renames a shape whose name is taken or not a name", () => {
    const shapes: Shape[] = [rect("x", 0, 0, { name: "a" } as Partial<Shape>), rect("y", 0, 0, { name: "a" } as Partial<Shape>), rect("z", 0, 0, { name: "not a name" } as Partial<Shape>)];
    expect([...serializeSketch(shapes).names.values()]).toEqual(["a", "box1", "box2"]);
  });

  it("writes an arrow end within 24 px of a box as that box's name", () => {
    const shapes: Shape[] = [
      rect("1", 0, 0, { name: "a" } as Partial<Shape>),
      rect("2", 400, 0, { name: "b" } as Partial<Shape>),
      { kind: "arrow", id: "3", from: { x: 150, y: 35 }, to: { x: 380, y: 35 }, color: "white", label: "go" },
    ];
    expect(serializeSketch(shapes).text.split("\n").at(-1)).toBe('a -> b "go"');
  });

  it("writes both ends as points when they are on the same box or off every box", () => {
    const shapes: Shape[] = [
      rect("1", 0, 0, { name: "a" } as Partial<Shape>),
      { kind: "arrow", id: "2", from: { x: 10, y: 10 }, to: { x: 100, y: 60 }, color: "white" },
      { kind: "arrow", id: "3", from: { x: 150.4, y: 35 }, to: { x: 900, y: 900 }, color: "red", bend: 12.6 },
    ];
    expect(serializeSketch(shapes).text.split("\n").slice(-2)).toEqual(["10,10 -> 100,60", "150,35 -> 900,900 red bend 13"]);
  });

  it("writes bend only when non-zero", () => {
    const shapes: Shape[] = [
      { kind: "arrow", id: "1", from: { x: 0, y: 0 }, to: { x: 10, y: 0 }, color: "white", bend: 0 },
      { kind: "arrow", id: "2", from: { x: 0, y: 0 }, to: { x: 10, y: 0 }, color: "white", bend: -5 },
    ];
    expect(serializeSketch(shapes).text.split("\n").slice(-2)).toEqual(["0,0 -> 10,0", "0,0 -> 10,0 bend -5"]);
  });

  it("writes steps last, narration on one indented line, dropping names of shapes that are gone", () => {
    const shapes: Shape[] = [rect("1", 0, 0, { name: "a" } as Partial<Shape>)];
    const text = serializeSketch(shapes, "T", [{ names: ["a", "gone"], narration: "First." }, { names: ["gone"], narration: "" }]).text;
    expect(text.split("\n").slice(2)).toEqual(['a: box "1" at 0,0 size 140,70', "", "step: a", "  First.", "", "step:"]);
  });

  it("reads its own output back", () => {
    const shapes: Shape[] = [
      rect("1", 0, 0, { name: "a", tag: "Store", color: "green" } as Partial<Shape>),
      { kind: "note", id: "2", name: "n", x: 0, y: 200, w: 340, h: 30, color: "white", html: "<p>A <em>note</em></p>" },
      { kind: "arrow", id: "3", from: { x: 70, y: 76 }, to: { x: 70, y: 194 }, color: "white", label: "x", bend: 30 },
    ];
    const text = serializeSketch(shapes, "T").text;
    const { shapes: back } = parseSketch(text);
    const by = boxesByName(back);
    expect(by.get("a")).toMatchObject({ x: 0, y: 0, w: 140, h: 70, tag: "Store", color: "green" });
    expect(by.get("n")).toMatchObject({ x: 0, y: 200, w: 340, html: "<p>A <em>note</em></p>" });
    expect(back.find((shape) => shape.kind === "arrow")).toMatchObject({ label: "x", bend: 30 });
  });
});

describe("sketchBlock", () => {
  it("wraps the text in a four-backtick sketch fence", () => {
    expect(sketchBlock("# sketch T\na: box \"A\"")).toBe("````sketch\n# sketch T\na: box \"A\"\n````");
  });
});
