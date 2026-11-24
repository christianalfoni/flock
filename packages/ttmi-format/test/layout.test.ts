// Automatic layout (docs/format.md, Layout): layered for a new drawing,
// beside neighbours for an update, below the user's own shapes.
import { describe, expect, it } from "vitest";
import { groupRegion, isBoxShape, parseSketch, regionMembers, type Shape, type SketchGroup, type SketchMeasure } from "../src/index";
import { boxesByName, example, fixture } from "./helpers";

describe("a new drawing: layered layout", () => {
  // The guide's main example with estimated sizes: boxes 140×70, the two
  // notes 460 wide, both 146 high.
  const { shapes } = parseSketch(example("job-retries.sketch"));
  const at = boxesByName(shapes);

  it("puts each layer along the arrows in its own column, 220 px past the box before it", () => {
    // The columns hold the boxes only, 140 each: four of them fit one
    // screen, so the gap stays 220. The notes hang outside the band.
    expect(at.get("api")!.x).toBe(40);
    expect(at.get("queue")!.x).toBe(40 + 140 + 220);
    expect(at.get("worker")!.x).toBe(400 + 140 + 220);
    expect(at.get("dlq")!.x).toBe(760 + 140 + 220);
  });

  it("lays a note that only points at a shape out below the band of boxes, aligned with that shape", () => {
    // The band is the boxes' strip, 40 to 110; the first note sits 64 px
    // under it. The 460 px estimated notes under columns 360 px apart would
    // overlap, so the worker's note goes above the band instead.
    expect(at.get("job")!.x).toBe(at.get("queue")!.x);
    expect(at.get("job")!.y).toBe(40 + 70 + 64);
    expect(at.get("retry")!.x).toBe(at.get("worker")!.x);
    expect(at.get("retry")!.y).toBe(40 - 64 - 146);
  });

  it("keeps the band to the boxes, each column centred against the tallest", () => {
    for (const name of ["api", "queue", "worker", "dlq"]) expect(at.get(name)!.y).toBe(40);
    // Two boxes in one column make the band 70 + 64 + 70; a lone box centres on it.
    const { shapes: two } = parseSketch('a: box "A"\nb: box "B"\nc: box "C"\na -> b\na -> c');
    const by = boxesByName(two);
    expect(by.get("a")!.y).toBe(40 + (204 - 70) / 2);
    expect([by.get("b")!.y, by.get("c")!.y].sort((p, q) => p - q)).toEqual([40, 40 + 70 + 64]);
  });

  it("alternates describing notes below and above their shape, outside the band", () => {
    const { shapes: three } = parseSketch('a: box "A"\nn1: note\n  one\nn2: note\n  two\nn3: note\n  three\nn1 -> a\nn2 -> a\nn3 -> a');
    const by = boxesByName(three);
    const column = [...by.values()].sort((p, q) => p.y - q.y).map((shape) => shape.name);
    expect(column).toEqual(["n2", "a", "n1", "n3"]);
    expect(new Set([...by.values()].map((shape) => shape.x)).size).toBe(1);
    // Estimated notes are 38 high: the first 64 px under the band, the
    // second 64 px above it, the third in the next row under the first.
    expect(by.get("n1")!.y).toBe(40 + 70 + 64);
    expect(by.get("n2")!.y).toBe(40 - 64 - 38);
    expect(by.get("n3")!.y).toBe(174 + 38 + 64);
  });

  it("puts a note on the nearer side of the band: above for a box at the top of its column, below at the bottom", () => {
    const { shapes } = parseSketch('a: box "A"\nb: box "B"\nc: box "C"\nnb: note\n  top\nnc: note\n  bottom\na -> b\na -> c\nnb -> b\nnc -> c');
    const by = boxesByName(shapes);
    const sorted = [by.get("b")!, by.get("c")!].sort((p, q) => p.y - q.y);
    const top = sorted[0]!;
    const bottom = sorted[1]!;
    const noteOf = (box: { name?: string }) => (box.name === "b" ? by.get("nb")! : by.get("nc")!);
    expect(top.y).toBe(40);
    expect(noteOf(top)).toMatchObject({ x: top.x, y: 40 - 64 - 38 });
    expect(noteOf(bottom)).toMatchObject({ x: bottom.x, y: 40 + 204 + 64 });
  });

  it("moves a note that would overlap a neighbour's note to the other side, then to the next row", () => {
    // Two 420 px notes under boxes 360 px apart would overlap, so the
    // second goes above; a third, blocked on both sides, takes the row with
    // the smaller move.
    const { shapes } = parseSketch('a: box "A"\nb: box "B"\nna: note\n  one\nnb: note\n  two\nnb2: note\n  three\na -> b\nna -> a\nnb -> b\nnb2 -> b');
    const by = boxesByName(shapes);
    expect(by.get("na")).toMatchObject({ x: 40, y: 174 });
    expect(by.get("nb")).toMatchObject({ x: 400, y: 40 - 64 - 38 });
    expect(by.get("nb2")!.x).toBe(400);
    expect(by.get("nb2")!.y === 174 + 38 + 64 || by.get("nb2")!.y === -62 - 38 - 64).toBe(true);
    for (const [p, q] of [["na", "nb"], ["na", "nb2"], ["nb", "nb2"]] as const) {
      const s = by.get(p)!;
      const o = by.get(q)!;
      expect(s.x + s.w <= o.x || o.x + o.w <= s.x || s.y + s.h <= o.y || o.y + o.h <= s.y, `${p} clear of ${q}`).toBe(true);
    }
  });

  it("pulls a shape as late as its arrows allow", () => {
    // a feeds c directly and through b: a sits just before b, not two columns early.
    const { shapes: pulled } = parseSketch('a: box "A"\nb: box "B"\nc: box "C"\na -> b\nb -> c\nd: box "D"\nd -> c');
    const by = boxesByName(pulled);
    expect(by.get("d")!.x).toBe(by.get("b")!.x);
  });

  it("orders a layer by its neighbours to reduce crossings", () => {
    const { shapes: crossed } = parseSketch('a: box "A"\nb: box "B"\nc: box "C"\nd: box "D"\na -> d\nb -> c');
    const by = boxesByName(crossed);
    expect(by.get("a")!.y < by.get("b")!.y).toBe(by.get("d")!.y < by.get("c")!.y);
  });

  it("puts a shape without arrows in the first column", () => {
    const { shapes: lone } = parseSketch('a: box "A"\nb: box "B"\nlone: box "Lone"\na -> b');
    const by = boxesByName(lone);
    expect(by.get("lone")!.x).toBe(40);
    expect(by.get("a")!.x).toBe(40);
  });

  it("ends on cycles", () => {
    const { shapes: cycle } = parseSketch('a: box "A"\nb: box "B"\nc: box "C"\na -> b\nb -> c\nc -> a');
    expect(boxesByName(cycle).size).toBe(3);
  });

  it("lays out in rows with direction: down", () => {
    const { shapes: down } = parseSketch('direction: down\na: box "A"\nb: box "B"\nn: note\n  hi\na -> b\nn -> a');
    const by = boxesByName(down);
    expect(by.get("a")!.y).toBe(40);
    expect(by.get("b")!.y).toBe(40 + 70 + 220);
    expect(by.get("n")!.y).toBe(by.get("a")!.y);
    expect(by.get("n")!.x).toBe(by.get("a")!.x + 140 + 64);
  });

  it("starts 120 px below the user's own unnamed shapes", () => {
    const own: Shape[] = [{ kind: "rect", id: "mine", x: 300, y: 100, w: 200, h: 50, color: "white", label: "mine" }];
    const { shapes: below } = parseSketch('a: box "A"\nb: box "B"\na -> b', undefined, own);
    const by = boxesByName(below);
    expect(by.get("a")!.y).toBe(100 + 50 + 120);
    expect(by.get("a")!.x).toBe(300);
    expect(by.get("b")!.x).toBe(300 + 140 + 220);
    expect(below.find((shape) => shape.id === "mine")).toEqual(own[0]);
  });
});

