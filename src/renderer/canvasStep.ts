// Where each agent's canvas is, for the message box: what you write there
// is an ask on that step (from 1, as the step bar counts; undefined when it
// is not on one). Inside a pull request's canvas it goes to that pull
// request's worker instead of the orchestrator.
export type CanvasFocus = { step?: number; pull?: { url: string; worker: string } };
const focus = new Map<string, CanvasFocus>();

export function setCanvasFocus(agentId: string, where: CanvasFocus) {
  focus.set(agentId, where);
}

export function canvasFocus(agentId: string): CanvasFocus {
  return focus.get(agentId) ?? {};
}
