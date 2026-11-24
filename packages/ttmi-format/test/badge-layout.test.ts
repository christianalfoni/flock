// A badge is part of a node's size, measured before layout, so positions,
// arrows and labels are chosen for the box the reader actually sees.
// A folding note's arrows land on its badge, folded or open.
import { describe, expect, it } from "vitest";
import { arrowControl, arrowMidpoint, boxSize, CANVAS_MARK, EXTERNAL_BADGE, labelSize, parseSketch, refitSketch, TAG_LEFT, tagSize, widthForBadge, type ArrowShape, type BoxShape, type Point, type Shape, type SketchMeasure } from "../src/index";
import { boxesByName } from "./helpers";

const TITLE = "Policy description runs: where do they live?";

const BETWEEN = [
  'src: box "Source"',
  'policy: box "Policy" link "runs"',
  'home: box "Home"',
  'namespace: box "Namespace"',
  'track: box "Track"',
  'src -> policy "into" seq 1',
  'policy -> home "pin one home" seq 3',
  'policy -> namespace "follow the namespace" seq 5',
  'policy -> track "don\'t track it" seq 7',
].join("\n");

function fittedCanvas() {
  return Math.max(boxSize("Policy").w, widthForBadge(tagSize(TITLE).w + CANVAS_MARK));
}

function samples(arrow: ArrowShape): Point[] {
  const bend = arrow.bend ?? 0;
  const control = bend ? arrowControl(arrow.from, arrow.to, bend) : undefined;
  return Array.from({ length: 25 }, (_, index) => {
    const t = index / 24;
    if (!control) return { x: arrow.from.x + (arrow.to.x - arrow.from.x) * t, y: arrow.from.y + (arrow.to.y - arrow.from.y) * t };
    return {
      x: (1 - t) * (1 - t) * arrow.from.x + 2 * (1 - t) * t * control.x + t * t * arrow.to.x,
      y: (1 - t) * (1 - t) * arrow.from.y + 2 * (1 - t) * t * control.y + t * t * arrow.to.y,
    };
  });
}

function inside(point: Point, box: { x: number; y: number; w: number; h: number }) {
  return point.x > box.x + 0.5 && point.x < box.x + box.w - 0.5 && point.y > box.y + 0.5 && point.y < box.y + box.h - 0.5;
}

