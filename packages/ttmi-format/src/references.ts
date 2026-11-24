// References in narration (docs/format.md, Steps): the words a narration
// says about a shape, written like a markdown link, `[the worker](worker)`,
// or about a hop of the flow, by its arrow's number, `[clicks](#1)`.
// The narration is kept as written; the board and the voice read the
// references out of it. Brackets around words followed by a name always
// read as the words; they point at something only when the name is a shape
// or group of the sketch. A link to anything else (a URL) is left as it is.

import type { Shape, SketchGroup, SketchStep } from "./types";

export type NarrationPart = { text: string; name?: string };

const REFERENCE = /\[([^[\]\n]+)\]\(([A-Za-z][A-Za-z0-9_-]*|#[1-9]\d?[a-z]?)\)/g;

// What narration can point at: the named boxes and notes, the groups, and
// the numbered arrows, as "#" and their number ("#2", "#3a").
export function referableNames(shapes: Shape[], groups: SketchGroup[] = []): Set<string> {
  return new Set([
    ...shapes.flatMap((shape) => (shape.kind === "arrow" ? (shape.seq ? [`#${shape.seq}`] : []) : shape.name ? [shape.name] : [])),
    ...groups.map((group) => group.name),
  ]);
}

// The narration cut into plain runs and the words said about a shape. The
// runs' text joined is what is shown and spoken.
export function narrationParts(text: string, names: Iterable<string>): NarrationPart[] {
  if (!text) return [];
  const known = names instanceof Set ? (names as Set<string>) : new Set(names);
  const parts: NarrationPart[] = [];
  let plain = "";
  let at = 0;
  for (const match of text.matchAll(REFERENCE)) {
    plain += text.slice(at, match.index);
    at = match.index + match[0].length;
    // A name that is gone (a shape the user deleted) leaves its words.
    if (!known.has(match[2]!)) {
      plain += match[1];
      continue;
    }
    if (plain) parts.push({ text: plain });
    plain = "";
    parts.push({ text: match[1]!, name: match[2]! });
  }
  plain += text.slice(at);
  if (plain) parts.push({ text: plain });
  return parts;
}

// What is shown and spoken: the narration with its references' words alone.
export function narrationText(text: string, names: Iterable<string>) {
  return narrationParts(text, names)
    .map((part) => part.text)
    .join("");
}

// The narration with references to names that are gone written as their
// words, the way a step drops names that are gone.
export function keepReferences(text: string, names: Set<string>) {
  return text.replace(REFERENCE, (whole, words: string, name: string) => (names.has(name) ? whole : words));
}

// Every step's narration as its parts, against the shapes and groups the
// board has now: what the voice speaks, step by step.
export function stepParts(shapes: Shape[], steps: SketchStep[], groups: SketchGroup[] = []): NarrationPart[][] {
  const names = referableNames(shapes, groups);
  return steps.map((step) => narrationParts(step.narration, names));
}
