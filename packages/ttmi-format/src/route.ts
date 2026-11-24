// --- Arrows: edges and routing ------------------------------------------------
import { DEFAULT_TEXT_SIZE, GROUP_HEAD, TAG_LEFT } from "./constants";
import { arrowControl, arrowMidpoint } from "./curves";
import type { ArrowDraft, BoxDraft, Rect } from "./drafts";
import { labelSize } from "./estimate";
import { center, edge } from "./geometry";
import { groupRegion, regionMembers } from "./groups";
import type { ArrowShape, NoteShape, Point, RectShape, Shape, SketchGroup } from "./types";

// Turns placed drafts into board shapes, routing every arrow.
export function build(boxes: BoxDraft[], arrows: ArrowDraft[], others: Rect[], groups: SketchGroup[] = []): Shape[] {
  const shapes: Shape[] = boxes.map((box) => box.kind === "rect"
    ? { kind: "rect", id: box.id ?? crypto.randomUUID(), name: box.name, x: box.at!.x, y: box.at!.y, w: box.w, h: box.h, color: box.color, label: box.label, ...(box.tag ? { tag: box.tag } : {}), ...(box.link ? { link: box.link } : {}), ...(box.laidOut ? { laidOut: true } : {}) } satisfies RectShape
    : { kind: "note", id: box.id ?? crypto.randomUUID(), name: box.name, x: box.at!.x, y: box.at!.y, w: box.w, h: box.h, color: box.color, html: box.html, ...(box.size !== DEFAULT_TEXT_SIZE ? { size: box.size } : {}), ...(box.minWidth !== undefined ? { minWidth: box.minWidth } : {}), ...(box.tag ? { tag: box.tag } : {}), ...(box.laidOut ? { laidOut: true } : {}) } satisfies NoteShape);
  const byName = new Map(boxes.map((box) => [box.name, box]));
  // The outline an arrow ends on, measured with the node's size. A folding
  // note's is its badge (the head), not the panel it opens into, so the
  // end stays put when the note is folded. A box is its rectangle, and
  // its corner pill is part of that outline (docs/format.md, Arrows).
  const rects = (box: BoxDraft): Rect => box.kind === "note" && box.badge
    ? { x: box.at!.x + box.badge.x, y: box.at!.y + box.badge.y, w: box.badge.w, h: box.badge.h }
    : {
      x: box.at!.x, y: box.at!.y, w: box.w, h: box.h,
      ...(box.tagSize ? { pill: { x: box.at!.x + (box.badge?.x ?? TAG_LEFT), y: box.at!.y + (box.badge?.y ?? -box.tagSize.h / 2), w: box.tagSize.w, h: box.tagSize.h } } : {}),
    };
  // Where a label must not sit though a line may pass: every shape's tag
  // pill, the ends' own included, and the strip at the top of each group
  // region that holds its label and tag.
  const pills = boxes.flatMap((box) => rects(box).pill ?? []);
  const heads = groups.flatMap((group) => {
    const members = regionMembers(group, boxes);
    if (!members.length || (!group.label && !group.tag)) return [];
    const region = groupRegion(members.map(rects));
    return [{ x: region.x, y: region.y, w: region.w, h: GROUP_HEAD + 8 }];
  });
  const plans: Plan[] = arrows.map((arrow) => {
    const fromBox = typeof arrow.from === "string" ? byName.get(arrow.from) : undefined;
    const toBox = typeof arrow.to === "string" ? byName.get(arrow.to) : undefined;
    return {
      fromBox: fromBox ? rects(fromBox) : undefined,
      toBox: toBox ? rects(toBox) : undefined,
      fromPoint: fromBox ? undefined : (arrow.from as Point),
      toPoint: toBox ? undefined : (arrow.to as Point),
      label: arrow.label ?? arrow.seq,
      labelSize: arrow.label || arrow.seq ? arrow.labelSize ?? labelSize(arrow.label, arrow.seq) : undefined,
      given: arrow.bend,
      obstacles: [...boxes.filter((box) => box !== fromBox && box !== toBox).map(rects), ...others],
      labelObstacles: [...pills, ...heads],
    };
  });
  // First each arrow avoids the ones routed before it, then every arrow is
  // routed again against all the others.
  const routed: (Routed | undefined)[] = plans.map(() => undefined);
  for (let pass = 0; pass < 2; pass += 1) {
    plans.forEach((plan, index) => {
      routed[index] = route(plan, routed.filter((other, at): other is Routed => at !== index && other !== undefined));
    });
  }
  arrows.forEach((arrow, index) => {
    const { from, to, bend } = routed[index]!;
    shapes.push({
      kind: "arrow",
      id: arrow.id ?? crypto.randomUUID(),
      from,
      to,
      color: arrow.color,
      ...(arrow.label ? { label: arrow.label } : {}),
      ...(arrow.seq ? { seq: arrow.seq } : {}),
      ...(bend ? { bend } : {}),
      ...(arrow.narration ? { narration: arrow.narration } : {}),
    } satisfies ArrowShape);
  });
  return shapes;
}