describe("the gap between columns (docs/format.md, Layout)", () => {
  it("is 220 px while the drawing fits 1360 px, and closes up evenly past that", () => {
    const two = boxesByName(parseSketch('a: box "A"\nb: box "B"\na -> b').shapes);
    expect(two.get("b")!.x - two.get("a")!.x).toBe(140 + 220);
    // Five 140 px columns are 700: the 620 px of room over four gaps is 155.
    const five = boxesByName(parseSketch('a: box "A"\nb: box "B"\nc: box "C"\nd: box "D"\ne: box "E"\na -> b\nb -> c\nc -> d\nd -> e').shapes);
    expect(five.get("b")!.x - five.get("a")!.x).toBe(140 + 155);
    expect(five.get("e")!.x + 140).toBe(1360);
  });

  it("never closes under 56 px", () => {
    // Ten 140 px columns are more than fits: the gap is the floor.
    const names = "abcdefghij".split("");
    const text = `${names.map((name) => `${name}: box "${name.toUpperCase()}"`).join("\n")}\n${names.slice(1).map((name, index) => `${names[index]} -> ${name}`).join("\n")}`;
    const by = boxesByName(parseSketch(text).shapes);
    expect(by.get("b")!.x - by.get("a")!.x).toBe(140 + 56);
    expect(by.get("j")!.x).toBe(40 + 9 * (140 + 56));
  });

  it("fits rows into 820 px with direction: down", () => {
    const text = `direction: down\n${"abcdefgh".split("").map((name) => `${name}: box "${name.toUpperCase()}"`).join("\n")}\n${"bcdefgh".split("").map((name, index) => `${"abcdefgh"[index]} -> ${name}`).join("\n")}`;
    const by = boxesByName(parseSketch(text).shapes);
    // Eight 70 px rows are 560 of 780: 220 px of room over seven gaps is 31, under the floor.
    expect(by.get("b")!.y - by.get("a")!.y).toBe(70 + 56);
  });
});

