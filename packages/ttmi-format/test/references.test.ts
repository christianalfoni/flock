// References in narration (docs/format.md, Steps): words the narration says
// about a shape, written like a markdown link, `[the worker](worker)`.
import { describe, expect, it } from "vitest";
import { narrationParts, narrationText, parseSketch, referableNames, serializeSketch } from "../src";
import { example, examples } from "./helpers";

const SOURCE = `# sketch Retries
worker: box "Worker"
retry: note
  ## Retry
api: box "API"
edge: group "Edge" of api
worker -> api "reply"

step: worker retry
  When [the worker](worker) fails a job, it puts it back with [a backoff](retry).
step: edge
  Then [the edge](edge) answers.`;

describe("narration references", () => {
  const names = ["worker", "retry", "api", "edge"];

  it("cut the narration into the words said and the shape they point at", () => {
    expect(narrationParts("When [the worker](worker) fails a job, it puts it back with [a backoff](retry).", names)).toEqual([
      { text: "When " },
      { text: "the worker", name: "worker" },
      { text: " fails a job, it puts it back with " },
      { text: "a backoff", name: "retry" },
      { text: "." },
    ]);
  });

  it("name groups too", () => {
    expect(narrationParts("Then [the edge](edge) answers.", names)).toEqual([{ text: "Then " }, { text: "the edge", name: "edge" }, { text: " answers." }]);
  });

  it("read a name that is not a shape or group as the words alone", () => {
    expect(narrationParts("See [the docs](docs) here.", names)).toEqual([{ text: "See the docs here." }]);
  });

  it("leave links and brackets that are not references as they are", () => {
    const text = "See [x](https://example.com), [](worker) and [a] (worker).";
    expect(narrationParts(text, names)).toEqual([{ text }]);
    expect(narrationText(text, names)).toBe(text);
  });

  it("read back as the words alone", () => {
    expect(narrationText("When [the worker](worker) fails, [a backoff](retry).", names)).toBe("When the worker fails, a backoff.");
  });

  it("are no parts in an empty narration", () => {
    expect(narrationParts("", names)).toEqual([]);
  });

  it("keep the narration as written through parse and export", () => {
    const { shapes, steps, groups } = parseSketch(SOURCE);
    expect(steps[0]!.narration).toBe("When [the worker](worker) fails a job, it puts it back with [a backoff](retry).");
    const text = serializeSketch(shapes, "Retries", steps, groups).text;
    const again = parseSketch(text);
    expect(again.steps).toEqual(steps);
    expect(serializeSketch(again.shapes, "Retries", again.steps, again.groups).text).toBe(text);
  });

  it("are dropped on export when their shape is gone, keeping the words", () => {
    const { shapes, steps, groups } = parseSketch(SOURCE);
    const without = shapes.filter((shape) => shape.kind === "arrow" || shape.name !== "retry");
    const { text } = serializeSketch(without, "Retries", steps, groups);
    expect(text).toContain("  When [the worker](worker) fails a job, it puts it back with a backoff.");
  });

  it("change nothing in the examples", () => {
    for (const file of examples()) {
      const { shapes, steps, groups } = parseSketch(example(file));
      const present = [...shapes.flatMap((shape) => (shape.kind !== "arrow" && shape.name ? [shape.name] : [])), ...groups.map((group) => group.name)];
      for (const step of steps) expect(narrationText(step.narration, present)).toBe(step.narration);
    }
  });

  it("point at an arrow by its number: the hop in the flow", () => {
    const source = `# sketch Flow
chat: box "Chat"
chrome: box "Chrome"
app: box "App"
chat -> chrome seq 1 "click link"
chrome -> app seq 2a "open window"
chat -> app "aside"

step: chat chrome app
  You [click the link](#1), and Chrome [opens the window](#2a). Not [this one](#3).`;
    const { shapes, steps, groups } = parseSketch(source);
    const names = referableNames(shapes, groups);
    expect([...names].sort()).toEqual(["#1", "#2a", "app", "chat", "chrome"]);
    expect(narrationParts(steps[0]!.narration, names)).toEqual([
      { text: "You " },
      { text: "click the link", name: "#1" },
      { text: ", and Chrome " },
      { text: "opens the window", name: "#2a" },
      { text: ". Not this one." },
    ]);
    // Kept through export while the arrow is numbered; words once it is not.
    expect(serializeSketch(shapes, "Flow", steps, groups).text).toContain("You [click the link](#1), and Chrome [opens the window](#2a). Not [this one](#3).".replace("[this one](#3)", "this one"));
    const renumbered = shapes.map((shape) => (shape.kind === "arrow" && shape.seq === "1" ? { ...shape, seq: undefined } : shape));
    expect(serializeSketch(renumbered, "Flow", steps, groups).text).toContain("You click the link, and Chrome [opens the window](#2a).");
  });
});
