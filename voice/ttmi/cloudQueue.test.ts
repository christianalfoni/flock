import { cloudVoice, DEFAULT_TUNE, DEFAULT_VOICE_USD_LIMIT, FLASH_MODEL, V3_MODEL, voiceModelChoice, voiceSpendUsd, withTune } from "@ttmi/model";
import { describe, expect, it } from "vitest";
import { cloudRank, placeCloudJob } from "./cloudQueue";

describe("the hosted queue", () => {
  it("plays the step on screen first, then the next, then the rest", () => {
    let order: { key: string; rank: number }[] = [];
    order = placeCloudJob(order, "later-a", cloudRank("later", false));
    order = placeCloudJob(order, "later-b", cloudRank("later", false));
    order = placeCloudJob(order, "next", cloudRank("next", false));
    order = placeCloudJob(order, "now", cloudRank("now", true));
    order = placeCloudJob(order, "next", cloudRank("next", false));
    expect(order.map((item) => item.key)).toEqual(["now", "next", "later-a", "later-b"]);
  });
});

describe("the monthly voice budget", () => {
  it("stops once the cap is met, and a setting change is a different clip", () => {
    expect(voiceSpendUsd(1_000_000, 0)).toBe(40);
    expect(voiceSpendUsd(0, 1_000_000)).toBe(80);
    expect(DEFAULT_VOICE_USD_LIMIT).toBe(20);
    expect(voiceModelChoice(V3_MODEL, 0, 20)).toEqual({ model: V3_MODEL, reached: false });
    expect(voiceModelChoice(V3_MODEL, 19.99, 20)).toEqual({ model: V3_MODEL, reached: false });
    expect(voiceModelChoice(FLASH_MODEL, 20, 20)).toEqual({ model: FLASH_MODEL, reached: true });
    expect(cloudVoice(FLASH_MODEL, "21m00Tcm4TlvDq8ikWAM")).toBe("eleven:eleven_flash_v2_5:21m00Tcm4TlvDq8ikWAM");
    const flash = cloudVoice(FLASH_MODEL, "21m00Tcm4TlvDq8ikWAM");
    expect(withTune(flash, DEFAULT_TUNE)).not.toBe(withTune(flash, { ...DEFAULT_TUNE, speed: 0.9 }));
    const premium = cloudVoice(V3_MODEL, "21m00Tcm4TlvDq8ikWAM");
    expect(withTune(premium, { ...DEFAULT_TUNE, stability: 0.2, speed: 0.7 })).toBe(withTune(premium, { ...DEFAULT_TUNE, stability: 0, speed: 1.2 }));
    expect(withTune(premium, DEFAULT_TUNE)).not.toBe(withTune(premium, { ...DEFAULT_TUNE, style: 0.4 }));
  });
});
