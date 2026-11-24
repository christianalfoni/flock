import { describe, expect, test } from "vitest";
import { ENGINE, MARK, MARK_MS, OLD_MARK, forgetUnsupported, rememberUnsupported, shouldRememberFailure, unsupportedMark, type MarkStore } from "./mark";

function box(initial: Record<string, string> = {}): MarkStore & { data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    getItem: (key) => data[key] ?? null,
    setItem: (key, value) => {
      data[key] = value;
    },
    removeItem: (key) => {
      delete data[key];
    },
  };
}

const ua = "Mozilla/5.0 Test";

describe("the unsupported mark", () => {
  test("an old user-agent mark is ignored and cleared", () => {
    const store = box({ [OLD_MARK]: ua });
    expect(unsupportedMark(store, ua)).toBe(false);
    expect(store.data[OLD_MARK]).toBeUndefined();
  });

  test("this engine and browser sticks for a few days", () => {
    const now = 1_000_000;
    const store = box();
    rememberUnsupported(store, ua, now);
    expect(unsupportedMark(store, ua, now + MARK_MS - 1)).toBe(true);
    expect(JSON.parse(store.data[MARK]!).engine).toBe(ENGINE);
  });

  test("a different browser, another engine, or an expired mark is cleared", () => {
    const now = 5_000_000;
    const other = box();
    rememberUnsupported(other, "other", now);
    expect(unsupportedMark(other, ua, now)).toBe(false);
    expect(other.data[MARK]).toBeUndefined();

    const stale = box({ [MARK]: JSON.stringify({ ua, engine: "kokoro", at: now }) });
    expect(unsupportedMark(stale, ua, now)).toBe(false);
    expect(stale.data[MARK]).toBeUndefined();

    const old = box();
    rememberUnsupported(old, ua, now - MARK_MS - 1);
    expect(unsupportedMark(old, ua, now)).toBe(false);
    expect(old.data[MARK]).toBeUndefined();
  });

  test("Try again clears it", () => {
    const store = box({ [OLD_MARK]: ua });
    rememberUnsupported(store, ua);
    forgetUnsupported(store);
    expect(unsupportedMark(store, ua)).toBe(false);
    expect(store.data).toEqual({});
  });

  test("only a CPU runtime failure after the engine started is remembered", () => {
    expect(shouldRememberFailure("checking", { state: "unsupported", reason: "no WebAssembly SIMD" })).toBe(false);
    expect(shouldRememberFailure("loading", { state: "unsupported", device: "webgpu", kind: "cpu-runtime", reason: "onnxruntime error 94148184 on webgpu" })).toBe(false);
    expect(shouldRememberFailure("installing", { state: "unsupported", reason: "WebGPU could not run the model (onnxruntime error 12 on webgpu). Running on the CPU." })).toBe(false);
    expect(shouldRememberFailure("loading", { state: "unsupported", device: "wasm", kind: "cpu-runtime", reason: "onnxruntime error 5 on wasm" })).toBe(true);
    expect(shouldRememberFailure("ready", { state: "unsupported", reason: "The voice engine did not start." })).toBe(false);
    expect(shouldRememberFailure("unsupported", { state: "unsupported", device: "wasm", kind: "cpu-runtime", reason: "onnxruntime error 5 on wasm" })).toBe(false);
    expect(shouldRememberFailure("loading", { state: "unsupported", kind: "network", reason: "Could not download the voice model (503)." })).toBe(false);
    expect(shouldRememberFailure("installing", { state: "unsupported", kind: "network", reason: "Failed to fetch" })).toBe(false);
    expect(shouldRememberFailure("ready", { state: "unsupported", reason: "The voice made no sound." })).toBe(false);
    expect(shouldRememberFailure("loading", { state: "unsupported", device: "wasm", reason: "Quota exceeded" })).toBe(false);
  });
});
