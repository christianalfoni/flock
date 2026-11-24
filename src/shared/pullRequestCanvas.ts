// Pull requests on a canvas. An orchestrator puts each of its workers' pull
// requests in its drawing as a box labelled with its number:
//
//   pr18381: box "#18381"
//
// (a link to the pull request does the same), and the worker draws that
// change with its own draw, naming the pull request. In the window, the box
// becomes a nested canvas: the worker's drawing inside it, to dive into and
// play, under a badge with the number, coloured by where the pull request
// stands, from Flock's own facts. The board only nests sketches by id, so
// the box gets that id before the board reads the drawing, and loses it
// again when its text goes to the orchestrator.
import type { CanvasAsk } from "./canvas";
import type { PullRequestCiState, PullRequestState } from "./types";

// A worker's drawing of one pull request: what it changes and why, its
// version (one more each time it is drawn) and the asks on it.
export type PullRequestDrawing = { url: string; source: string; at: number; worker: string; version?: number; asks?: CanvasAsk[] };

// What a canvas knows of a pull request (an orchestrator's worker's).
// worker: the worker it is, working: whether that worker is at work now;
// review: where its review stands (reviewStanding), when it has one.
export type CanvasPullRequest = { url: string; number: number; title?: string; state?: PullRequestState; ciState?: PullRequestCiState; worker?: string; working?: boolean; review?: { label: string; tone: PullTone; running?: boolean } };

const PULL = /^https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/pull\/(\d+)(?:[/?#].*)?$/;

// The pull request a link is, as one spelling; undefined when it is not one.
export function pullRequestUrl(value: string | undefined): string | undefined {
  const match = value?.trim().match(PULL);
  if (!match) return undefined;
  return `https://github.com/${match[1]}/${match[2]}/pull/${match[3]}`;
}

// The id the board knows a pull request's canvas by.
export function pullCanvasId(url: string): string {
  const match = url.match(PULL);
  if (!match) return "";
  return `pr-${match[1]}-${match[2]}-${match[3]}`.replace(/[^\w-]/g, "_").slice(-80);
}

const LINK = /\blink\s+"([^"]*)"/;
const URL_LABEL = /\bbox\s+"(https:\/\/github\.com\/[^"]*)"/;
const NUMBER_LABEL = /\bbox\s+"#(\d+)"/;

// The pull request numbers a drawing has a box for (`box "#18381"`, or a
// box linked to it).
export function drawnPullNumbers(source: string): Set<number> {
  const found = new Set<number>();
  for (const line of source.split("\n")) {
    const number = NUMBER_LABEL.exec(line)?.[1];
    if (number) found.add(Number(number));
    const linked = pullRequestUrl(LINK.exec(line)?.[1] ?? URL_LABEL.exec(line)?.[1]);
    if (linked) found.add(Number(linked.split("/").pop()));
  }
  return found;
}

// The drawing as the board reads it: each pull request box links to its
// canvas id. `numbers` gives a number's pull request (its workers'). `ids`
// gains each id with its link, and whether Flock added it (a box written as
// "#N"), to turn them back.
export function linksToCanvases(source: string, ids: Map<string, string>, numbers: ReadonlyMap<number, string> = new Map(), added: Set<string> = new Set()): string {
  return source.split("\n").map((line) => {
    const number = NUMBER_LABEL.exec(line)?.[1];
    const numbered = number && !LINK.test(line) ? numbers.get(Number(number)) : undefined;
    if (numbered) {
      const id = pullCanvasId(numbered);
      ids.set(id, numbered);
      added.add(id);
      return `${line} link "${id}"`;
    }
    const link = LINK.exec(line);
    const linked = pullRequestUrl(link?.[1]);
    if (link && linked) {
      const id = pullCanvasId(linked);
      ids.set(id, linked);
      return line.replace(LINK, `link "${id}"`);
    }
    const label = URL_LABEL.exec(line);
    const labelled = pullRequestUrl(label?.[1]);
    if (label && labelled && !link) {
      const id = pullCanvasId(labelled);
      ids.set(id, labelled);
      return line.replace(URL_LABEL, `box "#${labelled.split("/").pop()}" link "${id}"`);
    }
    return line;
  }).join("\n");
}

// The board's text as the orchestrator wrote it: canvas ids back to links,
// and no link where Flock added one.
export function canvasesToLinks(text: string, ids: ReadonlyMap<string, string>, added: ReadonlySet<string> = new Set()): string {
  return text.replace(/\s*\blink\s+"(pr-[\w-]+)"/g, (whole, id: string) => {
    if (added.has(id)) return "";
    const url = ids.get(id);
    return url ? ` link "${url}"` : whole;
  });
}

export type PullTone = "orange" | "green" | "red" | "yellow" | "blue" | "violet" | "muted";

// Where a pull request stands, in a word or two, and its colour. working:
// its worker is at work now (it changes it), which goes before CI.
export function pullStanding(pull: CanvasPullRequest | undefined, working = false): { label: string; tone: PullTone } {
  if (!pull) return { label: "Not followed", tone: "muted" };
  if (pull.state === "merged") return { label: "Merged", tone: "violet" };
  if (pull.state === "closed") return { label: "Closed", tone: "muted" };
  // Failing CI shows first, as the chat's badge does: red even while its
  // worker is at it (fixing it, most likely) or it conflicts too.
  if (pull.ciState === "failing") return { label: "CI failing", tone: "red" };
  if (working) return { label: "Working", tone: "yellow" };
  if (pull.state === "conflict") return { label: "Conflict", tone: "orange" };
  if (pull.state === "queued") return { label: "In the queue", tone: "blue" };
  if (pull.state === "draft") return { label: "Draft", tone: "muted" };
  if (pull.ciState === "pending") return { label: "CI running", tone: "yellow" };
  if (pull.ciState === "passing") return { label: "Ready", tone: "green" };
  // A repository without CI: nothing is checked, and nothing holds it back.
  if (pull.ciState === "none") return { label: "Open", tone: "green" };
  return { label: "Open", tone: "muted" };
}

// Where a pull request's review stands, from its latest review's outcome
// (ship, fix-first, stale, not-worth-it, rethink or split), whether that
// review is of the commit it is at, and whether one is running now: the
// word beside the review's mark (an eye), none while one runs. Undefined
// when it has no review.
export function reviewStanding(latest: { outcome: string; current: boolean } | undefined, running = false): { label: string; tone: PullTone; running?: boolean } | undefined {
  if (running) return { label: "", tone: "muted", running: true };
  if (!latest) return undefined;
  const outcome = latest.outcome.toLowerCase();
  if (outcome === "stale" || !latest.current) return { label: "Stale", tone: "muted" };
  if (outcome === "ship") return { label: "Ship", tone: "green" };
  if (outcome === "fix-first") return { label: "Fix first", tone: "red" };
  const words = outcome.replace(/-/g, " ");
  return { label: words[0]!.toUpperCase() + words.slice(1), tone: "red" };
}

// The badge on a pull request's canvas: its number and its worker. Its
// colour says where it stands.
export function pullBadge(url: string, worker?: string): string {
  return `#${url.split("/").pop()}${worker ? ` · ${worker}` : ""}`;
}

// The pull requests an orchestrator's drawing must have: every open or
// draft one of its active workers.
export function pullsInScope(pulls: CanvasPullRequest[]): CanvasPullRequest[] {
  return pulls.filter((pull) => pull.state !== "merged" && pull.state !== "closed");
}
