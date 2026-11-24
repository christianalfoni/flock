import { describe, expect, test } from "vitest";
import {
  DISMISS_VOICE_GPU,
  DISMISS_VOICE_UPGRADE,
  HAD_PREVIOUS_VOICE,
  hadPreviousVoice,
  isPreviousVoiceCache,
  isPreviousVoiceDatabase,
  isPreviousVoiceStorage,
  planVoiceUpgrade,
  type VoiceLeftovers,
} from "./upgrade";

const empty: VoiceLeftovers = {
  cacheNames: [],
  databaseNames: [],
  storage: [],
  newInstalled: false,
  realGpu: true,
};

describe("a previous voice", () => {
  test("the old weight caches count, and the new voice and the clip cache do not", () => {
    expect(isPreviousVoiceCache("phonon-tts-v1")).toBe(true);
    expect(isPreviousVoiceCache("phonon-model")).toBe(true);
    expect(isPreviousVoiceCache("phonon-webgpu")).toBe(false);
    expect(isPreviousVoiceCache("ttmi-voice")).toBe(false);
    expect(isPreviousVoiceCache("ttmi-voice-fake")).toBe(false);
    expect(isPreviousVoiceCache("kokoro-voices")).toBe(false);
    expect(isPreviousVoiceCache("transformers-cache")).toBe(false);
  });

  test("an old database name counts", () => {
    expect(isPreviousVoiceDatabase("phonon-tts-v1")).toBe(true);
    expect(isPreviousVoiceDatabase("phonon-model")).toBe(true);
    expect(isPreviousVoiceDatabase("onnxruntime")).toBe(true);
    expect(isPreviousVoiceDatabase("firebase-heartbeat-database")).toBe(false);
  });

  test("an install flag or the old engine's versioned mark counts", () => {
    expect(isPreviousVoiceStorage("phonon-tts-installed", "1")).toBe(true);
    expect(isPreviousVoiceStorage(HAD_PREVIOUS_VOICE, "1")).toBe(true);
    expect(isPreviousVoiceStorage(HAD_PREVIOUS_VOICE, null)).toBe(false);
    expect(isPreviousVoiceStorage("ttmi.voice.unsupported.v2", JSON.stringify({ ua: "x", engine: "phonon-ort-1.31", at: 1 }))).toBe(true);
    expect(isPreviousVoiceStorage("ttmi.voice.unsupported.v2", JSON.stringify({ engine: "something-else" }))).toBe(false);
    expect(isPreviousVoiceStorage("notes", "still have model.q8.gguf here")).toBe(true);
    expect(isPreviousVoiceStorage("ttmi.voice.off", "1")).toBe(false);
    expect(isPreviousVoiceStorage("ttmiVoiceSpeed", "80")).toBe(false);
    expect(isPreviousVoiceStorage(DISMISS_VOICE_UPGRADE, "1")).toBe(false);
    expect(isPreviousVoiceStorage(DISMISS_VOICE_GPU, "1")).toBe(false);
  });

  test("nothing stored means they never installed a voice", () => {
    expect(hadPreviousVoice(empty)).toBe(false);
  });
});

describe("the upgrade notice", () => {
  test("a real GPU is asked to install, and the old caches are deleted", () => {
    const plan = planVoiceUpgrade({ ...empty, cacheNames: ["phonon-tts-v1", "ttmi-voice", "kokoro-voices"] }, { upgrade: false, gpu: false });
    expect(plan.notice).toBe("upgrade");
    expect(plan.deleteCaches).toEqual(["phonon-tts-v1"]);
    expect(plan.remember).toBe(true);
    expect(plan.forgetRemembered).toBe(false);
  });

  test("the ONNX cache and an IndexedDB leftover are the same previous voice", () => {
    expect(planVoiceUpgrade({ ...empty, cacheNames: ["phonon-model"] }, { upgrade: false, gpu: false }).notice).toBe("upgrade");
    expect(planVoiceUpgrade({ ...empty, databaseNames: ["onnxruntime"] }, { upgrade: false, gpu: false }).deleteDatabases).toEqual(["onnxruntime"]);
  });

  test("without a real GPU the note is the one about a GPU-capable browser", () => {
    const plan = planVoiceUpgrade({ ...empty, realGpu: false, cacheNames: ["phonon-tts-v1"] }, { upgrade: false, gpu: false });
    expect(plan.notice).toBe("gpu-note");
  });

  test("each dismiss is its own, and a new install shows nothing", () => {
    const had = { ...empty, cacheNames: ["phonon-tts-v1"] };
    expect(planVoiceUpgrade(had, { upgrade: true, gpu: false }).notice).toBe("none");
    expect(planVoiceUpgrade({ ...had, realGpu: false }, { upgrade: false, gpu: true }).notice).toBe("none");
    expect(planVoiceUpgrade({ ...had, realGpu: false }, { upgrade: true, gpu: false }).notice).toBe("gpu-note");
    const installed = planVoiceUpgrade({ ...had, newInstalled: true }, { upgrade: false, gpu: false });
    expect(installed.notice).toBe("none");
    expect(installed.deleteCaches).toEqual(["phonon-tts-v1"]);
    expect(installed.forgetRemembered).toBe(true);
    expect(installed.remember).toBe(false);
  });

  test("a remembered flag still notices after the caches are gone", () => {
    const plan = planVoiceUpgrade({ ...empty, storage: [{ key: HAD_PREVIOUS_VOICE, value: "1" }] }, { upgrade: false, gpu: false });
    expect(plan.notice).toBe("upgrade");
    expect(plan.deleteCaches).toEqual([]);
  });

  test("kokoro and the spoken-clip cache are not a previous voice", () => {
    const plan = planVoiceUpgrade({ ...empty, cacheNames: ["kokoro-voices", "transformers-cache", "ttmi-voice", "ttmi-g2p"] }, { upgrade: false, gpu: false });
    expect(plan.notice).toBe("none");
    expect(plan.deleteCaches).toEqual([]);
  });
});
