import type { Color } from "@ttmi/format";
import { ArrowUpRight } from "lucide-react";
import { COLORS, tagStyle } from "./shapes";

// A canvas badge's magnifier, before the name, in the pill's own colour.
export function CanvasMark() {
  return (
    <svg className="sketch-canvas-mark" width="11" height="11" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <circle cx="10.5" cy="10.5" r="6.2" fill="none" stroke="currentColor" strokeWidth="2.5" />
      <path d="M15.1 15.1 L20.4 20.4" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}

// The top-right arrow, as it was before a sketch link became a canvas
// (ecfafc6): a 20px pill, ArrowUpRight at 12px, in the box's colour.
// Kept in the PNG. A click opens the page in a new tab.
export function ExternalLink({ href, color }: { href: string; color: Color }) {
  return (
    <a
      className="sketch-link"
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      data-external-link=""
      title="Open this link"
      style={{ borderColor: COLORS[color], color: COLORS[color] }}
      onPointerDown={(event) => { event.stopPropagation(); event.preventDefault(); }}
      onDoubleClick={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.stopPropagation();
        event.preventDefault();
        window.open(href, "_blank", "noopener,noreferrer");
      }}
    >
      <ArrowUpRight size={12} />
    </a>
  );
}

export function CanvasBadge({ text, color }: { text: string; color: Color }) {
  return (
    <div className="sketch-tag" style={tagStyle(color)}>
      <CanvasMark />
      {text}
    </div>
  );
}
