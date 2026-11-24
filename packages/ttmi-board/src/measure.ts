import type { SketchMeasure } from "@ttmi/format";

// Sizes boxes and notes the way the board will draw them: each is rendered
// out of sight inside the world, with its classes, and measured.
export function measurer(world: HTMLElement): SketchMeasure & { done(): void } {
  const host = document.createElement("div");
  host.style.cssText = "position:absolute;left:-100000px;top:0;visibility:hidden;";
  world.appendChild(host);
  return {
    box(label) {
      host.innerHTML = "";
      const rect = document.createElement("div");
      rect.className = "sketch-rect";
      rect.style.cssText = "position:static;display:inline-flex;max-width:320px;";
      const text = document.createElement("div");
      text.className = "sketch-label";
      text.textContent = label || " ";
      rect.appendChild(text);
      host.appendChild(rect);
      // Breathing room around the label, then the height at that width.
      const w = Math.min(340, Math.max(140, rect.offsetWidth + 24));
      rect.style.width = `${w}px`;
      rect.style.maxWidth = "none";
      return { w, h: Math.max(70, rect.offsetHeight + 20) };
    },
    noteWidth(html, size) {
      host.innerHTML = "";
      const note = document.createElement("div");
      note.className = "sketch-note";
      note.style.cssText = `position:static;width:4000px;font-size:${size}px;`;
      const body = document.createElement("div");
      body.className = "ProseMirror";
      body.innerHTML = html;
      const blocks = wrapCode(body);
      for (const pre of blocks) {
        // Its longest line, unwrapped.
        pre.style.width = "max-content";
        pre.style.whiteSpace = "pre";
      }
      note.appendChild(body);
      host.appendChild(note);
      const widest = Math.max(0, ...blocks.map((pre) => pre.offsetWidth));
      // The note's own padding, and a little room.
      return widest ? Math.ceil(widest + 20) : 0;
    },
    note(html, width, size, tagged) {
      host.innerHTML = "";
      const note = document.createElement("div");
      note.className = `sketch-note ${tagged ? "sketch-note-tagged" : ""}`;
      note.style.cssText = `position:static;width:${width}px;font-size:${size}px;`;
      const body = document.createElement("div");
      body.className = "ProseMirror";
      body.innerHTML = html;
      wrapCode(body);
      note.appendChild(body);
      host.appendChild(note);
      return note.offsetHeight;
    },
    noteFolded(html, width, size) {
      host.innerHTML = "";
      const body = document.createElement("div");
      body.className = "ProseMirror";
      body.innerHTML = html;
      // One block never folds.
      if (body.children.length < 2) return undefined;
      const note = document.createElement("div");
      // Shrinks to its head, up to the width asked (NoteView's NoteHead).
      note.className = "sketch-note sketch-note-foldable sketch-note-folded";
      note.style.cssText = `position:static;display:inline-block;max-width:${width}px;font-size:${size}px;`;
      const head = document.createElement("div");
      head.className = "sketch-note-head";
      const title = document.createElement("span");
      title.className = "sketch-note-title";
      title.textContent = (body.firstElementChild?.textContent ?? "").split("\n")[0]!.trim();
      head.appendChild(title);
      const chevron = document.createElement("span");
      chevron.className = "sketch-note-chevron";
      head.appendChild(chevron);
      note.appendChild(head);
      host.appendChild(note);
      // offsetWidth rounds to the nearest pixel; a line that is then half a
      // pixel short of its width wraps and is clamped, so give it one more.
      return { w: note.offsetWidth + 1, h: note.offsetHeight };
    },
    // An arrow's label on its backing, as the board draws it.
    label(text, seq) {
      host.innerHTML = "";
      const label = document.createElement("div");
      label.className = seq ? "sketch-arrow-label sketch-arrow-label-seq" : "sketch-arrow-label";
      label.style.cssText = `position:static;display:${seq ? "inline-flex" : "inline-block"};transform:none;`;
      if (seq) {
        const badge = document.createElement("div");
        badge.className = "sketch-seq";
        badge.textContent = seq;
        label.appendChild(badge);
      }
      const inner = document.createElement("div");
      inner.className = "sketch-label";
      inner.textContent = text;
      if (text || !seq) label.appendChild(inner);
      host.appendChild(label);
      return { w: label.offsetWidth, h: label.offsetHeight };
    },
    // A tag's pill.
    tag(text) {
      host.innerHTML = "";
      const tag = document.createElement("div");
      tag.className = "sketch-tag";
      tag.style.cssText = "position:static;display:inline-block;";
      tag.textContent = text;
      host.appendChild(tag);
      return { w: tag.offsetWidth, h: tag.offsetHeight };
    },
    done() {
      host.remove();
    },
  };
}

// Code blocks as the editor draws them: in its wrapper, with the code's
// text in a block inside <code> (inline, its lines come out taller), and a
// line break that ends the block drawn as an empty last line.
function wrapCode(body: HTMLElement) {
  const blocks = [...body.querySelectorAll("pre")];
  for (const pre of blocks) {
    const wrap = document.createElement("div");
    wrap.className = "sketch-code";
    pre.replaceWith(wrap);
    wrap.appendChild(pre);
    const code = pre.querySelector("code") ?? pre;
    const content = document.createElement("div");
    content.append(...code.childNodes);
    if (content.textContent?.endsWith("\n")) content.append(document.createElement("br"));
    code.appendChild(content);
  }
  return blocks;
}
