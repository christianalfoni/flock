// Phonon behind the voice engine. One step is one clip: each sentence
// starts from the voice, pauses the sketch asked for are inserted, and
// each reference is timed from the attention of layer 3, head 0. The words
// before the step are not spoken. Feeding them in makes the model repeat.
import { plainText } from "@ttmi/model";
import { leadIn, openColdTrim, tightenCompoundGaps, trimColdOnset } from "./audio";
import { createStreamEdit } from "./streamEdit";
import type { Backend } from "./backend";
import { wav } from "./backend";
import { capCues, heldCues, type Segment } from "./cues";
import { ATTENTION_HEAD, ATTENTION_LAYER, attentionWordTimes, cuesFromWords, durationDelta, FRAME_SEC, segmentWords, wordTimesFromPath, type TimedWord } from "./phonon/align";
import { loadPhonon, phononInstalled, removePhonon, wasmSimd, type PhononEngine } from "./phonon/runtime";
import { PHONON_VOICE_FILES } from "./phonon/voices";
import { DEFAULT_VOICE } from "./protocol";

const RATE = 24000;

export function phononBackend(): Backend {
  let engine: PhononEngine | undefined;
  return {
    async unsupported() {
      if (!wasmSimd()) return "This browser cannot run the voice (no WebAssembly SIMD).";
      return undefined;
    },
    installed: phononInstalled,
    async load(progress) {
      engine = await loadPhonon((fraction) => progress(fraction));
    },
    device: () => engine?.device,
    async synth(step, voice, onChunk, signal) {
      if (!engine) throw new Error("The voice is not loaded.");
      const segments = step.segments.map((segment) => ({ ...segment, text: plainText(segment.text) }));
      const text = segments.map((segment) => segment.text).join("");
      let origin = 0;
      let search = 0;
      // New attention rows only. A chunk in progress walks the path so far;
      // the full alignment runs once, when the sentence ends.
      let rows: number[][] = [];
      let path: number[] = [];
      let token = 0;
      const edit = createStreamEdit(segments, step.leadIn ?? 0, RATE);
      // The decoder's cold opening is a tick and a gap. Hold the first
      // frames until that opening is known, then play from the voice.
      // Each sentence is generated from the voice again, so each one opens
      // cold: a tick and a gap. Trim that opening on every sentence, or the
      // join is a hole in the middle of the step.
      let trim = openColdTrim(RATE);
      let bucket: Float32Array[] = [];
      const speech = await engine.speak(text, {
        voice: knownVoice(voice),
        durationDelta: durationDelta(step.speed ?? 1),
        align: { layer: ATTENTION_LAYER, head: ATTENTION_HEAD },
        signal,
        onChunk: (chunk) => {
          const at = text.indexOf(chunk.text, search);
          const base = at < 0 ? search : at;
          for (const row of chunk.weights) {
            token = stepToken(row, token);
            path.push(token);
            rows.push(row);
          }
          if (chunk.samples.length && onChunk) {
            const played = trim.push(chunk.samples, chunk.done);
            const compound = /\p{L}-\p{L}/u.test(chunk.text);
            const skip = trim.skipped() / RATE;
            const local = (chunk.done
              ? attentionWordTimes([{ text: chunk.text, tokens: chunk.tokens, weights: rows, samples: chunk.sampleCount }], RATE, FRAME_SEC)
              : wordTimesFromPath(chunk.tokens, path, chunk.text, FRAME_SEC)
            ).map((word) => ({
              ...word,
              start: word.start + base,
              end: word.end + base,
              from: Math.max(0, word.from - skip),
              to: Math.max(0, word.to - skip),
            }));
            if (compound) {
              if (played.length) bucket.push(played);
              if (chunk.done) {
                const joined = concatSamples(bucket);
                bucket = [];
                const closed = tightenCompoundGaps(joined, RATE, local);
                if (closed.samples.length) {
                  const edited = edit.emit(closed.samples, closed.words.map((word) => ({ ...word, from: word.from + origin, to: word.to + origin })));
                  onChunk({ samples: edited.samples, words: edited.words });
                }
                origin += closed.samples.length / RATE;
              }
            } else if (played.length) {
              const edited = edit.emit(played, local.map((word) => ({ ...word, from: word.from + origin, to: word.to + origin })));
              onChunk({ samples: edited.samples, words: edited.words });
            }
          }
          if (chunk.done) {
            if (!/\p{L}-\p{L}/u.test(chunk.text)) origin += Math.max(0, chunk.sampleCount / RATE - trim.skipped() / RATE);
            trim = openColdTrim(RATE);
            bucket = [];
            search = base + chunk.text.length;
            rows = [];
            path = [];
            token = 0;
          }
        },
      });
      const opened = speech.sentences.map((sentence) => {
        const trimmed = trimColdOnset(sentence.samples, RATE);
        const skip = trimmed.skipped / RATE;
        const local = attentionWordTimes([{
          text: sentence.text,
          tokens: sentence.tokens,
          weights: sentence.weights(ATTENTION_LAYER, ATTENTION_HEAD),
          samples: sentence.samples.length,
        }], RATE, FRAME_SEC).map((word) => ({ ...word, from: Math.max(0, word.from - skip), to: Math.max(0, word.to - skip) }));
        const closed = tightenCompoundGaps(trimmed.samples, RATE, local);
        return { samples: closed.samples, words: closed.words };
      });
      const raw = concatSamples(opened.map((part) => part.samples));
      if (peak(raw) < 0.001) throw new Error("The voice made no sound.");
      let at = 0;
      const words: TimedWord[] = [];
      for (const part of opened) {
        for (const word of part.words) words.push({ ...word, from: word.from + at, to: word.to + at });
        at += part.samples.length / RATE;
      }
      const held = insertHolds(raw, segments, words);
      const samples = leadIn(held, RATE, step.leadIn ?? 0);
      const cues = capCues(heldCues(cuesFromWords(segments, words), segments, step.leadIn ?? 0), samples.length / RATE);
      const tokens = speech.sentences.reduce((sum, sentence) => sum + sentence.tokens.length, 0);
      return { wav: wav(samples, RATE), seconds: samples.length / RATE, cues, tokens };
    },
    async remove() {
      const current = engine;
      engine = undefined;
      await current?.dispose();
      await removePhonon();
    },
  };
}

