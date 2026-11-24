import { test } from "node:test";
import assert from "node:assert/strict";
import { canvasesToLinks, drawnPullNumbers, linksToCanvases, pullBadge, pullCanvasId, pullRequestUrl, pullsInScope, pullStanding, reviewStanding } from "./pullRequestCanvas.ts";

const URL = "https://github.com/acme/app/pull/18381";

test("a pull request link is one spelling, whatever page of it", () => {
  assert.equal(pullRequestUrl(`${URL}/files`), URL);
  assert.equal(pullRequestUrl(` ${URL}#discussion `), URL);
  assert.equal(pullRequestUrl("https://github.com/acme/app/issues/3"), undefined);
  assert.equal(pullRequestUrl("https://ttmi.ai/s/abc"), undefined);
});

test("a pull request's canvas id is one the board nests", () => {
  const id = pullCanvasId("https://github.com/acme/my.app/pull/42");
  assert.equal(id, "pr-acme-my_app-42");
  assert.match(id, /^[\w-]{1,80}$/);
});

test("links go to canvas ids for the board, and back for the orchestrator", () => {
  const source = [
    "# sketch Private state",
    `pr2: box "Chat private half" link "${URL}/files"`,
    `pr3: box "https://github.com/acme/app/pull/18418"`,
    "goal: box \"Goal\"",
  ].join("\n");
  const ids = new Map<string, string>();
  const board = linksToCanvases(source, ids);
  assert.match(board, /pr2: box "Chat private half" link "pr-acme-app-18381"/);
  assert.match(board, /pr3: box "#18418" link "pr-acme-app-18418"/);
  assert.match(board, /goal: box "Goal"$/m);
  const text = canvasesToLinks(board, ids);
  assert.match(text, new RegExp(`link "${URL}"`));
  assert.match(text, /link "https:\/\/github.com\/acme\/app\/pull\/18418"/);
});

test("where a pull request stands, and its badge", () => {
  const pull = { url: URL, number: 18381, title: "Chat private half", state: "open" as const, ciState: "passing" as const };
  assert.deepEqual(pullStanding(pull), { label: "Ready", tone: "green" });
  assert.equal(pullStanding({ ...pull, ciState: "failing" }).tone, "red");
  assert.equal(pullStanding({ ...pull, state: "conflict" }).label, "Conflict");
  assert.equal(pullStanding({ ...pull, state: "merged" }).tone, "violet");
  assert.equal(pullStanding({ ...pull, ciState: "pending" }).tone, "yellow");
  assert.equal(pullStanding({ ...pull, ciState: "pending" }, true).tone, "yellow");
  // Failing CI is red even while its worker is at it, or it conflicts too.
  assert.equal(pullStanding({ ...pull, ciState: "failing" }, true).tone, "red");
  assert.equal(pullStanding({ ...pull, state: "conflict", ciState: "failing" }).tone, "red");
  assert.equal(pullStanding({ ...pull, state: "conflict" }).tone, "orange");
  assert.equal(pullStanding(undefined).label, "Not followed");
  // No CI at all: open, and green (nothing holds it back); not known yet: grey.
  assert.deepEqual(pullStanding({ ...pull, ciState: "none" }), { label: "Open", tone: "green" });
  assert.equal(pullStanding({ ...pull, ciState: "unknown" }).tone, "muted");
  assert.equal(pullBadge(URL), "#18381");
  assert.equal(pullBadge(URL, "W104"), "#18381 · W104");
});

test("a box labelled with a number is that pull request's canvas, and back", () => {
  const source = `# sketch Plan\npr18381: box "#18381"\npr9: box "#9"\ngoal: box "Goal"`;
  const ids = new Map<string, string>();
  const added = new Set<string>();
  const board = linksToCanvases(source, ids, new Map([[18381, URL]]), added);
  assert.match(board, /pr18381: box "#18381" link "pr-acme-app-18381"/);
  assert.match(board, /pr9: box "#9"$/m);
  assert.equal(canvasesToLinks(board, ids, added), source);
  assert.deepEqual([...drawnPullNumbers(source)].sort(), [18381, 9].sort());
  assert.deepEqual([...drawnPullNumbers(`pr: box "Seam" link "${URL}"`)], [18381]);
});

test("in scope: every open or draft pull request", () => {
  const pulls = [{ url: URL, number: 1, state: "open" as const }, { url: URL, number: 2, state: "draft" as const }, { url: URL, number: 3, state: "merged" as const }, { url: URL, number: 4, state: "closed" as const }, { url: URL, number: 5, state: "queued" as const }];
  assert.deepEqual(pullsInScope(pulls).map((pull) => pull.number), [1, 2, 5]);
});

test("where a pull request's review stands", () => {
  assert.equal(reviewStanding(undefined), undefined);
  assert.deepEqual(reviewStanding({ outcome: "ship", current: true }), { label: "Ship", tone: "green" });
  assert.deepEqual(reviewStanding({ outcome: "ship", current: false }), { label: "Stale", tone: "muted" });
  assert.deepEqual(reviewStanding({ outcome: "fix-first", current: true }), { label: "Fix first", tone: "red" });
  assert.deepEqual(reviewStanding({ outcome: "not-worth-it", current: true }), { label: "Not worth it", tone: "red" });
  assert.deepEqual(reviewStanding({ outcome: "ship", current: true }, true), { label: "", tone: "muted", running: true });
});
