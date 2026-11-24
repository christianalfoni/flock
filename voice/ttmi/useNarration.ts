// A board's spoken walkthrough (docs/plan-voice.md, The board and Playback):
// the model loads when a sketch with steps opens and the steps are made in
// order while the reader looks over the board. Play waits for the first
// step's voice only; the rest are made while it speaks, and a step reached
// before its voice is made shows the wait in its caption until it is.
// Sound waits for the page's first click. While it speaks, the shape
// its words are about is the one pointed at (docs/plan-voice-cues.md).
import type { NarrationPart } from "@ttmi/format";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { track } from "../analytics";
import { voiceReady } from "./chime";
import { speechSpeed, startedVoice, voice, useVoiceState, type VoiceState } from "./client";
import { voiceDebug } from "./debug";
import { prepareStream, prime, release } from "./player";
import { speakStep } from "./speak";
import { paceWalkthrough, type StepLoad } from "./pace";
import { prepBucket } from "./prep";
import { DEFAULT_VOICE, type Segment, type Step } from "./protocol";
import { hostedRanks } from "./schedule";

// The open sketch's clips are never swept while it is open: said to the
// engine again this often (docs/plan-voice.md).
const OPEN_EVERY_MS = 5 * 60 * 1000;
// How long the engine holds while this tab sounds a clip, at most: told
// again with every clip and let go when it ends, so this only matters for
// a tab that closes mid-clip. Longer than any step (Kokoro reads 510 tokens).
const HOLD_MS = 60_000;
// How long the ready moment shows before Play takes its place.
const CELEBRATE_MS = 1400;

// Where making the walkthrough's voice is, for the ready caption.
export type Preparation = {
  // loading: the model is on its way; making: the step waited on is being
  // made; celebrating: just made, the ready moment; done: Play.
  phase: "loading" | "making" | "celebrating" | "done";
  // The step on screen waits for its voice: the walkthrough is playing.
  playing: boolean;
  // How much of the step waited on is made, 0 to 1, read every frame, at
  // this machine's speed. Never drops back.
  progress(): number;
};

export type Narration = {
  status: VoiceState;
  // Voice is on for this board: supported, installed or on its way, not muted.
  on: boolean;
  // The viewer turned the voice off for every board: nothing of it runs.
  muted: boolean;
  // Which steps are made (or have no voice to make).
  made: boolean[];
  // Making the first step's voice before the walkthrough starts; undefined
  // once it is made, until it is known whether anything needs making, and
  // with the voice off.
  preparation?: Preparation;
  // Whether a step's voice is still to be made while the walkthrough plays,
  // asked about the step on screen (the page hears of it a frame after the
  // board), and the wait its caption shows meanwhile.
  waiting(step: number): boolean;
  stepPreparation: Preparation;
  speaking: boolean;
  // The step whose voice has begun to sound, or that has none to wait for:
  // the marker holds back until then, so it moves with the words, not with
  // the step (a made clip can still wait for the engine, then to load).
  sounding?: number;
  // Sound is waiting for the page's first click or key.
  needsGesture: boolean;
  // The reader's press moves the board to this step: its voice starts in
  // the press itself when it is made (src/voice/player.ts, prime).
  press(step: number | undefined): void;
  // The shape or group the words being said are about.
  pointing?: string;
  // The walkthrough is playing with voice on and has not spoken yet in this
  // visit: the caption shows the wait, or Play, instead of the step.
  introducing: boolean;
  // How much of the step on screen is said, 0 to 1; undefined when it has
  // no voice to wait for. Read every frame by the step bar.
  fill(step: number): { said?: number };
};

// A step nothing is known about: spoken as an ordinary step.
const PLAIN: StepLoad = { fresh: new Map(), load: 1, first: false };

// The steps a board says, paced. Words are said as written.
export function walkthroughSteps(narrations: NarrationPart[][], loads: StepLoad[], speed = 1): Step[] {
  return paceWalkthrough(narrations, loads, speed, PLAIN);
}

