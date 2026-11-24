// The curve and label the board paints. The sketch keeps the bend that was
// written; a drag asks again, so the picture follows the boxes. A curve
// that would show a piece behind its own end box is cut back to the edge.
import { arrowMidpoint, labelSize, placeEdges, type ArrowShape, type Point } from "@ttmi/format";
import { labelOnPainted, paintArrow, type Rect } from "./clip";
import type { DrawnArrow } from "./shapes";

export type ArrowLayout = {
  bend(arrow: ArrowShape): number;
  label(arrow: ArrowShape): Point;
  shown(arrow: ArrowShape): DrawnArrow;
};

// `pin` is the bend under the pointer, drawn exactly so the curve follows
// the drag. `labelSizes` are measured; without one, the estimate is used.
export function layoutArrows(
  arrows: readonly ArrowShape[],
  boxes: readonly Rect[],
  options?: { pin?: { id: string; bend: number }; labelSizes?: ReadonlyMap<string, { w: number; h: number }> },
): ArrowLayout {
  const placed = placeEdges(arrows.map((arrow) => {
    const pinned = options?.pin?.id === arrow.id;
    return {
      id: arrow.id,
      from: arrow.from,
      to: arrow.to,
      bend: pinned ? options?.pin?.bend : arrow.bend,
      holdBend: pinned,
      label: arrow.label || arrow.seq ? options?.labelSizes?.get(arrow.id) ?? labelSize(arrow.label, arrow.seq) : undefined,
    };
  }), boxes);
  const bendOf = (arrow: ArrowShape) => placed.get(arrow.id)?.bend ?? arrow.bend ?? 0;
  const painted = new Map<string, ReturnType<typeof paintArrow>>();
  const paint = (arrow: ArrowShape) => {
    let hit = painted.get(arrow.id);
    if (!hit) {
      hit = paintArrow(arrow.from, arrow.to, bendOf(arrow), boxes);
      painted.set(arrow.id, hit);
    }
    return hit;
  };
  return {
    bend: bendOf,
    label(arrow) {
      const bend = bendOf(arrow);
      const point = placed.get(arrow.id)?.label ?? arrowMidpoint(arrow.from, arrow.to, bend);
      return labelOnPainted(arrow.from, arrow.to, bend, point, paint(arrow));
    },
    shown(arrow) {
      const bend = bendOf(arrow);
      const curve = paint(arrow);
      const uncut = curve.t0 <= 1e-4 && curve.t1 >= 1 - 1e-4;
      const drawn = Math.abs(bend) < 1e-3 ? undefined : bend;
      if (uncut && (arrow.bend ?? 0) === bend) return arrow;
      const next = drawn ? { ...arrow, bend: drawn } : { ...arrow, bend: undefined };
      if (uncut || !curve.control) return next;
      return { ...next, from: curve.from, to: curve.to, control: curve.control };
    },
  };
}
