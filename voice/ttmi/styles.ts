// A voice's styles for Kokoro, blended when the voice names two
// (protocol.ts, voiceSpec): 256 numbers for every input length, from the
// cache kokoro-js keeps them in ("kokoro-voices"), fetched once.
import { readVoice } from "./protocol";

const URL_OF = (id: string) => `https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/main/voices/${id}.bin`;
const loaded = new Map<string, Promise<Float32Array>>();

function voiceData(id: string) {
  let found = loaded.get(id);
  if (!found) {
    found = (async () => {
      const cache = await caches.open("kokoro-voices").catch(() => undefined);
      const hit = await cache?.match(URL_OF(id));
      if (hit) return new Float32Array(await hit.arrayBuffer());
      const response = await fetch(URL_OF(id));
      if (!response.ok) throw new Error(`The voice ${id} could not be fetched.`);
      const buffer = await response.arrayBuffer();
      await cache?.put(URL_OF(id), new Response(buffer.slice(0), { headers: response.headers })).catch(() => {});
      return new Float32Array(buffer);
    })();
    found.catch(() => loaded.delete(id));
    loaded.set(id, found);
  }
  return found;
}

export async function voiceStyles(spec: string): Promise<Float32Array> {
  const { name, blend, mix } = readVoice(spec);
  const [a, b] = await Promise.all([voiceData(name), blend && mix > 0 ? voiceData(blend) : undefined]);
  return b ? a.map((value, index) => value * (1 - mix) + (b[index] ?? value) * mix) : a;
}

// The style for an input of this many tokens.
export const styleFor = (styles: Float32Array, tokens: number) => {
  const length = Math.min(Math.max(tokens, 0), 509);
  return styles.slice(256 * length, 256 * length + 256);
};
