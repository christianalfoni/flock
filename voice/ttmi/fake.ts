// The test build's voice (docs/plan-voice.md, Tests first): installs with
// progress, makes silence as long as the narration would take, at a set
// speed, with cues in proportion to characters. The queue, the clip cache
// and the shared worker are the real ones.
import type { Backend } from "./backend";
import { wav } from "./backend";
import { cuesByLength, heldCues } from "./cues";
import type { FakeOptions } from "./protocol";

const MARKER = "https://voice.ttmi.invalid/fake-model";
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function fakeBackend(options: FakeOptions): Backend {
  const { gpu = true, msPerChar = 2, installMs = 300, checkMs = 0, maxChars, fullLength = false } = options;
  let loaded = false;
  return {
    async unsupported() {
      if (checkMs) await wait(checkMs);
      return gpu ? undefined : "This browser gives no GPU to background workers.";
    },
    async installed() {
      return Boolean(await (await caches.open("ttmi-voice-fake")).match(MARKER));
    },
    async load(progress) {
      if (!(await this.installed())) {
        for (let step = 1; step <= 4; step++) {
          await wait(installMs / 4);
          progress(step / 4);
        }
        await (await caches.open("ttmi-voice-fake")).put(MARKER, new Response("model"));
      }
      await wait(50);
      loaded = true;
    },
    async synth({ segments, leadIn = 0 }) {
      if (options.hang) return new Promise<never>(() => {});
      if (!loaded) throw new Error("The voice is not loaded.");
      const text = segments.map((segment) => segment.text).join("");
      if (options.holdText && text.includes(options.holdText)) await wait(options.holdMs ?? 20_000);
      await wait(text.length * msPerChar);
      // A tenth of the time the words take to say (about 15 characters a
      // second), so a test hears a whole walkthrough in seconds; the
      // silences a step asks for, a tenth as long too. Full length when a
      // test needs a clip that takes a while.
      const scale = fullLength ? 1 : 10;
      const said = Math.max(0.2, text.length / 15 / scale);
      const silence = (leadIn + segments.reduce((sum, segment) => sum + (segment.hold ?? 0), 0)) / scale;
      const seconds = said + silence;
      const tenth = segments.map((segment) => (segment.hold ? { ...segment, hold: segment.hold / scale } : segment));
      // A character for a token.
      return { wav: wav(new Float32Array(Math.round(seconds * 8000)), 8000), seconds, cues: heldCues(cuesByLength(segments, said), tenth, leadIn / scale), tokens: text.length, truncated: maxChars !== undefined && text.length > maxChars };
    },
    async remove() {
      loaded = false;
      await caches.delete("ttmi-voice-fake");
    },
  };
}
