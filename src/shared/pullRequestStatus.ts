// Where a pull request stands, read from `gh pr view --json
// number,title,state,isDraft,mergeable,statusCheckRollup` (main/github.ts).
import type { PullRequestCiState, PullRequestState } from "./types";

// A check run (status, conclusion) or a commit status (state), as gh gives them.
export type Check = { status?: string; conclusion?: string; state?: string };
export type PullView = { number: number; title: string; state: string; isDraft: boolean; mergeable?: string; statusCheckRollup?: Check[] };

const FAILED = new Set(["FAILURE", "ERROR", "CANCELLED", "TIMED_OUT", "ACTION_REQUIRED", "STARTUP_FAILURE"]);
const RUNNING = new Set(["IN_PROGRESS", "QUEUED", "PENDING", "WAITING", "REQUESTED", "EXPECTED"]);

// CI: failing when any check failed (whatever else runs), running while any
// runs, passing when all finished otherwise; unknown with no checks.
export function ciOf(checks: Check[] | undefined): PullRequestCiState {
  if (!checks?.length) return "unknown";
  if (checks.some((check) => FAILED.has((check.conclusion || check.state || "").toUpperCase()))) return "failing";
  if (checks.some((check) => !check.conclusion && RUNNING.has((check.status || check.state || "").toUpperCase()))) return "pending";
  return "passing";
}

export function stateOf(view: Pick<PullView, "state" | "isDraft" | "mergeable">): PullRequestState {
  if (view.state === "MERGED") return "merged";
  if (view.state === "CLOSED") return "closed";
  if (view.isDraft) return "draft";
  if (view.mergeable === "CONFLICTING") return "conflict";
  return "open";
}
