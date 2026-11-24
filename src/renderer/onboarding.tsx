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

type Heard = "untried" | "playing" | "asking" | "yes" | "no";

const TEST_LINE = (name: string) => `Hi, I'm ${name}. This is how your agents will walk you through their canvases, one step at a time.`;

// Installs the voice, plays a line in it, and asks whether you heard it.
// onHeard: you said yes (or there is no voice here, and you went on).
export function VoiceCheck({ voiceId, onVoice, onHeard }: { voiceId: string; onVoice(id: string): void; onHeard?(heard: boolean): void }) {
  const status = useVoiceStatus(true, voiceId);
  const [heard, setHeard] = useState<Heard>("untried");
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
  const name = VOICES.find((item) => item.id === voiceId)?.name.replace(/\s*\(.*\)$/, "") ?? "your agent";

  // A press: the voice may sound now (voiceGate.ts), and the line is made
  // and played. Its end asks whether you heard it.
  const play = () => {
    stop.current?.();
    grantVoice();
    setError(undefined);
    setHeard("playing");
    const text = TEST_LINE(name);
    stop.current = speakStep(voice().clip({ segments: [{ text }] }, voiceId, true, "onboarding"), text, {
      speaking() {}, pointing() {}, heard() {},
      needsGesture() { setError("Press Play again: the voice needs a press to start."); setHeard("untried"); },
      ended() { setHeard("asking"); },
      failed() { setError("The voice could not make that line."); setHeard("untried"); },
    });
  };
  const answer = (yes: boolean) => {
    setHeard(yes ? "yes" : "no");
    onHeard?.(yes);
  };

  const state = status.state;
  const progress = Math.round((status.progress ?? 0) * 100);
  return (
    <div className="voice-check">
      <div className="voice-check-row">
        <label className="voice-check-pick">
          <span>Voice</span>
          <select value={voiceId} onChange={(event) => { onVoice(event.target.value); setHeard("untried"); }}>
            {VOICES.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </label>
        <span className={`voice-check-state voice-check-${state}`}>
          {state === "checking" ? "Checking this machine…"
            : state === "absent" ? "Not installed"
              : state === "installing" ? `Downloading · ${progress}%`
                : state === "installed" || state === "loading" ? "Getting ready…"
                  : state === "ready" ? <><Check size={13} /> Installed</>
                    : "Not available here"}
        </span>
      </div>

      {(state === "installing" || state === "loading" || state === "installed") && (
        <div className="voice-check-bar"><span style={{ width: `${state === "installing" ? progress : 100}%` }} className={state !== "installing" ? "voice-check-bar-busy" : ""} /></div>
      )}

      {state === "absent" && (
        <div className="voice-check-actions">
          <p className="voice-check-note">The voice runs on this machine. It is one download of about 44 MB, kept for next time.</p>
          <button type="button" className="primary" onClick={() => voice().install()}><Download size={15} /> Install the voice</button>
        </div>
      )}

      {state === "unsupported" && (
        <div className="voice-check-actions">
          <p className="voice-check-note">{status.reason ?? "The voice could not start here."} Walkthroughs still play, with captions.</p>
          <button type="button" className="ghost" onClick={() => voice().retry()}><RotateCcw size={14} /> Try again</button>
          {onHeard && <button type="button" className="ghost" onClick={() => answer(false)}>Go on without a voice</button>}
        </div>
      )}

      {state === "ready" && (
        <div className="voice-check-actions">
          {heard === "asking" ? (
            <>
              <p className="voice-check-question">Did you hear {name}?</p>
              <button type="button" className="ghost" onClick={() => setHeard("no")}><VolumeX size={14} /> No sound</button>
              <button type="button" className="primary" onClick={() => answer(true)}><Volume2 size={15} /> Yes, I heard it</button>
            </>
          ) : heard === "yes" ? (
            <>
              <p className="voice-check-question voice-check-good"><Check size={15} /> The voice works.</p>
              <button type="button" className="ghost" onClick={play}><Play size={14} /> Play again</button>
            </>
          ) : heard === "no" ? (
            <>
              <p className="voice-check-note">Check that your Mac's sound is on and its output is the speaker or headphones you use, then play it again. If it stays silent, walkthroughs still play, with captions.</p>
              <button type="button" className="ghost" onClick={play}><Play size={14} /> Play again</button>
              {onHeard && <button type="button" className="ghost" onClick={() => answer(false)}>Go on without a voice</button>}
            </>
          ) : (
            <>
              <p className="voice-check-note">{heard === "playing" ? `${name} is speaking…` : "Turn your sound on, and play a line in this voice."}</p>
              <button type="button" className="primary" disabled={heard === "playing"} onClick={play}><Play size={15} /> {heard === "playing" ? "Playing…" : "Play a test"}</button>
            </>
          )}
        </div>
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
