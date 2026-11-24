// An arrow's label keeps off the marks a line may pass: a shape's tag pill
// and the top of a group's region, where its label and tag sit
// (docs/format.md, Arrows). Both were drawn over in an OAuth flow, 2026-10-21.
import { describe, expect, it } from "vitest";
import { arrowMidpoint, groupRegion, GROUP_HEAD, parseSketch, regionMembers, TAG_LEFT, type ArrowShape, type Shape } from "../src/index";
import { labelSize, tagSize } from "../src/estimate";
import { boxesByName } from "./helpers";

type Rect = { x: number; y: number; w: number; h: number };
const overlaps = (a: Rect, b: Rect) => !(a.x > b.x + b.w || a.x + a.w < b.x || a.y > b.y + b.h || a.y + a.h < b.y);

function labelOf(shapes: Shape[], label: string): Rect {
  const arrow = shapes.find((shape): shape is ArrowShape => shape.kind === "arrow" && shape.label === label)!;
  const size = labelSize(arrow.label, arrow.seq);
  const middle = arrowMidpoint(arrow.from, arrow.to, arrow.bend);
  return { x: middle.x - size.w / 2, y: middle.y - size.h / 2, ...size };
}

describe("an arrow's label keeps clear (docs/format.md, Arrows)", () => {
  it("of the tag of a shape its line passes over", () => {
    // Straight, the label sits on the endpoint's tag but not on its box.
    const { shapes } = parseSketch([
      "client: box \"MCP client\" at 0,0 size 140,70",
      "mcp: box \"MCP endpoint\" tag \"Durable object\" at 330,52 size 140,86",
      "auth: box \"Auth server\" at 800,0 size 140,70",
      "client -> auth \"metadata + register\" seq 2",
    ].join("\n"));
    const mcp = boxesByName(shapes).get("mcp")!;
    const size = tagSize("Durable object");
    const pill = { x: mcp.x + TAG_LEFT, y: mcp.y - size.h / 2, ...size };
    expect(overlaps(labelOf(shapes, "metadata + register"), pill)).toBe(false);
  });

  it("of a group's label at the top of its region", () => {
    const { shapes, groups } = parseSketch([
      "client: box \"MCP client\" at 0,0 size 140,70",
      "mcp: box \"MCP endpoint\" at 330,80 size 140,86",
      "auth: box \"Auth server\" at 800,0 size 140,70",
      "worker: group \"Data-worker, per app\" of mcp",
      "client -> auth \"code + PKCE, get token\" seq 5",
    ].join("\n"));
    const region = groupRegion(regionMembers(groups[0]!, shapes.filter((shape) => shape.kind !== "arrow")) as Rect[]);
    const head = { x: region.x, y: region.y, w: region.w, h: GROUP_HEAD };
    expect(overlaps(labelOf(shapes, "code + PKCE, get token"), head)).toBe(false);
  });
});
