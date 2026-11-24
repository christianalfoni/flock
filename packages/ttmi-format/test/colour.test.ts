// Colour is a state, shown on a shape's tag and an arrow's badge; boxes
// have no fill (docs/format.md, Colour). A new save is strict; text saved
// before still reads.
import { describe, expect, it } from "vitest";
import { parseSketch, serializeSketch, startBoxes } from "../src";

const strict = (source: string) => () => parseSketch(source, undefined, [], { strict: true });

describe("colour and fill (docs/format.md, Colour)", () => {
  it("reads the old fill words and drops them on export", () => {
    const { shapes } = parseSketch('a: box "A" red solid tag "Hot"\nb: box "B" tint');
    const text = serializeSketch(shapes).text;
    expect(text).toContain('a: box "A" red tag "Hot" at');
    expect(text).toContain('b: box "B" at');
    expect(text).not.toMatch(/solid|tint/);
  });

  it("keeps an untagged colour in old text, and exports it", () => {
    const { shapes } = parseSketch('a: box "A" red');
    expect(serializeSketch(shapes).text).toContain('a: box "A" red at');
  });

  it("refuses a fill word on a new save", () => {
    expect(strict('a: box "A" solid')).toThrow(/^Line 1: "solid" is gone/);
    expect(strict('a: box "A"\nb: box "B" tint tag "X"')).toThrow(/^Line 2: "tint" is gone/);
  });

  it("refuses a colour without a tag on a box or group, and a tag on a note", () => {
    expect(strict('a: box "A" red')).toThrow(/^Line 1: a colour shows on the box's tag/);
    expect(strict('n: note tag "Data"\n  hi')).toThrow(/^Line 1: a note has no tag/);
    // A note's colour shows on its own pill.
    expect(strict("n: note green\n  ## N\n  hi")).not.toThrow();
    expect(strict('a: box "A"\ng: group "G" blue of a')).toThrow(/^Line 2: a colour shows on the group's tag/);
  });

  it("takes a colour with a tag, and a coloured arrow without one", () => {
    expect(strict('a: box "A" red tag "Lookup"\nb: box "B"\ng: group "G" blue tag "Store" of b\na -> b seq 1 "go" green\nb -> a "back" red')).not.toThrow();
  });

  it("finds the box the numbered flow starts from", () => {
    const { shapes } = parseSketch('a: box "A"\nb: box "B"\nc: box "C"\nb -> c seq 2 "then"\na -> b seq 1 "first"');
    const named = (id: string) => shapes.find((shape) => shape.id === id)!.kind === "rect" && (shapes.find((shape) => shape.id === id) as { name?: string }).name;
    expect([...startBoxes(shapes)].map(named)).toEqual(["a"]);
    expect(startBoxes(parseSketch('a: box "A"\nb: box "B"\na -> b "go"').shapes).size).toBe(0);
  });
});
