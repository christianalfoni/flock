// Lays a drawing out again once a badge is known that the first pass
// could not see: a canvas's name arrives with the linked sketch. The
// size is measured first, and layout, routing and labels read it. A
// board nobody has arranged is placed afresh; a board someone has moved
// keeps its places and only grows, then the arrows are routed again.
import { isBoxShape, nearBox } from "./geometry";
import { parseSketch } from "./parse";
import { portalLabelId, portalSketchId } from "./portal";
import { serializeSketch } from "./serialize";
import { CANVAS_MIN_WIDTH, canvasBoxHeight, rectFloor, type ContentBounds } from "./size";
import type { Direction } from "./drafts";
import type { RectShape, Shape, SketchGroup, SketchMeasure, SketchStep, SketchTerm } from "./types";

function needsSize(shape: RectShape, measure: SketchMeasure | undefined, canvasTitles: Readonly<Record<string, string>>, canvasBounds?: Readonly<Record<string, ContentBounds>>) {
  const floor = rectFloor(shape, measure, canvasTitles).floor;
  const id = portalSketchId(shape.link) ?? portalLabelId(shape.label);
  const width = Math.max(shape.w, floor, id ? CANVAS_MIN_WIDTH : 0);
  if (width > shape.w + 1) return true;
  const child = id ? canvasBounds?.[id] : undefined;
  if (!child || child.w <= 0 || child.h <= 0) return false;
  return canvasBoxHeight(width, child) > shape.h + 1;
}

// Right, unless the arrows run down the page more than across it. The
// saved board does not store the direction; a fresh layout needs it.
function flowDirection(shapes: Shape[]): Direction {
  const boxes = shapes.filter(isBoxShape);
  let down = 0;
  let right = 0;
  for (const shape of shapes) {
    if (shape.kind !== "arrow") continue;
    const from = nearBox(boxes, shape.from);
    const to = nearBox(boxes, shape.to);
    if (!from || !to || from === to) continue;
    const dx = Math.abs(to.x + to.w / 2 - (from.x + from.w / 2));
    const dy = Math.abs(to.y + to.h / 2 - (from.y + from.h / 2));
    if (dy > dx) down += 1;
    else right += 1;
  }
  return down > right ? "down" : "right";
}

// Undefined when every box is already at least as wide as its badge and
// every canvas is already at least as tall as its linked sketch, so a
// caller can leave the drawing alone.
export function refitSketch(shapes: Shape[], steps: SketchStep[], groups: SketchGroup[], terms: SketchTerm[], measure: SketchMeasure | undefined, canvasTitles: Readonly<Record<string, string>>, canvasBounds?: Readonly<Record<string, ContentBounds>>): Shape[] | undefined {
  if (!shapes.some((shape) => shape.kind === "rect" && needsSize(shape, measure, canvasTitles, canvasBounds))) return undefined;
  let text = serializeSketch(shapes, undefined, steps, groups, terms).text;
  if (flowDirection(shapes) === "down") text = text.replace("direction: right", "direction: down");
  return parseSketch(text, measure, shapes, { canvasTitles, canvasBounds }).shapes;
}
