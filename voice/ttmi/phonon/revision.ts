// What a stored clip was made with. The clip key and the demo key name the
// variant; this is the part of that variant that moves when the voice
// itself changes. `ENGINE_REV` is the hand bump. The rest is recorded so a
// change to the text Gradium is given fails a test until the revision moves
// with it. Duration stays at Gradium's own default.
import { modelText, SPEAKABLE_REV } from "./align";

// 11: blixt/phonon 36e7e5ef. Word times come from its live WordTimes path,
// and the engine is the shared graph. Pace stays the model's own.
export const ENGINE_REV = 11;
export const SPEAK_TEMPERATURE = 0.3;
export const SPEAK_SEED = 0x70686f6e;
// The first flow frame is decoded alone, then two, then this many.
export const CHUNK_FRAMES = 4;

const SPOKEN_SAMPLE = "a picture instead -- one you can play";

export function cacheRevision() {
  return {
    engine: ENGINE_REV,
    speakable: SPEAKABLE_REV,
    // Gradium's own duration. The pace slider used to retune the model.
    durationAtOne: 0,
    spoken: modelText(SPOKEN_SAMPLE),
    // Not applied. "ttmi" is said as written; capitals are the model's own.
    lexicon: "",
    temperature: SPEAK_TEMPERATURE,
    seed: SPEAK_SEED,
    chunkFrames: CHUNK_FRAMES,
  };
}
