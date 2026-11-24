// The voice lab's comparison list (docs/tts-models.md). The board does not
// read this: a team's sketches call Flash v2.5 or v3. A lab request naming
// an id that is not here is refused. Prices are US dollars per million
// characters of input text, as read on 31 October 2026.

export const FRONT_PAGE_WALKTHROUGH_CHARS = 1064;

export type TtsPriceKind = "list" | "free";
// free: Kokoro, in the browser. standard: Flash v2.5, what a team hears
// unless an admin picks premium. premium: ElevenLabs v3.
export type TtsTier = "free" | "standard" | "premium";

export type TtsLabModel = {
  id: string;
  tier: TtsTier;
  provider: string;
  providerName: string;
  name: string;
  // What the provider's API calls the model. Kokoro has none.
  apiModel: string;
  voiceId: string;
  voiceName: string;
  // Every one of these must be set or the row has no key. Kokoro has none.
  env: readonly string[];
  usdPerMillion?: number;
  priceKind: TtsPriceKind;
  priceNote: string;
  // A published time-to-first-audio, in milliseconds, when they print one.
  ttfbClaimMs?: number;
  ttfbClaim?: string;
  note?: string;
};

export const TTS_LAB_MODELS: readonly TtsLabModel[] = [
  {
    id: "kokoro",
    tier: "free",
    provider: "kokoro",
    providerName: "Kokoro",
    name: "82M, in the browser",
    apiModel: "",
    voiceId: "",
    voiceName: "The voice picked on this page",
    env: [],
    usdPerMillion: 0,
    priceKind: "free",
    priceNote: "Runs on the visitor's machine. Nothing is billed.",
    note: "The free baseline. A different voice from every hosted row.",
  },
  {
    id: "elevenlabs:eleven_flash_v2_5",
    tier: "standard",
    provider: "elevenlabs",
    providerName: "ElevenLabs",
    name: "Flash v2.5",
    apiModel: "eleven_flash_v2_5",
    voiceId: "21m00Tcm4TlvDq8ikWAM",
    voiceName: "Rachel",
    env: ["ELEVENLABS_API_KEY"],
    usdPerMillion: 40,
    priceKind: "list",
    priceNote: "API rate, $0.04 per 1,000 characters. What a team's sketches say unless an admin picks v3.",
    ttfbClaimMs: 100,
    ttfbClaim: "~100 ms median",
    note: "32 languages. The standard hosted voice.",
  },
  {
    id: "elevenlabs:eleven_v3",
    tier: "premium",
    provider: "elevenlabs",
    providerName: "ElevenLabs",
    name: "v3",
    apiModel: "eleven_v3",
    voiceId: "21m00Tcm4TlvDq8ikWAM",
    voiceName: "Rachel",
    env: ["ELEVENLABS_API_KEY"],
    usdPerMillion: 80,
    priceKind: "list",
    priceNote: "API rate, $0.08 per 1,000 characters.",
    note: "70+ languages. The premium hosted voice. 5,000 characters a request.",
  },
];

export function ttsLabModel(id: string): TtsLabModel | undefined {
  return TTS_LAB_MODELS.find((model) => model.id === id);
}

// Kokoro is drawn in the browser. Everything else is a server adapter.
export const serverLabModels = () => TTS_LAB_MODELS.filter((model) => model.provider !== "kokoro");

export function ttsCostUsd(chars: number, usdPerMillion: number): number {
  return (chars * usdPerMillion) / 1_000_000;
}

// What 1,000 syntheses of the front-page walkthrough cost, at one rate.
export function walksCostUsd(usdPerMillion: number, walks = 1000): number {
  return ttsCostUsd(FRONT_PAGE_WALKTHROUGH_CHARS * walks, usdPerMillion);
}
