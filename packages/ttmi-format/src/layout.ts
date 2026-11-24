// --- Layout -------------------------------------------------------------------
import { FIT_ALONG, FIT_DOWN, GAP_ACROSS, GAP_ALONG, GAP_ALONG_MIN, GROUP_HEAD, GROUP_PAD, LABEL_ROOM } from "./constants";
import type { ArrowDraft, BoxDraft, Direction, Link, Rect } from "./drafts";
import { labelSize } from "./estimate";
import { groupRegion, regionMembers } from "./groups";
import type { Point, SketchGroup } from "./types";

// A link with what the parser knows of the arrow: its label's size.
// How many 32 px steps a new shape on an arranged board looks each way.
const SEARCH = 40;

type Labelled = Link & { label?: string; seq?: string; labelSize?: { w: number; h: number } };

// Places every shape that has no position. With nothing placed yet they are
// laid out in layers along the direction; otherwise each goes beside a placed
// shape it is connected to. Obstacles are shapes already on the board.
export function layout(boxes: BoxDraft[], arrows: ArrowDraft[], direction: Direction, obstacles: { x: number; y: number; w: number; h: number }[], groups: SketchGroup[] = []) {
  const free = boxes.filter((box) => !box.at);
  if (free.length === 0) return;
  for (const box of free) box.laidOut = true;
  const links = arrows.filter((arrow): arrow is ArrowDraft & Labelled => typeof arrow.from === "string" && typeof arrow.to === "string" && arrow.from !== arrow.to);
  if (free.length < boxes.length) {
    besideNeighbours(boxes, links, direction, obstacles, groups);
    return;
  }
  layered(boxes, links, direction, groups);
  // A new drawing on a board with the user's own shapes goes below them.
  if (obstacles.length) {
    const below = Math.max(...obstacles.map((other) => other.y + other.h)) + 120;
    const top = Math.min(...boxes.map((box) => box.at!.y));
    const left = Math.min(...obstacles.map((other) => other.x));
    const start = Math.min(...boxes.map((box) => box.at!.x));
    for (const box of boxes) box.at = { x: box.at!.x - start + left, y: box.at!.y - top + below };
  }
}

