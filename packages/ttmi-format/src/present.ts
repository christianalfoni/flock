// How a bend and a label are drawn. The sketch keeps the bend that was
// written; this only chooses the curve and the label position the board
// paints, from the geometry on screen (docs/concept.md, lesson 14).
// A drag recomputes it from scratch, so the same positions always give the
// same picture and a small move cannot flicker between two answers.
import { arrowControl, arrowMidpoint } from "./curves";
import type { Point } from "./types";

export type Rect = { x: number; y: number; w: number; h: number };

// One arrow to place. `holdBend` draws `bend` exactly: the bend handle is
// under the pointer, and adjusting it there would fight the drag.
export type EdgeInput = {
  id: string;
  from: Point;
  to: Point;
  bend?: number;
  holdBend?: boolean;
  label?: { w: number; h: number };
};

// `bend` is the curve to draw. `label` is the centre of the label, on that
// curve. With no label, `label` is the curve's middle.
export type PlacedEdge = { bend: number; label: Point };

// How far past a box an arrow end still counts as attached to it: the same
// reach the board uses to decide which box an end is on.
const END_REACH = 24;
// The stroke is 2px. A curve that merely passes this close still counts as
// running through the box, so the drawn line clears it.
const CURVE_PAD = 2;
// Labels keep this much ground between them and a box or another label.
const LABEL_GAP = 4;
// Samples along a curve. Dense enough that a label cannot hide a closer
// clear spot between two of them, cheap enough for a board of dozens of boxes.
const LABEL_STEPS = 64;
const CURVE_STEPS = 32;
// Bend search. Step outward from the author's bend; the first clear sample
// on each side is refined to the boundary, so a box moving one pixel moves
// the curve by about one pixel.
const BEND_STEP = 8;

// Places every arrow. Earlier arrows keep a label spot; later ones avoid it.
// Bends do not depend on other arrows, only on boxes that are not an end.
export function placeEdges(arrows: readonly EdgeInput[], boxes: readonly Rect[]): Map<string, PlacedEdge> {
  const placed = new Map<string, PlacedEdge>();
  const bends = arrows.map((arrow) => chooseBend(arrow, boxes));
  const labels: Rect[] = [];
  arrows.forEach((arrow, index) => {
    const bend = bends[index]!;
    const label = arrow.label
      ? placeLabel(arrow.from, arrow.to, bend, arrow.label, boxes, labels)
      : arrowMidpoint(arrow.from, arrow.to, bend);
    if (arrow.label) labels.push(rectAt(label, arrow.label));
    placed.set(arrow.id, { bend, label });
  });
  return placed;
}

function chooseBend(arrow: EdgeInput, boxes: readonly Rect[]): number {
  const author = arrow.bend ?? 0;
  if (arrow.holdBend || author === 0) return author;
  const fromBox = endpointBox(arrow.from, boxes);
  const toBox = endpointBox(arrow.to, boxes);
  const obstacles = boxes.filter((box) => box !== fromBox && box !== toBox);
  if (obstacles.length === 0) return author;
  const hits = (bend: number) => curveHits(arrow.from, arrow.to, bend, obstacles);
  if (!hits(author)) return author;

  const span = Math.max(Math.abs(author) * 2, 160);
  const side = (sign: number) => {
    for (let distance = BEND_STEP; distance <= span + 1e-6; distance += BEND_STEP) {
      const bend = author + sign * distance;
      if (!hits(bend)) return bend;
    }
    return undefined;
  };
  const lower = side(-1);
  const upper = side(1);
  const found = pickBend(author, lower, upper);
  if (found === undefined) return leastBend(arrow.from, arrow.to, author, obstacles, span);
  return refineBend(author, found, hits);
}

// The closer clear sample. The same distance keeps the smaller curve, which
// is the one toward straight when the two sides mirror each other.
function pickBend(author: number, lower: number | undefined, upper: number | undefined) {
  if (lower === undefined) return upper;
  if (upper === undefined) return lower;
  const down = Math.abs(lower - author);
  const up = Math.abs(upper - author);
  if (Math.abs(down - up) > 1e-6) return down < up ? lower : upper;
  return Math.abs(lower) <= Math.abs(upper) ? lower : upper;
}

// `found` is clear and one step toward the author is not, so the boundary
// between them is the clearing bend closest to what was written.
function refineBend(author: number, found: number, hits: (bend: number) => boolean) {
  let blocked = found + Math.sign(author - found) * BEND_STEP;
  let clear = found;
  if (!hits(blocked)) return clear;
  for (let step = 0; step < 12; step += 1) {
    const mid = (blocked + clear) / 2;
    if (hits(mid)) blocked = mid;
    else clear = mid;
  }
  return clear;
}

// Nothing in reach clears. The bend that runs through the fewest boxes,
// and among those the one closest to the author's.
function leastBend(from: Point, to: Point, author: number, obstacles: readonly Rect[], span: number) {
  let bestBend = author;
  let bestCount = boxesHit(from, to, author, obstacles);
  let bestDelta = 0;
  for (let distance = BEND_STEP; distance <= span + 1e-6; distance += BEND_STEP) {
    for (const bend of [author - distance, author + distance]) {
      const count = boxesHit(from, to, bend, obstacles);
      const delta = Math.abs(bend - author);
      if (count < bestCount || (count === bestCount && delta < bestDelta)) {
        bestBend = bend;
        bestCount = count;
        bestDelta = delta;
      }
    }
  }
  return bestBend;
}

