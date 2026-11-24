// The clip cache is named by this revision. Changing what Phonon hears, or
// how fast, without moving ENGINE_REV (and the recorded snapshot) fails here.
import { describe, expect, test } from "vitest";
import { cacheRevision } from "./revision";

const RECORDED = {
  engine: 11,
  speakable: 2,
  durationAtOne: 0,
  spoken: "a picture instead -- one you can play.",
  lexicon: "",
  temperature: 0.3,
  seed: 0x70686f6e,
  chunkFrames: 4,
};

describe("the clip cache revision", () => {
  test("records the text Gradium is given, at its own duration", () => {
    expect(cacheRevision()).toEqual(RECORDED);
  });
});
