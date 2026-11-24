// Phonon 31m voices (Apache 2.0), the six the Voice page offers. The files
// are the raw voice latents published with the ONNX checkpoint. The revision
// is pinned so a new upload cannot change the voice under a visit.

export const PHONON_REVISION = "4f0cda7c60dddb4862d0e68ff9ff60c32ffdc9f4";
export const PHONON_REPO = `https://huggingface.co/onnx-community/phonon-31m-en-ONNX/resolve/${PHONON_REVISION}`;
export const MODEL_CACHE = "phonon-model";
export const FLOW_BYTES = 26_073_088;
export const MIMI_BYTES = 41_267_821;
export const FLOW_DATA_URL = `${PHONON_REPO}/onnx/flow_lm_q4.onnx_data`;
export const MIMI_URL = `${PHONON_REPO}/onnx/mimi_decoder_q4.onnx`;

// Both weight files, the same check the engine uses before it says the voice
// is installed. A cache of only the decoder is not enough.
export async function phononModelsCached(): Promise<boolean> {
  if (typeof caches === "undefined") return false;
  try {
    const cache = await caches.open(MODEL_CACHE);
    return Boolean((await cache.match(FLOW_DATA_URL)) && (await cache.match(MIMI_URL)));
  } catch {
    return false;
  }
}

export const PHONON_VOICE_FILES: Record<string, string> = {
  miles: "d9XCyhjo4JhkHF1d.bin",
  easton: "LMDIYE0Oa377Qh6Z.bin",
  zoey: "NbpkqMVS3CJeq2j8.bin",
  harper: "4SZHfMpw-p46Ywgs.bin",
  maeve: "6PWnV0Nq4wu7RVBT.bin",
  hugh: "YyKcxPG7iIgS3jsK.bin",
};

export const voiceUrl = (id: string) => `${PHONON_REPO}/voices/${PHONON_VOICE_FILES[id] ?? PHONON_VOICE_FILES.miles}`;