describe("groups (docs/format.md, Groups)", () => {
  type Rect = { x: number; y: number; w: number; h: number };
  // Each group's region as the board draws it, around the member boxes.
  const regionsOf = (shapes: Shape[], groups: SketchGroup[]) => new Map(groups.map((group) => [group.name, groupRegion(regionMembers(group, shapes.filter(isBoxShape)))]));
  const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  const inside = (a: Rect, b: Rect) => a.x >= b.x && a.y >= b.y && a.x + a.w <= b.x + b.w && a.y + a.h <= b.y + b.h;
  // The clear space between two rectangles that do not overlap.
  const apart = (a: Rect, b: Rect) => Math.max(b.x - (a.x + a.w), a.x - (b.x + b.w), b.y - (a.y + a.h), a.y - (b.y + b.h));
  // a feeds b and c, which feed d; a and d are one group, with b and c in
  // the layer between them. Boxes 140 × 70.
  const SPAN = 'a: box "A"\nb: box "B"\nc: box "C"\nd: box "D"\na -> b\na -> c\nb -> d\nc -> d\ng: group "G" of a, d';

  it("keeps the members of a group in one layer adjacent", () => {
    // b, c, d and e all follow a, in that order; the group pulls e up next to b.
    const { shapes } = parseSketch('a: box "A"\nb: box "B"\nc: box "C"\nd: box "D"\ne: box "E"\na -> b\na -> c\na -> d\na -> e\ng: group "G" of b, e');
    const by = boxesByName(shapes);
    const column = ["b", "c", "d", "e"].sort((p, q) => by.get(p)!.y - by.get(q)!.y);
    expect(column).toEqual(["b", "e", "c", "d"]);
    expect(by.get("e")!.y).toBe(by.get("b")!.y + 70 + 64);
  });

  it("makes a group that spans layers one lane: one rectangle holding its members, with the layer between's shapes outside it", () => {
    const { shapes, groups } = parseSketch(SPAN);
    const by = boxesByName(shapes);
    const region = regionsOf(shapes, groups).get("g")!;
    // The slot starts at the same offset in every layer: a and d line up.
    expect(by.get("d")!.y).toBe(by.get("a")!.y);
    for (const name of ["a", "d"]) expect(inside(by.get(name)!, region)).toBe(true);
    // b and c are not members: outside the region, 64 px from it like any
    // two shapes, above or below (the lane may run between them).
    for (const name of ["b", "c"]) {
      expect(overlaps(by.get(name)!, region)).toBe(false);
      expect(apart(by.get(name)!, region)).toBe(64);
    }
  });

  it("keeps two regions apart, 64 px like shapes, and neither holds the other's members", () => {
    const { shapes, groups } = parseSketch(`${SPAN}\nh: group "H" of b`);
    const regions = regionsOf(shapes, groups);
    expect(overlaps(regions.get("g")!, regions.get("h")!)).toBe(false);
    expect(apart(regions.get("g")!, regions.get("h")!)).toBe(64);
    const by = boxesByName(shapes);
    expect(inside(by.get("b")!, regions.get("h")!)).toBe(true);
    for (const name of ["a", "d"]) expect(overlaps(by.get(name)!, regions.get("h")!)).toBe(false);
    for (const group of ["g", "h"]) expect(overlaps(by.get("c")!, regions.get(group)!)).toBe(false);
  });

  it("does the same with direction down, where a lane is a column", () => {
    const { shapes, groups } = parseSketch(`direction: down\n${SPAN}`);
    const by = boxesByName(shapes);
    expect(by.get("d")!.x).toBe(by.get("a")!.x);
    const region = regionsOf(shapes, groups).get("g")!;
    for (const name of ["a", "d"]) expect(inside(by.get(name)!, region)).toBe(true);
    for (const name of ["b", "c"]) expect(overlaps(by.get(name)!, region)).toBe(false);
  });

  it("lays the Connecting-an-agent sketch out with three regions that do not cross and hold only their members", () => {
    // Its regions crossed each other on the board: ttmi.ai's members sit in
    // columns 1, 3 and 4, so its bounding box ran through column 2.
    const { shapes, groups } = parseSketch(fixture("connecting-an-agent.sketch"));
    const regions = regionsOf(shapes, groups);
    expect([...regions.keys()]).toEqual(["site", "clients", "repo"]);
    for (const a of regions.keys()) for (const b of regions.keys()) if (a < b) expect(overlaps(regions.get(a)!, regions.get(b)!), `${a} crosses ${b}`).toBe(false);
    const by = boxesByName(shapes);
    for (const group of groups) {
      for (const [name, shape] of by) {
        if (group.members.includes(name)) continue;
        expect(overlaps(shape, regions.get(group.name)!), `${name} inside ${group.name}`).toBe(false);
      }
    }
    // The region holds the member boxes; a member note hangs outside it,
    // by its box, like any note.
    expect(inside(by.get("plugin")!, regions.get("repo")!)).toBe(true);
    expect(overlaps(by.get("layout")!, regions.get("repo")!)).toBe(false);
    // The four clients stay one column, all on one side of the ttmi.ai lane.
    const sides = ["claude", "editors", "clis", "other"].map((name) => (by.get(name)!.y < regions.get("site")!.y ? "above" : "below"));
    expect(new Set(sides).size).toBe(1);
  });
});

