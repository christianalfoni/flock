// How the voice sounds to this viewer (docs/plan-voice-pacing.md): their
// voice, their speed on top of the pacing, and a second voice blended in.
// The Voice page sets it, and plays its words with it.
import { useEffect, useState } from "react";
import { watchBoardSettings } from "../settings";
import { voice } from "./client";
import { paceStep } from "./pace";
import { DEFAULT_VOICE, isHostedVoice, voiceSpec, type EngineState, type Segment } from "./protocol";

export type Sound = { name: string; speed: number; blend?: string; mix: number };
export const DEFAULT_SOUND: Sound = { name: DEFAULT_VOICE, speed: 1, mix: 0 };
export { effectiveSound } from "./protocol";

// The viewer's sound as stored, and a setter for what is on screen.
export function useSound(uid: string): [Sound, (sound: Sound) => void] {
  const [sound, setSound] = useState<Sound>(DEFAULT_SOUND);
  useEffect(() => (uid ? watchBoardSettings(uid, (settings) => setSound({
    name: settings.voiceName || DEFAULT_VOICE,
    speed: settings.voiceSpeed ?? 1,
    ...(settings.voiceBlend ? { blend: settings.voiceBlend } : {}),
    mix: settings.voiceMix ?? 0,
  })) : undefined), [uid]);
  return [sound, setSound];
}

// Anything installed can be played: a voice that is not loaded yet loads
// for the first thing asked of it, and the button shows the wait.
export const canSpeak = (state: EngineState) => state === "installed" || state === "loading" || state === "ready";

// Said as an ordinary step of a board would be, with the viewer's sound.
export async function speak(segments: Segment[], sound: Sound) {
  if (voice().status.state === "installed" && !isHostedVoice(sound.name)) voice().load();
  window.ttmiVoiceSpoken?.push(segments.map((segment) => segment.text).join(""));
  const step = paceStep(segments, { fresh: new Map(), load: 1, first: false });
  // The reader asked to hear this sentence, so it may play while it is made.
  return voice().clip({ ...step, leadIn: 0 }, voiceSpec(sound.name, sound.blend, sound.mix), true, undefined, undefined, true);
}
