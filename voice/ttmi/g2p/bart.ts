// misaki's fallback for words its dictionaries do not know: a BART model of
// one encoder and one decoder layer, 128 wide, one head (752k weights,
// 3 MB), trained on those dictionaries (PeterReid/graphemes_to_phonemes_en_us
// on Hugging Face, Apache License 2.0). Small enough to run here in plain
// TypeScript: no ONNX runtime, a word takes well under a millisecond.
export type BartConfig = { grapheme_chars: string; phoneme_chars: string; max_position_embeddings: number; d_model: number };

type Weights = Map<string, Float32Array>;

export function readSafetensors(buffer: ArrayBuffer): Weights {
  const view = new DataView(buffer);
  const length = Number(view.getBigUint64(0, true));
  const header = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 8, length))) as Record<string, { dtype: string; data_offsets: [number, number] }>;
  const weights: Weights = new Map();
  for (const [name, info] of Object.entries(header)) {
    if (name === "__metadata__") continue;
    if (info.dtype !== "F32") throw new Error(`Unexpected ${info.dtype} in ${name}`);
    const [from, to] = info.data_offsets;
    // Copied: the offsets need not be 4-byte aligned.
    weights.set(name, new Float32Array(buffer.slice(8 + length + from, 8 + length + to)));
  }
  return weights;
}

// x is rows × inp; w is out × inp, as PyTorch keeps it.
function linear(x: Float32Array, rows: number, w: Float32Array, b: Float32Array, inp: number, out: number) {
  const y = new Float32Array(rows * out);
  for (let r = 0; r < rows; r++)
    for (let o = 0; o < out; o++) {
      let sum = b[o]!;
      const xo = r * inp;
      const wo = o * inp;
      for (let i = 0; i < inp; i++) sum += x[xo + i]! * w[wo + i]!;
      y[r * out + o] = sum;
    }
  return y;
}

function layerNorm(x: Float32Array, rows: number, d: number, g: Float32Array, b: Float32Array) {
  const y = new Float32Array(x.length);
  for (let r = 0; r < rows; r++) {
    let mean = 0;
    for (let i = 0; i < d; i++) mean += x[r * d + i]!;
    mean /= d;
    let variance = 0;
    for (let i = 0; i < d; i++) variance += (x[r * d + i]! - mean) ** 2;
    const scale = 1 / Math.sqrt(variance / d + 1e-5);
    for (let i = 0; i < d; i++) y[r * d + i] = (x[r * d + i]! - mean) * scale * g[i]! + b[i]!;
  }
  return y;
}

// Abramowitz and Stegun 7.1.26, close enough for GELU.
function erf(x: number) {
  const s = Math.sign(x);
  const a = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * a);
  return s * (1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-a * a));
}

const add = (a: Float32Array, b: Float32Array) => a.map((v, i) => v + b[i]!);

