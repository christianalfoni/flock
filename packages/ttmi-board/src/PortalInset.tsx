// The linked sketch, drawn with the board's own shapes inside the box
// (docs/plan-portals.md). Deeper than two live levels, the frame stays a
// placeholder: the name on the badge, and no further sketch inside it.
import { externalHref, GROUP_GAP, groupRegion, portalLabelId, portalSketchId, regionMembers, startBoxes, type ArrowShape, type RectShape, type Shape, type SketchGroup, type SketchStep } from "@ttmi/format";
import { useId, useState } from "react";
import { ArrowSeq } from "./ArrowSeq";
import { GroupView } from "./GroupView";
import { NoteView } from "./NoteView";
import { ShapeTag } from "./ShapeTag";
import { CanvasBadge, ExternalLink } from "./badge";
import { layoutArrows } from "./present";
import { arrowHead, arrowLine, COLORS, foldsNote, isConnector, ON_COLORS, QUIET_COLORS } from "./shapes";
import { BACKGROUND, FOREGROUND } from "./styles";
import { TermText } from "./terms";
import { contentFrame, fitInFrame, frameInner, nestOf, type Nest } from "./portal-nest";

export type PortalRecord = {
  status: "loading" | "open" | "locked" | "missing";
  title?: string;
  shapes?: Shape[];
  steps?: SketchStep[];
  groups?: SketchGroup[];
  // The linked sketch's content bounds, saved with the board. Used when
  // this level is only a name, so the box can take its height before the
  // drawing is fetched.
  bounds?: { w: number; h: number };
  // The text of a sketch that has never been laid out. Measured for its
  // bounds and not drawn.
  source?: string;
  // The document arrived and the text has not. The preview waits for it
  // only up to the same cap as a linked name.
  pendingDrawing?: boolean;
};

const LIVE = 2;

export function portalTargetOf(shape: Shape, host?: string) {
  if (shape.kind !== "rect") return undefined;
  return portalSketchId(shape.link, host) ?? portalLabelId(shape.label, host);
}