// Layers along the direction, each one step further along the arrows.
// - A note that only points at shapes describes them: it goes under the
//   first one it points at instead of taking a place of its own.
// - An arrow that closes a cycle is set aside for the layering (it still
//   draws), so a cycle reads as a flow with one arrow going back.
// - Every shape sits as late as its arrows allow, next to what it feeds.
// - Within a layer, shapes are ordered by where their neighbours are, so
//   arrows cross less.
// - A group is a lane across the layers it spans (placeAcross).
function layered(boxes: BoxDraft[], links: Labelled[], direction: Direction, groups: SketchGroup[]) {
  const byName = new Map(boxes.map((box) => [box.name, box]));
  const notes = new Map<string, BoxDraft>();
  for (const box of boxes) {
    if (box.kind !== "note" || links.some((link) => link.to === box.name)) continue;
    const target = links.find((link) => link.from === box.name)?.to;
    if (target) notes.set(box.name, byName.get(target)!);
  }
  // A note pointing at another described note joins that note's target.
  for (const [name, target] of notes) {
    let host = target;
    for (let hops = 0; notes.has(host.name) && hops < boxes.length; hops += 1) host = notes.get(host.name)!;
    if (notes.has(host.name)) notes.delete(name);
    else notes.set(name, host);
  }
  const main = boxes.filter((box) => !notes.has(box.name));
  const mainLinks = links.filter((link) => !notes.has(link.from) && !notes.has(link.to));

  // The arrows that close a cycle, set aside so that the cycle reads as a
  // flow with one arrow going back (Sugiyama's first phase, with Eades,
  // Lin and Smyth's ordering): the shapes go into a sequence, sinks taken
  // to its end and sources to its front while there are any, otherwise
  // the shape with the most arrows out net of arrows in (the first in the
  // text on a tie); an arrow that points backwards in the sequence closes
  // a cycle. A walk from the shapes nothing points at was tried first and
  // entered a cycle from the side (docs/concept.md, lesson 17).
  const left = new Set(main.map((box) => box.name));
  const outs = (name: string) => mainLinks.filter((link) => link.from === name && left.has(link.to)).length;
  const ins = (name: string) => mainLinks.filter((link) => link.to === name && left.has(link.from)).length;
  const front: string[] = [];
  const end: string[] = [];
  while (left.size) {
    for (let moved = true; moved;) {
      moved = false;
      for (const name of [...left]) if (outs(name) === 0) { end.unshift(name); left.delete(name); moved = true; }
      for (const name of [...left]) if (ins(name) === 0) { front.push(name); left.delete(name); moved = true; }
    }
    if (left.size === 0) break;
    const pick = [...left].reduce((best, name) => (outs(name) - ins(name) > outs(best) - ins(best) ? name : best));
    front.push(pick);
    left.delete(pick);
  }
  const seat = new Map([...front, ...end].map((name, index) => [name, index]));
  const forward = mainLinks.filter((link) => seat.get(link.from)! < seat.get(link.to)!);

  // Longest path from a start, then pulled as late as the arrows allow;
  // both capped as a guard.
  const rank = new Map(main.map((box) => [box.name, 0]));
  for (let round = 0; round < main.length; round += 1) {
    let moved = false;
    for (const { from, to } of forward) {
      if (rank.get(to)! < rank.get(from)! + 1) {
        rank.set(to, rank.get(from)! + 1);
        moved = true;
      }
    }
    if (!moved) break;
  }
  for (let round = 0; round < main.length; round += 1) {
    let moved = false;
    for (const box of main) {
      const next = forward.filter((link) => link.from === box.name).map((link) => rank.get(link.to)!);
      if (next.length === 0) continue;
      const latest = Math.min(...next) - 1;
      if (latest > rank.get(box.name)!) {
        rank.set(box.name, latest);
        moved = true;
      }
    }
    if (!moved) break;
  }

  const layers: BoxDraft[][] = [];
  for (const box of main) (layers[rank.get(box.name)!] ??= []).push(box);
  for (let index = 0; index < layers.length; index += 1) layers[index] ??= [];
  const order = new Map<string, number>();
  const number = () => layers.forEach((layer) => layer.forEach((box, index) => order.set(box.name, index)));
  number();
  const sortBy = (layer: BoxDraft[], neighbours: (box: BoxDraft) => string[]) => {
    const key = new Map(layer.map((box, index) => {
      const positions = neighbours(box).map((name) => order.get(name)).filter((value): value is number => value !== undefined);
      return [box.name, positions.length ? positions.reduce((sum, value) => sum + value, 0) / positions.length : index];
    }));
    layer.sort((a, b) => key.get(a.name)! - key.get(b.name)!);
  };
  const before = (box: BoxDraft) => mainLinks.filter((link) => link.to === box.name).map((link) => link.from);
  const after = (box: BoxDraft) => mainLinks.filter((link) => link.from === box.name).map((link) => link.to);
  for (let sweep = 0; sweep < 2; sweep += 1) {
    for (let index = 1; index < layers.length; index += 1) { sortBy(layers[index]!, before); number(); }
    for (let index = layers.length - 2; index >= 0; index -= 1) { sortBy(layers[index]!, after); number(); }
  }

  // Members of a group stay adjacent within a layer: the first one met
  // pulls the group's other members in that layer next to it, in their
  // order (docs/format.md, Groups).
  const groupOf = new Map<string, string>();
  for (const group of groups) for (const member of group.members) groupOf.set(member, group.name);
  for (const layer of layers) {
    const placed = new Set<string>();
    const together: BoxDraft[] = [];
    for (const box of layer) {
      if (placed.has(box.name)) continue;
      const group = groupOf.get(box.name);
      for (const other of group ? layer.filter((item) => groupOf.get(item.name) === group) : [box]) {
        together.push(other);
        placed.add(other.name);
      }
    }
    layer.splice(0, layer.length, ...together);
  }

  // The columns hold the layers' shapes only: the boxes, and notes that are
  // not describing notes. Notes that describe a shape go outside the band
  // of boxes afterwards, so the band stays compact (docs/format.md, Layout).
  const along = (box: BoxDraft) => (direction === "right" ? box.w : box.h);
  const across = (box: BoxDraft) => (direction === "right" ? box.h : box.w);
  const stacks = layers;
  const described = (box: BoxDraft) => boxes.filter((other) => notes.get(other.name) === box);

  // Positions across the direction first: they do not depend on the gap.
  // A group is a lane across the layers it spans; the band is as tall as
  // its tallest column, regions included.
  const { offsets, widest, laned } = placeAcross(stacks, groups, direction, across);

  // A column is as wide as its widest box. A folded note in a column (one
  // line) hangs into the gap rather than widening it: only what it reaches
  // past the gap into a shape of the next column, at its height, counts,
  // so nothing overlaps. In the last column a note reaches past the
  // drawing's edge, so it counts in full, describing notes included.
  // Columns are GAP_ALONG apart while the drawing fits one screen; past
  // that they close up evenly, never under GAP_ALONG_MIN, and never so
  // close that an arrow's label between two columns covers the arrow: a
  // pair joined by a labelled arrow stays the label plus LABEL_ROOM on
  // each side apart, and the other pairs share the room that is left. The
  // widths and the gap depend on each other, so settle.
  const meets = (note: BoxDraft, other: BoxDraft) =>
    offsets.get(note)! < offsets.get(other)! + across(other) + 24 && offsets.get(other)! < offsets.get(note)! + across(note) + 24;
  const lastFilled = stacks.length - 1 - [...stacks].reverse().findIndex((stack) => stack.length);
  const nextFilled = (index: number) => stacks.findIndex((stack, at) => at > index && stack.length);
  // The room each column's arrows to the next column need for their labels.
  const stackOf = new Map<string, number>();
  stacks.forEach((stack, index) => stack.forEach((box) => stackOf.set(box.name, index)));
  const needs = stacks.map((stack, index) => {
    const next = nextFilled(index);
    if (!stack.length || next < 0) return 0;
    const joins = (link: Labelled) => {
      const a = stackOf.get(link.from);
      const b = stackOf.get(link.to);
      return (a === index && b === next) || (a === next && b === index);
    };
    const labels = mainLinks.filter((link) => (link.label || link.seq) && joins(link)).map((link) => {
      const size = link.labelSize ?? labelSize(link.label, link.seq);
      return direction === "right" ? size.w : size.h;
    });
    const room = labels.length ? Math.ceil(Math.max(...labels)) + 2 * LABEL_ROOM : 0;
    // A group's region reaches past its members along the direction too:
    // two columns with a region in either stay far enough apart for the
    // regions of different groups to keep 24 px (for down, the label's
    // band is along the direction and counts).
    const grouped = (at: number) => stacks[at]!.some((box) => laned.has(box.name));
    return Math.max(room, grouped(index) || grouped(next) ? 2 * GROUP_PAD + 24 + (direction === "down" ? GROUP_HEAD : 0) : 0);
  });
  const gapAfter = (index: number, base: number) => Math.max(base, needs[index]!);
  const reach = (box: BoxDraft, index: number, base: number) => {
    if (!(box.kind === "note" && box.folds)) return along(box);
    if (index === lastFilled) return along(box);
    const next = stacks[nextFilled(index)] ?? [];
    return next.some((other) => meets(box, other)) ? Math.max(0, along(box) - gapAfter(index, base)) : 0;
  };
  const widths = (base: number) => stacks.map((stack, index) => {
    if (!stack.length) return 0;
    const hanging = index === lastFilled ? stack.flatMap(described).map(along) : [];
    return Math.max(...stack.map((box) => reach(box, index, base)), ...hanging);
  });
  const filled = stacks.filter((stack) => stack.length).length;
  const pairs = stacks.map((stack, index) => (stack.length && index !== lastFilled ? needs[index]! : undefined)).filter((need): need is number => need !== undefined);
  const gapFor = (sizes: number[]) => {
    if (filled < 2) return GAP_ALONG;
    const room = (direction === "right" ? FIT_ALONG : FIT_DOWN) - 40 - sizes.reduce((sum, size) => sum + size, 0);
    // The pairs a label holds wider than the shared gap take their room
    // first; the shared gap is what the rest get of what is left.
    let base = Math.min(GAP_ALONG, Math.floor(room / pairs.length));
    for (let round = 0; round < pairs.length; round += 1) {
      const held = pairs.filter((need) => need > base);
      if (held.length === pairs.length) break;
      const next = Math.min(GAP_ALONG, Math.floor((room - held.reduce((sum, need) => sum + need, 0)) / (pairs.length - held.length)));
      if (next === base) break;
      base = next;
    }
    return Math.max(GAP_ALONG_MIN, base);
  };
  let gap = gapFor(widths(GAP_ALONG));
  let sizes = widths(gap);
  for (let round = 0; round < 5; round += 1) {
    const next = gapFor(sizes);
    if (next === gap) break;
    gap = next;
    sizes = widths(gap);
  }

  let position = 40;
  stacks.forEach((stack, index) => {
    if (stack.length === 0) return;
    for (const box of stack) {
      const offset = offsets.get(box)!;
      box.at = direction === "right" ? { x: position, y: offset } : { x: offset, y: position };
    }
    position += sizes[index]! + gapAfter(index, gap);
  });

  // Describing notes go outside the band of boxes, aligned with their
  // shape's leading edge: its first note on the nearer side of the band
  // (below on a tie), its second on the other, and so on, so no note's
  // arrow runs through another note (docs/concept.md, lesson 6). A note
  // that would overlap a note already there takes the other side's first
  // row or its own side's next row, whichever keeps its connector shorter
  // without running through a note in between, 24 px clear.
  type Slot = { along: number; alongSize: number; across: number; acrossSize: number };
  const rows: Record<"below" | "above", Slot[]> = { below: [], above: [] };
  const firstRow = (side: "below" | "above", note: BoxDraft) => (side === "below" ? 40 + widest + GAP_ACROSS : 40 - GAP_ACROSS - across(note));
  const slot = (side: "below" | "above", note: BoxDraft, start: number) => {
    let at = firstRow(side, note);
    for (let round = 0; round <= rows[side].length; round += 1) {
      const hit = rows[side].find((other) => start < other.along + other.alongSize + 24 && other.along < start + along(note) + 24 && at < other.across + other.acrossSize + 24 && other.across < at + across(note) + 24);
      if (!hit) break;
      at = side === "below" ? hit.across + hit.acrossSize + GAP_ACROSS : hit.across - across(note) - GAP_ACROSS;
    }
    return at;
  };
  for (const stack of stacks) {
    for (const box of stack) {
      const start = direction === "right" ? box.at!.x : box.at!.y;
      const boxOffset = offsets.get(box)!;
      // How far the connector would run, from the box's edge to the note's;
      // a run through a note placed in between counts as a long way.
      const run = (side: "below" | "above", note: BoxDraft, at: number) => {
        const length = side === "below" ? at - (boxOffset + across(box)) : boxOffset - (at + across(note));
        const reachAlong = Math.min(along(note), along(box));
        const between = rows[side].some((other) =>
          other.along < start + reachAlong && start < other.along + other.alongSize
          && (side === "below" ? other.across < at : other.across + other.acrossSize > at + across(note)));
        return between ? length + 10_000 : length;
      };
      const nearer: "below" | "above" = boxOffset - 40 < 40 + widest - (boxOffset + across(box)) ? "above" : "below";
      described(box).forEach((note, index) => {
        const prefer: "below" | "above" = index % 2 === 0 ? nearer : nearer === "below" ? "above" : "below";
        const other: "below" | "above" = prefer === "below" ? "above" : "below";
        let side = prefer;
        let at = slot(prefer, note, start);
        if (at !== firstRow(prefer, note)) {
          const elsewhere = slot(other, note, start);
          if (run(other, note, elsewhere) < run(prefer, note, at)) {
            side = other;
            at = elsewhere;
          }
        }
        rows[side].push({ along: start, alongSize: along(note), across: at, acrossSize: across(note) });
        note.at = direction === "right" ? { x: start, y: at } : { x: at, y: start };
      });
    }
  }
}

