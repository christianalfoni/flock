// The box a sketch's numbered flow starts from: the start of the arrows
// with the lowest number (docs/board.md, Box). The board draws it filled in
// its colour; a sketch with no numbered arrows has none.
import { nearBox } from "./geometry";
import type { RectShape, Shape } from "./types";

export function startBoxes(shapes: Shape[]): Set<string> {
  const boxes = shapes.filter((shape) => shape.kind !== "arrow");
  const numbered = shapes.flatMap((shape) => (shape.kind === "arrow" && shape.seq ? [shape] : []));
  const first = Math.min(...numbered.map((arrow) => parseInt(arrow.seq!, 10)));
  return new Set(numbered.filter((arrow) => parseInt(arrow.seq!, 10) === first)
    .map((arrow) => nearBox(boxes, arrow.from))
    .filter((box): box is RectShape => box?.kind === "rect")
    .map((box) => box.id));
}
