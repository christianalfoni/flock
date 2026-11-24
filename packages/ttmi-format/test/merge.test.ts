// Importing into a board that already has shapes merges by name and never
// moves the user's layout (docs/format.md, Merge). The first block follows
// merge-run.cjs on the janitor sketch; the rest cover each rule.
import { describe, expect, it } from "vitest";
import { groupRegion, isBoxShape, parseSketch, regionMembers, serializeSketch, type NoteShape, type RectShape, type Shape, type SketchGroup } from "../src/index";
import type { Rect } from "../src/drafts";
import { arrows, boxesByName, byUser, example } from "./helpers";

describe("groups (docs/format.md, Groups)", () => {
  it("follow the agent's text, keep the user's positions, and go when their members do", () => {
    const first = parseSketch('a: box "A"\nb: box "B"\nc: box "C"\ng: group "G" of a, b\na -> b');
    const moved = byUser(first.shapes).map((shape) => (shape.kind !== "arrow" && shape.name === "b" ? { ...shape, x: 900, y: 900 } : shape));
    const second = parseSketch('a: box "A"\nb: box "B"\nc: box "C"\ng: group "G v2" green of b, c\na -> b', undefined, moved);
    expect(second.groups).toEqual([{ name: "g", label: "G v2", color: "green", members: ["b", "c"] }]);
    expect(boxesByName(second.shapes).get("b")).toMatchObject({ x: 900, y: 900 });
    // The user deletes b and c on the board: the export drops the group.
    const left = second.shapes.filter((shape) => shape.kind === "arrow" || shape.name === "a");
    expect(serializeSketch(left, "T", [], second.groups).text).not.toContain("group");
    // Text without the group removes it.
    expect(parseSketch('a: box "A"\nb: box "B"\nc: box "C"\na -> b', undefined, second.shapes).groups).toEqual([]);
  });

  it("leave the user's lane where it is when the text comes again with the group changed", () => {
    const text = 'a: box "A"\nb: box "B"\nc: box "C"\nd: box "D"\na -> b\na -> c\nb -> d\nc -> d\ng: group "G" of a, d';
    const first = { shapes: byUser(parseSketch(text).shapes) };
    const second = parseSketch(text.replace("of a, d", "of a, d, c"), undefined, first.shapes);
    expect(second.groups).toEqual([{ name: "g", label: "G", color: "white", members: ["a", "d", "c"] }]);
    const before = boxesByName(first.shapes);
    const after = boxesByName(second.shapes);
    for (const name of ["a", "b", "c", "d"]) expect([after.get(name)!.x, after.get(name)!.y]).toEqual([before.get(name)!.x, before.get(name)!.y]);
  });
});

