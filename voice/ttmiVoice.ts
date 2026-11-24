// TTMI's voice as Flock uses it: the narration of a canvas's walkthrough,
// made on this machine (Phonon on WebGPU, in a shared worker) and kept in
// step with TTMI's board. Taken in place from the TTMI checkout beside this
// one; its imports from TTMI's web app go to Flock's stand-ins
// (electron.vite.config.ts, src/renderer/ttmiVoiceStubs.ts). Flock imports
// it as "ttmi-voice", typed by src/renderer/ttmiVoice.d.ts, so TypeScript
// does not follow it into TTMI's web app.
export { useNarration } from "./ttmi/useNarration";
export { stepLoads } from "./ttmi/pace";
export { pausePlayback, pausedClip, resumePlayback, stop as stopPlayback, unlockPlayback } from "./ttmi/player";
export { useVoiceStatus, voice } from "./ttmi/client";
export { DEFAULT_VOICE, narratorVoice, VOICES } from "./ttmi/protocol";
export { speakStep } from "./ttmi/speak";
export { watchStream } from "./ttmi/stream";
