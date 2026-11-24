import { useLayoutEffect, useRef } from "react";

// A box's label, typed in place. Uncontrolled so the caret stays put.
export function LabelEditor({ initial, onChange }: { initial: string; onChange(label: string): void }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = ref.current!;
    element.textContent = initial;
    element.focus();
    const range = document.createRange();
    range.selectNodeContents(element);
    range.collapse(false);
    getSelection()?.removeAllRanges();
    getSelection()?.addRange(range);
  }, []);
  return <div ref={ref} className="sketch-label sketch-label-editing" contentEditable="plaintext-only" suppressContentEditableWarning onInput={(event) => onChange(event.currentTarget.innerText)} />;
}
