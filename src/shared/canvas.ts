// An orchestrator's canvas, as main (canvas.ts) stores it and the window
// shows it: TTMI's board state, its text, and the drawings still to lay out.
import type { Shape, SketchGroup, SketchStep, SketchTerm } from "@ttmi/format";

export type CanvasBoard = { shapes: Shape[]; steps: SketchStep[]; groups: SketchGroup[]; terms: SketchTerm[] };
// A drawing the window has not laid out yet. playFrom: the walkthrough step
// (from 1) the person should hear first; absent, it is shown without playing.
// ask: the ask it answers; its walkthrough resumes when they continue.
export type PendingDrawing = { version: number; source: string; at: number; playFrom?: number; ask?: string };
// What you write to an orchestrator while its canvas is shown: an ask, as in
// TTMI's walkthrough. It waits for the orchestrator's answer: a summary
// they hear, the step to resume from, and the drawing changed when it should
// (version: the drawing that answer came with, shown before the summary).
export type CanvasAsk = { id: string; question: string; step?: number; at: number; status: "waiting" | "answered" | "done"; summary?: string; resumeStep?: number; version?: number };
export type Canvas = {
  agentId: string;
  // Increases with every drawing.
  version: number;
  // The board as the window last saved it, and its text (with positions).
  board?: CanvasBoard;
  boardText?: string;
  // The newest drawing the board has.
  applied: number;
  pending: PendingDrawing[];
  // Its asks, oldest first (the last few).
  asks?: CanvasAsk[];
  // The words of the walkthrough's steps you have heard (shared/canvasHeard.ts).
  heard?: string[];
  updatedAt: number;
};
