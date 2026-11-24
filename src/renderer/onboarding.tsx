// The first run: what Flock needs, checked one thing at a time. The coding
// CLIs it found, then the voice (installed on this machine, and heard: you
// press Play and say whether it sounded), then your first agent. The voice
// check is also in Settings (VoiceCheck).
import React, { useEffect, useRef, useState } from "react";
import { Check, Download, Play, RotateCcw, Volume2, VolumeX } from "lucide-react";
import { DEFAULT_VOICE, speakStep, useVoiceStatus, voice, VOICES } from "ttmi-voice";
import type { AppState, Settings } from "../shared/types";
import { AGENT_COLORS, AgentAvatar } from "./avatar";
import { grantVoice, guardVoice, revokeVoice } from "./voiceGate";

const TEST_LINE = (name: string) => `Hi, I'm ${name}. This is how your agents will walk you through their canvases, one step at a time.`;

// A voice's name and accent, from TTMI's list ("Miles (US)").
function voiceParts(name: string) {
  const match = /^(.*?)\s*\((\w+)\)$/.exec(name);
  const accent = match?.[2] === "UK" ? "British" : match?.[2] === "US" ? "American" : match?.[2] ?? "";
  return { name: match?.[1] ?? name, accent };
}

// The voices as cards: choosing one is hearing it. The engine (installed on
// this machine) comes first when it is not ready. onHeard (the first run):
// after a voice has spoken, asks whether you heard it.
export function VoiceCheck({ voiceId, onVoice, onHeard }: { voiceId: string; onVoice(id: string): void; onHeard?(heard: boolean): void }) {
  const status = useVoiceStatus(true, voiceId);
  const [speaking, setSpeaking] = useState<string>();
  const [spoke, setSpoke] = useState<string>();
  const [answer, setAnswer] = useState<"yes" | "no">();
  const [error, setError] = useState<string>();
  const stop = useRef<() => void>(undefined);
  useEffect(() => {
    guardVoice();
    return () => { stop.current?.(); revokeVoice(); };
  }, []);
  // A voice installed before loads by itself.
  useEffect(() => {
    if (status.state === "installed") voice().load();
  }, [status.state]);
  const ready = status.state === "ready";

  // A press: the voice may sound now (voiceGate.ts), and the line is made
  // in that voice and played.
  const hear = (id: string) => {
    onVoice(id);
    stop.current?.();
    if (speaking === id) {
      setSpeaking(undefined);
      return;
    }
    if (!ready) return;
    grantVoice();
    setError(undefined);
    setAnswer(undefined);
    setSpeaking(id);
    const text = TEST_LINE(voiceParts(VOICES.find((item) => item.id === id)?.name ?? "").name);
    const done = (ok: boolean) => () => { setSpeaking((was) => (was === id ? undefined : was)); if (ok) setSpoke(id); };
    stop.current = speakStep(voice().clip({ segments: [{ text }] }, id, true, "voice-check"), text, {
      speaking() {}, pointing() {}, heard() {},
      needsGesture() { setError("Press the voice again: it needs a press to start."); setSpeaking(undefined); },
      ended: done(true),
      failed() { setError("The voice could not make that line."); setSpeaking(undefined); },
    });
  };

  const state = status.state;
  const progress = Math.round((status.progress ?? 0) * 100);
  const chosen = voiceParts(VOICES.find((item) => item.id === voiceId)?.name ?? "").name;
  return (
    <div className="voices">
      {state === "absent" ? (
        <div className="voice-engine">
          <div>
            <strong>Install the voice</strong>
            <span>It runs on this machine: one download of about 44 MB, kept for next time.</span>
          </div>
          <button type="button" className="primary" onClick={() => voice().install()}><Download size={15} /> Install</button>
        </div>
      ) : state === "installing" || state === "loading" || state === "installed" || state === "checking" ? (
        <div className="voice-engine">
          <div>
            <strong>{state === "installing" ? `Downloading the voice · ${progress}%` : "Getting the voice ready…"}</strong>
            <span className="voice-engine-bar"><span style={{ width: `${state === "installing" ? progress : 100}%` }} className={state !== "installing" ? "voice-engine-bar-busy" : ""} /></span>
          </div>
        </div>
      ) : state === "unsupported" ? (
        <div className="voice-engine voice-engine-off">
          <div>
            <strong>No voice here</strong>
            <span>{status.reason ?? "The voice could not start on this machine."} Walkthroughs still play, with captions.</span>
          </div>
          <button type="button" className="ghost" onClick={() => voice().retry()}><RotateCcw size={14} /> Try again</button>
          {onHeard && <button type="button" className="ghost" onClick={() => onHeard(false)}>Go on without</button>}
        </div>
      ) : (
        <p className="voice-ready"><Check size={14} /> Installed on this machine. Choose a voice to hear it.</p>
      )}

      <div className="voice-grid" role="radiogroup" aria-label="Voice">
        {VOICES.map((item) => {
          const parts = voiceParts(item.name);
          const on = item.id === voiceId;
          const talking = speaking === item.id;
          return (
            <button key={item.id} type="button" role="radio" aria-checked={on} className={`voice-card ${on ? "voice-card-on" : ""} ${talking ? "voice-card-talking" : ""}`} onClick={() => hear(item.id)} title={ready ? (talking ? "Stop" : `Hear ${parts.name}`) : `Choose ${parts.name}`}>
              <span className="voice-card-play" aria-hidden>
                {talking ? <span className="voice-bars"><span /><span /><span /><span /></span> : <Play size={14} />}
              </span>
              <span className="voice-card-name">{parts.name}</span>
              <span className="voice-card-accent">{parts.accent}</span>
              {on && <Check size={14} className="voice-card-check" />}
            </button>
          );
        })}
      </div>

      {onHeard && spoke && !speaking && (
        answer === "no" ? (
          <div className="voice-question">
            <span>Check that your Mac's sound is on, and its output is the speaker or headphones you use, then press the voice again.</span>
            <button type="button" className="ghost" onClick={() => onHeard(false)}>Go on without</button>
          </div>
        ) : answer === "yes" ? (
          <p className="voice-ready voice-heard"><Volume2 size={14} /> {chosen} it is.</p>
        ) : (
          <div className="voice-question">
            <strong>Did you hear {voiceParts(VOICES.find((item) => item.id === spoke)?.name ?? "").name}?</strong>
            <button type="button" className="ghost" onClick={() => setAnswer("no")}><VolumeX size={14} /> No sound</button>
            <button type="button" className="primary" onClick={() => { setAnswer("yes"); onHeard(true); }}><Volume2 size={14} /> Yes</button>
          </div>
        )
      )}
      {error && <p className="agent-error">{error}</p>}
    </div>
  );
}

