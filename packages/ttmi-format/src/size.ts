// One measurement of a node, before layout, routing, labels, the camera
// or the PNG. Nothing after this widens a box or moves an arrow's end
// onto a different rect. A folding note's badge is the head it keeps
// when open; arrows land on that, so folding the note does not move them.
import { CANVAS_MARK, MAX_NOTE_WIDTH, NOTE_WIDTH, TAG_LEFT } from "./constants";
import type { BoxDraft } from "./drafts";
import { boxSize, noteHeight, tagSize, widthForBadge } from "./estimate";
import { externalHref, portalLabelId, portalSketchId } from "./portal";
import type { SketchMeasure } from "./types";

// The miniature sits in the box's content box: a 2px border plus the
// rect's 12px horizontal and 8px vertical padding. The same insets the
// board's frame uses, so the height chosen here is the one the picture fills.
export const CANVAS_PAD_X = 14;
export const CANVAS_PAD_Y = 10;

// Content width / height. A child taller than 0.7 (about 5:7) does not
// make a taller box; a child wider than 2.2 does not make a shorter one.
// Either extreme would stop being a box.
export const CANVAS_RATIO_MIN = 0.7;
export const CANVAS_RATIO_MAX = 2.2;

// Wider than a labelled box, so the linked sketch's aspect has room to
// read. A long name still grows past it; an explicit size is a floor too.
export const CANVAS_MIN_WIDTH = 260;

export type ContentBounds = { w: number; h: number };

// The boxes and notes, the same span the miniature scales. Arrows stick
// out past it and are not part of the ratio.
export function contentBounds(shapes: { kind: string; x?: number; y?: number; w?: number; h?: number }[]): ContentBounds | undefined {
  const boxes = shapes.filter((shape): shape is { kind: string; x: number; y: number; w: number; h: number } => shape.kind !== "arrow" && shape.x !== undefined && shape.y !== undefined && shape.w !== undefined && shape.h !== undefined);
  if (!boxes.length) return undefined;
  const minX = Math.min(...boxes.map((box) => box.x));
  const minY = Math.min(...boxes.map((box) => box.y));
  const maxX = Math.max(...boxes.map((box) => box.x + box.w));
  const maxY = Math.max(...boxes.map((box) => box.y + box.h));
  return { w: Math.max(1, maxX - minX), h: Math.max(1, maxY - minY) };
}

// The ratio the box is built from: the child's content, clamped.
export function canvasRatio(bounds: ContentBounds): number {
  const ratio = bounds.w / Math.max(1, bounds.h);
  return Math.min(CANVAS_RATIO_MAX, Math.max(CANVAS_RATIO_MIN, ratio));
}

// The box height whose content frame matches `bounds`, given the width
// the label and the badge already required. Pure: the same width and the
// same bounds are the same height at every nesting level.
export function canvasBoxHeight(width: number, bounds: ContentBounds): number {
  const innerW = Math.max(1, width - CANVAS_PAD_X * 2);
  const innerH = innerW / canvasRatio(bounds);
  return Math.round(innerH + CANVAS_PAD_Y * 2);
}

// The external-link arrow: a 20px pill in the top-right corner. It is
// part of the box's size, the same way a tag is, and then left alone.
export const EXTERNAL_BADGE = 20;

export type Badge = { x: number; y: number; w: number; h: number };

// The words on a box's corner badge. A canvas shows the linked sketch's
// name when that is known, otherwise the box's own label. A tag is the
// badge of an ordinary box. An external link has no text badge.
export function boxBadgeText(box: { label: string; tag?: string; link?: string }, title?: string): { text: string; canvas: boolean } | undefined {
  const id = portalSketchId(box.link) ?? portalLabelId(box.label);
  if (id) {
    const name = title?.trim() || (portalLabelId(box.label) ? "" : box.label.trim());
    return name ? { text: name, canvas: true } : undefined;
  }
  const tag = box.tag?.trim();
  return tag ? { text: tag, canvas: false } : undefined;
}

// The pill as drawn: the text, and a canvas's magnifier before it.
export function pillSize(text: string, canvas: boolean, measure?: SketchMeasure) {
  const textSize = measure?.tag?.(text) ?? tagSize(text);
  return canvas ? { w: textSize.w + CANVAS_MARK, h: Math.max(textSize.h, 11) } : textSize;
}

// How many markdown blocks the note's HTML holds. More than one, and the
// note folds to its first line (docs/board.md, Notes fold).
export function htmlBlocks(html: string) {
  return (html.match(/<(?:h[1-6]|p|pre|ul|ol|blockquote)\b/gi) ?? []).length;
}

function htmlTitle(html: string) {
  const match = /^<(\w+)[^>]*>([\s\S]*?)<\/\1>/.exec(html);
  return (match?.[2] ?? "").replace(/<[^>]+>/g, "").split("\n")[0]!.trim();
}

