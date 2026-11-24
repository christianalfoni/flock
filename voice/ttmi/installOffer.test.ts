import { describe, expect, it } from "vitest";
import { voiceBoardAsk, voiceLoadPhase, voiceNeedsInstall } from "./installOffer";

describe("the voice install panel", () => {
  it("stays closed while a sketch is loading, and while a cached voice loads", () => {
    // The stand-in before narration is on has no reason.
    expect(voiceNeedsInstall({ state: "unsupported" })).toBe(false);
    expect(voiceNeedsInstall({ state: "unsupported", reason: "This browser gives no GPU to background workers." })).toBe(true);
    expect(voiceNeedsInstall({ state: "absent" })).toBe(true);
    expect(voiceNeedsInstall({ state: "installing" })).toBe(true);
    expect(voiceNeedsInstall({ state: "loading" })).toBe(false);
    expect(voiceNeedsInstall({ state: "installed" })).toBe(false);
    expect(voiceNeedsInstall({ state: "ready" })).toBe(false);
    expect(voiceNeedsInstall({ state: "checking" })).toBe(false);

    // Decided once, including for a progress report from the cache.
    expect(voiceLoadPhase(true, "absent")).toBe("installing");
    expect(voiceLoadPhase(true, "installed")).toBe("loading");
    expect(voiceLoadPhase(false, "installed")).toBe("loading");
    expect(voiceLoadPhase(false, "absent")).toBe("loading");
  });
});

describe("the centered voice ask", () => {
  const absent = { state: "absent" };

  it("asks to install only when this browser can have the voice and it is not muted", () => {
    expect(voiceBoardAsk({ status: absent, muted: false, upgrade: "none" })).toBe("install");
    expect(voiceBoardAsk({ status: absent, muted: true, upgrade: "none" })).toBe("none");
    expect(voiceBoardAsk({ status: { state: "unsupported", reason: "Voice needs a GPU-capable browser." }, muted: false, upgrade: "none" })).toBe("none");
    expect(voiceBoardAsk({ status: { state: "unsupported" }, muted: false, upgrade: "none" })).toBe("none");
    expect(voiceBoardAsk({ status: { state: "checking" }, muted: false, upgrade: "none" })).toBe("none");
    expect(voiceBoardAsk({ status: { state: "loading" }, muted: false, upgrade: "none" })).toBe("none");
    expect(voiceBoardAsk({ status: { state: "ready" }, muted: false, upgrade: "none" })).toBe("none");
    expect(voiceBoardAsk({ status: absent, muted: false, upgrade: "checking" })).toBe("none");
  });

  it("gives the upgrade note the same slot, and muting clears an install ask", () => {
    expect(voiceBoardAsk({ status: absent, muted: false, upgrade: "upgrade" })).toBe("upgrade");
    expect(voiceBoardAsk({ status: absent, muted: true, upgrade: "upgrade" })).toBe("none");
    expect(voiceBoardAsk({ status: { state: "unsupported", reason: "Voice needs a GPU-capable browser." }, muted: false, upgrade: "gpu-note" })).toBe("gpu-note");
    expect(voiceBoardAsk({ status: { state: "unsupported" }, muted: true, upgrade: "gpu-note" })).toBe("gpu-note");
  });
});
