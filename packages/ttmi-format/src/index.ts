// The sketch text format: how agents draw and read sketches back.
// It describes what is on the board and what connects to what; positions
// are optional, and whatever has none is laid out here. Parsing turns it
// into board shapes (merging into a board's current shapes, if given);
// serializing writes the board back out.
//
//   # sketch Job retries
//   direction: right
//   api: box "API server" blue tint
//   plan: note
//     ## Plan
//     Retry **twice**.
//   api -> plan "reads"
//
// docs/format.md describes the format in full.
export type { ArrowShape, BoxShape, Color, NoteShape, Point, RectShape, Shape, SketchGroup, SketchMeasure, SketchStep, SketchTerm } from "./types";
export { SketchFormatError } from "./types";
export { CANVAS_MARK, COLORS, DEFAULT_TEXT_SIZE, GROUP_GAP, GROUP_HEAD, GROUP_PAD, HOP, MAX_NOTE_WIDTH, SEQ, TAG_LEFT } from "./constants";
export { boxSize, labelSize, noteHeight, tagSize, widthForBadge } from "./estimate";
export { codeBlocks, LANGUAGES, MAX_CODE_LINE, SCRIPT_LANGUAGES, type CodeBlock, type CodeCheck } from "./code";
export { arrowControl, arrowMidpoint, bendThrough } from "./curves";
export { placeEdges, type EdgeInput, type PlacedEdge } from "./present";
export { isBoxShape, nearBox } from "./geometry";
export { groupRegion, regionMembers } from "./groups";
export { refitSketch } from "./fit";
export { parseSketch, sketchSlug, sketchTitle } from "./parse";
export { externalHref, keptLink, portalIdsInSource, portalLabelId, portalSketchId } from "./portal";
export { CANVAS_MIN_WIDTH, CANVAS_PAD_X, CANVAS_PAD_Y, CANVAS_RATIO_MAX, CANVAS_RATIO_MIN, EXTERNAL_BADGE, boxBadgeText, canvasBoxHeight, canvasRatio, contentBounds, noteHeadSize, pillSize, rectFloor, textMeasure, type ContentBounds } from "./size";
export { serializeSketch, sketchBlock } from "./serialize";
export { hopEnds, sequenceCanvas, stepView } from "./steps";
export { termKey, termRuns, type TermRun } from "./terms";
export { keepReferences, narrationParts, narrationText, referableNames, stepParts, type NarrationPart } from "./references";
export { startBoxes } from "./start";
