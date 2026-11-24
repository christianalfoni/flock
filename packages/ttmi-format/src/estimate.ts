import { SEQ_BADGE, SEQ_GAP, TAG_LEFT } from "./constants";

// Rough sizes for shapes the text gives none for, used when there is no
// board to measure with. A note's real height is measured once it is on the
// board; these run short for text that wraps.
export function boxSize(label: string) {
  const lines = label.split("\n");
  const longest = Math.max(...lines.map((line) => line.length));
  return { w: Math.round(Math.min(320, Math.max(140, longest * 7.6 + 48))), h: Math.max(70, lines.length * 21 + 44) };
}

export function noteHeight(markdown: string, size: number) {
  const lines = markdown.split("\n").filter((line) => !/^\s*```/.test(line)).length;
  return Math.round(Math.max(1, lines) * size * 1.55 + 16);
}

// An arrow's label on its backing: 13 px text, 6 px of padding each side.
// A number adds its badge at the label's left; a number alone is the badge
// on its backing.
export function labelSize(label: string | undefined, seq?: string) {
  if (!label) return { w: SEQ_BADGE + 12, h: SEQ_BADGE + 2 };
  const lines = label.split("\n");
  const longest = Math.max(...lines.map((line) => line.length));
  const text = { w: Math.round(longest * 6.8 + 20), h: 24 * lines.length };
  return seq ? { w: text.w + SEQ_BADGE + SEQ_GAP, h: Math.max(text.h, SEQ_BADGE + 2) } : text;
}

// A tag's pill: 10.5 px uppercase text, 7 px of padding each side.
export function tagSize(tag: string) {
  return { w: Math.round(tag.length * 7.5 + 17), h: 19 };
}

// The box is at least this wide, so the pill (already including its padding
// and border) stays inside the corners. It starts TAG_LEFT in from the
// padding edge; the border is 2 px, and the same gap is kept at the right.
const BOX_BORDER = 2;
export function widthForBadge(pill: number) {
  const inset = BOX_BORDER + TAG_LEFT;
  return Math.ceil(pill + inset * 2);
}
