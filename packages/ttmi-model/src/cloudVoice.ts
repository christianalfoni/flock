// Hosted voices for a team's sketches (docs/plan-cloud-voice.md): ElevenLabs,
// said by the function. A voice is named "eleven:<model>:<voice id>", so the
// model and the voice are both part of a clip's key. Kokoro's names never
// start this way.
import { PHONEME_MARK } from "./pronounce";

export const CLOUD_PREFIX = "eleven:";
export const FLASH_MODEL = "eleven_flash_v2_5";
export const V3_MODEL = "eleven_v3";

// Rachel, a premade ElevenLabs voice, until an admin picks another.
export const DEFAULT_VOICE_ID = "21m00Tcm4TlvDq8ikWAM";
export const DEFAULT_CLOUD_MODEL = FLASH_MODEL;

export const CLOUD_MODELS: { id: string; name: string; tier: "standard" | "premium"; usdPerMillion: number }[] = [
  { id: FLASH_MODEL, name: "Flash v2.5", tier: "standard", usdPerMillion: 40 },
  { id: V3_MODEL, name: "v3", tier: "premium", usdPerMillion: 80 },
];

// Premade English voices suited to narration. The id is ElevenLabs's.
export const CLOUD_VOICES: { id: string; name: string }[] = [
  { id: DEFAULT_VOICE_ID, name: "Rachel (US)" },
  { id: "EXAVITQu4vr4xnSDxMaL", name: "Sarah (US)" },
  { id: "pNInz6obpgDQGcFmaJgB", name: "Adam (US)" },
  { id: "nPczCjzI2devNBz1zQrb", name: "Brian (US)" },
  { id: "XB0fDUnXU5powFXDhCwa", name: "Charlotte (US)" },
  { id: "onwK4e9ZLuTAKqWW03F9", name: "Daniel (UK)" },
  { id: "pFZP5JQG7iQjIQuC4Bku", name: "Lily (UK)" },
  { id: "JBFqnCBsd6RMkjVDRZzb", name: "George (UK)" },
];

export const cloudVoice = (model: string, voiceId: string) => `${CLOUD_PREFIX}${model}:${voiceId}`;
export const DEFAULT_CLOUD_VOICE = cloudVoice(DEFAULT_CLOUD_MODEL, DEFAULT_VOICE_ID);

export function parseCloudVoice(voice: string | undefined): { model: string; voiceId: string } | undefined {
  if (!voice?.startsWith(CLOUD_PREFIX)) return undefined;
  const rest = voice.slice(CLOUD_PREFIX.length);
  const head = rest.split("~")[0] ?? rest;
  const split = head.indexOf(":");
  if (split <= 0) return undefined;
  const model = head.slice(0, split);
  const voiceId = head.slice(split + 1);
  if (!CLOUD_MODELS.some((item) => item.id === model) || !voiceId) return undefined;
  return { model, voiceId };
}

export const isCloudVoice = (voice: string | undefined) => Boolean(parseCloudVoice(voice));
export const cloudVoiceId = (voice: string) => parseCloudVoice(voice)?.voiceId ?? "";
export const cloudModelOf = (voice: string) => parseCloudVoice(voice)?.model ?? DEFAULT_CLOUD_MODEL;
export const withCloudModel = (voice: string, model: string) => cloudVoice(model, cloudVoiceId(voice) || DEFAULT_VOICE_ID);

export const usdPerMillion = (model: string) => CLOUD_MODELS.find((item) => item.id === model)?.usdPerMillion ?? CLOUD_MODELS[0]!.usdPerMillion;

// A shared sketch's stored voice, as a board names it to the engine:
// "sketch:<id>|eleven:<model>:<voice>". Its steps come from the function's
// store, made once for every viewer.
const STORED_PREFIX = "sketch:";
export const storedVoiceName = (sketchId: string, voice: string) => `${STORED_PREFIX}${sketchId}|${voice}`;
export const isStoredVoice = (voice: string | undefined) => Boolean(voice?.startsWith(STORED_PREFIX));
export const storedSketchId = (voice: string) => voice.slice(STORED_PREFIX.length).split("|")[0]!;
// Said by the function, not by Kokoro in this browser.
export const isHostedVoice = (voice: string | undefined) => isCloudVoice(voice) || isStoredVoice(voice);

// What the function says for a step at most. Flash takes 40,000; v3 takes
// 5,000. A walkthrough step stays well under both.
export const CLOUD_MAX_CHARS = 1800;

// Default monthly spend for one team's hosted voice, in US dollars.
// VOICE_MONTHLY_USD on the function overrides it; an organization's
// voiceUsdLimit overrides that. At the list rates, $20 is 500,000 Flash
// characters or 250,000 v3 characters.
export const DEFAULT_VOICE_USD_LIMIT = 20;

export function voiceSpendUsd(flashChars: number, v3Chars: number): number {
  return (flashChars * usdPerMillion(FLASH_MODEL) + v3Chars * usdPerMillion(V3_MODEL)) / 1_000_000;
}

