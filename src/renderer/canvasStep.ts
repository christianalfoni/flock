// Where each agent's canvas is, for the message box: what you write there
// is an ask on that step (from 1, as the step bar counts; undefined when it
// is not on one). Inside a pull request's canvas it goes to that pull
// request's worker instead of the orchestrator. The message box listens, to
// say where what you write goes.
import { useSyncExternalStore } from "react";

// ask: an ask on show, waiting for its answer or answered.
export type CanvasFocus = { step?: number; pull?: { url: string; worker: string }; ask?: "waiting" | "answered" };
const focus = new Map<string, CanvasFocus>();
const listeners = new Set<() => void>();
const NONE: CanvasFocus = {};

export function setCanvasFocus(agentId: string, where: CanvasFocus) {
  const was = focus.get(agentId);
  if (was && was.step === where.step && was.ask === where.ask && was.pull?.url === where.pull?.url && was.pull?.worker === where.pull?.worker) return;
  focus.set(agentId, where);
  for (const listener of listeners) listener();
}

export function canvasFocus(agentId: string): CanvasFocus {
  return focus.get(agentId) ?? NONE;
}

export function useCanvasFocus(agentId: string): CanvasFocus {
  return useSyncExternalStore((listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }, () => canvasFocus(agentId));
}
