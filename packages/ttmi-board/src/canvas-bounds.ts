// The content bounds of every linked sketch, measured before the parent
// is laid out. A canvas element's height is that ratio. The same cards
// and the same measurer produce the same bounds inside a parent and when
// the sketch is the root, so a zoom does not resize the box.
import { contentBounds, parseSketch, portalIdsInSource, portalLabelId, portalSketchId, refitSketch, textMeasure, type ContentBounds, type Shape, type SketchMeasure } from "@ttmi/format";
import type { PortalRecord } from "./PortalInset";

export type CanvasLock = ReadonlyMap<string, Readonly<Record<string, ContentBounds>>>;

export type LaidCanvases = {
  bounds: Record<string, ContentBounds>;
  // Cards that already had a drawing. A title-only sketch is measured for
  // its bounds and not returned here, so it is not drawn.
  fitted: Record<string, Shape[]>;
  // The child bounds each sketch was sized from. Frozen by the caller
  // after the names have arrived, so a later measurement cannot resize it.
  used: Record<string, Record<string, ContentBounds>>;
  // A child is still loading, or not in the map yet. "loading" is not
  // given up on; "absent" is a child the page has not started fetching.
  waiting: Record<string, "loading" | "absent">;
};

function titlesOf(portals: Readonly<Record<string, PortalRecord>>): Record<string, string> {
  const titles: Record<string, string> = {};
  for (const [id, card] of Object.entries(portals)) {
    if (card.status === "locked") titles[id] = "Private";
    else if (card.status === "missing") titles[id] = "Not found";
    else if (card.status === "open" && card.title?.trim()) titles[id] = card.title.trim();
  }
  return titles;
}

function childIds(card: PortalRecord, host?: string): string[] {
  const ids: string[] = [];
  const add = (id: string | undefined) => {
    if (id && !ids.includes(id)) ids.push(id);
  };
  if (card.shapes?.length) {
    for (const shape of card.shapes) {
      if (shape.kind !== "rect") continue;
      add(portalSketchId(shape.link, host) ?? portalLabelId(shape.label, host));
    }
    return ids;
  }
  if (card.source) for (const id of portalIdsInSource(card.source, host)) add(id);
  return ids;
}

// Bottom up: a sketch's portals are sized from its children's bounds, and
// its own bounds are the span of that layout. `locked` freezes the child
// bounds a sketch was already drawn with.
export function layCanvases(portals: Readonly<Record<string, PortalRecord>> | undefined, measure: SketchMeasure | undefined, host?: string, locked?: CanvasLock): LaidCanvases {
  const bounds: Record<string, ContentBounds> = {};
  const fitted: Record<string, Shape[]> = {};
  const used: Record<string, Record<string, ContentBounds>> = {};
  const waiting: Record<string, "loading" | "absent"> = {};
  if (!portals) return { bounds, fitted, used, waiting };
  const titles = titlesOf(portals);
  const memo = new Map<string, ContentBounds | undefined>();
  const visiting = new Set<string>();

  const visit = (id: string): ContentBounds | undefined => {
    if (memo.has(id)) return memo.get(id);
    if (visiting.has(id)) return undefined;
    const card = portals[id];
    if (!card || card.status !== "open") {
      memo.set(id, undefined);
      return undefined;
    }
    visiting.add(id);
    const children = childIds(card, host);
    const childBounds: Record<string, ContentBounds> = {};
    const freeze = locked?.get(id);
    if (freeze) {
      for (const [child, box] of Object.entries(freeze)) childBounds[child] = box;
    } else {
      let wait: "loading" | "absent" | undefined;
      for (const child of children) {
        const other = portals[child];
        if (!other) wait = wait === "loading" ? wait : "absent";
        else if (other.status === "loading" || (other.status === "open" && !other.shapes?.length && !other.source && !(other.bounds && other.bounds.w > 0))) wait = "loading";
        else {
          const box = visit(child);
          if (box) childBounds[child] = box;
          const childWait = waiting[child];
          if (childWait === "loading") wait = "loading";
          else if (childWait === "absent" && wait !== "loading") wait = "absent";
        }
      }
      if (wait) waiting[id] = wait;
    }
    used[id] = childBounds;
    let laid: Shape[] | undefined;
    if (card.shapes?.length) {
      try {
        laid = refitSketch(card.shapes, card.steps ?? [], card.groups ?? [], [], measure, titles, childBounds) ?? card.shapes;
      } catch {
        laid = card.shapes;
      }
      fitted[id] = laid;
    } else if (card.bounds && card.bounds.w > 0 && card.bounds.h > 0) {
      // Saved with the board. The same numbers next time, before the
      // drawing is fetched, and the same ones the PNG uses.
      memo.set(id, card.bounds);
      bounds[id] = card.bounds;
      visiting.delete(id);
      return card.bounds;
    } else if (card.source) {
      // The same two passes a full card gets: the text estimate, then the
      // board's measurer. A title-only sketch then has the bounds the
      // drawing will have when it is opened.
      try {
        const estimated = parseSketch(card.source, textMeasure(), [], { canvasTitles: titles });
        laid = refitSketch(estimated.shapes, estimated.steps, estimated.groups, [], measure, titles, childBounds) ?? estimated.shapes;
      } catch {
        laid = undefined;
      }
    }
    const box = laid ? contentBounds(laid) : undefined;
    if (box) bounds[id] = box;
    memo.set(id, box);
    visiting.delete(id);
    return box;
  };

  for (const id of Object.keys(portals)) visit(id);
  return { bounds, fitted, used, waiting };
}
