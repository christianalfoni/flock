// Phonon 31m in the browser. The published phonon-tts package returns PCM
// and nothing else, so this runs the ONNX graphs instead: the flow LM's
// softmax is still in the graph, and a copy of that graph (flow_lm_q4_attn)
// names each layer's attention as an output. Weights stay on Hugging Face.
// WebGPU when the browser has it, and the WASM build otherwise.
import graphUrl from "./flow_lm_q4_attn.onnx?url";
import tokenizerJson from "./tokenizer.json";
import { ATTENTION_HEAD, ATTENTION_LAYER, durationDelta, mergeShortFinal, speakable, splitSentences } from "./align";
import { watchWebGpuDevice } from "./gpuDevice";
import { CHUNK_FRAMES, SPEAK_SEED, SPEAK_TEMPERATURE } from "./revision";
import { encode, type TokenizerModel } from "./tokenize";
import { Cancelled, describeOrtError, OrtRunError, shouldUseCpu, VoiceFailure } from "./support";
import { CREATE_TIMEOUT_MS, RUN_TIMEOUT_MS, withTimeout } from "../watch";
import { FLOW_BYTES, FLOW_DATA_URL, MIMI_BYTES, MIMI_URL, MODEL_CACHE, phononModelsCached, voiceUrl } from "./voices";

const CACHE = MODEL_CACHE;
const SAMPLE_RATE = 24000;
const LAYERS = 6;
const HEADS = 8;
const HEAD_DIM = 64;
const EOS = 4;
// CHUNK_FRAMES, the sampler temperature and the seed live in revision.ts,
// so the clip cache moves when they do.

const tokenizer = tokenizerJson as unknown as TokenizerModel;

type OrtModule = typeof import("onnxruntime-web");
type OrtTensor = import("onnxruntime-web").Tensor;
type Session = import("onnxruntime-web").InferenceSession;

// On WebGPU the caches stay on the GPU between steps (`tensor`); reading them
// back to the CPU every frame costs more than the step itself.
type Packed = { dims: number[]; data: Float32Array; tensor?: undefined } | { dims: number[]; data?: undefined; tensor: OrtTensor };
type FlowState = Record<string, Packed>;

export type PhononSentence = {
  text: string;
  tokens: string[];
  samples: Float32Array;
  frames: number;
  // frames × layers × heads × tokens, one head's row is `tokens` floats.
  attention: Float32Array;
  weights(layer: number, head: number): number[][];
};

export type PhononSpeech = {
  sentences: PhononSentence[];
  sampleRate: number;
  device: "webgpu" | "wasm";
  deviceReason: string;
  firstAudioMs: number;
  tookMs: number;
};

export type PhononProgress = (fraction: number, label: string) => void;

// One piece of a sentence, posted while the rest is still being generated.
// `samples` is a fresh copy the caller may transfer. `weights` is the
// requested head for the frames so far (frames × tokens).
export type PhononAudioChunk = {
  samples: Float32Array;
  text: string;
  tokens: string[];
  frames: number;
  weights: number[][];
  sampleCount: number;
  done: boolean;
};

type SpeakOptions = {
  voice: string;
  durationDelta?: number;
  onProgress?: PhononProgress;
  onSentence?: (sentence: PhononSentence) => void;
  onChunk?: (chunk: PhononAudioChunk) => void;
  align?: { layer: number; head: number };
  signal?: AbortSignal;
};

const VOICE_BYTES = 256_000;

export { wasmSimd } from "./support";

export async function phononInstalled(): Promise<boolean> {
  return phononModelsCached();
}

let loading: Promise<PhononEngine> | undefined;
let live: PhononEngine | undefined;
let loadAbort: AbortController | undefined;

export function loadPhonon(onProgress: PhononProgress = () => {}, options?: { debug?: boolean }): Promise<PhononEngine> {
  return (loading ??= startPhonon(onProgress, options).catch((error: unknown) => {
    loading = undefined;
    throw error;
  }));
}

function startPhonon(onProgress: PhononProgress, options?: { debug?: boolean }) {
  const abort = new AbortController();
  loadAbort = abort;
  return PhononEngine.start(onProgress, { signal: abort.signal, debug: options?.debug }).then((engine) => {
    live = engine;
    return engine;
  });
}

export async function removePhonon(): Promise<void> {
  loadAbort?.abort();
  loadAbort = undefined;
  loading = undefined;
  const engine = live;
  live = undefined;
  await engine?.dispose();
  if (typeof caches !== "undefined") await caches.delete(CACHE);
}

