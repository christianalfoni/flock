// What TTMI's voice (used in place from the TTMI checkout beside this one,
// apps/web/src/voice) imports from its web app, as Flock has it: no
// analytics, no account (hosted cloud voices need one; Flock uses the
// voice that runs on this machine), one build, and no old engine to
// remove. electron.vite.config.ts points those imports here.

// ../analytics
export function track(..._args: unknown[]) {}

// ../firebase: only asked for a signed-in user's token, for hosted voices.
export const firebase = () => ({ auth: { currentUser: undefined as undefined | { getIdToken(): Promise<string> } } });

// ../build: which build a voice engine came from, to retire an older one.
export const BUILD_ID = "flock";

// ./phonon/runtime (engine.worker.ts, removing the voice): the engine
// before Phonon on WebGPU, which Flock never had.
export async function removePhonon() {}