// Whether another hosted clip may be made. Once the cap is met, new steps
// are not said by ElevenLabs. A clip already stored still plays.
export function voiceModelChoice(wanted: string, usedUsd: number, capUsd: number): { model: string; reached: boolean } {
  if (usedUsd >= capUsd) return { model: wanted, reached: true };
  return { model: wanted, reached: false };
}

// Voice settings sent to ElevenLabs. Sources, read 2026-10-31:
// - https://elevenlabs.io/docs/api-reference/text-to-speech/convert (VoiceSettings)
// - https://elevenlabs.io/docs/eleven-creative/playground/text-to-speech
//   Speed, similarity and speaker boost are not available for Eleven v3.
//   Style exaggeration is a general setting; their skills guide says it
//   applies to v2 and v3, and recommends leaving it at 0.
// - https://elevenlabs.io/docs/overview/models Flash v2.5: ~100 ms median,
//   32 languages, 40,000 characters. v3: expressive, 70+ languages,
//   5,000 characters, audio tags, multi-speaker dialogue.
// The convert API types stability as a double (default 0.5). v3 is given
// only 0, 0.5 or 1, shown as Creative, Natural and Robust. The playground
// documents a stability slider and does not name those three presets.
export type VoiceTune = {
  stability: number;
  similarityBoost: number;
  style: number;
  speakerBoost: boolean;
  speed: number;
};

export const DEFAULT_TUNE: VoiceTune = { stability: 0.5, similarityBoost: 0.75, style: 0, speakerBoost: true, speed: 1 };

export const V3_STABILITY = [
  { value: 0, name: "Creative" },
  { value: 0.5, name: "Natural" },
  { value: 1, name: "Robust" },
] as const;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export function v3Stability(value: number): number {
  return V3_STABILITY.reduce((best, item) => (Math.abs(item.value - value) < Math.abs(best - value) ? item.value : best), 0.5);
}

// What is stored for the team. Every field is kept, so switching between
// Standard and Premium does not throw the other model's settings away.
export function clampTune(tune: Partial<VoiceTune> | undefined): VoiceTune {
  const stability = typeof tune?.stability === "number" ? tune.stability : DEFAULT_TUNE.stability;
  const similarityBoost = typeof tune?.similarityBoost === "number" ? tune.similarityBoost : DEFAULT_TUNE.similarityBoost;
  const style = typeof tune?.style === "number" ? tune.style : DEFAULT_TUNE.style;
  const speakerBoost = typeof tune?.speakerBoost === "boolean" ? tune.speakerBoost : DEFAULT_TUNE.speakerBoost;
  const speed = typeof tune?.speed === "number" ? tune.speed : DEFAULT_TUNE.speed;
  return {
    stability: clamp(stability, 0, 1),
    similarityBoost: clamp(similarityBoost, 0, 1),
    style: clamp(style, 0, 1),
    speakerBoost,
    speed: clamp(speed, 0.7, 1.2),
  };
}

// What this model is actually given, and what goes in its clip key.
export function effectiveTune(model: string, tune: Partial<VoiceTune> | undefined): VoiceTune {
  const stored = clampTune(tune);
  if (model === V3_MODEL) return { ...stored, stability: v3Stability(stored.stability), similarityBoost: DEFAULT_TUNE.similarityBoost, speakerBoost: false, speed: 1 };
  return stored;
}

// Part of the clip key. Changing a setting the model uses changes the key.
export function tuneSuffix(model: string, tune: Partial<VoiceTune> | undefined): string {
  const t = effectiveTune(model, tune);
  if (model === V3_MODEL) return `st${t.stability.toFixed(1)}|sy${t.style.toFixed(2)}`;
  return `st${t.stability.toFixed(2)}|si${t.similarityBoost.toFixed(2)}|sy${t.style.toFixed(2)}|sb${t.speakerBoost ? 1 : 0}|sp${t.speed.toFixed(2)}`;
}

export function withTune(voice: string, tune: Partial<VoiceTune> | undefined): string {
  const parsed = parseCloudVoice(voice);
  if (!parsed) return voice;
  return `${cloudVoice(parsed.model, parsed.voiceId)}~${tuneSuffix(parsed.model, tune)}`;
}

export function tuneFromVoice(voice: string): VoiceTune {
  const model = cloudModelOf(voice);
  const suffix = voice.split("~")[1];
  if (!suffix) return effectiveTune(model, undefined);
  const parts = Object.fromEntries(suffix.split("|").map((part) => [part.slice(0, 2), part.slice(2)]));
  return effectiveTune(model, {
    ...(parts.st !== undefined ? { stability: Number(parts.st) } : {}),
    ...(parts.si !== undefined ? { similarityBoost: Number(parts.si) } : {}),
    ...(parts.sy !== undefined ? { style: Number(parts.sy) } : {}),
    ...(parts.sb !== undefined ? { speakerBoost: parts.sb === "1" } : {}),
    ...(parts.sp !== undefined ? { speed: Number(parts.sp) } : {}),
  });
}

// A leftover phoneme mark, from a sketch saved while Fix a word existed, is
// said as the written word. Flash and v3 do not take inline IPA.
export function cloudText(text: string): string {
  return text.replace(PHONEME_MARK, (_, word: string) => word);
}
