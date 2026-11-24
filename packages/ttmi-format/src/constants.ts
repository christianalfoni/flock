import type { Color } from "./types";

export const COLORS: Color[] = ["white", "red", "orange", "yellow", "green", "blue", "violet"];
// The fill words a box once took (docs/format.md, Boxes). A sketch saved
// with them still reads, and they mean nothing; a new save refuses them.
export const OLD_FILLS = ["none", "tint", "solid"];
export const DEFAULT_TEXT_SIZE = 14;
export const NAME = /^[A-Za-z_][\w-]*$/;
// An arrow's number: 1 to 99, with a letter for a branch (2a, 2b).
export const SEQ = /^[1-9]\d?[a-z]?$/;
// A hop of the flow, by its arrow's number: what a step or a reference in
// narration may name besides shapes and groups (docs/format.md, Steps).
export const HOP = /^#[1-9]\d?[a-z]?$/;
// The number's badge, a circle at the label's left, and the space after it
// (docs/board.md, Arrow).
export const SEQ_BADGE = 18;
export const SEQ_GAP = 5;
export const PAIR = /^(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)$/;
// Room between laid-out columns, wide enough for an arrow's label, while
// the drawing fits one screen along its direction (FIT_ALONG, or FIT_DOWN
// for direction down: 1440 × 900 with 40 px margins); past that the columns
// close up evenly, never under GAP_ALONG_MIN (docs/format.md, Layout).
export const GAP_ALONG = 220;
export const GAP_ALONG_MIN = 56;
export const FIT_ALONG = 1360;
export const FIT_DOWN = 820;
export const GAP_ACROSS = 64;
// A group's region reaches this far past its members' bounding box, and
// GROUP_HEAD more at the top for its label (docs/board.md, Group): room for
// an arrow that crosses the edge to show its break (GROUP_GAP each side),
// some line and its head before the box (2026-10-20; it was 16).
export const GROUP_PAD = 32;
// An arrow breaks this far on each side of a group's edge it crosses: a
// narrower gap than the one it keeps from a box (2026-10-20).
export const GROUP_GAP = 3;
export const GROUP_HEAD = 24;
// A note's default width: about 60 characters of 14 px prose, the line
// length that reads best (docs/plan-elements.md, item 10).
export const NOTE_WIDTH = 420;
export const MAX_NOTE_WIDTH = 960;
// An arrow's label needs the arrow to show on both sides of it: two
// columns joined by a labelled arrow are at least the label plus this
// much on each side apart (docs/format.md, Layout).
export const LABEL_ROOM = 28;
// A tag's pill sits on the shape's top edge, centred on it, this far in
// from the shape's left (docs/board.md, Tag); arrows end on the pill where
// they would otherwise go under it.
export const TAG_LEFT = 10;
// The magnifier at the start of a canvas badge, and the gap before the
// name (docs/board.md, Tag). A normal tag has neither.
export const CANVAS_MARK = 15;
