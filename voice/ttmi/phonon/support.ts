// Whether this browser can run the voice at all. WebGPU is optional: the
// model also runs on the CPU through WebAssembly SIMD.

// A failure the page can tell apart. A download or an offline tab is
// "network" and is tried again next visit. The CPU runtime failing is
// "cpu-runtime" and is remembered for a few days. Anything else (a step
// that made silence, a cancelled step) is neither.
export type FailureKind = "network" | "cpu-runtime";

export class VoiceFailure extends Error {
  readonly kind: FailureKind;
  constructor(message: string, kind: FailureKind) {
    super(message);
    this.name = "VoiceFailure";
    this.kind = kind;
  }
}

// Thrown when a model run or a session create fails or times out. WebGPU
// falls back to the CPU only on this, not on a download or a programming error.
export class OrtRunError extends VoiceFailure {
  constructor(message: string) {
    super(message, "cpu-runtime");
    this.name = "OrtRunError";
  }
}

export function failureKind(error: unknown): FailureKind | undefined {
  return error instanceof VoiceFailure ? error.kind : undefined;
}

export function shouldUseCpu(device: "webgpu" | "wasm", retried: boolean, error: unknown) {
  return device === "webgpu" && !retried && error instanceof OrtRunError;
}

// The page left the step, or the tab closed. Not a failure of the voice.
export class Cancelled extends Error {
  constructor() {
    super("The voice was cancelled.");
    this.name = "Cancelled";
  }
}

export const cancelled = (error: unknown) => error instanceof Cancelled;

// onnxruntime-web sometimes rejects with a bare wasm pointer (a number, or
// an Error whose message is that number) instead of a sentence. The lab and
// the voice chip should show a sentence.
export function describeOrtError(error: unknown, device: "webgpu" | "wasm"): string {
  const raw = typeof error === "number" ? String(error) : error instanceof Error ? error.message : String(error);
  if (/^\d+$/.test(raw.trim())) return `onnxruntime error ${raw.trim()} on ${device}`;
  return raw.trim() || `onnxruntime error on ${device}`;
}

export function wasmSimd(): boolean {
  try {
    return WebAssembly.validate(Uint8Array.from([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11]));
  } catch {
    return false;
  }
}
