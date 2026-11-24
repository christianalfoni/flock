# Flock Local

A desktop app where you talk to coding agents through a canvas. Each agent answers by drawing: a few boxes and a walkthrough you play, with its voice, step by step. It runs on the coding CLIs already installed on your machine (Claude Code, Codex, …), and an agent's workers are git worktrees, each with its own CLI session.

This is a new project, built from what [Flock](#where-it-comes-from) already proved out. Flock is personal: it runs workers as cloud sessions, plans in Linear and Biscuit Issues, and has review, insight and migration tools. Flock Local keeps only the core: **orchestrator agents, their workers, and the canvas.** The goal is that anyone can start it and get going.

## What it is

1. **An Electron app.** Built like Flock: electron-vite, React, the TTMI board linked from `~/Development/ttmi`.
2. **An abstraction over the common coding CLIs.** The app starts and drives the CLI sessions. It doesn't call model APIs itself. Each CLI is an *adapter* (one module per CLI) behind one interface: start a session in a folder with a prompt, tools and instructions; send it a message; stream back what it does; stop it.
3. **It starts orchestrator agents.** An orchestrator is one long CLI session that you talk to. Its tools, served by the app over MCP (the protocol CLIs use to take extra tools):
   - `draw`: its answer, as a TTMI drawing with a walkthrough (and the answer to an Ask; see below).
   - `start_worker`: starts a worker on a task (below).
   - `message_worker`, `workers`, `remove_worker`: talk to its workers, see where they stand, and end one.
4. **A worker is a git worktree with its own CLI session.** `start_worker` does three things:
   1. Creates a worktree and a branch for the task.
   2. Starts a CLI session in it with the worker's instructions and tools.
   3. Hands it the task.

   Removing the worker stops its session **and removes its worktree** (refusing, or asking, when it has uncommitted or unpushed work). A worker's tools:
   - `report`: tells its orchestrator what it did; the app passes the report on.
   - `draw`: draws its pull request's canvas, nested inside the orchestrator's canvas.
5. **Instructions come with the tools.** The app starts each CLI with a short guide for its role, through the CLI's system-prompt option, so the agent knows to answer with `draw`, how to draw well, and how to use the worker tools. Flock's guides are the starting point (see the references), cut down for a general coding agent.
6. **Canvas and Chat views, as in Flock.**
   - **Canvas:** the agent's drawing, played as a walkthrough with voice. Your messages are Asks on the step you're on, answered by drawing again. Pull requests appear as nested canvases.
   - **Chat:** the plain transcript, for when you want it.
7. **It works with no setup.** On start it finds which CLIs are installed and logged in, and offers those (the first found is the default). It needs no accounts of its own, no cloud and no config file. You pick a folder (a git repository), start an agent and talk.

## Not in it

Reviews, insights, migration, the Linear and Biscuit Issues integrations, the From Linear and Review requests views, the timeline, cloud workers, and the Tailscale/web publishing. Flock's code for these is in the same files as what is kept, so copy selectively.

## How a CLI session is driven

Checked on this machine (2026-11-24): `claude` and `codex` are installed; `gemini`, `cursor-agent`, `opencode` and `amp` are not.

- **Claude Code** (`claude`), headless, which is how the app should run it:
  - `--print` with `--input-format stream-json --output-format stream-json`: one long-running process you write messages to and read events from.
  - `--mcp-config <file> --strict-mcp-config`: only the app's tools (orchestrator or worker), not the user's other MCP servers.
  - `--append-system-prompt`: the role's guide.
  - `--session-id` / `--resume`: give a session an id and continue it after a restart.
  - `--permission-mode`: how much it may do without asking. This is a decision to make.
  - Also look at the Claude Agent SDK, which wraps the same thing as a library.
- **Codex** (`codex`):
  - `exec`: non-interactive runs.
  - `mcp`: manages the MCP servers Codex uses.
  - `app-server`: experimental; a long-running server, which may suit an app better than `exec`.

  Which of these suits a long, multi-turn session is still to be found out.

The app serves the MCP tools itself, over HTTP on localhost: one endpoint per role, with a token per session, so it knows which agent is calling. Flock does the same for its cloud sessions; see `src/main/agentMcp.ts`.

## Where it comes from

Flock: `~/Development/builder-dispatch`. The canvas work is on the `dev` branch; a worktree of it is at `~/Development/builder-dispatch-canvas`.

| What | Where in Flock | Keep |
|---|---|---|
| The canvas: board, walkthrough, Asks, new-step marks, nested pull request canvases | `src/renderer/canvas.tsx` | Most of it |
| When the voice may sound (only after a press of yours) | `src/renderer/voiceGate.ts` | All of it. Read its comment first; several bugs led here |
| Loading skeleton | `src/renderer/canvasSkeleton.tsx` | All |
| Which step you're on, for Asks | `src/renderer/canvasStep.ts` | All |
| "New since you last heard it" (step likeness, 80%) | `src/shared/canvasHeard.ts` (+ test) | All |
| Pull requests on the canvas: `box "#N"` links, badge colours | `src/shared/pullRequestCanvas.ts` (+ test) | All |
| The agents' drawing guides | `src/shared/canvasGuide.ts` | Cut down |
| Canvas storage: drawings, Asks, heard steps | `src/main/canvas.ts` | Most |
| MCP tools for orchestrators and workers (`draw`, `start_worker`, `report`, …) | `src/main/agentMcp.ts` | Rework for local sessions |
| IPC for the canvas (`canvas:ask`, `canvas:heard`, …), worker news to orchestrators | `src/main/index.ts` | Only the canvas and worker parts |
| Left bar, avatars, chat, prompt, Canvas/Chat switch | `src/renderer/src.tsx` (large) | Pieces of it |
| Styles (one `--working` colour, canvas rules at the end) | `src/renderer/style.css` | Selectively |
| The TTMI voice, used in place, and its aliases | `electron.vite.config.ts`, `src/renderer/ttmiVoice.d.ts`, `ttmiVoiceStubs.ts` | All |
| Routine prompts for orchestrators and workers | `scripts/routine.ts` | As a reference for the guides |

TTMI: `~/Development/ttmi`, linked, not copied:
- `packages/board`: the SketchBoard
- `packages/format`: the sketch text format
- `packages/model`
- `apps/web/src/voice`: the voice

Flock's `package.json` shows how they're linked. Flock relies on some TTMI board changes that were still uncommitted in the TTMI checkout on 2026-11-24:
- nested canvases update in place
- hovering a narration word moves the camera

Commit those before depending on them.

## Lessons Flock already paid for

- **The voice must never play without a press.** Every way TTMI's voice can start is listed in `voiceGate.ts`, along with how each is closed.
- **Pages must be served from a custom protocol (`app://`), not `file://`.** The voice needs a SharedWorker, which doesn't run from `file://`.
- **Measure the board only while it's in the document.** Measured while detached, notes come out zero-sized and their titles vanish. Kept canvases defer merges until shown.
- **A sent message must not count as "working" forever.** Match it to the transcript ignoring whitespace, with a timeout.
- **Enter sent from the prompt must not reach the canvas,** including held-key repeats after focus moves to it.

## Open questions

- Each CLI's long-running mode: `claude --print` with stream-json, or the Agent SDK; for Codex, `exec` or `app-server`.
- Permissions: what workers may do without asking, and how a permission prompt reaches you in the app.
- Pull requests: does a worker open one with `gh`, and does the app follow its CI and review state (Flock polls GitHub in `src/main/github.ts`)?
- Several repositories, or one per window.
- Whether an orchestrator is optional: a single agent with a canvas and no workers may be the right first step.
