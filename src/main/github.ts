// Where a pull request stands, from GitHub through the `gh` CLI (with the
// user's own login): open, draft, conflicting, merged or closed, and its CI.
// Nothing here needs an account of the app's own; without `gh`, pull
// requests show as not followed.
import type { PullRequest, PullRequestCiState, PullRequestState } from "../shared/types";
import { run } from "./adapters/shell";

type Check = { status?: string; conclusion?: string; state?: string };
type View = { number: number; title: string; state: string; isDraft: boolean; mergeable?: string; statusCheckRollup?: Check[] };

export function ciOf(checks: Check[] | undefined): PullRequestCiState {
  if (!checks?.length) return "unknown";
  const outcome = (check: Check) => (check.conclusion || check.state || "").toUpperCase();
  if (checks.some((check) => ["FAILURE", "ERROR", "CANCELLED", "TIMED_OUT", "ACTION_REQUIRED", "STARTUP_FAILURE"].includes(outcome(check)))) return "failing";
  if (checks.some((check) => ["IN_PROGRESS", "QUEUED", "PENDING", "WAITING", "REQUESTED", "EXPECTED"].includes((check.status || check.state || "").toUpperCase()) && !check.conclusion)) return "pending";
  return "passing";
}

export function stateOf(view: View): PullRequestState {
  if (view.state === "MERGED") return "merged";
  if (view.state === "CLOSED") return "closed";
  if (view.isDraft) return "draft";
  if (view.mergeable === "CONFLICTING") return "conflict";
  return "open";
}

export async function pullRequestStatus(url: string): Promise<PullRequest | undefined> {
  const result = await run("gh", ["pr", "view", url, "--json", "number,title,state,isDraft,mergeable,statusCheckRollup"], { timeout: 30_000 });
  if (result.code !== 0) return undefined;
  try {
    const view = JSON.parse(result.stdout) as View;
    return { url, number: view.number, title: view.title, state: stateOf(view), ciState: ciOf(view.statusCheckRollup) };
  } catch {
    return undefined;
  }
}