// The folded head, when there is no board to measure it: the title and
// the chevron, in the pill the board draws.
export function noteHeadSize(title: string) {
  return { w: Math.max(48, Math.round(title.length * 7.4 + 40)), h: 26 };
}

// A note with more than one block folds to that head. Undefined when it
// does not fold. Used where there is no DOM (a canvas never opened).
export function estimatedFold(html: string) {
  if (htmlBlocks(html) <= 1) return undefined;
  return noteHeadSize(htmlTitle(html));
}

// Sizes for a layout with no board: the same estimates parse uses, and a
// folded head so arrows land on the badge a canvas draws.
export function textMeasure(): SketchMeasure {
  return {
    box: boxSize,
    note: (html, _width, size) => Math.round(Math.max(1, htmlBlocks(html)) * size * 1.55 + 16),
    noteWidth: () => 0,
    noteFolded: (html) => estimatedFold(html),
  };
}

// The note's drawn size. A note that folds is the size of its badge;
// layout and arrows then use that, and opening the note does not.
export function applyNoteSize(draft: BoxDraft, measure: SketchMeasure | undefined, asked: number | undefined) {
  draft.minWidth = asked ?? draft.minWidth ?? NOTE_WIDTH;
  const tagged = Boolean(draft.tag);
  // Without a measurer a note stays the estimated body. Callers that draw
  // the folded head (the board, a canvas that has not been opened) pass
  // noteFolded, and the badge is then the node's size.
  const head = measure?.noteFolded?.(draft.html, draft.minWidth, draft.size, draft.tag);
  if (head) {
    draft.folds = true;
    draft.codeWidth = 0;
    draft.w = head.w;
    draft.h = head.h;
    // The badge is the node. Opening grows a panel around it.
    draft.badge = { x: 0, y: 0, w: head.w, h: head.h };
    return;
  }
  draft.folds = false;
  draft.badge = undefined;
  draft.codeWidth = Math.min(MAX_NOTE_WIDTH, measure?.noteWidth(draft.html, draft.size) ?? 0);
  draft.w = Math.max(draft.minWidth, draft.codeWidth);
  draft.h = measure ? measure.note(draft.html, draft.w, draft.size, tagged) : noteHeight(draft.markdown, draft.size);
}

// The width the badge needs, 0 when the box has none. The label's own
// width is separate; the box is the wider of the two.
export function rectFloor(box: { label: string; tag?: string; link?: string; w?: number }, measure?: SketchMeasure, canvasTitles?: Readonly<Record<string, string>>) {
  const id = portalSketchId(box.link) ?? portalLabelId(box.label);
  const badge = boxBadgeText(box, id ? canvasTitles?.[id] : undefined);
  const pill = badge ? pillSize(badge.text, badge.canvas, measure) : undefined;
  const external = !id && Boolean(externalHref(box.link));
  return { pill, floor: Math.max(pill ? widthForBadge(pill.w) : 0, external ? widthForBadge(EXTERNAL_BADGE) : 0) };
}

// The box's drawn size: the label (or the size the text asked for), then
// the badge it will show. A canvas badge is the linked name, with its
// magnifier. An external link's arrow is the 20px corner pill. A canvas
// is then at least as tall as its linked sketch's content, so the
// miniature fills the box; the label's height and an explicit size stay
// a floor, and a missing child leaves the label height alone.
export function applyRectSize(draft: BoxDraft, measure: SketchMeasure | undefined, canvasTitles?: Readonly<Record<string, string>>, asked?: { w?: number; h?: number }, canvasBounds?: Readonly<Record<string, ContentBounds>>) {
  const size = measure ? measure.box(draft.label) : boxSize(draft.label);
  draft.w = asked?.w ?? size.w;
  draft.h = asked?.h ?? size.h;
  const { pill, floor } = rectFloor(draft, measure, canvasTitles);
  draft.tagSize = pill;
  if (floor) draft.w = Math.max(draft.w, floor);
  const id = portalSketchId(draft.link) ?? portalLabelId(draft.label);
  if (id) draft.w = Math.max(draft.w, CANVAS_MIN_WIDTH);
  const child = id ? canvasBounds?.[id] : undefined;
  if (child && child.w > 0 && child.h > 0) draft.h = Math.max(draft.h, canvasBoxHeight(draft.w, child));
  // The pill sits on the top edge, TAG_LEFT in from the left. Arrows
  // leave it, and it stays inside the width just chosen. A note's badge
  // is the whole node (applyNoteSize); a box's is this pill.
  draft.badge = pill ? { x: TAG_LEFT, y: -pill.h / 2, w: pill.w, h: pill.h } : undefined;
}
