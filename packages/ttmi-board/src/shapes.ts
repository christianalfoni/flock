// The board's own view of shapes: tools, the camera, drags, colours, and the
// geometry helpers the board draws with. The shape types themselves come from
// the format package.
import { arrowControl, arrowMidpoint, nearBox, type ArrowShape, type BoxShape, type Color, type NoteShape, type Point, type RectShape, type Shape, type SketchGroup, type SketchStep, type SketchTerm } from "@ttmi/format";
import { layoutArrows } from "./present";

export type Box = BoxShape;
export type Tool = "select" | "rect" | "note" | "arrow";
export type Camera = { x: number; y: number; z: number };

export type Drag =
  | { kind: "pan"; startX: number; startY: number; camera: Camera; seq?: string }
  // open: a folded note the click opens if it turns out not to be a drag;
  // the drag selects it, as any shape, once it moves.
  | { kind: "move"; last: Point; ids: string[]; moved: boolean; open?: string }
  | { kind: "resize"; id: string; corner: string; origin: Point; original: Box }
  | { kind: "create-rect"; id: string; origin: Point }
  | { kind: "arrow-end"; id: string; end: "from" | "to"; created: boolean }
  | { kind: "arrow-bend"; id: string }
  | { kind: "marquee"; origin: Point; additive: string[] };

// What a page can ask the board for: a PNG, the board as sketch text, a
// merge of sketch text into it (with the reason when it could not be read),
// and playback from the first step.
export type SketchApi = {
  toPng(): Promise<Blob | undefined>;
  // The SVG the PNG is painted from, fonts and all.
  toSvg(): Promise<string | undefined>;
  toSketch(): string;
  // Waits for the board's fonts before it measures (docs/board.md, Fonts).
  // With play, the walkthrough opens ready to start, as play() does.
  import(text: string, play?: boolean): Promise<{ error?: string }>;
  // Opens the walkthrough ready to start: the whole drawing, and the
  // caption waiting for Space or Play (docs/board.md, Walkthrough).
  play(): void;
  // Opens the walkthrough paused at a step. N is from 1, as the step bar
  // counts it (?step= on /s/:id). False when that stop does not exist.
  openAt(step: number): boolean;
  // Starts that step from the beginning. An answer to an ask continues
  // here, because the step may have changed.
  playFrom(step: number): boolean;
  // From ready (or anywhere) to the walkthrough's first step.
  start(): void;
  // The walkthrough's next step, while it plays: the front page's demo
  // moves on when a stop's voice ends (docs/plan-landing-demo.md).
  next(): void;
  // Shows the board as it was saved elsewhere (another tab or device): the
  // shapes, steps and groups replace the board's, without a save and with
  // the view where it is. Declined, with false, while the board has changes
  // of its own not yet saved: the save that follows overwrites what arrived.
  replace(shapes: Shape[], steps: SketchStep[], groups: SketchGroup[], terms?: SketchTerm[]): boolean;
  // Resolves once the imports so far are in, their code formatted, and the
  // board drawn: what a headless export waits for (docs/plan-png-export.md).
  settled(): Promise<void>;
  // The sketch's terms replaced, as an edit that is saved: a newer
  // definition from the glossary taken (docs/board.md, Terms).
  setTerms(terms: SketchTerm[]): void;
  // The camera, so a portal can put it back where the parent left it.
  getCamera(): Camera;
  // Show this linked sketch (its steps, and the camera zoomed into its
  // frame), or null to return to the board's own sketch. The world stays.
  setPortalFocus(sketchId: string | null): void;
  // The linked sketches' content bounds, or the text of one that was never
  // laid out, so a headless export sizes a canvas the way the board does.
  setCanvases(canvases: Record<string, { w?: number; h?: number; source?: string }>): void;
};
// Sketch text to merge into the board; a new id is a new import.
// play starts the sketch's walkthrough once it is in, when it has steps.
export type SketchImport = { id: number; text: string; play?: boolean };

// The seven colours of the format, as the board palette's variables
// (styles.ts): tuned for the light ground and lifted for the dark one; the
// web app shows them as --shape-* tokens. "white" is the plain colour, so
// it is ink on either ground.
const palette = (prefix: string) => Object.fromEntries((["white", "red", "orange", "yellow", "green", "blue", "violet"] as Color[]).map((name) => [name, `var(--${prefix}-${name})`])) as Record<Color, string>;
export const COLORS = palette("shape");
// Text on a solid fill of each colour: white, but ink on yellow (and ink on
// all of them at night).
export const ON_COLORS = palette("shape-on");
// A tag: solid in its shape's colour, text on it as on the arrow's badge
// (white, ink on yellow), so a state reads the same on a box and an arrow.
export function tagStyle(color: Color) {
  return { borderColor: COLORS[color], background: COLORS[color], color: ON_COLORS[color] };
}
// An arrow's colour at rest: halfway to the board's ground, but solid, so
// nothing behind the line (a group's edge) shows through it. Focus draws
// the full colour (docs/board.md, Arrow).
export const QUIET_COLORS = Object.fromEntries(Object.entries(COLORS).map(([name, color]) => [name, `color-mix(in srgb, ${color} 50%, var(--board))`])) as Record<Color, string>;
// A note's own colour, when it has no state: an amber, with ink on it.
export const NOTE_COLOR = "#f2b544";
export const NOTE_ON_COLOR = "#2a2745";
export const COLOR_NAMES = Object.keys(COLORS) as Color[];
// Copied shapes travel through the system clipboard under this type, with
// their text as plain text for pasting anywhere else.
export const CLIPBOARD_TYPE = "application/x-ttmi-sketch";
export const EDITABLE = '[contenteditable="true"], [contenteditable="plaintext-only"]';
// Text sizes E and Q step through, in pixels.
export const TEXT_SIZES = [11, 12, 14, 16, 18, 22, 28, 36, 48];
export const DEFAULT_TEXT_SIZE = 14;