export function useNarration({ parts: narrations, loads = [], speed = 1, playing, voiceName, muted, enabled, sketchId, hold, kick = 0, onEnded }: {
  // Each step's narration as its parts, references on their own.
  parts: NarrationPart[][];
  // What each step brings in, which paces it (docs/plan-voice-pacing.md),
  // and the viewer's own speed on top.
  loads?: StepLoad[];
  speed?: number;
  playing: number | undefined;
  voiceName?: string;
  // The sketch it is, so a hosted voice's use is counted against it.
  sketchId?: string;
  muted: boolean;
  enabled: boolean;
  // Coming back to a step sets this before the step is shown, so the voice
  // waits. A mid-step pause does not change it; the clip is held by the player.
  hold?: { current: boolean };
  // Bumped when a held step should start. A paused clip resumes without it.
  kick?: number;
  // The step's clip played to its end. The front-page demo moves on from it.
  onEnded?(step: number): void;
}): Narration {
  const speaker = voiceName || DEFAULT_VOICE;
  // Muted, the engine is never started (docs/plan-voice.md, Off).
  const status = useVoiceState(enabled && narrations.length > 0 && !muted, speaker);
  const narrationsKey = JSON.stringify(narrations);
  const loadsKey = JSON.stringify(loads.map((load) => [[...load.fresh], load.load, load.first]));
  // Paced, each step with the last sentence of the one before as its
  // context (docs/plan-voice-context.md).
  const texts = useMemo<Step[]>(() => walkthroughSteps(narrations, loads, speed), [narrationsKey, loadsKey, speed]);
  const textsKey = `${speaker}\n${JSON.stringify(texts)}`;
  const usable = enabled && narrations.length > 0 && status.state !== "unsupported" && status.state !== "checking";
  const on = usable && !muted && status.state !== "absent";
  const [made, setMade] = useState<boolean[]>([]);
  // Whether every step has been looked up in the clip cache yet.
  const [checked, setChecked] = useState(false);
  const [celebrating, setCelebrating] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [needsGesture, setNeedsGesture] = useState(false);
  const [pointing, setPointing] = useState<string>();
  const [heard, setHeard] = useState(false);
  const [sounding, setSounding] = useState<number>();
  const madeRef = useRef(made);
  madeRef.current = made;
  // Each step's clip key, to know which one the engine is making.
  const keys = useRef<string[]>([]);
  // The step on screen and how much of it is said.
  const said = useRef<{ step?: number; fraction?: number }>({});
  // When this walkthrough's voice started to be made, if it had to be.
  const startedAt = useRef<number | undefined>(undefined);
  const playingRef = useRef(playing);
  playingRef.current = playing;
  const endedRef = useRef(onEnded);
  endedRef.current = onEnded;

  // Loads when the board opens, if this browser has it installed.
  useEffect(() => {
    if (usable && !muted && status.state === "installed") voice().load();
  }, [usable, muted, status.state]);

  // What is already made (any tab, any visit), then everything else in
  // order. A step with no words, or one that could not be made, counts as
  // made: there is nothing to wait for. When the words change (the
  // the words change), what was known stays until
  // the cache answers, so Play does not blink away and back.
  useEffect(() => {
    if (!usable) {
      setMade([]);
      setChecked(false);
      return;
    }
    let live = true;
    let answered = false;
    const marks = texts.map((step) => !step.segments.length);
    const markMade = (index: number) => {
      if (!live || marks[index]) return;
      marks[index] = true;
      if (answered) setMade([...marks]);
    };
    keys.current = [];
    let every: ReturnType<typeof setInterval> | undefined;
    void Promise.all(texts.map((step) => voice().key(step, speaker))).then((found) => {
      if (!live) return;
      keys.current = found;
      voice().open(found);
      every = setInterval(() => voice().open(found), OPEN_EVERY_MS);
    });
    void Promise.all(texts.map((step, index) => step.segments.length ? voice().made(step, speaker).then((yes) => yes && markMade(index)) : undefined)).then(() => {
      if (!live) return;
      answered = true;
      setMade([...marks]);
      setChecked(true);
    });
    return () => {
      live = false;
      clearInterval(every);
      voice().cancel(keys.current);
      voice().open([]);
    };
  }, [textsKey, usable, on, status.state === "ready"]);

  // In play order: the step on screen, then the ones after it. A jump
  // sends the new order. The first step is made before Play is offered.
  // That request is not heard: frames are buffered, and the speakers stay
  // quiet until the effect below, which runs only once the reader starts.
  // Hearing it here played the walkthrough by itself as soon as the voice
  // had loaded (2026-11-01).
  useEffect(() => {
    if (!on || status.state !== "ready") return;
    const focus = playing ?? texts.findIndex((step) => step.segments.length > 0);
    if (focus < 0) return;
    const ranks = hostedRanks(texts.length, focus);
    texts.forEach((step, index) => {
      if (step.segments.length) void voice().clip(step, speaker, index === focus, sketchId, ranks[index]).then(() => setMade((current) => Object.assign([...current], { [index]: true })), () => setMade((current) => Object.assign([...current], { [index]: true })));
    });
  }, [playing, textsKey, on, speaker, status.state === "ready"]);

  // The step the reader waits on: the one on screen while it plays, else
  // the first with a voice, which the walkthrough starts on.
  const firstVoiced = texts.findIndex((step) => step.segments.length > 0);
  const waitedOn = playing ?? (firstVoiced >= 0 ? firstVoiced : undefined);
  const firstMade = made.length > 0 && (firstVoiced < 0 || Boolean(made[firstVoiced]));
  // Timed from the moment the first step is known to need making until it
  // is, as the reader waits: counted, so we learn what the wait is
  // (docs/plan-voice.md, Preparing). A layout effect: the ready moment
  // starts in the same pass that sees the step made, so Play never shows
  // for a frame before it (a press then landed in the moment and was lost).
  useLayoutEffect(() => {
    if (!on || !checked) return;
    if (!firstMade) {
      startedAt.current ??= performance.now();
      return;
    }
    const since = startedAt.current;
    if (since === undefined) return;
    startedAt.current = undefined;
    // A step remade while the walkthrough plays is not the
    // wait before it, and no chime breaks into it.
    if (playingRef.current !== undefined) return;
    const seconds = (performance.now() - since) / 1000;
    console.info(`ttmi voice: the first step made in ${seconds.toFixed(1)} s`);
    track("voice_prepared", prepBucket(seconds));
    voiceReady();
    setCelebrating(true);
    const timer = setTimeout(() => setCelebrating(false), CELEBRATE_MS);
    return () => {
      clearTimeout(timer);
      setCelebrating(false);
    };
  }, [on, checked, firstMade]);

  // The step on screen: spoken once its clip is there; one not made yet
  // (reached before its turn, or its words changed) is made
  // first, at the front of the queue.
  const lastRun = useRef<{ playing?: number; textsKey?: string; on?: boolean }>({});
  // Bumped when this step's speaker is stopped, so a cue that arrives
  // afterwards cannot point at the step now on screen.
  const speakerGeneration = useRef(0);
  // Where each canvas's voice was when the reader left it. Coming back
  // shows that place and does not speak the step again. Entering a canvas
  // drops its place and starts at the first step.
  const places = useRef(new Map<string, { step: number; fraction?: number; pointing?: string }>());
  const sketchSeen = useRef(sketchId ?? "");
  const pointingRef = useRef<string | undefined>(undefined);
  pointingRef.current = pointing;
  useEffect(() => {
    const before = lastRun.current;
    voiceDebug("step effect", { playing, on, changed: [before.playing !== playing && "playing", before.textsKey !== textsKey && "words", before.on !== on && "on"].filter(Boolean) });
    lastRun.current = { playing, textsKey, on };
    const mine = ++speakerGeneration.current;
    const current = () => speakerGeneration.current === mine;
    const placeKey = sketchId ?? "";
    const previousSketch = sketchSeen.current;
    const sketchChanged = previousSketch !== placeKey;
    // The place being left, before this effect clears it. A dive and a
    // zoom out both come through here.
    if (said.current.step !== undefined && (sketchChanged || playing === undefined)) {
      places.current.set(previousSketch, {
        step: said.current.step,
        ...(said.current.fraction !== undefined ? { fraction: said.current.fraction } : {}),
        ...(pointingRef.current ? { pointing: pointingRef.current } : {}),
      });
    }
    if (sketchChanged) sketchSeen.current = placeKey;
    // Held on the way back: the step is shown where it was, and the voice
    // stays quiet. Entering is not this path, so a canvas starts at its
    // first step even when it was left mid-way or finished.
    if (hold?.current && playing !== undefined && !sketchChanged) {
      const kept = places.current.get(placeKey);
      if (kept && kept.step === playing) {
        said.current = { step: playing, ...(kept.fraction !== undefined ? { fraction: kept.fraction } : {}) };
        setPointing(kept.pointing);
        setSounding(playing);
        setSpeaking(false);
        setNeedsGesture(false);
        return;
      }
      return;
    }
    if (sketchChanged && playing !== undefined && !hold?.current) places.current.delete(placeKey);
    release();
    setSpeaking(false);
    setNeedsGesture(false);
    setPointing(undefined);
    setSounding(undefined);
    said.current = { step: playing };
    const step = playing === undefined ? undefined : texts[playing];
    // Nothing to say: the engine is free to make the rest.
    if (playing === undefined || !on || !step?.segments.length) {
      startedVoice()?.speaking(0);
      if (playing !== undefined) setSounding(playing);
      return;
    }
    // A step with a voice fills as it is said, from empty.
    said.current = { step: playing, fraction: 0 };
    const text = step.segments.map((segment) => segment.text).join("");
    // The reader started this step: play the frames the preload buffered.
    const asked = voice().clip(step, speaker, true, sketchId, undefined, true);
    const stopSpeaking = speakStep(asked, text, {
      made: () => setMade((current) => Object.assign([...current], { [playing]: true })),
      failed: () => {
        if (!current()) return;
        said.current = { step: playing };
        voice().speaking(0);
      },
      progress: (fraction) => {
        if (!current()) return;
        said.current = { step: playing, fraction };
      },
      // The engine makes nothing new while a clip sounds: making speech on
      // the GPU starved the sound until nothing was heard (2026-10-22).
      speaking: (yes) => {
        if (!current()) return;
        voice().speaking(yes ? HOLD_MS : 0);
        setSpeaking(yes);
      },
      needsGesture: (yes) => {
        if (current()) setNeedsGesture(yes);
      },
      pointing: (name) => {
        if (current()) setPointing(name);
      },
      heard: () => {
        if (!current()) return;
        setHeard(true);
        setSounding(playing);
      },
      ended: () => {
        if (current()) endedRef.current?.(playing);
      },
    });
    return () => {
      speakerGeneration.current += 1;
      stopSpeaking();
    };
  }, [playing, textsKey, on, kick, sketchId]);
  useEffect(() => () => startedVoice()?.speaking(0), []);

  // The press itself starts a made step's voice, so every browser lets it
  // sound; the step effect above takes it over a moment later.
  const onRef = useRef(on);
  onRef.current = on;
  const press = useCallback((step: number | undefined) => {
    if (step === undefined || !onRef.current) return;
    const key = keys.current[step];
    const clip = key ? voice().known(key) : undefined;
    // Not made yet: this press will stream. Resume inside the gesture.
    // A clip already in hand plays on the element, and must not open the
    // stream context beside that start.
    if (!clip) {
      prepareStream();
      return;
    }
    voice().speaking(HOLD_MS);
    prime(clip.url);
  }, []);

  // Until the engine says whether there is a voice, the caption waits
  // rather than show words it may be about to hide.
  const checking = enabled && narrations.length > 0 && !muted && status.state === "checking";
  const introducing = (on || checking) && playing !== undefined && !heard && Boolean(texts[playing]?.segments.length);
  // A step with a voice is empty until its voice takes it on: the board
  // reads the new step a frame before this hook hears of it, and a step
  // with no voice is drawn full (it flashed full, then emptied).
  const voiced = useRef<(step: number) => boolean>(() => false);
  voiced.current = (step) => on && Boolean(texts[step]?.segments.length);
  const fill = useCallback((step: number) => (said.current.step === step ? (said.current.fraction !== undefined ? { said: said.current.fraction } : {}) : voiced.current(step) ? { said: 0 } : {}), []);
  // How far the step waited on has got, as time spent waiting against the
  // time still to go: what is left of the step the engine is making, and
  // this step's own words if that is another one (a step reached before
  // its turn waits for the one in hand). So it moves from the first frame
  // the reader waits. The engine stops saying it is making a step a moment
  // before the clip arrives (it is cached first), so the furthest reached
  // is kept, short of full until it is made.
  const waitedRef = useRef(waitedOn);
  waitedRef.current = waitedOn;
  const reached = useRef(0);
  // When the wait was first drawn; the model loading before it is not
  // counted.
  const waitingSince = useRef<number | undefined>(undefined);
  const textsRef = useRef(texts);
  textsRef.current = texts;
  const progress = useCallback(() => {
    const index = waitedRef.current;
    if (index === undefined) return 0;
    if (madeRef.current[index]) return (reached.current = 1);
    const at = Date.now();
    waitingSince.current ??= at;
    const live = voice().status;
    const perSecond = speechSpeed();
    const own = Math.max(1, (textsRef.current[index]?.segments ?? []).reduce((sum, segment) => sum + segment.text.length, 0)) / perSecond;
    const now = live.making;
    const inHand = now ? Math.max(0, now.chars / perSecond - (at - now.since) / 1000) : 0;
    const left = now?.key && now.key === keys.current[index] ? inHand : inHand + own;
    const spent = (at - waitingSince.current) / 1000;
    reached.current = Math.max(reached.current, Math.min(0.95, spent / Math.max(0.001, spent + left)));
    return reached.current;
  }, []);
  useEffect(() => {
    reached.current = 0;
    waitingSince.current = undefined;
  }, [textsKey, waitedOn]);
  // Until it is known whether this browser speaks and what is made, the
  // caption says it is loading rather than offer Play and take it back.
  // The status is the engine's only once the viewer's settings and the
  // steps are read; before, it stands in as unsupported.
  const known = enabled && narrations.length > 0;
  const unknown = !muted && (!known || status.state === "checking" || (on && !checked));
  const phase = status.state === "ready" ? "making" : "loading";
  // The ready moment from the render that first sees the step made (its
  // wait was timed, startedAt), before the layout effect above says so:
  // otherwise the view left for that one render and came back new, its
  // bars starting over.
  const cheering = celebrating || (firstMade && startedAt.current !== undefined && playing === undefined);
  const preparation: Preparation | undefined = playing !== undefined
    ? undefined
    : unknown
      ? { phase: "loading", playing: false, progress }
      : !on || (firstMade && !cheering)
        ? undefined
        : { phase: cheering ? "celebrating" : phase, playing: false, progress };
  // A step waits only for a voice it has and that is not made; one whose
  // voice failed counts as made. Asked while drawing, so it reads refs, and
  // points the wait's progress at that step.
  const waits = useRef<(step: number) => boolean>(() => false);
  waits.current = (step) => on && checked && Boolean(texts[step]?.segments.length) && !madeRef.current[step];
  const waiting = useCallback((step: number) => {
    const yes = waits.current(step);
    if (yes && waitedRef.current !== step) {
      waitedRef.current = step;
      reached.current = 0;
      waitingSince.current = undefined;
    }
    return yes;
  }, []);
  const stepPreparation: Preparation = { phase, playing: true, progress };
  return { status, on, muted, made, ...(preparation ? { preparation } : {}), waiting, stepPreparation, speaking, ...(sounding !== undefined ? { sounding } : {}), needsGesture, press, ...(pointing ? { pointing } : {}), introducing, fill };
}