export function PortalInset({ shapes, groups = [], width, height, depth, portals, host, onOpen, openId, highlight, view, path, liveIds, reveal = false, takeReveal }: {
  shapes: Shape[];
  groups?: SketchGroup[];
  width: number;
  height: number;
  depth: number;
  portals?: Readonly<Record<string, PortalRecord>>;
  host?: string;
  onOpen?(id: string): void;
  openId?: string;
  highlight?: ReadonlySet<string>;
  view?: { w: number; h: number };
  // Portals on the way to the open sketch, and the ones that stay live
  // (the open sketch and its own portals). Absent, the depth cap applies.
  path?: ReadonlySet<string>;
  liveIds?: ReadonlySet<string>;
  // First time this preview has content: fade it in. Later mounts (a zoom
  // back) stay opaque, and the PNG export clears the animation.
  reveal?: boolean;
  takeReveal?(id: string): boolean;
}) {
  const maskId = `portal-gap-${useId().replace(/:/g, "")}`;
  // Captured for this mount. The parent stops asking after the first render,
  // and a later mount (zooming back) is passed reveal false.
  const [play] = useState(reveal);
  const nest = nestOf(shapes);
  if (!nest) return null;
  const fitted = fitInFrame({ x: 0, y: 0, w: width, h: height }, nest, insetScale({ w: width + 28, h: height + 20 }, nest, view));
  const boxes = shapes.filter((shape) => shape.kind !== "arrow");
  const arrows = shapes.filter((shape): shape is ArrowShape => shape.kind === "arrow");
  // The same face the board gives a box that is not being played: the start
  // of a sequence is filled, a portal never is.
  const primary = startBoxes(shapes);
  const face = (shape: RectShape) => primary.has(shape.id) && !portalTargetOf(shape, host)
    ? { borderColor: COLORS[shape.color], background: COLORS[shape.color], color: ON_COLORS[shape.color] }
    : { borderColor: shape.tag ? COLORS[shape.color] : COLORS.white, background: BACKGROUND, color: FOREGROUND };
  const local = (x: number, y: number) => ({ x: x - nest.minX, y: y - nest.minY });
  const shiftedArrows = arrows.map((arrow) => ({ ...arrow, from: local(arrow.from.x, arrow.from.y), to: local(arrow.to.x, arrow.to.y) }));
  const arrowLayout = layoutArrows(shiftedArrows, boxes.map((shape) => ({ x: shape.x - nest.minX, y: shape.y - nest.minY, w: shape.w, h: shape.h })));
  const regions = groups.flatMap((group) => {
    const members = regionMembers(group, boxes);
    if (!members.length) return [];
    const region = groupRegion(members);
    return [{ group, region: { x: region.x - nest.minX, y: region.y - nest.minY, w: region.w, h: region.h } }];
  });
  return (
    <div className={`sketch-portal-inset${play ? " sketch-portal-reveal" : ""}`} style={{ position: "absolute", left: 12, right: 12, top: 8, bottom: 8, overflow: "hidden" }}>
      <div style={{ position: "absolute", left: fitted.x, top: fitted.y, width: nest.w, height: nest.h, transform: `scale(${fitted.s})`, transformOrigin: "0 0" }}>
        {regions.map(({ group, region }) => <GroupView key={group.name} group={group} region={region} />)}
        <svg className="sketch-arrows">
          {regions.length > 0 && (
            <defs>
              <mask id={maskId} maskUnits="userSpaceOnUse" x={-100000} y={-100000} width={200000} height={200000}>
                <rect x={-100000} y={-100000} width={200000} height={200000} fill="#fff" />
                {regions.map(({ region }, index) => <rect key={index} x={region.x} y={region.y} width={region.w} height={region.h} rx={6} fill="none" stroke="#000" strokeWidth={2 * GROUP_GAP} />)}
              </mask>
            </defs>
          )}
          {shiftedArrows.map((arrow, index) => {
            const connector = isConnector(shapes, arrows[index]!);
            const drawnArrow = arrowLayout.shown(arrow);
            const stroke = { stroke: QUIET_COLORS[arrow.color], strokeLinecap: "round" as const, strokeLinejoin: "round" as const, fill: "none" };
            return (
              <g key={arrow.id} mask={regions.length > 0 ? `url(#${maskId})` : undefined}>
                <path className={connector ? "sketch-line" : "sketch-arrow"} d={arrowLine(drawnArrow)} style={stroke} />
                {!connector && <path className="sketch-arrow-head" d={arrowHead(drawnArrow)} style={stroke} />}
              </g>
            );
          })}
        </svg>
        {boxes.map((shape) => {
          const left = shape.x - nest.minX;
          const top = shape.y - nest.minY;
          if (shape.kind === "note") {
            return (
              <NoteView
                key={shape.id}
                note={{ ...shape, x: left, y: top }}
                editing={false}
                fold={foldsNote(shape) ? "folded" : "none"}
                width={shape.w}
                tagged={false}
                terms={[]}
                className={highlight?.has(shape.id) ? "sketch-step-current" : ""}
                onEditor={() => undefined}
                onChange={() => undefined}
                onMeasure={() => undefined}
                onToggleFold={() => undefined}
              />
            );
          }
          const target = portalTargetOf(shape, host);
          const child = target ? portals?.[target] : undefined;
          const live = Boolean(target && child?.status === "open" && child.shapes?.length && (liveIds ? liveIds.has(target) : depth + 1 < LIVE));
          const onPath = Boolean(target && path?.has(target));
          const badge = target ? insetBadge(shape.label, child, host) : "";
          return (
            <div
              key={shape.id}
              data-shape-id={shape.id}
              data-name={shape.name}
              className={`sketch-rect${target ? " sketch-portal" : ""}${highlight?.has(shape.id) ? " sketch-step-current" : ""}`}
              style={{ left, top, width: shape.w, height: shape.h, ...face(shape) }}
              {...(target ? { "data-link": target, "data-status": (liveIds ? !liveIds.has(target) : depth + 1 >= LIVE) ? "placeholder" : child?.status ?? "loading", ...(onPath ? { "data-portal-path": "" } : {}), ...(target === openId ? { "data-portal-open": "" } : {}) } : {})}
            >
              {target ? (
                badge ? <CanvasBadge text={badge} color={shape.color} /> : null
              ) : <ShapeTag shape={shape} editing={false} onSave={() => undefined} />}
              {target ? null : shape.label && <div className="sketch-label"><TermText text={shape.label} terms={[]} /></div>}
              {!target && externalHref(shape.link) && <ExternalLink href={externalHref(shape.link)!} color={shape.color} />}
              {live && child?.shapes && (
                <PortalInset shapes={child.shapes} groups={child.groups} width={Math.max(1, shape.w - 28)} height={Math.max(1, shape.h - 20)} depth={depth + 1} portals={portals} host={host} onOpen={onOpen} openId={openId} highlight={highlight} view={view} path={path} liveIds={liveIds} reveal={target ? takeReveal?.(target) ?? false : false} takeReveal={takeReveal} />
              )}
              {target && onOpen && (
                <button
                  type="button"
                  className="sketch-link"
                  data-link={target}
                  aria-label={child?.status === "locked" ? "Private sketch" : `Zoom into ${child?.title || "this canvas"}`}
                  style={onPath ? { pointerEvents: "none" } : undefined}
                  onPointerDown={(event) => { event.stopPropagation(); event.preventDefault(); }}
                  onClick={(event) => { event.stopPropagation(); onOpen(target); }}
                />
              )}
            </div>
          );
        })}
        {arrows.map((arrow) => (arrow.label || arrow.seq) && (
          <div key={`${arrow.id}-label`} className={`sketch-arrow-label ${arrow.seq ? "sketch-arrow-label-seq" : ""}`} style={{ left: arrowLayout.label(arrow).x, top: arrowLayout.label(arrow).y, color: FOREGROUND }}>
            <ArrowSeq arrow={arrow} editing={false} onSave={() => undefined} onHover={() => undefined} />
            {arrow.label && <div className="sketch-label"><TermText text={arrow.label} terms={[]} /></div>}
          </div>
        ))}
      </div>
    </div>
  );
}