// The first-run page: three steps, each opening once the one before is done.
export function Onboarding({ state, onDone }: { state: AppState; onDone(settings: Settings): void }) {
  const [voiceId, setVoiceId] = useState(state.settings.voice ?? DEFAULT_VOICE);
  const [voiceDone, setVoiceDone] = useState<boolean | undefined>();
  const ready = state.clis.filter((cli) => cli.installed && cli.loggedIn);
  const clisDone = ready.length > 0;
  const finish = () => onDone({ ...state.settings, voice: voiceId, onboarded: true });
  return (
    <div className="onboarding">
      <div className="onboarding-hero">
        <div className="onboarding-flock" aria-hidden>
          {["O1", "W2", "W7"].map((seed, index) => <AgentAvatar key={seed} seed={seed} color={AGENT_COLORS[(index * 3) % AGENT_COLORS.length]!} size={index === 1 ? 56 : 44} working />)}
        </div>
        <h1>Welcome to Flock</h1>
        <p>Your agents work on your repositories and talk to you through a canvas: a drawing they walk you through, step by step, out loud. Three things to set up, and you are in.</p>
      </div>

      <ol className="onboarding-steps">
        <li className={`onboarding-step ${clisDone ? "onboarding-step-done" : "onboarding-step-on"}`}>
          <span className="onboarding-step-mark">{clisDone ? <Check size={14} /> : 1}</span>
          <div className="onboarding-step-body">
            <h2>A coding CLI</h2>
            <p>Flock runs on the coding CLIs on your machine, with your own login. It needs one.</p>
            <ul className="cli-list">
              {state.clis.map((cli) => (
                <li key={cli.id}>
                  <span className={`agent-mark ${cli.installed && cli.loggedIn ? "agent-mark-idle" : cli.installed ? "agent-mark-working" : "agent-mark-none"}`} />
                  <strong>{cli.name}</strong>
                  <span className="muted">{cli.installed ? `${cli.version ?? ""}${cli.loggedIn ? " · ready" : " · not logged in"}` : "not installed"}</span>
                  {cli.note && <span className="muted">{cli.note}</span>}
                </li>
              ))}
            </ul>
            {!clisDone && <button type="button" className="ghost" onClick={() => void window.dispatch.refreshClis()}><RotateCcw size={14} /> Look again</button>}
          </div>
        </li>

        <li className={`onboarding-step ${voiceDone !== undefined ? "onboarding-step-done" : clisDone ? "onboarding-step-on" : ""}`}>
          <span className="onboarding-step-mark">{voiceDone !== undefined ? <Check size={14} /> : 2}</span>
          <div className="onboarding-step-body">
            <h2>The voice</h2>
            <p>Agents read their walkthroughs aloud. Pick the voice your agents get, install it, and listen.</p>
            {clisDone && <VoiceCheck voiceId={voiceId} onVoice={setVoiceId} onHeard={setVoiceDone} />}
          </div>
        </li>

        <li className={`onboarding-step ${voiceDone !== undefined ? "onboarding-step-on" : ""}`}>
          <span className="onboarding-step-mark">3</span>
          <div className="onboarding-step-body">
            <h2>Your first agent</h2>
            <p>An agent works on one git repository. You talk to it, it draws its plan, and it starts workers, each in its own git worktree, to build.</p>
            {voiceDone !== undefined && <button type="button" className="primary" onClick={finish}>Create your first agent</button>}
          </div>
        </li>
      </ol>
    </div>
  );
}