describe("cycles (docs/format.md, Layout, step 2)", () => {
  it("draws a two-box cycle as a flow: the first in the text, then the second, the arrow back drawn all the same", () => {
    const { shapes } = parseSketch('a: box "A"\nb: box "B"\na -> b\nb -> a');
    const by = boxesByName(shapes);
    expect(by.get("a")!.x).toBe(40);
    expect(by.get("b")!.x).toBe(40 + 140 + 220);
    expect(shapes.filter((shape) => shape.kind === "arrow")).toHaveLength(2);
  });

  it("puts the Connecting-an-agent flow in story order, the dashboard's arrow back to the connect page set aside, and the lane still one rectangle", () => {
    const { shapes, groups } = parseSketch(fixture("connecting-an-agent.sketch"));
    const by = boxesByName(shapes);
    // The connect page starts the flow and the dashboard ends it.
    expect(by.get("agents")!.x).toBe(40);
    const boxes = [...by.values()].filter((shape) => shape.kind === "rect");
    expect(by.get("status")!.x).toBe(Math.max(...boxes.map((shape) => shape.x)));
    for (const name of ["claude", "editors", "clis", "other"]) {
      expect(by.get(name)!.x).toBeGreaterThan(by.get("agents")!.x);
      expect(by.get(name)!.x).toBeLessThan(by.get("mcp")!.x);
    }
    expect(by.get("mcp")!.x).toBeLessThan(by.get("status")!.x);
    // The ttmi.ai lane: one rectangle, the connect page, server and dashboard
    // on one line, the clients outside it.
    const site = groups.find((group) => group.name === "site")!;
    const region = groupRegion(regionMembers(site, shapes.filter(isBoxShape)));
    expect(by.get("mcp")!.y).toBe(by.get("agents")!.y);
    expect(by.get("status")!.y).toBe(by.get("agents")!.y);
    for (const name of ["claude", "editors", "clis", "other", "plugin", "listings"]) {
      const shape = by.get(name)!;
      expect(shape.x < region.x + region.w && region.x < shape.x + shape.w && shape.y < region.y + region.h && region.y < shape.y + shape.h, `${name} inside ttmi.ai`).toBe(false);
    }
  });
});

