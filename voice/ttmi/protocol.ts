// What the pages and the voice engine say to each other (docs/plan-voice.md,
// The voice engine). The engine is one SharedWorker for every tab on the
// origin; each tab is a port.
import { isCloudVoice, isHostedVoice, isStoredVoice, storedSketchId } from "@ttmi/model";
import type { Cue, Segment } from "./cues";
import { SPEAKABLE_REV, type TimedWord } from "./phonon/align";
import { ENGINE_REV } from "./phonon/revision";
import type { Step } from "./pace";

export type { Cue, Segment, Step };
export { isCloudVoice, isHostedVoice, isStoredVoice, storedSketchId };

// Where the engine is. "unsupported" is this visit's: no SharedWorker, no
// WebAssembly SIMD, or a CPU load that failed. A remembered CPU failure
// lasts a few days (src/voice/mark.ts). A WebGPU miss is not one.
export type EngineState = "checking" | "unsupported" | "absent" | "installing" | "installed" | "loading" | "ready";

export type EngineStatus = {
  state: EngineState;
  // Why it is unsupported, or what went wrong last.
  reason?: string;
  // 0..1 while installing.
  progress?: number;
  // How fast this machine makes speech, characters of narration per
  // second of work, once it has made something: the Preparing voice ring
  // estimates with it.
  charsPerSecond?: number;
  // Where the model is running, once it has loaded.
  device?: "webgpu" | "wasm";
  // Why a failure is remembered, or not. A download is "network". The CPU
  // runtime itself failing is "cpu-runtime".
  kind?: "network" | "cpu-runtime";
  // Steps waiting to be made.
  queued: number;
  // The step being made now, by key, since when (Date.now()) and how many
  // characters it has: the step bar fills with it as it is made. The
  // warm-up has no key.
  making?: { key?: string; since: number; chars: number };
};

// A test build swaps Kokoro for a backend that makes silence of the right
// length at a set speed, so the browser tests run without a GPU or a model.
// needsGesture: the page acts as a browser that refuses sound before a click.
// checkMs: how long the engine takes to say whether there is a voice.
// maxChars: a step longer than this is made as if over the model's limit.
// fullLength: clips as long as the words take to say, not a tenth.
export type FakeOptions = { gpu?: boolean; msPerChar?: number; installMs?: number; needsGesture?: boolean; checkMs?: number; maxChars?: number; fullLength?: boolean; holdText?: string; holdMs?: number; hang?: boolean; deadlineMs?: number };

export type ToEngine =
  | { type: "hello"; fake?: FakeOptions }
  | { type: "install" }
  | { type: "load" }
  | { type: "remove" }
  // Forget an unsupported latch and try the voice again. The page has
  // already cleared its remembered failure.
  | { type: "retry" }
  // A step as pieces, the words said about a shape on their own, so the
  // clip comes back with when each is said, with how it is said (its
  // speed, lead-in and holds). urgent: the step on screen, ahead of
  // everything baking.
  // A hosted voice (docs/plan-cloud-voice.md) is said by the function, as
  // the signed-in user: token is their Firebase ID token.
  // sketch: the sketch it is for, so a hosted voice's use is counted.
  | { type: "speak"; key: string; step: Step; voice: string; urgent?: boolean; priority?: number; token?: string; sketch?: string }
  // The page is sounding a clip: for this long nothing new starts but the
  // step on screen, so making speech does not starve the sound. 0 when it
  // ends.
  | { type: "speaking"; ms: number }
  // The clips of the sketch open in this tab, never swept while it is
  // open; said again every few minutes, and [] when it closes.
  | { type: "open"; keys: string[] }
  // Stop making these steps. The one in hand stops at its next pause.
  | { type: "cancel"; keys: string[] }
  // This tab is gone: drop it from every job.
  | { type: "bye" };

