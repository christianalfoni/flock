// --- Reading ------------------------------------------------------------------
import { COLORS, DEFAULT_TEXT_SIZE, HOP, OLD_FILLS, NAME, PAIR, SEQ } from "./constants";
import type { ArrowDraft, BoxDraft, Direction, End } from "./drafts";
import { codeProblem, type CodeCheck } from "./code";
import { labelSize, tagSize } from "./estimate";
import { markdownToHtml } from "./markdown";
import { merge } from "./merge";
import { keptLink } from "./portal";
import { applyNoteSize, applyRectSize } from "./size";
import { SketchFormatError, type Color, type Point, type Shape, type SketchGroup, type SketchMeasure, type SketchStep, type SketchTerm } from "./types";
import { termKey } from "./terms";

function fail(line: number, message: string): never {
  throw new SketchFormatError(`Line ${line}: ${message}`);
}

// Words, "quoted strings" (with \" \\ \n escapes) and x,y pairs.
function tokens(text: string) {
  const found: { text: string; quoted: boolean }[] = [];
  for (const match of text.matchAll(/"((?:[^"\\]|\\.)*)"|(\S+)/g)) {
    if (match[1] !== undefined) found.push({ text: match[1].replace(/\\(.)/g, (_, char: string) => (char === "n" ? "\n" : char)), quoted: true });
    else found.push({ text: match[2]!, quoted: false });
  }
  return found;
}

function pair(text: string | undefined, line: number, what: string): Point {
  const match = text ? PAIR.exec(text) : null;
  if (!match) fail(line, `expected ${what} as two numbers like 40,60, got "${text ?? ""}".`);
  return { x: Number(match[1]), y: Number(match[2]) };
}

// The title after "# sketch" on the first line, if any.
export function sketchTitle(source: string) {
  const first = source.replace(/\r\n?/g, "\n").split("\n").map((line) => line.trim()).find((line) => line && !/^(`{3,}|~{3,})/.test(line));
  const title = first ? /^#\s*sketch\b(.*)$/i.exec(first)?.[1]?.trim() : undefined;
  return title || undefined;
}

// A titled sketch's id: its title, lowercased, as letters, digits and dashes.
export function sketchSlug(title: string) {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "sketch";
}

// Reads sketch text into board shapes. Given the board's current shapes, it
// merges: shapes with a name already on the board keep their place and size
// and take the text's label, color and content; new names are placed beside
// what they connect to; named shapes the text leaves out go. Unnamed shapes
// (drawn on the board, never sent) stay. Arrows between named shapes are
// replaced by the text's; other arrows stay.
// Steps are an optional walkthrough on top of the drawing: "step: a b" lines
// with indented narration, naming shapes of the drawing. They never change
// the drawing or its layout.
// Terms say what the sketch's words mean: `term "Word" "definition"` lines,
// kept with the sketch and shown on hover; the text's replace the board's.
// The walkthrough of an overview, every numbered arrow in order (branches
// with one number, 3a and 3b, share a stop) and a summary.
function tourSteps(overview: string, arrows: ArrowDraft[], summary: string | undefined): SketchStep[] {
  const hops = new Map<number, ArrowDraft[]>();
  for (const arrow of arrows) {
    if (!arrow.seq) continue;
    const number = Number.parseInt(arrow.seq, 10);
    hops.set(number, [...(hops.get(number) ?? []), arrow]);
  }
  const stops: SketchStep[] = [...hops.entries()].sort((a, b) => a[0] - b[0]).map(([, together]) => {
    const ordered = together.sort((a, b) => a.seq!.localeCompare(b.seq!));
    return { kind: "hop", names: ordered.map((arrow) => `#${arrow.seq}`), narration: ordered.flatMap((arrow) => (arrow.narration ? [arrow.narration] : [])).join(" ") };
  });
  return [{ kind: "overview", names: [], narration: overview }, ...stops, ...(summary !== undefined ? [{ kind: "summary" as const, names: [], narration: summary }] : [])];
}

