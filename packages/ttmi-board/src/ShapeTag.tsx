import type { NoteShape, RectShape } from "@ttmi/format";
import { useLayoutEffect, useRef } from "react";
import { tagStyle } from "./shapes";

// A shape's tag: a small pill on its top-left corner, solid in the shape's
// colour when it has one (the colour is a state, and the tag carries it),
// or, while being edited, the same pill to type in.
export function ShapeTag({ shape, editing, onSave }: {
  shape: RectShape | NoteShape;
  editing: boolean;
  // The new tag, or null to leave it as it was.
  onSave(value: string | null): void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const done = useRef(false);
  useLayoutEffect(() => {
    if (!editing || !ref.current) return;
    done.current = false;
    ref.current.textContent = shape.tag ?? "";
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
    onSave(value);
  };
  const style = tagStyle(shape.color);
  if (editing) {
    return (
      <div
        ref={ref}
        className="sketch-tag sketch-tag-editing"
        style={style}
        contentEditable="plaintext-only"
        suppressContentEditableWarning
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === "Enter") {
            event.preventDefault();
            // textContent: innerText would come back uppercased by the style.
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
  if (!shape.tag) return null;
  return <div className="sketch-tag" data-tag-of={shape.id} style={style}>{shape.tag}</div>;
}
