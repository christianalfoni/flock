// Kokoro 82M on WebGPU, inside the engine (docs/plan-voice.md). Its files
// land in Cache Storage where Transformers.js keeps them
// ("transformers-cache", and kokoro-js's "kokoro-voices"). The timestamped
// build of the model also says how long it makes every phoneme last, which
// times a step's references (docs/plan-voice-cues.md).
import type { Backend } from "./backend";
import { wav } from "./backend";
import { cutAt, holdAt, leadIn, quietNear, tokenSample, trimTail } from "./audio";
import { capCues, cueTimes, heldCues, joinPieces } from "./cues";
import { phonemePieces } from "@ttmi/model";
import { readVoice } from "./protocol";
import { G2P_CACHE, loadMisaki } from "./misaki";
import { speakable } from "./speakable";
import { styleFor, voiceStyles } from "./styles";

const MODEL = "onnx-community/Kokoro-82M-v1.0-ONNX-timestamped";
const MODEL_FILE = "/onnx/model.onnx";
// The model before references; its files are cleared once this one loads.
const OLD_MODEL = "Kokoro-82M-v1.0-ONNX/";

// Safari has no async iteration over ReadableStream, which the phonemizer
// uses to unpack espeak's data while it starts; without it every generate()
// waits forever. Patched in before kokoro-js is imported.
function patchStreams() {
  const proto = ReadableStream.prototype as ReadableStream & { [Symbol.asyncIterator]?: unknown };
  if (proto[Symbol.asyncIterator]) return;
  proto[Symbol.asyncIterator] = async function* (this: ReadableStream) {
    const reader = this.getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) return;
        yield value;
      }
    } finally {
      reader.releaseLock();
    }
  };
}

type Tensor = { dims: number[]; data: ArrayLike<number> };
type TensorClass = new (type: string, data: ArrayLike<number> | number[], dims: number[]) => Tensor;
type Model = (inputs: Record<string, unknown>) => Promise<{ waveform: Tensor; durations?: Tensor }>;
type Tts = {
  model: Model;
  tokenizer(text: string, options: { truncation: boolean }): { input_ids: Tensor };
};
const RATE = 24000;
// The voice's style row for every step, whatever its length: inside the
// 100 to 200 tokens Kokoro does best at (docs/plan-voice-context.md).
const STYLE_ROW = 150;
// Kokoro reads at most 510 tokens; context that would push a step past
// this is left out. A step itself longer than that loses its end: the
// tokenizer truncates without a word, so synth says so.
const MAX_TOKENS = 500;
export const TOKEN_LIMIT = 510;
type Gpu = { requestAdapter(): Promise<unknown> };

