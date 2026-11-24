// A sentence that throws gives back every tensor it took. The voice prompt's
// own tensors live until dispose(), which is what removing the voice calls.
import { describe, expect, test, vi } from "vitest";
import { PhononEngine } from "./runtime";

type Stub = { disposed: boolean; dispose(): void; dims: number[]; data: Float32Array | BigInt64Array; location: string };

describe("a sentence that throws", () => {
  test("disposes every tensor it created, and dispose() releases the voice", async () => {
    const made: Stub[] = [];
    class Tensor {
      disposed = false;
      location = "gpu-buffer";
      constructor(public type: string, public data: Float32Array | BigInt64Array, public dims: number[]) {
        made.push(this);
      }
      dispose() {
        this.disposed = true;
      }
    }
    let calls = 0;
    const outputs = () => {
      const out: Record<string, Stub> = {};
      for (let layer = 0; layer < 6; layer++) {
        out[`present.${layer}.key`] = new Tensor("float32", new Float32Array(8 * 4 * 64), [1, 8, 4, 64]);
        out[`present.${layer}.value`] = new Tensor("float32", new Float32Array(8 * 4 * 64), [1, 8, 4, 64]);
      }
      out.readback = new Tensor("float32", new Float32Array(33), [33]);
      return out;
    };
    const session = {
      run: () => {
        calls += 1;
        if (calls >= 3) return Promise.reject(new Error("boom"));
        return Promise.resolve(outputs());
      },
      release: async () => undefined,
    };
    const ort = { Tensor, env: { webgpu: {} } };
    const engine = PhononEngine.forTest(ort as never, session as never, session as never);
    vi.stubGlobal("caches", undefined);
    vi.stubGlobal("fetch", async () => new Response(new Uint8Array(256_000)));
    await expect(engine.speak("Hi there.")).rejects.toThrow(/boom/);
    expect(calls).toBeGreaterThanOrEqual(3);
    await engine.dispose();
    expect(made.length).toBeGreaterThan(0);
    expect(made.filter((item) => !item.disposed)).toEqual([]);
    vi.unstubAllGlobals();
  });
});
