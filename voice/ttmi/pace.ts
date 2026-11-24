// How a step is said, from the sketch (docs/plan-voice-pacing.md). The
// way the layout places shapes the agent never positions, this times the
// narration the agent never times: the agent writes plain, well-punctuated
// words, and what a step brings in decides how they are spoken.
//   - A step that brings in more (boxes, notes to read, groups) waits a
//     little longer before it speaks, talks a little slower and breathes
//     longer between its sentences. The first step brings in the most.
//   - The first time a step names a shape it brings in, the next pause in
//     the words is held, so the eye can find what just lit up; longer for a
//     note, which has text to read.
//   - A dense text (long sentences, long words, terms) is slowed too.
// Everything here is Kokoro's own: one call per step at one speed, its own
// pauses at the punctuation, and silence added where it already paused.
// The viewer moves from step to step, so the time between steps is theirs.
import { hopEnds, narrationParts, referableNames, type Shape, type SketchGroup, type SketchStep } from "@ttmi/format";
import { PHONEME_MARK, plainText } from "@ttmi/model";
import type { Segment } from "./cues";

// A step to speak: its pieces (a hold is silence before a piece), its
// speed, the silence before it starts, and the words said before it only
// as context, then cut off (docs/plan-voice-context.md): the last sentence
// of the step before, so a step starts mid-explanation, not cold.
export type Step = { segments: Segment[]; speed?: number; leadIn?: number; before?: string };

export type Kind = "box" | "note" | "group";
// What a step brings in, by name (a group's members too), and what that
// asks of the eye.
export type StepLoad = { fresh: Map<string, Kind>; load: number; first: boolean };

export const BASE_SPEED = 0.92;
// The viewer's own speed multiplies everything else, within these bounds.
export const SPEED_RANGE = { min: 0.8, max: 1.2 };

const HOLD = { box: 0.3, note: 0.5, group: 0.4 } satisfies Record<Kind, number>;

export function stepLoads(shapes: Shape[], steps: SketchStep[], groups: SketchGroup[] = []): StepLoad[] {
  const kinds = new Map<string, Kind>();
  const weights = new Map<string, number>();
  for (const shape of shapes) {
    if (shape.kind === "arrow" || !shape.name) continue;
    kinds.set(shape.name, shape.kind === "note" ? "note" : "box");
    weights.set(shape.name, shape.kind === "note" ? 1.5 + Math.min(1.5, plain(shape.html).length / 240) : 1);
  }
  const members = new Map(groups.map((group) => [group.name, group.members]));
  for (const group of groups) kinds.set(group.name, "group");
  // A hop ("#2") names the shapes at both its ends.
  const hops = hopEnds(shapes);
  const named = (step: SketchStep) => step.names.flatMap((name) => (name.startsWith("#") ? hops.get(name)?.names ?? [] : [name]));
  // A walkthrough of overview, hops and summary shows the whole drawing
  // throughout (docs/format.md, Walkthrough): the overview introduces
  // every part, a hop brings its two ends into focus, the summary nothing.
  if (steps.some((step) => step.kind)) {
    return steps.map((step, index) => {
      const fresh = new Map<string, Kind>();
      // A note the narration names opens as it is said: the voice holds
      // after it, like after any shape it brings into focus.
      const notes = narrationParts(step.narration, referableNames(shapes, groups)).flatMap((part) => (part.name && kinds.get(part.name) === "note" ? [part.name] : []));
      const focus = [...new Set([...(step.kind === "overview" ? [...weights.keys()] : step.kind === "hop" ? named(step) : []), ...notes])];
      for (const name of focus) fresh.set(name, kinds.get(name) ?? "box");
      const load = step.kind === "summary" && !notes.length ? 1 : focus.reduce((sum, name) => sum + (weights.get(name) ?? 1), 0) + (index === 0 ? 1 : 0);
      return { fresh, load: round(load, 2), first: index === 0 };
    });
  }
  // Showing before any step: whatever no step names.
  const stepped = new Set(steps.flatMap((step) => named(step).flatMap((name) => [name, ...(members.get(name) ?? [])])));
  const showing = new Set([...kinds.keys()].filter((name) => !stepped.has(name) && !members.has(name)));
  return steps.map((step, index) => {
    const fresh = new Map<string, Kind>();
    let load = index === 0 ? 1 : 0;
    for (const name of named(step)) {
      const kind = kinds.get(name);
      if (!kind) continue;
      const inside = members.get(name) ?? [];
      const brought = (kind === "group" ? inside : [name]).filter((member) => !showing.has(member));
      if (brought.length) {
        if (kind === "group") {
          fresh.set(name, "group");
          load += 0.5;
        }
        for (const member of brought) {
          fresh.set(member, kinds.get(member) ?? "box");
          load += weights.get(member) ?? 1;
        }
      }
      showing.add(name);
      for (const member of inside) showing.add(member);
    }
    return { fresh, load: round(load, 2), first: index === 0 };
  });
}

