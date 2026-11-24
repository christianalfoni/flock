// One world (docs/plan-portals.md): a linked sketch is drawn inside its
// box, scaled to the frame, and the board's camera zooms into that frame
// until the inner sketch sits where it would if it had been opened alone.
import { CANVAS_PAD_X, CANVAS_PAD_Y, type Shape } from "@ttmi/format";
import type { Camera } from "./shapes";
import { bounds } from "./shapes";

export type Frame = { x: number; y: number; w: number; h: number };
export type Nest = { minX: number; minY: number; w: number; h: number };

// .sketch-rect is border-box with a 2px border and 8px 12px padding. The
// content box is what the inner sketch fills. The pads live with the
// sizing rule, so the box and the picture share one inset.
export function contentFrame(box: { x: number; y: number; w: number; h: number }): Frame {
  return { x: box.x + CANVAS_PAD_X, y: box.y + CANVAS_PAD_Y, w: Math.max(1, box.w - CANVAS_PAD_X * 2), h: Math.max(1, box.h - CANVAS_PAD_Y * 2) };
}

export function nestOf(shapes: Shape[]): Nest | undefined {
  const box = bounds(shapes.filter((shape) => shape.kind !== "arrow"));
  if (!box) return undefined;
  return { minX: box.minX, minY: box.minY, w: Math.max(1, box.maxX - box.minX), h: Math.max(1, box.maxY - box.minY) };
}

// Used when the viewport is not known yet (the first paint, a headless
// export). Small enough that a phone still leaves the box off screen.
export const FRAME_INNER = 0.18;

// The badge hangs about this far below the border-box top.
const BADGE_DROP = 12;
const CLEAR = 8;

export function fitInFrame(frame: Frame, child: Nest, k = FRAME_INNER): Frame & { s: number } {
  const innerW = frame.w * k;
  const innerH = frame.h * k;
  const s = Math.min(innerW / child.w, innerH / child.h);
  const w = child.w * s;
  const h = child.h * s;
  return { x: frame.x + (frame.w - w) / 2, y: frame.y + (frame.h - h) / 2, w, h, s };
}

// The largest fraction of the frame that still puts the box and its badge
// fully outside this viewport once the camera reaches the child's own fit.
// A wide screen can show more of the sketch; a phone keeps a wider margin.
export function frameInner(box: { x: number; y: number; w: number; h: number }, child: Nest, view: { w: number; h: number }): number {
  if (view.w < 240 || view.h < 240) return FRAME_INNER;
  const frame = contentFrame(box);
  const clears = (k: number) => {
    const fitted = fitInFrame(frame, child, k);
    const cam = enteredCamera(fitted, child, view);
    const sx = (x: number) => cam.x + x * cam.z;
    const sy = (y: number) => cam.y + y * cam.z;
    return sx(box.x) <= -CLEAR && sx(box.x + box.w) >= view.w + CLEAR && sy(box.y + BADGE_DROP) <= -CLEAR && sy(box.y + box.h) >= view.h + CLEAR;
  };
  let lo = 0.08;
  let hi = 0.72;
  if (!clears(lo)) return lo;
  let best = lo;
  for (let i = 0; i < 18; i++) {
    const mid = (lo + hi) / 2;
    if (clears(mid)) {
      best = mid;
      lo = mid;
    } else hi = mid;
  }
  return best;
}

// The camera on the parent world that shows the fitted child exactly as
// zoom-to-fit would on a board of that child alone (the same padding, the
// same room above for the toolbar).
export function enteredCamera(fitted: Frame, child: Nest, view: { w: number; h: number }, top = 100, pad = 48): Camera {
  const zDirect = Math.min(4, (view.w - pad * 2) / child.w, (view.h - pad - top) / child.h);
  const s = fitted.w / child.w;
  const z = zDirect / Math.max(s, 0.0001);
  return {
    z,
    x: (view.w - child.w * zDirect) / 2 - fitted.x * z,
    y: top + (view.h - pad - top - child.h * zDirect) / 2 - fitted.y * z,
  };
}

export type Placement = { frame: Frame; nest: Nest; s: number };

// The same pixels, once the child is the board and no longer a scaled
// drawing inside the parent. s is how small the child was drawn.
export function childCamera(parent: Camera, place: Placement): Camera {
  const { frame, nest, s } = place;
  return {
    z: s * parent.z,
    x: parent.x + (frame.x - nest.minX * s) * parent.z,
    y: parent.y + (frame.y - nest.minY * s) * parent.z,
  };
}

export function parentCamera(child: Camera, place: Placement): Camera {
  const { frame, nest, s } = place;
  const z = child.z / Math.max(s, 0.0001);
  return {
    z,
    x: child.x - (frame.x - nest.minX * s) * z,
    y: child.y - (frame.y - nest.minY * s) * z,
  };
}

// Screen-space blend. A point's screen position moves in a straight line,
// which a blend of two nested scales does not.
export function lerpCamera(a: Camera, b: Camera, e: number): Camera {
  return { x: a.x + (b.x - a.x) * e, y: a.y + (b.y - a.y) * e, z: a.z + (b.z - a.z) * e };
}

// The parent camera that puts this box's border past every edge of the
// view. topClear covers the badge, which hangs above the border.
export function frameOffCamera(box: { x: number; y: number; w: number; h: number }, view: { w: number; h: number }, clear = 8, topClear = 32): Camera {
  const z = Math.max((view.w + 2 * clear) / Math.max(1, box.w), (view.h + clear + topClear) / Math.max(1, box.h));
  const targetCx = view.w / 2;
  const targetCy = (-topClear + view.h + clear) / 2;
  return { z, x: targetCx - (box.x + box.w / 2) * z, y: targetCy - (box.y + box.h / 2) * z };
}

