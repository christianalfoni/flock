// Kokoro in the lab page itself, not the shared engine: the lab calls the
// model with its own speed and style (a blend of two voices), which the
// engine's protocol does not carry. Same model as the engine, so its files
// come from the same cache. One call per step, as on the board.
import { wordsOf, type TimedWord } from "./phonon/align";
import { wav } from "./backend";
import { joinPieces } from "./cues";
import { cutBefore, holdAt, leadIn, trimTail } from "./audio";
import { loadMisaki } from "./misaki";
import { speakable } from "./speakable";
import { emphasize, type Compiled } from "./lab";
import { voiceSpec } from "./protocol";
import { styleFor, voiceStyles } from "./styles";

const MODEL = "onnx-community/Kokoro-82M-v1.0-ONNX-timestamped";
const RATE = 24000;

type Tensor = { dims: number[]; data: ArrayLike<number> };
type TensorClass = new (type: string, data: ArrayLike<number> | number[], dims: number[]) => Tensor;
type Tts = {
  model(inputs: Record<string, unknown>): Promise<{ waveform: Tensor; durations?: Tensor }>;
  tokenizer(text: string, options: { truncation: boolean }): { input_ids: Tensor };
};

let loading: Promise<{ tts: Tts; phonemize: typeof import("./phonemize").phonemize }> | undefined;

export function loadLab(progress: (fraction: number) => void) {
  return (loading ??= (async () => {
    const [{ KokoroTTS }, { phonemize }] = await Promise.all([import("kokoro-js"), import("./phonemize")]);
    const tts = (await KokoroTTS.from_pretrained(MODEL, {
      dtype: "fp32",
      device: "webgpu",
      progress_callback: (event: { status: string; file?: string; loaded?: number; total?: number }) => {
        if (event.status === "progress" && event.file?.endsWith("model.onnx") && event.total) progress((event.loaded ?? 0) / event.total);
      },
    })) as unknown as Tts;
    return { tts, phonemize };
  })().catch((error) => {
    loading = undefined;
    throw error;
  }));
}

export type Voice = { a: string; b?: string; mix: number };
// A silence Kokoro made inside a clip.
export type Pause = { at: number; seconds: number };
export type Made = { url: string; seconds: number; took: number; phonemes: string; pauses: Pause[]; held: number; wordsPerMinute: number; tokens: number };

// The research's experiments (docs/research-browser-tts.md): which
// phonemizer, which of the voice's style rows (the one for the input's
// length, or a fixed one), words said before the step only as context and
// cut off, and text cleaned up for speaking.
export type Engine = { g2p: "espeak" | "misaki"; styleRow: number | "auto"; context: boolean; speakable: boolean };
export const TODAY_ENGINE: Engine = { g2p: "espeak", styleRow: "auto", context: false, speakable: false };

export async function synthesize(step: Compiled, voice: Voice, engine: Engine = TODAY_ENGINE, before = ""): Promise<Made> {
  const started = performance.now();
  const { tts, phonemize } = await loadLab(() => {});
  const language = voice.a.startsWith("b") ? "b" : "a";
  const styles = await voiceStyles(voiceSpec(voice.a, voice.b, voice.mix));
  // misaki is American English only; a British voice keeps eSpeak.
  const misaki = engine.g2p === "misaki" && language === "a" ? await loadMisaki() : undefined;
  const say = async (text: string) => {
    const words = engine.speakable ? speakable(text) : text;
    return misaki ? misaki(words) : phonemize(words, language);
  };

  const said = await Promise.all(step.pieces.map(async (piece) => {
    if (!piece.text.trim()) return "";
    const out = await say(piece.text);
    return piece.emphasis ? out.split(" ").map(emphasize).join(" ") : out;
  }));
  const joined = joinPieces(step.pieces, said);
  // The context: the words before the step, said first and cut off.
  const prefix = engine.context && before.trim() ? `${await say(before)} ` : "";
  const input = prefix + joined.input;
  const starts = joined.starts.map((start) => start + prefix.length);
  const ids = tts.tokenizer(input, { truncation: true }).input_ids;
  const Tensor = ids.constructor as TensorClass;
  const count = ids.dims.at(-1)! - 2;
  const { waveform, durations } = await tts.model({
    input_ids: ids,
    style: new Tensor("float32", styleFor(styles, engine.styleRow === "auto" ? count : engine.styleRow), [1, 256]),
    speed: new Tensor("float32", [step.speed], [1]),
  });
  const tokens = (text: string) => Math.max(0, tts.tokenizer(text, { truncation: true }).input_ids.dims.at(-1)! - 2);
  const holds = step.pieces.flatMap((piece, index) => (piece.hold ? [{ token: tokens(input.slice(0, starts[index])), seconds: piece.hold }] : []));
  const made = Float32Array.from(waveform.data);
  const held = durations ? holdAt(made, RATE, durations.data, holds) : made;
  // Holds come after the context, so the cut point is where it was.
  const speech = durations && prefix ? cutBefore(held, RATE, durations.data, tokens(prefix)) : held;
  const audio = leadIn(speech, RATE, step.leadIn);
  const seconds = speech.length / RATE;
  const words = (step.text.match(/[\p{L}\p{N}]+/gu) ?? []).length;
  return {
    url: URL.createObjectURL(new Blob([wav(audio, RATE)], { type: "audio/wav" })),
    seconds: audio.length / RATE,
    took: (performance.now() - started) / 1000,
    phonemes: joined.input,
    pauses: silences(speech),
    held: holds.reduce((sum, entry) => sum + entry.seconds, 0),
    wordsPerMinute: Math.round(words / (seconds / 60)),
    tokens: count - (prefix ? tokens(prefix) : 0),
  };
}