// strict: what a new save is held to (docs/format.md, Colour). A box has
// no fill any more, and a box's or group's colour shows on its tag, so a
// fill word or such a colour without a tag is refused; a note has no tag
// (its title is its pill), so a note's tag is refused. Text saved before
// still reads: the fill words and a note's tag mean nothing, and an
// untagged colour is not shown. A note's code is held to the rules of
// src/code.ts (docs/format.md, Code), TypeScript parsed by checkCode when
// the caller has a parser; before, pseudo, unnamed and long code read.
export function parseSketch(source: string, measure?: SketchMeasure, existing: Shape[] = [], { strict = false, checkCode, canvasTitles, canvasBounds }: { strict?: boolean; checkCode?: CodeCheck; canvasTitles?: Readonly<Record<string, string>>; canvasBounds?: Readonly<Record<string, { w: number; h: number }>> } = {}): { shapes: Shape[]; steps: SketchStep[]; groups: SketchGroup[]; terms: SketchTerm[] } {
  let lines = source.replace(/\r\n?/g, "\n").split("\n");
  // A block pasted with its fences still on.
  const first = lines.findIndex((line) => line.trim() !== "");
  if (first >= 0 && /^\s*(`{3,}|~{3,})/.test(lines[first]!)) {
    const fence = /^\s*(`{3,}|~{3,})/.exec(lines[first]!)![1]!;
    lines = lines.slice(first + 1);
    const close = lines.map((line) => line.trim()).lastIndexOf(fence);
    if (close >= 0) lines = lines.slice(0, close);
  }

  let direction: Direction = "right";
  const boxes: BoxDraft[] = [];
  const arrows: ArrowDraft[] = [];
  const names = new Map<string, BoxDraft>();
  const steps: (SketchStep & { line: number })[] = [];
  const groups = new Map<string, SketchGroup & { line: number }>();
  const terms = new Map<string, SketchTerm>();
  // A walkthrough written as an overview, narration on the numbered
  // arrows, and a summary (docs/format.md, Walkthrough).
  const tour: { overview?: { narration: string; line: number }; summary?: { narration: string; line: number } } = {};
  // Indented lines after the current one, dedented: a note's markdown or a
  // step's narration.
  const indentedBody = (index: number) => {
    const body: string[] = [];
    while (index + 1 < lines.length && (lines[index + 1]!.trim() === "" || /^\s/.test(lines[index + 1]!))) body.push(lines[(index += 1)]!);
    while (body.length && body[body.length - 1]!.trim() === "") body.pop();
    const indent = Math.min(...body.filter((item) => item.trim()).map((item) => /^\s*/.exec(item)![0].length));
    return { next: index, text: body.map((item) => item.slice(Number.isFinite(indent) ? indent : 0)).join("\n") };
  };

  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index]!;
    const line = index + 1;
    const text = raw.trim();
    if (!text || text.startsWith("#")) continue;

    const setting = /^direction\s*:\s*(\w+)$/.exec(text);
    if (setting) {
      if (setting[1] !== "right" && setting[1] !== "down") fail(line, `direction is "right" or "down", not "${setting[1]}".`);
      direction = setting[1];
      continue;
    }

    const shape = /^([A-Za-z_][\w-]*)\s*:\s*(box|note)\b(.*)$/.exec(text);
    if (shape) {
      const [, name, kind, rest] = shape as unknown as [string, string, "box" | "note", string];
      if (names.has(name) || groups.has(name)) fail(line, `"${name}" is already used; every shape needs its own name.`);
      const draft: BoxDraft = { kind: kind === "box" ? "rect" : "note", name, line, color: "white", label: "", markdown: "", html: "", codeWidth: 0, size: DEFAULT_TEXT_SIZE, w: 0, h: 0 };
      let w: number | undefined;
      let h: number | undefined;
      const parts = tokens(rest);
      for (let at = 0; at < parts.length; at += 1) {
        const part = parts[at]!;
        if (part.text === "tag" && !part.quoted) {
          const value = parts[(at += 1)];
          if (!value?.quoted) fail(line, 'expected the tag in quotes after "tag", like tag "Service".');
          if (kind === "note") {
            if (strict) fail(line, `a note has no tag: its title, the first line, is what it shows folded; drop tag "${value.text}".`);
          } else draft.tag = value.text.trim() || undefined;
        } else if (part.text === "link" && !part.quoted && kind === "box") {
          const value = parts[(at += 1)];
          if (!value?.quoted) fail(line, 'expected a sketch id or an http(s) url in quotes after "link", like link "k3f9".');
          draft.link = keptLink(value.text);
        } else if (part.quoted && kind === "box") draft.label = part.text;
        else if (COLORS.includes(part.text as Color)) draft.color = part.text as Color;
        else if (kind === "box" && OLD_FILLS.includes(part.text)) {
          if (strict) fail(line, `"${part.text}" is gone: boxes have no fill. The box the first numbered arrow starts from is drawn as the start; drop "${part.text}".`);
        }
        else if (part.text === "at") draft.at = pair(parts[(at += 1)]?.text, line, "a position after \"at\"");
        else if (kind === "box" && part.text === "size") ({ x: w, y: h } = pair(parts[(at += 1)]?.text, line, "a size after \"size\""));
        else if (kind === "note" && part.text === "width") w = Number(parts[(at += 1)]?.text) || fail(line, "expected a number after \"width\".");
        else if (kind === "note" && part.text === "text") draft.size = Number(parts[(at += 1)]?.text) || fail(line, "expected a number after \"text\".");
        else fail(line, `"${part.text}" is not something a ${kind} takes.`);
      }
      if (draft.kind === "note") {
        // The note's markdown is every indented line that follows.
        const body = indentedBody(index);
        index = body.next;
        draft.markdown = body.text;
        if (strict) {
          const problem = codeProblem(draft.markdown, checkCode);
          // The body starts on the line below the note's.
          if (problem) fail(line + 1 + problem.line, problem.message);
        }
        draft.html = markdownToHtml(draft.markdown);
        // "width" is the least the note is. The drawn size is decided here,
        // before layout: a note with more than one block is its badge (the
        // folded head), and arrows land on that; a note with one block is
        // widened so its code does not wrap.
        applyNoteSize(draft, measure, w);
      } else {
        // The label, then the badge (a tag, a canvas name, an external
        // arrow). Layout, routing and the camera all read this width.
        applyRectSize(draft, measure, canvasTitles, { w, h }, canvasBounds);
      }
      if (strict && kind === "box" && draft.color !== "white" && !draft.tag) fail(line, `a colour shows on the box's tag; add tag "…" or drop "${draft.color}".`);
      // A note's old tag, if one is still there, is part of its outline.
      // A box's pill was set with its size, above.
      if (draft.kind === "note" && draft.tag) draft.tagSize = measure?.tag?.(draft.tag) ?? tagSize(draft.tag);
      boxes.push(draft);
      names.set(name, draft);
      continue;
    }

    // name: group "Label" [color] [tag "Tag"] of a, b, c
    const group = /^([A-Za-z_][\w-]*)\s*:\s*group\b(.*)$/.exec(text);
    if (group) {
      const [, name, rest] = group as unknown as [string, string, string];
      if (names.has(name) || groups.has(name)) fail(line, `"${name}" is already used; every shape needs its own name.`);
      const draft: SketchGroup & { line: number } = { name, label: "", color: "white", members: [], line };
      const parts = tokens(rest);
      let at = 0;
      for (; at < parts.length; at += 1) {
        const part = parts[at]!;
        if (part.text === "of" && !part.quoted) break;
        if (part.text === "tag" && !part.quoted) {
          const value = parts[(at += 1)];
          if (!value?.quoted) fail(line, 'expected the tag in quotes after "tag", like tag "Service".');
          draft.tag = value.text.trim() || undefined;
        } else if (part.quoted) draft.label = part.text;
        else if (COLORS.includes(part.text as Color)) draft.color = part.text as Color;
        else fail(line, `"${part.text}" is not something a group takes.`);
      }
      const members = [...new Set(parts.slice(at + 1).flatMap((part) => part.text.split(",")).map((item) => item.trim()).filter(Boolean))];
      if (at >= parts.length || members.length === 0) fail(line, 'a group lists its members after "of", like of a, b.');
      for (const member of members) if (!NAME.test(member)) fail(line, `a group lists shape names after "of", and "${member}" is not one.`);
      if (strict && draft.color !== "white" && !draft.tag) fail(line, `a colour shows on the group's tag; add tag "…" or drop "${draft.color}".`);
      draft.members = members;
      groups.set(name, draft);
      continue;
    }

    // term "Word" "What it means". Before arrows: a definition may say "->".
    if (/^term\s+"/.test(text)) {
      const parts = tokens(text.slice(4));
      const [word, definition] = parts;
      if (parts.length !== 2 || !word!.quoted || !definition!.quoted || !word!.text.trim() || !definition!.text.trim()) fail(line, 'a term is the word and what it means, both in quotes, like term "Dispatch" "Routes a job to a runner".');
      const key = termKey(word!.text);
      if (terms.has(key)) fail(line, `the term "${word!.text.trim()}" is already defined.`);
      terms.set(key, { term: word!.text.trim(), definition: definition!.text.trim() });
      continue;
    }

    if (text.includes("->")) {
      const split = text.indexOf("->");
      const fromText = text.slice(0, split).trim();
      const parts = tokens(text.slice(split + 2));
      const toText = parts.shift()?.text ?? "";
      const end = (value: string, side: string): End => {
        if (PAIR.test(value)) return pair(value, line, "a point");
        if (NAME.test(value)) return value;
        fail(line, `the arrow's ${side} should be a shape's name or a point like 40,60, not "${value}".`);
      };
      const arrow: ArrowDraft = { from: end(fromText, "start"), to: end(toText, "end"), color: "white", line };
      for (let at = 0; at < parts.length; at += 1) {
        const part = parts[at]!;
        if (part.quoted) arrow.label = part.text;
        else if (COLORS.includes(part.text as Color)) arrow.color = part.text as Color;
        else if (part.text === "bend") {
          const value = Number(parts[(at += 1)]?.text);
          if (!Number.isFinite(value)) fail(line, "expected a number after \"bend\".");
          arrow.bend = value;
        } else if (part.text === "seq") {
          const value = parts[(at += 1)];
          if (!value || value.quoted || !SEQ.test(value.text)) fail(line, 'expected a number like 2 or 2a after "seq".');
          arrow.seq = value.text;
        } else fail(line, `"${part.text}" is not something an arrow takes.`);
      }
      // The label's size, with the number's badge, for the room the layout
      // and the routing give it.
      if (arrow.label || arrow.seq) arrow.labelSize = (arrow.seq ? measure?.label?.(arrow.label ?? "", arrow.seq) : measure?.label?.(arrow.label!)) ?? labelSize(arrow.label, arrow.seq);
      // What is said at this hop, indented below it (Walkthrough).
      const said = indentedBody(index);
      index = said.next;
      const narration = said.text.replace(/\s*\n\s*/g, " ").trim();
      if (narration) {
        if (!arrow.seq) fail(line, "narration under an arrow needs its number: seq N.");
        arrow.narration = narration;
      }
      arrows.push(arrow);
      continue;
    }

    const block = /^(overview|summary)\s*:\s*$/.exec(text);
    if (block) {
      const which = block[1] as "overview" | "summary";
      if (tour[which] !== undefined) fail(line, `the sketch already has a ${which}.`);
      const body = indentedBody(index);
      index = body.next;
      tour[which] = { narration: body.text.replace(/\s*\n\s*/g, " ").trim(), line };
      continue;
    }

    const step = /^step\s*:(.*)$/.exec(text);
    if (step) {
      const stepNames = step[1]!.split(/[\s,]+/).filter(Boolean);
      for (const name of stepNames) if (!NAME.test(name) && !HOP.test(name)) fail(line, `a step lists shape names and hops (#2), and "${name}" is neither.`);
      const body = indentedBody(index);
      index = body.next;
      steps.push({ names: stepNames, narration: body.text.replace(/\s*\n\s*/g, " ").trim(), line });
      continue;
    }

    fail(line, `could not read "${text}". Expected a shape (name: box …), a note, a group (name: group "Label" of a b), an arrow (a -> b), a step (step: a b), an overview or summary (overview:), or a term (term "Word" "what it means").`);
  }

  for (const arrow of arrows) {
    for (const end of [arrow.from, arrow.to]) {
      if (typeof end === "string" && !names.has(end)) fail(arrow.line, `no shape is called "${end}".`);
    }
  }

  // Members exist, are not groups, and are in one group at most.
  const memberOf = new Map<string, string>();
  for (const group of groups.values()) {
    for (const member of group.members) {
      if (groups.has(member)) fail(group.line, `"${member}" is a group; groups do not nest.`);
      if (!names.has(member)) fail(group.line, `no shape is called "${member}".`);
      const other = memberOf.get(member);
      if (other) fail(group.line, `"${member}" is already in group "${other}"; a shape is in one group at most.`);
      memberOf.set(member, group.name);
    }
  }

  for (const step of steps) {
    for (const name of step.names) {
      if (HOP.test(name)) {
        if (!arrows.some((arrow) => `#${arrow.seq}` === name)) fail(step.line, `no arrow is numbered ${name.slice(1)}.`);
      } else if (!names.has(name) && !groups.has(name)) fail(step.line, `no shape is called "${name}".`);
    }
  }

  const touring = tour.overview !== undefined || tour.summary !== undefined || arrows.some((arrow) => arrow.narration);
  if (touring && steps.length) fail(steps[0]!.line, "a walkthrough is either steps or an overview with narration on the numbered arrows, not both.");

  const groupList = [...groups.values()].map(({ line: _line, ...group }) => group);
  return {
    shapes: merge(boxes, arrows, direction, existing, measure, groupList),
    steps: touring ? tourSteps(tour.overview?.narration ?? "", arrows, tour.summary?.narration) : steps.map(({ names: stepNames, narration }) => ({ names: stepNames, narration })),
    groups: groupList,
    terms: [...terms.values()],
  };
}