// A dive whose box is already near the middle of the view does not pan.
// The voice camera stays for the same band (camera.ts).
export const DIVE_PAN_CALM = 0.2;
// How far past that band, as a share of the view, the pan takes to reach
// its full length. Half a view from the middle (the centre on the edge,
// a box that is partly off screen) is the cap.
export const DIVE_PAN_SPAN = 0.3;
// Just outside the band the pan is only long enough to read. Further
// off it grows to DIVE_PAN_MS, then stays there.
export const DIVE_PAN_MIN_MS = 140;
export const DIVE_PAN_MS = 320;
// The zoom that follows the pan. The same length the dive used when it
// zoomed straight in, and the same length zooming back out still uses.
export const DIVE_ZOOM_MS = 640;

// Where the box's middle sits relative to the middle of the view, as a
// share of the view. 0 is centred. The zoom in use is not part of it.
export function boxCenterOffset(camera: Camera, box: { x: number; y: number; w: number; h: number }, view: { w: number; h: number }) {
  const w = Math.max(1, view.w);
  const h = Math.max(1, view.h);
  const sx = camera.x + (box.x + box.w / 2) * camera.z - w / 2;
  const sy = camera.y + (box.y + box.h / 2) * camera.z - h / 2;
  return { x: sx / w, y: sy / h };
}

// The same zoom, with the box's middle in the middle of the view.
export function centerBoxCamera(camera: Camera, box: { x: number; y: number; w: number; h: number }, view: { w: number; h: number }): Camera {
  return {
    z: camera.z,
    x: view.w / 2 - (box.x + box.w / 2) * camera.z,
    y: view.h / 2 - (box.y + box.h / 2) * camera.z,
  };
}

// 0 when the box is already near the middle. Otherwise a short glide
// just outside that band, and the full pan once the middle is well off.
export function divePanMs(offset: { x: number; y: number }): number {
  const past = Math.max(Math.abs(offset.x), Math.abs(offset.y)) - DIVE_PAN_CALM;
  if (past <= 0) return 0;
  const t = Math.min(1, past / DIVE_PAN_SPAN);
  return Math.round(DIVE_PAN_MIN_MS + t * (DIVE_PAN_MS - DIVE_PAN_MIN_MS));
}

// How the inset's content div moves while the world camera is `world` and
// the picture should sit on `content`. x and y are a translate on top of
// the resting fit; s replaces its scale. At the resting camera this is
// the identity (0, 0, place.s), and the screen position of every child
// point is `content` for any world camera.
export function insetFlight(world: Camera, content: Camera, place: Placement): { x: number; y: number; s: number } {
  const z = Math.max(world.z, 0.0001);
  const s = content.z / z;
  const anchorX = (content.x - world.x) / z;
  const anchorY = (content.y - world.y) / z;
  return {
    x: anchorX - place.frame.x + place.nest.minX * s,
    y: anchorY - place.frame.y + place.nest.minY * s,
    s,
  };
}

// What the camera can see, in world coordinates. Panning stays inside it.
export function visibleWorld(camera: Camera, view: { w: number; h: number }): { minX: number; minY: number; maxX: number; maxY: number } {
  const minX = -camera.x / camera.z;
  const minY = -camera.y / camera.z;
  return { minX, minY, maxX: minX + view.w / camera.z, maxY: minY + view.h / camera.z };
}

// The sketches from the root down to `openId`, and `openId`'s own portals.
// `linksFrom(undefined)` is the root's portals. The board no longer clamps
// the camera to the child; this only decides which portals stay live.
export function portalReach(linksFrom: (sketchId: string | undefined) => string[], openId: string): { path: Set<string>; live: Set<string> } {
  const parent = new Map<string, string | undefined>();
  const queue = linksFrom(undefined).map((id) => ({ id, from: undefined as string | undefined }));
  const seen = new Set<string>();
  while (queue.length) {
    const next = queue.shift()!;
    if (seen.has(next.id)) continue;
    seen.add(next.id);
    parent.set(next.id, next.from);
    if (next.id === openId) break;
    for (const id of linksFrom(next.id)) queue.push({ id, from: next.id });
  }
  const path = new Set<string>();
  if (parent.has(openId)) {
    let cursor: string | undefined = openId;
    while (cursor) {
      path.add(cursor);
      cursor = parent.get(cursor);
    }
  }
  const live = new Set(path);
  for (const id of linksFrom(openId)) live.add(id);
  return { path, live };
}

// Kept for the geometry tests. The board does not clamp a portal's camera.
export function clampCamera(camera: Camera, limit: { minX: number; minY: number; maxX: number; maxY: number }, view: { w: number; h: number }): Camera {
  const lw = Math.max(1, limit.maxX - limit.minX);
  const lh = Math.max(1, limit.maxY - limit.minY);
  const z = Math.max(camera.z, view.w / lw, view.h / lh);
  const vw = view.w / z;
  const vh = view.h / z;
  let left = -camera.x / z;
  let top = -camera.y / z;
  left = vw >= lw ? limit.minX - (vw - lw) / 2 : Math.min(Math.max(left, limit.minX), limit.maxX - vw);
  top = vh >= lh ? limit.minY - (vh - lh) / 2 : Math.min(Math.max(top, limit.minY), limit.maxY - vh);
  return { z, x: -left * z, y: -top * z };
}
