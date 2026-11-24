import type { EngineState } from "./protocol";
import type { VoiceUpgradeKind } from "./upgrade";

// The install panel. An "unsupported" with no reason is the stand-in before
// narration is on (the sketch still loading), not the engine's answer; it
// opened the panel for a moment on every reload.
export function voiceNeedsInstall(status: { state: string; reason?: string }): boolean {
  return status.state === "absent" || status.state === "installing" || (status.state === "unsupported" && Boolean(status.reason));
}

// What the ready caption shows in place of Play, in the slot that says
// "Loading voice" while the model comes in. One shared mute (the board's
// voiceOff) hides the install ask and the walkthrough plays on its words.
// No GPU is captions only: nothing asks to install. The upgrade note for
// someone who had the old voice uses the same slot.
export type VoiceBoardAsk = "install" | "upgrade" | "gpu-note" | "none";

export function voiceBoardAsk(input: {
  status: { state: string; reason?: string };
  muted: boolean;
  upgrade: VoiceUpgradeKind | "checking";
}): VoiceBoardAsk {
  if (input.upgrade === "gpu-note") return "gpu-note";
  if (input.muted || input.upgrade === "checking") return "none";
  if (input.upgrade === "upgrade") return "upgrade";
  if (input.status.state === "absent") return "install";
  return "none";
}

// A cached model reports progress too (the cache read). Only a real
// download is "installing"; a load from the cache stays "loading", or the
// install panel opens on every reload.
export function voiceLoadPhase(install: boolean, state: EngineState): "installing" | "loading" {
  return install && state === "absent" ? "installing" : "loading";
}