export class PhononEngine {
  device: "webgpu" | "wasm" = "wasm";
  deviceReason = "Loading.";
  threads = 1;
  private retried = false;
  private constructor(
    private ort: OrtModule,
    private flow: Session,
    private mimi: Session,
    private bytes: { graph: Uint8Array; flow: Uint8Array; mimi: Uint8Array } | undefined,
    private signal?: AbortSignal,
  ) {}

  static async start(onProgress: PhononProgress, options?: { signal?: AbortSignal; debug?: boolean }): Promise<PhononEngine> {
    // WASM inference is synchronous on whoever calls it. On the page thread
    // that freezes the tab for the whole clip. The lab worker and the shared
    // voice engine are the only callers.
    if (typeof document !== "undefined") throw new Error("Phonon inference cannot run on the page thread.");
    // The webgpu build is ORT's native WebGPU backend. The default build's WebGPU
    // (JSEP) rejects these graphs at the first run, and so does the native
    // backend before 1.24 (empty cache tensors).
    const ort = await import("onnxruntime-web/webgpu");
    // Stay in this worker. A wasm proxy would spawn another worker, and a
    // proxy that resolves to the page is how generation locks the tab.
    ort.env.wasm.proxy = false;
    ort.env.wasm.wasmPaths = "/ort/";
    ort.env.debug = options?.debug ?? false;
    ort.env.logLevel = "error";
    // More than one wasm thread needs cross-origin isolation (SharedArrayBuffer).
    // This site does not send COOP/COEP, so a normal tab stays at one thread.
    // The page still stays responsive: the work is in the worker, and the
    // loop yields between frames.
    const threads = typeof crossOriginIsolated === "boolean" && crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 1) : 1;
    ort.env.wasm.numThreads = threads;
    const signal = options?.signal;
    const [flowBytes, mimiBytes] = await Promise.all([
      fetchBytes(FLOW_DATA_URL, FLOW_BYTES, (loaded, total) => onProgress(loaded / total / 2, "the speech model"), signal),
      fetchBytes(MIMI_URL, MIMI_BYTES, (loaded, total) => onProgress(0.5 + loaded / total / 2, "the audio decoder"), signal),
    ]);
    const graph = new Uint8Array(await (await fetch(graphUrl, { signal })).arrayBuffer());
    const bytes = { graph, flow: flowBytes, mimi: mimiBytes };
    const gpuGap = await webGpuReason();
    if (!gpuGap) {
      let gpu: PhononEngine | undefined;
      try {
        gpu = await PhononEngine.open(ort, bytes, "webgpu", signal);
        await gpu.warmup();
        gpu.deviceReason = "Running on WebGPU.";
        return gpu;
      } catch (error) {
        await gpu?.release();
        // A download, or a bug in the caller, is not a reason to stay on
        // the CPU for the rest of the visit.
        if (!shouldUseCpu("webgpu", false, error)) throw error;
        const engine = await PhononEngine.open(ort, bytes, "wasm", signal);
        engine.bytes = undefined;
        engine.deviceReason = `WebGPU could not run the model (${describeOrtError(error, "webgpu")}). Running on the CPU${threadNote(engine.threads)}.`;
        return engine;
      }
    }
    const engine = await PhononEngine.open(ort, bytes, "wasm", signal);
    engine.bytes = undefined;
    engine.deviceReason = `${gpuGap} Running on the CPU${threadNote(engine.threads)}.`;
    return engine;
  }

  private static async open(ort: OrtModule, bytes: { graph: Uint8Array; flow: Uint8Array; mimi: Uint8Array }, device: "webgpu" | "wasm", signal?: AbortSignal) {
    const providers = device === "webgpu" ? ["webgpu" as const] : ["wasm" as const];
    // A WebGPU session can still be created and throw on the first run. The
    // warmup catches that and the engine opens the CPU build instead.
    const options = { executionProviders: providers, graphOptimizationLevel: "all" as const };
    const flowCache: Record<string, "gpu-buffer"> = {};
    for (let layer = 0; layer < LAYERS; layer++) flowCache[`present.${layer}.key`] = flowCache[`present.${layer}.value`] = "gpu-buffer";
    const codecCache: Record<string, "gpu-buffer"> = {};
    for (let layer = 0; layer < 2; layer++) codecCache[`present.${layer}.key`] = codecCache[`present.${layer}.value`] = "gpu-buffer";
    for (const [name] of CONV) codecCache[`present_${name.slice("past_".length)}`] = "gpu-buffer";
    const gpu = device === "webgpu";
    const flowSession = () => ort.InferenceSession.create(bytes.graph, { ...options, ...(gpu ? { preferredOutputLocation: flowCache } : {}), externalData: [{ path: "flow_lm_q4.onnx_data", data: bytes.flow }] });
    const mimiSession = () => ort.InferenceSession.create(bytes.mimi, { ...options, ...(gpu ? { preferredOutputLocation: codecCache } : {}) });
    // One after the other. Two creates in flight before ORT's wasm runtime has
    // initialized never return, on the WebGPU build as on the CPU build: the
    // voice install then hangs at 100% with no error. A create that never
    // comes back is the same failure, so each one has a deadline.
    const flow = await openSession(flowSession, "Loading the speech model", device);
    const mimi = await openSession(mimiSession, "Loading the audio decoder", device);
    const engine = new PhononEngine(ort, flow, mimi, bytes, signal);
    engine.device = device;
    engine.threads = ort.env.wasm.numThreads ?? 1;
    // After the sessions exist. A failure here must not fail the install:
    // the voice still runs, and a lost device is noticed on the next run.
    if (device === "webgpu") {
      try {
        engine.watchDevice();
      } catch {
        // watchWebGpuDevice already swallows this. The call stays inside
        // open() so a future change cannot leak it into the install again.
      }
    }
    return engine;
  }

  // A session stand-in, so a test can throw mid-sentence and see the tensors go.
  static forTest(ort: OrtModule, flow: Session, mimi: Session): PhononEngine {
    return new PhononEngine(ort, flow, mimi, undefined);
  }

  private lost?: string;

  // A lost GPU device does not reject the run that was using it. The next
  // run sees it and falls back to the CPU. In 1.31.1 the device may be the
  // GPUDevice itself, not a promise of one.
  private watchDevice() {
    watchWebGpuDevice(() => {
      const webgpu = this.ort.env.webgpu as { device?: { lost?: Promise<{ message?: string }> | { message?: string } } | Promise<{ lost?: Promise<{ message?: string }> }> } | undefined;
      return webgpu?.device;
    }, (message) => {
      this.lost = message;
    });
  }

  private released = false;
  // One speak at a time, including the lab's. dispose waits its turn, so a
  // retry cannot warm up on the session a clip is still using.
  private gate: Promise<void> = Promise.resolve();

  private exclusive<T>(run: () => Promise<T>): Promise<T> {
    const next = this.gate.then(run, run);
    this.gate = next.then(() => undefined, () => undefined);
    return next;
  }

  dispose() {
    return this.exclusive(() => this.release());
  }

  private async release() {
    if (this.released) return;
    this.released = true;
    await this.flow.release().catch(() => undefined);
    await this.mimi.release().catch(() => undefined);
    for (const state of this.voices.values()) for (const packed of Object.values(state)) this.disposeTensor(packed.tensor, true);
    this.voices.clear();
    this.kept = new WeakSet();
  }

  // The voice prompt is the warmup: it compiles the flow shaders while the
  // model is still loading. Miles is the default voice, so that step is the
  // one the first clip would have paid for.
  private async warmup() {
    await this.voiceState("miles");
  }

  private voices = new Map<string, FlowState>();
  // GPU tensors that belong to a cached voice and must outlive a clip.
  private kept = new WeakSet<OrtTensor>();

  private gone = new WeakSet<OrtTensor>();

  private disposeTensor(tensor?: OrtTensor, force = false) {
    if (!tensor || this.gone.has(tensor)) return;
    if (!force && this.kept.has(tensor)) return;
    this.gone.add(tensor);
    try {
      tensor.dispose();
    } catch {
      // Already gone.
    }
  }

  private drop(state: FlowState | undefined) {
    if (!state) return;
    for (const packed of Object.values(state)) if (packed?.tensor) this.disposeTensor(packed.tensor);
  }

  async speak(text: string, options: SpeakOptions = { voice: "miles" }): Promise<PhononSpeech> {
    return this.exclusive(() => this.speakTurn(text, options));
  }

  private async speakTurn(text: string, options: SpeakOptions): Promise<PhononSpeech> {
    try {
      const speech = await this.speakWith(text, options);
      // The weights are only needed again if WebGPU fails later and we open
      // the CPU build. Until then they are ~67 MB the tab does not have to keep.
      if (this.device === "webgpu") this.bytes = undefined;
      return speech;
    } catch (error) {
      if (!shouldUseCpu(this.device, this.retried, error)) throw error;
      this.retried = true;
      const why = describeOrtError(error, "webgpu");
      await this.release();
      const weights = await this.weights();
      const replacement = await PhononEngine.open(this.ort, weights, "wasm");
      this.flow = replacement.flow;
      this.mimi = replacement.mimi;
      this.bytes = weights;
      this.device = "wasm";
      this.threads = replacement.threads;
      this.deviceReason = `WebGPU failed while speaking (${why}). Running on the CPU${threadNote(this.threads)}.`;
      return await this.speakWith(text, options);
    }
  }

  private async weights() {
    if (this.bytes) return this.bytes;
    const [flow, mimi] = await Promise.all([
      fetchBytes(FLOW_DATA_URL, FLOW_BYTES, () => {}, this.signal),
      fetchBytes(MIMI_URL, MIMI_BYTES, () => {}, this.signal),
    ]);
    const graph = new Uint8Array(await (await fetch(graphUrl)).arrayBuffer());
    return { graph, flow, mimi };
  }

  private async speakWith(text: string, options: SpeakOptions): Promise<PhononSpeech> {
    const started = performance.now();
    const voice = await this.voiceState(options.voice, options.onProgress);
    this.throwIfCancelled(options.signal);
    // Every sentence starts from the voice prompt alone. Speaking the words
    // before the step, or carrying the previous sentence, makes the model
    // repeat and mangle, on the CPU and on WebGPU. The decoder state and the
    // random stream still carry, so the audio joins without a click.
    const state = cloneState(voice);
    let codec = emptyCodec();
    const rand = mulberry32(SPEAK_SEED);
    let firstAudioMs = 0;
    const sentences: PhononSentence[] = [];
    try {
      // A short last sentence on its own rises at the end ("dive in."). Said
      // in the same breath as the sentence before, with a comma, it falls.
      for (const sentence of mergeShortFinal(splitSentences(text))) {
        this.throwIfCancelled(options.signal);
        const spoken = await this.utter(sentence, state, codec, options.durationDelta ?? durationDelta(0.92), rand, true, started, options);
        this.drop(spoken.state);
        this.drop(codec);
        codec = spoken.codec;
        if (!firstAudioMs && spoken.firstFrameMs) firstAudioMs = spoken.firstFrameMs;
        const tokens = spoken.tokens.length;
        const packed = spoken.attention;
        const made: PhononSentence = {
          text: sentence,
          tokens: spoken.tokens,
          samples: spoken.samples,
          frames: spoken.frames,
          attention: packed,
          weights: (_layer, head) => unpack(packed, spoken.frames, tokens, head),
        };
        sentences.push(made);
        options.onSentence?.(made);
      }
      return { sentences, sampleRate: SAMPLE_RATE, device: this.device, deviceReason: this.deviceReason, firstAudioMs, tookMs: performance.now() - started };
    } finally {
      this.drop(state);
      this.drop(codec);
    }
  }

  private throwIfCancelled(signal?: AbortSignal) {
    if (signal?.aborted) throw new Cancelled();
  }

  private async voiceState(id: string, onProgress?: PhononProgress): Promise<FlowState> {
    const found = this.voices.get(id);
    if (found) return found;
    onProgress?.(0, "the voice");
    const bytes = await fetchBytes(voiceUrl(id), VOICE_BYTES, (loaded, total) => onProgress?.(loaded / total, "the voice"), this.signal);
    const data = new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
    const frames = data.length / 512;
    const voice = this.tensor("float32", data, [1, 512, frames]);
    const primed = await this.step(emptyFlow(), { voice_latents: voice, duration: 0 });
    this.disposeTensor(primed.latent);
    const { state } = primed;
    for (const packed of Object.values(state)) if (packed.tensor) this.kept.add(packed.tensor);
    this.voices.set(id, state);
    return state;
  }

  private async utter(text: string, state: FlowState, codec: Codec, durationDelta: number, rand: () => number, audible: boolean, started = 0, options?: SpeakOptions) {
    const encoded = encode(tokenizer, speakable(text));
    const ids = this.tensor("int64", BigInt64Array.from(encoded.ids, (id) => BigInt(id)), [1, encoded.ids.length]);
    const textStart = state["past_key_values.0.key"]?.dims[2] ?? 0;
    const prefill = await this.step(state, { text_ids: ids, duration: durationDelta });
    this.disposeTensor(prefill.latent);
    let flow = prefill.state;
    const textEnd = flow["past_key_values.0.key"]?.dims[2] ?? textStart;
    let audioCodec = codec;
    const chunks: Float32Array[] = [];
    const rows: Float32Array[] = [];
    const pending: Float32Array[] = [];
    const queue: Float32Array[] = [];
    let batch = 1;
    let sentRows = 0;
    let firstFrameMs = 0;
    const width = Math.max(0, textEnd - textStart);
    const align = options?.align ?? { layer: ATTENTION_LAYER, head: ATTENTION_HEAD };
    const flush = async (done: boolean) => {
      if (!audible || (!pending.length && !done)) return;
      const samples = concat(pending);
      pending.length = 0;
      const sampleCount = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
      const fresh = rows.slice(sentRows);
      sentRows = rows.length;
      options?.onChunk?.({
        samples,
        text,
        tokens: encoded.tokens,
        frames: rows.length,
        weights: headWeights(fresh, align.head, width),
        sampleCount,
        done,
      });
      await yieldNow();
      this.throwIfCancelled(options?.signal);
    };
    // The first frame is decoded alone, so the first audio is not waiting on
    // three more flow steps. After that, four latents share one decoder call.
    const drain = async (force: boolean) => {
      while (queue.length) {
        const count = queue.length >= batch ? batch : force ? queue.length : 0;
        if (!count) return;
        const taken = queue.splice(0, count);
        const decoded = await this.decodeMany(audioCodec, taken);
        if (audioCodec !== codec) this.drop(audioCodec);
        audioCodec = decoded.state;
        if (batch < CHUNK_FRAMES) batch = Math.min(CHUNK_FRAMES, batch * 2);
        for (const audio of decoded.audios) {
          if (!firstFrameMs) firstFrameMs = performance.now() - started;
          chunks.push(audio);
          pending.push(audio);
        }
        if (pending.length >= CHUNK_FRAMES || chunks.length === 1) await flush(false);
      }
    };
    let latent = this.tensor("float32", Float32Array.from({ length: 32 }, () => Number.NaN), [1, 1, 32]);
    let countdown: number | undefined;
    const limit = Math.ceil((encoded.ids.length / 3 + 2) * 12.5) + 8;
    let frames = 0;
    const blanks: FrameBlanks = {
      text: this.tensor("int64", new BigInt64Array(), [1, 0]),
      voice: this.tensor("float32", new Float32Array(), [1, 512, 0]),
      speakers: this.tensor("int64", BigInt64Array.from([1n]), [1]),
      duration: this.tensor("float32", Float32Array.from([durationDelta]), [1]),
    };
    const releaseBlanks = () => {
      this.disposeTensor(blanks.text);
      this.disposeTensor(blanks.voice);
      this.disposeTensor(blanks.speakers);
      this.disposeTensor(blanks.duration);
    };
    try {
    for (; frames < limit; frames++) {
      this.throwIfCancelled(options?.signal);
      const noise = Float32Array.from({ length: 32 }, () => gaussian(rand) * Math.sqrt(SPEAK_TEMPERATURE));
      const stepped = await this.step(flow, { latent, noise: this.tensor("float32", noise, [1, 32]), duration: durationDelta }, audible ? { start: textStart, length: width, layer: align.layer, head: align.head } : undefined, blanks);
      this.drop(flow);
      flow = stepped.state;
      if (audible && stepped.attention) rows.push(stepped.attention);
      if (audible) queue.push(latentRow(stepped.latent));
      if (countdown === undefined && stepped.eos > EOS) countdown = text.trim().split(/\s+/).length <= 4 ? 3 : 1;
      if (audible) await drain(countdown !== undefined);
      if (countdown !== undefined && countdown-- === 0) {
        frames += 1;
        break;
      }
      latent = stepped.latent;
    }
    if (audible) await drain(true);
    await flush(true);
    const samples = concat(chunks);
    const attention = new Float32Array(rows.length * HEADS * width);
    rows.forEach((row, index) => attention.set(row.subarray(0, HEADS * width), index * HEADS * width));
    this.disposeTensor(latent);
    this.disposeTensor(ids);
    releaseBlanks();
    return { state: flow, codec: audioCodec, samples, tokens: encoded.tokens, attention, frames: rows.length, firstFrameMs };
    } catch (error) {
      this.drop(flow);
      if (audioCodec !== codec) this.drop(audioCodec);
      this.disposeTensor(latent);
      this.disposeTensor(ids);
      releaseBlanks();
      throw error;
    }
  }

  private async step(state: FlowState, extra: { voice_latents?: OrtTensor; text_ids?: OrtTensor; latent?: OrtTensor; noise?: OrtTensor; duration: number }, text?: { start: number; length: number; layer: number; head: number }, blanks?: FrameBlanks) {
    const scratch: OrtTensor[] = [];
    const made = (tensor: OrtTensor) => {
      scratch.push(tensor);
      return tensor;
    };
    if (extra.text_ids) scratch.push(extra.text_ids);
    if (extra.voice_latents) scratch.push(extra.voice_latents);
    if (extra.latent) scratch.push(extra.latent);
    if (extra.noise) scratch.push(extra.noise);
    // Head 0 of layer 3 is one readback: latent, the end-of-speech logit and
    // that head's text span, concatenated. Any other head still reads the
    // layer's full attention, which the lab asks for.
    const packed = !text || (text.layer === ATTENTION_LAYER && text.head === ATTENTION_HEAD);
    const feeds: Record<string, OrtTensor> = {
      text_ids: extra.text_ids ?? blanks?.text ?? made(this.tensor("int64", new BigInt64Array(), [1, 0])),
      voice_latents: extra.voice_latents ?? blanks?.voice ?? made(this.tensor("float32", new Float32Array(), [1, 512, 0])),
      latent: extra.latent ?? made(this.tensor("float32", new Float32Array(), [1, 0, 32])),
      noise: extra.noise ?? made(this.tensor("float32", new Float32Array(32), [1, 32])),
      num_speakers: blanks?.speakers ?? made(this.tensor("int64", BigInt64Array.from([1n]), [1])),
      duration_delta: blanks?.duration ?? made(this.tensor("float32", Float32Array.from([extra.duration]), [1])),
      attn_start: made(this.tensor("int64", BigInt64Array.from([BigInt(text?.start ?? 0)]), [1])),
      attn_len: made(this.tensor("int64", BigInt64Array.from([BigInt(packed && text ? text.length : 0)]), [1])),
    };
    for (const [name, packedState] of Object.entries(state)) {
      if (packedState.tensor) feeds[name] = packedState.tensor;
      else feeds[name] = made(this.tensor("float32", packedState.data, packedState.dims));
    }
    const fetches = packed ? [...flowFetches(), "readback"] : [...flowFetches(), "latent_out", "eos_logit", ...(text ? [`attn.${text.layer}`] : [])];
    let latentOut: OrtTensor | undefined;
    try {
      const out = await run(this.flow, feeds, fetches, this.device, this.lost);
      const next: FlowState = {};
      for (let layer = 0; layer < LAYERS; layer++) {
        const key = out[`present.${layer}.key`] as OrtTensor;
        const value = out[`present.${layer}.value`] as OrtTensor;
        next[`past_key_values.${layer}.key`] = pack(key);
        next[`past_key_values.${layer}.value`] = pack(value);
        if (key.location !== "gpu-buffer") this.disposeTensor(key);
        if (value.location !== "gpu-buffer") this.disposeTensor(value);
      }
      let attn: Float32Array | undefined;
      let eos = 0;
      if (packed) {
        const tensor = out.readback as OrtTensor;
        const data = tensor.data as Float32Array;
        const row = new Float32Array(32);
        row.set(data.subarray(0, 32));
        latentOut = this.tensor("float32", row, [1, 1, 32]);
        eos = data[32] ?? 0;
        if (text && text.length > 0) {
          attn = new Float32Array(text.length);
          attn.set(data.subarray(33, 33 + text.length));
        }
        this.disposeTensor(tensor);
      } else if (text && text.length > 0 && text.start >= 0) {
        const tensor = out[`attn.${text.layer}`] as OrtTensor;
        const data = tensor.data as Float32Array;
        const queries = tensor.dims[2] ?? 1;
        const width = tensor.dims[3] ?? 0;
        const query = queries - 1;
        attn = new Float32Array(HEADS * text.length);
        for (let head = 0; head < HEADS; head++) {
          const from = (head * queries + query) * width + text.start;
          attn.set(data.subarray(from, from + text.length), head * text.length);
        }
        this.disposeTensor(tensor);
      }
      if (!packed) {
        const eosTensor = out.eos_logit as OrtTensor | undefined;
        eos = Number((eosTensor?.data as Float32Array | undefined)?.[0] ?? 0);
        this.disposeTensor(eosTensor);
        latentOut = (out.latent_out as OrtTensor | undefined) ?? extra.latent;
      }
      return { state: next, latent: latentOut!, attention: attn, eos };
    } finally {
      for (const tensor of scratch) if (tensor !== latentOut) this.disposeTensor(tensor);
    }
  }

  // One decoder call for several flow frames. The audio comes back as one
  // buffer, n times a single frame, in order. A four-frame batch matches a
  // frame-at-a-time decode to about 5e-7 in sample amplitude.
  private async decodeMany(codec: Codec, latents: Float32Array[]) {
    const count = latents.length;
    const decoded = await this.decode(codec, this.tensor("float32", stackLatents(latents), [1, count, 32]));
    const per = Math.floor(decoded.audio.length / count) || decoded.audio.length;
    const audios: Float32Array[] = [];
    for (let index = 0; index < count; index++) audios.push(decoded.audio.subarray(index * per, Math.min(decoded.audio.length, (index + 1) * per)));
    return { audios, state: decoded.state };
  }

  private async decode(codec: Codec, latent: OrtTensor) {
    const feeds: Record<string, OrtTensor> = { latent, past_offset: codec.past_offset_i64 ?? this.tensor("int64", BigInt64Array.from([0n]), [1]) };
    for (const [name, packed] of Object.entries(codec)) {
      if (!packed || name === "past_offset_i64") continue;
      const cache = packed as Packed;
      if (cache.tensor) feeds[name] = cache.tensor;
      else if (cache.data instanceof Float32Array) feeds[name] = this.tensor("float32", cache.data, cache.dims);
    }
    const out = await run(this.mimi, feeds, undefined, this.device, this.lost);
    const audio = (out.audio as OrtTensor).data as Float32Array;
    return { audio, state: readCodec(out as Record<string, OrtTensor>) };
  }

  private tensor(type: "float32", data: Float32Array, dims: number[]): OrtTensor;
  private tensor(type: "int64", data: BigInt64Array, dims: number[]): OrtTensor;
  private tensor(type: "float32" | "int64", data: Float32Array | BigInt64Array, dims: number[]): OrtTensor {
    return new this.ort.Tensor(type, type === "float32" ? (data as Float32Array) : (data as BigInt64Array), dims);
  }
}

