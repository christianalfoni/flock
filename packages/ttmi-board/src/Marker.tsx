import { useEffect, useRef, useState } from "react";
import { ACCENT } from "./styles";

// The presenter's marker (docs/board.md, Marker): it follows the
// narration, and the drawing itself never changes for it. It glides to what the
// voice names and taps it once, and traces the hop the step is at along
// its arrow, leaving ink that fades when the step moves on. Motion follows
// docs/research-marker.md: ease-in-out, a slight arc, 300–800 ms by distance,
// still while the voice dwells, one tap, a trace only along a flow.
// The stop's hop, traced along its arrow, and the shape the voice names,
// pointed at once the trace is done.
export type MarkerTrace = { key: string; arrow: string; d: string };
export type MarkerPoint = { key: string; name: string; x: number; y: number };

type Point = { x: number; y: number };

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

export function Marker({ trace, point, zoom, paused = false, rate = 1, instant = false, drawn, onTraceDone, onDrawn }: { trace?: MarkerTrace; point?: MarkerPoint; zoom: number; paused?: boolean; rate?: number; instant?: boolean; drawn?: number; onTraceDone?: (key: string) => void; onDrawn?: (key: string, drawn: number) => void }) {
  const [pos, setPos] = useState<Point>();
  const [visible, setVisible] = useState(false);
  const [tap, setTap] = useState(0);
  const [ink, setInk] = useState<{ d: string; length: number; drawn: number; key: string }>();
  const [fading, setFading] = useState<{ d: string; key: string }>();
  const posRef = useRef<Point | undefined>(undefined);
  const inkRef = useRef(ink);
  inkRef.current = ink;
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  const rateRef = useRef(rate);
  rateRef.current = Math.max(0.25, rate);
  const instantRef = useRef(instant);
  instantRef.current = instant;
  const onTraceDoneRef = useRef(onTraceDone);
  onTraceDoneRef.current = onTraceDone;
  const onDrawnRef = useRef(onDrawn);
  onDrawnRef.current = onDrawn;
  const measure = useRef<SVGPathElement>(null);
  const frame = useRef(0);
  // Bumped when a trace is replaced, so a cancelled draw does not report
  // that it finished.
  const traceGen = useRef(0);

  const move = (to: Point) => {
    posRef.current = to;
    setPos(to);
  };

  // A glide from where the marker is to a point: eased, on a slight arc,
  // longer for a longer way but never over 800 ms.
  const glide = (to: Point, done?: () => void) => {
    const from = posRef.current;
    if (!from) {
      move(to);
      done?.();
      return;
    }
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const screen = Math.hypot(dx, dy) * zoomRef.current;
    if (screen < 2) {
      done?.();
      return;
    }
    const duration = Math.min(800, Math.max(300, 250 + screen * 0.6)) / rateRef.current;
    // The arc bows to one side by a tenth of the way.
    const control = { x: from.x + dx / 2 - dy * 0.1, y: from.y + dy / 2 + dx * 0.1 };
    let start = performance.now();
    let last = start;
    const step = (now: number) => {
      if (pausedRef.current) {
        start += now - last;
        last = now;
        frame.current = requestAnimationFrame(step);
        return;
      }
      last = now;
      const t = ease(Math.min(1, (now - start) / duration));
      move({
        x: (1 - t) * (1 - t) * from.x + 2 * (1 - t) * t * control.x + t * t * to.x,
        y: (1 - t) * (1 - t) * from.y + 2 * (1 - t) * t * control.y + t * t * to.y,
      });
      if (t < 1) frame.current = requestAnimationFrame(step);
      else done?.();
    };
    frame.current = requestAnimationFrame(step);
  };

  // A shape named while the arrow is being traced waits for the trace:
  // the arrow is what the stop is about, and is said first.
  const tracing = useRef(false);
  const waiting = useRef<MarkerPoint | undefined>(undefined);
  const [at, setAt] = useState<string>();
  // The highlight a restored step was already resting on. It is shown in
  // place. A later one (a hover, a step played again) still glides and taps.
  const settledPoint = useRef<string | undefined>(undefined);

  const pointAt = (target: MarkerPoint) => {
    cancelAnimationFrame(frame.current);
    setVisible(true);
    setAt(target.name);
    glide({ x: target.x, y: target.y }, () => setTap((count) => count + 1));
  };

  const placeAt = (target: MarkerPoint) => {
    cancelAnimationFrame(frame.current);
    setVisible(true);
    setAt(target.name);
    move({ x: target.x, y: target.y });
  };

  useEffect(() => {
    const gen = ++traceGen.current;
    const live = () => traceGen.current === gen;
    const finishTrace = () => {
      if (!live() || !trace) return;
      tracing.current = false;
      onTraceDoneRef.current?.(trace.key);
      const next = waiting.current;
      waiting.current = undefined;
      if (next) pointAt(next);
    };
    // The last hop's ink fades out as the stop moves on.
    const previous = inkRef.current;
    if (previous && previous.key !== trace?.key) {
      setFading({ d: previous.d, key: previous.key });
      setInk(undefined);
    }
    if (!trace) {
      if (!point) setVisible(false);
      return () => { traceGen.current += 1; };
    }
    const path = measure.current;
    if (!path) return () => { traceGen.current += 1; };
    cancelAnimationFrame(frame.current);
    path.setAttribute("d", trace.d);
    const length = path.getTotalLength();
    const begin = path.getPointAtLength(0);
    // A canvas we came back to shows the ink where it was left: not drawn
    // again from the start, and not filled out to the end.
    if (drawn !== undefined) {
      const t = Math.max(0, Math.min(1, drawn));
      const spot = path.getPointAtLength(length * t);
      tracing.current = false;
      setVisible(t > 0.02);
      setAt(trace.arrow);
      move({ x: spot.x, y: spot.y });
      setInk({ d: trace.d, length, drawn: t, key: trace.key });
      onDrawnRef.current?.(trace.key, t);
      if (t >= 1) onTraceDoneRef.current?.(trace.key);
      return () => { traceGen.current += 1; };
    }
    if (instantRef.current) {
      const end = path.getPointAtLength(length);
      tracing.current = false;
      setVisible(true);
      setAt(trace.arrow);
      move({ x: end.x, y: end.y });
      setInk({ d: trace.d, length, drawn: 1, key: trace.key });
      onDrawnRef.current?.(trace.key, 1);
      onTraceDoneRef.current?.(trace.key);
      return () => { traceGen.current += 1; };
    }
    tracing.current = true;
    setVisible(true);
    setAt(trace.arrow);
    // To the start of the arrow, then along it at a pace the eye can ride.
    glide({ x: begin.x, y: begin.y }, () => {
      if (!live()) return;
      const duration = Math.min(1600, Math.max(700, length * zoomRef.current * 2.2)) / rateRef.current;
      let start = performance.now();
      let last = start;
      setInk({ d: trace.d, length, drawn: 0, key: trace.key });
      onDrawnRef.current?.(trace.key, 0);
      const step = (now: number) => {
        if (!live()) return;
        if (pausedRef.current) {
          start += now - last;
          last = now;
          frame.current = requestAnimationFrame(step);
          return;
        }
        last = now;
        const t = ease(Math.min(1, (now - start) / duration));
        const spot = path.getPointAtLength(length * t);
        move({ x: spot.x, y: spot.y });
        setInk({ d: trace.d, length, drawn: t, key: trace.key });
        onDrawnRef.current?.(trace.key, t);
        if (t < 1) {
          frame.current = requestAnimationFrame(step);
          return;
        }
        finishTrace();
      };
      frame.current = requestAnimationFrame(step);
    });
    return () => {
      traceGen.current += 1;
      cancelAnimationFrame(frame.current);
    };
  }, [trace?.key, drawn]);

  useEffect(() => {
    if (!point) {
      waiting.current = undefined;
      // With nothing named and no hop, the marker steps away.
      if (!trace) setVisible(false);
      return;
    }
    if (tracing.current) {
      waiting.current = point;
      return;
    }
    // Ink restored from a canvas we left, or a finished step shown at
    // once: the highlight is already where the marker rests. Gliding and
    // tapping would play that gesture again.
    const resting = drawn !== undefined || instantRef.current;
    if (resting && settledPoint.current === undefined) {
      settledPoint.current = point.key;
      placeAt(point);
      return;
    }
    settledPoint.current = point.key;
    pointAt(point);
  }, [point?.key, drawn, instant]);

  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  useEffect(() => {
    if (!fading) return;
    const timer = setTimeout(() => setFading(undefined), 800);
    return () => clearTimeout(timer);
  }, [fading?.key]);

  const scale = 1 / zoom;
  return (
    <>
      <svg className="sketch-marker-ink sketch-no-export" style={{ position: "absolute", left: 0, top: 0, width: 1, height: 1, overflow: "visible", pointerEvents: "none" }}>
        <path ref={measure} d="M 0 0" fill="none" stroke="none" />
        {fading && <path key={fading.key} className="sketch-marker-ink-fade" d={fading.d} fill="none" style={{ stroke: ACCENT }} strokeWidth={4} strokeLinecap="round" opacity={0.75} />}
        {ink && <path className="sketch-marker-ink-line" data-drawn={ink.drawn.toFixed(3)} d={ink.d} fill="none" style={{ stroke: ACCENT }} strokeWidth={4} strokeLinecap="round" opacity={0.75} strokeDasharray={ink.length} strokeDashoffset={ink.length * (1 - ink.drawn)} />}
      </svg>
      {pos && (
        <div className="sketch-marker sketch-no-export" data-marker-at={at} style={{ position: "absolute", left: pos.x, top: pos.y, transform: `scale(${scale})`, transformOrigin: "0 0", opacity: visible ? 1 : 0, transition: "opacity 0.3s ease", pointerEvents: "none", zIndex: 6 }}>
          {tap > 0 && <span key={tap} className="sketch-marker-tap" />}
          <svg key={`pen-${tap}`} className={tap > 0 ? "sketch-marker-pen sketch-marker-press" : "sketch-marker-pen"} width="46" height="46" viewBox="0 0 46 46" style={{ position: "absolute", left: 0, top: 0, overflow: "visible" }}>
            {/* A whiteboard marker held from the lower right, its nib on the point. */}
            <g transform="scale(1.3) rotate(45 0 0)">
              <path d="M 0 0 L 5 -4 L 5 4 Z" fill="#5b3fd6" />
              <rect x="5" y="-6" width="8" height="12" rx="1.5" fill="#ffffff" stroke="#5b3fd6" strokeWidth="1.5" />
              <rect x="13" y="-7" width="30" height="14" rx="4" style={{ fill: ACCENT }} />
              <rect x="38" y="-7.5" width="9" height="15" rx="3" fill="#5b3fd6" />
            </g>
          </svg>
        </div>
      )}
    </>
  );
}
