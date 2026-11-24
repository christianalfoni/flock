// What the parser reads before it becomes board shapes.
import type { Color, Point } from "./types";

export type Direction = "right" | "down";

export type BoxDraft = {
  // The board shape it updates, when merged into one already there.
  id?: string;
  kind: "rect" | "note";
  name: string;
  // A short category shown on the shape's corner, and its pill's size.
  tag?: string;
  tagSize?: { w: number; h: number };
  // Another sketch a box opens, by id.
  link?: string;
  line: number;
  color: Color;
  label: string;
  markdown: string;
  html: string;
  // The width a note's code needs so no line wraps.
  codeWidth: number;
  // A note's asked width, the least it is when open; and whether it folds
  // to its first line (docs/board.md, Notes fold), in which case w and h
  // are that line's.
  minWidth?: number;
  folds?: boolean;
  size: number;
  at?: Point;
  // Placed by the layout, here or on the board before (RectShape).
  laidOut?: true;
  w: number;
  h: number;
  // Where arrows land, measured with the size above. A folding note: its
  // head, which is the node itself, so opening the note does not move the
  // end. A box: the corner pill, hanging on the top edge.
  badge?: { x: number; y: number; w: number; h: number };
};

export type End = string | Point;

// id is the board arrow it updates, when merged into one already there.
// labelSize is the label's size on its backing, with the number's badge,
// for the room it needs.
export type ArrowDraft = { id?: string; from: End; to: End; label?: string; seq?: string; labelSize?: { w: number; h: number }; color: Color; bend?: number; narration?: string; line: number };

// pill is the shape's tag pill, part of its outline for arrows.
export type Rect = { x: number; y: number; w: number; h: number; pill?: { x: number; y: number; w: number; h: number } };

export type Link = { from: string; to: string };