// The same words the board's badge uses. A refusal never carries the title.
function insetBadge(label: string, card: PortalRecord | undefined, host?: string) {
  const labelIsUrl = Boolean(portalLabelId(label, host));
  if (!card || card.status === "loading") return labelIsUrl ? "" : label;
  if (card.status === "locked") return "Private";
  if (card.status === "missing") return "Not found";
  return card.title || (labelIsUrl ? "" : label);
}

function insetScale(box: { w: number; h: number }, nest: Nest, view?: { w: number; h: number }) {
  return view && view.w > 0 && view.h > 0 ? frameInner({ x: 0, y: 0, ...box }, nest, view) : undefined;
}

export function frameOfPortal(shapes: Shape[], portals: Readonly<Record<string, PortalRecord>> | undefined, sketchId: string, host?: string, view?: { w: number; h: number }, depth = 0, seen?: ReadonlySet<string>): { x: number; y: number; w: number; h: number } | undefined {
  for (const shape of shapes) {
    if (shape.kind !== "rect") continue;
    const target = portalTargetOf(shape, host);
    if (target === sketchId) {
      const nest = nestOf(portals?.[sketchId]?.shapes ?? []);
      const content = contentFrame(shape);
      return nest ? fitInFrame(content, nest, insetScale(shape, nest, view)) : content;
    }
    // Follow the chain as deep as the sketches go. A cycle stops.
    if (!target || depth >= 8 || seen?.has(target)) continue;
    const child = portals?.[target]?.shapes;
    if (!child) continue;
    const inner = frameOfPortal(child, portals, sketchId, host, view, depth + 1, new Set([...(seen ?? []), target]));
    if (!inner) continue;
    const nest = nestOf(child);
    if (!nest) continue;
    const fitted = fitInFrame(contentFrame(shape), nest, insetScale(shape, nest, view));
    const s = fitted.s;
    return { x: fitted.x + (inner.x - nest.minX) * s, y: fitted.y + (inner.y - nest.minY) * s, w: inner.w * s, h: inner.h * s };
  }
  return undefined;
}