export function createBart(weights: Weights, config: BartConfig) {
  const d = config.d_model;
  const w = (name: string) => {
    const tensor = weights.get(name);
    if (!tensor) throw new Error(`No ${name} in the fallback model`);
    return tensor;
  };
  const embed = w("model.shared.weight");
  const bias = weights.get("final_logits_bias");
  const vocab = embed.length / d;
  const graphemes = new Map([...config.grapheme_chars].map((c, i) => [c, i]));
  const phonemes = [...config.phoneme_chars];
  const ffn = (embed_: Float32Array, rows: number, p: string) => {
    const hidden = linear(embed_, rows, w(`${p}.fc1.weight`), w(`${p}.fc1.bias`), d, w(`${p}.fc1.bias`).length);
    const gelu = hidden.map((v) => 0.5 * v * (1 + erf(v / Math.SQRT2)));
    return linear(gelu, rows, w(`${p}.fc2.weight`), w(`${p}.fc2.bias`), hidden.length / rows, d);
  };
  const project = (x: Float32Array, rows: number, name: string) => linear(x, rows, w(`${name}.weight`), w(`${name}.bias`), d, d);
  // One head, so attention is over the whole width; q is rows × d, k and v
  // are the rows it may see.
  const attend = (q: Float32Array, rows: number, k: Float32Array, v: Float32Array, seen: (row: number) => number, p: string) => {
    const scale = 1 / Math.sqrt(d);
    const out = new Float32Array(rows * d);
    const scores = new Float32Array(k.length / d);
    for (let r = 0; r < rows; r++) {
      const visible = seen(r);
      let max = -Infinity;
      for (let s = 0; s < visible; s++) {
        let dot = 0;
        for (let i = 0; i < d; i++) dot += q[r * d + i]! * k[s * d + i]!;
        scores[s] = dot * scale;
        max = Math.max(max, scores[s]!);
      }
      let total = 0;
      for (let s = 0; s < visible; s++) total += scores[s] = Math.exp(scores[s]! - max);
      for (let s = 0; s < visible; s++) for (let i = 0; i < d; i++) out[r * d + i] = out[r * d + i]! + (scores[s]! / total) * v[s * d + i]!;
    }
    return project(out, rows, `${p}.out_proj`);
  };
  // Token embeddings plus learned positions, which BART offsets by 2.
  const embedded = (ids: number[], first: number, p: string) => {
    const positions = w(`${p}.embed_positions.weight`);
    const x = new Float32Array(ids.length * d);
    ids.forEach((id, r) => {
      for (let i = 0; i < d; i++) x[r * d + i] = embed[id * d + i]! + positions[(first + r + 2) * d + i]!;
    });
    return layerNorm(x, ids.length, d, w(`${p}.layernorm_embedding.weight`), w(`${p}.layernorm_embedding.bias`));
  };
  const norm = (x: Float32Array, rows: number, name: string) => layerNorm(x, rows, d, w(`${name}.weight`), w(`${name}.bias`));

  const encode = (ids: number[]) => {
    const p = "model.encoder.layers.0";
    const rows = ids.length;
    let x = embedded(ids, 0, "model.encoder");
    const a = `${p}.self_attn`;
    x = norm(add(x, attend(project(x, rows, `${a}.q_proj`), rows, project(x, rows, `${a}.k_proj`), project(x, rows, `${a}.v_proj`), () => rows, a)), rows, `${p}.self_attn_layer_norm`);
    return norm(add(x, ffn(x, rows, p)), rows, `${p}.final_layer_norm`);
  };

  // One decoder layer: a token's keys and values for self-attention depend
  // only on the token and its position, so each step runs one row.
  const decoder = (memory: Float32Array, memoryRows: number) => {
    const p = "model.decoder.layers.0";
    const cross = `${p}.encoder_attn`;
    const self = `${p}.self_attn`;
    const crossK = project(memory, memoryRows, `${cross}.k_proj`);
    const crossV = project(memory, memoryRows, `${cross}.v_proj`);
    const selfK = new Float32Array(config.max_position_embeddings * d);
    const selfV = new Float32Array(config.max_position_embeddings * d);
    let length = 0;
    return (token: number) => {
      let x = embedded([token], length, "model.decoder");
      selfK.set(project(x, 1, `${self}.k_proj`), length * d);
      selfV.set(project(x, 1, `${self}.v_proj`), length * d);
      length++;
      x = norm(add(x, attend(project(x, 1, `${self}.q_proj`), 1, selfK, selfV, () => length, self)), 1, `${p}.self_attn_layer_norm`);
      x = norm(add(x, attend(project(x, 1, `${cross}.q_proj`), 1, crossK, crossV, () => memoryRows, cross)), 1, `${p}.encoder_attn_layer_norm`);
      x = norm(add(x, ffn(x, 1, p)), 1, `${p}.final_layer_norm`);
      // The output layer is the shared embedding.
      let best = 0;
      let bestScore = -Infinity;
      for (let t = 0; t < vocab; t++) {
        let score = bias?.[t] ?? 0;
        for (let i = 0; i < d; i++) score += x[i]! * embed[t * d + i]!;
        if (score > bestScore) [best, bestScore] = [t, score];
      }
      return best;
    };
  };

  // Greedy, as misaki calls generate(); 1 starts, 2 ends, 3 is unknown.
  return function guess(word: string): string {
    const limit = config.max_position_embeddings - 2;
    const ids = [1, ...[...word].slice(0, limit).map((c) => graphemes.get(c) ?? 3), 2];
    const step = decoder(encode(ids), ids.length);
    const out = [1];
    while (out.length < limit) {
      const next = step(out.at(-1)!);
      if (next === 2) break;
      out.push(next);
    }
    return out
      .filter((t) => t > 3)
      .map((t) => phonemes[t] ?? "")
      .join("");
  };
}
