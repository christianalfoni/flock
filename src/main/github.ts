// Where a pull request stands, from GitHub through the `gh` CLI (with the
// user's own login): open, draft, conflicting, merged or closed, and its CI
// (shared/pullRequestStatus.ts reads gh's answer). Nothing here needs an
// account of the app's own; without `gh`, pull requests show as not followed.
import type { PullRequest } from "../shared/types";
import { ciOf, stateOf, type PullView } from "../shared/pullRequestStatus";
import { run } from "./adapters/shell";

export async function pullRequestStatus(url: string): Promise<PullRequest | undefined> {
  const result = await run("gh", ["pr", "view", url, "--json", "number,title,state,isDraft,mergeable,statusCheckRollup"], { timeout: 30_000 });
  if (result.code !== 0) {
    console.warn(`[github] ${url}: ${result.stderr.trim()}`);
    return undefined;
  }
  try {
    const view = JSON.parse(result.stdout) as PullView;
    return { url, number: view.number, title: view.title, state: stateOf(view), ciState: ciOf(view.statusCheckRollup) };
  } catch {
    return undefined;
  }
}