describe("folded notes (docs/board.md, Notes fold)", () => {
  // Boxes 140 × 70. A note with more than one block folds to a 120 × 30
  // line; open, it would be 400 high and widen to 700 for its code.
  const measure: SketchMeasure = {
    box: () => ({ w: 140, h: 70 }),
    note: () => 400,
    noteWidth: (html) => (html.includes("<pre") ? 700 : 0),
    noteFolded: (html) => ((html.match(/<(h\d|p|pre|ul|ol|blockquote)[\s>]/g) ?? []).length > 1 ? { w: 120, h: 30 } : undefined),
  };
  const NOTE = "n: note\n  ## N\n  ```ts\n  const detail = 1;\n  ```\n";

  it("keeps two boxes in consecutive columns the same distance apart with and without a tall, wide note on the first", () => {
    const bare = boxesByName(parseSketch('a: box "A"\nb: box "B"\na -> b', measure).shapes);
    const noted = boxesByName(parseSketch(`a: box "A"\nb: box "B"\n${NOTE}a -> b\nn -> a`, measure).shapes);
    expect(bare.get("b")!.x - bare.get("a")!.x).toBe(140 + 220);
    expect(noted.get("b")!.x - noted.get("a")!.x).toBe(140 + 220);
    expect(noted.get("n")).toMatchObject({ w: 120, h: 30, minWidth: 420 });
  });

  it("lays the folded note out under the band, one line high, and the band stays the boxes'", () => {
    const by = boxesByName(parseSketch(`a: box "A"\nb: box "B"\n${NOTE}a -> b\nn -> a`, measure).shapes);
    expect(by.get("n")!.y).toBe(40 + 70 + 64);
    expect(by.get("a")!.y).toBe(40);
    expect(by.get("b")!.y).toBe(40);
  });

  it("lets a describing note hang outside the band without widening its column, counting it only under the last column", () => {
    // A 300 px folded line under a 140 px box in the last of two columns:
    // it reaches past the drawing's edge, so the fit counts it, and the
    // columns are still 220 apart because 140 + 300 fits.
    const wide: SketchMeasure = { ...measure, noteFolded: (html) => (measure.noteFolded(html, 0, 0) ? { w: 300, h: 30 } : undefined) };
    const by = boxesByName(parseSketch(`a: box "A"\nb: box "B"\n${NOTE}a -> b\nn -> a`, wide).shapes);
    expect(by.get("b")!.x - by.get("a")!.x).toBe(140 + 220);
    // Under the first of ten packed columns it hangs under the band, past
    // its box and the gap, and the columns stay 140 + 56 apart.
    const names = "abcdefghij".split("");
    const text = `${names.map((name) => `${name}: box "${name.toUpperCase()}"`).join("\n")}\n${NOTE}${names.slice(1).map((name, index) => `${names[index]} -> ${name}`).join("\n")}\nn -> a`;
    const packed = boxesByName(parseSketch(text, wide).shapes);
    expect(packed.get("b")!.x - packed.get("a")!.x).toBe(140 + 56);
    expect(packed.get("c")!.x - packed.get("b")!.x).toBe(140 + 56);
    expect(packed.get("n")).toMatchObject({ x: 40, y: 40 + 70 + 64, w: 300 });
    // Under the last column it reaches past the drawing's edge, which the
    // fit counts.
    const last = `${names.map((name) => `${name}: box "${name.toUpperCase()}"`).join("\n")}\n${NOTE}${names.slice(1).map((name, index) => `${names[index]} -> ${name}`).join("\n")}\nn -> j`;
    const tail = boxesByName(parseSketch(last, wide).shapes);
    expect(tail.get("j")!.x - tail.get("i")!.x).toBe(140 + 56);
    expect(tail.get("n")!.x).toBe(tail.get("j")!.x);
    // Nine 140 px columns and a 300 px last one are 1560: the gap is the floor.
    expect(tail.get("j")!.x + 300).toBe(40 + 9 * (140 + 56) + 300);
  });

  it("lets a folded note that is a column of its own hang into the gap, counting only what reaches a shape next door", () => {
    // n has an arrow in, so it takes a column between a and b; folded to
    // 300 px with b at its height, its column counts 300 - 220 = 80.
    const wide: SketchMeasure = { ...measure, noteFolded: (html) => (measure.noteFolded(html, 0, 0) ? { w: 300, h: 30 } : undefined) };
    const by = boxesByName(parseSketch(`a: box "A"\nb: box "B"\n${NOTE}a -> n\nn -> b`, wide).shapes);
    expect(by.get("n")!.x).toBe(40 + 140 + 220);
    expect(by.get("b")!.x).toBe(400 + 80 + 220);
  });

  it("still widens a one-block code note, which never folds; outside the band it widens no column", () => {
    const by = boxesByName(parseSketch('a: box "A"\nb: box "B"\nn: note\n  ```ts\n  x\n  ```\na -> b\nn -> a', measure).shapes);
    expect(by.get("n")).toMatchObject({ w: 700, h: 400, x: 40, y: 40 + 70 + 64 });
    expect(by.get("b")!.x - by.get("a")!.x).toBe(140 + 220);
  });
});

