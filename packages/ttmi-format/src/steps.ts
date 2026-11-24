// --- Steps ----------------------------------------------------------------------
import { isBoxShape, nearBox } from "./geometry";
import { portalLabelId, portalSketchId } from "./portal";
import type { BoxShape, Shape, SketchGroup, SketchStep } from "./types";

// What a walkthrough shows at a step: every shape a step up to and including
// this one names, every shape no step names, and arrows whose ends are both
// showing. "highlighted" are the shapes this step names, its current ones;
// "added" are those of them that were not showing at the step before, which
// the board fades in (docs/board.md, Walkthrough). A shape pointed at again
// is highlighted but not added. A step may name a group, which names its
// members; "regions" are the groups with a visible member, the ones whose
// region is drawn. A step may name a hop of the flow ("#2"), which names
// the shapes at both ends of the arrow numbered seq 2; "hops" are the
// arrows the step names.
export function stepView(shapes: Shape[], steps: SketchStep[], index: number, groups: SketchGroup[] = []) {
  if (steps.some((step) => step.kind)) return tourView(shapes, steps[index], groups);
  const members = new Map(groups.map((group) => [group.name, group.members]));
  const ends = hopEnds(shapes);
  const expand = (names: string[]) => names.flatMap((name) => (name.startsWith("#") ? ends.get(name)?.names ?? [] : members.get(name) ?? [name]));
  const named = new Set(steps.flatMap((step) => expand(step.names)));
  const shown = new Set(steps.slice(0, index + 1).flatMap((step) => expand(step.names)));
  const before = new Set(steps.slice(0, index).flatMap((step) => expand(step.names)));
  const current = new Set(expand(steps[index]?.names ?? []));
  const boxes = shapes.filter(isBoxShape);
  const showsBox = (box: BoxShape) => !box.name || !named.has(box.name) || shown.has(box.name);
  const visible = new Set<string>();
  const highlighted = new Set<string>();
  const added = new Set<string>();
  for (const box of boxes) {
    if (showsBox(box)) visible.add(box.id);
    if (box.name && current.has(box.name)) {
      highlighted.add(box.id);
      if (!before.has(box.name)) added.add(box.id);
    }
  }
  for (const shape of shapes) {
    if (shape.kind !== "arrow") continue;
    const ends = [nearBox(boxes, shape.from), nearBox(boxes, shape.to)];
    if (ends.every((box) => !box || showsBox(box))) visible.add(shape.id);
  }
  const regions = new Set<string>();
  for (const group of groups) {
    if (boxes.some((box) => box.name && group.members.includes(box.name) && visible.has(box.id))) regions.add(group.name);
  }
  const hops = new Set((steps[index]?.names ?? []).flatMap((name) => ends.get(name)?.arrows ?? []));
  return { visible, highlighted, added, regions, hops };
}

// Each numbered arrow by its hop name ("#2"): its id, and the names of the
// shapes at its ends. Branches share no number, but two arrows numbered
// alike are one hop.
export function hopEnds(shapes: Shape[]): Map<string, { arrows: string[]; names: string[] }> {
  const boxes = shapes.filter(isBoxShape);
  const out = new Map<string, { arrows: string[]; names: string[] }>();
  for (const shape of shapes) {
    if (shape.kind !== "arrow" || !shape.seq) continue;
    const hop = out.get(`#${shape.seq}`) ?? { arrows: [], names: [] };
    hop.arrows.push(shape.id);
    for (const box of [nearBox(boxes, shape.from), nearBox(boxes, shape.to)]) if (box?.name && !hop.names.includes(box.name)) hop.names.push(box.name);
    out.set(`#${shape.seq}`, hop);
  }
  return out;
}

