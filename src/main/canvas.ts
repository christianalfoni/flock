// Each orchestrator's canvas: the one picture it talks to the person it
// works for with (the draw tool, agentMcp.ts), drawn in TTMI's diagram
// language (@ttmi/format) and shown on TTMI's board in Flock's window.
//
// Layout needs real text measurement, so only the window lays a canvas out
// (as in TTMI: the browser is the only layout engine). A drawing is checked
// here and queued as pending; the window merges each pending drawing into
// the board (the person's layout is kept), then saves the board and its
// text back, which clears what it applied. The orchestrator reads the board
// back as text (get_canvas), positions and all.
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parse } from "@babel/parser";
import { parseSketch, SketchFormatError, type CodeCheck } from "@ttmi/format";
import type { Canvas, CanvasAsk, CanvasBoard } from "../shared/canvas";
import { pullRequestUrl, type PullRequestDrawing } from "../shared/pullRequestCanvas";
import { newSteps, stepWords, withHeard } from "../shared/canvasHeard";

export type { Canvas, CanvasBoard };

let dir = "";
let notify: (channel: string, payload?: unknown) => void = () => undefined;
const cache = new Map<string, Canvas>();
let writes = 0;

export function startCanvases(dataDir: string, broadcast: (channel: string, payload?: unknown) => void) {
  dir = join(dataDir, "canvases");
  notify = broadcast;
}

const fileOf = (agentId: string) => join(dir, `${agentId.replace(/[^A-Za-z0-9_-]/g, "_")}.json`);

export async function readCanvas(agentId: string): Promise<Canvas> {
  const known = cache.get(agentId);
  if (known) return known;
  let canvas: Canvas = { agentId, version: 0, applied: 0, pending: [], updatedAt: 0 };
  try {
    canvas = { ...canvas, ...(JSON.parse(await readFile(fileOf(agentId), "utf8")) as Canvas) };
  } catch {
    // None yet.
  }
  // A canvas from before Flock kept what you heard: all of it counts as
  // heard, so only what is drawn from now on is new. A new one: nothing.
  if (!canvas.heard) canvas = { ...canvas, heard: canvas.version > 0 ? stepWordsOf(latestSource(canvas)) : [] };
  cache.set(agentId, canvas);
  return canvas;
}

// The newest drawing: one still to lay out, else the board's.
function latestSource(canvas: Canvas) {
  return canvas.pending.at(-1)?.source ?? canvas.boardText;
}

// The words of each step of a drawing's walkthrough.
function stepWordsOf(source: string | undefined): string[] {
  if (!source) return [];
  try {
    return parseSketch(source, undefined, []).steps.map((step) => stepWords(step.narration));
  } catch {
    return [];
  }
}

// You heard these steps' words (their voice ended, or you went past them).
export async function markHeard(agentId: string, words: string[]) {
  const canvas = await readCanvas(agentId);
  const heard = withHeard(canvas.heard ?? [], words.map(stepWords));
  if (heard.length === (canvas.heard ?? []).length && heard.every((text, index) => text === canvas.heard?.[index])) return;
  await store({ ...canvas, heard });
}

// How many steps of each canvas you have not heard.
export async function unheardCounts(agentIds: string[]): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const agentId of agentIds) {
    const canvas = await readCanvas(agentId);
    const count = newSteps(stepWordsOf(latestSource(canvas)), canvas.heard ?? []).length;
    if (count) counts[agentId] = count;
  }
  return counts;
}

async function store(canvas: Canvas) {
  cache.set(canvas.agentId, canvas);
  await mkdir(dir, { recursive: true });
  const path = fileOf(canvas.agentId);
  const temporary = `${path}.${process.pid}.${writes++}.tmp`;
  await writeFile(temporary, JSON.stringify(canvas), { mode: 0o600 });
  await rename(temporary, path);
  notify("canvas:updated", { agentId: canvas.agentId, version: canvas.version });
}

// A note's TypeScript and JavaScript must parse (TTMI's own check: pseudo
// code is simplified TypeScript; it need not type-check or run).
const checkCode: CodeCheck = (language, code) => {
  const script = !["typescript", "ts", "tsx", "mts", "cts"].includes(language);
  const jsx = ["tsx", "jsx", "javascript", "js", "mjs", "cjs"].includes(language);
  try {
    parse(code, {
      sourceType: "module",
      allowReturnOutsideFunction: true,
      allowAwaitOutsideFunction: true,
      allowNewTargetOutsideFunction: true,
      allowSuperOutsideMethod: true,
      allowUndeclaredExports: true,
      plugins: [...(script ? [] : (["typescript"] as const)), ...(jsx ? (["jsx"] as const) : [])],
    });
    return undefined;
  } catch (error) {
    const found = error as { message?: string; loc?: { line: number } };
    return { line: found.loc?.line ?? 1, message: (found.message ?? String(error)).replace(/\s*\(\d+:\d+\)$/, "") };
  }
};