// The centre closest to the middle of the curve whose label covers nothing.
// When every spot covers something, the one that covers the least, still as
// close to the middle as that allows.
function placeLabel(from: Point, to: Point, bend: number, size: { w: number; h: number }, boxes: readonly Rect[], labels: readonly Rect[]): Point {
  const obstacles = [...boxes.map((box) => grow(box, LABEL_GAP)), ...labels.map((label) => grow(label, LABEL_GAP))];
  const costAt = (t: number) => {
    const rect = rectAt(pointOnCurve(from, to, bend, t), size);
    let cost = 0;
    for (const obstacle of obstacles) cost += overlapArea(rect, obstacle);
    return cost;
  };
  if (costAt(0.5) === 0) return arrowMidpoint(from, to, bend);

  let clearT: number | undefined;
  let clearDist = Infinity;
  for (let index = 0; index <= LABEL_STEPS; index += 1) {
    const t = index / LABEL_STEPS;
    const dist = Math.abs(t - 0.5);
    if (dist >= clearDist) continue;
    if (costAt(t) === 0) {
      clearT = t;
      clearDist = dist;
    }
  }
  if (clearT !== undefined) return pointOnCurve(from, to, bend, approachMiddle(clearT, costAt));

  let bestT = 0.5;
  let bestCost = costAt(0.5);
  let bestDist = 0;
  for (let index = 0; index <= LABEL_STEPS; index += 1) {
    const t = index / LABEL_STEPS;
    const cost = costAt(t);
    const dist = Math.abs(t - 0.5);
    if (cost < bestCost - 0.01 || (cost <= bestCost + 0.01 && dist < bestDist)) {
      bestT = t;
      bestCost = cost;
      bestDist = dist;
    }
  }
  // The least-covered sample, then the better of its two neighbours, so a
  // spot between samples is not missed by a full label-width.
  const step = 1 / LABEL_STEPS;
  let refined = bestT;
  let refinedCost = bestCost;
  for (let cut = 1; cut < 8; cut += 1) {
    for (const t of [bestT - step * cut / 8, bestT + step * cut / 8]) {
      if (t < 0 || t > 1) continue;
      const cost = costAt(t);
      const dist = Math.abs(t - 0.5);
      if (cost < refinedCost - 0.01 || (cost <= refinedCost + 0.01 && dist < Math.abs(refined - 0.5))) {
        refined = t;
        refinedCost = cost;
      }
    }
  }
  return pointOnCurve(from, to, bend, refined);
}

// `clearT` covers nothing and the next sample toward the middle does not.
// Sit on the boundary, which is the clear point closest to the middle.
function approachMiddle(clearT: number, costAt: (t: number) => number) {
  const toward = clearT + Math.sign(0.5 - clearT) / LABEL_STEPS;
  if (toward <= 0 || toward >= 1 || costAt(toward) === 0) return clearT;
  let clear = clearT;
  let blocked = toward;
  for (let step = 0; step < 14; step += 1) {
    const mid = (clear + blocked) / 2;
    if (costAt(mid) === 0) clear = mid;
    else blocked = mid;
  }
  return clear;
}

function curveHits(from: Point, to: Point, bend: number, obstacles: readonly Rect[]) {
  return boxesHit(from, to, bend, obstacles) > 0;
}

function boxesHit(from: Point, to: Point, bend: number, obstacles: readonly Rect[]) {
  if (obstacles.length === 0) return 0;
  const points = curveSamples(from, to, bend, CURVE_STEPS);
  let count = 0;
  for (const box of obstacles) {
    const rect = grow(box, CURVE_PAD);
    for (let index = 0; index < points.length - 1; index += 1) {
      if (segmentHitsRect(points[index]!, points[index + 1]!, rect)) {
        count += 1;
        break;
      }
    }
  }
  return count;
}

function curveSamples(from: Point, to: Point, bend: number, steps: number) {
  return Array.from({ length: steps + 1 }, (_, index) => pointOnCurve(from, to, bend, index / steps));
}

function pointOnCurve(from: Point, to: Point, bend: number, t: number): Point {
  if (!bend) return { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t };
  const control = arrowControl(from, to, bend);
  const rest = 1 - t;
  return {
    x: rest * rest * from.x + 2 * rest * t * control.x + t * t * to.x,
    y: rest * rest * from.y + 2 * rest * t * control.y + t * t * to.y,
  };
}

// The box an end is attached to, the nearest one within END_REACH. Arrow
// ends sit just outside the box they leave, so a square pad matches the
// test the board already uses for "which box is this end on".
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

function grow(box: Rect, pad: number): Rect {
  return { x: box.x - pad, y: box.y - pad, w: box.w + pad * 2, h: box.h + pad * 2 };
}

function rectAt(center: Point, size: { w: number; h: number }): Rect {
  return { x: center.x - size.w / 2, y: center.y - size.h / 2, w: size.w, h: size.h };
}

function overlapArea(a: Rect, b: Rect) {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

// Liang–Barsky. A segment that only touches the border does not count: the
// pad around the box is what makes a near miss count.
function segmentHitsRect(a: Point, b: Point, rect: Rect) {
  const minX = rect.x;
  const maxX = rect.x + rect.w;
  const minY = rect.y;
  const maxY = rect.y + rect.h;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const p = [-dx, dx, -dy, dy];
  const q = [a.x - minX, maxX - a.x, a.y - minY, maxY - a.y];
  let t0 = 0;
  let t1 = 1;
  for (let edge = 0; edge < 4; edge += 1) {
    const pe = p[edge]!;
    const qe = q[edge]!;
    if (pe === 0) {
      if (qe < 0) return false;
      continue;
    }
    const t = qe / pe;
    if (pe < 0) {
      if (t > t1) return false;
      if (t > t0) t0 = t;
    } else {
      if (t < t0) return false;
      if (t < t1) t1 = t;
    }
  }
  return t0 < t1;
}
