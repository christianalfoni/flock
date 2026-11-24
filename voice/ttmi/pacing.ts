// The voice lab's walkthrough: a sketch's steps paced exactly as the board
// paces them (src/voice/pace.ts), with the reasons shown, so what is tuned
// here is what plays there.
import { narrationParts, parseSketch, referableNames, type NarrationPart } from "@ttmi/format";
import type { Compiled } from "./lab";
import { density, densityScore, paceStep, stepLoads, type Kind } from "./pace";

export type Fresh = { name: string; kind: Kind; label: string };

export type PacedStep = {
  parts: NarrationPart[];
  fresh: Fresh[];
  again: string[];
  load: number;
  compiled: Compiled;
  reasons: string[];
};

export type Paced = { steps: PacedStep[]; names: Map<string, Fresh> };

export function pace(source: string, viewerSpeed = 1): Paced {
  const { shapes, steps, groups } = parseSketch(source);
  const names = new Map<string, Fresh>();
  for (const shape of shapes) {
    if (shape.kind === "arrow" || !shape.name) continue;
    names.set(shape.name, shape.kind === "note" ? { name: shape.name, kind: "note", label: noteLabel(shape.html) } : { name: shape.name, kind: "box", label: shape.label });
  }
  for (const group of groups) names.set(group.name, { name: group.name, kind: "group", label: group.label });
  const loads = stepLoads(shapes, steps, groups);
  return {
    names,
    steps: steps.map((step, index) => {
      const load = loads[index]!;
      const parts = narrationParts(step.narration, referableNames(shapes, groups));
      const paced = paceStep(parts, load, viewerSpeed);
      const text = parts.map((part) => part.text).join("");
      const fresh = [...load.fresh.keys()].map((name) => names.get(name)!).filter(Boolean);
      const again = step.names.filter((name) => !load.fresh.has(name));
      const held = paced.segments.filter((segment) => segment.hold).map((segment) => segment.hold!.toFixed(2));
      const compiled: Compiled = {
        pieces: paced.segments.map((segment) => ({ text: segment.text, ...(segment.hold ? { hold: segment.hold } : {}) })),
        text,
        shown: paced.segments.map((segment) => `${segment.hold ? `⏸${segment.hold.toFixed(2)} ` : ""}${segment.text}`).join("").trim(),
        speed: paced.speed ?? 1,
        complexity: { score: densityScore(text), factor: density(text), reasons: [] },
        leadIn: paced.leadIn ?? 0,
      };
      const reasons = [
        fresh.length ? `brings in ${fresh.map((shape) => shape.label || shape.name).join(", ")}` : "brings in nothing new",
        ...(again.length ? [`points at ${again.join(", ")} again`] : []),
        `load ${load.load}`,
        `${compiled.leadIn.toFixed(2)} s before it speaks`,
        `speed ${compiled.speed.toFixed(2)} (density ${compiled.complexity.score.toFixed(2)})`,
        ...(held.length ? [`holds ${held.join(", ")} s`] : []),
      ];
      return { parts, fresh, again, load: load.load, compiled, reasons };
    }),
  };
}

// A note by its first block (its heading, usually), not its code.
const noteLabel = (html: string) => {
  const first = /<(h[1-6]|p)\b[^>]*>([\s\S]*?)<\/\1>/.exec(html);
  return (first?.[2] ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 40) || "Note";
};
