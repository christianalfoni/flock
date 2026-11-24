// Whether this browser is remembered as unable to run the voice. The old
// mark was the user agent alone (`ttmi.voice.unsupported`), so a WebGPU
// crash, or Kokoro finding no GPU, stuck for good. Phonon runs on the CPU
// in both of those cases. A mark is this engine, this browser, and only a
// few days old, and it is written only when the CPU path itself failed.
import type { EngineState } from "./protocol";

export const ENGINE = "phonon-ort-1.31";
export const MARK = "ttmi.voice.unsupported.v2";
export const OLD_MARK = "ttmi.voice.unsupported";
// Long enough that a broken browser is not retried every visit, short
// enough that a fix reaches people who were marked before it.
export const MARK_MS = 3 * 24 * 60 * 60 * 1000;

export type MarkStore = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

type Stored = { ua: string; engine: string; at: number };

function read(store: MarkStore): Stored | undefined {
  const raw = store.getItem(MARK);
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as Stored;
    if (!parsed || typeof parsed.ua !== "string" || typeof parsed.engine !== "string" || typeof parsed.at !== "number") return undefined;
    return parsed;
  } catch {
    return undefined;
  }
}

// True when this browser was marked for this engine and the mark is still fresh.
// An older mark, another engine, or another browser version is dropped.
export function unsupportedMark(store: MarkStore, ua: string, now = Date.now()): boolean {
  store.removeItem(OLD_MARK);
  const parsed = read(store);
  if (!parsed || parsed.engine !== ENGINE || parsed.ua !== ua || now - parsed.at > MARK_MS) {
    if (parsed || store.getItem(MARK)) store.removeItem(MARK);
    return false;
  }
  return true;
}

export function rememberUnsupported(store: MarkStore, ua: string, now = Date.now()) {
  store.removeItem(OLD_MARK);
  const value: Stored = { ua, engine: ENGINE, at: now };
  store.setItem(MARK, JSON.stringify(value));
}

export function forgetUnsupported(store: MarkStore) {
  store.removeItem(OLD_MARK);
  store.removeItem(MARK);
}

// A failure that happened while the CPU runtime was actually running.
// WebGPU falls back to the CPU; that is not this browser's for good. A
// download, an offline tab, a full disk or a clip that made silence is
// tried again next visit. A report that arrives while still checking (no
// SharedWorker, no SIMD) is too. The kind is set by the engine; the words
// of the message are not matched.
export function shouldRememberFailure(previous: EngineState, next: { state: EngineState; reason?: string; device?: "webgpu" | "wasm"; kind?: "network" | "cpu-runtime" }): boolean {
  if (next.state !== "unsupported" || previous === "checking" || previous === "unsupported") return false;
  if (next.device === "webgpu") return false;
  return next.kind === "cpu-runtime";
}
