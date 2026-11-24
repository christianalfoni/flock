// The voice: blixt/phonon on a real GPU, in this worker. The shared voice
// engine is a SharedWorker, and this runtime uses the GPU here. It does not
// start another worker. Pace stays at the model's own. The speed buttons
// and the Voice page factor change playback, not this call.
//
// Phonon.load defaults to "auto", which runs the WASM CPU tier when the
// browser gives no adapter. This asks for WebGPU and refuses anything else.
// Without a GPU the voice stays off and the walkthrough shows its words.
import { plainText } from "@ttmi/model";
import { Phonon } from "phonon-webgpu";
import type { Backend } from "./backend";
import { wav } from "./backend";
import { capCues } from "./cues";
import { realGpu, VOICE_GPU_REASON } from "./gpu";
import { cuesFromWords, placeBlixtTimings, spokenPlan, type TimedWord } from "./phonon/align";
import { PHONON_BACKEND } from "./phononGpu";

const RATE = 24000;
const CACHE = "phonon-webgpu";
const VOICES: Record<string, string> = {
  miles: "Miles",
  easton: "Easton",
  zoey: "Zoey",
  harper: "Harper",
  maeve: "Maeve",
  hugh: "Hugh",
};

export function blixtBackend(): Backend {
  let tts: Phonon | undefined;
  let label: string | undefined;
  return {
    async unsupported() {
      const gpu = await realGpu();
      return gpu.ok ? undefined : gpu.reason;
    },
    async installed() {
      if (typeof caches === "undefined") return false;
      try {
        const cache = await caches.open(CACHE);
        const keys = await cache.keys();
        return keys.some((key) => key.url.includes("int8.bin"));
      } catch {
        return false;
      }
    },
    async load(progress) {
      const gpu = await realGpu();
      if (!gpu.ok) throw new Error(gpu.reason);
      label = gpu.label;
      if (!tts) {
        const loaded = await Phonon.load({
          backend: PHONON_BACKEND,
          progress: (percent) => progress(Math.min(1, percent / 100)),
        });
        if (loaded.backend.name !== "webgpu") {
          await loaded.close();
          throw new Error(VOICE_GPU_REASON);
        }
        tts = loaded;
      }
      // Compile the shaders now, while the page still says "loading".
      // Nothing here is played. The first sentence the listener hears is
      // then the warm path.
      await tts.speak("Ready.", { voice: "Miles", speed: 1 });
    },
    device: () => (label ? "webgpu" : undefined),
    async synth(step, voice, onChunk, signal) {
      if (!tts) throw new Error(VOICE_GPU_REASON);
      const segments = step.segments.map((segment) => ({ ...segment, text: plainText(segment.text) }));
      const original = segments.map((segment) => segment.text).join("");
      const plan = spokenPlan(original);
      const name = VOICES[(voice.split("+")[0] ?? voice).toLowerCase()] ?? "Miles";
      const rendered: Float32Array[] = [];
      let pending: Float32Array | null = null;
      // onWord reports each word once its time can no longer change. The
      // chunk in hand is sent when the next one arrives, with every word
      // known by then; the last chunk carries the finished words.
      const heard: { text: string; start: number; end: number }[] = [];
      const emit = (words: TimedWord[]) => {
        if (!pending) return;
        rendered.push(pending);
        onChunk?.({ samples: pending, words });
        pending = null;
      };
      const speech = await tts.speak(plan.spoken, {
        voice: name,
        speed: 1,
        signal,
        onWord: (word) => {
          heard.push({ text: word.text, start: word.start, end: word.end });
        },
        onAudio: (samples) => {
          if (signal?.aborted) return;
          emit(placeBlixtTimings(original, heard));
          const copy = new Float32Array(samples.length);
          copy.set(samples);
          pending = copy;
        },
      });
      if (signal?.aborted) throw new DOMException("The voice was stopped.", "AbortError");
      const shown = placeBlixtTimings(original, speech.words);
      emit(shown);
      const samples = concatSamples(rendered);
      if (peak(samples) < 0.001) throw new Error("The voice made no sound.");
      const cues = capCues(cuesFromWords(segments, shown), samples.length / RATE);
      return { wav: wav(samples, RATE), seconds: samples.length / RATE, cues, tokens: speech.tokens.length };
    },
    async remove() {
      const closing = tts;
      tts = undefined;
      label = undefined;
      await closing?.close().catch(() => undefined);
      if (typeof caches !== "undefined") await caches.delete(CACHE).catch(() => undefined);
    },
  };
}

function concatSamples(chunks: Float32Array[]): Float32Array {
  const length = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const out = new Float32Array(length);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
}

function peak(samples: Float32Array): number {
  let loud = 0;
  for (const sample of samples) loud = Math.max(loud, Math.abs(sample));
  return loud;
}
