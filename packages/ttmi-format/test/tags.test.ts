// A tag is part of the shape's outline for arrows (docs/format.md, Arrows):
// an end that would land under the tag pill stops at the pill instead, so
// the arrow is never hidden beneath it.
import { describe, expect, it } from "vitest";
import { parseSketch, type SketchMeasure } from "../src/index";
import { arrows, boxesByName } from "./helpers";

describe("arrow ends and tags", () => {
  // Boxes 140 × 70; a note with more than one block folds to 300 × 30; a
  // tag pill is 160 × 19, on the shape's top edge 10 px in from its left,
  // centred on the edge (10 px above it).
  const measure: SketchMeasure = {
    box: () => ({ w: 140, h: 70 }),
    note: () => 40,
    noteWidth: () => 0,
    noteFolded: (html) => ((html.match(/<(h\d|p|pre|ul|ol|blockquote)[\s>]/g) ?? []).length > 1 ? { w: 300, h: 30 } : undefined),
    tag: () => ({ w: 160, h: 19 }),
  };
  const NOTE = (tag: string) => `n: note${tag}\n  ## Predeploy\n  \`\`\`sh\n  pnpm build\n  \`\`\`\n`;

  it("drops a note's tag, so its connector leaves the note's own edge", () => {
    // A note has no tag (docs/format.md, Notes); old text still reads.
    const { shapes } = parseSketch(`a: box "A"\n${NOTE(' tag "firebase.json"')}n -> a`, measure);
    expect(boxesByName(shapes).get("n")!.tag).toBeUndefined();
    expect(arrows(shapes)[0]!.from).toEqual({ x: 175, y: 168 });
  });

  it("leaves an end alone when it is not under the pill", () => {
    const without = arrows(parseSketch(`a: box "A"\n${NOTE("")}n -> a`, measure).shapes)[0]!;
    expect(without.from).toEqual({ x: 175, y: 168 });
    // A narrow pill (40 px, 50 to 90) is clear of the end at x 175.
    const narrow = arrows(parseSketch(`a: box "A"\n${NOTE(' tag "sh"')}n -> a`, { ...measure, tag: () => ({ w: 40, h: 19 }) }).shapes)[0]!;
    expect(narrow.from).toEqual({ x: 175, y: 168 });
  });

  it("stops an arrow's end on a box's tag the same way", () => {
    // b is the top box of its column, so its note goes above the band and
    // points straight down at it: the line would land on b's top edge
    // under a wide pill.
    const text = 'a: box "A"\nb: box "B" tag "Service and more"\nc: box "C"\nn: note\n  ## N\n  more\na -> b\na -> c\nn -> b';
    const { shapes } = parseSketch(text, { ...measure, tag: () => ({ w: 130, h: 19 }), noteFolded: () => ({ w: 140, h: 30 }) });
    const by = boxesByName(shapes);
    const b = by.get("b")!;
    const note = by.get("n")!;
    expect(note.y + note.h).toBeLessThan(b.y);
    const down = arrows(shapes).find((arrow) => arrow.from.y < b.y && Math.abs(arrow.from.x - (note.x + note.w / 2)) < 40)!;
    // The pill spans b.x + 10 to b.x + 140, its top 9.5 px above b's: the
    // end lands 6 px above the pill, not on b's edge beneath it.
    expect(down.to.y).toBeLessThanOrEqual(b.y - 15);
    expect(down.to.x).toBeGreaterThan(b.x + 10);
    expect(down.to.x).toBeLessThan(b.x + 140);
  });

  it("estimates a box's pill without a measurer, from the tag's length", () => {
    const text = 'a: box "A"\nb: box "B" tag "Predeploy from firebase.json"\nc: box "C"\nn: note\n  ## N\n  more\na -> b\na -> c\nn -> b';
    const { shapes } = parseSketch(text, { ...measure, tag: undefined, noteFolded: () => ({ w: 140, h: 30 }) });
    const b = boxesByName(shapes).get("b")!;
    const down = arrows(shapes).find((arrow) => arrow.to.y < b.y + 1 && arrow.to.y > b.y - 40 && arrow.from.y < b.y)!;
    expect(down.to.y).toBeLessThan(b.y - 6);
  });
});
