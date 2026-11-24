// A group's region: where it is drawn, from its members' positions
// (docs/format.md, Groups; docs/board.md, Group). Nothing is stored for it.
import { GROUP_HEAD, GROUP_PAD } from "./constants";
import type { Rect } from "./drafts";
import type { SketchGroup } from "./types";

// The members a region is drawn around: the group's boxes, so the region
// is the structure and a member note hangs beside its box like any note
// (docs/concept.md, lesson 15). A group of notes alone keeps the notes.
export function regionMembers<T extends { kind: string; name?: string }>(group: SketchGroup, shapes: T[]): T[] {
  const members = shapes.filter((shape) => shape.kind !== "arrow" && shape.name && group.members.includes(shape.name));
  const boxes = members.filter((shape) => shape.kind === "rect");
  return boxes.length ? boxes : members;
}

// The members' bounding box, GROUP_PAD around it and GROUP_HEAD more at
// the top for the label.
export function groupRegion(members: Rect[]): Rect {
  const minX = Math.min(...members.map((item) => item.x));
  const minY = Math.min(...members.map((item) => item.y));
  const maxX = Math.max(...members.map((item) => item.x + item.w));
  const maxY = Math.max(...members.map((item) => item.y + item.h));
  return { x: minX - GROUP_PAD, y: minY - GROUP_PAD - GROUP_HEAD, w: maxX - minX + 2 * GROUP_PAD, h: maxY - minY + 2 * GROUP_PAD + GROUP_HEAD };
}