export function kokoroBackend(): Backend {
  let tts: Tts | undefined;
  let phonemize: typeof import("./phonemize").phonemize | undefined;
  let misaki: Awaited<ReturnType<typeof loadMisaki>> | undefined;
  return {
    async unsupported() {
      const gpu = (navigator as Navigator & { gpu?: Gpu }).gpu;
      const adapter = await gpu?.requestAdapter().catch(() => null);
      return adapter ? undefined : "This browser gives no GPU to background workers.";
    },
    async installed() {
      const cache = await caches.open("transformers-cache");
      return (await cache.keys()).some((request) => request.url.includes("Kokoro-82M-v1.0-ONNX-timestamped") && request.url.endsWith(MODEL_FILE));
    },
    async load(progress) {
      patchStreams();
      // Imported only when the model loads, like kokoro-js: a browser
      // without voice never fetches either.
      const [{ KokoroTTS }, phonemes, g2p] = await Promise.all([import("kokoro-js"), import("./phonemize"), loadMisaki()]);
      phonemize = phonemes.phonemize;
      misaki = g2p;
      tts = (await KokoroTTS.from_pretrained(MODEL, {
        dtype: "fp32",
        device: "webgpu",
        progress_callback: (event: { status: string; file?: string; loaded?: number; total?: number }) => {
          if (event.status === "progress" && event.file?.endsWith("model.onnx") && event.total) progress((event.loaded ?? 0) / event.total);
        },
      })) as unknown as Tts;
      const cache = await caches.open("transformers-cache");
      for (const request of await cache.keys()) if (request.url.includes(OLD_MODEL)) await cache.delete(request);
    },
    async synth({ segments, speed = 1, leadIn: lead = 0, before }, voice) {
      if (!tts || !phonemize || !misaki) throw new Error("The voice is not loaded.");
      const english = phonemize;
      const american = misaki;
      // Text as a speaker says it, then misaki's phonemes, the ones Kokoro
      // was trained on; British voices keep eSpeak, misaki here is American
      // only (docs/plan-voice-context.md).
      const language = readVoice(voice).name.startsWith("b") ? "b" : "a";
      // A piece is tagged with the words around it, so "live" in "comments
      // are [live](#2)" is read as an adjective (docs/plan-voice-g2p.md).
      // A word with its phonemes is said with them by either
      // (docs/plan-voice-phonemes.md).
      const british = async (text: string) => {
        const pieces = phonemePieces(text);
        return joinPieces(pieces, await Promise.all(pieces.map((piece) => piece.phonemes ?? (piece.text.trim() ? english(piece.text, "b") : "")))).input;
      };
      const say = async (text: string, around: { before?: string; after?: string } = {}) =>
        language === "a" ? american(speakable(text), { before: around.before && speakable(around.before), after: around.after && speakable(around.after) }) : british(speakable(text));
      // Each piece on its own, so we know where each starts; one call for
      // the whole step, so it sounds like one. The model is called as
      // kokoro-js calls it, with the step's speed and the voice's styles,
      // blended when it names two (docs/plan-voice-pacing.md).
      const texts = segments.map((segment) => segment.text);
      const phonemes = await Promise.all(segments.map((segment, i) => (segment.text.trim() ? say(segment.text, { before: texts.slice(0, i).join(" "), after: texts.slice(i + 1).join(" ") }) : "")));
      const joined = joinPieces(segments, phonemes);
      const tokens = (text: string) => Math.max(0, tts!.tokenizer(text, { truncation: true }).input_ids.dims.at(-1)! - 2);
      const stepTokens = Math.max(0, tts.tokenizer(joined.input, { truncation: false }).input_ids.dims.at(-1)! - 2);
      // The words before the step, said first so it starts mid-explanation,
      // and cut off below; left out when they would not fit.
      let prefix = before?.trim() ? `${await say(before)} ` : "";
      if (prefix && tokens(prefix + joined.input) > MAX_TOKENS) prefix = "";
      const input = prefix + joined.input;
      const tokenStarts = joined.starts.map((start) => tokens(input.slice(0, start + prefix.length)));
      const ids = tts.tokenizer(input, { truncation: true }).input_ids;
      const Tensor = ids.constructor as TensorClass;
      const styles = await voiceStyles(voice);
      const { waveform, durations } = await tts.model({
        input_ids: ids,
        style: new Tensor("float32", styleFor(styles, STYLE_ROW), [1, 256]),
        speed: new Tensor("float32", [speed], [1]),
      });
      const audio = Float32Array.from(waveform.data);
      // A GPU backend that misbehaves makes silence or NaN, not an error.
      let peak = 0;
      for (const sample of audio) {
        if (Number.isNaN(sample)) throw new Error("The voice made no sound on this GPU.");
        peak = Math.max(peak, Math.abs(sample));
      }
      if (peak < 0.001) throw new Error("The voice made no sound on this GPU.");
      const timed = durations?.data;
      const cues = timed ? cueTimes({ segments, tokenStarts, durations: timed, samples: audio.length, rate: RATE }) : [];
      // The step's silences: the holds where it already paused; then the
      // context cut off at the quiet point before the step's first word,
      // and the lead-in; the cues moved by all three.
      const holds = segments.flatMap((segment, index) => (segment.hold ? [{ token: tokenStarts[index]!, seconds: segment.hold }] : []));
      const held = timed ? holdAt(audio, RATE, timed, holds) : audio;
      const cut = timed && prefix ? quietNear(audio, RATE, tokenSample(audio, timed, tokens(prefix))) : 0;
      // Then the trailing near-silence trimmed, and the cues kept inside.
      const out = trimTail(leadIn(cutAt(held, RATE, cut), RATE, lead), RATE);
      const moved = heldCues(cues, timed ? segments : segments.map(({ hold: _, ...segment }) => segment), lead - cut / RATE);
      const seconds = out.length / RATE;
      return { wav: wav(out, RATE), seconds, cues: capCues(moved, seconds), tokens: stepTokens, truncated: stepTokens > TOKEN_LIMIT };
    },
    async remove() {
      tts = undefined;
      const cache = await caches.open("transformers-cache");
      for (const request of await cache.keys()) if (request.url.includes("Kokoro-82M-v1.0-ONNX")) await cache.delete(request);
      await caches.delete("kokoro-voices");
      await caches.delete(G2P_CACHE);
    },
  };
}