// What the board would refuse, as "Line N: …"; undefined when it reads.
export function checkDrawing(source: string): string | undefined {
  try {
    parseSketch(source, undefined, [], { strict: true, checkCode });
  } catch (error) {
    return error instanceof SketchFormatError ? error.message : String(error);
  }
  // The only link a box takes in Flock is a pull request's: it becomes
  // that pull request's canvas (shared/pullRequestCanvas.ts). No ttmi.ai
  // sketches, and no other pages.
  const lines = source.split("\n");
  const sketch = lines.findIndex((line) => /ttmi\.ai\//.test(line));
  if (sketch >= 0) return `Line ${sketch + 1}: a canvas in Flock holds no ttmi.ai sketches; draw what it pointed at here.`;
  const link = lines.findIndex((line) => {
    const target = /\blink\s+"([^"]*)"/.exec(line)?.[1];
    return target !== undefined && !pullRequestUrl(target);
  });
  if (link >= 0) return `Line ${link + 1}: a box links only to a pull request (link "https://github.com/<owner>/<repo>/pull/<number>"); drop the link and draw what it pointed at here.`;
  return undefined;
}

const SUMMARY_LIMIT = 400;

// The ask an answer is for, and a summary they can hear.
function checkAnswer(asks: CanvasAsk[], answer: { ask: string; summary: string }) {
  const asked = asks.find((item) => item.id === answer.ask);
  if (!asked) throw new Error(`There is no ask ${answer.ask}. Use the id from the [Ask …] at the start of their message.`);
  const summary = answer.summary.trim();
  if (!summary) throw new Error("Give the summary they will hear: a sentence or two that answers them.");
  if (summary.length > SUMMARY_LIMIT) throw new Error(`The summary is said aloud: a sentence or two, under ${SUMMARY_LIMIT} characters. Put the rest in the drawing.`);
  return asked;
}

function answered(asks: CanvasAsk[], asked: CanvasAsk, answer: { summary: string }, playFrom: number | undefined, version: number): CanvasAsk[] {
  return asks.map((item) => item.id === asked.id ? { ...item, status: item.status === "done" ? "done" as const : "answered" as const, summary: answer.summary.trim(), resumeStep: playFrom ?? item.step, version } : item);
}

// A new drawing for an orchestrator's canvas: checked, then queued for the
// window to merge into the board. With an answer, it answers that ask: its
// summary is said once the drawing (if any) is in, and the walkthrough
// resumes at playFrom when they continue.
export async function addDrawing(agentId: string, source: string | undefined, playFrom?: number, answer?: { ask: string; summary: string }) {
  if (source !== undefined) {
    const problem = checkDrawing(source);
    if (problem) throw new Error(`${problem} Nothing was drawn; fix that line and draw again.`);
  }
  const canvas = await readCanvas(agentId);
  const asks = canvas.asks ?? [];
  const asked = answer ? checkAnswer(asks, answer) : undefined;
  if (source === undefined && !answer) throw new Error("Pass the drawing in source, or answer an ask with ask and summary.");
  const version = source === undefined ? canvas.version : canvas.version + 1;
  const pending = source === undefined ? canvas.pending : [...canvas.pending, { version, source, at: Date.now(), ...(playFrom ? { playFrom } : {}), ...(answer ? { ask: answer.ask } : {}) }];
  const nextAsks = answer && asked ? answered(asks, asked, answer, playFrom, version) : asks;
  await store({ ...canvas, version, pending, asks: nextAsks, updatedAt: Date.now() });
  return version;
}

// What they wrote while a canvas was shown, as an ask on the step they
// were on: an orchestrator's canvas (by its agent id), or a pull request's
// (by its link).
export async function addAsk(canvasId: string, question: string, step?: number): Promise<CanvasAsk> {
  const make = (asks: CanvasAsk[]): CanvasAsk => {
    const last = Number(asks.at(-1)?.id.slice(1)) || 0;
    return { id: `A${last + 1}`, question: question.trim(), ...(step ? { step } : {}), at: Date.now(), status: "waiting" };
  };
  const url = pullRequestUrl(canvasId);
  if (url) {
    const known = await readPullDrawings();
    const drawing = known[url];
    if (!drawing) throw new Error(`${url} has no drawing to ask about.`);
    const ask = make(drawing.asks ?? []);
    await storePullDrawings({ ...known, [url]: { ...drawing, asks: [...(drawing.asks ?? []), ask].slice(-20) } }, url);
    return ask;
  }
  const canvas = await readCanvas(canvasId);
  const asks = canvas.asks ?? [];
  const ask = make(asks);
  await store({ ...canvas, asks: [...asks, ask].slice(-20), updatedAt: Date.now() });
  return ask;
}

