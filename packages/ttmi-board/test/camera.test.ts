import { describe, expect, it } from "vitest";
import { focusCamera, frameCamera, type Rect } from "../src/camera";

const area = { width: 1200, height: 800 };

function onScreen(rect: Rect, camera: { x: number; y: number; z: number }) {
  return { minX: rect.minX * camera.z + camera.x, minY: rect.minY * camera.z + camera.y, maxX: rect.maxX * camera.z + camera.x, maxY: rect.maxY * camera.z + camera.y };
}

function inView(rect: Rect, camera: { x: number; y: number; z: number }) {
  const screen = onScreen(rect, camera);
  return screen.minX >= -0.01 && screen.minY >= -0.01 && screen.maxX <= area.width + 0.01 && screen.maxY <= area.height + 0.01;
}

function middleOnScreen(rect: Rect, camera: { x: number; y: number; z: number }) {
  const screen = onScreen(rect, camera);
  return { x: (screen.minX + screen.maxX) / 2, y: (screen.minY + screen.maxY) / 2 };
}

// A step of three boxes in a row.
const box = { minX: 0, minY: 0, maxX: 900, maxY: 200 };
const step = { camera: frameCamera(box, area), box, area };

describe("the voice's camera", () => {
  it("stays put when the shape is in view near the middle", () => {
    expect(focusCamera(step, { minX: 375, minY: 50, maxX: 525, maxY: 150 })).toEqual(step.camera);
  });

  it("centres a shape at the edge of the step at the step's zoom, without keeping the rest in view", () => {
    const target = { minX: 650, minY: 50, maxX: 800, maxY: 150 };
    const camera = focusCamera(step, target);
    expect(middleOnScreen(target, camera).x).toBeCloseTo(area.width / 2);
    expect(middleOnScreen(target, camera).y).toBeCloseTo(area.height / 2);
    expect(camera.z).toBe(step.camera.z);
  });

  it("brings in a shape outside the step's view, at the step's zoom", () => {
    const target = { minX: 1100, minY: 600, maxX: 1300, maxY: 700 };
    expect(inView(target, step.camera)).toBe(false);
    const camera = focusCamera(step, target);
    expect(inView(target, camera)).toBe(true);
    expect(camera.z).toBe(step.camera.z);
  });

  it("zooms out only when the shape itself would not fit", () => {
    const small = { minX: 0, minY: 0, maxX: 200, maxY: 100 };
    const close = { camera: frameCamera(small, area), box: small, area };
    const big = { minX: 400, minY: 0, maxX: 1400, maxY: 300 };
    const camera = focusCamera(close, big);
    expect(camera.z).toBeLessThan(close.camera.z);
    expect(inView(big, camera)).toBe(true);
  });

  it("never zooms in past the step", () => {
    const small = { minX: 0, minY: 0, maxX: 100, maxY: 60 };
    const close = { camera: frameCamera(small, area), box: small, area };
    const camera = focusCamera(close, { minX: 90, minY: 50, maxX: 100, maxY: 60 });
    expect(camera.z).toBeLessThanOrEqual(close.camera.z);
  });
});

describe("a step's camera", () => {
  it("frames a single small shape at no more than 175%", () => {
    expect(frameCamera({ minX: 0, minY: 0, maxX: 120, maxY: 60 }, area).z).toBe(1.75);
  });

  it("fits a wide step as large as fits", () => {
    const camera = frameCamera(box, area);
    expect(camera.z).toBeLessThan(1.75);
    expect(inView(box, camera)).toBe(true);
  });
});
