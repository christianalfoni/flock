// Every reference example parses, and exporting then re-importing then
// exporting again gives identical text (the round trip from fmt-run.cjs).
import { describe, expect, it } from "vitest";
import { parseSketch, serializeSketch, sketchTitle } from "../src/index";
import { boxesByName, example, examples, guideSketches } from "./helpers";

describe("reference examples", () => {
  const names = examples();

  it("are all present", () => {
    expect(names).toEqual(["deploy.sketch", "groups.sketch", "janitor-routing.sketch", "janitor.sketch", "job-retries-steps.sketch", "job-retries.sketch", "tags.sketch"]);
  });

  for (const name of names) {
    describe(name, () => {
      const source = example(name);
      const title = sketchTitle(source);

      it("parses", () => {
        expect(() => parseSketch(source)).not.toThrow();
      });

      it("has a title", () => {
        expect(title).toBeTruthy();
      });

      it("round-trips: export, import into the board, export again gives identical text", () => {
        const first = parseSketch(source);
        const exported = serializeSketch(first.shapes, title, first.steps, first.groups).text;
        const again = parseSketch(exported, undefined, first.shapes);
        const exportedAgain = serializeSketch(again.shapes, title, again.steps, again.groups).text;
        expect(exportedAgain).toBe(exported);
        expect(again.groups).toEqual(first.groups);
      });

      it("keeps every shape's name, id, position and size through the round trip", () => {
        const first = parseSketch(source);
        const exported = serializeSketch(first.shapes, title, first.steps, first.groups).text;
        const again = parseSketch(exported, undefined, first.shapes);
        const before = boxesByName(first.shapes);
        const after = boxesByName(again.shapes);
        expect([...after.keys()]).toEqual([...before.keys()]);
        for (const [name, shape] of before) {
          const kept = after.get(name)!;
          expect(kept.id).toBe(shape.id);
          expect([kept.x, kept.y, kept.w, kept.h]).toEqual([shape.x, shape.y, shape.w, shape.h]);
        }
      });

      it("keeps its steps through the round trip", () => {
        const first = parseSketch(source);
        const exported = serializeSketch(first.shapes, title, first.steps, first.groups).text;
        const again = parseSketch(exported, undefined, first.shapes);
        expect(again.steps).toEqual(first.steps);
      });

      it("exports shapes that a fresh parse reads back the same", () => {
        // Arrows may be routed differently on a fresh parse (there is no
        // board arrow to take a bend from), but the shapes are given in full.
        const first = parseSketch(source);
        const exported = serializeSketch(first.shapes, title, first.steps, first.groups).text;
        const fresh = parseSketch(exported);
        const exportedFresh = serializeSketch(fresh.shapes, title, fresh.steps, fresh.groups).text;
        const shapeLines = (text: string) => text.split("\n").filter((line) => !line.includes("->"));
        expect(shapeLines(exportedFresh)).toEqual(shapeLines(exported));
      });
    });
  }
});

// The guide's own examples are what agents copy, so they must parse and
// survive the same round trip.
describe("guide examples", () => {
  const sketches = guideSketches();

  it("exist, in four-backtick sketch blocks", () => {
    expect(sketches.length).toBeGreaterThanOrEqual(2);
  });

  for (const [index, source] of sketches.entries()) {
    describe(`block ${index + 1}: ${sketchTitle(source)}`, () => {
      it("parses", () => {
        expect(() => parseSketch(source)).not.toThrow();
      });

      it("has a title", () => {
        expect(sketchTitle(source)).toBeTruthy();
      });

      it("round-trips: export, import into the board, export again gives identical text", () => {
        const first = parseSketch(source);
        const title = sketchTitle(source);
        const exported = serializeSketch(first.shapes, title, first.steps).text;
        const again = parseSketch(exported, undefined, first.shapes);
        expect(serializeSketch(again.shapes, title, again.steps).text).toBe(exported);
        expect(again.steps).toEqual(first.steps);
      });
    });
  }
});
