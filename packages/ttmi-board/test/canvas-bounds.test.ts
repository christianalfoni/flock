// The height of a canvas comes from the child's content, measured the
// same way when that child is only a name and when it is the drawing.
import { describe, expect, it } from "vitest";
import { canvasBoxHeight, contentBounds, parseSketch, textMeasure } from "@ttmi/format";
import { layCanvases } from "../src/canvas-bounds";
import type { PortalRecord } from "../src/PortalInset";

const TALL = `# sketch Tall
direction: down
a: box "One"
b: box "Two"
c: box "Three"
a -> b "down"
b -> c "down"`;

const WIDE = `# sketch Wide
left: box "Left"
right: box "Right"
left -> right "across"`;

function open(source: string, extra: Partial<PortalRecord> = {}): PortalRecord {
  const parsed = parseSketch(source, textMeasure());
  return { status: "open", title: "Sketch", shapes: parsed.shapes, steps: parsed.steps, groups: parsed.groups, ...extra };
}

describe("canvas bounds", () => {
  it("sizes a portal from the child, and a title-only source matches the drawing", () => {
    const tall = open(TALL);
    const fromSource = layCanvases({ sktall: { status: "open", title: "Tall", source: TALL } }, textMeasure());
    expect(fromSource.fitted.sktall).toBeUndefined();
    expect(fromSource.bounds.sktall).toEqual(contentBounds(tall.shapes!));

    const parent = `# sketch Map
tall: box "Tall" link "sktall"
wide: box "Wide" link "skwide"`;
    const laid = layCanvases({
      sktall: { status: "open", title: "Tall", source: TALL },
      skwide: { status: "open", title: "Wide", source: WIDE },
      skmap: open(parent),
    }, textMeasure());
    const map = laid.fitted.skmap!;
    const tallBox = map.find((shape) => shape.kind === "rect" && shape.name === "tall");
    const wideBox = map.find((shape) => shape.kind === "rect" && shape.name === "wide");
    expect(tallBox && tallBox.kind === "rect" && wideBox && wideBox.kind === "rect").toBe(true);
    if (tallBox?.kind !== "rect" || wideBox?.kind !== "rect") return;
    expect(tallBox.h).toBe(canvasBoxHeight(tallBox.w, laid.bounds.sktall!));
    expect(wideBox.h).toBe(canvasBoxHeight(wideBox.w, laid.bounds.skwide!));
    expect(tallBox.h).toBeGreaterThan(wideBox.h);
  });

  it("keeps a frozen ratio when the child changes afterwards", () => {
    const parent = 'tall: box "Tall" link "sktall"';
    const first = layCanvases({
      sktall: { status: "open", title: "Tall", source: TALL },
      skmap: open(parent),
    }, textMeasure());
    const locked = new Map([["skmap", first.used.skmap!]]);
    const again = layCanvases({
      sktall: { status: "open", title: "Tall", source: WIDE },
      skmap: open(parent),
    }, textMeasure(), undefined, locked);
    const before = first.fitted.skmap!.find((shape) => shape.kind === "rect");
    const after = again.fitted.skmap!.find((shape) => shape.kind === "rect");
    expect(after && after.kind === "rect" && before && before.kind === "rect" && after.h).toBe(before && before.kind === "rect" ? before.h : 0);
  });

  it("does not follow a cycle", () => {
    const laid = layCanvases({
      a: { status: "open", title: "A", source: 'b: box "B" link "b"' },
      b: { status: "open", title: "B", source: 'a: box "A" link "a"' },
    }, textMeasure());
    expect(laid.bounds.a?.w).toBeGreaterThan(0);
    expect(laid.bounds.b?.w).toBeGreaterThan(0);
  });

  it("waits while a child is still loading", () => {
    const laid = layCanvases({
      sktall: { status: "loading" },
      skmap: open('tall: box "Tall" link "sktall"'),
    }, textMeasure());
    expect(laid.waiting.skmap).toBe("loading");
  });
});
