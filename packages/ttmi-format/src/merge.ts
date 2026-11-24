// --- Merging into the board -------------------------------------------------
import type { ArrowDraft, BoxDraft, Direction } from "./drafts";
import { isBoxShape, nearBox } from "./geometry";
import { layout } from "./layout";
import { build } from "./route";
import { applyNoteSize } from "./size";
import type { ArrowShape, Shape, SketchMeasure, SketchGroup } from "./types";

export function merge(boxes: BoxDraft[], arrows: ArrowDraft[], direction: Direction, existing: Shape[], measure?: SketchMeasure, groups: SketchGroup[] = []): Shape[] {
  const onBoard = existing.filter(isBoxShape);
  const named = new Map(onBoard.filter((shape) => shape.name).map((shape) => [shape.name!, shape]));
  // Arrows the user drew stay; those between named shapes come from the text.
  // An arrow the text has between the same two shapes as one on the board
  // keeps the board's curve (the user may have bent it), unless the text
  // gives a bend of its own.
  const keptArrows: ArrowShape[] = [];
  const between = new Map<string, ArrowShape[]>();
  for (const shape of existing) {
    if (shape.kind !== "arrow") continue;
    const from = nearBox(onBoard, shape.from);
    const to = nearBox(onBoard, shape.to);
    if (from?.name && to?.name) {
      const key = `${from.name}->${to.name}`;
      between.set(key, [...(between.get(key) ?? []), shape]);
    } else keptArrows.push(shape);
  }
  // A board nobody has arranged (every box where the layout put it, no
  // shape or arrow of the user's) is laid out afresh, the positions the
  // agent echoes from it included, so an update keeps its lanes whole.
  // Once the user has moved a shape, every position on the board is kept.
  const arranged = keptArrows.length > 0 || onBoard.some((shape) => !shape.laidOut);
  const afresh = onBoard.length > 0 && !arranged;
  for (const box of boxes) {
    if (afresh) box.at = undefined;
    const old = named.get(box.name);
    if (!old || old.kind !== box.kind) continue;
    box.id = old.id;
    if (!afresh) {
      box.at = { x: old.x, y: old.y };
      if (old.laidOut) box.laidOut = true;
    }
    if (box.kind === "note" && old.kind === "note") {
      // The board's width is the user's and wins over the text's; the drawn
      // size then follows the new content, folded or widened for its code,
      // the same measurement parse made before layout.
      applyNoteSize(box, measure, old.minWidth ?? old.w);
      if (!box.folds) {
        // Never narrower than it was. With no measurer the height already
        // on the board stands: there is nothing new to measure.
        box.w = Math.max(old.w, box.w);
        if (!measure) box.h = old.h;
      }
    } else {
      // Room for a longer label, never smaller than the user made it.
      box.w = Math.max(old.w, box.w);
      box.h = Math.max(old.h, box.h);
    }
  }
  const unnamed = onBoard.filter((shape) => !shape.name);
  for (const arrow of arrows) {
    if (typeof arrow.from !== "string" || typeof arrow.to !== "string") continue;
    const match = between.get(`${arrow.from}->${arrow.to}`)?.shift();
    if (!match) continue;
    arrow.id = match.id;
    arrow.bend ??= match.bend ?? 0;
  }
  layout(boxes, arrows, direction, unnamed, groups);
  return [...unnamed, ...build(boxes, arrows, unnamed, groups), ...keptArrows];
}