// Across the direction, a group is a lane (docs/format.md, Layout, step 3;
// Sander's layout of compound graphs): it spans from the first layer with a
// member to the last and holds one slot in every layer between, which that
// layer's other shapes go before or after; the lanes keep one order on
// every layer, that of their members' mean position; and a slot starts at
// the same offset in each of its layers and is as tall as its tallest run
// of members, which centre in it. So a group's region is one rectangle
// that holds its members only, and no two regions cross. A region keeps
// GAP_ACROSS from the shapes and regions before and after it. Between the
// lanes each layer's shapes centre in the room left, which with no group
// at all is each column centred against the tallest.
function placeAcross(stacks: BoxDraft[][], groups: SketchGroup[], direction: Direction, across: (box: BoxDraft) => number) {
  const stackOf = new Map<string, number>();
  stacks.forEach((stack, index) => stack.forEach((box) => stackOf.set(box.name, index)));
  const laneOf = new Map<string, SketchGroup>();
  for (const group of groups) for (const member of group.members) if (stackOf.has(member)) laneOf.set(member, group);
  // Where a shape sits in its layer, 0 to 1.
  const centre = (box: BoxDraft) => {
    const stack = stacks[stackOf.get(box.name)!]!;
    return (stack.indexOf(box) + 0.5) / stack.length;
  };
  type Lane = { group: SketchGroup; first: number; last: number; key: number };
  const lanes: Lane[] = groups.flatMap((group) => {
    const members = stacks.flat().filter((box) => laneOf.get(box.name) === group);
    if (members.length === 0) return [];
    const at = members.map((box) => stackOf.get(box.name)!);
    return [{ group, first: Math.min(...at), last: Math.max(...at), key: members.reduce((sum, box) => sum + centre(box), 0) / members.length }];
  }).sort((a, b) => a.key - b.key);
  const laneFor = (box: BoxDraft) => lanes.find((lane) => lane.group === laneOf.get(box.name));

  // Each layer as blocks in order: a lane's members are one block, any
  // other shape its own, and a lane holds an empty block in a layer it
  // spans without a member. Blocks sort by their mean position, the lanes
  // never out of their one order; the layer takes the blocks' order.
  type Block = { lane?: Lane; boxes: BoxDraft[]; key: number };
  const blocks = stacks.map((stack, index) => {
    const list: Block[] = [];
    for (const box of stack) {
      const lane = laneFor(box);
      const block = lane && list.find((item) => item.lane === lane);
      if (block) block.boxes.push(box);
      else list.push({ lane, boxes: [box], key: 0 });
    }
    for (const block of list) block.key = block.boxes.reduce((sum, box) => sum + centre(box), 0) / block.boxes.length;
    for (const lane of lanes) if (lane.first < index && index < lane.last && !list.some((block) => block.lane === lane)) list.push({ lane, boxes: [], key: lane.key });
    let floor = -Infinity;
    for (const lane of lanes) {
      const block = list.find((item) => item.lane === lane);
      if (!block) continue;
      block.key = Math.max(block.key, floor + 1e-6);
      floor = block.key;
    }
    list.sort((a, b) => a.key - b.key);
    stack.splice(0, stack.length, ...list.flatMap((block) => block.boxes));
    return list;
  });

  // How far a region reaches before and after its members, across the
  // direction: the padding, and for `right` the label's band at the top.
  const before = GROUP_PAD + (direction === "right" ? GROUP_HEAD : 0);
  const after = GROUP_PAD;
  const run = (block: Block) => block.boxes.reduce((sum, box) => sum + across(box), 0) + GAP_ACROSS * Math.max(0, block.boxes.length - 1);

  // First pass, lane by lane in their order: each layer's cursor moves
  // past the shapes before the lane's block, and the slot starts where
  // the furthest of its layers has got to.
  const cursor = stacks.map(() => 40);
  const pointer = stacks.map(() => 0);
  const slots = new Map<Lane, { top: number; height: number }>();
  const advance = (index: number, until: Block | undefined) => {
    const list = blocks[index]!;
    while (pointer[index]! < list.length && list[pointer[index]!] !== until) {
      cursor[index] = cursor[index]! + run(list[pointer[index]!]!) + GAP_ACROSS;
      pointer[index] = pointer[index]! + 1;
    }
  };
  for (const lane of lanes) {
    const span = Array.from({ length: lane.last - lane.first + 1 }, (_, offset) => lane.first + offset);
    const own = span.map((index) => blocks[index]!.find((block) => block.lane === lane)!);
    span.forEach((index, at) => advance(index, own[at]));
    const top = Math.max(...span.map((index) => cursor[index]!)) + before;
    const height = Math.max(...own.map(run));
    slots.set(lane, { top, height });
    for (const index of span) {
      cursor[index] = top + height + after + GAP_ACROSS;
      pointer[index] = pointer[index]! + 1;
    }
  }
  stacks.forEach((_, index) => advance(index, undefined));
  const widest = Math.max(0, ...cursor.map((at) => at - GAP_ACROSS - 40));

  // Second pass: a lane's members centre in its slot; between the lanes
  // and the band's edges, each layer's other shapes centre in the room.
  const offsets = new Map<BoxDraft, number>();
  const stackUp = (list: Block[], from: number) => {
    let offset = from;
    for (const block of list) {
      for (const box of block.boxes) {
        offsets.set(box, offset);
        offset += across(box) + GAP_ACROSS;
      }
    }
  };
  for (const list of blocks) {
    let start = 40;
    let loose: Block[] = [];
    const settle = (end: number) => {
      const height = loose.reduce((sum, block) => sum + run(block), 0) + GAP_ACROSS * Math.max(0, loose.length - 1);
      stackUp(loose, start + (end - start - height) / 2);
      loose = [];
    };
    for (const block of list) {
      if (!block.lane) {
        loose.push(block);
        continue;
      }
      const { top, height } = slots.get(block.lane)!;
      settle(top - before - GAP_ACROSS);
      stackUp([block], top + (height - run(block)) / 2);
      start = top + height + after + GAP_ACROSS;
    }
    settle(40 + widest);
  }
  return { offsets, widest, laned: new Set(laneOf.keys()) };
}

