// --- Writing ------------------------------------------------------------------
import { DEFAULT_TEXT_SIZE, NAME } from "./constants";
import { nearBox } from "./geometry";
import { htmlToMarkdown } from "./markdown";
import { keepReferences } from "./references";
import type { BoxShape, Point, Shape, SketchGroup, SketchStep, SketchTerm } from "./types";

function quote(text: string) {
  return `"${text.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n")}"`;
}

// Writes the board out with every position, so a round trip keeps the
// layout. Shapes without a name get one (box1, note1, …); the names used
// are returned so the board can keep them.
export function serializeSketch(shapes: Shape[], title?: string, steps: SketchStep[] = [], groups: SketchGroup[] = [], terms: SketchTerm[] = []): { text: string; names: Map<string, string> } {
  const names = new Map<string, string>();
  const used = new Set<string>();
  const counters = { rect: 0, note: 0 };
  const boxes = shapes.filter((shape): shape is BoxShape => shape.kind !== "arrow");
  for (const box of boxes) {
    let name = box.name && NAME.test(box.name) && !used.has(box.name) ? box.name : undefined;
    while (!name || used.has(name)) name = `${box.kind === "rect" ? "box" : "note"}${(counters[box.kind] += 1)}`;
    used.add(name);
    names.set(box.id, name);
  }

  // The marker line lets a reader recognise the block.
  const lines = [title ? `# sketch ${title}` : "# sketch", "direction: right"];
  // Terms first, like a glossary at the head of a page.
  for (const term of terms) lines.push(`term ${quote(term.term)} ${quote(term.definition)}`);
  // A walkthrough of overview, hops and summary (Walkthrough): the overview
  // after the head, each hop's narration under its arrow, the summary last.
  const touring = steps.some((step) => step.kind);
  const referable = () => new Set([
    ...names.values(),
    ...groups.map((group) => group.name),
    ...shapes.flatMap((shape) => (shape.kind === "arrow" && shape.seq ? [`#${shape.seq}`] : [])),
  ]);
  // An overview with no words is the walkthrough's silent start, which
  // every walkthrough has, so it is not written.
  const overview = steps.find((step) => step.kind === "overview");
  if (overview?.narration) lines.push("", "overview:", `  ${keepReferences(overview.narration, referable())}`, "");
  const round = (value: number) => Math.round(value);
  for (const box of boxes) {
    const name = names.get(box.id)!;
    if (box.kind === "rect") {
      lines.push(`${name}: box ${quote(box.label)}${box.color !== "white" ? ` ${box.color}` : ""}${box.tag ? ` tag ${quote(box.tag)}` : ""}${box.link ? ` link ${quote(box.link)}` : ""} at ${round(box.x)},${round(box.y)} size ${round(box.w)},${round(box.h)}`);
    } else {
      const style = [box.color !== "white" ? box.color : "", box.size && box.size !== DEFAULT_TEXT_SIZE ? `text ${box.size}` : ""].filter(Boolean).join(" ");
      lines.push(`${name}: note${style ? ` ${style}` : ""} at ${round(box.x)},${round(box.y)} width ${round(box.minWidth ?? box.w)}`);
      for (const line of htmlToMarkdown(box.html).split("\n")) lines.push(line ? `  ${line}` : "");
    }
  }

  // Groups come after the shapes and before the arrows, with the members
  // that are still there; a group with none left is gone.
  const present = new Set(names.values());
  for (const group of groups) {
    const members = group.members.filter((name) => present.has(name));
    if (members.length === 0) continue;
    lines.push(`${group.name}: group ${quote(group.label)}${group.color !== "white" ? ` ${group.color}` : ""}${group.tag ? ` tag ${quote(group.tag)}` : ""} of ${members.join(", ")}`);
  }

  // An arrow end on or near a box is written as that box's name.
  const near = (point: Point) => nearBox(boxes, point);
  for (const arrow of shapes) {
    if (arrow.kind !== "arrow") continue;
    const fromBox = near(arrow.from);
    const toBox = near(arrow.to);
    const bothNamed = fromBox && toBox && fromBox !== toBox;
    const from = bothNamed ? names.get(fromBox.id)! : `${round(arrow.from.x)},${round(arrow.from.y)}`;
    const to = bothNamed ? names.get(toBox.id)! : `${round(arrow.to.x)},${round(arrow.to.y)}`;
    const style = [arrow.seq ? `seq ${arrow.seq}` : "", arrow.label ? quote(arrow.label) : "", arrow.color !== "white" ? arrow.color : "", arrow.bend ? `bend ${Math.round(arrow.bend)}` : ""].filter(Boolean).join(" ");
    lines.push(`${from} -> ${to}${style ? ` ${style}` : ""}`);
    if (touring && arrow.seq && arrow.narration) lines.push(`  ${keepReferences(arrow.narration, referable())}`);
  }

  // Steps keep naming shapes and groups that are still there, and their
  // narration keeps references to them; one to a shape that is gone is
  // written as its words.
  // A numbered arrow that is written keeps the references to its number.
  const written = new Set([...present, ...groups.filter((group) => group.members.some((name) => present.has(name))).map((group) => group.name)]);
  const numbers = new Set(lines.flatMap((line) => /^\S+ -> \S+ seq (\S+)/.exec(line)?.slice(1).map((seq) => `#${seq}`) ?? []));
  const summary = steps.find((step) => step.kind === "summary");
  if (summary) lines.push("", "summary:", ...(summary.narration ? [`  ${keepReferences(summary.narration, new Set([...written, ...numbers]))}`] : []));
  for (const step of touring ? [] : steps) {
    const kept = step.names.filter((name) => written.has(name) || numbers.has(name));
    lines.push("", `step: ${kept.join(" ")}`.trimEnd());
    if (step.narration) lines.push(`  ${keepReferences(step.narration, new Set([...written, ...numbers]))}`);
  }
  return { text: lines.join("\n"), names };
}

// The board as the code block that goes into a chat. Four backticks, so
// code blocks inside notes do not end it.
export function sketchBlock(text: string) {
  return `\`\`\`\`sketch\n${text}\n\`\`\`\``;
}