// The next frame stays on this token or steps one ahead.
function stepToken(row: number[], token: number): number {
  const ahead = Math.min(Math.max(0, row.length - 1), token + 1);
  if (ahead !== token && (row[ahead] ?? 0) > (row[token] ?? 0)) return ahead;
  return Math.min(token, Math.max(0, row.length - 1));
}

function knownVoice(voice: string): string {
  const name = voice.split("+")[0] ?? voice;
  return name in PHONON_VOICE_FILES ? name : DEFAULT_VOICE;
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

// Silence before a piece, at the moment its first word was going to start.
function insertHolds(samples: Float32Array, segments: Segment[], words: TimedWord[]): Float32Array {
  const cuts: { at: number; length: number }[] = [];
  const groups = segmentWords(segments, words);
  segments.forEach((segment, index) => {
    const word = groups[index]?.[0];
    if (!segment.hold || !word) return;
    cuts.push({ at: Math.round(word.from * RATE), length: Math.round(segment.hold * RATE) });
  });
  if (!cuts.length) return samples;
  const ordered = cuts.sort((a, b) => a.at - b.at);
  const out = new Float32Array(samples.length + ordered.reduce((sum, cut) => sum + cut.length, 0));
  let from = 0;
  let to = 0;
  for (const cut of ordered) {
    const at = Math.max(from, Math.min(samples.length, cut.at));
    out.set(samples.subarray(from, at), to);
    to += at - from + cut.length;
    from = at;
  }
  out.set(samples.subarray(from), to);
  return out;
}
