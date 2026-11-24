// A bend chosen so the curve misses other boxes keeps the ends that were
// placed for the written bend. When that curve aims back through its own
// end box, the stroke is cut to the edge. The written bend is unchanged,
// and the curve still misses the boxes it was moved to avoid.
import { describe, expect, it } from "vitest";
import { arrowControl, arrowMidpoint, labelSize, parseSketch, serializeSketch, type ArrowShape, type Point } from "@ttmi/format";
import { at } from "../src/clip";
import { layoutArrows } from "../src/present";

const SOURCE = `
withheld: box "Withheld ops observed" link "zcYSjs9PdZHR" at 40,40 size 260,125
boundaries: box "Boundaries served" link "rPxP9OYNcFdP" at 40,229 size 260,125
renewal: box "Access change on renewal" link "zevVPgdlszrz" at 40,418 size 260,125
pressure: box "Room pressure line\\nonce a minute" green tag "Counters" at 520,184 size 176,82
logs: box "Sampled log lines" green tag "Logs" at 520,330 size 166,70
check: note at 520,-48 width 420
withheld -> pressure seq 1 "ops by space"
boundaries -> pressure seq 2 "served, refused"
renewal -> logs seq 3 "change kind"
withheld -> logs "first per space" bend -270
boundaries -> logs "first serve"
renewal -> pressure "count changes" bend 240
check -> pressure
`;

type Box = { x: number; y: number; w: number; h: number; name?: string };

function inside(point: Point, box: Box, inset = 0) {
  return point.x > box.x + inset && point.x < box.x + box.w - inset && point.y > box.y + inset && point.y < box.y + box.h - inset;
}

function samples(from: Point, to: Point, bend: number, count = 80) {
  return Array.from({ length: count + 1 }, (_, index) => at(from, to, bend, index / count));
}

function paintedSamples(arrow: { from: Point; to: Point; bend?: number; control?: Point }, count = 80) {
  if (!arrow.control) return samples(arrow.from, arrow.to, arrow.bend ?? 0, count);
  const control = arrow.control;
  return Array.from({ length: count + 1 }, (_, index) => {
    const t = index / count;
    const rest = 1 - t;
    return {
      x: rest * rest * arrow.from.x + 2 * rest * t * control.x + t * t * arrow.to.x,
      y: rest * rest * arrow.from.y + 2 * rest * t * control.y + t * t * arrow.to.y,
    };
  });
}

// How far `point` is from the clearance curve. The painted stroke is a
// piece of that curve, so a cut does not invent a new path.
function offCurve(point: Point, from: Point, to: Point, bend: number) {
  const distAt = (t: number) => {
    const sample = at(from, to, bend, t);
    return Math.hypot(sample.x - point.x, sample.y - point.y);
  };
  let lo = 0;
  let hi = 1;
  for (let step = 0; step < 40; step += 1) {
    const left = lo + (hi - lo) / 3;
    const right = hi - (hi - lo) / 3;
    if (distAt(left) < distAt(right)) hi = right;
    else lo = left;
  }
  return distAt((lo + hi) / 2);
}

function outsideDistance(point: Point, box: Box) {
  const dx = Math.max(box.x - point.x, 0, point.x - (box.x + box.w));
  const dy = Math.max(box.y - point.y, 0, point.y - (box.y + box.h));
  return Math.hypot(dx, dy);
}

const overlaps = (a: Box, b: Box) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

