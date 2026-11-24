import { test } from "node:test";
import assert from "node:assert/strict";
import { likeness, newSteps, stepWords, withHeard } from "./canvasHeard.ts";

test("a step's words, as they are compared", () => {
  assert.equal(stepWords("  W91's change\n  is   green. "), "W91's change is green.");
  assert.equal(stepWords(undefined), "");
});

test("new steps: words not heard, never one without words", () => {
  const words = ["", "W87 built the seam.", "W91 is green now.", "W93 waits on CI."];
  assert.deepEqual(newSteps(words, ["W87 built the seam.", "W93 waits on CI."]), [2]);
  assert.deepEqual(newSteps(words, words), []);
});

test("heard words: added once, the newest last, capped", () => {
  assert.deepEqual(withHeard(["a", "b"], ["b", "c", ""]), ["a", "b", "c"]);
  assert.deepEqual(withHeard(["a", "b", "c"], ["d"], 2), ["c", "d"]);
});

test("a step reworded a little is not new; one with other news is", () => {
  const heard = ["Nearly done on your side. One optional worker, one piece with Sam, one question for you."];
  assert.deepEqual(newSteps(["Nearly done on your side. One optional worker, one piece with Sam, and one question for you."], heard), []);
  assert.deepEqual(newSteps(["New: all three PRs are green and reviewed with ship. Start with the playground fix."], heard), [0]);
  assert.ok(likeness("[the fix](pr18492) is green", "the fix is green") === 1);
});