// A walkthrough of overview, hops and summary (docs/format.md,
// Walkthrough): the whole drawing at every stop, nothing added; the
// camera does the focusing. A hop's current shapes are its two ends, which
// the camera frames; a note opens only when the narration names it (the
// board's part). The overview and the summary have none, and frame
// everything.
function tourView(shapes: Shape[], step: SketchStep | undefined, groups: SketchGroup[]) {
  const boxes = shapes.filter(isBoxShape);
  const visible = new Set(shapes.map((shape) => shape.id));
  const ends = hopEnds(shapes);
  const names = new Set(step?.kind === "hop" ? step.names.flatMap((name) => ends.get(name)?.names ?? []) : []);
  const highlighted = new Set(boxes.filter((box) => box.name && names.has(box.name)).map((box) => box.id));
  const regions = new Set(groups.filter((group) => boxes.some((box) => box.name && group.members.includes(box.name))).map((group) => group.name));
  const hops = new Set((step?.kind === "hop" ? step.names : []).flatMap((name) => ends.get(name)?.arrows ?? []));
  return { visible, highlighted, added: new Set<string>(), regions, hops };
}

function seqParts(seq: string): [number, string] {
  const match = /^(\d+)([a-z]?)$/.exec(seq);
  return [Number(match?.[1] ?? 0), match?.[2] ?? ""];
}

function compareSeq(a: string, b: string) {
  const [an, al] = seqParts(a);
  const [bn, bl] = seqParts(b);
  if (an !== bn) return an - bn;
  if (al < bl) return -1;
  if (al > bl) return 1;
  return 0;
}

// The arrows a step itself names, in number order. A hop of 2a and 2b is
// both arrows. Nothing past those arrows belongs to the step.
function namedArrows(shapes: Shape[], step: SketchStep | undefined) {
  if (!step) return [];
  const hops = hopEnds(shapes);
  const ids = new Set(step.names.filter((name) => name.startsWith("#")).flatMap((name) => hops.get(name)?.arrows ?? []));
  if (ids.size === 0) return [];
  const boxes = shapes.filter(isBoxShape);
  const order = new Map(shapes.map((shape, index) => [shape.id, index]));
  return shapes.flatMap((shape) => (shape.kind === "arrow" && shape.seq && ids.has(shape.id) ? [{ arrow: shape, from: nearBox(boxes, shape.from), to: nearBox(boxes, shape.to) }] : []))
    .sort((a, b) => compareSeq(a.arrow.seq!, b.arrow.seq!) || (order.get(a.arrow.id) ?? 0) - (order.get(b.arrow.id) ?? 0));
}

function canvasOf(box: BoxShape | undefined, host?: string): string | undefined {
  if (box?.kind !== "rect") return undefined;
  return portalSketchId(box.link, host) ?? portalLabelId(box.label, host);
}

// Boxes on a step's own arrows, the start of each arrow before its end,
// arrows in number order. A box already met on an earlier arrow of this
// step stays where it was first met.
function boxesAlong(arrows: ReturnType<typeof namedArrows>): BoxShape[] {
  const seen = new Set<string>();
  const out: BoxShape[] = [];
  for (const item of arrows) {
    for (const box of [item.from, item.to]) {
      if (!box || seen.has(box.id)) continue;
      seen.add(box.id);
      out.push(box);
    }
  }
  return out;
}

// The canvas the up arrow opens (docs/plan-portals.md): the first canvas
// on the arrows this step itself names that the reader has not entered.
// Boxes are taken in number order, an arrow's start before its end. The
// step does not follow arrows past its own. Entered means the reader dived
// into that canvas (`entered` is those sketch ids), not that an earlier
// step drew it. When every canvas on the step was already entered, the
// step's first canvas. A step that names no hop, and a step whose arrows
// touch no canvas, give nothing back: the board then opens the canvas the
// step names, or the first one in view.
export function sequenceCanvas(shapes: Shape[], steps: SketchStep[], index: number, host?: string, entered?: ReadonlySet<string>): string | undefined {
  const arrows = namedArrows(shapes, steps[index]);
  if (arrows.length === 0) return undefined;
  const canvases = boxesAlong(arrows).flatMap((box) => {
    const id = canvasOf(box, host);
    return id ? [id] : [];
  });
  if (canvases.length === 0) return undefined;
  const seen = entered ?? new Set<string>();
  return canvases.find((id) => !seen.has(id)) ?? canvases[0]!;
}
