// A canvas element's height follows the linked sketch's content, measured
// before layout, so arrows and neighbours are placed for the box the
// reader sees. The same width and the same bounds are the same height.
import { describe, expect, it } from "vitest";
import { CANVAS_MIN_WIDTH, CANVAS_RATIO_MAX, CANVAS_RATIO_MIN, boxSize, canvasBoxHeight, canvasRatio, contentBounds, parseSketch, refitSketch, textMeasure, type RectShape } from "../src/index";
import { boxesByName } from "./helpers";

const TALL = { w: 200, h: 500 };
const WIDE = { w: 800, h: 120 };
const SQUARE = { w: 300, h: 300 };

function box(shapes: { kind: string; name?: string; w?: number; h?: number }[], name: string) {
  return shapes.find((shape) => shape.kind === "rect" && shape.name === name) as RectShape;
}

describe("a canvas element's height", () => {
  it("matches the linked sketch's content, and clamps a tower and a strip", () => {
    expect(canvasRatio(SQUARE)).toBe(1);
    expect(canvasRatio(TALL)).toBe(CANVAS_RATIO_MIN);
    expect(canvasRatio(WIDE)).toBe(CANVAS_RATIO_MAX);
    const width = 220;
    expect(canvasBoxHeight(width, SQUARE)).toBeGreaterThan(canvasBoxHeight(width, WIDE));
    expect(canvasBoxHeight(width, TALL)).toBe(canvasBoxHeight(width, { w: 10, h: 10000 }));
    expect(canvasBoxHeight(width, WIDE)).toBe(canvasBoxHeight(width, { w: 10000, h: 10 }));
    // Taller than the one-line label, so the miniature is not a fixed strip.
    expect(canvasBoxHeight(width, SQUARE)).toBeGreaterThan(boxSize("Billing").h);
  });

  it("is the same height for the same bounds, and leaves a box alone without them", () => {
    const source = 'pay: box "Paying" link "skpay"\nshopper: box "Shopper"\npay -> shopper "for"';
    const plain = parseSketch(source);
    expect(box(plain.shapes, "pay").w).toBeGreaterThanOrEqual(CANVAS_MIN_WIDTH);
    expect(box(plain.shapes, "pay").h).toBe(boxSize("Paying").h);
    const once = parseSketch(source, undefined, [], { canvasBounds: { skpay: SQUARE } });
    const twice = parseSketch(source, textMeasure(), [], { canvasBounds: { skpay: SQUARE } });
    expect(box(once.shapes, "pay").h).toBe(canvasBoxHeight(box(once.shapes, "pay").w, SQUARE));
    expect(box(twice.shapes, "pay").h).toBe(box(once.shapes, "pay").h);
    expect(box(once.shapes, "shopper").h).toBe(boxSize("Shopper").h);
  });

  it("keeps an explicit size when it is already tall enough, and grows a short one", () => {
    const short = parseSketch('pay: box "Paying" link "skpay" size 300,80', undefined, [], { canvasBounds: { skpay: SQUARE } });
    expect(box(short.shapes, "pay").w).toBeGreaterThanOrEqual(300);
    expect(box(short.shapes, "pay").h).toBe(canvasBoxHeight(box(short.shapes, "pay").w, SQUARE));
    const held = parseSketch('pay: box "Paying" link "skpay" size 300,400', undefined, [], { canvasBounds: { skpay: SQUARE } });
    expect(box(held.shapes, "pay").w).toBeGreaterThanOrEqual(300);
    expect(box(held.shapes, "pay").h).toBe(400);
    const narrow = parseSketch('pay: box "Paying" link "skpay" size 180,90');
    expect(box(narrow.shapes, "pay").w).toBe(CANVAS_MIN_WIDTH);
  });

  it("lays neighbours out for the taller box, then stops", () => {
    const source = ['top: box "Above"', 'pay: box "Paying" link "skpay"', 'below: box "Below"', "direction: down", 'top -> pay "into"', 'pay -> below "out"'].join("\n");
    const first = parseSketch(source);
    expect(box(first.shapes, "pay").h).toBe(boxSize("Paying").h);
    const fitted = refitSketch(first.shapes, first.steps, first.groups, first.terms, undefined, {}, { skpay: TALL });
    expect(fitted).toBeDefined();
    const pay = box(fitted!, "pay");
    const boxes = boxesByName(fitted!);
    expect(pay.h).toBe(canvasBoxHeight(pay.w, TALL));
    expect(boxes.get("below")!.y).toBeGreaterThanOrEqual(pay.y + pay.h);
    expect(refitSketch(fitted!, first.steps, first.groups, first.terms, undefined, {}, { skpay: TALL })).toBeUndefined();
  });

  it("reads the content span from the boxes, not the arrows", () => {
    const { shapes } = parseSketch('a: box "A"\nb: box "B"\na -> b "go"');
    const bounds = contentBounds(shapes);
    const a = box(shapes, "a");
    const b = box(shapes, "b");
    expect(bounds).toEqual({
      w: Math.max(a.x + a.w, b.x + b.w) - Math.min(a.x, b.x),
      h: Math.max(a.y + a.h, b.y + b.h) - Math.min(a.y, b.y),
    });
  });
});
