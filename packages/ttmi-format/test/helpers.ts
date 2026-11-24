import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { isBoxShape, type ArrowShape, type BoxShape, type Shape } from "../src/index";

// The sketch texts that were used while building the format, in the
// repository's reference material.
export const EXAMPLES = join(fileURLToPath(new URL(".", import.meta.url)), "../../../reference/examples");

export function example(name: string) {
  return readFileSync(join(EXAMPLES, name), "utf8");
}

// Sketch texts kept with the tests: drawings that showed a layout problem.
export function fixture(name: string) {
  return readFileSync(join(fileURLToPath(new URL(".", import.meta.url)), "fixtures", name), "utf8");
}

export function examples() {
  return readdirSync(EXAMPLES).filter((file) => file.endsWith(".sketch")).sort();
}

// The sketches the guide shows agents (get_guide, apps/server/guide): every
// four-backtick `sketch` block in any of its pages, with its fences
// stripped. Agents copy these, so they must parse.
export const GUIDE = join(EXAMPLES, "../../apps/server/guide");

export function guideSketches() {
  const pages = readdirSync(GUIDE, { recursive: true, encoding: "utf8" }).filter((file) => file.endsWith(".md")).sort();
  return pages.flatMap((page) => [...readFileSync(join(GUIDE, page), "utf8").matchAll(/^````sketch\n([\s\S]*?)\n````$/gm)].map((match) => match[1]!));
}

export function boxesByName(shapes: Shape[]) {
  return new Map(shapes.filter(isBoxShape).filter((shape) => shape.name).map((shape) => [shape.name!, shape] as [string, BoxShape]));
}

export function arrows(shapes: Shape[]) {
  return shapes.filter((shape): shape is ArrowShape => shape.kind === "arrow");
}

// The exported line for a named shape, without its position.
export function shapeLine(text: string, name: string) {
  return text.split("\n").find((line) => line.startsWith(`${name}:`));
}

export function arrowLine(text: string, from: string, to: string) {
  return text.split("\n").find((line) => line.startsWith(`${from} -> ${to}`));
}

// A board as the user left it: none of its shapes where the layout put
// them (docs/format.md, Merge), so an update keeps every position.
export function byUser(shapes: Shape[]): Shape[] {
  return shapes.map((shape) => {
    if (shape.kind === "arrow" || !shape.laidOut) return shape;
    const { laidOut: _laidOut, ...rest } = shape;
    return rest;
  });
}
