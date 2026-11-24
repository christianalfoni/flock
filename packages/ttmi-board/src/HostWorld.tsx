// The parent drawing while a zoom is in flight. The picture itself is the
// board's own world, on one camera transform, so the landing does not
// swap it for a differently rounded tree. This layer is only the frame
// around that picture: the parent's other shapes, and the open canvas's
// border and badge. Its fill stays clear so it never covers the picture.
import { externalHref, GROUP_GAP, groupRegion, regionMembers, startBoxes, type ArrowShape, type RectShape, type Shape, type SketchGroup } from "@ttmi/format";
import { useId } from "react";
import { ArrowSeq } from "./ArrowSeq";
import { CanvasBadge, ExternalLink } from "./badge";
import { GroupView } from "./GroupView";
import { NoteView } from "./NoteView";
import { PortalInset, portalTargetOf, type PortalRecord } from "./PortalInset";
import { ShapeTag } from "./ShapeTag";
import { layoutArrows } from "./present";
import { arrowHead, arrowLine, COLORS, foldsNote, isConnector, ON_COLORS, QUIET_COLORS } from "./shapes";
import { BACKGROUND, FOREGROUND } from "./styles";
import { TermText } from "./terms";

export function HostWorld({ shapes, groups = [], portals, openId, path, liveIds, view, host, labelSizes }: {
  shapes: Shape[];
  groups?: SketchGroup[];
  portals?: Readonly<Record<string, PortalRecord>>;
  openId?: string;
  path?: ReadonlySet<string>;
  liveIds?: ReadonlySet<string>;
  view?: { w: number; h: number };
  host?: string;
  labelSizes?: ReadonlyMap<string, { w: number; h: number }>;
}) {
  const maskId = `host-gap-${useId().replace(/:/g, "")}`;
  const boxes = shapes.filter((shape) => shape.kind !== "arrow");
  const arrows = shapes.filter((shape): shape is ArrowShape => shape.kind === "arrow");
  const arrowLayout = layoutArrows(arrows, boxes, { labelSizes });
  const primary = startBoxes(shapes);
  const regions = groups.flatMap((group) => {
    const members = regionMembers(group, boxes);
    if (!members.length) return [];
    return [{ group, region: groupRegion(members) }];
  });
  const face = (shape: RectShape, open: boolean) => {
    if (open) return { borderColor: shape.tag ? COLORS[shape.color] : COLORS.white, background: "transparent", color: FOREGROUND };
    if (primary.has(shape.id) && !portalTargetOf(shape, host)) return { borderColor: COLORS[shape.color], background: COLORS[shape.color], color: ON_COLORS[shape.color] };
    return { borderColor: shape.tag ? COLORS[shape.color] : COLORS.white, background: BACKGROUND, color: FOREGROUND };
  };
  const badgeOf = (shape: RectShape, target: string) => {
    const card = portals?.[target];
    const labelIsUrl = Boolean(shape.label && /^https?:\/\//.test(shape.label.trim()));
    if (!card || card.status === "loading") return labelIsUrl ? "" : shape.label;
    if (card.status === "locked") return "Private";
    if (card.status === "missing") return "Not found";
    return card.title || (labelIsUrl ? "" : shape.label);
  };
  return (
    <>
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
        {arrows.map((arrow) => {
          const connector = isConnector(shapes, arrow);
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
        if (shape.kind === "note") {
          return (
            <NoteView
              key={shape.id}
              note={shape}
              editing={false}
              fold={foldsNote(shape) ? "folded" : "none"}
              width={shape.w}
              tagged={false}
              terms={[]}
              className=""
              onEditor={() => undefined}
              onChange={() => undefined}
              onMeasure={() => undefined}
              onToggleFold={() => undefined}
            />
          );
        }
        const target = portalTargetOf(shape, host);
        const open = Boolean(target && target === openId);
        const onPath = Boolean(target && path?.has(target));
        const child = target ? portals?.[target] : undefined;
        const live = Boolean(target && !open && child?.status === "open" && child.shapes?.length && (liveIds ? liveIds.has(target) : true));
        return (
          <div
            key={shape.id}
            data-shape-id={shape.id}
            data-name={shape.name}
            className={`sketch-rect${target ? " sketch-portal" : ""}`}
            style={{ left: shape.x, top: shape.y, width: shape.w, height: shape.h, ...face(shape, open) }}
            {...(target ? { "data-link": target, "data-status": child?.status ?? "loading", ...(open || onPath ? { "data-portal-path": "" } : {}), ...(open ? { "data-portal-open": "" } : {}) } : {})}
          >
            {target ? (
              badgeOf(shape, target) ? <CanvasBadge text={badgeOf(shape, target)} color={shape.color} /> : null
            ) : <ShapeTag shape={shape} editing={false} onSave={() => undefined} />}
            {target ? null : shape.label && <div className="sketch-label"><TermText text={shape.label} terms={[]} /></div>}
            {!target && externalHref(shape.link) && <ExternalLink href={externalHref(shape.link)!} color={shape.color} />}
            {live && child?.shapes && (
              <PortalInset shapes={child.shapes} groups={child.groups} width={Math.max(1, shape.w - 28)} height={Math.max(1, shape.h - 20)} depth={0} portals={portals} host={host} view={view} path={path} liveIds={liveIds} />
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
    </>
  );
}
