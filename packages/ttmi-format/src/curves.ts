// --- Arrow curves ---------------------------------------------------------------
import type { Point } from "./types";

// An arrow with a bend is a curve whose middle sits bend pixels to the side
// of the straight line (to the left looking from start to end).
export function arrowControl(a: Point, b: Point, bend: number): Point {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy) || 1;
  return { x: (a.x + b.x) / 2 + (-dy / length) * bend * 2, y: (a.y + b.y) / 2 + (dx / length) * bend * 2 };
}

export function arrowMidpoint(a: Point, b: Point, bend = 0): Point {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy) || 1;
  return { x: (a.x + b.x) / 2 + (-dy / length) * bend, y: (a.y + b.y) / 2 + (dx / length) * bend };
}

// The bend that puts an arrow's middle at a point.
export function bendThrough(a: Point, b: Point, point: Point) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy) || 1;
  return Math.round((point.x - (a.x + b.x) / 2) * (-dy / length) + (point.y - (a.y + b.y) / 2) * (dx / length));
}
