// The walkthrough caption while the reader is asking (docs/board.md, Ask).
// A chat composer: the question, and Ask. The prompt is only on the clipboard.
// An answer stays here until Space or Continue.
import { X } from "lucide-react";
import { useLayoutEffect, type RefObject } from "react";
import { ASK_CONTINUE_HINT } from "./ask";

export type AskPhase = "compose" | "waiting" | "summary";

const COMPOSER_MAX = 140;

function fit(element: HTMLTextAreaElement | null) {
  if (!element) return;
  element.style.height = "0px";
  element.style.height = `${Math.min(element.scrollHeight, COMPOSER_MAX)}px`;
}

export function AskView({ phase, question, copied, summary, onQuestion, onCopy, onCancel, onClose, onContinue, fieldRef }: {
  phase: AskPhase;
  question: string;
  copied: boolean;
  summary?: string;
  onQuestion(value: string): void;
  onCopy(): void;
  onCancel(): void;
  onClose(): void;
  onContinue(): void;
  fieldRef: RefObject<HTMLTextAreaElement | null>;
}) {
  const close = phase === "waiting" ? onCancel : onClose;
  useLayoutEffect(() => {
    if (phase === "compose") fit(fieldRef.current);
  }, [phase, question, fieldRef]);
  return (
    <div className="sketch-caption sketch-ask" data-testid="ask" data-ask-phase={phase}>
      <div className="sketch-step-top">
        <div className="sketch-step-end">
          <button type="button" className="sketch-ask-close" title="Back (Esc)" aria-label="Close ask" onClick={close}><X size={15} /></button>
        </div>
      </div>
      {phase === "compose" ? (
        <div className="sketch-ask-composer">
          <textarea
            ref={fieldRef}
            rows={1}
            value={question}
            placeholder="Ask about this step…"
            aria-label="Ask about this step"
            onChange={(event) => {
              onQuestion(event.target.value);
              fit(event.target);
            }}
          />
          <div className="sketch-ask-composer-bar">
            <span className="sketch-ask-hint" aria-hidden><kbd>⌘</kbd><kbd>⏎</kbd></span>
            <button type="button" className="sketch-ask-send" data-copied={copied ? "true" : "false"} disabled={!question.trim()} onClick={onCopy}>{copied ? "Copied" : "Ask"}</button>
          </div>
        </div>
      ) : phase === "waiting" ? (
        <div className="sketch-ask-wait">
          <p className="sketch-ask-bubble">{question}</p>
          <p className="sketch-ask-waiting">
            <span className="sketch-ask-dots" aria-hidden><span /><span /><span /></span>
            Waiting for you to paste the prompt to your agent…
          </p>
          <div className="sketch-ask-actions">
            <button type="button" className="sketch-ask-quiet" data-copied={copied ? "true" : "false"} onClick={onCopy}>{copied ? "Copied" : "Copy again"}</button>
            <button type="button" className="sketch-ask-quiet" onClick={onCancel}>Cancel</button>
          </div>
        </div>
      ) : (
        <div className="sketch-ask-wait">
          <p className="sketch-narration" data-testid="ask-summary">{summary}</p>
          <div className="sketch-ask-continue">
            <span className="sketch-ask-hint" data-testid="ask-continue-hint"><kbd>{ASK_CONTINUE_HINT.key}</kbd> {ASK_CONTINUE_HINT.label}</span>
            <button type="button" className="sketch-ask-send" onClick={onContinue}>Continue</button>
          </div>
        </div>
      )}
    </div>
  );
}
