// How fast a walkthrough is heard. The button on a sketch cycles 1×, 1.25×,
// 1.5×, 2× and is remembered in this browser. The Voice page's speed is the
// listener's own adjustment (0.8× to 1.2×, default 1×) and multiplies it.
// Both are playback only: the clip Gradium made is unchanged, the pitch
// stays, and the highlight clock follows the original timeline.
import { useEffect, useState } from "react";
import { setPlaybackRate } from "./player";

export const PLAYBACK_SPEEDS = [1, 1.25, 1.5, 2] as const;
export type PlaybackSpeed = (typeof PLAYBACK_SPEEDS)[number];

const KEY = "ttmi.playback.speed";

export function nextPlaybackSpeed(speed: PlaybackSpeed): PlaybackSpeed {
  const index = PLAYBACK_SPEEDS.indexOf(speed);
  return PLAYBACK_SPEEDS[(index + 1) % PLAYBACK_SPEEDS.length] ?? 1;
}

// What the player actually runs at. 1× on the button with the adjustment
// left at 1 is Gradium's own pace.
export function heardRate(button: number, voiceAdjust = 1): number {
  const pace = Math.min(1.2, Math.max(0.8, Number.isFinite(voiceAdjust) ? voiceAdjust : 1));
  return button * pace;
}

export function readPlaybackSpeed(): PlaybackSpeed {
  try {
    const rate = Number(localStorage.getItem(KEY));
    if ((PLAYBACK_SPEEDS as readonly number[]).includes(rate)) return rate as PlaybackSpeed;
  } catch {
    // Private windows keep the choice for this visit only.
  }
  return 1;
}

function remember(rate: PlaybackSpeed) {
  try {
    localStorage.setItem(KEY, String(rate));
  } catch {
    // The choice still applies until the tab closes.
  }
}

let button: PlaybackSpeed = readPlaybackSpeed();
let adjust = 1;

function apply() {
  setPlaybackRate(heardRate(button, adjust));
}

// The Voice page's adjustment. It survives moving to a sketch in this tab,
// and a sketch applies the saved one when its settings arrive.
export function setVoicePlaybackAdjust(next: number) {
  adjust = Math.min(1.2, Math.max(0.8, Number.isFinite(next) ? next : 1));
  apply();
}

export function browserUtterance(text: string): SpeechSynthesisUtterance | undefined {
  if (typeof SpeechSynthesisUtterance === "undefined") return undefined;
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = heardRate(button, adjust);
  return utterance;
}

export function usePlaybackSpeed(): [PlaybackSpeed, (next: PlaybackSpeed) => void] {
  const [speed, setSpeed] = useState<PlaybackSpeed>(readPlaybackSpeed);
  useEffect(() => {
    button = speed;
    apply();
  }, [speed]);
  const choose = (next: PlaybackSpeed) => {
    button = next;
    apply();
    remember(next);
    setSpeed(next);
  };
  return [speed, choose];
}

function label(rate: number): string {
  return `${rate}×`;
}

export function PlaybackSpeedControl({ speed, onChange }: { speed: PlaybackSpeed; onChange(next: PlaybackSpeed): void }) {
  const next = nextPlaybackSpeed(speed);
  return (
    <div className="sketch-speed" data-rate={speed}>
      <button type="button" aria-label={`Playback speed ${label(speed)}, then ${label(next)}`} onClick={() => onChange(next)}>
        {label(speed)}
      </button>
    </div>
  );
}
