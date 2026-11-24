import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { composeCanvasGuide } from "./canvasGuide.ts";

const ttmi = readFileSync(new URL("./ttmiGuide.md", import.meta.url), "utf8");
const guide = composeCanvasGuide(ttmi);

test("the canvas guide keeps TTMI's language, in its order", () => {
  for (const title of ["The format", "Lines", "What to draw", "Code", "Kinds of picture", "Layout", "Walkthrough", "Narration", "Before you save"]) {
    assert.match(guide, new RegExp(`^## ${title}$`, "m"), title);
  }
  assert.ok(guide.indexOf("## The format") < guide.indexOf("## Narration"));
});

test("it has Flock's tools and none of TTMI the service", () => {
  assert.match(guide, /^# Drawing your canvas/);
  assert.match(guide, /`draw\(source, play_from\?\)`/);
  assert.match(guide, /^## Updating your canvas$/m);
  for (const gone of ["save_sketch", "get_sketch", "share_sketch", "list_sketches", "## Splitting a big picture", "Ask button", "to sketches you saved", "split the picture into several sketches"]) {
    assert.ok(!guide.includes(gone), gone);
  }
});

test("the orchestrator links pull requests; the worker draws them", () => {
  assert.match(guide, /^## Pull requests$/m);
  const worker = composeCanvasGuide(ttmi, "worker");
  assert.match(worker, /^# Drawing your pull requests/);
  assert.match(worker, /`draw\(pull_request, source\)`/);
  assert.match(worker, /^## Their asks$/m);
  assert.match(guide, /pr18381: box "#18381"/);
  assert.match(worker, /^## The format$/m);
  assert.ok(!worker.includes("get_canvas"));
});

test("every message is an ask, answered with draw", () => {
  assert.match(guide, /^## Their asks$/m);
  assert.match(guide, /\[Ask A3, on step 2\]/);
  assert.match(guide, /`summary`/);
  assert.ok(!composeCanvasGuide(ttmi, "worker").includes("[Ask A3, on step 2]"));
});
