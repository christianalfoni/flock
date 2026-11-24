// The stroke the board paints for one arrow. The bend it draws can differ
// from the one that placed the ends (a written bend whose curve crosses
// some other box is drawn a little differently, and the ends stay where
// they were). The new tangent can aim back through the box the end sits
// on, so a short piece of the stroke shows outside that box, dives under
// it, and comes out another side. Cut the stroke to the part that has
// finally left its source and not yet entered its target.
import { arrowControl, type Point } from "@ttmi/format";

export type Rect = { x: number; y: number; w: number; h: number };

// The same reach and the same stand-off the format uses when it puts an
// end on a box: within 24px the end belongs to that box, and a drawn end
// sits 6px outside the edge.
const END_REACH = 24;
const END_OUT = 6;
// A brush of the border is not a pass through the box. The stroke is cut
// only when the curve goes this far inside.
const ENTER_INSET = 1;

export type Painted = {
  from: Point;
  to: Point;
  bend: number;
  /** The quadratic control of the piece actually drawn, when the ends were cut. */
  control?: Point;
  t0: number;
  t1: number;
};

type Hit = { t: number; out: boolean };

export function paintArrow(from: Point, to: Point, bend: number, boxes: readonly Rect[]): Painted {
  const unchanged = (): Painted => ({ from, to, bend, t0: 0, t1: 1 });
  const source = endpointBox(from, boxes);
  const target = endpointBox(to, boxes);
  // Both ends on one box: the loop outside it is the arrow, and cutting
  // to "the last exit, then the first entry" would drop that loop.
  if (source && target && source === target) return unchanged();

  let t0 = 0;
  let t1 = 1;
  if (source && enters(from, to, bend, source)) t0 = depart(from, to, bend, source);
  if (target && enters(from, to, bend, target)) t1 = arrive(from, to, bend, target);
  if (!(t0 < t1 - 1e-3) || (t0 < 1e-4 && t1 > 1 - 1e-4)) return unchanged();

  const span = t1 - t0;
  const start = at(from, to, bend, t0);
  const end = at(from, to, bend, t1);
  if (Math.hypot(end.x - start.x, end.y - start.y) < 1) return unchanged();
  // A piece of a quadratic is a quadratic, but its control is not the bend
  // of the new chord: that bend would pull the stroke off the curve.
  const velocity = deriv(from, to, bend, t0);
  const control = { x: start.x + velocity.x * span / 2, y: start.y + velocity.y * span / 2 };
  return { from: start, to: end, bend, control, t0, t1 };
}

// Where a label that was placed on the whole curve should sit once the
// hidden ends are gone: where it was, when that point is still drawn.
export function labelOnPainted(from: Point, to: Point, bend: number, label: Point, painted: Painted): Point {
  if (painted.t0 <= 1e-4 && painted.t1 >= 1 - 1e-4) return label;
  const t = nearestT(from, to, bend, label);
  if (t >= painted.t0 - 1e-3 && t <= painted.t1 + 1e-3) return label;
  return at(from, to, bend, Math.min(painted.t1, Math.max(painted.t0, t)));
}

function endpointBox(point: Point, boxes: readonly Rect[]) {
  let best: Rect | undefined;
  let bestDist = Infinity;
  for (const box of boxes) {
    if (point.x < box.x - END_REACH || point.x > box.x + box.w + END_REACH || point.y < box.y - END_REACH || point.y > box.y + box.h + END_REACH) continue;
    const dist = outsideDistance(point, box);
    if (dist < bestDist) {
      best = box;
      bestDist = dist;
    }
  }
  return best;
}

function outsideDistance(point: Point, box: Rect) {
  const dx = Math.max(box.x - point.x, 0, point.x - (box.x + box.w));
  const dy = Math.max(box.y - point.y, 0, point.y - (box.y + box.h));
  return Math.hypot(dx, dy);
}

function inset(box: Rect, pad: number): Rect {
  return { x: box.x + pad, y: box.y + pad, w: box.w - pad * 2, h: box.h - pad * 2 };
}

function grow(box: Rect, pad: number): Rect {
  return { x: box.x - pad, y: box.y - pad, w: box.w + pad * 2, h: box.h + pad * 2 };
}

function contains(point: Point, box: Rect) {
  return point.x > box.x && point.x < box.x + box.w && point.y > box.y && point.y < box.y + box.h;
}

function enters(from: Point, to: Point, bend: number, box: Rect) {
  const inner = inset(box, ENTER_INSET);
  if (inner.w <= 0 || inner.h <= 0) return false;
  if (crossings(from, to, bend, inner).length > 0) return true;
  return contains(at(from, to, bend, 0.5), inner);
}

// The last time the curve is really inside the box, then 6px further out
// along the curve, where an end normally stands.
function depart(from: Point, to: Point, bend: number, box: Rect) {
  const inner = inset(box, ENTER_INSET);
  const deep = crossings(from, to, bend, inner).filter((hit) => hit.out);
  const tDeep = deep.length ? deep[deep.length - 1]!.t : 0.5;
  const edge = crossings(from, to, bend, box).filter((hit) => hit.out && hit.t >= tDeep - 1e-3);
  const tLeave = edge.length ? edge[0]!.t : tDeep;
  const pad = crossings(from, to, bend, grow(box, END_OUT)).filter((hit) => hit.out && hit.t >= tLeave - 1e-3);
  return pad.length ? pad[0]!.t : tLeave;
}