// A step's pieces with their holds, its speed and its lead-in. The words
// are only cut, never changed: the pieces' text joined is the narration.
export function paceStep(segments: Segment[], load: StepLoad, viewerSpeed = 1): Step {
  const text = segments.map((segment) => segment.text).join("");
  if (!text.trim()) return { segments };
  const level = Math.min(load.load, 6);
  // A word with its phonemes is one word: no hold inside it.
  const marks = [...text.matchAll(PHONEME_MARK)].map((match) => [match.index, match.index + match[0].length] as const);
  const inMark = (at: number) => marks.some(([from, to]) => at > from && at < to);
  const holds = new Map<number, number>();
  const hold = (at: number, seconds: number) => {
    if (at <= 0 || at >= text.length || inMark(at)) return;
    holds.set(at, Math.max(holds.get(at) ?? 0, seconds));
  };
  // A breath after every sentence but the last.
  const breath = round(0.15 + 0.03 * Math.min(load.load, 5), 2);
  for (const match of text.matchAll(/[.!?…]+["”’)]?\s+(?=\S)/g)) hold(match.index + match[0].length, breath);
  // After a new shape is first named, the next pause.
  const named = new Set<string>();
  let at = 0;
  for (const segment of segments) {
    const end = at + segment.text.length;
    const kind = segment.name ? load.fresh.get(segment.name) : undefined;
    if (segment.name && kind && !named.has(segment.name)) {
      named.add(segment.name);
      const pause = /[,.;:?!…—]+["”’)]?\s*/g;
      pause.lastIndex = end;
      let found = pause.exec(text);
      while (found && inMark(found.index)) found = pause.exec(text);
      if (found) hold(found.index + found[0].length, HOLD[kind]);
    }
    at = end;
  }
  return {
    segments: cut(segments, holds),
    speed: round(BASE_SPEED * (1 - 0.012 * level) * density(plainText(text)) * clamp(viewerSpeed, SPEED_RANGE.min, SPEED_RANGE.max), 3),
    leadIn: round(Math.min(1.4, 0.3 + 0.1 * level + (load.first ? 0.3 : 0)), 2),
  };
}

// The pieces cut where the holds are, each hold on the piece after it. A
// hold that falls inside the words about a shape waits for their end.
function cut(segments: Segment[], holds: Map<number, number>): Segment[] {
  const out: Segment[] = [];
  let at = 0;
  let carried = 0;
  for (const segment of segments) {
    const end = at + segment.text.length;
    const inside = [...holds].filter(([position]) => position >= at && position < end).sort((a, b) => a[0] - b[0]);
    if (segment.name) {
      const before = inside.filter(([position]) => position === at).reduce((sum, [, seconds]) => Math.max(sum, seconds), carried);
      out.push(before ? { ...segment, hold: before } : { ...segment });
      carried = inside.filter(([position]) => position > at).reduce((sum, [, seconds]) => Math.max(sum, seconds), 0);
    } else {
      let from = at;
      let pending = carried;
      for (const [position, seconds] of inside) {
        if (position === at) {
          pending = Math.max(pending, seconds);
          continue;
        }
        out.push(pending ? { text: segment.text.slice(from - at, position - at), hold: pending } : { text: segment.text.slice(from - at, position - at) });
        from = position;
        pending = seconds;
      }
      out.push(pending ? { text: segment.text.slice(from - at), hold: pending } : { text: segment.text.slice(from - at) });
      carried = 0;
    }
    at = end;
  }
  return out;
}

// A walkthrough's steps paced, each with the last sentence of the one
// before as its context.
export function paceWalkthrough(steps: Segment[][], loads: StepLoad[], viewerSpeed = 1, plainLoad: StepLoad = { fresh: new Map(), load: 1, first: false }): Step[] {
  return steps.map((segments, index) => {
    const step = paceStep(segments, loads[index] ?? plainLoad, viewerSpeed);
    const before = index > 0 ? lastSentence(steps[index - 1]!.map((segment) => segment.text).join("")) : undefined;
    return before ? { ...step, before } : step;
  });
}

export function lastSentence(text: string): string | undefined {
  return text.trim().split(/(?<=[.!?…]["”’)]?)\s+/).at(-1)?.trim() || undefined;
}

// How dense the words are, as a factor on the speed: about 1.04 for a
// light step down to 0.88 for a dense one (long sentences, long words,
// terms, lists). Speech rate and complexity compound.
export function density(text: string): number {
  return round(1.04 - 0.16 * densityScore(text) ** 1.2, 3);
}

export function densityScore(text: string): number {
  const sentences = text.split(/(?<=[.!?…])\s+/).filter((sentence) => /\w/.test(sentence));
  const words = text.match(/[\p{L}\p{N}][\p{L}\p{N}'_-]*/gu) ?? [];
  if (!words.length) return 0;
  const perSentence = words.length / Math.max(1, sentences.length);
  const long = words.filter((word) => word.length >= 9).length / words.length;
  const terms = words.filter((word) => /[a-z][A-Z]|_|\d|^[A-Z]{2,}$/.test(word)).length;
  const commas = (text.match(/,/g) ?? []).length / Math.max(1, sentences.length);
  return round(clamp(clamp((perSentence - 10) / 12, 0, 1) * 0.35 + clamp((long - 0.08) / 0.17, 0, 1) * 0.25 + clamp(terms / 4, 0, 1) * 0.25 + clamp((commas - 1) / 3, 0, 1) * 0.15, 0, 1), 3);
}

const plain = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&[a-z]+;/g, " ").replace(/\s+/g, " ").trim();
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const round = (value: number, digits: number) => Math.round(value * 10 ** digits) / 10 ** digits;