describe("an update: beside neighbours", () => {
  it("places an unplaced shape 220 px past the first placed shape it connects to", () => {
    const { shapes } = parseSketch('a: box "A" at 100,100 size 140,70\nb: box "B"\na -> b');
    expect(boxesByName(shapes).get("b")).toMatchObject({ x: 100 + 140 + 220, y: 100 });
    const { shapes: down } = parseSketch('direction: down\na: box "A" at 100,100 size 140,70\nb: box "B"\na -> b');
    expect(boxesByName(down).get("b")).toMatchObject({ x: 100, y: 100 + 70 + 220 });
  });

  it("steps 32 px across until it overlaps nothing", () => {
    const { shapes } = parseSketch('a: box "A" at 100,100 size 140,70\nc: box "C" at 460,100 size 140,70\nb: box "B"\na -> b');
    // 460,100 is taken by c, so b steps down by 32 until it clears c's
    // bottom edge plus 24 px: 100 + 70 + 24 = 194, reached at 196.
    expect(boxesByName(shapes).get("b")).toMatchObject({ x: 460, y: 100 + 32 * 3 });
  });

  it("puts a shape with no placed neighbour 80 px below everything", () => {
    const { shapes } = parseSketch('a: box "A" at 100,100 size 140,70\nb: box "B" at 500,300 size 140,70\nc: box "C"');
    expect(boxesByName(shapes).get("c")).toMatchObject({ x: 100, y: 300 + 70 + 80 });
  });

  it("does not move shapes that have a position", () => {
    const { shapes } = parseSketch('a: box "A" at 100,100 size 140,70\nb: box "B" at 900,900 size 140,70\na -> b');
    expect(boxesByName(shapes).get("b")).toMatchObject({ x: 900, y: 900 });
  });
});