// The first time the curve is really inside the box, stepped back to 6px
// outside, so the head meets the near edge.
function arrive(from: Point, to: Point, bend: number, box: Rect) {
  const inner = inset(box, ENTER_INSET);
  const deep = crossings(from, to, bend, inner).filter((hit) => !hit.out);
  if (!deep.length) return 1;
  const tDeep = deep[0]!.t;
  const edge = crossings(from, to, bend, box).filter((hit) => !hit.out && hit.t <= tDeep + 1e-3);
  const tHit = edge.length ? edge[edge.length - 1]!.t : tDeep;
  const pad = crossings(from, to, bend, grow(box, END_OUT)).filter((hit) => !hit.out && hit.t <= tHit + 1e-3);
  return pad.length ? pad[pad.length - 1]!.t : tHit;
}

export function at(from: Point, to: Point, bend: number, t: number): Point {
  if (!bend) return { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t };
  const control = arrowControl(from, to, bend);
  const rest = 1 - t;
  return {
    x: rest * rest * from.x + 2 * rest * t * control.x + t * t * to.x,
    y: rest * rest * from.y + 2 * rest * t * control.y + t * t * to.y,
  };
}

function deriv(from: Point, to: Point, bend: number, t: number): Point {
  if (!bend) return { x: to.x - from.x, y: to.y - from.y };
  const control = arrowControl(from, to, bend);
  const rest = 1 - t;
  return {
    x: 2 * rest * (control.x - from.x) + 2 * t * (to.x - control.x),
    y: 2 * rest * (control.y - from.y) + 2 * t * (to.y - control.y),
  };
}

function nearestT(from: Point, to: Point, bend: number, point: Point) {
  let bestT = 0;
  let best = Infinity;
  for (let index = 0; index <= 80; index += 1) {
    const t = index / 80;
    const sample = at(from, to, bend, t);
    const dist = Math.hypot(sample.x - point.x, sample.y - point.y);
    if (dist < best) {
      best = dist;
      bestT = t;
    }
  }
  let lo = Math.max(0, bestT - 1 / 80);
  let hi = Math.min(1, bestT + 1 / 80);
  for (let step = 0; step < 12; step += 1) {
    const left = lo + (hi - lo) / 3;
    const right = hi - (hi - lo) / 3;
    const leftPoint = at(from, to, bend, left);
    const rightPoint = at(from, to, bend, right);
    if (Math.hypot(leftPoint.x - point.x, leftPoint.y - point.y) < Math.hypot(rightPoint.x - point.x, rightPoint.y - point.y)) hi = right;
    else lo = left;
  }
  return (lo + hi) / 2;
}

function crossings(from: Point, to: Point, bend: number, rect: Rect): Hit[] {
  const control = bend ? arrowControl(from, to, bend) : { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
  const edges: { axis: "x" | "y"; value: number; min: number; max: number }[] = [
    { axis: "x", value: rect.x, min: rect.y, max: rect.y + rect.h },
    { axis: "x", value: rect.x + rect.w, min: rect.y, max: rect.y + rect.h },
    { axis: "y", value: rect.y, min: rect.x, max: rect.x + rect.w },
    { axis: "y", value: rect.y + rect.h, min: rect.x, max: rect.x + rect.w },
  ];
  const hits: Hit[] = [];
  for (const edge of edges) {
    const p0 = edge.axis === "x" ? from.x : from.y;
    const pc = edge.axis === "x" ? control.x : control.y;
    const p1 = edge.axis === "x" ? to.x : to.y;
    const coeff = coefficients(p0, pc, p1, edge.value);
    for (const t of roots(coeff.a, coeff.b, coeff.c)) {
      if (t <= 1e-4 || t >= 1 - 1e-4) continue;
      const point = at(from, to, bend, t);
      const other = edge.axis === "x" ? point.y : point.x;
      if (other < edge.min - 0.5 || other > edge.max + 0.5) continue;
      const out = leaving(from, to, bend, rect, t);
      if (out === undefined) continue;
      hits.push({ t, out });
    }
  }
  hits.sort((a, b) => a.t - b.t);
  const unique: Hit[] = [];
  for (const hit of hits) {
    const prev = unique[unique.length - 1];
    if (prev && Math.abs(prev.t - hit.t) < 1e-4) continue;
    unique.push(hit);
  }
  return unique;
}

// A step to either side of the boundary tells a real crossing from a graze,
// including one that only touches a corner.
function leaving(from: Point, to: Point, bend: number, rect: Rect, t: number) {
  const before = at(from, to, bend, Math.max(0, t - 2e-3));
  const after = at(from, to, bend, Math.min(1, t + 2e-3));
  const wasIn = contains(before, rect);
  const nowIn = contains(after, rect);
  if (wasIn && !nowIn) return true;
  if (!wasIn && nowIn) return false;
  return undefined;
}

function coefficients(p0: number, control: number, p1: number, value: number) {
  return { a: p0 - 2 * control + p1, b: 2 * (control - p0), c: p0 - value };
}

function roots(a: number, b: number, c: number) {
  if (Math.abs(a) < 1e-9) {
    if (Math.abs(b) < 1e-9) return [];
    return [-c / b];
  }
  const disc = b * b - 4 * a * c;
  if (disc < -1e-8) return [];
  if (disc <= 1e-8) return [-b / (2 * a)];
  const root = Math.sqrt(disc);
  return [(-b - root) / (2 * a), (-b + root) / (2 * a)];
}
