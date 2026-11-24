// What the listening page (/voice-patches) says for each patched word: two
// sentences, one for each reading, heard before and after the patch with
// the real voice. The owner approves a patch by ear (g2p/lexicon.ts,
// PATCHES and PROPOSED). The last few are no patch but the tagger's
// context rules (g2p/tagger.ts), heard the same way.
export type PatchSentence = { word: string; reading: string; sentence: string };

export const PATCH_SENTENCES: PatchSentence[] = [
  { word: "update", reading: "VERB", sentence: "We will update the sketch when you save." },
  { word: "update", reading: "DEFAULT", sentence: "The last update wins." },
  { word: "updated", reading: "", sentence: "The agent updated the board." },
  { word: "export", reading: "VERB", sentence: "Export the sketch as a picture." },
  { word: "export", reading: "DEFAULT", sentence: "An export runs every night." },
  { word: "content", reading: "DEFAULT", sentence: "Updates to content are saved." },
  { word: "content", reading: "DEFAULT", sentence: "Show new content." },
  { word: "content", reading: "ADJ", sentence: "The user is content with the result." },
  { word: "transfer", reading: "VERB", sentence: "We transfer the file to the server." },
  { word: "transfer", reading: "DEFAULT", sentence: "The transfer takes a second." },
  { word: "upgrade", reading: "VERB", sentence: "Upgrade the plan to Team." },
  { word: "upgrade", reading: "DEFAULT", sentence: "The upgrade adds seats." },
  { word: "downgrade", reading: "VERB", sentence: "You can downgrade the plan." },
  { word: "downgrade", reading: "DEFAULT", sentence: "A downgrade keeps every sketch." },
  { word: "reset", reading: "DEFAULT", sentence: "Reset the password." },
  { word: "reset", reading: "NOUN", sentence: "A reset clears the cache." },
  { word: "read", reading: "VBN", sentence: "The data had been read." },
  { word: "compress", reading: "DEFAULT", sentence: "Compress the file first." },
  { word: "contract", reading: "DEFAULT", sentence: "Each contract renews." },
  { word: "content", reading: "DEFAULT", sentence: "Fetch content first." },
];