// The codec's int64 offset does not fit the float cache, so it travels beside it.
type Codec = FlowState & { past_offset_i64?: OrtTensor };

function emptyFlow(): FlowState {
  const state: FlowState = {};
  for (let layer = 0; layer < LAYERS; layer++) {
    state[`past_key_values.${layer}.key`] = { dims: [1, HEADS, 0, HEAD_DIM], data: new Float32Array() };
    state[`past_key_values.${layer}.value`] = { dims: [1, HEADS, 0, HEAD_DIM], data: new Float32Array() };
  }
  return state;
}

const CONV: [string, number[]][] = [
  ["past_conv.upsample", [1, 512, 16]],
  ["past_conv.init_conv", [1, 512, 6]],
  ["past_conv.up0", [1, 256, 6]],
  ["past_conv.up0.res0.conv1", [1, 256, 2]],
  ["past_conv.up1", [1, 128, 5]],
  ["past_conv.up1.res0.conv1", [1, 128, 2]],
  ["past_conv.up2", [1, 64, 4]],
  ["past_conv.up2.res0.conv1", [1, 64, 2]],
  ["past_conv.final_conv", [1, 64, 2]],
];

function emptyCodec(): Codec {
  const state: Codec = {};
  for (let layer = 0; layer < 2; layer++) {
    state[`past_key_values.${layer}.key`] = { dims: [1, HEADS, 0, HEAD_DIM], data: new Float32Array() };
    state[`past_key_values.${layer}.value`] = { dims: [1, HEADS, 0, HEAD_DIM], data: new Float32Array() };
  }
  for (const [name, dims] of CONV) state[name] = { dims, data: new Float32Array(dims.reduce((product, dim) => product * dim, 1)) };
  return state;
}

