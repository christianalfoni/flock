// The part of TTMI's voice the canvas uses (voice/ttmiVoice.ts), typed here
// so TypeScript does not follow the voice into TTMI's web app.
declare module "ttmi-voices" {
  // TTMI's voices, by id ("miles"), with a name to show ("Miles (US)").
  export const VOICES: { id: string; name: string }[];
  export const DEFAULT_VOICE: string;
}

declare module "ttmi-voice" {
  import type { NarrationPart, Shape, SketchGroup, SketchStep } from "@ttmi/format";

  export type StepLoad = { fresh: Map<string, unknown>; load: number; first: boolean };
  export type EngineState = "checking" | "unsupported" | "absent" | "installing" | "installed" | "loading" | "ready";
  export type EngineStatus = { state: EngineState; reason?: string; progress?: number };

  export type Preparation = {
    phase: "loading" | "making" | "celebrating" | "done";
    playing: boolean;
    progress(): number;
  };

  export type Narration = {
    status: { state: EngineState; reason?: string };
    on: boolean;
    muted: boolean;
    made: boolean[];
    preparation?: Preparation;
    waiting(step: number): boolean;
    stepPreparation: Preparation;
    speaking: boolean;
    sounding?: number;
    needsGesture: boolean;
    press(step: number | undefined): void;
    pointing?: string;
    introducing: boolean;
    fill(step: number): { said?: number };
  };

  export function useNarration(input: {
    parts: NarrationPart[][];
    loads?: StepLoad[];
    speed?: number;
    playing: number | undefined;
    voiceName?: string;
    sketchId?: string;
    muted: boolean;
    enabled: boolean;
    hold?: { current: boolean };
    kick?: number;
    onEnded?(step: number): void;
  }): Narration;

  export function stepLoads(shapes: Shape[], steps: SketchStep[], groups?: SketchGroup[]): StepLoad[];
  export function pausePlayback(): void;
  export function pausedClip(): unknown;
  export function resumePlayback(): void;
  // Everything sounding stops: a clip, and a step still being streamed.
  export function stopPlayback(): void;
  // The streamed voice (the first time a step is made): told when it starts
  // sounding and when it ends.
  export function watchStream(listener: (snap: { playing: boolean; ended: boolean }) => void): () => void;
  export function unlockPlayback(): void;
  export type Clip = { url: string; cues: { name: string; at: number }[] };
  export function voice(): {
    install(): void;
    status: EngineStatus;
    clip(step: { segments: { text: string }[] }, voice: string, urgent?: boolean, sketch?: string): Promise<Clip>;
  };
  export function speakStep(clip: Promise<Clip>, text: string, on: {
    speaking(): void;
    needsGesture(): void;
    pointing(name: string): void;
    heard(): void;
    ended(): void;
    failed(): void;
  }): () => void;
  export function useVoiceStatus(enabled?: boolean, voiceName?: string): EngineStatus;
  export const DEFAULT_VOICE: string;
  export const VOICES: { id: string; name: string }[];
  export function narratorVoice(voiceName: string | undefined, onTeam?: boolean): string;
}
declare module "*.svg" { const url: string; export default url; }
