// A bend the user set survives re-opening a block that has no bend
// (bend-run.cjs on the janitor routing sketch).
import { describe, expect, it } from "vitest";
import { parseSketch, serializeSketch } from "../src/index";
import { arrowLine, example } from "./helpers";

describe("bend-run", () => {
  const source = example("janitor-routing.sketch");
  const title = "Janitor";

  it("keeps the user's bend through a re-import of the agent's bend-less block", () => {
    // 1. Opened fresh: the arrow is routed automatically.
    const opened = parseSketch(source);
    const auto = arrowLine(serializeSketch(opened.shapes, title).text, "upkeep", "janitor")!;
    expect(auto).toMatch(/^upkeep -> janitor "nudge SWEEP"( bend -?\d+)?$/);

    // 2. The user bends it (here: through a block with a bend, which wins).
    const bent = serializeSketch(opened.shapes, title).text.replace(/^(upkeep -> janitor "nudge SWEEP")( bend -?\d+)?$/m, "$1 bend 120");
    const userBent = parseSketch(bent, undefined, opened.shapes);
    expect(arrowLine(serializeSketch(userBent.shapes, title).text, "upkeep", "janitor")).toBe('upkeep -> janitor "nudge SWEEP" bend 120');

    // 3. The agent's original block again, which has no bends.
    const reopened = parseSketch(source, undefined, userBent.shapes);
    expect(arrowLine(serializeSketch(reopened.shapes, title).text, "upkeep", "janitor")).toBe('upkeep -> janitor "nudge SWEEP" bend 120');
  });

  it("routes the long arrow across the drawing with a bend", () => {
    // upkeep -> index "any entry due?" has to get past every other shape.
    const opened = parseSketch(source);
    const line = arrowLine(serializeSketch(opened.shapes, title).text, "upkeep", "index")!;
    expect(line).toMatch(/^upkeep -> index "any entry due\?" bend -?\d+$/);
  });
});