function readCodec(out: Record<string, OrtTensor>): Codec {
  const state: Codec = {};
  for (let layer = 0; layer < 2; layer++) {
    state[`past_key_values.${layer}.key`] = pack(out[`present.${layer}.key`]!);
    state[`past_key_values.${layer}.value`] = pack(out[`present.${layer}.value`]!);
  }
  for (const [name] of CONV) {
    const present = `present_${name.slice("past_".length)}`;
    state[name] = pack(out[present]!);
  }
  state.past_offset_i64 = out.present_offset;
  return state;
}

function flowFetches(): string[] {
  const names: string[] = [];
  for (let layer = 0; layer < LAYERS; layer++) names.push(`present.${layer}.key`, `present.${layer}.value`);
  return names;
}

type FrameBlanks = { text: OrtTensor; voice: OrtTensor; speakers: OrtTensor; duration: OrtTensor };

function pack(tensor: OrtTensor): Packed {
  if (tensor.location === "gpu-buffer") return { dims: [...tensor.dims], tensor };
  const data = tensor.data;
  if (!(data instanceof Float32Array)) throw new Error("The voice model returned a non-float tensor.");
  return { dims: [...tensor.dims], data: Float32Array.from(data) };
}

function cloneState(state: FlowState): FlowState {
  return Object.fromEntries(Object.entries(state).map(([name, packed]) => [name, packed.tensor ? packed : { dims: packed.dims, data: new Float32Array(packed.data) }]));
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

function headWeights(rows: Float32Array[], head: number, width: number): number[][] {
  if (width <= 0) return [];
  const from = head * width;
  return rows.map((row) => Array.from(row.subarray(from, from + width)));
}

function stackLatents(latents: Float32Array[]): Float32Array {
  const data = new Float32Array(latents.length * 32);
  latents.forEach((row, index) => data.set(row.subarray(0, 32), index * 32));
  return data;
}

function latentRow(tensor: OrtTensor): Float32Array {
  return (tensor.data as Float32Array).subarray(0, 32);
}

// A yield the worker can use to read a cancel, without setTimeout's 4 ms floor.
function yieldNow() {
  return new Promise<void>((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => {
      channel.port1.close();
      resolve();
    };
    channel.port2.postMessage(null);
  });
}

function concat(chunks: Float32Array[]): Float32Array {
  const length = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const out = new Float32Array(length);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
}

async function fetchBytes(url: string, expected: number, onProgress: (loaded: number, total: number) => void, signal?: AbortSignal): Promise<Uint8Array> {
  if (signal?.aborted) throw new DOMException("The voice download was cancelled.", "AbortError");
  const cache = typeof caches === "undefined" ? undefined : await caches.open(CACHE);
  const hit = await cache?.match(url);
  if (hit) {
    const bytes = new Uint8Array(await hit.arrayBuffer());
    if (bytes.byteLength === expected) {
      onProgress(bytes.byteLength, bytes.byteLength);
      return bytes;
    }
  }
  let response: Response;
  try {
    response = await fetch(url, { signal });
  } catch (error) {
    if (signal?.aborted) throw new DOMException("The voice download was cancelled.", "AbortError");
    throw new VoiceFailure(error instanceof Error ? error.message : "Could not download the voice model.", "network");
  }
  if (!response.ok || !response.body) throw new VoiceFailure(`Could not download the voice model (${response.status}).`, "network");
  const total = Number(response.headers.get("content-length")) || expected;
  // The cache stores one branch of the body. The bytes we keep are the other,
  // so the download is not held twice.
  const [forCache, forRead] = response.body.tee();
  const caching = cache
    ? cache.put(url, new Response(forCache, { headers: response.headers })).catch(() => undefined)
    : forCache.cancel().then(() => undefined).catch(() => undefined);
  const reader = forRead.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  try {
    for (;;) {
      if (signal?.aborted) throw new DOMException("The voice download was cancelled.", "AbortError");
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      loaded += value.byteLength;
      onProgress(loaded, total);
    }
  } catch (error) {
    await caching;
    if (signal?.aborted) throw new DOMException("The voice download was cancelled.", "AbortError");
    throw error;
  }
  const bytes = new Uint8Array(loaded);
  let at = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, at);
    at += chunk.byteLength;
  }
  await caching;
  return bytes;
}

