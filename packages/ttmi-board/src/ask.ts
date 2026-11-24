// The walkthrough's Ask prompt: plain text the reader pastes into the agent
// session that drew the sketch (docs/board.md, Ask). The board shows only
// the question. Acronyms stay in capitals.

export const ASK_INSTRUCTION = "Fetch this sketch with get_sketch. Answer by calling save_sketch with this ask ID.";

// A silent overview is the ready state's whole drawing, so the walkthrough
// and ?step= both start after it (docs/board.md, Walkthrough).
export function firstCountedStep(steps: { kind?: string; narration?: string }[]): number {
  return steps.length > 1 && steps[0]?.kind === "overview" && !steps[0]?.narration ? 1 : 0;
}

export function countedStepAt(steps: { kind?: string; narration?: string }[], index: number): { step: number; count: number } | undefined {
  const first = firstCountedStep(steps);
  if (index < first || index >= steps.length) return undefined;
  return { step: index - first + 1, count: steps.length - first };
}

// ?step=N, N from 1 as the step bar counts it. Undefined when N is not a stop.
export function indexForCountedStep(steps: { kind?: string; narration?: string }[], step: number): number | undefined {
  if (!Number.isInteger(step) || step < 1) return undefined;
  const index = firstCountedStep(steps) + step - 1;
  return index < steps.length ? index : undefined;
}

export function stepLink(origin: string, id: string, step: number): string {
  const url = new URL(`/s/${id}`, origin.endsWith("/") ? origin : `${origin}/`);
  url.searchParams.set("step", String(step));
  return url.toString();
}

export function askPrompt(input: { question: string; id: string; url: string; askId: string }): string {
  return [
    input.question.trim(),
    "",
    `Sketch ID: ${input.id}`,
    `URL: ${input.url}`,
    `Ask ID: ${input.askId}`,
    "",
    ASK_INSTRUCTION,
  ].join("\n");
}

// The summary stays on screen after it has been said. The voice ending is
// not a continue. Space and the Continue button are, and they are the same
// action: Space skips whatever of the voice is left, the way Space and Play
// agree when the walkthrough is ready to start. On a step, Space pauses;
// this caption is waiting to go on.
export const ASK_CONTINUE_HINT = { key: "Space", label: "to continue" } as const;

export function askSummaryKey(key: string): "continue" | undefined {
  return key === " " ? "continue" : undefined;
}

// Where playback starts once the reader continues. The step they asked
// about, when the agent named none. A resumeCanvas other than this sketch
// is that canvas.
export function askResume(answer: { step: number; resumeStep?: number; resumeCanvas?: string }, sketchId?: string): { step: number; canvas?: string } {
  const step = answer.resumeStep ?? answer.step;
  if (answer.resumeCanvas && answer.resumeCanvas !== sketchId) return { step, canvas: answer.resumeCanvas };
  return { step };
}
