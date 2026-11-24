// The board draws a bend and a label from the geometry, without writing
// either back. A label that would cover a box or another label slides
// along its curve; a bend whose curve runs through some other box is
// drawn a little differently so it misses.
import { describe, expect, it } from "vitest";
import { arrowControl, arrowMidpoint, labelSize, parseSketch, placeEdges, serializeSketch, type ArrowShape, type EdgeInput, type Point } from "../src/index";

type Rect = { x: number; y: number; w: number; h: number };

const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

function labelRect(center: Point, size: { w: number; h: number }): Rect {
  return { x: center.x - size.w / 2, y: center.y - size.h / 2, w: size.w, h: size.h };
}

function pointAt(from: Point, to: Point, bend: number, t: number): Point {
  if (!bend) return { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t };
  const control = arrowControl(from, to, bend);
  const rest = 1 - t;
  return {
    x: rest * rest * from.x + 2 * rest * t * control.x + t * t * to.x,
    y: rest * rest * from.y + 2 * rest * t * control.y + t * t * to.y,
  };
}

function inside(point: Point, box: Rect) {
  return point.x > box.x && point.x < box.x + box.w && point.y > box.y && point.y < box.y + box.h;
}

// Curve samples, the ends left off: an end sits on its own box.
function through(from: Point, to: Point, bend: number, box: Rect) {
  return Array.from({ length: 79 }, (_, index) => pointAt(from, to, bend, (index + 1) / 80)).some((point) => inside(point, box));
}

function edge(id: string, from: Point, to: Point, bend?: number, label?: { w: number; h: number }, holdBend?: boolean): EdgeInput {
  return { id, from, to, ...(bend ? { bend } : {}), ...(label ? { label } : {}), ...(holdBend ? { holdBend } : {}) };
}

const box = (x: number, y: number, w: number, h: number): Rect => ({ x, y, w, h });

