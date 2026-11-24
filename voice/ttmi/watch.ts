// Deadlines for a model run that never comes back. A WebGPU session create
// or a run can hang with no error (two creates at once did, and a lost
// device can). The timer rejects so the CPU fallback, or the step's failed
// message, still fires. A synchronous CPU run cannot be interrupted; the
// timer fires only once that call has returned or never started.
import { OrtRunError } from "./phonon/support";

export const RUN_TIMEOUT_MS = 10_000;
export const CREATE_TIMEOUT_MS = 60_000;

export function withTimeout<T>(work: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new OrtRunError(`${label} timed out after ${Math.round(ms / 1000)} s.`)), ms);
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

// How long one step may take: three times the machine's pace, and at least
// ten seconds. `override` is the test build's short deadline.
export function jobBudget(chars: number, charsPerSecond: number | undefined, override?: number) {
  if (override !== undefined) return override;
  const speed = Math.max(charsPerSecond ?? 8, 1);
  return Math.max(RUN_TIMEOUT_MS, (chars / speed) * 3_000);
}
