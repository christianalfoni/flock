// What a canvas looks like while it loads: the outline of a drawing (a few
// boxes joined by lines) and the walkthrough's panel on the message box,
// pulsing, so the view keeps its shape until the board is drawn.
import React from "react";

const BOXES = [
  { x: 8, y: 42, w: 17 },
  { x: 38, y: 20, w: 19 },
  { x: 38, y: 44, w: 21 },
  { x: 38, y: 68, w: 18 },
  { x: 72, y: 20, w: 17 },
  { x: 72, y: 44, w: 19 },
];
const LINES = [[0, 1], [0, 2], [0, 3], [1, 4], [2, 5]] as const;
// Each box's height, in the same percent of the drawing's area as y.
const H = 13;

// The pulse keeps the page's clock, not the element's: one skeleton taking
// over from another (the page's while the canvas loads, then the canvas's
// own) carries on in step, so the swap does not show.
const PULSE_MS = 1400;

export function CanvasSkeleton({ leaving = false }: { leaving?: boolean }) {
  const [phase] = React.useState(() => -(performance.now() % PULSE_MS));
  return (
    <div className={`agent-canvas-skeleton ${leaving ? "agent-canvas-skeleton-leaving" : ""}`} style={{ "--skeleton-phase": `${phase}ms` } as React.CSSProperties} aria-hidden>
      <div className="agent-canvas-skeleton-drawing">
      <svg className="agent-canvas-skeleton-lines" viewBox="0 0 100 100" preserveAspectRatio="none">
        {LINES.map(([from, to]) => {
          const a = BOXES[from]!;
          const b = BOXES[to]!;
          return <line key={`${from}-${to}`} x1={a.x + a.w} y1={a.y + H / 2} x2={b.x} y2={b.y + H / 2} vectorEffect="non-scaling-stroke" />;
        })}
      </svg>
      {BOXES.map((box, index) => (
        <span key={index} className="agent-canvas-skeleton-box" style={{ left: `${box.x}%`, top: `${box.y}%`, width: `${box.w}%`, height: `${H}%`, animationDelay: `calc(var(--skeleton-phase) + ${index * 90}ms)` }} />
      ))}
      </div>
      <div className="agent-canvas-skeleton-panel">
        <span className="agent-canvas-skeleton-text" />
        <span className="agent-canvas-skeleton-text agent-canvas-skeleton-text-short" />
        <span className="agent-canvas-skeleton-bar" />
      </div>
    </div>
  );
}
