// The lab's handle on the Phonon worker. The page only receives audio and
// timings. The sessions, the tokenizer and the alignment stay in the worker.
import type { TimedWord } from "./phonon/align";

export type LabSentence = {
  text: string;
  tokens: string[];
  samples: Float32Array;
  frames: number;
  attention: Float32Array;
  words: TimedWord[];
  weights(layer: number, head: number): number[][];
};

export type LabSpeech = {
  sentences: LabSentence[];
  sampleRate: number;
  device: "webgpu" | "wasm";
  deviceReason: string;
  firstAudioMs: number;
  tookMs: number;
  threads: number;
  wav: ArrayBuffer;
};

export type PhononStream = { chunks: number; words: TimedWord[] };

type Ready = { type: "ready"; device: "webgpu" | "wasm"; deviceReason: string; threads: number };
type Progress = { type: "progress"; fraction: number; label: string };
type Chunk = { type: "chunk"; id: number; words: TimedWord[]; chunks: number; pcm: ArrayBuffer };
type Sentence = {
  type: "sentence";
  id: number;
  text: string;
  tokens: string[];
  frames: number;
  tokenCount: number;
  sampleRate: number;
  words: TimedWord[];
  pcm: ArrayBuffer;
  attention: ArrayBuffer;
};
type Done = { type: "done"; id: number; tookMs: number; firstAudioMs: number; device: "webgpu" | "wasm"; deviceReason: string; threads: number; wav: ArrayBuffer };
type Failed = { type: "error"; id?: number; message: string };
type FromWorker = Ready | Progress | Chunk | Sentence | Done | Failed;

const HEADS = 8;

export type PhononThread = {
  load(onProgress: (fraction: number, label: string) => void): Promise<Ready>;
  speak(request: { text: string; voice: string; method: "attention" | "heuristic"; layer: number; head: number }, onChunk: (update: PhononStream) => void): Promise<LabSpeech>;
  close(): void;
};

export function openPhononThread(): PhononThread {
  const worker = new Worker(new URL("./phonon.worker.ts", import.meta.url), { type: "module", name: "ttmi-phonon" });
  let id = 0;
  const waiters = new Map<number, { sentences: LabSentence[]; onChunk: (update: PhononStream) => void; resolve: (speech: LabSpeech) => void; reject: (error: Error) => void }>();
  let ready: ((message: Ready) => void) | undefined;
  let failLoad: ((error: Error) => void) | undefined;
  let onProgress: ((fraction: number, label: string) => void) | undefined;

  worker.onmessage = (event: MessageEvent<FromWorker>) => {
    const message = event.data;
    if (message.type === "progress") return onProgress?.(message.fraction, message.label);
    if (message.type === "ready") return ready?.(message);
    if (message.type === "error" && message.id === undefined) return failLoad?.(new Error(message.message));
    if (message.type === "error" && message.id !== undefined) return waiters.get(message.id)?.reject(new Error(message.message));
    if (message.type === "chunk") {
      const waiter = waiters.get(message.id);
      if (!waiter) return;
      // Touch the transferred view so the buffer is really on this thread,
      // then drop it. Playback uses the finished sentence.
      void new Float32Array(message.pcm);
      waiter.onChunk({ chunks: message.chunks, words: message.words });
      return;
    }
    if (message.type === "sentence") {
      const waiter = waiters.get(message.id);
      if (!waiter) return;
      const attention = new Float32Array(message.attention);
      const samples = new Float32Array(message.pcm);
      const sentence: LabSentence = {
        text: message.text,
        tokens: message.tokens,
        samples,
        frames: message.frames,
        attention,
        words: message.words,
        weights: (_layer, head) => unpack(attention, message.frames, message.tokenCount, head),
      };
      waiter.sentences.push(sentence);
    } else if (message.type === "done") {
      const waiter = waiters.get(message.id);
      if (!waiter) return;
      waiters.delete(message.id);
      waiter.resolve({
        sentences: waiter.sentences,
        sampleRate: 24000,
        device: message.device,
        deviceReason: message.deviceReason,
        firstAudioMs: message.firstAudioMs,
        tookMs: message.tookMs,
        threads: message.threads,
        wav: message.wav,
      });
    }
  };

  return {
    load(progress) {
      onProgress = progress;
      return new Promise((resolve, reject) => {
        ready = resolve;
        failLoad = reject;
        worker.postMessage({ type: "load" });
      });
    },
    speak(request, onChunk) {
      const speakId = ++id;
      return new Promise((resolve, reject) => {
        waiters.set(speakId, { sentences: [], onChunk, resolve, reject });
        worker.postMessage({ type: "speak", id: speakId, ...request });
      });
    },
    close() {
      worker.terminate();
    },
  };
}

function unpack(packed: Float32Array, frames: number, tokens: number, head: number): number[][] {
  const stride = HEADS * tokens;
  const rows: number[][] = [];
  for (let frame = 0; frame < frames; frame++) {
    const from = frame * stride + head * tokens;
    rows.push(Array.from(packed.subarray(from, from + tokens)));
  }
  return rows;
}
