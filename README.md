# Flock

> **Beta.** Flock is early: expect rough edges, and changes to how it stores your agents between versions. It runs coding agents on your machine with the permissions you give them in Settings; keep an eye on what they do. Issues and feedback are welcome.

A desktop app where you talk to coding agents through a canvas. Each agent answers by drawing: a few boxes and a walkthrough you play, with its voice, step by step. It runs on the coding CLIs already installed on your machine (Claude Code, Codex). An agent's workers are git worktrees, each with its own CLI session.

No accounts, no cloud, no config file: pick a git repository, start an agent, talk.

## What it does

1. **You start an agent on a repository.** The agent is an *orchestrator*: one long CLI session that plans and does not edit files itself.
2. **You talk to it.** In the **Canvas** view, what you write is an *Ask* about the walkthrough step you are on. In the **Chat** view, you see the plain transcript.
3. **It answers by drawing.** Its `draw` tool sets its canvas, which is a [TTMI](https://ttmi.ai) drawing with a narrated walkthrough. The app merges each drawing into your board and keeps where you moved things.
4. **It starts workers.** `start_worker` creates a git worktree and branch for the task, starts a CLI session there with the worker's instructions, and hands it the task.
5. **Workers report back.** A worker's `report` reaches its orchestrator as a `[Flock]` message. When a worker opens a pull request (with `gh`), it draws the change, and that drawing shows nested inside the pull request's box on the orchestrator's canvas. The app follows each pull request's state and CI through `gh` (at start, then every minute); a change is news for the orchestrator and recolours its badge on the canvas.
6. **Removing a worker** stops its session and removes its worktree. The app refuses while the worktree has uncommitted changes or commits that exist nowhere else, unless you confirm (the branch is then kept).

## Download

Get the latest build from [Releases](https://github.com/christianalfoni/flock/releases):

| | File |
|---|---|
| macOS, Apple Silicon | `Flock-<version>-mac-arm64.dmg` |
| macOS, Intel | `Flock-<version>-mac-x64.dmg` |
| Linux | `Flock-<version>-linux-x86_64.AppImage` (or `arm64`), or the `.tar.gz` |
| Windows (experimental) | `Flock-<version>-win-x64.exe` |

The builds are not signed with a developer certificate yet, so your system asks before opening them the first time:

- **macOS:** open the `.dmg` and drag Flock to Applications. On first launch macOS says it cannot check the app: open **System Settings → Privacy & Security** and choose **Open Anyway** (or run `xattr -dr com.apple.quarantine /Applications/Flock.app` once).
- **Linux:** `chmod +x Flock-*.AppImage`, then run it.
- **Windows:** SmartScreen warns about an unknown publisher: **More info → Run anyway**. Windows is built but untested; driving the CLIs there may not work yet.

There are no automatic updates yet: download a newer build to update.

## Requirements

- macOS or Linux (Windows experimental)
- At least one coding CLI, installed and logged in:
  - [Claude Code](https://docs.claude.com/en/docs/claude-code) (`claude`)
  - [Codex](https://github.com/openai/codex) (`codex`)
- Optional: [`gh`](https://cli.github.com), logged in, for pull requests

## Run it from source

Needs Node 22 and pnpm.

```sh
pnpm install
pnpm dev          # the app, with hot reload
pnpm build && pnpm start
pnpm typecheck
pnpm test
```

`FLOCK_DATA_DIR=/some/folder pnpm start` keeps everything (agents, canvases, transcripts, worktrees) in another folder, to try things without touching your agents.

## How a CLI session is driven

Each CLI is an adapter (`src/main/adapters/`) behind one interface: start a session in a folder with instructions and the app's tools, send it messages, stream back what it does, stop it.

| | Claude Code | Codex |
|---|---|---|
| Process | One long `claude --print` per session, `stream-json` in and out | One `codex exec --json` per turn; later turns use `exec … resume <thread>` |
| Messages mid-turn | Written to stdin; Claude queues them | Held, and sent together as the next turn |
| App's tools | `--mcp-config` with a bearer token, `--strict-mcp-config` | `-c mcp_servers.flock.*` overrides, tools approved ahead |
| Instructions | `--append-system-prompt-file` | `-c developer_instructions=…` |
| Resume after restart | `--resume <session id>` | `resume <thread id>` |

The app serves its tools itself, over MCP on `127.0.0.1` (`src/main/mcp.ts`): `/mcp/orchestrator` and `/mcp/worker`, with a token per session, so it knows which agent is calling.

## Orchestrators and kinds of workers

Everything about how agents run is in Settings, not set per agent:

- **Orchestrator:** the CLI and model every orchestrator runs on, and instructions of your own on top of Flock's.
- **Workers:** kinds of workers, each with a name, what it is for, a CLI, a model and instructions. An orchestrator reads them with its `worker_kinds` tool and picks one per task (`start_worker(…, kind)`). For example, a careful kind on Claude Code with Opus for features, and a quick one on Codex with a small model for one-line fixes.

## Permissions

Settings → *What agents may do without asking*, set separately for orchestrators and workers:

| Mode | Claude Code | Codex |
|---|---|---|
| **Ask me** (default) | File edits are allowed. Anything else goes to the app's `permission` tool (`--permission-prompt-tool`), which shows Allow / Deny at the top right | Codex cannot ask from `exec`, so it runs as *Edits only* |
| **Edits only** | `acceptEdits`; anything that would prompt is refused | `workspace-write` sandbox, `approval_policy="never"` |
| **Everything** | `--dangerously-skip-permissions` | `--dangerously-bypass-approvals-and-sandbox` |

Orchestrators never get Claude's `Edit`/`Write` tools, and Codex runs them in the `read-only` sandbox.

## Releasing

1. Set the version in `package.json` (a beta is `0.1.0-beta.N`) and commit.
2. Tag it and push the tag: `git tag v0.1.0-beta.N && git push origin v0.1.0-beta.N`.
3. [The Release workflow](.github/workflows/release.yml) checks types and tests, builds macOS (arm64, x64), Linux (x64, arm64) and Windows (x64), and publishes them to a GitHub pre-release of that tag.

`pnpm dist:mac` (or `dist:linux`, `dist:win`) packages locally into `dist/`. Running the workflow by hand builds all three and keeps them as the run's artifacts, without publishing.

## Layout

```
src/main/        Electron main: agents and workers (agents.ts), the MCP server (mcp.ts),
                 adapters/ (one per CLI), worktrees (git.ts), pull requests (github.ts),
                 canvas storage (canvas.ts), the role guides (guides.ts)
src/renderer/    The window, in Flock's look: main.tsx (header, left bar, the agent's page,
                 the workers panel, settings), avatar.tsx (the agents' characters),
                 canvas.tsx (TTMI's board and walkthrough), voiceGate.ts (the voice
                 only sounds after a press of yours)
src/shared/      Types, the drawing guides, pull request canvases and status,
                 "new since you heard it", TTMI's drawing guide (ttmiGuide.md)
packages/        TTMI's board, sketch format and model (a pnpm workspace)
voice/           TTMI's voice (voice/ttmi), and what the app takes from it
docs/design.md   The design this started from
```

## Not in it (yet)

- Several repositories in one agent; an agent is one repository.
- Nested canvases for workers without a pull request (a repository with no GitHub remote): their work shows as a branch and a report.
- Permission prompts for Codex.
- Packaging (a signed `.app`).