describe("placeEdges", () => {
  it("keeps a bend that already misses every box, and the label at its middle", () => {
    const from = { x: 40, y: 20 };
    const to = { x: 200, y: 20 };
    const arrow = edge("a", from, to, 80, { w: 40, h: 16 });
    const placed = placeEdges([arrow], [box(0, 0, 40, 40), box(200, 0, 40, 40)]);
    expect(placed.get("a")!.bend).toBe(80);
    expect(placed.get("a")!.label).toEqual(arrowMidpoint(from, to, 80));
  });

  it("draws a smaller bend when the written one runs through another box", () => {
    // Positive bend is to the left of the arrow, which is downward on a
    // left-to-right line. A bend of 80 drops the middle into the box below;
    // straight, and a modest bend, pass above it.
    const from = { x: 0, y: 100 };
    const to = { x: 400, y: 100 };
    const obstacle = box(150, 140, 100, 280);
    const arrow = edge("a", from, to, 80);
    expect(through(from, to, 80, obstacle)).toBe(true);
    const placed = placeEdges([arrow], [obstacle]);
    expect(placed.get("a")!.bend).toBeGreaterThan(0);
    expect(placed.get("a")!.bend).toBeLessThan(80);
    expect(through(from, to, placed.get("a")!.bend, obstacle)).toBe(false);
    // The other way also misses, and is farther from the bend that was written.
    expect(Math.abs(placed.get("a")!.bend - 80)).toBeLessThan(80);
  });

  it("flips the bend when the written side cannot miss the box", () => {
    // The box covers the straight line and the whole downward side. Only
    // an upward bend gets the middle out.
    const from = { x: 0, y: 100 };
    const to = { x: 400, y: 100 };
    const obstacle = box(120, 70, 160, 140);
    const arrow = edge("a", from, to, 30);
    expect(through(from, to, 30, obstacle)).toBe(true);
    expect(through(from, to, 0, obstacle)).toBe(true);
    const placed = placeEdges([arrow], [obstacle]);
    expect(placed.get("a")!.bend).toBeLessThan(0);
    expect(through(from, to, placed.get("a")!.bend, obstacle)).toBe(false);
    expect(Math.abs(placed.get("a")!.bend - 30)).toBeLessThan(Math.abs(-200 - 30));
  });

  it("leaves a straight arrow straight when it crosses a box", () => {
    const from = { x: 0, y: 50 };
    const to = { x: 300, y: 50 };
    const obstacle = box(120, 20, 60, 60);
    const placed = placeEdges([edge("a", from, to, undefined, { w: 30, h: 16 })], [obstacle]);
    expect(placed.get("a")!.bend).toBe(0);
    expect(overlaps(labelRect(placed.get("a")!.label, { w: 30, h: 16 }), obstacle)).toBe(false);
  });

  it("holds the bend under the pointer even when that curve crosses a box", () => {
    const from = { x: 0, y: 100 };
    const to = { x: 400, y: 100 };
    const obstacle = box(150, 20, 100, 55);
    const placed = placeEdges([edge("a", from, to, 80, { w: 40, h: 16 }, true)], [obstacle]);
    expect(placed.get("a")!.bend).toBe(80);
    expect(overlaps(labelRect(placed.get("a")!.label, { w: 40, h: 16 }), obstacle)).toBe(false);
  });

  it("slides a label along the curve to the nearest spot that misses a box", () => {
    const from = { x: 0, y: 0 };
    const to = { x: 400, y: 0 };
    const size = { w: 80, h: 20 };
    const obstacle = box(170, -30, 60, 60);
    const arrow = edge("a", from, to, undefined, size);
    const placed = placeEdges([arrow], [obstacle]);
    const label = labelRect(placed.get("a")!.label, size);
    expect(overlaps(label, obstacle)).toBe(false);
    const middle = arrowMidpoint(from, to, 0);
    expect(overlaps(labelRect(middle, size), obstacle)).toBe(true);
    // No clear sample sits closer to the middle than the one that was chosen.
    const chosen = Math.hypot(placed.get("a")!.label.x - middle.x, placed.get("a")!.label.y - middle.y);
    for (let index = 0; index <= 64; index += 1) {
      const point = pointAt(from, to, 0, index / 64);
      const distance = Math.hypot(point.x - middle.x, point.y - middle.y);
      if (distance + 1 < chosen) expect(overlaps(labelRect(point, size), obstacle)).toBe(true);
    }
  });

  it("keeps the earlier label and slides the later one off it", () => {
    const size = { w: 60, h: 20 };
    const first = edge("a", { x: 0, y: 0 }, { x: 200, y: 0 }, undefined, size);
    const second = edge("b", { x: 0, y: 10 }, { x: 200, y: 10 }, undefined, size);
    const placed = placeEdges([first, second], []);
    expect(placed.get("a")!.label).toEqual(arrowMidpoint(first.from, first.to, 0));
    const a = labelRect(placed.get("a")!.label, size);
    const b = labelRect(placed.get("b")!.label, size);
    expect(overlaps(a, b)).toBe(false);
    const middle = arrowMidpoint(second.from, second.to, 0);
    expect(overlaps(labelRect(middle, size), a)).toBe(true);
  });

  it("uses the least-covered spot when the whole curve runs over a box", () => {
    const from = { x: 0, y: 0 };
    const to = { x: 300, y: 0 };
    const size = { w: 40, h: 20 };
    // Covers the middle completely and lets the label hang off the far end.
    const obstacle = box(-100, -200, 280, 400);
    const placed = placeEdges([edge("a", from, to, undefined, size)], [obstacle]);
    const chosen = labelRect(placed.get("a")!.label, size);
    const middle = labelRect(arrowMidpoint(from, to, 0), size);
    const area = (rect: Rect) => {
      const w = Math.min(rect.x + rect.w, obstacle.x + obstacle.w) - Math.max(rect.x, obstacle.x);
      const h = Math.min(rect.y + rect.h, obstacle.y + obstacle.h) - Math.max(rect.y, obstacle.y);
      return w > 0 && h > 0 ? w * h : 0;
    };
    expect(area(chosen)).toBeLessThan(area(middle));
  });

  it("moves the label a short way when the box moves one pixel", () => {
    const from = { x: 0, y: 0 };
    const to = { x: 400, y: 0 };
    const size = { w: 40, h: 20 };
    const at = (x: number) => placeEdges([edge("a", from, to, undefined, size)], [box(x, -20, 40, 40)]).get("a")!.label;
    const first = at(180);
    const second = at(181);
    expect(Math.hypot(second.x - first.x, second.y - first.y)).toBeLessThan(3);
    expect(Math.hypot(second.x - first.x, second.y - first.y)).toBeGreaterThan(0);
  });

  it("is the same picture for the same geometry", () => {
    const arrows = [edge("a", { x: 0, y: 0 }, { x: 200, y: 40 }, 40, { w: 50, h: 18 })];
    const boxes = [box(80, -10, 40, 40)];
    expect([...placeEdges(arrows, boxes)]).toEqual([...placeEdges(arrows, boxes)]);
  });

  it("does not cover the planner on the agentic work flow's step 7", () => {
    // issues -> human "only what needs you" bend 240, with the boxes where
    // that sketch saved them. The bend lifts the middle into the planner.
    const source = [
      "human: box \"You\" at 40,242 size 146,82",
      "planner: box \"Planner agent\" at 659,40 size 143,70",
      "issues: box \"Issues\" at 1111,389 size 189,82",
      "reviewer: box \"Reviewer agent\" at 659,174 size 201,82",
      "github: box \"GitHub\" at 659,320 size 173,82",
      "issues -> human seq 7 \"only what needs you\" bend 240",
    ].join("\n");
    const { shapes } = parseSketch(source);
    const arrow = shapes.find((shape): shape is ArrowShape => shape.kind === "arrow")!;
    expect(arrow.bend).toBe(240);
    const boxes = shapes.filter((shape) => shape.kind !== "arrow") as { name?: string; x: number; y: number; w: number; h: number }[];
    const planner = boxes.find((shape) => shape.name === "planner")!;
    const size = labelSize(arrow.label, arrow.seq);
    const middle = arrowMidpoint(arrow.from, arrow.to, arrow.bend);
    expect(overlaps(labelRect(middle, size), planner)).toBe(true);

    const placed = placeEdges([{
      id: arrow.id,
      from: arrow.from,
      to: arrow.to,
      bend: arrow.bend,
      label: size,
    }], boxes);
    const drawn = placed.get(arrow.id)!;
    expect(overlaps(labelRect(drawn.label, size), planner)).toBe(false);
    for (const shape of boxes) {
      if (shape.name === "issues" || shape.name === "human") continue;
      expect(through(arrow.from, arrow.to, drawn.bend, shape), shape.name).toBe(false);
    }
    // What was written is unchanged: a save still says bend 240.
    expect(arrow.bend).toBe(240);
    expect(serializeSketch(shapes).text).toContain('issues -> human seq 7 "only what needs you" bend 240');
    // And the drawn bend stays near that one.
    expect(Math.abs(drawn.bend - 240)).toBeLessThan(240);
  });
});
