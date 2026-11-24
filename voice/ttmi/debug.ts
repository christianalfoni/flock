// The voice's own log, for a viewer chasing a playback bug: off unless
// localStorage.ttmiVoiceDebug is set, then every step change, clip, play
// and stop goes to the console with the time since the page opened. A stop
// says who called it.
let on: boolean | undefined;
const enabled = () => {
  if (on === undefined) {
    try {
      on = typeof localStorage !== "undefined" && Boolean(localStorage.getItem("ttmiVoiceDebug"));
    } catch {
      on = false;
    }
  }
  return on;
};

export function voiceDebug(event: string, ...details: unknown[]) {
  if (!enabled()) return;
  console.log(`[ttmi voice ${(performance.now() / 1000).toFixed(3)}s] ${event}`, ...details);
}

// The same, with where it was called from.
export function voiceDebugTrace(event: string, ...details: unknown[]) {
  if (!enabled()) return;
  console.groupCollapsed(`[ttmi voice ${(performance.now() / 1000).toFixed(3)}s] ${event}`, ...details);
  console.trace();
  console.groupEnd();
}