describe("painted arrow ends", () => {
  const { shapes } = parseSketch(SOURCE);
  const boxes = shapes.filter((shape): shape is Box & { kind: "rect" | "note" } => shape.kind !== "arrow");
  const arrows = shapes.filter((shape): shape is ArrowShape => shape.kind === "arrow");
  const layout = layoutArrows(arrows, boxes);

  function arrowNamed(label: string) {
    return arrows.find((arrow) => arrow.label === label)!;
  }

  it("draws no stub above Withheld ops observed, and keeps bend -270", () => {
    const arrow = arrowNamed("first per space");
    expect(arrow.bend).toBe(-270);
    expect(serializeSketch(shapes).text).toContain('withheld -> logs "first per space" bend -270');

    const withheld = boxes.find((box) => box.name === "withheld")!;
    const logs = boxes.find((box) => box.name === "logs")!;
    const clearance = layout.bend(arrow);
    // The bend that misses the other boxes is not the written one, and
    // that curve does run through the source box: the stub.
    expect(clearance).not.toBe(-270);
    expect(samples(arrow.from, arrow.to, clearance).some((point) => inside(point, withheld, 1))).toBe(true);

    const drawn = layout.shown(arrow);
    const painted = paintedSamples(drawn);
    for (const point of painted) {
      expect(inside(point, withheld, 1), `(${point.x}, ${point.y})`).toBe(false);
      expect(inside(point, logs, 1)).toBe(false);
      expect(offCurve(point, arrow.from, arrow.to, clearance)).toBeLessThan(0.05);
    }
    // It leaves the source just outside the edge, heading away from the box.
    expect(outsideDistance(drawn.from, withheld)).toBeGreaterThan(5);
    expect(outsideDistance(drawn.from, withheld)).toBeLessThan(9);
    const step = stepAway(drawn);
    expect(inside(step, withheld)).toBe(false);
    expect(outsideDistance(step, withheld)).toBeGreaterThan(outsideDistance(drawn.from, withheld) - 0.5);

    // Still off every box that is not an end, which is what the bend was
    // changed to achieve.
    for (const box of boxes) {
      if (box === withheld || box === logs) continue;
      expect(painted.some((point) => inside(point, box, 0)), box.name).toBe(false);
    }

    const size = labelSize(arrow.label, arrow.seq);
    const label = layout.label(arrow);
    const labelRect = { x: label.x - size.w / 2, y: label.y - size.h / 2, w: size.w, h: size.h };
    for (const box of boxes) expect(overlaps(labelRect, box), box.name).toBe(false);
    // The handle sits on the stroke: the middle of the clearance curve.
    const handle = arrowMidpoint(arrow.from, arrow.to, clearance);
    expect(Math.min(...paintedSamples(drawn, 240).map((point) => Math.hypot(point.x - handle.x, point.y - handle.y)))).toBeLessThan(0.6);
  });

  it("cuts the renewal stub on count changes the same way", () => {
    const arrow = arrowNamed("count changes");
    expect(arrow.bend).toBe(240);
    const renewal = boxes.find((box) => box.name === "renewal")!;
    const pressure = boxes.find((box) => box.name === "pressure")!;
    const drawn = layout.shown(arrow);
    const painted = paintedSamples(drawn);
    expect(painted.some((point) => inside(point, renewal, 1))).toBe(false);
    expect(painted.some((point) => inside(point, pressure, 1))).toBe(false);
    expect(outsideDistance(drawn.from, renewal)).toBeGreaterThan(5);
    expect(outsideDistance(drawn.from, renewal)).toBeLessThan(9);
    for (const point of painted) expect(offCurve(point, arrow.from, arrow.to, layout.bend(arrow))).toBeLessThan(0.05);
  });

  it("leaves an arrow that already meets its boxes on the edge", () => {
    const arrow = arrowNamed("ops by space");
    const drawn = layout.shown(arrow);
    expect(drawn.from).toEqual(arrow.from);
    expect(drawn.to).toEqual(arrow.to);
    expect(drawn.bend).toBe(arrow.bend);
  });

  it("meets the near edge when a curve runs through its own target", () => {
    const target = { x: 200, y: 0, w: 80, h: 60 };
    const arrow: ArrowShape = { kind: "arrow", id: "through", from: { x: 0, y: 30 }, to: { x: 286, y: 30 }, color: "white" };
    const drawn = layoutArrows([arrow], [target]).shown(arrow);
    expect(drawn.to.x).toBeGreaterThan(190);
    expect(drawn.to.x).toBeLessThan(200);
    expect(Math.abs(drawn.to.y - 30)).toBeLessThan(1);
    expect(outsideDistance(drawn.to, target)).toBeGreaterThan(5);
    expect(outsideDistance(drawn.to, target)).toBeLessThan(7);
    for (const point of paintedSamples(drawn)) expect(inside(point, target, 1)).toBe(false);
    // The head points on, toward the box, not back along the line.
    const dir = direction(drawn, true);
    expect(dir.x).toBeGreaterThan(0);
  });

  it("cuts a strong bend whose stored end points back into the box", () => {
    const source = { x: 40, y: 40, w: 200, h: 100 };
    // On the top edge, 6px out. A downward bend sends the tangent back in.
    const arrow: ArrowShape = {
      kind: "arrow",
      id: "dive",
      from: { x: 160, y: 34 },
      to: { x: 420, y: 220 },
      bend: 40,
      color: "white",
      label: "down",
    };
    expect(samples(arrow.from, arrow.to, 40).some((point) => inside(point, source, 1))).toBe(true);
    // Held, so the bend is not swapped for one that misses: the cut has to
    // do the work on the curve as it stands.
    const layout = layoutArrows([arrow], [source, { x: 360, y: 180, w: 80, h: 60 }], { pin: { id: "dive", bend: 40 } });
    const drawn = layout.shown(arrow);
    expect(drawn.control).toBeDefined();
    expect(drawn.bend).toBe(40);
    for (const point of paintedSamples(drawn)) {
      expect(inside(point, source, 1)).toBe(false);
      expect(offCurve(point, arrow.from, arrow.to, layout.bend(arrow))).toBeLessThan(0.05);
    }
    expect(outsideDistance(drawn.from, source)).toBeGreaterThan(5);
    expect(outsideDistance(drawn.from, source)).toBeLessThan(9);
    // What was written is the arrow's own bend; painting does not replace it.
    expect(arrow.bend).toBe(40);
  });

  it("keeps the agentic step-7 curve off the planner", () => {
    const source = [
      "human: box \"You\" at 40,242 size 146,82",
      "planner: box \"Planner agent\" at 659,40 size 143,70",
      "issues: box \"Issues\" at 1111,389 size 189,82",
      "reviewer: box \"Reviewer agent\" at 659,174 size 201,82",
      "github: box \"GitHub\" at 659,320 size 173,82",
      "issues -> human seq 7 \"only what needs you\" bend 240",
    ].join("\n");
    const parsed = parseSketch(source);
    const flow = parsed.shapes.filter((shape): shape is ArrowShape => shape.kind === "arrow");
    const rects = parsed.shapes.filter((shape) => shape.kind !== "arrow");
    const placed = layoutArrows(flow, rects);
    const arrow = flow[0]!;
    const drawn = placed.shown(arrow);
    const planner = rects.find((shape) => shape.name === "planner")!;
    expect(paintedSamples(drawn).some((point) => inside(point, planner))).toBe(false);
    expect(serializeSketch(parsed.shapes).text).toContain("bend 240");
    const size = labelSize(arrow.label, arrow.seq);
    const label = placed.label(arrow);
    expect(overlaps({ x: label.x - size.w / 2, y: label.y - size.h / 2, w: size.w, h: size.h }, planner)).toBe(false);
  });
});

function direction(arrow: { from: Point; to: Point; bend?: number; control?: Point }, atEnd: boolean) {
  const control = arrow.control ?? (arrow.bend ? arrowControl(arrow.from, arrow.to, arrow.bend) : undefined);
  if (!control) {
    const dx = arrow.to.x - arrow.from.x;
    const dy = arrow.to.y - arrow.from.y;
    const length = Math.hypot(dx, dy) || 1;
    return { x: dx / length, y: dy / length };
  }
  const anchor = atEnd ? arrow.to : arrow.from;
  const dx = atEnd ? anchor.x - control.x : control.x - anchor.x;
  const dy = atEnd ? anchor.y - control.y : control.y - anchor.y;
  const length = Math.hypot(dx, dy) || 1;
  return { x: dx / length, y: dy / length };
}

function stepAway(arrow: { from: Point; to: Point; bend?: number; control?: Point }) {
  const dir = direction(arrow, false);
  return { x: arrow.from.x + dir.x * 4, y: arrow.from.y + dir.y * 4 };
}
