import type { Camera } from "./shapes";

export type Rect = { minX: number; minY: number; maxX: number; maxY: number };
export type Area = { width: number; height: number };

// Room kept free on every side of what a camera frames, in screen pixels.
const ROOM = 60;
// A step never zooms in past 175%, so a single small shape (a note, a box)
// does not fill the screen.
export const MAX_ZOOM = 1.75;
// A shape whose middle is this close to the middle of the view, as a share
// of its width and height, is already where the eye is: the camera stays.
const CALM = 0.2;

// The camera that frames a box: centred in the area, as large as fits.
export function frameCamera(box: Rect, area: Area): Camera {
  const z = Math.min(MAX_ZOOM, (area.width - 2 * ROOM) / Math.max(1, box.maxX - box.minX), (area.height - 2 * ROOM) / Math.max(1, box.maxY - box.minY));
  return place({ x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 }, z, area);
}

// The camera for a shape the voice points at (docs/plan-voice-cues.md):
// the shape in the middle, at the step's zoom. A good zoom matters more
// than keeping the step's other shapes in view, so the camera only pans,
// zooming out only when the shape itself would not fit, never in. A shape
// that is already in view near the middle does not move the camera.
export function focusCamera(step: { camera: Camera; box: Rect; area: Area }, target: Rect): Camera {
  const { camera, area } = step;
  const middle = { x: (target.minX + target.maxX) / 2, y: (target.minY + target.maxY) / 2 };
  const screen = { minX: target.minX * camera.z + camera.x, minY: target.minY * camera.z + camera.y, maxX: target.maxX * camera.z + camera.x, maxY: target.maxY * camera.z + camera.y };
  const inView = screen.minX >= 0 && screen.minY >= 0 && screen.maxX <= area.width && screen.maxY <= area.height;
  const near = Math.abs(middle.x * camera.z + camera.x - area.width / 2) <= area.width * CALM
    && Math.abs(middle.y * camera.z + camera.y - area.height / 2) <= area.height * CALM;
  if (inView && near) return camera;
  const z = Math.min(camera.z, (area.width - 2 * ROOM) / Math.max(1, target.maxX - target.minX), (area.height - 2 * ROOM) / Math.max(1, target.maxY - target.minY));
  return place(middle, z, area);
}

function place(middle: { x: number; y: number }, z: number, area: Area): Camera {
  return { z, x: area.width / 2 - middle.x * z, y: area.height / 2 - middle.y * z };
}

