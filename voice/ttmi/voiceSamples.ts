// One short clip per voice, made once, offline, with the board's own engine
// (`pnpm voice:samples`), so a voice can be heard before the model is
// installed (docs/plan-welcome.md). The Welcome page's Voice step and the
// Voice page play them.
import { paceStep } from "./pace";
import { VARIANT, VOICES, type Step } from "./protocol";

export const SAMPLE_TEXT = "This is how your walkthroughs will sound, one step at a time.";

export type SampleClip = { voice: string; file: string; seconds: number };
export type SamplesManifest = { key: string; clips: SampleClip[] };

// Said the way the Voice page says a sentence, at the default speed.
export function sampleStep(): Step {
  return { ...paceStep([{ text: SAMPLE_TEXT }], { fresh: new Map(), load: 1, first: false }, 1), leadIn: 0 };
}

// Names the model, every voice and every word and pause of the sample: a
// change to any of them makes the clips stale.
export async function samplesKey(step = sampleStep()): Promise<string> {
  const data = new TextEncoder().encode(`${VARIANT}|${VOICES.map((voice) => voice.id).join(",")}|${JSON.stringify(step)}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
