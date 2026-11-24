// The board's one small sound (docs/plan-voice.md, Playback): a rising
// chime when the walkthrough's voice is ready. A step said to its end turns
// its segment green instead of ticking (2026-10-22: the tick annoyed).
// Made with Web Audio, nothing to load. Browsers allow sound only after
// the page's first click or key, so the chime before one is not heard.

let context: AudioContext | undefined;

function audio(): AudioContext | undefined {
  if (typeof window === "undefined" || typeof AudioContext !== "function") return undefined;
  try {
    return (context ??= new AudioContext());
  } catch {
    return undefined;
  }
}

if (typeof window !== "undefined") {
  const wake = () => void audio()?.resume().catch(() => {});
  for (const type of ["pointerdown", "keydown"] as const) window.addEventListener(type, wake, { capture: true });
}

// One soft bell-like note: a sine with a quick rise and a long fall.
function note(ctx: AudioContext, frequency: number, at: number, length: number, volume: number) {
  const oscillator = ctx.createOscillator();
  const gain = ctx.createGain();
  oscillator.type = "sine";
  oscillator.frequency.value = frequency;
  gain.gain.setValueAtTime(0, at);
  gain.gain.linearRampToValueAtTime(volume, at + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + length);
  oscillator.connect(gain).connect(ctx.destination);
  oscillator.start(at);
  oscillator.stop(at + length + 0.05);
}

function play(name: "step" | "ready", notes: [frequency: number, offset: number, length: number, volume: number][]) {
  window.ttmiVoiceLog?.push(`chime:${name}`);
  const ctx = audio();
  if (!ctx || ctx.state !== "running") return;
  const now = ctx.currentTime;
  for (const [frequency, offset, length, volume] of notes) note(ctx, frequency, now + offset, length, volume);
}

// The walkthrough's voice is made: three notes rising (C, E, G).
export const voiceReady = () => play("ready", [[1046.5, 0, 0.5, 0.06], [1318.5, 0.09, 0.5, 0.06], [1568, 0.18, 0.8, 0.07]]);
