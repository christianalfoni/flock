// A worker's git worktree: made for its task on a branch of its own, and
// removed with it, but never with work that exists nowhere else.
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { basename, join } from "node:path";
import { run } from "./adapters/shell";

async function git(cwd: string, args: string[]) {
  const result = await run("git", args, { cwd, timeout: 60_000 });
  if (result.code !== 0) throw new Error(`git ${args[0]}: ${(result.stderr || result.stdout).trim()}`);
  return result.stdout.trim();
}

// The repository's top folder, or an error naming what is wrong.
export async function repositoryRoot(folder: string): Promise<string> {
  const result = await run("git", ["rev-parse", "--show-toplevel"], { cwd: folder });
  if (result.code !== 0) throw new Error(`${folder} is not in a git repository.`);
  return result.stdout.trim();
}

// A branch name from a task's title: flock/w3-fix-the-login.
export function branchName(worker: string, title: string): string {
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40).replace(/-+$/, "");
  return `flock/${worker.toLowerCase()}${slug ? `-${slug}` : ""}`;
}

// Makes the worktree, on a new branch from the repository's current commit.
export async function createWorktree(repo: string, root: string, worker: string, title: string) {
  const base = await git(repo, ["rev-parse", "HEAD"]);
  let branch = branchName(worker, title);
  // A branch left from before (a removed worker's, kept) is not reused.
  if ((await run("git", ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`], { cwd: repo })).code === 0) branch = `${branch}-${Date.now().toString(36)}`;
  const folder = join(root, `${basename(repo)}-${worker.toLowerCase()}`);
  await mkdir(root, { recursive: true });
  if (existsSync(folder)) throw new Error(`${folder} is in the way; remove it and try again.`);
  await git(repo, ["worktree", "add", "-b", branch, folder, base]);
  // Where its commits go: the repository's git folder, shared by its worktrees.
  const common = await git(folder, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
  return { branch, worktree: folder, base, gitDir: common };
}

// What would be lost with the worktree: changes not committed, and commits
// on no remote and not on the branch it started from.
export async function unsavedWork(worktree: string, base: string): Promise<{ uncommitted: number; unpushed: number }> {
  if (!existsSync(worktree)) return { uncommitted: 0, unpushed: 0 };
  const status = await git(worktree, ["status", "--porcelain"]);
  const commits = await git(worktree, ["rev-list", "HEAD", "--not", base, "--remotes"]);
  return { uncommitted: status ? status.split("\n").length : 0, unpushed: commits ? commits.split("\n").length : 0 };
}

// Removes the worktree. Its branch goes too when it has nothing of its own
// (no commits past where it started); otherwise it stays.
export async function removeWorktree(repo: string, worktree: string, branch: string, base: string): Promise<{ keptBranch: boolean }> {
  let keptBranch = false;
  if (existsSync(worktree)) await git(repo, ["worktree", "remove", "--force", worktree]);
  else await run("git", ["worktree", "prune"], { cwd: repo });
  const own = await run("git", ["rev-list", `refs/heads/${branch}`, "--not", base], { cwd: repo });
  if (own.code === 0 && !own.stdout.trim()) await run("git", ["branch", "-D", branch], { cwd: repo });
  else keptBranch = own.code === 0;
  return { keptBranch };
}
