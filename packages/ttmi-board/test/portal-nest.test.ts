import { describe, expect, it } from "vitest";
import type { Shape } from "@ttmi/format";
import { boxCenterOffset, centerBoxCamera, childCamera, clampCamera, contentFrame, DIVE_PAN_CALM, DIVE_PAN_MIN_MS, DIVE_PAN_MS, DIVE_PAN_SPAN, DIVE_ZOOM_MS, divePanMs, enteredCamera, fitInFrame, frameInner, frameOffCamera, insetFlight, lerpCamera, nestOf, parentCamera, portalReach } from "../src/portal-nest";

const box = (x: number, y: number, w: number, h: number): Shape => ({ kind: "rect", id: "a", name: "a", x, y, w, h, color: "white", label: "A" });

describe("a nested sketch", () => {
  it("fits the child in the frame and the entered camera matches opening it alone", () => {
    const child = nestOf([box(0, 0, 100, 50), box(120, 0, 80, 50)])!;
    expect(child).toEqual({ minX: 0, minY: 0, w: 200, h: 50 });
    const frame = contentFrame({ x: 10, y: 20, w: 216, h: 66 });
    const fitted = fitInFrame(frame, child);
    const view = { w: 1000, h: 800 };
    const cam = enteredCamera(fitted, child, view);
    // A point of the child lands on the same screen pixel as a direct fit.
    const zDirect = Math.min(4, (view.w - 96) / child.w, (view.h - 148) / child.h);
    const screen = (lx: number, ly: number) => ({ x: cam.x + (fitted.x + (lx - child.minX) * fitted.s) * cam.z, y: cam.y + (fitted.y + (ly - child.minY) * fitted.s) * cam.z });
    const direct = (lx: number, ly: number) => ({
      x: (view.w - child.w * zDirect) / 2 + (lx - child.minX) * zDirect,
      y: 100 + (view.h - 148 - child.h * zDirect) / 2 + (ly - child.minY) * zDirect,
    });
    expect(screen(0, 0).x).toBeCloseTo(direct(0, 0).x, 5);
    expect(screen(0, 0).y).toBeCloseTo(direct(0, 0).y, 5);
    expect(screen(200, 50).x).toBeCloseTo(direct(200, 50).x, 5);
    expect(screen(200, 50).y).toBeCloseTo(direct(200, 50).y, 5);
  });

  it("grows the sketch on a wide screen and still clears a phone", () => {
    const child = nestOf([box(0, 0, 200, 80), box(260, 0, 200, 80)])!;
    const portal = { x: 40, y: 60, w: 220, h: 130 };
    const desktop = frameInner(portal, child, { w: 1500, h: 950 });
    const phone = frameInner(portal, child, { w: 390, h: 844 });
    expect(desktop).toBeGreaterThan(phone);
    expect(desktop).toBeGreaterThan(0.3);
    const views = [
      { w: 390, h: 844 },
      { w: 390, h: 700 },
      { w: 844, h: 390 },
      { w: 768, h: 1024 },
      { w: 1280, h: 800 },
      { w: 1500, h: 950 },
      { w: 1920, h: 1080 },
    ];
    const children = [
      nestOf([box(0, 0, 140, 70)])!,
      child,
      nestOf([box(0, 0, 900, 120)])!,
      nestOf([box(0, 0, 160, 80), box(0, 160, 160, 80), box(0, 320, 160, 80)])!,
    ];
    const portals = [portal, { x: 0, y: 0, w: 360, h: 220 }, { x: 80, y: 40, w: 140, h: 90 }];
    for (const view of views) {
      for (const drawn of children) {
        for (const frame of portals) {
          const k = frameInner(frame, drawn, view);
          const fitted = fitInFrame(contentFrame(frame), drawn, k);
          const cam = enteredCamera(fitted, drawn, view);
          const sx = (x: number) => cam.x + x * cam.z;
          const sy = (y: number) => cam.y + y * cam.z;
          expect(sx(frame.x), `left ${view.w}`).toBeLessThan(0);
          expect(sx(frame.x + frame.w), `right ${view.w}`).toBeGreaterThan(view.w);
          expect(sy(frame.y + 12), `badge ${view.w}x${view.h}`).toBeLessThan(0);
          expect(sy(frame.y + frame.h), `bottom ${view.h}`).toBeGreaterThan(view.h);
        }
      }
    }
  });

  it("puts the box and its badge fully outside a phone or a desktop", () => {
    const views = [
      { w: 390, h: 844 },
      { w: 390, h: 700 },
      { w: 844, h: 390 },
      { w: 768, h: 1024 },
      { w: 1280, h: 800 },
      { w: 1500, h: 950 },
      { w: 1920, h: 1080 },
    ];
    const children = [
      nestOf([box(0, 0, 140, 70)])!,
      nestOf([box(0, 0, 200, 80), box(260, 0, 200, 80)])!,
      nestOf([box(0, 0, 900, 120)])!,
      nestOf([box(0, 0, 160, 80), box(0, 160, 160, 80), box(0, 320, 160, 80)])!,
    ];
    const portals = [
      { x: 40, y: 60, w: 200, h: 120 },
      { x: 0, y: 0, w: 360, h: 220 },
      { x: 80, y: 40, w: 140, h: 90 },
    ];
    for (const view of views) {
      for (const child of children) {
        for (const portal of portals) {
          const fitted = fitInFrame(contentFrame(portal), child);
          const cam = enteredCamera(fitted, child, view);
          const sx = (x: number) => cam.x + x * cam.z;
          const sy = (y: number) => cam.y + y * cam.z;
          expect(sx(portal.x), `left ${view.w}x${view.h}`).toBeLessThan(0);
          expect(sx(portal.x + portal.w), `right ${view.w}x${view.h}`).toBeGreaterThan(view.w);
          // The badge hangs about 12px below the border-box top. That edge
          // has to clear the top of the viewport too.
          expect(sy(portal.y + 12), `badge ${view.w}x${view.h}`).toBeLessThan(0);
          expect(sy(portal.y + portal.h), `bottom ${view.w}x${view.h}`).toBeGreaterThan(view.h);
        }
      }
    }
  });

  it("keeps the open sketch and its own portals live, from any depth", () => {
    const links = (id: string | undefined) => ({ undefined: ["a", "b"], a: ["c"], c: ["d"], d: ["e"] } as Record<string, string[] | undefined>)[id ?? "undefined"] ?? [];
    expect(portalReach(links, "a").path).toEqual(new Set(["a"]));
    expect(portalReach(links, "a").live).toEqual(new Set(["a", "c"]));
    const deep = portalReach(links, "d");
    expect(deep.path).toEqual(new Set(["a", "c", "d"]));
    expect(deep.live).toEqual(new Set(["a", "c", "d", "e"]));
    expect(deep.live.has("b")).toBe(false);
  });

  it("converts the camera into the child's own coordinates and back", () => {
    const place = { frame: { x: 120, y: 80, w: 40, h: 20 }, nest: { minX: 10, minY: 5, w: 200, h: 100 }, s: 0.2 };
    const parent = { x: -400, y: -200, z: 12 };
    const child = childCamera(parent, place);
    expect(child.z).toBeCloseTo(2.4);
    const back = parentCamera(child, place);
    expect(back.z).toBeCloseTo(parent.z);
    expect(back.x).toBeCloseTo(parent.x);
    expect(back.y).toBeCloseTo(parent.y);
    const screen = (cam: { x: number; y: number; z: number }, x: number, y: number) => ({ x: cam.x + x * cam.z, y: cam.y + y * cam.z });
    const local = { x: 80, y: 40 };
    const world = { x: place.frame.x + (local.x - place.nest.minX) * place.s, y: place.frame.y + (local.y - place.nest.minY) * place.s };
    expect(screen(child, local.x, local.y).x).toBeCloseTo(screen(parent, world.x, world.y).x);
    expect(screen(child, local.x, local.y).y).toBeCloseTo(screen(parent, world.x, world.y).y);
  });

  it("moves the frame off screen while the picture stays on the content camera", () => {
    const nest = nestOf([box(0, 0, 200, 80)])!;
    const portal = { x: 40, y: 60, w: 220, h: 140 };
    const fitted = fitInFrame(contentFrame(portal), nest, 0.4);
    const place = { frame: fitted, nest, s: fitted.s };
    const view = { w: 1280, h: 800 };
    const C0 = { x: 80, y: 60, z: 1 };
    const K0 = childCamera(C0, place);
    const K1 = { x: 140, y: 90, z: 1.5 };
    const C1 = frameOffCamera(portal, view);
    const screen = (cam: { x: number; y: number; z: number }, x: number, y: number) => ({ x: cam.x + x * cam.z, y: cam.y + y * cam.z });
    const start = insetFlight(C0, K0, place);
    expect(start.x).toBeCloseTo(0, 5);
    expect(start.y).toBeCloseTo(0, 5);
    expect(start.s).toBeCloseTo(place.s, 5);
    const points = [
      [nest.minX, nest.minY],
      [nest.minX + nest.w, nest.minY + nest.h],
      [nest.minX + nest.w / 2, nest.minY + 10],
    ];
    const at = (e: number, lx: number, ly: number) => {
      const C = lerpCamera(C0, C1, e);
      const K = lerpCamera(K0, K1, e);
      const inset = insetFlight(C, K, place);
      const world = {
        x: place.frame.x + inset.x + (lx - nest.minX) * inset.s,
        y: place.frame.y + inset.y + (ly - nest.minY) * inset.s,
      };
      return { seen: screen(C, world.x, world.y), want: screen(K, lx, ly) };
    };
    for (const e of [0, 0.25, 0.5, 0.75, 1]) {
      for (const [lx, ly] of points) {
        const { seen, want } = at(e, lx!, ly!);
        expect(seen.x).toBeCloseTo(want.x, 4);
        expect(seen.y).toBeCloseTo(want.y, 4);
      }
    }
    const mid = at(0.5, nest.minX + 20, nest.minY + 30);
    const a = at(0, nest.minX + 20, nest.minY + 30);
    const b = at(1, nest.minX + 20, nest.minY + 30);
    expect(mid.seen.x).toBeCloseTo((a.seen.x + b.seen.x) / 2, 4);
    expect(mid.seen.y).toBeCloseTo((a.seen.y + b.seen.y) / 2, 4);
    expect(C1.x + portal.x * C1.z).toBeLessThanOrEqual(-8);
    expect(C1.x + (portal.x + portal.w) * C1.z).toBeGreaterThanOrEqual(view.w + 8);
    expect(C1.y + portal.y * C1.z).toBeLessThanOrEqual(-32);
    expect(C1.y + (portal.y + portal.h) * C1.z).toBeGreaterThanOrEqual(view.h + 8);
  });

  it("pans a dive onto the box at the current zoom, and skips one that is already near the middle", () => {
    const view = { w: 1500, h: 950 };
    const portal = { x: 980, y: 120, w: 240, h: 150 };
    const C0 = { x: 40, y: 70, z: 1.15 };
    const offset = boxCenterOffset(C0, portal, view);
    expect(Math.abs(offset.x)).toBeGreaterThan(DIVE_PAN_CALM);
    expect(divePanMs(offset)).toBeGreaterThan(0);
    const Cpan = centerBoxCamera(C0, portal, view);
    expect(Cpan.z).toBe(C0.z);
    const centred = boxCenterOffset(Cpan, portal, view);
    expect(centred.x).toBeCloseTo(0, 5);
    expect(centred.y).toBeCloseTo(0, 5);
    expect(divePanMs(centred)).toBe(0);
    const again = centerBoxCamera(Cpan, portal, view);
    expect(again.z).toBe(Cpan.z);
    expect(again.x).toBeCloseTo(Cpan.x, 5);
    expect(again.y).toBeCloseTo(Cpan.y, 5);
    // Inside the band on both axes: no pan. Just outside: a short one.
    // At the edge of the view and beyond: the full pan. The zoom after
    // it is the same length as before.
    expect(divePanMs({ x: DIVE_PAN_CALM, y: -DIVE_PAN_CALM })).toBe(0);
    const slight = divePanMs({ x: DIVE_PAN_CALM + 0.04, y: 0.05 });
    const mid = divePanMs({ x: DIVE_PAN_CALM + DIVE_PAN_SPAN / 2, y: 0 });
    expect(slight).toBeGreaterThanOrEqual(DIVE_PAN_MIN_MS);
    expect(slight).toBeLessThan(mid);
    expect(mid).toBeLessThan(DIVE_PAN_MS);
    expect(divePanMs({ x: DIVE_PAN_CALM + DIVE_PAN_SPAN, y: 0 })).toBe(DIVE_PAN_MS);
    expect(divePanMs({ x: 0.9, y: -0.7 })).toBe(DIVE_PAN_MS);
    expect(DIVE_ZOOM_MS).toBe(640);
    // While the pan runs the picture stays locked in the box, and the
    // zoom leaves from the centred camera with a larger scale.
    const nest = nestOf([box(0, 0, 200, 80)])!;
    const fitted = fitInFrame(contentFrame(portal), nest, 0.4);
    const place = { frame: fitted, nest, s: fitted.s };
    const K0 = childCamera(C0, place);
    const Kpan = childCamera(Cpan, place);
    expect(Kpan.z).toBeCloseTo(K0.z, 5);
    const screen = (cam: { x: number; y: number; z: number }, x: number, y: number) => ({ x: cam.x + x * cam.z, y: cam.y + y * cam.z });
    const local = { x: nest.minX + 30, y: nest.minY + 12 };
    for (const e of [0, 0.35, 1]) {
      const C = lerpCamera(C0, Cpan, e);
      const K = lerpCamera(K0, Kpan, e);
      expect(C.z).toBeCloseTo(C0.z, 5);
      const inset = insetFlight(C, K, place);
      const world = {
        x: place.frame.x + inset.x + (local.x - nest.minX) * inset.s,
        y: place.frame.y + inset.y + (local.y - nest.minY) * inset.s,
      };
      expect(screen(C, world.x, world.y).x).toBeCloseTo(screen(K, local.x, local.y).x, 4);
      expect(screen(C, world.x, world.y).y).toBeCloseTo(screen(K, local.x, local.y).y, 4);
    }
    expect(frameOffCamera(portal, view).z).toBeGreaterThan(Cpan.z);
  });

  it("will not pan or zoom out of the boundary", () => {
    const limit = { minX: 0, minY: 0, maxX: 200, maxY: 100 };
    const view = { w: 400, h: 200 };
    const held = clampCamera({ x: -1000, y: -1000, z: 1 }, limit, view);
    expect(held.z).toBeGreaterThanOrEqual(2);
    const left = -held.x / held.z;
    const top = -held.y / held.z;
    expect(left).toBeGreaterThanOrEqual(-0.01);
    expect(top).toBeGreaterThanOrEqual(-0.01);
    expect(left + view.w / held.z).toBeLessThanOrEqual(200.01);
    expect(top + view.h / held.z).toBeLessThanOrEqual(100.01);
  });
});
