// An arrow's number, `seq N` (docs/format.md, Arrows): its own token, not
// part of the label, so the board can draw it as a badge.
import { describe, expect, it } from "vitest";
import { parseSketch, serializeSketch, type ArrowShape, type RectShape } from "../src/index";
import { arrowLine } from "./helpers";

const boxes = 'a: box "A"\nb: box "B"\nc: box "C"\n';
const arrowsOf = (text: string) => parseSketch(text).shapes.filter((shape): shape is ArrowShape => shape.kind === "arrow");

describe("seq", () => {
  it("reads a number, before or after the label", () => {
    const [first, second] = arrowsOf(`${boxes}a -> b seq 1 "enqueue"\nb -> c "take job" blue seq 2`);
    expect(first).toMatchObject({ seq: "1", label: "enqueue" });
    expect(second).toMatchObject({ seq: "2", label: "take job", color: "blue" });
  });

  it("reads a branch letter, and a number on an arrow with no label", () => {
    const [first, second, third] = arrowsOf(`${boxes}a -> b seq 2a "write"\na -> c seq 2b\nb -> c seq 12`);
    expect(first).toMatchObject({ seq: "2a" });
    expect(second!.seq).toBe("2b");
    expect(second!.label).toBeUndefined();
    expect(third!.seq).toBe("12");
  });

  it("leaves a label that starts with a digit as it is", () => {
    const [arrow] = arrowsOf(`${boxes}a -> b "1 enqueue"`);
    expect(arrow!.label).toBe("1 enqueue");
    expect(arrow!.seq).toBeUndefined();
  });

  it("writes the number before the label, and reads it back", () => {
    const text = serializeSketch(parseSketch(`${boxes}a -> b "enqueue" red seq 3b`).shapes, "T").text;
    expect(arrowLine(text, "a", "b")).toMatch(/^a -> b seq 3b "enqueue" red( bend -?\d+)?$/);
    const again = serializeSketch(parseSketch(text).shapes, "T").text;
    expect(again).toBe(text);
  });

  it("gives a numbered arrow room for its badge", () => {
    const plain = parseSketch(`${boxes}a -> b "take every due entry now"`).shapes.find((shape): shape is RectShape => shape.kind === "rect" && shape.name === "b")!;
    const numbered = parseSketch(`${boxes}a -> b seq 1 "take every due entry now"`).shapes.find((shape): shape is RectShape => shape.kind === "rect" && shape.name === "b")!;
    expect(numbered.x).toBeGreaterThan(plain.x);
  });

  it("takes the text's number on an update, and drops it when the text has none", () => {
    const opened = parseSketch(`${boxes}a -> b seq 1 "go"`);
    const updated = parseSketch(`${boxes}a -> b seq 2 "go"`, undefined, opened.shapes).shapes.find((shape): shape is ArrowShape => shape.kind === "arrow")!;
    expect(updated.seq).toBe("2");
    const dropped = parseSketch(`${boxes}a -> b "go"`, undefined, opened.shapes).shapes.find((shape): shape is ArrowShape => shape.kind === "arrow")!;
    expect(dropped.seq).toBeUndefined();
  });
});