// They continued past its answer, or let it go.
export async function closeAsk(canvasId: string, askId: string) {
  const done = (asks: CanvasAsk[] = []) => asks.map((item) => item.id === askId ? { ...item, status: "done" as const } : item);
  const url = pullRequestUrl(canvasId);
  if (url) {
    const known = await readPullDrawings();
    const drawing = known[url];
    if (!drawing?.asks?.some((item) => item.id === askId)) return;
    await storePullDrawings({ ...known, [url]: { ...drawing, asks: done(drawing.asks) } }, url);
    return;
  }
  const canvas = await readCanvas(canvasId);
  if (!canvas.asks?.some((item) => item.id === askId)) return;
  await store({ ...canvas, asks: done(canvas.asks), updatedAt: Date.now() });
}

// The window laid the canvas out up to a version (or the person changed
// it): the board and its text, and the drawings it applied are done.
export async function saveBoard(agentId: string, input: { board: CanvasBoard; boardText: string; applied: number }) {
  const canvas = await readCanvas(agentId);
  const applied = Math.max(canvas.applied, Math.min(input.applied, canvas.version));
  await store({ ...canvas, board: input.board, boardText: input.boardText, applied, pending: canvas.pending.filter((item) => item.version > applied), updatedAt: Date.now() });
}

// The canvas as text for its orchestrator: the board with the person's
// layout, or, while drawings wait to be laid out, the newest of them.
export async function canvasText(agentId: string) {
  const canvas = await readCanvas(agentId);
  const latest = canvas.pending.at(-1);
  if (latest) {
    const shown = canvas.boardText ? "Its layout applies once Flock lays it out; the person's moves are kept." : "Flock has not laid it out yet.";
    return `Your newest drawing (version ${latest.version}); ${shown}\n\n${latest.source}`;
  }
  if (canvas.boardText) return `Your canvas as the person sees it (version ${canvas.applied}), with where they put things:\n\n${canvas.boardText}`;
  return "Your canvas is empty: you have not drawn anything yet.";
}

// Pull requests' canvases: each drawn by its worker (its draw, naming the
// pull request), by link, with its own asks. The window lays one out from
// its text, inside that pull request's box on its orchestrator's canvas, so
// it has no board of its own and nothing waits to be laid out.
let pullDrawings: Record<string, PullRequestDrawing> | undefined;
const pullFile = () => join(dir, "pull-requests.json");

export async function readPullDrawings(): Promise<Record<string, PullRequestDrawing>> {
  if (pullDrawings) return pullDrawings;
  try {
    pullDrawings = JSON.parse(await readFile(pullFile(), "utf8")) as Record<string, PullRequestDrawing>;
  } catch {
    pullDrawings = {};
  }
  return pullDrawings;
}

async function storePullDrawings(next: Record<string, PullRequestDrawing>, url: string) {
  pullDrawings = next;
  await mkdir(dir, { recursive: true });
  const temporary = `${pullFile()}.${process.pid}.${writes++}.tmp`;
  await writeFile(temporary, JSON.stringify(next), { mode: 0o600 });
  await rename(temporary, pullFile());
  notify("canvas:pull-drawings", { urls: [url] });
}

// A worker's draw: the pull request's whole drawing, or an answer to an ask
// on it (summary, the step to resume from, and the drawing when it changes).
export async function addPullDrawing(url: string, worker: string, source: string | undefined, playFrom?: number, answer?: { ask: string; summary: string }) {
  if (source !== undefined) {
    const problem = checkDrawing(source);
    if (problem) throw new Error(`${problem} Nothing was drawn; fix that line and draw again.`);
  }
  const known = await readPullDrawings();
  const drawing = known[url];
  const asks = drawing?.asks ?? [];
  const asked = answer ? checkAnswer(asks, answer) : undefined;
  if (source === undefined && !answer) throw new Error("Pass the drawing in source, or answer an ask with ask and summary.");
  if (source === undefined && !drawing) throw new Error(`There is no drawing of ${url} yet: draw it with source.`);
  const version = (drawing?.version ?? (drawing ? 1 : 0)) + (source === undefined ? 0 : 1);
  const next: PullRequestDrawing = {
    url,
    worker,
    source: source ?? drawing!.source,
    at: source === undefined ? drawing!.at : Date.now(),
    version,
    asks: answer && asked ? answered(asks, asked, answer, playFrom, version) : asks,
  };
  await storePullDrawings({ ...known, [url]: next }, url);
  return version;
}