type Plan = {
  fromBox?: Rect;
  toBox?: Rect;
  fromPoint?: Point;
  toPoint?: Point;
  label?: string;
  labelSize?: { w: number; h: number };
  given?: number;
  obstacles: Rect[];
  labelObstacles: Rect[];
};
// An arrow as routed: its ends and bend, the curve as a line of points,
// and the box its label covers.
type Routed = { from: Point; to: Point; bend: number; line: Point[]; label?: Rect };

function curvePoints(from: Point, to: Point, bend: number, steps = 24) {
  const control = arrowControl(from, to, bend);
  return Array.from({ length: steps + 1 }, (_, index) => {
    const t = index / steps;
    return {
      x: (1 - t) * (1 - t) * from.x + 2 * (1 - t) * t * control.x + t * t * to.x,
      y: (1 - t) * (1 - t) * from.y + 2 * (1 - t) * t * control.y + t * t * to.y,
    };
  });
}

function labelRect(from: Point, to: Point, bend: number, size: { w: number; h: number }): Rect {
  const middle = arrowMidpoint(from, to, bend);
  return { x: middle.x - size.w / 2, y: middle.y - size.h / 2, w: size.w, h: size.h };
}

function overlaps(a: Rect, b: Rect) {
  return !(a.x > b.x + b.w || a.x + a.w < b.x || a.y > b.y + b.h || a.y + a.h < b.y);
}

function crosses(a: Point, b: Point, c: Point, d: Point) {
  const side = (p: Point, q: Point, r: Point) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  return side(a, b, c) * side(a, b, d) < 0 && side(c, d, a) * side(c, d, b) < 0;
}

function segmentInRect(a: Point, b: Point, rect: Rect) {
  for (let t = 0; t <= 1; t += 0.25) {
    const x = a.x + (b.x - a.x) * t;
    const y = a.y + (b.y - a.y) * t;
    if (x > rect.x && x < rect.x + rect.w && y > rect.y && y < rect.y + rect.h) return true;
  }
  return false;
}

// The gentlest curve that touches no shape but its own ends, crosses no
// other arrow and keeps clear of their labels: straight first, then bending
// further out to either side. Where none is clear, the one that does least
// of it. Given a bend, the arrow keeps it.
function route(plan: Plan, others: Routed[]): Routed {
  const { fromBox, toBox, label, labelSize: size, obstacles, labelObstacles } = plan;
  const a = fromBox ? center(fromBox) : plan.fromPoint!;
  const b = toBox ? center(toBox) : plan.toPoint!;
  const shape = (bend: number): Routed => {
    const toward = bend ? arrowControl(a, b, bend) : undefined;
    const from = fromBox ? edge(fromBox, toward ?? b) : a;
    const to = toBox ? edge(toBox, toward ?? a) : b;
    return { from, to, bend, line: curvePoints(from, to, bend), ...(label && size ? { label: labelRect(from, to, bend, size) } : {}) };
  };
  if (plan.given !== undefined) return shape(plan.given);

  const inside = (point: Point, pad: number, rects: Rect[]) => rects.some((box) =>
    point.x > box.x - pad && point.x < box.x + box.w + pad && point.y > box.y - pad && point.y < box.y + box.h + pad);
  const cost = (candidate: Routed) => {
    let total = 0;
    // Through a shape: per point of the curve inside one.
    for (const point of candidate.line.slice(1, -1)) if (inside(point, 10, obstacles)) total += 1;
    // Its label on a shape.
    if (candidate.label && inside(arrowMidpoint(candidate.from, candidate.to, candidate.bend), 4, obstacles)) total += 6;
    if (candidate.label && obstacles.some((box) => overlaps(candidate.label!, box))) total += 6;
    // Its label on a tag or a group's label.
    if (candidate.label && labelObstacles.some((box) => overlaps(candidate.label!, box))) total += 6;
    // Crossing another arrow, away from the ends arrows share at a box.
    const nearEnd = (point: Point) => Math.hypot(point.x - candidate.from.x, point.y - candidate.from.y) < 24 || Math.hypot(point.x - candidate.to.x, point.y - candidate.to.y) < 24;
    for (const other of others) {
      for (let i = 0; i < candidate.line.length - 1; i += 1) {
        const p = candidate.line[i]!;
        const q = candidate.line[i + 1]!;
        if (nearEnd(p) || nearEnd(q)) continue;
        for (let j = 0; j < other.line.length - 1; j += 1) {
          if (crosses(p, q, other.line[j]!, other.line[j + 1]!)) total += 8;
        }
        // Over another arrow's label.
        if (other.label && segmentInRect(p, q, other.label)) total += 4;
      }
      // Its label over another arrow.
      if (candidate.label && other.line.some((point) => inside(point, 0, [candidate.label!]))) total += 4;
    }
    return total;
  };

  let best = shape(0);
  let bestCost = cost(best);
  for (let step = 30; bestCost > 0 && step <= 300; step += 30) {
    for (const bend of [step, -step]) {
      const candidate = shape(bend);
      const candidateCost = cost(candidate);
      if (candidateCost < bestCost) {
        best = candidate;
        bestCost = candidateCost;
      }
    }
  }
  return best;
}