describe("room for an arrow's label between columns (docs/format.md, Layout)", () => {
  // Boxes 140 × 70, labels estimated at length × 6.8 + 20 by 24 px.
  const chain = (names: string[]) => `${names.map((name) => `${name}: box "${name.toUpperCase()}"`).join("\n")}\n${names.slice(1).map((name, index) => `${names[index]} -> ${name}`).join("\n")}`;

  it("keeps two columns joined by a labelled arrow at least the label plus 28 px each side apart, once the columns close up", () => {
    const names = "abcdefghij".split("");
    const text = chain(names).replace("a -> b", 'a -> b "merge when green"');
    const by = boxesByName(parseSketch(text).shapes);
    // "merge when green" is 16 characters: 129 px, plus 56 of arrow.
    expect(by.get("b")!.x - by.get("a")!.x).toBe(140 + 129 + 56);
    expect(by.get("c")!.x - by.get("b")!.x).toBe(140 + 56);
  });

  it("changes nothing while the gap is wide enough anyway", () => {
    const by = boxesByName(parseSketch('a: box "A"\nb: box "B"\na -> b "merge when green"').shapes);
    expect(by.get("b")!.x - by.get("a")!.x).toBe(140 + 220);
  });

  it("gives the other columns the room that is left, so the drawing still fits", () => {
    // Five columns are 700 of 1360: 620 px over four gaps. One gap needs
    // 200 for its label; the other three share the 420 left.
    const measure: SketchMeasure = { box: () => ({ w: 140, h: 70 }), note: () => 40, noteWidth: () => 0, noteFolded: () => undefined, label: () => ({ w: 144, h: 24 }) };
    const by = boxesByName(parseSketch(chain("abcde".split("")).replace("b -> c", 'b -> c "label"'), measure).shapes);
    expect(by.get("c")!.x - by.get("b")!.x).toBe(140 + 200);
    expect(by.get("b")!.x - by.get("a")!.x).toBe(140 + 140);
    expect(by.get("e")!.x + 140).toBe(1360);
  });

  it("uses the label's height between rows with direction: down", () => {
    const names = "abcdefgh".split("");
    const text = `direction: down\n${chain(names).replace("a -> b", 'a -> b "enqueue"')}`;
    const by = boxesByName(parseSketch(text).shapes);
    expect(by.get("b")!.y - by.get("a")!.y).toBe(70 + 24 + 56);
    expect(by.get("c")!.y - by.get("b")!.y).toBe(70 + 56);
  });

  it("takes the label's size from the measurer when there is one", () => {
    const measure: SketchMeasure = { box: () => ({ w: 140, h: 70 }), note: () => 40, noteWidth: () => 0, noteFolded: () => undefined, label: (text) => ({ w: text.length * 10, h: 20 }) };
    const by = boxesByName(parseSketch(chain("abcdefghij".split("")).replace("a -> b", 'a -> b "ten chars!"'), measure).shapes);
    expect(by.get("b")!.x - by.get("a")!.x).toBe(140 + 100 + 56);
  });
});