export type FromEngine =
  | { type: "status"; status: EngineStatus }
  // truncated: the step was just made and was over the model's limit, so
  // its end is missing; sent to one tab only, which reports it.
  | { type: "clip"; key: string; wav: ArrayBuffer; seconds: number; cues: Cue[]; truncated?: { tokens: number } }
  // Audio made so far, while the clip is still being generated. The pcm
  // buffer is transferred. The finished clip still follows.
  | { type: "audio"; key: string; pcm: ArrayBuffer; sampleRate: number; words: TimedWord[] }
  | { type: "failed"; key: string; reason: string }
  // This engine is an older build than another tab's. The page offers a refresh.
  | { type: "reload" };

// The model and how it runs; part of every clip's key, so a new variant
// makes new clips. Gradium's q8 runtime, word times from its own timings.
// Bumped with ENGINE_REV. The words before a step are not part of the key:
// they are no longer spoken.
export const VARIANT = `phonon-31m-en-blixt-e${ENGINE_REV}-s${SPEAKABLE_REV}`;
export const DEFAULT_VOICE = "miles";

// The listener's voice, on every sketch: a Phonon voice they picked, or
// Miles. A Kokoro name or a hosted name left from an old setting is Miles.
export function narratorVoice(voiceName: string | undefined, _onTeam?: boolean): string {
  if (voiceName && VOICES.some((voice) => voice.id === voiceName)) return voiceName;
  return DEFAULT_VOICE;
}

// What this listener actually hears. Phonon has no blend.
export function effectiveSound<T extends { name: string; speed: number; blend?: string; mix: number }>(sound: T, _onTeam?: boolean): T {
  return { ...sound, name: narratorVoice(sound.name), blend: undefined, mix: 0 };
}
export const VOICES: { id: string; name: string }[] = [
  { id: "miles", name: "Miles (US)" },
  { id: "easton", name: "Easton (US)" },
  { id: "zoey", name: "Zoey (US)" },
  { id: "harper", name: "Harper (US)" },
  { id: "maeve", name: "Maeve (UK)" },
  { id: "hugh", name: "Hugh (UK)" },
];

// Spoken steps live in Cache Storage under a URL made from their key, so
// every tab, and the next visit, finds them.
export const CLIP_CACHE = "ttmi-voice";
export const clipUrl = (key: string) => `https://voice.ttmi.invalid/${key}.wav`;

// A voice, or two blended: "af_heart", or "af_heart+af_bella:0.3" for 30%
// of Bella in Heart's (docs/plan-voice-pacing.md). The language is the
// first voice's.
export type VoiceSpec = { name: string; blend?: string; mix: number };
export const MAX_MIX = 0.5;

export function voiceSpec(name: string, blend?: string, mix = 0): string {
  // A hosted voice is not blended.
  if (isHostedVoice(name)) return name;
  const amount = Math.round(Math.max(0, Math.min(MAX_MIX, mix)) * 100) / 100;
  return blend && blend !== name && amount > 0 ? `${name}+${blend}:${amount}` : name;
}

export function readVoice(spec: string): VoiceSpec {
  const match = /^([a-z]{2}_[a-z]+)(?:\+([a-z]{2}_[a-z]+):([\d.]+))?$/.exec(spec);
  if (!match) return { name: DEFAULT_VOICE, mix: 0 };
  return match[2] ? { name: match[1]!, blend: match[2], mix: Math.min(MAX_MIX, Number(match[3])) } : { name: match[1]!, mix: 0 };
}

// The key names the words, which of them point at what, and how they are
// said.
export async function clipKey(step: Step, voice: string, fake = false): Promise<string> {
  const pieces = step.segments.map((segment) => [segment.text, segment.name ?? "", segment.hold ?? 0]);
  const data = new TextEncoder().encode(`${fake ? "fake" : VARIANT}|${voice}|${step.speed ?? 1}|${step.leadIn ?? 0}|${JSON.stringify(pieces)}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
