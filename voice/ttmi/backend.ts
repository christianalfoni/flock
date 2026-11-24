// What makes the speech inside the engine: Phonon, or the test build's fake.
import type { Cue } from "./cues";
import type { Step } from "./pace";

// signature: the function's, on a hosted voice's clip, so it can be handed
// back to be stored for a shared sketch (docs/plan-stored-voice.md).
export type Synthesized = { wav: ArrayBuffer; seconds: number; cues: Cue[]; tokens?: number; truncated?: boolean; signature?: string };

// A piece of a clip, posted while it is still being made. `samples` is a
// copy the caller may transfer; `words` are the timings for the audio so far.
export type SynthChunk = { samples: Float32Array; words: { text: string; start: number; end: number; from: number; to: number }[] };

export type Backend = {
  // Undefined when this browser can run it, otherwise why not.
  unsupported(): Promise<string | undefined>;
  installed(): Promise<boolean>;
  // Downloads what is missing, then loads it; progress is 0..1.
  load(progress: (fraction: number) => void): Promise<void>;
  // One clip for the whole step, said as the step says, and when each of
  // its references is said; how many tokens the step is, and whether it
  // was over the model's limit, so its end was cut off.
  synth(step: Step, voice: string, onChunk?: (chunk: SynthChunk) => void, signal?: AbortSignal): Promise<Synthesized>;
  remove(): Promise<void>;
  // Where generation ended up, once load has finished.
  device?(): "webgpu" | "wasm" | undefined;
};

// A 16-bit mono WAV of the given samples.
export function wav(samples: Float32Array, rate: number): ArrayBuffer {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const text = (offset: number, value: string) => [...value].forEach((char, index) => view.setUint8(offset + index, char.charCodeAt(0)));
  text(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  text(8, "WAVE");
  text(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, "data");
  view.setUint32(40, samples.length * 2, true);
  samples.forEach((sample, index) => view.setInt16(44 + index * 2, Math.max(-1, Math.min(1, sample)) * 0x7fff, true));
  return buffer;
}
