import type { Rect } from "./drafts";
import type { BoxShape, Point, Shape } from "./types";

export function isBoxShape(shape: Shape): shape is BoxShape {
  return shape.kind !== "arrow";
}

// The box an arrow end is on or near, if any: topmost first.
export function nearBox<T extends { x: number; y: number; w: number; h: number }>(boxes: T[], point: Point) {
  for (let index = boxes.length - 1; index >= 0; index -= 1) {
    const box = boxes[index]!;
    if (point.x >= box.x - 24 && point.x <= box.x + box.w + 24 && point.y >= box.y - 24 && point.y <= box.y + box.h + 24) return box;
  }
  return undefined;
}

export const center = (box: Rect) => ({ x: box.x + box.w / 2, y: box.y + box.h / 2 });

// Where the line from a box's centre toward a point leaves the box, 6 px
// out. A box with a tag: where that line would leave under the tag's pill,
// it leaves the pill instead, so the arrow's end is never hidden by it
// (docs/format.md, Arrows).
export function edge(box: Rect, toward: Point) {
  const c = center(box);
  const dx = toward.x - c.x;
  const dy = toward.y - c.y;
  if (dx === 0 && dy === 0) return c;
  const t = Math.min(dx ? (box.w / 2 + 6) / Math.abs(dx) : Infinity, dy ? (box.h / 2 + 6) / Math.abs(dy) : Infinity);
  const point = { x: c.x + dx * t, y: c.y + dy * t };
  const tag = box.pill;
  if (tag && point.x >= tag.x - 6 && point.x <= tag.x + tag.w + 6 && point.y >= tag.y - 6 && point.y <= tag.y + tag.h + 6) {
    // Out of the pill, 6 px padded, along the same line: through its top
    // or the side the line heads for, whichever comes first.
    const exits = [
      dy ? (tag.y - 6 - c.y) / dy : Infinity,
      dx ? ((dx > 0 ? tag.x + tag.w + 6 : tag.x - 6) - c.x) / dx : Infinity,
    ].filter((value) => value > t);
    const out = Math.min(...exits);
    if (Number.isFinite(out)) return { x: Math.round(c.x + dx * out), y: Math.round(c.y + dy * out) };
  }
  return { x: Math.round(point.x), y: Math.round(point.y) };
}
