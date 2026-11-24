import { describe, expect, test } from "vitest";
import { describeOrtError } from "./support";

describe("onnxruntime errors", () => {
  test("a bare wasm pointer becomes a sentence naming the device", () => {
    expect(describeOrtError(94148184, "webgpu")).toBe("onnxruntime error 94148184 on webgpu");
    expect(describeOrtError(new Error("94148184"), "wasm")).toBe("onnxruntime error 94148184 on wasm");
  });

  test("a real message is kept", () => {
    expect(describeOrtError(new Error("no WebGPU adapter"), "webgpu")).toBe("no WebGPU adapter");
  });
});
