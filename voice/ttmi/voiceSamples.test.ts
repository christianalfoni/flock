// Every voice can be heard before the model is installed, from a clip made
// with the sample as it is now (docs/plan-welcome.md): a new voice, or a
// change to the sample, the pacing or the engine's variant, fails here until
// `pnpm voice:samples` makes them again.
import { existsSync } from "node:fs";
import { describe, expect, test } from "vitest";
import manifest from "./voiceSamples.json";
import { VOICES } from "./protocol";
import { samplesKey, type SamplesManifest } from "./voiceSamples";

const samples = manifest as SamplesManifest;

describe("the voices' samples", () => {
  test("the clips were made from this sample: run pnpm voice:samples if not", async () => {
    expect(samples.key).toBe(await samplesKey());
  });

  test("every voice has its clip", () => {
    expect(samples.clips.map((clip) => clip.voice)).toEqual(VOICES.map((voice) => voice.id));
    for (const clip of samples.clips) {
      expect(existsSync(new URL(`./clips/${clip.file}`, import.meta.url))).toBe(true);
      expect(clip.seconds).toBeGreaterThan(1);
    }
  });
});
