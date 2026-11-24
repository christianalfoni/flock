// TTMI's voice as Flock uses it: the narration of a canvas's walkthrough,
// made on this machine (Phonon on WebGPU, in a shared worker) and kept in
// step with TTMI's board. Taken in place from the TTMI checkout beside this
// one; its imports from TTMI's web app go to Flock's stand-ins
// (electron.vite.config.ts, src/renderer/ttmiVoiceStubs.ts). Flock imports
// it as "ttmi-voice", typed by src/renderer/ttmiVoice.d.ts, so TypeScript
// does not follow it into TTMI's web app.
export { useNarration } from "../../ttmi/apps/web/src/voice/useNarration";
export { stepLoads } from "../../ttmi/apps/web/src/voice/pace";
export { pausePlayback, pausedClip, resumePlayback, stop as stopPlayback, unlockPlayback } from "../../ttmi/apps/web/src/voice/player";
export { useVoiceStatus, voice } from "../../ttmi/apps/web/src/voice/client";
export { DEFAULT_VOICE, narratorVoice, VOICES } from "../../ttmi/apps/web/src/voice/protocol";
export { speakStep } from "../../ttmi/apps/web/src/voice/speak";
export { watchStream } from "../../ttmi/apps/web/src/voice/stream";