function overlaps(a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

function labelBox(arrow: ArrowShape) {
  const size = labelSize(arrow.label, arrow.seq);
  const middle = arrowMidpoint(arrow.from, arrow.to, arrow.bend);
  return { x: middle.x - size.w / 2, y: middle.y - size.h / 2, w: size.w, h: size.h };
}

// Distance to the rectangle's border: 0 on it, positive outside.
function borderDistance(point: Point, box: { x: number; y: number; w: number; h: number }) {
  const dx = Math.max(box.x - point.x, 0, point.x - (box.x + box.w));
  const dy = Math.max(box.y - point.y, 0, point.y - (box.y + box.h));
  if (dx === 0 && dy === 0) return -Math.min(point.x - box.x, box.x + box.w - point.x, point.y - box.y, box.y + box.h - point.y);
  return Math.hypot(dx, dy);
}

describe("a badge is measured before layout", () => {
  it("places neighbours and arrows for the final width of a long canvas badge", () => {
    const expected = fittedCanvas();
    const { shapes } = parseSketch(BETWEEN, undefined, [], { canvasTitles: { runs: TITLE } });
    const boxes = boxesByName(shapes);
    const policy = boxes.get("policy")!;
    // The width layout used is the badge's width. Nothing grows it after.
    expect(policy.w).toBe(expected);
    expect(policy.h).toBe(boxSize("Policy").h);
    expect(boxes.get("src")!.x + boxes.get("src")!.w).toBeLessThanOrEqual(policy.x);
    for (const name of ["home", "namespace", "track"]) {
      expect(boxes.get(name)!.x).toBeGreaterThanOrEqual(policy.x + policy.w);
    }
    const nodes = [...boxes.values()];
    for (const arrow of shapes.filter((shape): shape is ArrowShape => shape.kind === "arrow")) {
      const onPolicy = arrow.label === "into" ? arrow.to : arrow.from;
      const pill = tagSize(TITLE);
      const badge = { x: policy.x + TAG_LEFT, y: policy.y - pill.h / 2, w: pill.w + CANVAS_MARK, h: pill.h };
      // On the final box, or on the badge that hangs off its top edge.
      // An end routed for the old narrow box would sit inside this one.
      const outside = (distance: number) => (distance < -1 ? 1000 : distance);
      const distance = Math.min(outside(borderDistance(onPolicy, policy)), outside(borderDistance(onPolicy, badge)));
      expect(distance, arrow.label).toBeLessThanOrEqual(10);
      for (const box of nodes) {
        expect(samples(arrow).slice(1, -1).some((point) => inside(point, box)), arrow.label).toBe(false);
        expect(overlaps(labelBox(arrow), box), arrow.label).toBe(false);
      }
    }
    for (let i = 0; i < nodes.length; i += 1) {
      for (let j = i + 1; j < nodes.length; j += 1) expect(overlaps(nodes[i]!, nodes[j]!)).toBe(false);
    }
  });

  it("lays the drawing out again when the canvas name arrives, and then stops", () => {
    const first = parseSketch(BETWEEN);
    expect(boxesByName(first.shapes).get("policy")!.w).toBeLessThan(fittedCanvas());
    const fitted = refitSketch(first.shapes, first.steps, first.groups, first.terms, undefined, { runs: TITLE });
    expect(fitted).toBeDefined();
    const policy = boxesByName(fitted!).get("policy")!;
    expect(policy.w).toBe(fittedCanvas());
    expect(boxesByName(fitted!).get("home")!.x).toBeGreaterThanOrEqual(policy.x + policy.w);
    expect(refitSketch(fitted!, first.steps, first.groups, first.terms, undefined, { runs: TITLE })).toBeUndefined();
  });

  it("counts an external arrow badge in the same measurement", () => {
    const { shapes } = parseSketch('a: box "A" link "https://github.com/acme/app/pull/1" size 30,40');
    const box = boxesByName(shapes).get("a")!;
    expect(box.w).toBe(widthForBadge(EXTERNAL_BADGE));
    expect(box.h).toBe(40);
    expect(box.w).toBeGreaterThan(30);
  });
});

describe("an arrow into a note lands on the note's badge", () => {
  const measure: SketchMeasure = {
    box: () => ({ w: 140, h: 70 }),
    note: () => 400,
    noteWidth: () => 700,
    noteFolded: (html) => (html.includes("<h2>") ? { w: 160, h: 28 } : undefined),
  };
  const source = ['a: box "A"', "n: note", "  ## The run", "  Where it lives.", 'a -> n "see"'].join("\n");

  function endOn(shapes: Shape[]) {
    const note = boxesByName(shapes).get("n") as BoxShape;
    const arrow = shapes.find((shape): shape is ArrowShape => shape.kind === "arrow" && shape.label === "see")!;
    return { note, arrow };
  }

  it("uses the badge for both the folded note and the open panel", () => {
    const folded = parseSketch(source, measure);
    const { note, arrow } = endOn(folded.shapes);
    const badge = { x: note.x, y: note.y, w: note.w, h: note.h };
    expect(badge).toMatchObject({ w: 160, h: 28 });
    // 6 px outside the badge, not on the tall open panel.
    expect(borderDistance(arrow.to, badge)).toBeLessThanOrEqual(8);
    expect(arrow.to.y).toBeGreaterThan(badge.y - 8);
    expect(arrow.to.y).toBeLessThan(badge.y + badge.h + 8);
    const open = { x: note.x - 11.5, y: note.y + 9.5, w: 700, h: 400 };
    expect(arrow.to.y).toBeLessThan(open.y + open.h / 2);
    // Opening is only a view. Laying out again, as a fresh measure would,
    // keeps the end on the same badge.
    const again = parseSketch(source, measure, folded.shapes);
    const next = endOn(again.shapes);
    expect(next.note.w).toBe(badge.w);
    expect(next.note.h).toBe(badge.h);
    expect(borderDistance(next.arrow.to, { x: next.note.x, y: next.note.y, w: next.note.w, h: next.note.h })).toBeLessThanOrEqual(8);
    expect(next.arrow.to.y).toBeGreaterThan(next.note.y - 8);
    expect(next.arrow.to.y).toBeLessThan(next.note.y + next.note.h + 8);
  });
});