// --- Geometry ---------------------------------------------------------------

export function isBox(shape: Shape): shape is Box {
  return shape.kind !== "arrow";
}

export function arrowPoints(arrow: ArrowShape): [Point, Point] {
  return [arrow.from, arrow.to];
}

// A painted arrow. `control` is the quadratic's control point when the
// stroke is a piece of a longer curve; a bend between the cut ends is a
// different curve.
export type DrawnArrow = ArrowShape & { control?: Point };

// The line of an arrow: straight, or a quadratic curve through its bend.
export function arrowLine(arrow: DrawnArrow) {
  const [a, b] = arrowPoints(arrow);
  const control = arrow.control ?? (arrow.bend ? arrowControl(a, b, arrow.bend) : undefined);
  return control ? `M ${a.x} ${a.y} Q ${control.x} ${control.y} ${b.x} ${b.y}` : `M ${a.x} ${a.y} L ${b.x} ${b.y}`;
}

// The head at the arrow's end, pointing along the line, or along the curve
// where it ends.
export function arrowHead(arrow: DrawnArrow) {
  const [a, b] = arrowPoints(arrow);
  const tail = arrow.control ?? (arrow.bend ? arrowControl(a, b, arrow.bend) : a);
  const angle = Math.atan2(b.y - tail.y, b.x - tail.x);
  const head = (turn: number) => ({ x: b.x - 12 * Math.cos(angle + turn), y: b.y - 12 * Math.sin(angle + turn) });
  const left = head(0.45);
  const right = head(-0.45);
  return `M ${left.x} ${left.y} L ${b.x} ${b.y} L ${right.x} ${right.y}`;
}

export function arrowPath(arrow: DrawnArrow) {
  return `${arrowLine(arrow)} ${arrowHead(arrow)}`;
}

// An arrow whose start sits on a note is the note's connector: "this note
// describes that part" is a relation, not a flow, so it is drawn as a line
// with no head (docs/board.md, Shapes). Decided from the geometry at render
// time, with the test the step view uses for an arrow's ends, so the text
// stays "->" and dragging the start off the note gives the head back.
export function isConnector(shapes: Shape[], arrow: ArrowShape) {
  return nearBox(shapes.filter(isBox), arrow.from)?.kind === "note";
}

export function bounds(shapes: Shape[]) {
  // The curve and label the board actually draws. An arrow whose bend is
  // unchanged and whose label stays at the middle contributes the same
  // points as before, so a fit of a clear drawing does not move.
  const arrows = shapes.filter((shape): shape is ArrowShape => shape.kind === "arrow");
  const layout = arrows.length ? layoutArrows(arrows, shapes.filter(isBox)) : undefined;
  const points = shapes.flatMap((shape) => {
    if (isBox(shape)) return [{ x: shape.x, y: shape.y }, { x: shape.x + shape.w, y: shape.y + shape.h }];
    const bend = layout?.bend(shape) ?? shape.bend;
    const label = layout && (shape.label || shape.seq) ? layout.label(shape) : undefined;
    return [...arrowPoints(shape), arrowMidpoint(shape.from, shape.to, bend), ...(label ? [label] : [])];
  });
  if (points.length === 0) return undefined;
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
}

// A box the user has placed: no longer where the layout put it, so an
// update keeps the board's positions (docs/format.md, Merge).
export function placedByUser<T extends Box>(shape: T): T {
  if (!shape.laidOut) return shape;
  const { laidOut: _laidOut, ...rest } = shape;
  return rest as T;
}

export function moveShape(shape: Shape, dx: number, dy: number): Shape {
  if (isBox(shape)) return { ...placedByUser(shape), x: shape.x + dx, y: shape.y + dy };
  return { ...shape, from: { x: shape.from.x + dx, y: shape.from.y + dy }, to: { x: shape.to.x + dx, y: shape.to.y + dy } };
}

export function shapeText(shape: Shape) {
  if (shape.kind === "note") return new DOMParser().parseFromString(shape.html, "text/html").body.innerText.trim();
  return shape.label?.trim() ?? "";
}

export function escapeHtml(text: string) {
  return text.replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[char]!);
}

export function isEmptyHtml(html: string) {
  return !/<pre/.test(html) && html.replace(/<[^>]*>/g, "").trim() === "";
}

// A note with more than one block folds to its first line in the overview
// (docs/board.md, Notes fold); a note with one block never folds. Counted
// on the note's HTML, once per content.
const blockCounts = new Map<string, number>();
// A note's title: its first block's text, on one line.
const titles = new Map<string, string>();
export function noteTitle(html: string) {
  let title = titles.get(html);
  if (title === undefined) {
    const first = new DOMParser().parseFromString(html, "text/html").body.firstElementChild;
    title = (first?.textContent ?? "").split("\n")[0]!.trim();
    titles.set(html, title);
  }
  return title;
}

export function noteBlocks(html: string) {
  let count = blockCounts.get(html);
  if (count === undefined) {
    count = new DOMParser().parseFromString(html, "text/html").body.children.length;
    blockCounts.set(html, count);
  }
  return count;
}

export function foldsNote(note: NoteShape) {
  return noteBlocks(note.html) > 1;
}