describe("merge-run: the janitor sketch", () => {
  const source = example("janitor.sketch");
  const parsed = parseSketch(source);
  const first = { ...parsed, shapes: byUser(parsed.shapes) };
  const before = boxesByName(first.shapes);

  it("ignores a changed at for a name already on the board", () => {
    const exported = serializeSketch(first.shapes, "Janitor", first.steps).text;
    const moved = exported.replace(/(index: box "[^"]*"[^\n]*?) at -?\d+,-?\d+/, "$1 at 900,700");
    expect(moved).not.toBe(exported);
    const { shapes } = parseSketch(moved, undefined, first.shapes);
    const index = boxesByName(shapes).get("index")!;
    expect([index.x, index.y]).toEqual([before.get("index")!.x, before.get("index")!.y]);
  });

  // The agent's update: a new label, a new box, the scheduler dropped.
  const update = source
    .replace('"Retirement index\\nid -> due time"', '"Retirement index v2\\nid -> due time (ms)"')
    .replace(/scheduler: box[^\n]*\n/, "")
    .replace(/scheduler -> janitor[^\n]*\n/, "")
    .replace("janitor -> index", 'audit: box "Audit log" orange\njanitor -> audit "record sweep"\njanitor -> index');
  const second = parseSketch(update, undefined, first.shapes);
  const after = boxesByName(second.shapes);

  it("keeps every remaining shape's position and id", () => {
    for (const name of ["runner", "upkeep", "janitor", "index", "singleton", "archive"]) {
      expect(after.get(name), name).toBeDefined();
      expect([after.get(name)!.x, after.get(name)!.y], name).toEqual([before.get(name)!.x, before.get(name)!.y]);
      expect(after.get(name)!.id, name).toBe(before.get(name)!.id);
    }
  });

  it("takes the new label", () => {
    expect((after.get("index") as RectShape).label).toBe("Retirement index v2\nid -> due time (ms)");
  });

  it("removes the shape the text left out, with its arrows", () => {
    expect(after.has("scheduler")).toBe(false);
    expect(arrows(second.shapes).some((arrow) => arrow.label === "assign")).toBe(false);
  });

  it("places the new box beside the shape it connects to", () => {
    // 220 px past the janitor, at its height or stepped down by 32s until
    // it clears what the compact layout has there (the index box sits at
    // the janitor's height in the next column).
    const janitor = after.get("janitor")!;
    const audit = after.get("audit")!;
    expect(audit).toMatchObject({ color: "orange", label: "Audit log", x: janitor.x + janitor.w + 220 });
    expect(audit.y).toBeGreaterThanOrEqual(janitor.y);
    expect((audit.y - janitor.y) % 32).toBe(0);
    for (const other of after.values()) {
      if (other === audit) continue;
      expect(audit.x + audit.w <= other.x || other.x + other.w <= audit.x || audit.y + audit.h <= other.y || other.y + other.h <= audit.y, `audit clear of ${other.name}`).toBe(true);
    }
  });

  it("reads the same board back after a second round trip", () => {
    const exported = serializeSketch(second.shapes, "Janitor").text;
    const again = parseSketch(exported, undefined, second.shapes);
    expect(serializeSketch(again.shapes, "Janitor").text).toBe(exported);
  });
});

describe("shapes", () => {
  const board = byUser(parseSketch('a: box "A" blue tint tag "Service"\nb: box "B"\nn: note\n  old\na -> b "go"\nn -> a').shapes);

  it("keep the board's position and size, and take the text's label, color, fill, tag and content", () => {
    const { shapes } = parseSketch('a: box "A!" red solid tag "Store"\nb: box "B"\nn: note green\n  new\na -> b "go"\nn -> a', undefined, board);
    const was = boxesByName(board);
    const now = boxesByName(shapes);
    expect(now.get("a")).toMatchObject({ x: was.get("a")!.x, y: was.get("a")!.y, w: was.get("a")!.w, h: was.get("a")!.h, label: "A!", color: "red", tag: "Store", id: was.get("a")!.id });
    expect(now.get("n")).toMatchObject({ x: was.get("n")!.x, y: was.get("n")!.y, w: was.get("n")!.w, h: was.get("n")!.h, color: "green", html: "<p>new</p>", id: was.get("n")!.id });
  });

  it("lose their tag when the text leaves it out", () => {
    const { shapes } = parseSketch('a: box "A"\nb: box "B"\nn: note\n  old\na -> b "go"\nn -> a', undefined, board);
    expect(boxesByName(shapes).get("a")!.tag).toBeUndefined();
  });

  it("grow for a longer badge, and keep the user's place", () => {
    const tag = "Admin projects storage walk and page model";
    const { shapes } = parseSketch(`a: box "A" tag "${tag}"\nb: box "B"\nn: note\n  old\na -> b "go"\nn -> a`, undefined, board);
    const was = boxesByName(board).get("a")!;
    const now = boxesByName(shapes).get("a")!;
    expect(now.x).toBe(was.x);
    expect(now.y).toBe(was.y);
    expect(now.w).toBeGreaterThan(was.w);
    expect(now.h).toBe(was.h);
  });

  it("grow for a longer label, never shrink", () => {
    // 33 characters estimate to 33 × 7.6 + 48 = 299 wide.
    const bigger = parseSketch('a: box "A rather longer label than before"\nb: box "B"\nn: note\n  old\na -> b "go"\nn -> a', undefined, board).shapes;
    expect(boxesByName(bigger).get("a")!.w).toBe(299);
    const smaller = parseSketch('a: box "A"\nb: box "B"\nn: note\n  old\na -> b "go"\nn -> a', undefined, bigger).shapes;
    expect(boxesByName(smaller).get("a")!.w).toBe(299);
  });

  it("widen a note for its code, never narrow it", () => {
    const wider = { box: (label: string) => ({ w: 140 + label.length, h: 70 }), note: () => 50, noteWidth: () => 600, noteFolded: () => undefined };
    const widened = parseSketch('a: box "A"\nn: note\n  ```ts\n  x\n  ```\nn -> a', wider, board).shapes;
    expect(boxesByName(widened).get("n")!.w).toBe(600);
    const narrower = { ...wider, noteWidth: () => 0 };
    const kept = parseSketch('a: box "A"\nn: note\n  short\nn -> a', narrower, widened).shapes;
    expect(boxesByName(kept).get("n")!.w).toBe(600);
  });

  it("measure a merged note's height again when a measurer is given, else keep it", () => {
    const measured = parseSketch('a: box "A"\nn: note\n  one\nn -> a', { box: () => ({ w: 140, h: 70 }), note: () => 123, noteWidth: () => 0, noteFolded: () => undefined }, board).shapes;
    expect(boxesByName(measured).get("n")!.h).toBe(123);
    const kept = parseSketch('a: box "A"\nn: note\n  one\n  two\n  three\nn -> a', undefined, measured).shapes;
    expect(boxesByName(kept).get("n")!.h).toBe(123);
  });

  it("with a new name are placed beside a shape they connect to", () => {
    const { shapes } = parseSketch('a: box "A"\nb: box "B"\nc: box "C"\nn: note\n  old\na -> b "go"\nb -> c\nn -> a', undefined, board);
    const b = boxesByName(shapes).get("b")!;
    expect(boxesByName(shapes).get("c")).toMatchObject({ x: b.x + b.w + 220, y: b.y });
  });

  it("are removed when the text leaves their name out", () => {
    const { shapes } = parseSketch('a: box "A"', undefined, board);
    expect([...boxesByName(shapes).keys()]).toEqual(["a"]);
    expect(arrows(shapes)).toHaveLength(0);
  });

  it("that changed kind under the same name are made anew", () => {
    const { shapes } = parseSketch('a: note\n  now a note\nb: box "B"\na -> b', undefined, board);
    const a = boxesByName(shapes).get("a")!;
    expect(a.kind).toBe("note");
    expect(a.id).not.toBe(boxesByName(board).get("a")!.id);
  });

  it("without a name are kept untouched", () => {
    const own: Shape[] = [
      { kind: "rect", id: "mine", x: 10, y: 10, w: 100, h: 50, color: "red", label: "mine" },
      { kind: "note", id: "my-note", x: 10, y: 200, w: 200, h: 40, color: "white", html: "<p>me</p>" },
    ];
    const { shapes } = parseSketch('a: box "A"', undefined, [...board, ...own]);
    expect(shapes.find((shape) => shape.id === "mine")).toEqual(own[0]);
    expect(shapes.find((shape) => shape.id === "my-note")).toEqual(own[1]);
  });
});

describe("arrows", () => {
  const board = parseSketch('a: box "A"\nb: box "B"\nc: box "C"\na -> b "go"\nb -> c').shapes;

  it("between named shapes are replaced by the text's", () => {
    const { shapes } = parseSketch('a: box "A"\nb: box "B"\nc: box "C"\na -> c "skip"', undefined, board);
    expect(arrows(shapes).map((arrow) => arrow.label)).toEqual(["skip"]);
  });

  it("between the same two shapes keep the board arrow's bend and id", () => {
    const bent = board.map((shape) => (shape.kind === "arrow" && shape.label === "go" ? { ...shape, bend: 77 } : shape));
    const goId = arrows(bent).find((arrow) => arrow.label === "go")!.id;
    const { shapes } = parseSketch('a: box "A"\nb: box "B"\nc: box "C"\na -> b "renamed"\nb -> c', undefined, bent);
    const go = arrows(shapes).find((arrow) => arrow.label === "renamed")!;
    expect(go.bend).toBe(77);
    expect(go.id).toBe(goId);
  });

  it("take the text's bend when it gives one", () => {
    const bent = board.map((shape) => (shape.kind === "arrow" && shape.label === "go" ? { ...shape, bend: 77 } : shape));
    const { shapes } = parseSketch('a: box "A"\nb: box "B"\nc: box "C"\na -> b "go" bend -30\nb -> c', undefined, bent);
    expect(arrows(shapes).find((arrow) => arrow.label === "go")!.bend).toBe(-30);
  });

  it("the user drew to or from nowhere are kept", () => {
    const free: Shape = { kind: "arrow", id: "free", from: { x: 2000, y: 2000 }, to: { x: 2100, y: 2100 }, color: "yellow" };
    const { shapes } = parseSketch('a: box "A"\nb: box "B"\nc: box "C"\na -> b "go"', undefined, [...board, free]);
    expect(shapes.find((shape) => shape.id === "free")).toEqual(free);
  });

  it("the user drew from a named shape to an unnamed one are kept", () => {
    const own: RectShape = { kind: "rect", id: "mine", x: 2000, y: 0, w: 100, h: 50, color: "white", label: "" };
    const a = boxesByName(board).get("a")!;
    const toMine: Shape = { kind: "arrow", id: "to-mine", from: { x: a.x + a.w, y: a.y }, to: { x: 2000, y: 25 }, color: "white" };
    const { shapes } = parseSketch('a: box "A"\nb: box "B"\nc: box "C"\na -> b "go"\nb -> c', undefined, [...board, own, toMine]);
    expect(shapes.find((shape) => shape.id === "to-mine")).toEqual(toMine);
  });

  it("are routed around the user's own shapes", () => {
    const blocker: RectShape = { kind: "rect", id: "blocker", x: 200, y: 0, w: 100, h: 50, color: "white", label: "" };
    const { shapes } = parseSketch('a: box "A" at 0,0 size 100,50\nb: box "B" at 400,0 size 100,50\na -> b', undefined, [blocker]);
    expect(arrows(shapes)[0]!.bend).toBeTruthy();
  });
});

describe("steps", () => {
  const board = parseSketch('a: box "A"\nb: box "B"\nstep: a\n  One.\nstep: b\n  Two.');

  it("are replaced by the text's", () => {
    const { steps } = parseSketch('a: box "A"\nb: box "B"\nstep: a b\n  Both.', undefined, board.shapes);
    expect(steps).toEqual([{ names: ["a", "b"], narration: "Both." }]);
  });

  it("are removed when the text has none", () => {
    expect(parseSketch('a: box "A"\nb: box "B"', undefined, board.shapes).steps).toEqual([]);
  });
});

describe("a note merged under a note", () => {
  it("keeps its id and takes the new html", () => {
    const board = parseSketch("n: note\n  one").shapes;
    const { shapes } = parseSketch("n: note\n  **two**", undefined, board);
    expect(shapes[0]).toMatchObject({ id: board[0]!.id, html: "<p><strong>two</strong></p>" } satisfies Partial<NoteShape>);
  });
});

// A board nobody has arranged is laid out afresh on every update, so its
// lanes stay whole; a board the user has arranged keeps every position
// (docs/format.md, Merge).
describe("a board the user has not arranged", () => {
  const text = 'a: box "A"\nb: box "B"\nc: box "C"\nx: box "X"\na -> b\nb -> c\nx -> c\ng: group "G" of a, b\nh: group "H" of x, c';
  const update = `${text.replace("of a, b", "of a, b, m")}\nm: box "M"\nc -> m`;

  it("marks the shapes the layout placed, not those the text placed", () => {
    const { shapes } = parseSketch('a: box "A"\nb: box "B" at 500,500\na -> b');
    expect(boxesByName(shapes).get("a")!.laidOut).toBe(true);
    expect(boxesByName(shapes).get("b")!.laidOut).toBeUndefined();
  });

  it("is laid out afresh, ids kept, as if the update were its first text", () => {
    const first = parseSketch(text).shapes;
    const { shapes } = parseSketch(update, undefined, first);
    const fresh = boxesByName(parseSketch(update).shapes);
    for (const [name, shape] of boxesByName(shapes)) {
      expect([shape.x, shape.y], name).toEqual([fresh.get(name)!.x, fresh.get(name)!.y]);
      expect(shape.laidOut, name).toBe(true);
    }
    for (const name of ["a", "b", "c", "x"]) expect(boxesByName(shapes).get(name)!.id, name).toBe(boxesByName(first).get(name)!.id);
  });

  it("ignores the positions the agent echoes from the board", () => {
    const first = parseSketch(text).shapes;
    const echoed = serializeSketch(first, "T", [], parseSketch(text).groups).text;
    expect(echoed).toContain(" at ");
    const withM = echoed.replace("of a, b", "of a, b, m").concat('\nm: box "M"\nc -> m');
    const { shapes } = parseSketch(withM, undefined, first);
    const fresh = boxesByName(parseSketch(update).shapes);
    for (const [name, shape] of boxesByName(shapes)) expect([shape.x, shape.y], name).toEqual([fresh.get(name)!.x, fresh.get(name)!.y]);
  });

  it("keeps every position once the user has moved one shape", () => {
    const first = parseSketch(text).shapes;
    const moved = first.map((shape) => {
      if (shape.kind === "arrow" || shape.name !== "x") return shape;
      const { laidOut: _laidOut, ...rest } = shape;
      return { ...rest, y: rest.y + 10 };
    });
    const { shapes } = parseSketch(update, undefined, moved);
    const before = boxesByName(moved);
    for (const name of ["a", "b", "c", "x"]) expect([boxesByName(shapes).get(name)!.x, boxesByName(shapes).get(name)!.y], name).toEqual([before.get(name)!.x, before.get(name)!.y]);
    // The ones still where the layout put them stay marked; the moved one does not.
    expect(boxesByName(shapes).get("a")!.laidOut).toBe(true);
    expect(boxesByName(shapes).get("x")!.laidOut).toBeUndefined();
  });

  it("keeps every position on a board saved before the layout marked its shapes", () => {
    const legacy = byUser(parseSketch(text).shapes);
    const { shapes } = parseSketch(update, undefined, legacy);
    for (const name of ["a", "b", "c", "x"]) expect(boxesByName(shapes).get(name)!.y, name).toBe(boxesByName(legacy).get(name)!.y);
  });

  it("keeps every position when the user drew a shape of their own", () => {
    const own: RectShape = { kind: "rect", id: "mine", x: 2000, y: 0, w: 100, h: 50, color: "white", label: "" };
    const first = parseSketch(text).shapes;
    const { shapes } = parseSketch(update, undefined, [...first, own]);
    for (const name of ["a", "b", "c", "x"]) expect(boxesByName(shapes).get(name)!.y, name).toBe(boxesByName(first).get(name)!.y);
  });
});

// On a board the user has arranged, a new shape goes beside a neighbour,
// where no group's region would take in a shape that is not its member or
// cross another region (docs/format.md, Merge; docs/concept.md, lesson 16).
describe("new shapes on a board the user has arranged", () => {
  const regionOf = (shapes: Shape[], group: SketchGroup) => groupRegion(regionMembers(group, shapes.filter(isBoxShape)));
  const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  const clean = (shapes: Shape[], groups: SketchGroup[]) => {
    for (const group of groups) {
      const region = regionOf(shapes, group);
      for (const [name, shape] of boxesByName(shapes)) if (!group.members.includes(name)) expect(overlaps(shape, region), `${name} inside ${group.name}`).toBe(false);
      for (const other of groups) if (other.name > group.name) expect(overlaps(region, regionOf(shapes, other)), `${group.name} crosses ${other.name}`).toBe(false);
    }
  };

  it("join their own group's lane, not the neighbour's", () => {
    // g (a, b) and h (x, c) are lanes; m joins g but follows c, in h.
    const text = 'a: box "A"\nb: box "B"\nc: box "C"\nx: box "X"\na -> b\nb -> c\nx -> c\ng: group "G" of a, b\nh: group "H" of x, c';
    const board = byUser(parseSketch(text).shapes);
    clean(board, parseSketch(text).groups);
    const { shapes, groups } = parseSketch(`${text.replace("of a, b", "of a, b, m")}\nm: box "M"\nc -> m`, undefined, board);
    clean(shapes, groups);
  });

  it("that join no group stay out of the regions", () => {
    const text = 'a: box "A"\nb: box "B"\na -> b\ng: group "G" of a, b';
    const board = byUser(parseSketch(text).shapes);
    const { shapes, groups } = parseSketch(`${text}\nn: box "N"\na -> n`, undefined, board);
    clean(shapes, groups);
  });
});