function besideNeighbours(boxes: BoxDraft[], links: Link[], direction: Direction, obstacles: { x: number; y: number; w: number; h: number }[], groups: SketchGroup[]) {
  type Placed = { kind: string; name?: string; x: number; y: number; w: number; h: number };
  const placed: Placed[] = [
    ...obstacles.map(({ x, y, w, h }) => ({ kind: "obstacle", x, y, w, h })),
    ...boxes.filter((box) => box.at).map((box) => ({ kind: box.kind, name: box.name, x: box.at!.x, y: box.at!.y, w: box.w, h: box.h })),
  ];
  const overlaps = (box: BoxDraft, at: Point) => placed.some((other) =>
    at.x < other.x + other.w + 24 && at.x + box.w + 24 > other.x && at.y < other.y + other.h + 24 && at.y + box.h + 24 > other.y);
  const meets = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  // What the groups' regions would say wrongly with the box there: a shape
  // inside a region it is not a member of, two regions that cross
  // (docs/format.md, Groups). The fewest wins; the user's own arrangement
  // may already say some of it.
  const wrongs = (box?: BoxDraft, at?: Point) => {
    if (groups.length === 0) return 0;
    const all = box && at ? [...placed, { kind: box.kind, name: box.name, x: at.x, y: at.y, w: box.w, h: box.h }] : placed;
    const regions = groups.flatMap((group) => {
      const members = regionMembers(group, all);
      return members.length ? [{ group, region: groupRegion(members) }] : [];
    });
    let count = 0;
    for (const [index, { group, region }] of regions.entries()) {
      count += all.filter((shape) => !(shape.name && group.members.includes(shape.name)) && meets(shape, region)).length;
      count += regions.slice(index + 1).filter((other) => meets(region, other.region)).length;
    }
    return count;
  };
  for (const box of boxes.filter((item) => !item.at)) {
    const neighbour = links
      .map((link) => (link.from === box.name ? link.to : link.to === box.name ? link.from : undefined))
      .map((name) => placed.find((other) => other.name && other.name === name))
      .find(Boolean);
    let at: Point;
    if (neighbour) {
      at = direction === "right"
        ? { x: neighbour.x + neighbour.w + GAP_ALONG, y: neighbour.y }
        : { x: neighbour.x, y: neighbour.y + neighbour.h + GAP_ALONG };
    } else if (placed.length) {
      at = { x: Math.min(...placed.map((other) => other.x)), y: Math.max(...placed.map((other) => other.y + other.h)) + 80 };
    } else {
      at = { x: 40, y: 40 };
    }
    // Stepped across by 32s until it is clear of every shape: onward first
    // (down for right), then back, taking the first spot where the regions
    // say nothing new and else the one where they say least.
    const step = (offset: number): Point => (direction === "right" ? { ...at, y: at.y + offset } : { ...at, x: at.x + offset });
    const offsets = [...Array.from({ length: SEARCH }, (_, index) => index * 32), ...Array.from({ length: SEARCH - 1 }, (_, index) => -(index + 1) * 32)];
    const before = wrongs();
    let best: { at: Point; wrong: number } | undefined;
    for (const offset of offsets) {
      const spot = step(offset);
      if (overlaps(box, spot)) continue;
      const wrong = wrongs(box, spot);
      if (!best || wrong < best.wrong) best = { at: spot, wrong };
      if (wrong <= before) break;
    }
    if (best) at = best.at;
    else while (overlaps(box, at)) at = step(32);
    box.at = at;
    placed.push({ kind: box.kind, name: box.name, x: at.x, y: at.y, w: box.w, h: box.h });
  }
}
