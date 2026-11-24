// What to ask ElevenLabs for, and in what order (docs/plan-cloud-voice.md).
// Playback waits only for the step on screen. The next steps follow, then
// the first step of each nested canvas, then anything already passed.
// Two at a time, matching the function's own cap, so the step on screen
// and the next one can be made together.

export const HOSTED_CONCURRENCY = 2;
const BACKOFF_TRIES = 5;

// How long to wait after a 429, growing and a little uneven so retries
// don't all land together. Five tries cover about half a minute.
export function backoffDelay(attempt: number, random = Math.random()): number {
  const base = Math.min(8_000, 200 * 2 ** Math.max(0, attempt));
  return Math.round(base + random * base * 0.25);
}

// Rank of each step of the sketch on screen. Lower runs first. The step
// in focus is 0, the ones after it are 1, 2, …, and the ones already
// passed come after those.
export function hostedRanks(count: number, focus: number): number[] {
  const at = Math.min(Math.max(0, focus), Math.max(0, count - 1));
  return Array.from({ length: count }, (_, index) => {
    if (index === at) return 0;
    if (index > at) return index - at;
    return count + index;
  });
}

// The first step of a nested canvas, after this sketch's own steps.
// Later steps of that canvas sit behind every nested first step.
export function nestedRank(parentSteps: number, child: number, childSteps: number, step: number): number {
  if (step <= 0) return parentSteps + 1 + child;
  return parentSteps + childSteps + child * 32 + step;
}

// The hosted queue: at most `limit` generations at once, lowest rank
// first, a 429 waited out before that clip is asked again.
export class HostedQueue {
  private rank = new Map<string, number>();
  private tries = new Map<string, number>();
  private notBefore = new Map<string, number>();
  private waiting = new Set<string>();
  readonly running = new Set<string>();

  constructor(private readonly limit = HOSTED_CONCURRENCY, private readonly now = () => Date.now()) {}

  upsert(key: string, rank: number) {
    this.rank.set(key, rank);
    if (!this.running.has(key)) this.waiting.add(key);
  }

  // The clips to start now. Never more than `limit` are running.
  take(): string[] {
    const at = this.now();
    const ready = [...this.waiting].filter((key) => (this.notBefore.get(key) ?? 0) <= at).sort((a, b) => (this.rank.get(a) ?? 0) - (this.rank.get(b) ?? 0) || a.localeCompare(b));
    const out: string[] = [];
    while (this.running.size < this.limit && ready.length) {
      const key = ready.shift()!;
      this.waiting.delete(key);
      this.running.add(key);
      out.push(key);
    }
    return out;
  }

  done(key: string) {
    this.running.delete(key);
    this.waiting.delete(key);
    this.rank.delete(key);
    this.tries.delete(key);
    this.notBefore.delete(key);
  }

  // Put a refused clip back, later. Undefined when it has been refused
  // too many times and should be given up.
  backoff(key: string, random = Math.random()): number | undefined {
    const attempt = this.tries.get(key) ?? 0;
    this.running.delete(key);
    if (attempt >= BACKOFF_TRIES) {
      this.waiting.delete(key);
      return undefined;
    }
    const delay = backoffDelay(attempt, random);
    this.tries.set(key, attempt + 1);
    this.notBefore.set(key, this.now() + delay);
    this.waiting.add(key);
    return delay;
  }
}
