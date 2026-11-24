import type { ArrowShape } from "@ttmi/format";
import { useLayoutEffect, useRef } from "react";
import { COLORS, ON_COLORS } from "./shapes";

// An arrow's number: a round badge in the arrow's colour at its label's
// left, or, while being edited, the same badge to type in.
export function ArrowSeq({ arrow, editing, onSave, onHover }: {
  arrow: ArrowShape;
  editing: boolean;
  // The new number ("" removes it), or null to leave it as it was.
  onSave(value: string | null): void;
  onHover(over: boolean): void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const done = useRef(false);
  useLayoutEffect(() => {
    if (!editing || !ref.current) return;
    done.current = false;
    ref.current.textContent = arrow.seq ?? "";
    ref.current.focus();
    const range = document.createRange();
    range.selectNodeContents(ref.current);
    range.collapse(false);
    getSelection()?.removeAllRanges();
    getSelection()?.addRange(range);
  }, [editing]);
  const finish = (value: string | null) => {
    if (done.current) return;
    done.current = true;
    onSave(value === null ? null : value.trim());
  };
  if (editing) {
    return (
      <div
        ref={ref}
        className="sketch-seq sketch-seq-editing"
        style={{ background: COLORS[arrow.color], color: ON_COLORS[arrow.color] }}
        contentEditable="plaintext-only"
        suppressContentEditableWarning
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === "Enter") {
            event.preventDefault();
            finish(ref.current?.textContent ?? "");
          } else if (event.key === "Escape") {
            event.preventDefault();
            finish(null);
          }
        }}
        onBlur={() => finish(ref.current?.textContent ?? "")}
      />
    );
  }
  if (!arrow.seq) return null;
  // Always in the arrow's colour, its state: the hop the walkthrough is at
  // lights the line and its ends, not the badge (docs/board.md, Arrow).
  return <div className="sketch-seq" style={{ background: COLORS[arrow.color], color: ON_COLORS[arrow.color] }} data-seq-of={arrow.id} onPointerEnter={() => onHover(true)} onPointerLeave={() => onHover(false)}>{arrow.seq}</div>;
}
