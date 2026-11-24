// Phonon off the page thread. The lab starts this worker. Sketches, tries
// and the front-page demo use the shared voice engine, which loads the same
// runtime. Inference, tokenization and alignment stay here. Audio and word
// timings are posted as they are made; the buffers are transferred.
import { wav } from "./backend";
import { attentionWordTimes, FRAME_SEC, heuristicWordTimes, wordTimesFromPath, type TimedWord } from "./phonon/align";
import { loadPhonon, type PhononEngine, type PhononSentence } from "./phonon/runtime";

type Inbound =
  | { type: "load" }
  | { type: "speak"; id: number; text: string; voice: string; durationDelta?: number; method: "attention" | "heuristic"; layer: number; head: number };

let engine: PhononEngine | undefined;

const scope = self as unknown as {
  postMessage(message: object, transfer?: Transferable[]): void;
  onmessage: ((event: MessageEvent<Inbound>) => void) | null;
};
const post = (message: object, transfer: Transferable[] = []) => scope.postMessage(message, transfer);

scope.onmessage = (event: MessageEvent<Inbound>) => {
  const message = event.data;
  if (message.type === "load") void load();
  else if (message.type === "speak") void speak(message);
};

async function load() {
  try {
    engine = await loadPhonon((fraction, label) => post({ type: "progress", fraction, label }), { debug: true });
    post({ type: "ready", device: engine.device, deviceReason: engine.deviceReason, threads: engine.threads });
  } catch (error) {
    post({ type: "error", message: error instanceof Error ? error.message : String(error) });
  }
}

async function speak(message: Extract<Inbound, { type: "speak" }>) {
  if (!engine) {
    post({ type: "error", id: message.id, message: "The voice is not loaded." });
    return;
  }
  let chunks = 0;
  let origin = 0;
  let search = 0;
  let spoken: TimedWord[] = [];
  // One sentence's new attention rows, appended. Word times for a chunk in
  // progress walk the path so far; the full alignment runs once, when the
  // sentence ends.
  let rows: number[][] = [];
  let path: number[] = [];
  let token = 0;
  let heard: Float32Array = new Float32Array(0);
  let heardCount = 0;
  try {
    const speech = await engine.speak(message.text, {
      voice: message.voice,
      align: { layer: message.layer, head: message.head },
      ...(message.durationDelta !== undefined ? { durationDelta: message.durationDelta } : {}),
      onChunk: (chunk) => {
        if (message.method === "heuristic") {
          heard = appendSamples(heard, heardCount, chunk.samples);
          heardCount += chunk.samples.length;
        } else {
          for (const row of chunk.weights) {
            token = stepPath(row, token);
            path.push(token);
            rows.push(row);
          }
        }
        const at = message.text.indexOf(chunk.text, search);
        const base = at < 0 ? search : at;
        const local = message.method === "heuristic"
          ? chunk.done ? heuristicWordTimes([{ text: chunk.text, samples: heard.subarray(0, heardCount) }], 24000) : []
          : chunk.done
            ? attentionWordTimes([{ text: chunk.text, tokens: chunk.tokens, weights: rows, samples: chunk.sampleCount }], 24000, FRAME_SEC)
            : wordTimesFromPath(chunk.tokens, path, chunk.text, FRAME_SEC);
        const placed = local.map((word) => ({ ...word, start: word.start + base, end: word.end + base, from: word.from + origin, to: word.to + origin }));
        const words = spoken.concat(placed);
        const pcm = chunk.samples.slice();
        chunks += 1;
        post({ type: "chunk", id: message.id, words, chunks, pcm: pcm.buffer }, [pcm.buffer]);
        if (chunk.done) {
          spoken = words;
          origin += chunk.sampleCount / 24000;
          search = base + chunk.text.length;
          rows = [];
          path = [];
          token = 0;
          heard = new Float32Array(0);
          heardCount = 0;
        }
      },
      onSentence: (sentence) => {
        const pcm = sentence.samples.slice();
        const attention = sentence.attention.slice();
        post({
          type: "sentence",
          id: message.id,
          text: sentence.text,
          tokens: sentence.tokens,
          frames: sentence.frames,
          tokenCount: sentence.tokens.length,
          sampleRate: 24000,
          words: wordsFor(sentence, message),
          pcm: pcm.buffer,
          attention: attention.buffer,
        }, [pcm.buffer, attention.buffer]);
      },
    });
    const clip = wav(joinSamples(speech.sentences.map((sentence) => sentence.samples)), 24000);
    post({
      type: "done",
      id: message.id,
      tookMs: speech.tookMs,
      firstAudioMs: speech.firstAudioMs,
      device: speech.device,
      deviceReason: speech.deviceReason,
      threads: speech.device === "wasm" ? engine.threads : 1,
      wav: clip,
    }, [clip]);
  } catch (error) {
    post({ type: "error", id: message.id, message: error instanceof Error ? error.message : String(error) });
  }
}

function joinSamples(chunks: Float32Array[]): Float32Array {
  const out = new Float32Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
}

function appendSamples(buffer: Float32Array, count: number, extra: Float32Array): Float32Array {
  if (count + extra.length > buffer.length) {
    const next = new Float32Array(Math.max(buffer.length * 2, count + extra.length));
    next.set(buffer.subarray(0, count));
    buffer = next;
  }
  buffer.set(extra, count);
  return buffer;
}

// The next frame stays on this token or steps one ahead. The full path is
// aligned once, when the sentence is finished.
function stepPath(row: number[], token: number): number {
  const ahead = Math.min(Math.max(0, row.length - 1), token + 1);
  if (ahead !== token && (row[ahead] ?? 0) > (row[token] ?? 0)) return ahead;
  return Math.min(token, Math.max(0, row.length - 1));
}

function wordsFor(sentence: PhononSentence, message: Extract<Inbound, { type: "speak" }>): TimedWord[] {
  if (message.method === "heuristic") return heuristicWordTimes([{ text: sentence.text, samples: sentence.samples }], 24000);
  return attentionWordTimes([{ text: sentence.text, tokens: sentence.tokens, weights: sentence.weights(message.layer, message.head), samples: sentence.samples.length }], 24000, FRAME_SEC);
}