// The silences inside the clip, in order: stretches of 10 ms windows all
// well below the clip's peak, 60 ms or longer. Kokoro's timings put a
// pause's silence on the sounds around it as much as on the mark, so the
// waveform is what says how long a pause is.
function silences(samples: Float32Array): Pause[] {
  const window = RATE / 100;
  let peak = 0;
  for (const sample of samples) peak = Math.max(peak, Math.abs(sample));
  const quiet: boolean[] = [];
  for (let at = 0; at < samples.length; at += window) {
    let loud = 0;
    for (let index = at; index < Math.min(at + window, samples.length); index++) loud = Math.max(loud, Math.abs(samples[index]!));
    quiet.push(loud < peak * 0.01);
  }
  const first = quiet.indexOf(false);
  const last = quiet.lastIndexOf(false);
  const out: Pause[] = [];
  let run = 0;
  for (let index = first; index <= last; index++) {
    if (quiet[index]) run++;
    else {
      if (run >= 6) out.push({ at: (index - run - first) / 100, seconds: run / 100 });
      run = 0;
    }
  }
  return out;
}

// Kokoro's duration head, one time per word. The lab compares this with
// Phonon's attention. The voice id is a Kokoro voice, not a Phonon one.
export async function synthesizeWords(text: string, voiceId: string): Promise<{ url: string; seconds: number; words: TimedWord[]; took: number }> {
  const started = performance.now();
  const { tts, phonemize } = await loadLab(() => {});
  const language = voiceId.startsWith("b") ? "b" : "a";
  const words = wordsOf(text);
  const phones: string[] = [];
  for (const word of words) phones.push((await phonemize(word.text, language)).trim());
  let input = "";
  const starts: number[] = [];
  const count = (value: string) => Math.max(0, tts.tokenizer(value, { truncation: true }).input_ids.dims.at(-1)! - 2);
  for (const phone of phones) {
    if (input && phone) input += " ";
    starts.push(count(input));
    input += phone;
  }
  const ids = tts.tokenizer(input || ".", { truncation: true }).input_ids;
  const Tensor = ids.constructor as TensorClass;
  const styles = await voiceStyles(voiceId);
  const { waveform, durations } = await tts.model({
    input_ids: ids,
    style: new Tensor("float32", styleFor(styles, 150), [1, 256]),
    speed: new Tensor("float32", [1], [1]),
  });
  if (!durations) throw new Error("Kokoro did not return word durations.");
  const audio = Float32Array.from(waveform.data);
  const frames = Array.from(durations.data, Number);
  const total = frames.reduce((sum, value) => sum + value, 0) || 1;
  const seconds = audio.length / RATE;
  const at = (token: number) => {
    const end = Math.min(token + 1, frames.length);
    let sum = 0;
    for (let index = 0; index < end; index++) sum += frames[index] ?? 0;
    return (sum / total) * seconds;
  };
  const timed = words.map((word, index) => {
    const from = at(starts[index] ?? 0);
    const next = starts[index + 1];
    const to = next === undefined ? at(Math.max(0, frames.length - 2)) : at(next);
    return { ...word, from: Math.round(from * 1000) / 1000, to: Math.round(Math.max(from, to) * 1000) / 1000 };
  });
  return { url: URL.createObjectURL(new Blob([wav(audio, RATE)], { type: "audio/wav" })), seconds, words: timed, took: (performance.now() - started) / 1000 };
}

// Phonemes said as they are, with the board's voice and style row: the
// listening page for dictionary patches (/voice-patches) hears the same
// words with two readings this way.
export async function speakPhonemes(phonemes: string, voice = "af_heart"): Promise<string> {
  const { tts } = await loadLab(() => {});
  const styles = await voiceStyles(voice);
  const ids = tts.tokenizer(phonemes, { truncation: true }).input_ids;
  const Tensor = ids.constructor as TensorClass;
  const { waveform } = await tts.model({
    input_ids: ids,
    style: new Tensor("float32", styleFor(styles, 150), [1, 256]),
    speed: new Tensor("float32", [1], [1]),
  });
  const audio = trimTail(Float32Array.from(waveform.data), RATE);
  return URL.createObjectURL(new Blob([wav(audio, RATE)], { type: "audio/wav" }));
}
