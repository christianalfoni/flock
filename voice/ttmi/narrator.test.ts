// Whose voice a listener hears. The same Phonon voice on every sketch.
// A hosted name, or a Kokoro name from an old setting, is not used.
import { cloudVoice, DEFAULT_CLOUD_VOICE, FLASH_MODEL } from "@ttmi/model";
import { describe, expect, test } from "vitest";
import { effectiveSound, narratorVoice } from "./protocol";

type Sound = { name: string; speed: number; blend?: string; mix: number };

const phonon: Sound = { name: "hugh", speed: 0.9, blend: "miles", mix: 0.3 };
const hosted: Sound = { name: cloudVoice(FLASH_MODEL, "JBFqnCBsd6RMkjVDRZzb"), speed: 1.1, mix: 0 };

describe("the narrator", () => {
  test("a team does not change the listener's voice", () => {
    expect(narratorVoice(undefined, true)).toBe("miles");
    expect(narratorVoice("hugh", true)).toBe("hugh");
    expect(narratorVoice("bm_george", true)).toBe("miles");
    expect(narratorVoice(hosted.name, true)).toBe("miles");
    expect(effectiveSound(phonon, true)).toEqual({ name: "hugh", speed: 0.9, blend: undefined, mix: 0 });
    expect(effectiveSound(hosted, true)).toEqual({ name: "miles", speed: 1.1, blend: undefined, mix: 0 });
  });

  test("a hosted voice left behind is not used", () => {
    expect(narratorVoice(undefined, false)).toBe("miles");
    expect(narratorVoice("hugh", false)).toBe("hugh");
    expect(narratorVoice("af_heart", false)).toBe("miles");
    expect(narratorVoice(DEFAULT_CLOUD_VOICE, false)).toBe("miles");
    expect(effectiveSound(phonon, false)).toEqual({ name: "hugh", speed: 0.9, blend: undefined, mix: 0 });
    expect(effectiveSound(hosted, false)).toEqual({ name: "miles", speed: 1.1, blend: undefined, mix: 0 });
  });
});
