// The board's shapes, as the format reads and writes them. The board draws
// them; the format only needs their geometry and content.
export type Point = { x: number; y: number };
export type Color = "white" | "red" | "orange" | "yellow" | "green" | "blue" | "violet";
// name is the shape's name in the sketch text format, when it has one.
// tag is a short category shown on a box's or note's top-left corner.
// link is another sketch this box opens, or an http(s) page (docs/format.md,
// Boxes). The agent owns it, like the tag. A sketch id or a ttmi sketch
// URL is a canvas; any other http(s) URL is an external link.
// laidOut marks a box that is where the layout put it: nobody has moved it
// (docs/format.md, Merge). Boxes saved before the mark existed have none
// and count as the user's.
export type RectShape = { kind: "rect"; id: string; name?: string; tag?: string; link?: string; x: number; y: number; w: number; h: number; color: Color; label: string; laidOut?: true };
// A note's height follows its text; h is the last measured height, kept so
// arrows land on its edge before it is measured again. w is the width
// drawn: a note with more than one block folds to its first line in the
// overview (docs/board.md, Notes fold), so w is that line's width; a note
// with one block is widened to fit its code. minWidth is the width the
// text asked for ("width W", default 340): the least an open note is, and
// what an export writes back. Notes saved before it existed have none,
// and w stands in for it.
// size is the text size in pixels; notes saved before it existed are 14.
export type NoteShape = { kind: "note"; id: string; name?: string; tag?: string; x: number; y: number; w: number; h: number; color: Color; html: string; size?: number; minWidth?: number; laidOut?: true };
// Arrows are free: both ends stay where they were put.
// The label, if any, belongs at the curve's middle. The board may draw it
// further along the curve when that middle would cover a box or a label.
// bend curves the arrow: its middle sits that many pixels to the side.
// seq is its number in the order of the flow, drawn as a badge at the
// label's left: 1 to 99, with a letter for a branch ("2a").
// narration is what is said at this hop of a walkthrough (docs/format.md,
// Walkthrough); only a numbered arrow has it.
export type ArrowShape = { kind: "arrow"; id: string; from: Point; to: Point; color: Color; label?: string; seq?: string; bend?: number; narration?: string };
export type Shape = RectShape | NoteShape | ArrowShape;
export type BoxShape = RectShape | NoteShape;

export class SketchFormatError extends Error {}

// A step of a sketch's walkthrough: the shapes it brings in (or, already
// showing, points at again) and what is said while it is on screen.
// kind: a stop of a walkthrough written as an overview, the numbered
// arrows and a summary (docs/format.md, Walkthrough), derived from the
// text; a step written with "step:" has none.
export type SketchStep = { names: string[]; narration: string; kind?: "overview" | "hop" | "summary" };

// A group: a region drawn behind its members, which are boxes and notes by
// name (docs/format.md, Groups). It has no position or size of its own: the
// region is the members' bounding box, so the user's layout wins by
// construction and nothing is stored for it. A shape is in one group at
// most; groups do not nest. Steps may name a group, which names its members.
export type SketchGroup = { name: string; label: string; color: Color; tag?: string; members: string[] };

// Real sizes, measured with the board's own styles. Without it (outside the
// board) sizes are estimated, and long text comes out too short.
export type SketchMeasure = {
  box(label: string): { w: number; h: number };
  // tagged: the note has a tag, which it makes room for at its top
  // (docs/board.md, Tag).
  note(html: string, width: number, size: number, tagged?: boolean): number;
  // The width a note needs for its code blocks not to wrap; 0 without code.
  noteWidth(html: string, size: number): number;
  // The size of the note folded to its head (its tag, its first block on
  // one line, the chevron), at most width wide; undefined for a note with
  // one block, which never folds.
  noteFolded(html: string, width: number, size: number, tag?: string): { w: number; h: number } | undefined;
  // The size of an arrow's label on its backing, with its number's badge
  // (text is empty for a number alone), and of a tag's pill; estimated from
  // the text when a measurer leaves them out.
  label?(text: string, seq?: string): { w: number; h: number };
  tag?(text: string): { w: number; h: number };
};

// A term the sketch uses and what it means (docs/format.md, Terms): the
// board marks the word wherever it is read and shows the definition on
// hover. The sketch carries its own copy, whatever glossary it came from.
export type SketchTerm = { term: string; definition: string };
