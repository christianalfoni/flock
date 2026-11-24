import { describe, expect, test } from "vitest";
import { VOICE_GPU_REASON } from "./gpu";
import { ENGINE_REV } from "./phonon/revision";

describe("the GPU reason", () => {
  test("names the voice revision", () => {
    expect(VOICE_GPU_REASON).toBe(`Voice needs a GPU-capable browser (voice ${ENGINE_REV}).`);
  });
});
