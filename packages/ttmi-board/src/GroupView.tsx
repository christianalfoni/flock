import type { SketchGroup } from "@ttmi/format";
import { COLORS, tagStyle } from "./shapes";

// A group's region, drawn behind its members (docs/board.md, Shapes): a
// dashed outline with 6 px corners and almost no ground, the label at its
// top-left and the tag beside it, which carries the group's colour. Not selectable
// in v1; it follows the members wherever they are put.
export function GroupView({ group, region, pointed = false }: { group: SketchGroup; region: { x: number; y: number; w: number; h: number }; pointed?: boolean }) {
  const color = COLORS.white;
  return (
    <div className={`sketch-group ${pointed ? "sketch-pointed" : ""}`.trim()} data-group={group.name} style={{ left: region.x, top: region.y, width: region.w, height: region.h }}>
      {(group.label || group.tag) && (
        <div className="sketch-group-head" style={{ color }}>
          {group.label && <span className="sketch-group-label">{group.label}</span>}
          {group.tag && <span className="sketch-group-tag" style={tagStyle(group.color)}>{group.tag}</span>}
        </div>
      )}
    </div>
  );
}