type GpuAdapterInfo = { isFallbackAdapter?: boolean };
type GpuAdapter = { info?: GpuAdapterInfo; requestAdapterInfo?: () => Promise<GpuAdapterInfo> };

async function webGpuReason(): Promise<string | undefined> {
  const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<GpuAdapter | null> } }).gpu;
  if (!gpu) return "This browser has no WebGPU.";
  const adapter = await gpu.requestAdapter().catch(() => null);
  if (!adapter) return "This browser has no WebGPU adapter.";
  // SwiftShader and the other software adapters are about 25 times slower than
  // the CPU build. A missing adapter and a fallback adapter both stay on the CPU.
  const info = adapter.info ?? await adapter.requestAdapterInfo?.().catch(() => undefined);
  if (info?.isFallbackAdapter) return "This browser's WebGPU is a software adapter, slower than the CPU.";
  return undefined;
}

function mulberry32(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussian(rand: () => number) {
  const u = Math.max(1e-12, 1 - rand());
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
}

function threadNote(threads: number) {
  return threads > 1 ? `, ${threads} threads` : "";
}

async function openSession(create: () => Promise<Session>, label: string, device: "webgpu" | "wasm") {
  try {
    return await withTimeout(create(), CREATE_TIMEOUT_MS, label);
  } catch (error) {
    if (error instanceof OrtRunError) throw error;
    throw new OrtRunError(describeOrtError(error, device));
  }
}

async function run(session: Session, feeds: Record<string, OrtTensor>, fetches: string[] | undefined, device: "webgpu" | "wasm", lost?: string) {
  if (lost) throw new OrtRunError(`The WebGPU device was lost (${lost}).`);
  try {
    const work = fetches ? session.run(feeds, fetches) : session.run(feeds);
    return await withTimeout(work, RUN_TIMEOUT_MS, "The voice model");
  } catch (error) {
    if (error instanceof OrtRunError) throw error;
    throw new OrtRunError(describeOrtError(error, device));
  }
}
