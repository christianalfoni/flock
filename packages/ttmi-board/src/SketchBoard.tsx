// The board: boxes with labels, rich text notes, and free arrows.
// Everything is plain DOM inside one transformed "world" element, so the PNG
// export can clone that element into an SVG and paint it onto a canvas.
import type { Editor } from "@tiptap/react";
import { arrowMidpoint, bendThrough, externalHref, GROUP_GAP, groupRegion, hopEnds, MAX_NOTE_WIDTH, narrationParts, nearBox, parseSketch, portalLabelId, portalSketchId, referableNames, refitSketch, SEQ, regionMembers, sequenceCanvas, serializeSketch, startBoxes, stepView, type ArrowShape, type Color, type ContentBounds, type NoteShape, type Point, type RectShape, type Shape, type SketchGroup, type SketchStep, type SketchTerm } from "@ttmi/format";
import { Captions, CaptionsOff, ChevronLeft, ChevronRight, Maximize, MessageSquare, MousePointer2, MoveUpRight, Pause, Play, Redo2, RotateCcw, Square, Trash2, Type, Undo2, X } from "lucide-react";
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode, type RefObject } from "react";
import { ArrowSeq } from "./ArrowSeq";
import { exportPng, exportSvg } from "./export-png";
import { fontsReady, MONO } from "./fonts";
import { FormatBar } from "./FormatBar";
import { LabelEditor } from "./LabelEditor";
import { measurer } from "./measure";
import { GroupView } from "./GroupView";
import { cameraFollows, noteHeard, type HeardCursor, type HeardNote } from "./noteHeard";
import { NoteView, OPEN_SHIFT } from "./NoteView";
import { ShapeTag } from "./ShapeTag";
import { CanvasBadge, ExternalLink } from "./badge";
import { AskView, type AskPhase } from "./AskView";
import { askSummaryKey, firstCountedStep, indexForCountedStep } from "./ask";
import { arrowHead, arrowLine, arrowPath, arrowPoints, bounds, CLIPBOARD_TYPE, COLOR_NAMES, COLORS, DEFAULT_TEXT_SIZE, ON_COLORS, QUIET_COLORS, EDITABLE, escapeHtml, foldsNote, isBox, isConnector, isEmptyHtml, moveShape, placedByUser, shapeText, TEXT_SIZES, type Box, type Camera, type Drag, type SketchApi, type SketchImport, type Tool } from "./shapes";
import { layCanvases } from "./canvas-bounds";
import { HostWorld } from "./HostWorld";
import { layoutArrows } from "./present";
import { PortalInset, frameOfPortal, type PortalRecord } from "./PortalInset";
import { boxCenterOffset, centerBoxCamera, childCamera, divePanMs, DIVE_ZOOM_MS, enteredCamera, frameOffCamera, insetFlight, lerpCamera, nestOf, parentCamera, portalReach, type Placement } from "./portal-nest";
import { BACKGROUND, FOREGROUND, LIT, SKETCH_CSS } from "./styles";
import { Marker, type MarkerPoint, type MarkerTrace } from "./Marker";
import { focusCamera, frameCamera, type Area, type Rect } from "./camera";
import { CAMERA_GLIDE_MS, clearMoves, createPlaybackQueue, enqueueMove, finishMove, type PlaybackMove, type PlaybackQueue, type Started } from "./playbackQueue";
import { termAt, TermText, TermTip, type TermTipState } from "./terms";

// A playback camera move. A highlight keeps the name it points at so the
// camera can be framed again when the move actually starts.
type Framed = { camera: Camera; name?: string };
type CameraMove = PlaybackMove<Framed>;

function sameCamera(a: Camera, b: Camera) {
  return a.x === b.x && a.y === b.y && a.z === b.z;
}
// Where the walkthrough is (docs/board.md, Walkthrough): the overview and
// summary by name, a hop by its place among the hops, a step written with
// "step:" by its place among the steps.
export function stepTitle(steps: SketchStep[], at: number, first: number) {
  const step = steps[at]!;
  if (step.kind === "overview") return "Overview";
  if (step.kind === "summary") return "Summary";
  if (step.kind === "hop") {
    const hops = steps.filter((item) => item.kind === "hop");
    return `Step ${hops.indexOf(step) + 1}`;
  }
  return `Step ${at - first + 1}`;
}

// What the ready caption says before Play (docs/board.md, Walkthrough):
// the overview's first sentence, the why, as a teaser of the voice; how
// many stops there are; and roughly how long the words take to say, at
// about 140 words a minute with a pause between steps.
export function readyTeaser(steps: SketchStep[], referable: Set<string>) {
  const first = firstStep(steps);
  const overview = steps[0]?.kind === "overview" && steps[0].narration ? narrationParts(steps[0].narration, referable).map((part) => part.text).join("").trim() : "";
  const teaser = overview.match(/^.*?[.!?](?=\s|$)/s)?.[0] ?? overview;
  const hops = steps.filter((step) => step.kind === "hop").length;
  const count = hops || steps.length - first;
  const words = steps.slice(first).reduce((sum, step) => sum + (step.narration?.split(/\s+/).filter(Boolean).length ?? 0), 0);
  const seconds = words / 2.3 + (steps.length - first) * 0.6;
  const length = words === 0 ? "" : seconds < 45 ? "under a minute" : `about ${Math.round(seconds / 60) || 1} min`;
  return { teaser, meta: [`${count} ${count === 1 ? "step" : "steps"}`, length].filter(Boolean).join(" · ") };
}

// The step a walkthrough starts at: an overview with no words is the
// ready state's whole drawing already, so the walkthrough starts after it
// (docs/board.md, Walkthrough).
export function firstStep(steps: SketchStep[]) {
  return firstCountedStep(steps);
}

// The camera the ready caption will use, measured with a caption of the
// same height, so a zoom into a canvas can finish on it instead of
// fitting the whole sketch and then moving again.
function readyCamera(root: HTMLElement, shapes: Shape[], steps: SketchStep[], groups: SketchGroup[]): Camera | undefined {
  const box = bounds(shapes.filter((shape) => shape.kind !== "arrow"));
  if (!box || steps.length === 0) return undefined;
  const rect = root.getBoundingClientRect();
  const probe = readyCaptionProbe(steps, shapes, groups);
  root.appendChild(probe);
  const top = probe.getBoundingClientRect().top;
  probe.remove();
  return frameCamera(box, { width: rect.width, height: Math.max(1, top - rect.top - 20) });
}

function readyCaptionProbe(steps: SketchStep[], shapes: Shape[], groups: SketchGroup[]) {
  const { teaser, meta } = readyTeaser(steps, referableNames(shapes.filter(isBox), groups));
  const caption = document.createElement("div");
  caption.className = "sketch-chrome sketch-steps sketch-steps-ready";
  caption.style.visibility = "hidden";
  const row = document.createElement("div");
  row.className = "sketch-caption sketch-caption-ready";
  const balance = document.createElement("span");
  balance.className = "sketch-ready-balance";
  const body = document.createElement("div");
  body.className = "sketch-ready-body";
  if (teaser) {
    const line = document.createElement("p");
    line.className = "sketch-ready-teaser";
    line.textContent = `“${teaser}”`;
    body.appendChild(line);
  }
  const play = document.createElement("div");
  play.className = "sketch-ready-play";
  const button = document.createElement("button");
  button.className = "sketch-start";
  button.textContent = "Play";
  const key = document.createElement("kbd");
  key.textContent = "Space";
  button.appendChild(key);
  play.appendChild(button);
  const note = document.createElement("span");
  note.className = "sketch-ready-meta";
  note.textContent = meta;
  play.appendChild(note);
  body.appendChild(play);
  const end = document.createElement("div");
  end.className = "sketch-step-end";
  const close = document.createElement("button");
  close.className = "sketch-step-close";
  end.appendChild(close);
  row.append(balance, body, end);
  const progress = document.createElement("div");
  progress.className = "sketch-step-progress";
  for (const step of steps.slice(firstStep(steps))) {
    const mark = document.createElement("span");
    if (step.kind) mark.dataset.kind = step.kind;
    progress.appendChild(mark);
  }
  caption.append(row, progress);
  return caption;
}

// The camera a step will use, measured with a caption of that step's
// height, so a zoom into a canvas can finish on it and start playing
// without the picture moving again.
function stepLandingCamera(root: HTMLElement, shapes: Shape[], steps: SketchStep[], groups: SketchGroup[], index: number, withVoice: boolean): Camera | undefined {
  const step = steps[index];
  if (!step) return undefined;
  const ids = new Set(stepView(shapes, steps, index, groups).highlighted);
  const whole = Boolean(step.kind) && ids.size === 0;
  const named = !whole && !withVoice ? firstNote(namedIn(step, shapes, groups), shapes) : undefined;
  if (named) ids.add(named.id);
  const box = bounds(shapes.filter((shape) => (whole ? shape.kind !== "arrow" : ids.has(shape.id))).map((shape) => (shape.kind === "note" && foldsNote(shape) && !whole ? { ...shape, x: shape.x + OPEN_SHIFT.x, y: shape.y + OPEN_SHIFT.y } : shape)));
  if (!box) return undefined;
  const probe = stepCaptionProbe(steps, index);
  root.appendChild(probe);
  const top = probe.getBoundingClientRect().top;
  probe.remove();
  const rect = root.getBoundingClientRect();
  return frameCamera(box, { width: rect.width, height: Math.max(1, top - rect.top - 20) });
}

function stepCaptionProbe(steps: SketchStep[], index: number) {
  const step = steps[index]!;
  const caption = document.createElement("div");
  caption.className = "sketch-chrome sketch-steps";
  caption.style.visibility = "hidden";
  const body = document.createElement("div");
  body.className = "sketch-caption";
  const top = document.createElement("div");
  top.className = "sketch-step-top";
  const end = document.createElement("div");
  end.className = "sketch-step-end";
  const close = document.createElement("button");
  close.className = "sketch-step-close";
  end.appendChild(close);
  top.appendChild(end);
  const column = document.createElement("div");
  column.className = "sketch-narration-column";
  if (step.narration) {
    const line = document.createElement("p");
    line.className = "sketch-narration";
    line.textContent = step.narration;
    column.appendChild(line);
  }
  body.append(top, column);
  const foot = document.createElement("div");
  foot.className = "sketch-step-foot";
  const title = document.createElement("span");
  title.className = "sketch-step-title";
  title.textContent = "Step 1";
  const progress = document.createElement("div");
  progress.className = "sketch-step-progress";
  for (const item of steps.slice(firstStep(steps))) {
    const mark = document.createElement("span");
    if (item.kind) mark.dataset.kind = item.kind;
    progress.appendChild(mark);
  }
  const controls = document.createElement("div");
  controls.className = "sketch-step-controls";
  const speed = document.createElement("div");
  speed.className = "sketch-speed";
  const button = document.createElement("button");
  button.textContent = "1×";
  speed.appendChild(button);
  controls.appendChild(speed);
  for (let n = 0; n < 3; n++) controls.appendChild(document.createElement("button"));
  foot.append(title, progress, controls);
  caption.append(body, foot);
  return caption;
}

const TOOLS: { id: Tool; key: string; label: string; icon: typeof Square }[] = [
  { id: "select", key: "v", label: "Select", icon: MousePointer2 },
  { id: "rect", key: "r", label: "Box", icon: Square },
  { id: "note", key: "t", label: "Text", icon: Type },
  { id: "arrow", key: "a", label: "Arrow", icon: MoveUpRight },
];

export function SketchBoard({ initial, initialSteps = [], initialGroups = [], initialTerms = [], title, importing, readOnly = false, onSave, onApi, onImported, onSelection, onOpenLink, onHost, onBack, portals, onPlaying, onStepPress, onPlayback, onReplay, caption, preparing, standby, waiting, stepFill, pointing, holding, quiet = false, onQuiet, voiced = false, topLeft, topRight, stepEnd, speedControl, playbackRate = 1, onAsk, ask, panelHeader, startLabel }: {
  initial: Shape[];
  // The walkthrough the sketch text gave, if any.
  initialSteps?: SketchStep[];
  // The groups the sketch text gave, if any (docs/board.md, Shapes).
  initialGroups?: SketchGroup[];
  // The terms the sketch text gave, if any (docs/board.md, Terms).
  initialTerms?: SketchTerm[];
  title?: string;
  importing?: SketchImport;
  // View only, for a colleague's sketch (docs/plan-organizations.md): the
  // drawing is looked at, selected, played and panned, never changed. No
  // tools, no handles, no editing; imports still apply, for pending updates.
  readOnly?: boolean;
  onSave(shapes: Shape[], steps: SketchStep[], groups: SketchGroup[], terms: SketchTerm[]): void;
  onApi(api?: SketchApi): void;
  // Called once an import is applied, with the reason when it could not be.
  onImported?(error?: string): void;
  // Called whenever the selection changes, with the selected shapes.
  onSelection?(shapes: Shape[]): void;
  // Called with the sketch id and the portal's place on screen when the
  // canvas is clicked (docs/plan-portals.md). Without it the canvas is
  // shown but inert. portals: what this reader may know about each target.
  onOpenLink?(id: string, from: { x: number; y: number; w: number; h: number }): void;
  // The sketch the board is showing as its own root: the child after the
  // zoom-in swap, or null while the page's sketch is on the board.
  onHost?(sketchId: string | null): void;
  // Esc after the walkthrough is closed, while this board is a canvas the
  // reader zoomed into: the same as Back (docs/plan-portals.md).
  onBack?(): void;
  portals?: Readonly<Record<string, PortalRecord>>;
  // The walkthrough's step on screen as it changes, undefined when it
  // closes; the page speaks it (docs/plan-voice.md, The board).
  onPlaying?(step: number | undefined): void;
  // The reader's press (Space, an arrow, Play, the step buttons) moves to
  // this step: called inside the press, before the board moves, so the
  // page can start the step's voice while the browser counts it as the
  // reader's own (docs/plan-voice.md, Playback).
  onStepPress?(step: number): void;
  // The step on screen is held (true) or sounding again (false). The page
  // pauses the voice; the board knows nothing of it.
  onPlayback?(paused: boolean): void;
  // The reader asked to hear the step on screen again. The page restarts
  // its voice; the board restarts the beat.
  onReplay?(): void;
  // The page's playback-speed control, in the walkthrough caption. The
  // board does not own the choice.
  speedControl?: ReactNode;
  // How fast a silent step runs. A voice follows the audio instead.
  playbackRate?: number;
  // The page's own line in the caption, after the narration: whether the
  // step's voice is still being made.
  caption?: ReactNode;
  // How much of the step on screen is said (the accent fills its segment
  // as it is spoken, and it turns green once said to its end; undefined
  // fills it at once). Read every frame while
  // the walkthrough is open, so the board does not render for it.
  stepFill?(step: number): { said?: number };
  // In place of Play while the walkthrough's voice is made, before it
  // starts (docs/board.md, Walkthrough): the page's own progress fills the
  // ready caption, its border waves, and Play and Space wait.
  preparing?: ReactNode;
  // In that same place when the voice is not installed yet: the page's
  // ask, without the preparing wave. Play and Space wait, as they do
  // while the voice is made.
  standby?: ReactNode;
  // In place of a step's words while its voice is made, once the
  // walkthrough plays: asked about the step on screen, which the page hears
  // of only after it is drawn, so its words never flash before the wait.
  waiting?: { step(step: number): boolean; view: ReactNode };
  // The shape or group the voice is saying words about now, from the
  // step's references (docs/plan-voice-cues.md): highlighted like a hover
  // on those words.
  pointing?: string;
  // Whether a step's voice is not ready yet: the marker holds back, so the
  // stop starts with its words (docs/board.md, Marker). Asked about the
  // step on screen, which the page hears of only after it is drawn.
  holding?(step: number): boolean;
  // The caption without the step's words, while a voice says them
  // (docs/plan-quiet-caption.md): reading along pulls the eye off the
  // sketch. With onQuiet the caption has a button to show or hide them.
  quiet?: boolean;
  onQuiet?(quiet: boolean): void;
  // A voice says the steps: a note a walkthrough's narration names opens
  // when its words are said. Without one, it opens with the stop
  // (docs/format.md, Walkthrough).
  voiced?: boolean;
  // The page's own chrome in the top corners: top-left stays while the
  // walkthrough plays (where you are), top-right sits next to Play and hides
  // with the toolbar. The toolbar centres itself between the two.
  topLeft?: ReactNode;
  topRight?: ReactNode;
  // The page's own buttons on the step bar while the walkthrough plays,
  // before Ask: top-right is hidden then.
  stepEnd?: ReactNode;
  // C or the Ask button. The page opens the question. Absent when this
  // reader cannot ask (a public link, or a try).
  onAsk?(): void;
  // The ask panel, while a question is being written, is waiting, or has
  // been answered. Replaces the narration.
  ask?: {
    phase: AskPhase;
    question: string;
    copied: boolean;
    summary?: string;
    onQuestion(value: string): void;
    onCopy(): void;
    onCancel(): void;
    onClose(): void;
    onContinue(): void;
    // The host's own view of the ask while it waits or is answered (Flock
    // draws the question, its agent at work and the answer itself). The
    // board keeps the panel, its place and its keys.
    view?: ReactNode;
  };
  // A line the host puts at the top of the walkthrough's panel, ready or
  // playing (Flock: who is at work, what is new).
  panelHeader?: ReactNode;
  // What the ready panel's Play says (Flock: "Play what's new").
  startLabel?: string;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const topLeftRef = useRef<HTMLDivElement>(null);
  const topRightRef = useRef<HTMLDivElement>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  // The toolbar's rows one under the other, when the corners leave no room
  // for them side by side.
  const [stacked, setStacked] = useState(false);
  const [viewSize, setViewSize] = useState({ w: 0, h: 0 });
  const worldRef = useRef<HTMLDivElement>(null);
  const [shapes, setShapes] = useState(initial);
  const [steps, setSteps] = useState(initialSteps);
  const stepsRef = useRef(steps);
  stepsRef.current = steps;
  const [groups, setGroups] = useState(initialGroups);
  const groupsRef = useRef(groups);
  groupsRef.current = groups;
  const [terms, setTerms] = useState(initialTerms);
  const termsRef = useRef(terms);
  termsRef.current = terms;
  // The definition shown for the term under the pointer.
  const [termTip, setTermTip] = useState<TermTipState>();
  // The step on screen while playing the walkthrough; undefined shows the
  // whole drawing, as always outside it.
  const [playing, setPlaying] = useState<number>();
  const playingRef = useRef(playing);
  playingRef.current = playing;
  // The walkthrough is open before its first step: the whole drawing with
  // the caption waiting for Space or Play (docs/board.md, Walkthrough).
  const [ready, setReady] = useState(false);
  const readyRef = useRef(ready);
  readyRef.current = ready;
  // The page's voice is made first: until then the walkthrough waits.
  const preparingRef = useRef(Boolean(preparing || standby));
  preparingRef.current = Boolean(preparing || standby);
  // In the walkthrough, ready or at a step: the board is for looking.
  const walking = () => playingRef.current !== undefined || readyRef.current;
  // The width each box is drawn at this render: an open note is wider than
  // its shape (docs/board.md, Notes fold). The PNG export uses it.
  const drawnRef = useRef(new Map<string, Box>());
  const [camera, setCameraState] = useState<Camera>({ x: 40, y: 40, z: 1 });
  // Whether the camera has been placed yet: until then the drawing is
  // hidden, so a sketch opens where it settles instead of zooming there
  // in front of the reader. The reader's own press places it too.
  const [placed, setPlaced] = useState(false);
  const placedRef = useRef(placed);
  placedRef.current = placed;
  const [tool, setTool] = useState<Tool>("select");
  const [selected, setSelected] = useState<string[]>([]);
  const [editing, setEditing] = useState<string>();
  // The shape whose tag is being typed in.
  const [editingTag, setEditingTag] = useState<string>();
  // The arrow whose number is being typed, and the one whose badge the
  // pointer is over, which lights that arrow and dims the rest.
  const [editingSeq, setEditingSeq] = useState<string>();
  const [hoveredSeq, setHoveredSeq] = useState<string>();
  const [hoveredArrow, setHoveredArrow] = useState<string>();
  // The mask that breaks arrows at group edges, by an id of this board's.
  const gapMask = `sketch-gaps-${useId().replace(/:/g, "")}`;
  // The reference in the caption the pointer is on (docs/plan-voice-cues.md).
  const [hoveredRef, setHoveredRef] = useState<string>();
  // A stop change folds what the pointer was holding open, in this render,
  // before the new stop is painted.
  const hoverStop = useRef(playing);
  if (hoverStop.current !== playing) {
    hoverStop.current = playing;
    if (hoveredRef !== undefined) setHoveredRef(undefined);
  }
  // The note the voice named on this stop (docs/format.md, Walkthrough).
  // Kept with the stop it was named on, so a cue or a measurement from
  // the stop just left cannot open it again.
  const [saidNote, setSaidNote] = useState<HeardNote>();
  const saidNoteRef = useRef(saidNote);
  saidNoteRef.current = saidNote;
  const heardCursor = useRef<HeardCursor>({ playing: undefined, pointing: undefined });
  // The pointing the camera last followed, with the stop it belonged to.
  // One still set from the stop just left is not followed again.
  const followedPointing = useRef<HeardCursor>({ playing: undefined, pointing: undefined });
  const voicedRef = useRef(voiced);
  voicedRef.current = voiced;
  // The highlight a canvas was left on, until the narration says so again.
  const [keptPointing, setKeptPointing] = useState<string | undefined>();
  const aim = pointing ?? keptPointing;
  // The size of the note the voice names, so the camera follows it open.
  const pointedSize = aim ? shapes.filter((shape): shape is NoteShape => shape.kind === "note" && shape.name === aim).map((shape) => `${shape.w}x${shape.h}`).join() : "";
  // The folding notes drawn open (docs/board.md, Notes fold): opened by a
  // click or the chevron, folded by the chevron, Esc or a click on the
  // canvas. View state, never stored.
  const [opened, setOpened] = useState<ReadonlySet<string>>(new Set());
  // While playing, the notes the viewer opened or folded at this step,
  // over the one the step opens; a new step clears them.
  const [stepFolds, setStepFolds] = useState<ReadonlyMap<string, boolean>>(new Map());
  // The viewer's own open or fold holds for this stop only, and is dropped
  // in the render that leaves it, before the new stop is painted.
  const foldsStop = useRef(playing);
  if (foldsStop.current !== playing) {
    foldsStop.current = playing;
    if (stepFolds.size > 0) setStepFolds(new Map());
  }
  const [marquee, setMarquee] = useState<{ a: Point; b: Point }>();
  const [style, setStyle] = useState<{ color: Color }>({ color: "white" });
  const [panning, setPanning] = useState(false);
  // The editor of the note being written in, for the formatting buttons.
  const [noteEditor, setNoteEditor] = useState<Editor>();
  // Ask (docs/board.md, Ask): the page owns the question and the stored
  // ask. While `ask` is set, the caption is that panel.
  const askRef = useRef(ask);
  askRef.current = ask;
  const onAskRef = useRef(onAsk);
  onAskRef.current = onAsk;
  const askFieldRef = useRef<HTMLTextAreaElement>(null);
  const asking = Boolean(ask);

  const shapesRef = useRef(shapes);
  shapesRef.current = shapes;
  // The bend under the pointer, drawn as it is so the curve follows the drag.
  const [bendPin, setBendPin] = useState<{ id: string; bend: number } | undefined>();
  // Measured label backings. The estimate stands until the fonts are in.
  const [labelSizes, setLabelSizes] = useState<ReadonlyMap<string, { w: number; h: number }>>(new Map());
  const arrowLayoutRef = useRef<ReturnType<typeof layoutArrows> | undefined>(undefined);
  const labelMeasureKey = shapes.map((shape) => (shape.kind === "arrow" && (shape.label || shape.seq) ? `${shape.id}\0${shape.label ?? ""}\0${shape.seq ?? ""}` : "")).filter(Boolean).join("\n");
  useLayoutEffect(() => {
    let cancel = false;
    const run = () => {
      if (cancel) return;
      const world = worldRef.current;
      if (!world) return;
      const measure = measurer(world);
      const next = new Map<string, { w: number; h: number }>();
      for (const shape of shapesRef.current) {
        if (shape.kind === "arrow" && (shape.label || shape.seq) && measure.label) next.set(shape.id, measure.label(shape.label ?? "", shape.seq));
      }
      measure.done();
      setLabelSizes((prev) => {
        if (prev.size !== next.size) return next;
        for (const [id, size] of next) {
          const had = prev.get(id);
          if (!had || had.w !== size.w || had.h !== size.h) return next;
        }
        return prev;
      });
    };
    run();
    void fontsReady().then(run);
    return () => { cancel = true; };
  }, [labelMeasureKey]);
  const cameraRef = useRef(camera);
  // Playback camera moves, and the generation a user action bumps so a
  // glide that was already timed does not start the next one.
  const playbackQueue = useRef<PlaybackQueue<Framed>>(createPlaybackQueue());
  const playbackGen = useRef(0);
  const traceFinished = useRef<string | undefined>(undefined);
  const interruptRef = useRef<() => void>(() => {});
  const clearQueueRef = useRef<() => void>(() => {});
  const editingRef = useRef(editing);
  editingRef.current = editing;
  const drag = useRef<Drag>(undefined);
  const past = useRef<Shape[][]>([]);
  const future = useRef<Shape[][]>([]);
  const dirty = useRef(false);
  const spaceDown = useRef(false);
  const saveRef = useRef(onSave);
  saveRef.current = onSave;
  const titleRef = useRef(title);
  titleRef.current = title;
  const onSelectionRef = useRef(onSelection);
  onSelectionRef.current = onSelection;
  useEffect(() => {
    onSelectionRef.current?.(shapesRef.current.filter((shape) => selected.includes(shape.id)));
  }, [selected]);

  const portalsRef = useRef(portals);
  const rawPortalsRef = useRef(portals);
  rawPortalsRef.current = portals;
  // Inset layouts measured with the board's own measurer and every nested
  // canvas name. The swap reuses them, so a box does not grow when the
  // sketch becomes the root, and coming back measures nothing again.
  const portalFitRef = useRef(new Map<string, { key: string; titlesKey: string; shapes: Shape[] }>());
  const portalSeenRef = useRef(new Map<string, number>());
  // Child bounds a sketch was first drawn with. A later load of the same
  // sketch does not change the box, including through a zoom.
  const boundsLock = useRef(new Map<string, Record<string, ContentBounds>>());
  const boundsRef = useRef<Record<string, ContentBounds>>({});
  const boundsReady = useRef(new Set<string>());
  const rootBoundsSeen = useRef(0);
  const [boundsEpoch, setBoundsEpoch] = useState(0);
  // Insets already shown. A later mount (zooming back) must not fade again.
  const revealedRef = useRef(new Set<string>());
  const [portalFitTick, setPortalFitTick] = useState(0);
  const drawnPortals = useMemo(() => withFittedPortals(portals, portalFitRef.current), [portals, portalFitTick]);
  portalsRef.current = drawnPortals;
  // Levels under the one on screen. Each remembers the world to restore,
  // the camera to zoom back to, where its child sat inside it, and the
  // walkthrough as it was left: the step, how far its arrow was drawn,
  // and which steps had already finished.
  type WalkSnap = { ready: boolean; playing?: number; beat?: "playing" | "paused" | "done"; trace?: { key: string; drawn: number }; pointing?: string };
  type Host = { id: string | null; shapes: Shape[]; steps: SketchStep[]; groups: SketchGroup[]; terms: SketchTerm[]; camera: Camera; place: Placement; finished: number[]; walk: WalkSnap };
  const hostStack = useRef<Host[]>([]);
  // The parent drawing popped for a zoom out, so a save during the flight
  // still writes that parent and not the picture on screen.
  const zoomHold = useRef<Host | null>(null);
  // Back to a step this canvas was left on. A finished step stays finished;
  // one still going waits, paused.
  const holdRestore = useRef(false);
  const restoreBeat = useRef<"playing" | "paused" | "done">("paused");
  // ?step= opens that stop already paused, the same way a restored step waits.
  const openPaused = useRef(false);
  // Steps whose beat has finished. Going back to one shows it finished
  // and does not play it again.
  const finishedSteps = useRef(new Set<number>());
  const showFinished = useRef(false);
  // Bumped when a canvas is entered. Its first step then starts even when
  // that step's index is the one already on screen: a parent left on step
  // 1 and a child that starts on step 1 are the same number, and nothing
  // else would rerun the beat.
  const [entry, setEntry] = useState(0);
  const [barInstant, setBarInstant] = useState(false);
  // Read by the step's opening move, which can run in the same turn as
  // setBarInstant (Space replays a step that was restored finished).
  const barInstantRef = useRef(false);
  barInstantRef.current = barInstant;
  // The arrow ink to show when a canvas is restored, instead of drawing
  // it again. A finished step is complete; one left mid-stroke stays
  // where it was. The highlight the narration was on.
  const [frozenTrace, setFrozenTrace] = useState<{ key: string; drawn: number } | undefined>();
  // How far the arrow on screen is drawn, so leaving can put it back.
  const traceNow = useRef<{ key: string; drawn: number } | undefined>(undefined);
  // The step the zoom just landed on, or the one a canvas was left on:
  // its camera is already there, so the step must not glide again.
  const landedOn = useRef<number | undefined>(undefined);
  // The camera restored with a canvas stays put. A later step, or Space
  // resuming, may move it again.
  const keepCamera = useRef(false);
  const hostWorldRef = useRef<HTMLDivElement>(null);
  const [hostPicture, setHostPicture] = useState<{ shapes: Shape[]; groups: SketchGroup[] } | null>(null);
  // Last flight frames, then the frames after the swap. The test reads them.
  const zoomTrack = useRef<{ phase: string; shapes: Record<string, { x: number; y: number; w: number; h: number }> }[]>([]);
  const trackAfter = useRef(0);
  const adoptedRef = useRef<string | null>(null);
  // Canvases the reader has dived into during this tour. The up arrow
  // skips these. Drawn on an earlier step does not count (docs/plan-portals.md).
  const enteredCanvases = useRef(new Set<string>());
  const phaseRef = useRef<"idle" | "in" | "out" | "settled">("idle");
  const onHostRef = useRef(onHost);
  onHostRef.current = onHost;
  const onBackRef = useRef(onBack);
  onBackRef.current = onBack;
  const onOpenLinkRef = useRef(onOpenLink);
  onOpenLinkRef.current = onOpenLink;
  const playbackRateRef = useRef(playbackRate);
  playbackRateRef.current = playbackRate;
  const focusShapesRef = useRef<Shape[] | null>(null);
  const focusGroupsRef = useRef<SketchGroup[] | null>(null);
  const [focusShapes, setFocusShapes] = useState<Shape[] | null>(null);
  const [focusGroups, setFocusGroups] = useState<SketchGroup[] | null>(null);
  const [entered, setEntered] = useState(false);
  const [portalGlide, setPortalGlide] = useState(false);
  const [portalTravel, setPortalTravel] = useState<"in" | "out" | "pan" | undefined>();
  const [portalFade, setPortalFade] = useState(false);
  const zoomGen = useRef(0);
  // While zooming out, the picture is this camera. React's own camera stays
  // at the equivalent view until the glide ends, and a layout pass writes
  // this one over it so a render in the middle cannot jump the picture.
  const glideVisual = useRef<Camera | null>(null);
  // The zoom in flight. The world camera pushes the canvas border off
  // screen while the inset is moved so the picture tracks `content`.
  // A layout pass writes it over React, so a render cannot jump the picture.
  const flightRef = useRef<{ world: Camera; content: Camera; inset: { x: number; y: number; s: number }; rim: number; place: Placement; chrome?: { border: string; background: string } } | null>(null);
  // The dive is still only panning the box to the middle. Back from there
  // has not faded the parent, so the return must not cut those shapes out.
  const centeringPan = useRef(false);
  // The parent's camera, applied only once the parent shapes have committed.
  // Writing it while the child is still the picture paints that canvas at
  // the parent scale for a frame: the zoom-out's blink.
  const landedCamera = useRef<Camera | null>(null);
  const [openPortalId, setOpenPortalId] = useState<string>();
  function setCamera(next: Camera) {
    cameraRef.current = next;
    setCameraState(next);
    place();
  }
  function place() {
    placedRef.current = true;
    setPlaced(true);
  }

  // A board that opens with a drawing places its camera before the first
  // paint: the whole drawing, as large as fits. One with steps waits for
  // the walkthrough to frame it, though not for ever (a page that never
  // opens it).
  useLayoutEffect(() => {
    if (!initial.length) return;
    if (!initialSteps.length) {
      zoomToFit(4);
      return;
    }
    const timer = setTimeout(() => {
      if (!placedRef.current) zoomToFit(4);
    }, 1500);
    return () => clearTimeout(timer);
  }, []);

  // Every change to the drawing goes through here, so it gets saved.
  function change(update: (current: Shape[]) => Shape[]) {
    dirty.current = true;
    setShapes(update);
  }

  // Remembers the drawing as it is now, for undo.
  function checkpoint() {
    past.current.push(shapesRef.current);
    if (past.current.length > 100) past.current.shift();
    future.current = [];
  }

  function restore(from: RefObject<Shape[][]>, to: RefObject<Shape[][]>) {
    const previous = from.current.pop();
    if (!previous) return;
    to.current.push(shapesRef.current);
    setEditing(undefined);
    setSelected([]);
    change(() => previous);
  }

  function heldHost() {
    if (phaseRef.current === "in") return hostStack.current[hostStack.current.length - 1];
    if (phaseRef.current === "out") return zoomHold.current ?? undefined;
    return undefined;
  }
  useEffect(() => {
    if (!dirty.current) return;
    const timer = setTimeout(() => {
      dirty.current = false;
      // Mid zoom the picture is the child. Save the parent world.
      const diving = heldHost();
      saveRef.current(diving?.shapes ?? shapesRef.current, diving?.steps ?? stepsRef.current, diving?.groups ?? groupsRef.current, diving?.terms ?? termsRef.current);
    }, 600);
    return () => clearTimeout(timer);
  }, [shapes, steps, groups, terms]);

  useEffect(() => () => {
    if (!dirty.current) return;
    const diving = heldHost();
    saveRef.current(diving?.shapes ?? shapesRef.current, diving?.steps ?? stepsRef.current, diving?.groups ?? groupsRef.current, diving?.terms ?? termsRef.current);
  }, []);

  // Each group's region around its member boxes on the board (a group of
  // notes alone: the notes, at their drawn widths), for the PNG export's
  // bounds.
  // The shapes as drawn: notes as wide as they are on the board.
  const drawnShapes = () => shapesRef.current.map((shape) => (shape.kind === "note" ? (drawnRef.current.get(shape.id) as NoteShape | undefined) ?? shape : shape));
  const groupRegions = () => groupsRef.current.flatMap((group) => {
    const members = regionMembers(group, shapesRef.current.filter(isBox)).map((shape) => drawnRef.current.get(shape.id) ?? shape);
    return members.length ? [groupRegion(members)] : [];
  });

  useEffect(() => {
    onApi({
      toPng: () => exportPng(worldRef.current, drawnShapes(), groupRegions()),
      toSvg: async () => (await exportSvg(worldRef.current, drawnShapes(), groupRegions()))?.svg,
      toSketch: () => {
        const { text, names } = serializeSketch(shapesRef.current, titleRef.current, stepsRef.current, groupsRef.current, termsRef.current);
        // Keep the names handed out, so the next export uses the same ones.
        if (shapesRef.current.some((shape) => names.has(shape.id) && shape.kind !== "arrow" && shape.name !== names.get(shape.id))) {
          change((current) => current.map((shape) => (shape.kind !== "arrow" && names.has(shape.id) ? { ...shape, name: names.get(shape.id) } : shape)));
        }
        return text;
      },
      import: async (text, play) => {
        const error = await queueImport(text, play);
        return error ? { error } : {};
      },
      play: () => {
        if (stepsRef.current.length) play();
      },
      openAt: (step) => openAt(step),
      playFrom: (step) => playFrom(step),
      start: () => {
        if (stepsRef.current.length) start();
      },
      next: () => {
        const at = playingRef.current;
        if (at === undefined || at >= stepsRef.current.length - 1) return;
        clearQueueRef.current();
        setPlaying(at + 1);
      },
      replace: (shapes, steps, groups, terms) => replaceRef.current(shapes, steps, groups, terms),
      setTerms: (next) => {
        termsRef.current = next;
        dirty.current = true;
        setTerms(next);
      },
      getCamera: () => cameraRef.current,
      setPortalFocus: (sketchId) => setPortalFocusRef.current(sketchId),
      setCanvases: (canvases) => {
        const cards: Record<string, PortalRecord> = { ...rawPortalsRef.current };
        for (const [id, item] of Object.entries(canvases)) {
          cards[id] = {
            status: "open",
            ...(item.w && item.h && item.w > 0 && item.h > 0 ? { bounds: { w: item.w, h: item.h } } : {}),
            ...(item.source ? { source: item.source } : {}),
          };
        }
        rawPortalsRef.current = cards;
        portalsRef.current = cards;
      },
      settled: async () => {
        await importQueue.current;
        // React commits the last change, then the browser lays it out.
        for (let frame = 0; frame < 2; frame += 1) await new Promise((resolve) => requestAnimationFrame(resolve));
      },
    });
    return () => onApi(undefined);
  }, []);

  // The board as saved elsewhere takes the place of this one (SketchApi,
  // replace): nothing to save, nothing to undo back to, the view where it
  // is. Declined while this board has changes of its own waiting to be
  // saved, since that save overwrites what arrived.
  function replaceBoard(shapes: Shape[], steps: SketchStep[], groups: SketchGroup[], terms: SketchTerm[] = []) {
    if (dirty.current) return false;
    // A snapshot of the page's sketch arrives while a child is the board.
    // Keep it for the zoom back out; the screen stays the child.
    if (adoptedRef.current || phaseRef.current === "in" || phaseRef.current === "out") {
      const root = hostStack.current.find((item) => item.id === null);
      if (root) {
        root.shapes = shapes;
        root.steps = steps;
        root.groups = groups;
        root.terms = terms;
      }
      return true;
    }
    const ids = new Set(shapes.map((shape) => shape.id));
    if (editingRef.current && !ids.has(editingRef.current)) setEditing(undefined);
    setSelected((current) => current.filter((id) => ids.has(id)));
    setOpened((current) => new Set([...current].filter((id) => ids.has(id))));
    past.current = [];
    future.current = [];
    shapesRef.current = shapes;
    termsRef.current = terms;
    setShapes(shapes);
    setTerms(terms);
    stepsRef.current = steps;
    groupsRef.current = groups;
    setSteps(steps);
    setGroups(groups);
    if (playingRef.current !== undefined) setPlaying(steps.length ? Math.min(playingRef.current, steps.length - 1) : undefined);
    if (!steps.length) setReady(false);
    return true;
  }
  const replaceRef = useRef(replaceBoard);
  replaceRef.current = replaceBoard;

  // Two-finger scroll pans; pinch (or Cmd+scroll) zooms around the pointer.
  useEffect(() => {
    const root = rootRef.current!;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      viewUntouched.current = false;
      interruptRef.current();
      const current = cameraRef.current;
      if (event.ctrlKey || event.metaKey) {
        const rect = root.getBoundingClientRect();
        const z = Math.min(4, Math.max(0.2, current.z * Math.exp(-event.deltaY * 0.01)));
        const mx = event.clientX - rect.left;
        const my = event.clientY - rect.top;
        setCamera({ z, x: mx - (mx - current.x) * z / current.z, y: my - (my - current.y) * z / current.z });
      } else {
        setCamera({ ...current, x: current.x - event.deltaX, y: current.y - event.deltaY });
      }
    };
    root.addEventListener("wheel", onWheel, { passive: false });
    return () => root.removeEventListener("wheel", onWheel);
  }, []);

  function toWorld(event: { clientX: number; clientY: number }): Point {
    const rect = rootRef.current!.getBoundingClientRect();
    const current = cameraRef.current;
    return { x: (event.clientX - rect.left - current.x) / current.z, y: (event.clientY - rect.top - current.y) / current.z };
  }

  function select(ids: string[]) {
    setSelected(ids);
    const only = ids.length === 1 ? shapesRef.current.find((shape) => shape.id === ids[0]) : undefined;
    if (only) setStyle({ color: only.color });
  }

  // Leaves text editing. A note left empty is removed.
  function stopEditing() {
    const id = editingRef.current;
    if (!id) return;
    setEditing(undefined);
    change((current) => current.filter((shape) => !(shape.id === id && shape.kind === "note" && isEmptyHtml(shape.html))));
  }

  function startEditing(id: string) {
    checkpoint();
    select([id]);
    setEditing(id);
    // A note stays open once the editing ends.
    setOpened((current) => (current.has(id) ? current : new Set(current).add(id)));
  }

  // The chevron on a folding note: open it, or fold it again. While
  // playing, only for this step.
  function toggleFold(id: string, open: boolean) {
    if (playingRef.current !== undefined) {
      setStepFolds((current) => {
        const next = foldsStop.current === playingRef.current ? new Map(current) : new Map();
        next.set(id, !open);
        return next;
      });
      return;
    }
    if (editingRef.current === id) stopEditing();
    setOpened((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function addNote(point: Point) {
    checkpoint();
    const note: NoteShape = { kind: "note", id: crypto.randomUUID(), x: point.x, y: point.y - 12, w: 280, h: 30, color: style.color, html: "" };
    change((current) => [...current, note]);
    select([note.id]);
    setEditing(note.id);
    setTool("select");
  }

  function applyStyle(next: { color: Color }) {
    setStyle((current) => ({ ...current, ...next }));
    if (selected.length === 0) return;
    checkpoint();
    change((current) => current.map((shape) => {
      if (!selected.includes(shape.id)) return shape;
      return { ...shape, color: next.color };
    }));
  }

  // Adds copies of shapes, moved by an offset, and selects them.
  function insertCopies(list: Shape[], offset: number) {
    if (list.length === 0) return;
    checkpoint();
    const copies = list.map((shape) => ({ ...moveShape(shape, offset, offset), id: crypto.randomUUID() }));
    change((current) => [...current, ...copies]);
    select(copies.map((shape) => shape.id));
  }

  // Each paste of the same copy lands a little further along.
  const pasteCount = useRef(0);

  function copySelection(data: DataTransfer) {
    const picked = shapesRef.current.filter((shape) => selected.includes(shape.id));
    if (picked.length === 0) return false;
    data.setData(CLIPBOARD_TYPE, JSON.stringify(picked));
    data.setData("text/plain", picked.map(shapeText).filter(Boolean).join("\n\n"));
    pasteCount.current = 0;
    return true;
  }

  function paste(data: DataTransfer) {
    const copied = data.getData(CLIPBOARD_TYPE);
    if (copied) {
      pasteCount.current += 1;
      insertCopies(JSON.parse(copied) as Shape[], 24 * pasteCount.current);
      return;
    }
    // Text from anywhere else becomes a note in the middle of the view.
    const text = data.getData("text/plain").trim();
    if (!text) return;
    const rect = rootRef.current!.getBoundingClientRect();
    const point = toWorld({ clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 });
    checkpoint();
    const html = text.split("\n").map((line) => `<p>${escapeHtml(line)}</p>`).join("");
    const note: NoteShape = { kind: "note", id: crypto.randomUUID(), x: point.x - 140, y: point.y, w: 280, h: 30, color: style.color, html };
    change((current) => [...current, note]);
    select([note.id]);
  }

  // Copy, cut and paste arrive from the browser (and its ⌘C, ⌘X, ⌘V) as
  // document events. They are the board's only while the board itself has
  // focus: inside a note or label they edit text as usual.
  const clipboard = useRef({ copySelection, paste, deleteSelected });
  clipboard.current = { copySelection, paste, deleteSelected };
  useEffect(() => {
    const onCopy = (event: ClipboardEvent, cut: boolean) => {
      if (document.activeElement !== rootRef.current || !event.clipboardData) return;
      if (!clipboard.current.copySelection(event.clipboardData)) return;
      event.preventDefault();
      if (cut) clipboard.current.deleteSelected();
    };
    const copy = (event: ClipboardEvent) => onCopy(event, false);
    const cut = (event: ClipboardEvent) => onCopy(event, true);
    const pasted = (event: ClipboardEvent) => {
      if (document.activeElement !== rootRef.current || !event.clipboardData || walking()) return;
      event.preventDefault();
      clipboard.current.paste(event.clipboardData);
    };
    document.addEventListener("copy", copy);
    document.addEventListener("cut", cut);
    document.addEventListener("paste", pasted);
    return () => {
      document.removeEventListener("copy", copy);
      document.removeEventListener("cut", cut);
      document.removeEventListener("paste", pasted);
    };
  }, []);

  // E makes the selected notes' text a step bigger, Q a step smaller.
  function resizeText(step: 1 | -1) {
    checkpoint();
    change((current) => current.map((shape) => {
      if (shape.kind !== "note" || !selected.includes(shape.id)) return shape;
      const index = TEXT_SIZES.indexOf(shape.size ?? DEFAULT_TEXT_SIZE);
      const next = TEXT_SIZES[Math.min(TEXT_SIZES.length - 1, Math.max(0, (index < 0 ? TEXT_SIZES.indexOf(DEFAULT_TEXT_SIZE) : index) + step))]!;
      return { ...shape, size: next };
    }));
  }

  function deleteSelected() {
    if (selected.length === 0) return;
    checkpoint();
    const ids = new Set(selected);
    change((current) => current.filter((shape) => !ids.has(shape.id)));
    setSelected([]);
  }

  // Sketch text is merged into the board (see parseSketch); undo brings the
  // board back as it was. Returns the reason when the text could not be read.
  function importText(text: string, play = false): string | undefined {
    let next: { shapes: Shape[]; steps: SketchStep[]; groups: SketchGroup[]; terms: SketchTerm[] };
    // The board unmounted while the import waited for its fonts.
    if (!worldRef.current) return;
    // The root's text arriving while a child is on screen belongs on the
    // parent snapshot, not over the picture.
    const held = phaseRef.current === "in" || phaseRef.current === "out" || adoptedRef.current
      ? hostStack.current.find((item) => item.id === null) ?? zoomHold.current ?? undefined
      : undefined;
    const measure = measurer(worldRef.current);
    const host = typeof location === "undefined" ? undefined : location.hostname;
    try {
      const laid = layCanvases(rawPortalsRef.current, measure, host, boundsLock.current);
      next = parseSketch(text, measure, held?.shapes ?? shapesRef.current, { canvasTitles: canvasTitlesOf(rawPortalsRef.current), canvasBounds: laid.bounds });
    } catch (cause) {
      return cause instanceof Error ? cause.message : String(cause);
    } finally {
      measure.done();
    }
    if (held) {
      held.shapes = next.shapes;
      held.steps = next.steps;
      held.groups = next.groups;
      held.terms = next.terms;
      return;
    }
    checkpoint();
    setEditing(undefined);
    setSelected([]);
    setOpened(new Set());
    setPlaying(undefined);
    setReady(false);
    // The refs follow at once, so a second import in the same tick (pending
    // updates applied in order) merges into this one, not the old board.
    shapesRef.current = next.shapes;
    stepsRef.current = next.steps;
    groupsRef.current = next.groups;
    termsRef.current = next.terms;
    change(() => next.shapes);
    // The text's steps replace the old walkthrough, its groups the old
    // groups and its terms the old terms; none removes them.
    setSteps(next.steps);
    setGroups(next.groups);
    setTerms(next.terms);
    // The page may still be settling to its size, so for the next second the
    // view is set again whenever the board resizes; after that too, until
    // the reader pans, zooms or starts playing.
    fitAfterImport.current = Date.now() + 1000;
    viewUntouched.current = true;
    if (play && next.steps.length) {
      // Straight into the walkthrough, ready to start; it places the view,
      // and the board takes the keys (Space, Esc) as when Play is pressed.
      setTool("select");
      setReady(true);
      rootRef.current?.focus({ preventScroll: true });
    } else {
      // The whole drawing, as large as fits. A deep link that opens a step
      // bumps the generation so this fit does not land on top of it.
      const generation = ++fitGeneration.current;
      setTimeout(() => {
        if (fitGeneration.current !== generation) return;
        zoomToFit(4);
      }, 50);
    }
    return undefined;
  }
  const importRef = useRef(importText);
  importRef.current = importText;

  // A canvas badge is the linked sketch's name, which arrives after the
  // text. Measure that badge and lay the drawing out again before the
  // arrows are left pointing at the narrower box. Fonts first, or the
  // width would be the fallback's.
  const fitKey = `${boundsEpoch}\n${canvasTitlesKey(portals)}\n${shapes.flatMap((shape) => (shape.kind === "rect" && (portalSketchId(shape.link) || portalLabelId(shape.label)) ? [`${shape.id}:${shape.link ?? ""}:${Math.round(shape.w)}`] : [])).sort().join("|")}`;
  useLayoutEffect(() => {
    const world = worldRef.current;
    if (!world) return;
    let cancel = false;
    const run = () => {
      if (cancel || !worldRef.current || phaseRef.current === "in" || phaseRef.current === "out") return;
      const titlesKey = canvasTitlesKey(portalsRef.current);
      // Already measured for these names while it was an inset. Doing it
      // again on the frame the zoom lands is the hitch the first time in.
      for (const entry of portalFitRef.current.values()) {
        if (entry.shapes === shapesRef.current && entry.titlesKey === titlesKey) return;
      }
      const host = typeof location === "undefined" ? undefined : location.hostname;
      const raw = rawPortalsRef.current;
      const targets = shapesRef.current.flatMap((shape) => (shape.kind === "rect" ? [portalSketchId(shape.link, host) ?? portalLabelId(shape.label, host)] : [])).filter((id): id is string => Boolean(id));
      if (!rootBoundsSeen.current) rootBoundsSeen.current = performance.now();
      // The same cap as a linked name. Past it, the boxes keep the size
      // they have; a bound that arrives later does not move them.
      const blocked = targets.some((id) => {
        const card = raw?.[id];
        if (!card || card.status === "loading") return true;
        return card.status === "open" && Boolean(card.pendingDrawing) && !boundsReady.current.has(id);
      });
      if (blocked && performance.now() - rootBoundsSeen.current < NAME_WAIT) return;
      const measure = measurer(worldRef.current);
      try {
        const next = refitSketch(shapesRef.current, stepsRef.current, groupsRef.current, termsRef.current, measure, canvasTitlesOf(raw), boundsRef.current);
        if (!next || cancel) return;
        shapesRef.current = next;
        change(() => next);
        // The first view was framed on the narrower boxes. Frame the
        // final ones, unless the reader has already moved the camera.
        if (viewUntouched.current && playingRef.current === undefined && !readyRef.current) zoomToFit(4);
      } finally {
        measure.done();
      }
    };
    if (document.fonts.check(`650 10.5px ${MONO}`)) run();
    else void fontsReady().then(run);
    return () => { cancel = true; };
  }, [fitKey]);

  // Lay each linked sketch out the way it will be laid out as the root:
  // the board's measurer, the name of every canvas it draws, and the
  // content bounds those canvases are sized from. The inset then shows
  // those shapes, and the swap keeps them. A child still loading holds
  // the layout; a child the page is not fetching is given up after a
  // short wait, and the ratio then stays put.
  useLayoutEffect(() => {
    const world = worldRef.current;
    if (!world || !portals || phaseRef.current === "in" || phaseRef.current === "out") return;
    let cancel = false;
    const run = () => {
      if (cancel || !worldRef.current || phaseRef.current === "in" || phaseRef.current === "out") return;
      const titlesKey = canvasTitlesKey(portals);
      const host = typeof location === "undefined" ? undefined : location.hostname;
      const measure = measurer(worldRef.current);
      let changed = false;
      let waiting = false;
      let published = false;
      try {
        const laid = layCanvases(portals, measure, host, boundsLock.current);
        for (const [id, card] of Object.entries(portals)) {
          if (card.status !== "open" || (!card.shapes?.length && !card.source && !card.bounds)) continue;
          if (!portalSeenRef.current.has(id)) portalSeenRef.current.set(id, performance.now());
          const since = portalSeenRef.current.get(id)!;
          const names = linkNames(card.shapes ?? [], portals);
          // The linked name, and a direct child's drawing when that fetch
          // is already in flight. Both are capped: a deeper sketch never
          // holds this preview, and a late one does not resize it.
          const hold = drawingLate(card.shapes, portals, host) || !names.ready;
          if (hold && performance.now() - since < NAME_WAIT) {
            waiting = true;
            continue;
          }
          if (!boundsLock.current.has(id)) boundsLock.current.set(id, laid.used[id] ?? {});
          if (!boundsReady.current.has(id)) {
            boundsReady.current.add(id);
            published = true;
          }
          if (laid.bounds[id]) boundsRef.current[id] = laid.bounds[id];
          if (!card.shapes?.length) continue;
          const key = portalLayoutKey(card.shapes, titlesKey, boundsKeyOf(boundsLock.current.get(id)));
          const prev = portalFitRef.current.get(id);
          if (prev?.key === key) continue;
          const shapes = laid.fitted[id] ?? card.shapes;
          portalFitRef.current.set(id, { key, titlesKey, shapes });
          changed = true;
          portalMark("show", id, `${Math.round(performance.now() - since)}ms${names.pending.length ? ` pending ${names.pending.join(",")}` : ""}`);
        }
      } finally {
        measure.done();
      }
      if (published) setBoundsEpoch((n) => n + 1);
      if (changed) setPortalFitTick((n) => n + 1);
      if (waiting) window.setTimeout(() => { if (!cancel) run(); }, NAME_WAIT);
    };
    const fontsKnown = document.fonts.status === "loaded" || document.fonts.check(`400 14px ${MONO}`);
    if (fontsKnown) run();
    else {
      // A face that is slow must not hold the preview. The root import
      // already waits for the fonts; this is only the late case.
      let started = false;
      const once = () => {
        if (started || cancel) return;
        started = true;
        run();
      };
      const timer = window.setTimeout(once, FONT_WAIT);
      void fontsReady().then(() => {
        clearTimeout(timer);
        once();
      });
      return () => { cancel = true; clearTimeout(timer); };
    }
    return () => { cancel = true; };
  }, [portals]);

  // Imports wait for the board's fonts (docs/board.md, Fonts): measured
  // before them, a cold page would lay the sketch out for the fallback.
  // They go in the order they came, each merging into the one before.
  const importQueue = useRef<Promise<unknown>>(Promise.resolve());
  function queueImport(text: string, play?: boolean) {
    const done = importQueue.current.then(() => fontsReady(text)).then(() => importRef.current(text, play));
    importQueue.current = done.catch(() => undefined);
    return done;
  }

  useEffect(() => {
    if (!importing) return;
    // Imported whether or not anyone listens: an optional call would skip
    // its argument when there is no callback.
    void queueImport(importing.text, importing.play).then((error) => onImported?.(error));
  }, [importing?.id]);

  // The corner slots' widths, as CSS variables the toolbar lays itself out
  // between (styles.ts); measured, since their content is the page's.
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const update = () => {
      const left = topLeftRef.current?.offsetWidth ?? 0;
      const right = topRightRef.current?.offsetWidth ?? 0;
      root.style.setProperty("--sketch-chrome-left", `${left ? left + 20 : 0}px`);
      root.style.setProperty("--sketch-chrome-right", `${right ? right + 20 : 0}px`);
      const toolbar = toolbarRef.current;
      if (!toolbar) return;
      // The rows side by side, with their dividers and the panel's padding.
      const rows = [...toolbar.querySelectorAll<HTMLElement>(":scope > .sketch-row")];
      const needed = rows.reduce((sum, row) => sum + row.offsetWidth, 0) + (rows.length - 1) * 13 + 10;
      const free = root.clientWidth - (left ? left + 20 : 0) - (right ? right + 20 : 0) - 20;
      const next = needed > free;
      setStacked((current) => (current === next ? current : next));
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(root);
    if (topLeftRef.current) observer.observe(topLeftRef.current);
    if (topRightRef.current) observer.observe(topRightRef.current);
    return () => observer.disconnect();
  });

  const fitAfterImport = useRef(0);
  const fitGeneration = useRef(0);
  const viewUntouched = useRef(false);
  function paintFlight() {
    const flight = flightRef.current;
    const world = worldRef.current;
    if (!flight || !world) {
      const visual = glideVisual.current;
      if (!world || !visual) {
        // The flight wrote transition: none on the picture. Leave it there
        // and the walkthrough's glide (a CSS transition on this same
        // element) never runs: the camera pops between steps.
        if (world) world.style.transition = "";
        return;
      }
      world.style.transition = "none";
      world.style.transform = `translate(${visual.x}px, ${visual.y}px) scale(${visual.z})`;
      return;
    }
    // The picture is this world, on the content camera alone: the same
    // translate+scale the root keeps after the swap. A second scale inside
    // the parent world rounds a fraction of a pixel off that.
    world.style.transition = "none";
    world.style.transform = `translate(${flight.content.x}px, ${flight.content.y}px) scale(${flight.content.z})`;
    const host = hostWorldRef.current;
    if (!host) return;
    host.style.transition = "none";
    host.style.transform = `translate(${flight.world.x}px, ${flight.world.y}px) scale(${flight.world.z})`;
    const portal = host.querySelector<HTMLElement>(".sketch-portal[data-portal-open]");
    if (!portal) return;
    if (!flight.chrome) {
      const read = getComputedStyle(portal);
      flight.chrome = { border: read.borderTopColor, background: read.backgroundColor };
    }
    portal.style.borderColor = withAlpha(flight.chrome.border, flight.rim);
    portal.style.backgroundColor = "transparent";
    const tag = portal.querySelector<HTMLElement>(":scope > .sketch-tag");
    if (tag) tag.style.opacity = String(flight.rim);
  }
  const zoomReturn = useRef<Record<string, { x: number; y: number; w: number; h: number }> | null>(null);
  useLayoutEffect(() => {
    paintFlight();
    // The flight left the picture in the child's coordinates. Now the
    // shapes are the parent's, so the camera has to be too. Doing it here,
    // after that commit, means the browser never paints the child at the
    // parent scale. A render whose camera string did not change would
    // otherwise leave the flight's transform in place.
    const landed = landedCamera.current;
    if (landed && !flightRef.current && phaseRef.current !== "in" && phaseRef.current !== "out") {
      landedCamera.current = null;
      const world = worldRef.current;
      if (world) {
        const next = `translate(${landed.x}px, ${landed.y}px) scale(${landed.z})`;
        if (world.style.transform !== next) {
          world.style.transition = "none";
          world.style.transform = next;
          world.style.transition = "";
        }
      }
    }
    const before = zoomReturn.current;
    const root = rootRef.current;
    const world = worldRef.current;
    if (before && root && world && phaseRef.current === "out") {
      zoomReturn.current = null;
      root.dataset.zoomReturn = JSON.stringify({ before, after: namedRects(world, ":scope > .sketch-rect[data-name]") });
    }
    if (!trackAfter.current || phaseRef.current === "in" || phaseRef.current === "out" || !world || !root) return;
    const frames = zoomTrack.current;
    trackAfter.current = 0;
    const take = (phase: string) => frames.push({ phase, shapes: namedRects(world, ":scope > .sketch-rect[data-name]") });
    take("landed");
    let left = 4;
    const step = () => {
      const live = worldRef.current;
      if (!live) return;
      frames.push({ phase: "after", shapes: namedRects(live, ":scope > .sketch-rect[data-name]") });
      left -= 1;
      if (left > 0) requestAnimationFrame(step);
      else if (rootRef.current) rootRef.current.dataset.zoomTrack = JSON.stringify({ dpr: window.devicePixelRatio, frames });
    };
    requestAnimationFrame(step);
  });
  useEffect(() => {
    const observer = new ResizeObserver(() => {
      if (Date.now() >= fitAfterImport.current && !viewUntouched.current) return;
      if (playingRef.current !== undefined) glideToStep(playingRef.current, false);
      else if (readyRef.current) frameWhole(false);
      else zoomToFit(4);
    });
    observer.observe(rootRef.current!);
    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const update = () => {
      const next = { w: root.clientWidth, h: root.clientHeight };
      setViewSize((current) => (current.w === next.w && current.h === next.h ? current : next));
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(root);
    return () => observer.disconnect();
  }, []);

  // Fits the whole drawing in view, zooming in no further than maxZoom:
  // 100% from the button, as far as the board goes after an import.
  function zoomToFit(maxZoom = 1) {
    // The fit after an import is on a timer; the page may have moved on
    // (a link opened another sketch) and the board be gone by then.
    releasePlaybackGlide();
    const root = rootRef.current;
    if (!root) return;
    const box = bounds(focusShapesRef.current ?? shapesRef.current);
    const rect = root.getBoundingClientRect();
    if (!box) {
      setCamera({ x: 40, y: 40, z: 1 });
      return;
    }
    // More room at the top, where the toolbar sits.
    const pad = 48;
    const top = 100;
    const z = Math.min(maxZoom, (rect.width - pad * 2) / Math.max(1, box.maxX - box.minX), (rect.height - pad - top) / Math.max(1, box.maxY - box.minY));
    setCamera({ z, x: (rect.width - (box.maxX - box.minX) * z) / 2 - box.minX * z, y: top + (rect.height - pad - top - (box.maxY - box.minY) * z) / 2 - box.minY * z });
  }

  function takeReveal(id: string) {
    if (revealedRef.current.has(id)) return false;
    revealedRef.current.add(id);
    return true;
  }

  // The linked sketch, measured like the root. A cache hit is the layout
  // the inset is already drawing.
  function laidOutPortal(id: string): Shape[] | undefined {
    const card = rawPortalsRef.current?.[id];
    if (!card || card.status !== "open" || !card.shapes?.length) return;
    const cached = portalFitRef.current.get(id);
    const titlesKey = canvasTitlesKey(rawPortalsRef.current);
    const boundsKey = boundsKeyOf(boundsLock.current.get(id));
    if (cached && (cached.shapes === card.shapes || cached.key === portalLayoutKey(card.shapes, titlesKey, boundsKey))) {
      portalsRef.current = { ...portalsRef.current, [id]: { ...card, shapes: cached.shapes } };
      return cached.shapes;
    }
    const world = worldRef.current;
    if (!world) return card.shapes;
    const measure = measurer(world);
    try {
      const shapes = refitSketch(card.shapes, card.steps ?? [], card.groups ?? [], [], measure, canvasTitlesOf(rawPortalsRef.current), boundsRef.current) ?? card.shapes;
      portalFitRef.current.set(id, { key: portalLayoutKey(card.shapes, titlesKey, boundsKey), titlesKey, shapes });
      portalsRef.current = { ...portalsRef.current, [id]: { ...card, shapes } };
      setPortalFitTick((n) => n + 1);
      return shapes;
    } finally {
      measure.done();
    }
  }

  // The linked sketch (docs/plan-portals.md). When the canvas box is not
  // already near the middle, the camera first pans to centre it at the
  // current zoom. Then it zooms into the frame while the child is still
  // drawn inside the parent. When that settles, the child becomes the
  // board, in its own coordinates, at the camera that puts the same pixels
  // on screen. Back rebuilds the parent at the matching camera and zooms
  // out to where it was, with no centering pan of its own.
  function setPortalFocus(sketchId: string | null) {
    const reduce = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (phaseRef.current === "out" && sketchId === targetRef.current) return;
    // Back, including a jump of several levels: one zoom out lands on the
    // canvas asked for. Levels in between are left behind; opening one of
    // them again starts its walkthrough at the first step.
    const stacked = hostStack.current.some((host) => host.id === sketchId);
    if (sketchId === null || stacked) {
      while (hostStack.current.length > 1) {
        const top = hostStack.current[hostStack.current.length - 1]!;
        const landsOnTarget = sketchId === null ? false : top.id === sketchId;
        if (landsOnTarget) break;
        hostStack.current.pop();
      }
      zoomOut(reduce);
      return;
    }
    if (sketchId === adoptedRef.current && phaseRef.current === "settled") return;
    if (sketchId === targetRef.current && phaseRef.current === "in") return;
    const card = rawPortalsRef.current?.[sketchId];
    if (!card || card.status !== "open" || !card.shapes?.length) return;
    const childShapes = laidOutPortal(sketchId) ?? card.shapes;
    const hostName = typeof location === "undefined" ? undefined : location.hostname;
    const nest = nestOf(childShapes);
    const root = rootRef.current;
    if (!nest || !root) return;
    const view = { w: root.clientWidth, h: root.clientHeight };
    const frame = frameOfPortal(shapesRef.current, portalsRef.current, sketchId, hostName, view);
    if (!frame) return;
    const place: Placement = { frame, nest, s: frame.w / nest.w };
    zoomGen.current += 1;
    glideVisual.current = null;
    landedCamera.current = null;
    const atLeaving = playingRef.current;
    const leavingTrace = atLeaving !== undefined ? snapshotTrace(atLeaving) : undefined;
    hostStack.current.push({
      id: adoptedRef.current,
      shapes: shapesRef.current,
      steps: stepsRef.current,
      groups: groupsRef.current,
      terms: termsRef.current,
      camera: cameraRef.current,
      place,
      finished: [...finishedSteps.current],
      walk: {
        ready: readyRef.current,
        ...(atLeaving !== undefined ? {
          playing: atLeaving,
          beat: beatRef.current,
          ...(leavingTrace ? { trace: leavingTrace } : {}),
          ...(aim ? { pointing: aim } : {}),
        } : {}),
      },
    });
    // The canvas being entered has its own steps. Nothing finished on the
    // parent counts there, and it always starts from the first step. A
    // restore flag left over from the parent would show that first step
    // already finished.
    finishedSteps.current = new Set();
    showFinished.current = false;
    holdRestore.current = false;
    restoreBeat.current = "paused";
    keepCamera.current = false;
    setFrozenTrace(undefined);
    setKeptPointing(undefined);
    setBarInstant(false);
    targetRef.current = sketchId;
    phaseRef.current = "in";
    // The picture is the child, in its own coordinates, on the one camera
    // transform it will keep. The parent stays in the host layer so its
    // border can leave. Nothing is remounted when the zoom lands.
    focusShapesRef.current = null;
    focusGroupsRef.current = null;
    setFocusShapes(null);
    setFocusGroups(null);
    stepsRef.current = card.steps ?? [];
    groupsRef.current = card.groups ?? [];
    setSteps(card.steps ?? []);
    setGroups(card.groups ?? []);
    setPlaying(undefined);
    setReady(false);
    setEntered(true);
    setPortalFade(false);
    // The fade waits for the zoom. A centering pan keeps the parent's
    // shapes up; adding the fade in this commit would start them already
    // gone once the host layer appears.
    setPortalTravel(undefined);
    centeringPan.current = false;
    setOpenPortalId(sketchId);
    viewUntouched.current = false;
    // Where the picture is now, and where it must settle: the step it will
    // start playing, or the child's own fit when it has no steps.
    releasePlaybackGlide();
    setPortalGlide(false);
    const C0 = cameraRef.current;
    const K0 = childCamera(C0, place);
    const childSteps = card.steps ?? [];
    const startAt = childSteps.length ? firstStep(childSteps) : undefined;
    const playback = startAt !== undefined ? stepLandingCamera(root, childShapes, childSteps, card.groups ?? [], startAt, voicedRef.current) : undefined;
    const K1 = playback ?? childCamera(enteredCamera(frame, nest, view), place);
    const box = portalBoxOf(shapesRef.current, sketchId);
    const C1 = box ? frameOffCamera(box, view) : parentCamera(K1, place);
    if (reduce) {
      flightRef.current = null;
      adopt(sketchId, place, K1);
      return;
    }
    // Centre the box first when it is off to the side. The zoom then
    // leaves from that camera, so a box that is partly off screen does
    // not scale while it is still sliding into view. Near the middle,
    // the pan is skipped and the zoom starts at once.
    const offset = box && view.w >= 2 && view.h >= 2 ? boxCenterOffset(C0, box, view) : undefined;
    const panMs = offset ? divePanMs(offset) : 0;
    const Cpan = box && panMs > 0 ? centerBoxCamera(C0, box, view) : undefined;
    const Kpan = Cpan ? childCamera(Cpan, place) : undefined;
    const parent = hostStack.current[hostStack.current.length - 1]!;
    setHostPicture({ shapes: parent.shapes, groups: parent.groups });
    shapesRef.current = childShapes;
    setShapes(childShapes);
    if (rootRef.current) delete rootRef.current.dataset.zoomTrack;
    zoomTrack.current = [];
    // The host camera takes the border past the screen. The picture eases
    // on its own camera, the one it lands on, so the swap changes nothing.
    const zoomFrom = Cpan && Kpan ? { world: Cpan, content: Kpan } : { world: C0, content: K0 };
    flightRef.current = { world: C0, content: K0, inset: insetFlight(C0, K0, place), rim: 1, place };
    const beginZoom = () => {
      const gen = zoomGen.current;
      // The fade starts with the zoom, on the frame the scale first moves.
      requestAnimationFrame(() => {
        if (gen !== zoomGen.current) return;
        centeringPan.current = false;
        setPortalTravel("in");
      });
      runFlight(gen, { world: zoomFrom.world, content: zoomFrom.content, rim: 1 }, { world: C1, content: K1, rim: 0 }, place, true, () => adopt(sketchId, place, K1));
    };
    if (Cpan && Kpan) {
      centeringPan.current = true;
      setPortalTravel("pan");
      runCentering(zoomGen.current, { world: C0, content: K0 }, zoomFrom, panMs, place, beginZoom);
    } else beginZoom();
  }
  const targetRef = useRef<string | null>(null);
  // The linked sketch's shapes as they were when the board took it over:
  // when the page hands over new ones for that sketch (it was drawn again
  // while the reader is inside it), the board shows them in place, with the
  // camera where it is and the walkthrough on the same step.
  const adoptedCard = useRef<Shape[] | undefined>(undefined);
  useEffect(() => {
    const id = adoptedRef.current;
    if (!id || phaseRef.current !== "settled") return;
    const card = portals?.[id];
    if (!card || card.status !== "open" || !card.shapes?.length || card.shapes === adoptedCard.current) return;
    adoptedCard.current = card.shapes;
    const shapes = laidOutPortal(id) ?? card.shapes;
    const steps = card.steps ?? [];
    const groups = card.groups ?? [];
    shapesRef.current = shapes;
    stepsRef.current = steps;
    groupsRef.current = groups;
    setShapes(shapes);
    setSteps(steps);
    setGroups(groups);
    setSelected([]);
    setOpened(new Set());
    if (playingRef.current !== undefined) setPlaying(steps.length ? Math.min(playingRef.current, steps.length - 1) : undefined);
  }, [portals]);
  function adopt(sketchId: string, place: Placement, contentCam: Camera) {
    centeringPan.current = false;
    if (targetRef.current !== sketchId || phaseRef.current !== "in") return;
    const card = portalsRef.current?.[sketchId];
    if (!card || card.status !== "open" || !card.shapes?.length) return;
    enteredCanvases.current.add(sketchId);
    flightRef.current = null;
    glideVisual.current = null;
    adoptedRef.current = sketchId;
    phaseRef.current = "settled";
    focusShapesRef.current = null;
    focusGroupsRef.current = null;
    setFocusShapes(null);
    setFocusGroups(null);
    setEntered(false);
    setPortalTravel(undefined);
    setPortalFade(false);
    setOpenPortalId(undefined);
    adoptedCard.current = rawPortalsRef.current?.[sketchId]?.shapes;
    shapesRef.current = card.shapes;
    stepsRef.current = card.steps ?? [];
    groupsRef.current = card.groups ?? [];
    termsRef.current = [];
    setShapes(card.shapes);
    setSteps(card.steps ?? []);
    setGroups(card.groups ?? []);
    setTerms([]);
    setSelected([]);
    setOpened(new Set());
    past.current = [];
    future.current = [];
    setHostPicture(null);
    setCamera(contentCam);
    trackAfter.current = 5;
    onHostRef.current?.(sketchId);
    // The zoom has landed on this step's camera. Every entry starts at
    // the first step, including a canvas left mid-way or at the end
    // earlier. The parent's walkthrough stopped when the dive began, and
    // Back returns to that step as it was.
    const at = firstStep(card.steps ?? []);
    if ((card.steps ?? []).length) {
      landedOn.current = at;
      setTool("select");
      setReady(false);
      setEntry((n) => n + 1);
      setPlaying(at);
      onStepPressRef.current?.(at);
      rootRef.current?.focus({ preventScroll: true });
    }
  }
  function zoomOut(reduce: boolean) {
    // Read the in-flight picture before cancelling it. Back during the
    // zoom continues from there, instead of jumping to the end. Back
    // during the centering pan has not faded the parent yet.
    const mid = phaseRef.current === "in" ? flightRef.current : null;
    const centering = centeringPan.current;
    centeringPan.current = false;
    if (!reduce && !mid && worldRef.current) zoomReturn.current = namedRects(worldRef.current, ":scope > .sketch-rect[data-name]");
    const host = hostStack.current.pop();
    if (!host) return;
    landedCamera.current = null;
    const gen = ++zoomGen.current;
    releasePlaybackGlide();
    const childId = targetRef.current;
    const place = host.place;
    const resting = childCamera(host.camera, place);
    const root = rootRef.current;
    const view = { w: root?.clientWidth ?? 1, h: root?.clientHeight ?? 1 };
    const box = portalBoxOf(host.shapes, childId ?? "");
    const wide = box ? frameOffCamera(box, view) : parentCamera(mid ? mid.content : cameraRef.current, place);
    const from = mid
      ? { world: mid.world, content: mid.content, rim: mid.rim }
      : { world: wide, content: cameraRef.current, rim: 0 };
    adoptedRef.current = host.id;
    targetRef.current = host.id;
    phaseRef.current = "out";
    zoomHold.current = host;
    focusShapesRef.current = null;
    focusGroupsRef.current = null;
    setFocusShapes(null);
    setFocusGroups(null);
    // The picture stays the child until the frame is back. The parent is
    // the host layer, the same split as the zoom in.
    stepsRef.current = host.steps;
    setSteps(host.steps);
    setHostPicture({ shapes: host.shapes, groups: host.groups });
    setSelected([]);
    setOpened(new Set());
    setPlaying(undefined);
    setReady(false);
    past.current = [];
    future.current = [];
    setEntered(true);
    setPortalTravel(reduce ? undefined : "out");
    // The pan left the parent's shapes fully up. Keep them there while
    // the camera goes back; the fade-in is for a zoom that had hidden them.
    if (centering && !reduce) setPortalFade(true);
    setPortalGlide(false);
    setOpenPortalId(childId ?? undefined);
    onHostRef.current?.(host.id);
    const finish = () => {
      if (phaseRef.current !== "out") return;
      phaseRef.current = host.id ? "settled" : "idle";
      flightRef.current = null;
      glideVisual.current = null;
      zoomHold.current = null;
      shapesRef.current = host.shapes;
      stepsRef.current = host.steps;
      groupsRef.current = host.groups;
      termsRef.current = host.terms;
      setShapes(host.shapes);
      setSteps(host.steps);
      setGroups(host.groups);
      setTerms(host.terms);
      setHostPicture(null);
      setEntered(false);
      setPortalTravel(undefined);
      setPortalFade(false);
      setOpenPortalId(undefined);
      // Back to the step this canvas was left on, in the state it was left:
      // the same step, its camera (already restored), its highlight and
      // its arrow ink. Finished stays finished. One that was still going
      // waits, paused. Nothing restarts it and nothing skips it ahead.
      const walk = host.walk;
      finishedSteps.current = new Set(host.finished);
      if (walk?.playing !== undefined) {
        const done = walk.beat === "done";
        restoreBeat.current = done ? "done" : "paused";
        if (done) finishedSteps.current.add(walk.playing);
        holdRestore.current = true;
        keepCamera.current = true;
        landedOn.current = walk.playing;
        setBarInstant(true);
        // A finished step's arrow is already drawn. A partial snapshot is
        // how far the ink had got when the beat ended, which can be before
        // the marker finishes; coming back shows the stroke complete.
        const trace = walk.trace;
        setFrozenTrace(done && trace ? { key: trace.key, drawn: 1 } : trace);
        setKeptPointing(walk.pointing);
        setPlaying(walk.playing);
        setReady(false);
      } else if (walk?.ready && host.steps.length) {
        setFrozenTrace(undefined);
        setKeptPointing(undefined);
        keepCamera.current = false;
        arrivedReady.current = true;
        setReady(true);
      } else {
        setFrozenTrace(undefined);
        setKeptPointing(undefined);
        keepCamera.current = false;
      }
      // The back button is gone. The arrows still walk the path, so the
      // board keeps the keyboard.
      rootRef.current?.focus({ preventScroll: true });
    };
    if (reduce) {
      flightRef.current = null;
      landedCamera.current = host.camera;
      setCamera(host.camera);
      finish();
      return;
    }
    // Start with the border off screen (or wherever the zoom had reached)
    // and the picture unchanged. Then the frame comes back in and the
    // parent's shapes fade in, onto the camera the parent had.
    flightRef.current = { ...from, inset: insetFlight(from.world, from.content, place), place, chrome: mid?.chrome };
    cameraRef.current = from.content;
    requestAnimationFrame(() => {
      if (gen !== zoomGen.current) return;
      setPortalFade(true);
      runFlight(gen, from, { world: host.camera, content: resting, rim: 1 }, place, false, () => {
        flightRef.current = null;
        // Leave the picture on the flight's last transform until the parent
        // shapes commit. The layout effect writes this camera then.
        landedCamera.current = host.camera;
        setCamera(host.camera);
        finish();
      });
    });
  }
  // Slide the parent, at the zoom it already has, until the canvas box is
  // in the middle. The picture is the child form of that same camera, so
  // it stays locked in the box. The zoom starts when this settles. The
  // flight stays set the whole way, so a render cannot paint the child at
  // the parent's scale.
  function runCentering(gen: number, from: { world: Camera; content: Camera }, to: { world: Camera; content: Camera }, ms: number, place: Placement, done: () => void) {
    let last = performance.now();
    let elapsed = 0;
    const step = (now: number) => {
      if (gen !== zoomGen.current) return;
      elapsed += Math.min(40, now - last);
      last = now;
      const t = Math.min(1, elapsed / ms);
      const e = portalEase(t);
      const world = lerpCamera(from.world, to.world, e);
      const content = lerpCamera(from.content, to.content, e);
      flightRef.current = { world, content, inset: insetFlight(world, content, place), rim: 1, place, chrome: flightRef.current?.chrome };
      cameraRef.current = content;
      paintFlight();
      if (t < 1) {
        requestAnimationFrame(step);
        return;
      }
      done();
    };
    requestAnimationFrame(step);
  }
  // One clock for the world camera, the inset and the border. Screen
  // positions of the picture come from the content camera, blended in
  // screen space, so the two scales cannot wobble it.
  function runFlight(gen: number, from: { world: Camera; content: Camera; rim: number }, to: { world: Camera; content: Camera; rim: number }, place: Placement, settle: boolean, done: () => void) {
    let last = performance.now();
    let elapsed = 0;
    const step = (now: number) => {
      if (gen !== zoomGen.current) return;
      elapsed += Math.min(40, now - last);
      last = now;
      const t = Math.min(1, elapsed / DIVE_ZOOM_MS);
      const e = portalEase(t);
      const world = lerpCamera(from.world, to.world, e);
      const content = lerpCamera(from.content, to.content, e);
      const rim = from.rim + (to.rim - from.rim) * e;
      flightRef.current = { world, content, inset: insetFlight(world, content, place), rim, place, chrome: flightRef.current?.chrome };
      cameraRef.current = content;
      paintFlight();
      if (settle && worldRef.current) {
        zoomTrack.current.push({ phase: "flight", shapes: namedRects(worldRef.current, ":scope > .sketch-rect[data-name]") });
        if (zoomTrack.current.length > 4) zoomTrack.current.splice(0, zoomTrack.current.length - 4);
      }
      if (t < 1) {
        requestAnimationFrame(step);
        return;
      }
      if (settle) stampZoomSettle();
      // One more frame with this transform, then the host layer goes and
      // the picture's camera is the one already on it.
      requestAnimationFrame(() => {
        if (gen !== zoomGen.current) return;
        done();
      });
    };
    requestAnimationFrame(step);
  }
  function stampZoomSettle() {
    const root = rootRef.current;
    const world = worldRef.current;
    if (!root || !world) return;
    const view = root.getBoundingClientRect();
    const outside = (r: DOMRect) => r.right <= view.left + 1 || r.left >= view.right - 1 || r.bottom <= view.top + 1 || r.top >= view.bottom - 1;
    const host = hostWorldRef.current ?? world;
    const others = [...host.querySelectorAll<HTMLElement>(":scope > .sketch-rect:not([data-portal-open]), :scope > .sketch-note, :scope > .sketch-group, :scope > .sketch-arrow-label, :scope > .sketch-arrows")].map((el) => {
      const r = el.getBoundingClientRect();
      return { name: el.dataset.name ?? "", opacity: Number(getComputedStyle(el).opacity), outside: outside(r) };
    });
    const portal = host.querySelector<HTMLElement>(".sketch-portal[data-portal-open]");
    const pr = portal?.getBoundingClientRect();
    const tag = portal?.querySelector<HTMLElement>(":scope > .sketch-tag");
    const inner = namedRects(world, ":scope > .sketch-rect[data-name]");
    root.dataset.zoomSettle = JSON.stringify({
      others,
      rimOff: Boolean(pr && pr.left <= view.left - 4 && pr.right >= view.right + 4 && pr.top <= view.top - 4 && pr.bottom >= view.bottom + 4),
      rim: flightRef.current?.rim ?? 1,
      badge: tag ? Number(getComputedStyle(tag).opacity) : 0,
      inner,
    });
  }
  const setPortalFocusRef = useRef(setPortalFocus);
  setPortalFocusRef.current = setPortalFocus;

  // Inside a portal, hits land on the child's drawing. Those shapes are not
  // the root sketch's.
  function shapeById(id: string) {
    // Inside a portal the parent's boxes are the frame, not the drawing.
    // A press on one pans, the way a press on empty canvas does.
    const focused = focusShapesRef.current;
    if (focused) return focused.find((shape) => shape.id === id);
    return shapesRef.current.find((shape) => shape.id === id);
  }

  function onPointerDown(event: ReactPointerEvent) {
    place();
    if (event.button === 2) return;
    const target = event.target as Element;
    if (target.closest(".sketch-chrome")) return;
    // A menu a corner slot opened, portalled out of the board: React
    // bubbles its events here all the same.
    if (!rootRef.current!.contains(target)) return;
    if (target.closest(EDITABLE)) return;
    stopEditing();
    rootRef.current!.focus({ preventScroll: true });
    rootRef.current!.setPointerCapture(event.pointerId);
    const point = toWorld(event);

    // A walkthrough is for looking: dragging only pans. A folded note still
    // opens on a click, to read while taking the drawing in.
    if (walking()) {
      // A numbered arrow is a step. A click plays it; a drag still pans.
      // Editing (the walkthrough closed) selects and drags as before.
      const seqOf = target.closest("[data-seq-of]")?.getAttribute("data-seq-of");
      const under = seqOf ?? target.closest("[data-shape-id]")?.getAttribute("data-shape-id");
      const hopped = under ? shapeById(under) : undefined;
      if (event.button === 0 && !spaceDown.current && hopped?.kind === "arrow" && hopped.seq) {
        releasePlaybackGlide();
        drag.current = { kind: "pan", startX: event.clientX, startY: event.clientY, camera: cameraRef.current, seq: hopped.id };
        setPanning(true);
        return;
      }
      const id = target.closest("[data-shape-id]")?.getAttribute("data-shape-id");
      const note = id ? shapeById(id) : undefined;
      if (id && note?.kind === "note" && foldsNote(note) && !noteOpen(note)) {
        toggleFold(id, false);
        return;
      }
      releasePlaybackGlide();
      drag.current = { kind: "pan", startX: event.clientX, startY: event.clientY, camera: cameraRef.current };
      setPanning(true);
      return;
    }

    if (event.button === 1 || spaceDown.current) {
      releasePlaybackGlide();
      drag.current = { kind: "pan", startX: event.clientX, startY: event.clientY, camera: cameraRef.current };
      setPanning(true);
      return;
    }

    // View only: a click selects, a folded note
    // opens, a drag on the canvas draws a marquee; nothing moves.
    if (readOnly) {
      const id = target.closest("[data-shape-id]")?.getAttribute("data-shape-id");
      if (id && shapeById(id)) {
        const shape = shapeById(id)!;
        if (shape.kind === "note" && foldsNote(shape) && !opened.has(id) && !event.shiftKey) {
          setOpened((list) => new Set(list).add(id));
          return;
        }
        select(event.shiftKey ? (selected.includes(id) ? selected.filter((item) => item !== id) : [...selected, id]) : [id]);
        return;
      }
      if (!event.shiftKey) {
        setSelected([]);
        setOpened(new Set());
      }
      drag.current = { kind: "marquee", origin: point, additive: event.shiftKey ? selected : [] };
      setMarquee({ a: point, b: point });
      return;
    }

    const handle = target.closest("[data-handle]");
    if (handle) {
      const id = handle.getAttribute("data-id")!;
      const which = handle.getAttribute("data-handle")!;
      const shape = shapeById(id);
      if (!shape) return;
      checkpoint();
      drag.current = which === "from" || which === "to"
        ? { kind: "arrow-end", id, end: which, created: false }
        : which === "bend"
          ? { kind: "arrow-bend", id }
          : { kind: "resize", id, corner: which, origin: point, original: shape.kind === "note" ? { ...shape, w: drawn(shape).w } : (shape as Box) };
      // Pin the bend that is on screen. The handle sits on that curve, so
      // the picture does not jump to the bend stored in the text.
      if (which === "bend" && shape.kind === "arrow") setBendPin({ id, bend: arrowLayoutRef.current?.bend(shape) ?? shape.bend ?? 0 });
      return;
    }

    if (tool === "rect") {
      checkpoint();
      const rect: RectShape = { kind: "rect", id: crypto.randomUUID(), x: point.x, y: point.y, w: 0, h: 0, color: style.color, label: "" };
      change((current) => [...current, rect]);
      setSelected([rect.id]);
      drag.current = { kind: "create-rect", id: rect.id, origin: point };
      return;
    }
    if (tool === "arrow") {
      checkpoint();
      const arrow: ArrowShape = { kind: "arrow", id: crypto.randomUUID(), from: point, to: point, color: style.color };
      change((current) => [...current, arrow]);
      setSelected([arrow.id]);
      drag.current = { kind: "arrow-end", id: arrow.id, end: "to", created: true };
      return;
    }
    if (tool === "note") {
      addNote(point);
      return;
    }

    const id = target.closest("[data-shape-id]")?.getAttribute("data-shape-id");
    if (id && shapeById(id)) {
      const shape = shapeById(id);
      // A click on a folded note opens it without selecting it (docs/
      // board.md, Notes fold); only a drag selects it, as it moves.
      if (shape?.kind === "note" && foldsNote(shape) && !opened.has(id) && editing !== id && !event.shiftKey) {
        drag.current = { kind: "move", last: point, ids: [id], moved: false, open: id };
        return;
      }
      const ids = event.shiftKey
        ? (selected.includes(id) ? selected.filter((item) => item !== id) : [...selected, id])
        : (selected.includes(id) ? selected : [id]);
      select(ids);
      checkpoint();
      drag.current = { kind: "move", last: point, ids, moved: false };
    } else {
      if (!event.shiftKey) {
        setSelected([]);
        setOpened(new Set());
      }
      drag.current = { kind: "marquee", origin: point, additive: event.shiftKey ? selected : [] };
      setMarquee({ a: point, b: point });
    }
  }

  function onPointerMove(event: ReactPointerEvent) {
    const current = drag.current;
    if (!current) return;
    const point = toWorld(event);
    switch (current.kind) {
      case "pan":
        viewUntouched.current = false;
        setCamera({ ...current.camera, x: current.camera.x + event.clientX - current.startX, y: current.camera.y + event.clientY - current.startY });
        break;
      case "move": {
        const dx = point.x - current.last.x;
        const dy = point.y - current.last.y;
        current.last = point;
        if (!current.moved && current.open) {
          // A folded note dragged: moved and selected like any shape.
          checkpoint();
          select(current.ids);
        }
        current.moved = true;
        change((list) => list.map((shape) => (current.ids.includes(shape.id) ? moveShape(shape, dx, dy) : shape)));
        break;
      }
      case "resize": {
        const { original, corner, origin } = current;
        const dx = point.x - origin.x;
        const dy = point.y - origin.y;
        let { x, y, w, h } = original;
        if (corner.includes("w")) { x = Math.min(original.x + dx, original.x + original.w - 20); w = original.x + original.w - x; }
        if (corner.includes("e")) w = Math.max(20, original.w + dx);
        if (corner.includes("n")) { y = Math.min(original.y + dy, original.y + original.h - 20); h = original.y + original.h - y; }
        if (corner.includes("s")) h = Math.max(20, original.h + dy);
        // A note's handle sets its minimum width; a note that folds keeps
        // the drawn width of its first line.
        change((list) => list.map((shape) => (shape.id !== current.id || !isBox(shape) ? shape
          : shape.kind === "rect" ? { ...placedByUser(shape), x, y, w, h }
            : { ...placedByUser(shape), x, y, minWidth: w, ...(foldsNote(shape) ? {} : { w }) })));
        break;
      }
      case "create-rect": {
        const { origin } = current;
        const rect = { x: Math.min(origin.x, point.x), y: Math.min(origin.y, point.y), w: Math.abs(point.x - origin.x), h: Math.abs(point.y - origin.y) };
        change((list) => list.map((shape) => (shape.id === current.id ? { ...shape, ...rect } : shape)));
        break;
      }
      case "arrow-end":
        change((list) => list.map((shape) => (shape.id === current.id && shape.kind === "arrow" ? { ...shape, [current.end]: point } : shape)));
        break;
      case "arrow-bend": {
        // Close to straight snaps straight. The pin is the bend under the
        // pointer, so the curve follows it instead of being corrected mid-drag.
        const arrow = shapesRef.current.find((shape): shape is ArrowShape => shape.id === current.id && shape.kind === "arrow");
        if (!arrow) break;
        const bend = bendThrough(arrow.from, arrow.to, point);
        setBendPin({ id: arrow.id, bend: Math.abs(bend) < 8 ? 0 : bend });
        change((list) => list.map((shape) => (shape.id === arrow.id && shape.kind === "arrow" ? { ...shape, bend: Math.abs(bend) < 8 ? undefined : bend } : shape)));
        break;
      }
      case "marquee":
        setMarquee({ a: current.origin, b: point });
        break;
    }
  }

  function onPointerUp(event: ReactPointerEvent) {
    const current = drag.current;
    drag.current = undefined;
    if (rootRef.current?.hasPointerCapture(event.pointerId)) rootRef.current.releasePointerCapture(event.pointerId);
    if (!current) return;
    if (current.kind === "arrow-bend") setBendPin(undefined);
    switch (current.kind) {
      case "pan":
        setPanning(false);
        if (current.seq && Math.hypot(event.clientX - current.startX, event.clientY - current.startY) < 5) playHop(current.seq);
        break;
      case "move":
        if (current.moved) break;
        if (current.open) setOpened((list) => new Set(list).add(current.open!));
        else past.current.pop();
        break;
      case "create-rect":
        // A click without a drag makes a box of a useful size.
        change((list) => list.map((shape) => (shape.id === current.id && shape.kind === "rect" && shape.w < 8 && shape.h < 8
          ? { ...shape, x: current.origin.x - 80, y: current.origin.y - 40, w: 160, h: 80 }
          : shape)));
        setTool("select");
        break;
      case "arrow-end": {
        const arrow = shapesRef.current.find((shape): shape is ArrowShape => shape.id === current.id && shape.kind === "arrow");
        if (current.created && arrow && Math.hypot(arrow.to.x - arrow.from.x, arrow.to.y - arrow.from.y) < 8) {
          past.current.pop();
          change((list) => list.filter((shape) => shape.id !== current.id));
          setSelected([]);
        }
        setTool("select");
        break;
      }
      case "marquee": {
        const box = marquee;
        setMarquee(undefined);
        if (!box) break;
        const left = Math.min(box.a.x, box.b.x);
        const right = Math.max(box.a.x, box.b.x);
        const top = Math.min(box.a.y, box.b.y);
        const bottom = Math.max(box.a.y, box.b.y);
        if (right - left < 2 && bottom - top < 2) break;
        const inside = (point: Point) => point.x >= left && point.x <= right && point.y >= top && point.y <= bottom;
        const hits = shapesRef.current.filter((shape) => isBox(shape)
          ? shape.x < right && shape.x + shape.w > left && shape.y < bottom && shape.y + shape.h > top
          : arrowPoints(shape).every(inside)).map((shape) => shape.id);
        select([...new Set([...current.additive, ...hits])]);
        break;
      }
    }
  }

  // Tags: the "+ tag" chip on a selected shape, or a double-click on a tag,
  // opens the tag for typing. Enter or leaving saves it, empty removes it,
  // Escape keeps it as it was.
  function startTagEditing(id: string) {
    stopEditing();
    checkpoint();
    select([id]);
    setEditingTag(id);
  }

  function saveTag(id: string, value: string | null) {
    setEditingTag(undefined);
    if (value !== null) change((list) => list.map((shape) => (shape.id === id && shape.kind !== "arrow" ? { ...shape, tag: value.trim() || undefined } : shape)));
    rootRef.current?.focus({ preventScroll: true });
  }

  function startSeqEditing(id: string) {
    stopEditing();
    checkpoint();
    select([id]);
    setHoveredSeq(undefined);
    setHoveredArrow(undefined);
    setEditingSeq(id);
  }

  // A number like 2 or 2a replaces the arrow's; empty removes it; anything
  // else leaves it as it was.
  function saveSeq(id: string, value: string | null) {
    setEditingSeq(undefined);
    if (value !== null && (value === "" || SEQ.test(value))) {
      change((list) => list.map((shape) => (shape.id === id && shape.kind === "arrow" ? { ...shape, seq: value || undefined } : shape)));
    }
    rootRef.current?.focus({ preventScroll: true });
  }

  function onDoubleClick(event: ReactMouseEvent) {
    if (walking() || readOnly) return;
    const target = event.target as Element;
    if (target.closest(".sketch-chrome") || target.closest(EDITABLE)) return;
    // Looked up by position: pointer capture makes the board itself the
    // target of the double-click, whatever is under the pointer. Arrows and
    // their labels are drawn above boxes, so they are found first.
    const hit = document.elementsFromPoint(event.clientX, event.clientY)
      .find((element) => element.closest(".sketch-world") && !element.closest(".sketch-ui"));
    const tagged = hit?.closest("[data-tag-of]")?.getAttribute("data-tag-of");
    if (tagged) {
      startTagEditing(tagged);
      return;
    }
    const numbered = hit?.closest("[data-seq-of]")?.getAttribute("data-seq-of");
    if (numbered) {
      startSeqEditing(numbered);
      return;
    }
    const id = hit?.closest("[data-shape-id]")?.getAttribute("data-shape-id");
    if (id) startEditing(id);
    else addNote(toWorld(event));
  }

  // An open note is as wide as its code needs, never less than its minimum
  // (docs/board.md, Notes fold); the code width is measured once per
  // content.
  const codeWidths = useRef(new Map<string, number>());
  // Widths measured before the fonts arrived are the fallback's.
  useEffect(() => {
    void fontsReady().then(() => codeWidths.current.clear());
  }, []);
  // An open note as drawn: as wide as its code, the panel shifted so its
  // pill stays where the folded line was (NoteView, OPEN_SHIFT).
  function openBox(note: NoteShape): NoteShape {
    return { ...note, x: note.x + OPEN_SHIFT.x, y: note.y + OPEN_SHIFT.y, w: openWidth(note) };
  }

  function openWidth(note: NoteShape) {
    const size = note.size ?? DEFAULT_TEXT_SIZE;
    const key = `${size}|${note.html}`;
    let code = codeWidths.current.get(key);
    if (code === undefined && worldRef.current) {
      const measure = measurer(worldRef.current);
      code = Math.min(MAX_NOTE_WIDTH, measure.noteWidth(note.html, size));
      measure.done();
      codeWidths.current.set(key, code);
    }
    return Math.max(note.minWidth ?? note.w, code ?? 0);
  }

  // Each step of a walkthrough glides the view to the shapes it names:
  // centred in the space above the narration caption, so the shapes sit
  // right over the words, as large as fits, up to 175% so a single small
  // shape does not fill the screen.
  const [gliding, setGliding] = useState(false);
  // The arrow draw a playback move is waiting on. While it is set, the
  // marker keeps tracing that arrow, and a highlight does not start its own.
  const [heldTrace, setHeldTrace] = useState<string | undefined>();
  const glideTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  function glideToStep(index: number, animate = true, opening = false) {
    const source = focusShapesRef.current ?? shapesRef.current;
    const walkGroups = focusGroupsRef.current ?? groupsRef.current;
    const ids = new Set(stepView(source, stepsRef.current, index, walkGroups).highlighted);
    // The step's notes are open, so they are as wide as their code. An
    // overview or a summary frames the whole drawing (docs/format.md,
    // Walkthrough); with no voice, a hop frames the note it opens too.
    const whole = Boolean(stepsRef.current[index]?.kind) && ids.size === 0;
    const named = !whole && !voicedRef.current ? firstNote(namedIn(stepsRef.current[index], source, walkGroups), source) : undefined;
    if (named) ids.add(named.id);
    const box = bounds(source.filter((shape) => (whole ? shape.kind !== "arrow" : ids.has(shape.id))).map((shape) => (shape.kind === "note" && foldsNote(shape) && !whole ? openBox(shape) : shape)));
    presentStep(box, index, animate, opening);
  }
  // The whole drawing in the space above the caption: the walkthrough
  // ready to start.
  function frameWhole(animate = true) {
    const source = focusShapesRef.current ?? shapesRef.current;
    frame(bounds(source.filter((shape) => shape.kind !== "arrow")), animate);
  }
  function frame(box: Rect | undefined, animate: boolean) {
    const root = rootRef.current;
    if (!root || !box) return;
    const rect = root.getBoundingClientRect();
    const caption = root.querySelector(".sketch-steps")?.getBoundingClientRect();
    const area = { width: rect.width, height: caption ? caption.top - rect.top - 20 : rect.height };
    // The first placement is instant: nothing glides in.
    if (animate && placedRef.current) glide();
    const framed = frameCamera(box, area);
    stepCamera.current = { camera: framed, box, area };
    setCamera(framed);
  }
  function glide() {
    setGliding(true);
    clearTimeout(glideTimer.current);
    const gen = playbackGen.current;
    glideTimer.current = setTimeout(() => {
      if (gen !== playbackGen.current) return;
      const result = finishMove(playbackQueue.current, "camera");
      playbackQueue.current = result.queue;
      if (result.start) beginStarted(result.start);
      else setGliding(false);
    }, CAMERA_GLIDE_MS);
  }
  // How the step framed the camera; the voice moves it from there.
  const stepCamera = useRef<{ camera: Camera; box: Rect; area: Area } | undefined>(undefined);

  // The part a reference in the caption names comes into view while the
  // pointer is on the reference: framed with the step, when it is not in
  // view already. Off it, the camera goes back to where the step put it.
  // Not a playback move: the queue does not wait on it.
  const peeking = useRef(false);
  const peekTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => {
    const step = stepCamera.current;
    if (playing === undefined || !step) return;
    const glideBriefly = () => {
      setGliding(true);
      clearTimeout(peekTimer.current);
      peekTimer.current = setTimeout(() => setGliding(false), CAMERA_GLIDE_MS);
    };
    if (hoveredRef && !hoveredRef.startsWith("#")) {
      const source = focusShapesRef.current ?? shapesRef.current;
      const names = pointedSet(hoveredRef, source, focusGroupsRef.current ?? groupsRef.current).names;
      const box = bounds(source.filter((shape) => shape.kind !== "arrow" && shape.name !== undefined && names.has(shape.name)));
      if (!box) return;
      const cam = cameraRef.current;
      const inView = box.minX * cam.z + cam.x >= 0 && box.minY * cam.z + cam.y >= 0
        && box.maxX * cam.z + cam.x <= step.area.width && box.maxY * cam.z + cam.y <= step.area.height;
      if (inView) return;
      const both = { minX: Math.min(step.box.minX, box.minX), minY: Math.min(step.box.minY, box.minY), maxX: Math.max(step.box.maxX, box.maxX), maxY: Math.max(step.box.maxY, box.maxY) };
      peeking.current = true;
      glideBriefly();
      setCamera(frameCamera(both, step.area));
    } else if (peeking.current) {
      peeking.current = false;
      glideBriefly();
      setCamera(step.camera);
    }
  }, [hoveredRef]);

  // Drop queued playback moves. The picture stays where it is; a step
  // change glides from there, and a pan or zoom releases the glide first.
  function clearPlaybackQueue() {
    playbackQueue.current = clearMoves(playbackQueue.current);
    playbackGen.current += 1;
    traceFinished.current = undefined;
    clearTimeout(glideTimer.current);
    setHeldTrace(undefined);
  }
  function releasePlaybackGlide() {
    clearPlaybackQueue();
    setGliding(false);
  }
  interruptRef.current = releasePlaybackGlide;
  clearQueueRef.current = clearPlaybackQueue;

  // The step's frame, remembered so a later highlight is measured from it,
  // without moving the camera off the one a canvas was left on.
  function rememberStepFrame(index: number) {
    const source = focusShapesRef.current ?? shapesRef.current;
    const walkGroups = focusGroupsRef.current ?? groupsRef.current;
    const ids = new Set(stepView(source, stepsRef.current, index, walkGroups).highlighted);
    const whole = Boolean(stepsRef.current[index]?.kind) && ids.size === 0;
    const named = !whole && !voicedRef.current ? firstNote(namedIn(stepsRef.current[index], source, walkGroups), source) : undefined;
    if (named) ids.add(named.id);
    const box = bounds(source.filter((shape) => (whole ? shape.kind !== "arrow" : ids.has(shape.id))).map((shape) => (shape.kind === "note" && foldsNote(shape) && !whole ? openBox(shape) : shape)));
    const root = rootRef.current;
    if (!root || !box) return;
    const rect = root.getBoundingClientRect();
    const caption = root.querySelector(".sketch-steps")?.getBoundingClientRect();
    const area = { width: rect.width, height: caption ? caption.top - rect.top - 20 : rect.height };
    stepCamera.current = { camera: frameCamera(box, area), box, area };
  }
  // The arrow ink at this step: what the marker has drawn, or nothing yet.
  function snapshotTrace(index: number): { key: string; drawn: number } | undefined {
    const now = traceNow.current;
    if (now?.key.endsWith(`:${index}`)) return now;
    const key = openingArrowKey(index);
    return key ? { key, drawn: 0 } : undefined;
  }
  function openingArrowKey(index: number) {
    const source = focusShapesRef.current ?? shapesRef.current;
    const groups = focusGroupsRef.current ?? groupsRef.current;
    const hops = stepView(source, stepsRef.current, index, groups).hops;
    const hop = source.find((shape) => shape.kind === "arrow" && hops.has(shape.id));
    return hop ? `${hop.id}:${index}` : undefined;
  }
  function arrowKeyFor(name: string, index: number) {
    if (!name.startsWith("#")) return undefined;
    const source = focusShapesRef.current ?? shapesRef.current;
    const groups = focusGroupsRef.current ?? groupsRef.current;
    const ids = pointedSet(name, source, groups).arrows;
    const hop = source.find((shape) => shape.kind === "arrow" && ids.has(shape.id));
    return hop ? `${hop.id}:${index}` : undefined;
  }
  // The camera a highlight will ask for, from the step's framing. Undefined
  // when this pointing does not move the picture.
  function highlightFrame(name: string, index: number) {
    const step = stepCamera.current;
    const kind = stepsRef.current[index]?.kind;
    if (!step || kind === "overview" || kind === "summary") return undefined;
    const source = focusShapesRef.current ?? shapesRef.current;
    const names = pointedSet(name, source, focusGroupsRef.current ?? groupsRef.current).focus;
    const box = bounds(source.filter((shape) => shape.kind !== "arrow" && shape.name && names.has(shape.name)).map((shape) => (shape.kind === "note" && foldsNote(shape) ? openBox(shape) : shape)));
    if (!box) return undefined;
    const arrowKey = arrowKeyFor(name, index);
    return { camera: focusCamera(step, box), ...(arrowKey ? { arrowKey } : {}) };
  }
  function enqueueCamera(move: CameraMove, cameraDone = false) {
    let next = move;
    if (next.arrowKey && traceFinished.current === next.arrowKey) next = { ...next, arrowKey: undefined };
    const queue = playbackQueue.current;
    // A refit to the frame already playing would only delay the highlight.
    if (next.kind === "step" && !next.arrowKey) {
      if (queue.active?.move.kind === "step" && sameCamera(queue.active.move.target.camera, next.target.camera)) return;
      if (queue.pendingStep && sameCamera(queue.pendingStep.target.camera, next.target.camera)) return;
    }
    const result = enqueueMove(playbackQueue.current, next, { cameraDone });
    playbackQueue.current = result.queue;
    if (result.start) beginStarted(result.start);
  }
  function beginStarted(start: Started<Framed>) {
    let move = start.move;
    const index = playingRef.current;
    if (move.kind === "highlight" && move.target.name && index !== undefined) {
      const framed = highlightFrame(move.target.name, index);
      if (framed) move = { ...move, target: { camera: framed.camera, name: move.target.name }, ...(framed.arrowKey ? { arrowKey: framed.arrowKey } : { arrowKey: undefined }) };
    }
    if (move.arrowKey && traceFinished.current === move.arrowKey) move = { ...move, arrowKey: undefined };
    const active = playbackQueue.current.active;
    if (active) {
      playbackQueue.current = {
        ...playbackQueue.current,
        active: { ...active, move, arrowDone: move.arrowKey === undefined || active.arrowDone },
      };
    }
    setHeldTrace(move.arrowKey);
    if (start.animate && !sameCamera(move.target.camera, cameraRef.current)) {
      glide();
      setCamera(move.target.camera);
      return;
    }
    if (!sameCamera(move.target.camera, cameraRef.current)) setCamera(move.target.camera);
    const result = finishMove(playbackQueue.current, "camera");
    playbackQueue.current = result.queue;
    if (result.start) beginStarted(result.start);
  }
  function onArrowFinished(key: string) {
    traceFinished.current = key;
    let guard = 0;
    while (guard++ < 4) {
      const active = playbackQueue.current.active;
      if (!active || active.arrowDone || active.move.arrowKey !== key) return;
      const result = finishMove(playbackQueue.current, "arrow");
      playbackQueue.current = result.queue;
      if (!result.start) return;
      beginStarted(result.start);
    }
  }
  function presentStep(box: Rect | undefined, index: number, animate: boolean, opening: boolean) {
    const root = rootRef.current;
    if (!root || !box) return;
    const rect = root.getBoundingClientRect();
    const caption = root.querySelector(".sketch-steps")?.getBoundingClientRect();
    const area = { width: rect.width, height: caption ? caption.top - rect.top - 20 : rect.height };
    const framed = frameCamera(box, area);
    stepCamera.current = { camera: framed, box, area };
    // The first placement is instant: nothing glides in.
    if (!animate || !placedRef.current) {
      if (!animate) releasePlaybackGlide();
      setCamera(framed);
      if (opening && !barInstantRef.current) {
        const arrowKey = openingArrowKey(index);
        if (arrowKey) enqueueCamera({ kind: "step", target: { camera: framed }, arrowKey }, true);
      }
      return;
    }
    const arrowKey = opening && !barInstantRef.current ? openingArrowKey(index) : undefined;
    enqueueCamera({ kind: "step", target: { camera: framed }, ...(arrowKey ? { arrowKey } : {}) });
  }

  // A note opens when the voice starts naming it on this stop. The same
  // name arriving again (the note was measured as it opened, or a cue
  // from the stop just left) does not open it, and a name from another
  // stop is ignored (docs/board.md, Notes fold).
  useEffect(() => {
    const heard = noteHeard({
      playing,
      pointing: aim,
      isNote: Boolean(aim && shapesRef.current.some((shape) => shape.kind === "note" && shape.name === aim)),
      previous: heardCursor.current,
      said: saidNoteRef.current,
    });
    heardCursor.current = heard.previous;
    setSaidNote((current) => (current?.step === heard.said?.step && current?.name === heard.said?.name ? current : heard.said));
  }, [aim, playing]);

  // What a step brings in for the first time fades in with the glide: a
  // transient signal of what is new, not a highlight that stays
  // (docs/concept.md, lesson 10). Only when advancing: going back animates
  // nothing, and the class is gone once the fade is over.
  const [fresh, setFresh] = useState<ReadonlySet<string>>(new Set());
  const freshTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const lastStep = useRef<number | undefined>(undefined);
  const onPlayingRef = useRef(onPlaying);
  onPlayingRef.current = onPlaying;
  const onStepPressRef = useRef(onStepPress);
  onStepPressRef.current = onStepPress;
  function goTo(step: number) {
    keepCamera.current = false;
    clearPlaybackQueue();
    const at = playingRef.current;
    const already = at !== undefined && step < at && finishedSteps.current.has(step);
    if (already) {
      showFinished.current = true;
      setBarInstant(true);
    } else if (step !== at) {
      setBarInstant(false);
      onStepPressRef.current?.(step);
    }
    setPlaying(step);
  }
  // How long a step plays when nothing is saying it: long enough to pause,
  // and about the pace of reading the words. A voice takes over when it
  // reports how much is said.
  const onPlaybackRef = useRef(onPlayback);
  onPlaybackRef.current = onPlayback;
  type Beat = "playing" | "paused" | "done";
  const beatRef = useRef<Beat>("done");
  const [beat, setBeat] = useState<Beat>("done");
  const beatLeft = useRef(0);
  const beatStamp = useRef(0);
  const beatTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const voiceOwns = useRef(false);
  // The voice has reported this step from before its end. A fraction that
  // is already 1 when the step starts belongs to the step just left.
  const voiceBegan = useRef(false);
  const voiceStep = useRef<number | undefined>(undefined);
  function setBeatTo(next: Beat) {
    if (next === "done" && playingRef.current !== undefined) finishedSteps.current.add(playingRef.current);
    if (beatRef.current === next) return;
    beatRef.current = next;
    setBeat(next);
  }
  // Which entry and step the beat was armed for. A speed change re-arms
  // the same step and must keep the voice's place in it.
  const beatKey = useRef("");
  function armBeat(ms: number, resetVoice: boolean) {
    clearTimeout(beatTimer.current);
    voiceOwns.current = false;
    if (resetVoice) {
      voiceBegan.current = false;
      voiceStep.current = playingRef.current;
    }
    beatLeft.current = ms;
    beatStamp.current = performance.now();
    setBarInstant(false);
    setBeatTo("playing");
    const root = rootRef.current;
    root?.setAttribute("data-beat-ms", String(Math.round(ms)));
    root?.setAttribute("data-beat-at", String(Math.round(performance.now())));
    beatTimer.current = setTimeout(() => {
      if (beatRef.current === "playing") {
        rootRef.current?.setAttribute("data-beat-done", String(Math.round(performance.now())));
        setBeatTo("done");
      }
    }, ms);
  }
  function pauseBeat() {
    if (beatRef.current !== "playing") return;
    releasePlaybackGlide();
    clearTimeout(beatTimer.current);
    if (!voiceOwns.current) beatLeft.current = Math.max(0, beatLeft.current - (performance.now() - beatStamp.current));
    setBeatTo("paused");
    onPlaybackRef.current?.(true);
  }
  function resumeBeat() {
    if (beatRef.current !== "paused") return;
    keepCamera.current = false;
    setBeatTo("playing");
    onPlaybackRef.current?.(false);
    if (voiceOwns.current) return;
    beatStamp.current = performance.now();
    beatTimer.current = setTimeout(() => {
      if (beatRef.current === "playing") setBeatTo("done");
    }, Math.max(0, beatLeft.current));
  }
  const onReplayRef = useRef(onReplay);
  onReplayRef.current = onReplay;
  // Space holds a step that is still going. On a finished step it plays
  // that step again. The next step is the right arrow.
  function replay() {
    const at = playingRef.current;
    if (at === undefined) return;
    keepCamera.current = false;
    finishedSteps.current.delete(at);
    showFinished.current = false;
    onStepPressRef.current?.(at);
    onReplayRef.current?.();
    clearPlaybackQueue();
    // A step restored from a canvas is shown finished, ink and highlight
    // already there. Playing it again draws them once more.
    barInstantRef.current = false;
    setBarInstant(false);
    setFrozenTrace(undefined);
    setKeptPointing(undefined);
    glideToStep(at, true, true);
    const words = stepsRef.current[at]?.narration?.split(/\s+/).filter(Boolean).length ?? 0;
    beatKey.current = `${entry}:${at}`;
    armBeat(silentMs(words), true);
    onPlaybackRef.current?.(false);
  }
  function spaceStep() {
    const at = playingRef.current;
    if (at === undefined) return;
    if (beatRef.current === "playing") pauseBeat();
    else if (beatRef.current === "paused") resumeBeat();
    else replay();
  }
  // The step a numbered arrow belongs to, if the walkthrough names it.
  function playHop(id: string) {
    const shape = shapeById(id);
    if (shape?.kind !== "arrow" || !shape.seq || preparingRef.current) return;
    const index = stepsRef.current.findIndex((step) => step.names.includes(`#${shape.seq}`));
    if (index < 0) return;
    viewUntouched.current = false;
    setReady(false);
    if (index === playingRef.current) {
      if (beatRef.current === "paused") resumeBeat();
      return;
    }
    goTo(index);
    rootRef.current?.focus({ preventScroll: true });
  }
  useEffect(() => {
    const previous = lastStep.current;
    lastStep.current = playing;
    onPlayingRef.current?.(playing);
    if (playing === undefined) {
      releasePlaybackGlide();
      return;
    }
    // Coming back to a canvas: the camera, the highlight and the arrow ink
    // are already what they were. A second pass of this effect (the
    // development render) must not glide the picture off that frame.
    if (keepCamera.current) {
      if (landedOn.current === playing) landedOn.current = undefined;
      rememberStepFrame(playing);
      if (frozenTrace && frozenTrace.drawn >= 1) traceFinished.current = frozenTrace.key;
      return;
    }
    // The zoom already framed this step. Do not glide it again. A fresh
    // entry still draws its opening arrow.
    if (landedOn.current === playing) {
      const restoring = holdRestore.current;
      landedOn.current = undefined;
      clearPlaybackQueue();
      if (restoring) {
        rememberStepFrame(playing);
        // A finished trace stays finished, so a highlight does not wait
        // to draw the arrow again. A partial one stays partial.
        if (frozenTrace && frozenTrace.drawn >= 1) traceFinished.current = frozenTrace.key;
        return;
      }
      keepCamera.current = false;
      setFrozenTrace(undefined);
      const arrowKey = barInstantRef.current ? undefined : openingArrowKey(playing);
      if (arrowKey) enqueueCamera({ kind: "step", target: { camera: cameraRef.current }, arrowKey }, true);
      return;
    }
    keepCamera.current = false;
    setFrozenTrace(undefined);
    setKeptPointing(undefined);
    landedOn.current = undefined;
    clearPlaybackQueue();
    glideToStep(playing, true, true);
    clearTimeout(freshTimer.current);
    if (previous !== undefined && playing <= previous) {
      setFresh(new Set());
      return;
    }
    setFresh(stepView(shapesRef.current, stepsRef.current, playing, groupsRef.current).added);
    freshTimer.current = setTimeout(() => setFresh(new Set()), 450);
  }, [playing, entry]);
  // The highlight's camera waits behind the step's opening glide and the
  // arrow draw that belongs to it. The glow (the pointed state, the marker)
  // is not queued: it follows the narration. A hover does not move the
  // camera. Each move is framed from the step, so they do not add up. A
  // pointing still set from the stop just left is ignored: the note's fold
  // measures it again after the new stop has framed the camera.
  useEffect(() => {
    if (keepCamera.current) return;
    const decision = cameraFollows({ playing, pointing: aim, followed: followedPointing.current });
    followedPointing.current = decision.followed;
    if (!decision.follow || playing === undefined || !aim) return;
    const framed = highlightFrame(aim, playing);
    if (!framed) return;
    if (sameCamera(framed.camera, cameraRef.current)) {
      if (playbackQueue.current.pendingHighlight) playbackQueue.current = { ...playbackQueue.current, pendingHighlight: null };
      return;
    }
    enqueueCamera({ kind: "highlight", target: { camera: framed.camera, name: aim }, ...(framed.arrowKey ? { arrowKey: framed.arrowKey } : {}) });
  }, [aim, playing, pointedSize]);
  // A step plays out, then waits. The voice, when it is saying the step,
  // replaces this timer (the progress loop below).
  useEffect(() => {
    if (playing === undefined) {
      clearTimeout(beatTimer.current);
      voiceOwns.current = false;
      voiceBegan.current = false;
      setBeatTo("done");
      return;
    }
    // Coming back to the step this canvas was left on. Finished stays
    // finished. One that was still going waits, and does not play itself.
    if (showFinished.current || holdRestore.current || openPaused.current) {
      const done = !openPaused.current && (showFinished.current || restoreBeat.current === "done");
      showFinished.current = false;
      holdRestore.current = false;
      openPaused.current = false;
      clearTimeout(beatTimer.current);
      voiceOwns.current = false;
      voiceBegan.current = false;
      if (done) {
        setBeatTo("done");
        onPlaybackRef.current?.(true);
        return;
      }
      const words = stepsRef.current[playing]?.narration?.split(/\s+/).filter(Boolean).length ?? 0;
      beatLeft.current = silentMs(words);
      setBeatTo("paused");
      onPlaybackRef.current?.(true);
      return;
    }
    const words = stepsRef.current[playing]?.narration?.split(/\s+/).filter(Boolean).length ?? 0;
    const ms = silentMs(words, playbackRate);
    const key = `${entry}:${playing}`;
    const resetVoice = beatKey.current !== key;
    beatKey.current = key;
    armBeat(ms, resetVoice);
    onPlaybackRef.current?.(false);
    return () => clearTimeout(beatTimer.current);
  }, [playing, playbackRate, entry]);
  function silentMs(words: number, rate = playbackRateRef.current) {
    return Math.max(800, Math.min(6000, 400 + words * 220)) / Math.max(0.25, rate);
  }

  // Set when a portal zoom already placed the camera on the ready framing.
  // Kept for the whole time that ready caption stays up: a second run of
  // this effect (the development render) must not glide the picture again.
  const arrivedReady = useRef(false);
  // Ready, the whole drawing sits above the caption.
  useEffect(() => {
    if (!ready) {
      arrivedReady.current = false;
      return;
    }
    if (arrivedReady.current) return;
    frameWhole();
  }, [ready]);

  // Opens the walkthrough, ready to start: the whole drawing, and the
  // caption waiting for Space or Play.
  function play() {
    // Opening the tour again starts it clean. Coming back from a canvas
    // does not: that path restores the step and keeps what was entered.
    enteredCanvases.current.clear();
    stopEditing();
    setSelected([]);
    setOpened(new Set());
    setTool("select");
    setPlaying(undefined);
    setReady(true);
    rootRef.current?.focus({ preventScroll: true });
  }
  // From ready to the first step: the reader's own press, which also lets
  // the page's voice play.
  function start() {
    if (preparingRef.current) return;
    viewUntouched.current = false;
    setReady(false);
    goTo(firstStep(stepsRef.current));
    rootRef.current?.focus({ preventScroll: true });
  }
  // A step back; from the first step, back to ready.
  function back() {
    const at = playingRef.current;
    if (at === undefined) return;
    if (at <= firstStep(stepsRef.current)) {
      releasePlaybackGlide();
      setPlaying(undefined);
      setReady(true);
    } else goTo(at - 1);
  }
  // Back to the whole sketch, out of the walkthrough.
  function stop() {
    releasePlaybackGlide();
    setReady(false);
    setPlaying(undefined);
  }
  // ?step=N: leave ready and wait on that stop. The voice stays paused,
  // the same call the pause button makes.
  function openAt(step: number): boolean {
    const index = indexForCountedStep(stepsRef.current, step);
    if (index === undefined) return false;
    fitGeneration.current += 1;
    stopEditing();
    setSelected([]);
    setOpened(new Set());
    setTool("select");
    viewUntouched.current = false;
    setReady(false);
    openPaused.current = true;
    if (playingRef.current === index) {
      openPaused.current = false;
      if (beatRef.current === "playing") pauseBeat();
      else {
        clearTimeout(beatTimer.current);
        voiceOwns.current = false;
        setBeatTo("paused");
        onPlaybackRef.current?.(true);
      }
    } else goTo(index);
    rootRef.current?.focus({ preventScroll: true });
    return true;
  }
  // An answered ask continues here, from the start of that step.
  function playFrom(step: number): boolean {
    const index = indexForCountedStep(stepsRef.current, step);
    if (index === undefined) return false;
    fitGeneration.current += 1;
    stopEditing();
    setSelected([]);
    setOpened(new Set());
    setTool("select");
    viewUntouched.current = false;
    setReady(false);
    openPaused.current = false;
    if (playingRef.current === index) replay();
    else goTo(index);
    rootRef.current?.focus({ preventScroll: true });
    return true;
  }
  function openAsk() {
    if (!onAskRef.current || playingRef.current === undefined) return;
    if (beatRef.current === "playing") pauseBeat();
    onAskRef.current();
  }

  // A field, or a menu, dialog or popover that is open, keeps Esc.
  function escapeIsTaken(target: EventTarget | null) {
    const el = target instanceof Element ? target : null;
    if (el?.closest("input, textarea, select, [contenteditable='true'], [contenteditable='plaintext-only']")) return true;
    return Boolean(document.querySelector("[role='dialog'][data-state='open'], [role='menu'][data-state='open'], [role='listbox'][data-state='open']"));
  }

  // Esc after the walkthrough is closed: one level out, the same as Back.
  // A zoom that is still running, or a held key, does not climb another.
  // True means this Esc was about the canvas (or a zoom) and is finished.
  function leaveCanvas(event: ReactKeyboardEvent) {
    if (escapeIsTaken(event.target)) return true;
    if (phaseRef.current === "in" || phaseRef.current === "out") return true;
    if (!adoptedRef.current || !onBackRef.current) return false;
    if (event.repeat) return true;
    event.preventDefault();
    onBackRef.current();
    return true;
  }

  // The canvas the up arrow opens (docs/plan-portals.md): the first canvas
  // on this step's arrows the reader has not entered, then one the step
  // names, then one its camera can see. Without a step, the first canvas
  // in view.
  function canvasToOpen(): string | undefined {
    const host = typeof location === "undefined" ? undefined : location.hostname;
    const portalsHere = shapesRef.current.filter((shape): shape is RectShape => shape.kind === "rect" && Boolean(portalSketchId(shape.link, host) ?? portalLabelId(shape.label, host)));
    const targetOf = (shape: RectShape) => portalSketchId(shape.link, host) ?? portalLabelId(shape.label, host)!;
    const byPlace = (list: RectShape[]) => [...list].sort((a, b) => a.x - b.x || a.y - b.y);
    const seen = (shape: RectShape) => {
      const cam = cameraRef.current;
      const root = rootRef.current;
      if (!root) return true;
      const x = cam.x + shape.x * cam.z;
      const y = cam.y + shape.y * cam.z;
      return x + shape.w * cam.z > 0 && y + shape.h * cam.z > 0 && x < root.clientWidth && y < root.clientHeight;
    };
    const at = playingRef.current;
    if (at !== undefined) {
      const along = sequenceCanvas(shapesRef.current, stepsRef.current, at, host, enteredCanvases.current);
      if (along) return along;
      const view = stepView(shapesRef.current, stepsRef.current, at, groupsRef.current);
      const named = byPlace(portalsHere.filter((shape) => view.highlighted.has(shape.id)));
      if (named[0]) return targetOf(named[0]);
      const visible = byPlace(portalsHere.filter((shape) => view.visible.has(shape.id) && seen(shape)));
      return visible[0] ? targetOf(visible[0]) : undefined;
    }
    const visible = byPlace(portalsHere.filter(seen));
    return visible[0] ? targetOf(visible[0]) : undefined;
  }

  function enterCanvas() {
    if (phaseRef.current === "in" || phaseRef.current === "out") return;
    const id = canvasToOpen();
    if (!id || !onOpenLinkRef.current) return;
    onOpenLinkRef.current(id, { x: 0, y: 0, w: 0, h: 0 });
  }

  function onKeyDown(event: ReactKeyboardEvent) {
    place();
    const typing = escapeIsTaken(event.target) || Boolean((event.target as Element).closest(EDITABLE));
    // Ask keeps the step where it is. Esc leaves it, back to the paused
    // walkthrough. ⌘⏎ or Ctrl+Enter copies the prompt, including from the
    // question field. C opens it, and closes it when the field is not focused.
    // Space on an answer continues, and skips the rest of the summary's voice.
    const panel = askRef.current;
    if (panel) {
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter" && panel.phase !== "summary") {
        event.preventDefault();
        panel.onCopy();
        return;
      }
      if (event.key === "Escape" && !document.querySelector("[role='dialog'][data-state='open'], [role='menu'][data-state='open'], [role='listbox'][data-state='open']")) {
        event.preventDefault();
        if (panel.phase === "waiting") panel.onCancel();
        else panel.onClose();
        return;
      }
      if (!typing && !event.metaKey && !event.ctrlKey && !event.altKey && event.key.toLowerCase() === "c") {
        event.preventDefault();
        if (panel.phase === "waiting") panel.onCancel();
        else panel.onClose();
        return;
      }
      if (typing) return;
      if (!event.repeat && panel.phase === "summary" && askSummaryKey(event.key) === "continue") {
        event.preventDefault();
        panel.onContinue();
        return;
      }
      if (event.key === " " || event.key === "ArrowLeft" || event.key === "ArrowRight") {
        event.preventDefault();
        return;
      }
    }
    // Up opens the step's canvas. Down leaves, the same as Back and Esc,
    // so the path can be walked with the arrows. A field, a menu or a zoom
    // keeps them.
    if ((event.key === "ArrowUp" || event.key === "ArrowDown") && !event.metaKey && !event.ctrlKey && !event.altKey) {
      if (escapeIsTaken(event.target) || (event.target as Element).closest(EDITABLE)) return;
      event.preventDefault();
      if (event.repeat || phaseRef.current === "in" || phaseRef.current === "out") return;
      if (event.key === "ArrowUp") { releasePlaybackGlide(); enterCanvas(); }
      else if (adoptedRef.current) { releasePlaybackGlide(); onBackRef.current?.(); }
      return;
    }
    if (readyRef.current && !(event.key === "Escape" && escapeIsTaken(event.target))) {
      if (event.key === " " || event.key === "Enter" || event.key === "ArrowRight") start();
      // Playback only. A second press, once this has closed, leaves the canvas.
      else if (event.key === "Escape") stop();
      else return;
      event.preventDefault();
      return;
    }
    if (playingRef.current !== undefined && !(event.key === "Escape" && escapeIsTaken(event.target))) {
      const at = playingRef.current;
      // C opens Ask and pauses. Space holds a step that is still playing,
      // and moves on only once that step has finished. A field or an open
      // menu keeps the key.
      if (!typing && !event.metaKey && !event.ctrlKey && !event.altKey && event.key.toLowerCase() === "c") {
        event.preventDefault();
        openAsk();
        return;
      }
      if (event.key === " " && !typing) {
        event.preventDefault();
        spaceStep();
        return;
      }
      if (event.key === "ArrowRight") goTo(Math.min(stepsRef.current.length - 1, at + 1));
      else if (event.key === "ArrowLeft") back();
      else if (event.key === "Escape") stop();
      else return;
      event.preventDefault();
      return;
    }
    if ((event.target as Element).closest(EDITABLE)) {
      if (event.key === "Escape") {
        event.preventDefault();
        stopEditing();
        rootRef.current!.focus({ preventScroll: true });
      }
      return;
    }
    const key = event.key.toLowerCase();
    if (readOnly) {
      if (event.metaKey && key === "a") {
        event.preventDefault();
        select(shapesRef.current.map((shape) => shape.id));
      } else if (key === "escape") {
        if (leaveCanvas(event)) return;
        setSelected([]);
        setOpened(new Set());
      } else if (key === " ") {
        event.preventDefault();
        spaceDown.current = true;
      }
      return;
    }
    if (event.metaKey && key === "z") {
      event.preventDefault();
      if (event.shiftKey) restore(future, past);
      else restore(past, future);
      return;
    }
    if (event.metaKey && key === "a") {
      event.preventDefault();
      select(shapesRef.current.map((shape) => shape.id));
      return;
    }
    if (event.metaKey && key === "d") {
      event.preventDefault();
      insertCopies(shapesRef.current.filter((shape) => selected.includes(shape.id)), 24);
      return;
    }
    if (event.metaKey || event.altKey || event.ctrlKey) return;
    if (key === "backspace" || key === "delete") {
      event.preventDefault();
      deleteSelected();
    } else if (key === "escape") {
      if (leaveCanvas(event)) return;
      setSelected([]);
      setOpened(new Set());
      setTool("select");
    } else if (key === "enter" && selected.length === 1) {
      const shape = shapesRef.current.find((item) => item.id === selected[0]);
      if (shape) {
        event.preventDefault();
        startEditing(shape.id);
      }
    } else if (key === " ") {
      event.preventDefault();
      spaceDown.current = true;
    } else {
      if (key === "q" || key === "e") {
        const notes = shapesRef.current.filter((shape) => shape.kind === "note" && selected.includes(shape.id));
        if (notes.length > 0) {
          event.preventDefault();
          resizeText(key === "e" ? 1 : -1);
          return;
        }
      }
      const next = TOOLS.find((item) => item.key === key);
      if (next) setTool(next.id);
    }
  }

  // While playing, only what the steps so far bring in is drawn. The step's
  // own shapes carry a class (not styled) so tests can find them, and the
  // ones it just brought in another, which fades them in. Inside a portal
  // the steps belong to the child: they must not hide the parent boxes the
  // child is drawn in (those ids are not the child's).
  const focusView = playing !== undefined && focusShapes ? stepView(focusShapes, steps, playing, focusGroups ?? groups) : undefined;
  const view = playing !== undefined && !focusShapes ? stepView(shapes, steps, playing, groups) : undefined;
  const boxes = shapes.filter(isBox).filter((shape) => !view || view.visible.has(shape.id));
  const arrows = shapes.filter((shape): shape is ArrowShape => shape.kind === "arrow" && (!view || view.visible.has(shape.id)));
  const selectedShapes = shapes.filter((shape) => selected.includes(shape.id));
  const step = playing !== undefined ? steps[playing] : undefined;
  // A silent overview is not counted: the ready state shows it.
  const first = firstStep(steps);
  // The step bar follows the voice frame by frame, through a CSS variable
  // on its segments: how much is said.
  const progressRef = useRef<HTMLDivElement>(null);
  const fillRef = useRef(stepFill);
  fillRef.current = stepFill;
  const filling = Boolean(stepFill) && (ready || playing !== undefined);
  useLayoutEffect(() => {
    if (!filling) return;
    let frame = 0;
    const tick = () => {
      const segments = progressRef.current?.children ?? [];
      const at = playingRef.current;
      if (voiceStep.current !== at) {
        voiceStep.current = at;
        voiceBegan.current = false;
      }
      for (let index = 0; index < segments.length; index++) {
        const step = index + first;
        const voice = step === at ? fillRef.current?.(step).said : undefined;
        // A voice that is saying this step owns when it ends. Until it
        // reports a fraction below the end, the board's own timer does.
        // A fraction that is already 1 on the first look belongs to the
        // step just left: its stream can still be reporting the end after
        // the step has changed.
        if (step === at && voice !== undefined && voice < 1) {
          voiceBegan.current = true;
          if (!voiceOwns.current) {
            voiceOwns.current = true;
            clearTimeout(beatTimer.current);
          }
        }
        if (step === at && voiceBegan.current && voice !== undefined && voice >= 1 && beatRef.current === "playing") setBeatTo("done");
        const finished = beatRef.current === "done";
        const voicedEnd = voiceBegan.current && voice !== undefined && voice >= 1;
        // A 1 that arrived before this step had started is the previous
        // step's end. Drawing it would fill the new segment at once.
        const reading = voice !== undefined && voice >= 1 && !voiceBegan.current ? 0 : voice;
        const said = at === undefined || step > at ? 0 : step < at || finished ? 1 : reading ?? 1;
        const segment = segments[index] as HTMLElement;
        segment.style.setProperty("--said", String(said));
        // Said to its end: the segment turns green, the cue to go on.
        // Steps already left are finished, and so is the one on screen
        // once its beat has.
        segment.toggleAttribute("data-said", at !== undefined && (step < at || (step === at && (finished || voicedEnd))));
      }
      frame = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(frame);
  }, [filling, playing, first, steps.length]);
  const handleSize = 9 / camera.z;
  const line = 1.5 / camera.z;
  // The shape a reference in the caption points at, hovered or being said;
  // a group points at its members too, and a numbered arrow colours its
  // badge, like the hop a step names (docs/format.md, Steps).
  const pointed = playing !== undefined ? hoveredRef ?? aim : undefined;
  const referable = referableNames([...boxes, ...arrows], groups);
  const readyText = readyTeaser(steps, referable);
  const { names: pointedNames, arrows: pointedArrows } = pointedSet(pointed, shapes, groups);
  const hopsOn = new Set([...(view?.hops ?? []), ...pointedArrows]);
  // Colour is a state (docs/board.md, Arrow): a box shows it on its tag,
  // an arrow on its badge and, quieter, its line, so a path still reads as
  // one. The box the numbered flow starts from (the start of its lowest
  // number) is the primary: filled with its colour, ink by default; every
  // other box is an outline on the board's ground, inside a group too, in
  // its tag's colour when it has a tag (as an open note is edged in its
  // pill's), else ink. A portal keeps that outline even when it is the
  // start, so the sketch inside stays visible (docs/plan-portals.md).
  // The arrow under
  // the pointer, or the hop the walkthrough is at, is drawn in its full
  // colour, and the boxes at its ends take a white ground: what we are
  // looking at now. The hop the walkthrough is at also rings its number
  // and label in the accent, as a box the narration names is: where we
  // are now.
  const lit = new Set([...hopsOn, ...[hoveredArrow, hoveredSeq].filter((id): id is string => Boolean(id))]);
  const litEnds = new Set(arrows.filter((arrow) => lit.has(arrow.id)).flatMap((arrow) => [nearBox(boxes, arrow.from), nearBox(boxes, arrow.to)]).filter((box): box is Box => Boolean(box)).map((box) => box.id));
  const primary = startBoxes(shapes);
  const rectStyle = (shape: RectShape) => primary.has(shape.id) && !portalTarget(shape)
    ? { borderColor: COLORS[shape.color], background: COLORS[shape.color], color: ON_COLORS[shape.color] }
    : { borderColor: shape.tag ? COLORS[shape.color] : COLORS.white, background: litEnds.has(shape.id) ? LIT : BACKGROUND, color: FOREGROUND };
  const arrowStroke = (arrow: ArrowShape) => (lit.has(arrow.id) ? COLORS : QUIET_COLORS)[arrow.color];
  const isPointed = (shape: Shape) => shape.kind !== "arrow" && Boolean(shape.name) && pointedNames.has(shape.name!);
  const current = (shape: Shape) => `${view?.highlighted.has(shape.id) ? "sketch-step-current" : ""} ${fresh.has(shape.id) ? "sketch-step-new" : ""} ${isPointed(shape) ? "sketch-pointed" : ""}`.replace(/\s+/g, " ").trim();

  // A note with more than one block folds to its first line, and is open
  // while it has been opened or is edited, or, while playing, named by the
  // step (docs/board.md, Notes fold). Nothing is stored for it; an open
  // note is drawn as wide as its code needs.
  // In a walkthrough of overview and hops, a note opens when the narration
  // names it: as the voice says it, or while its words are hovered; with no
  // voice, for the whole stop (docs/format.md, Walkthrough).
  // One note is open at a time while playing: the one whose words are
  // hovered, else the one the voice said last, else (no voice) the first
  // the stop names, else the first the step shows.
  const visibleNotes = view ? shapes.filter((shape): shape is NoteShape => shape.kind === "note" && view.visible.has(shape.id)) : [];
  const noteNamed = (name: string | undefined) => (name ? visibleNotes.find((note) => note.name === name) : undefined);
  const saidName = saidNote && saidNote.step === playing ? saidNote.name : undefined;
  const openNote = view
    ? (noteNamed(hoveredRef) ?? noteNamed(saidName)
      ?? (!voiced ? firstNote(namedIn(step, shapes, groups), visibleNotes) : undefined)
      ?? visibleNotes.find((note) => view.highlighted.has(note.id)))?.id
    : undefined;
  const noteOpen = (note: NoteShape) => (view ? stepFolds.get(note.id) ?? note.id === openNote : opened.has(note.id) || editing === note.id);
  const drawn = (shape: Box): Box => (shape.kind === "note" && foldsNote(shape) && noteOpen(shape) ? openBox(shape) : shape);
  drawnRef.current = new Map(boxes.map((shape) => [shape.id, drawn(shape)]));
  // Curves and labels for what is on screen. Hidden steps are not obstacles,
  // and the bend handle's drag is drawn exactly where the pointer is.
  const arrowLayout = layoutArrows(arrows, boxes.map((shape) => {
    const box = drawn(shape);
    return { x: box.x, y: box.y, w: box.w, h: box.h };
  }), { pin: bendPin, labelSizes });
  arrowLayoutRef.current = arrowLayout;

  // A step's note opens after the glide and grows: glide again to fit it.
  const currentSize = view ? boxes.filter((shape) => view.highlighted.has(shape.id)).map((shape) => `${drawn(shape).w}x${shape.h}`).join(",") : "";
  useEffect(() => {
    if (keepCamera.current) return;
    if (playing !== undefined && currentSize) glideToStep(playing);
  }, [currentSize]);

  const regions = new Map(groups.flatMap((group) => {
    const members = regionMembers(group, boxes);
    return members.length ? [[group.name, groupRegion(members.map(drawn))] as const] : [];
  }));
  // What the presenter's marker is on (docs/board.md, Marker): a shape the
  // voice names is pointed at, resting at its lower right so its label
  // stays clear; else the hop the step is at (or the arrow the voice
  // names) is traced.
  let markerPoint: MarkerPoint | undefined;
  let markerTrace: MarkerTrace | undefined;
  const stepWaiting = playing !== undefined && Boolean(waiting?.step(playing));
  // A reference the reader's pointer is on is pointed at whether or not the
  // step's voice is sounding (paused, or said already): the marker goes to
  // it. What the voice traces waits for the voice, as before.
  const hoverPoint = playing !== undefined && hoveredRef !== undefined && Boolean(holding?.(playing));
  if (hoverPoint && pointed && !pointed.startsWith("#")) {
    const shape = boxes.find((item) => item.name === pointed);
    const rect = shape ? drawn(shape) : regions.get(pointed);
    if (rect) markerPoint = { key: `${pointed}:${playing}`, name: pointed, x: rect.x + rect.w - 16, y: rect.y + rect.h - 12 };
  }
  if (playing !== undefined && !holding?.(playing)) {
    if (pointed && !pointed.startsWith("#")) {
      const shape = boxes.find((item) => item.name === pointed);
      const rect = shape ? drawn(shape) : regions.get(pointed);
      if (rect) markerPoint = { key: `${pointed}:${playing}`, name: pointed, x: rect.x + rect.w - 16, y: rect.y + rect.h - 12 };
    }
    const held = heldTrace ? arrows.find((arrow) => `${arrow.id}:${playing}` === heldTrace) : undefined;
    const hop = held ?? arrows.find((arrow) => pointedArrows.has(arrow.id)) ?? arrows.find((arrow) => hopsOn.has(arrow.id));
    if (hop) markerTrace = { key: `${hop.id}:${playing}`, arrow: hop.id, d: arrowLine(arrowLayout.shown(hop)) };
  }
  useEffect(() => {
    if (ask?.phase === "compose") askFieldRef.current?.focus();
    // The summary waits for Space. The question field is gone, so the
    // board takes the key.
    else if (ask?.phase === "summary") rootRef.current?.focus({ preventScroll: true });
  }, [ask?.phase]);

  // The definition under the term the pointer is on, placed in the board's
  // own coordinates; off a term, none.
  function showTerm(target: EventTarget | null) {
    const element = termAt(target);
    if (!element) {
      setTermTip(undefined);
      return;
    }
    const word = element.getBoundingClientRect();
    const board = rootRef.current!.getBoundingClientRect();
    setTermTip({ term: element.dataset.term!, definition: element.dataset.definition ?? "", x: word.left - board.left, y: word.bottom - board.top + 6 });
  }

  // While inside a sketch, that sketch and the portals along the way stay
  // live. Everything else in the parents is hidden, not faded.
  const linksOf = (list: Shape[]) => list.flatMap((shape) => (shape.kind === "rect" ? [portalTarget(shape)].filter((id): id is string => Boolean(id)) : []));
  const reach = openPortalId ? portalReach((sketchId) => {
    const list = sketchId ? (portals?.[sketchId]?.status === "open" ? portals[sketchId].shapes ?? [] : []) : shapes;
    return linksOf(list);
  }, openPortalId) : undefined;
  const hostReach = hostPicture && openPortalId ? portalReach((sketchId) => {
    const list = sketchId ? (portals?.[sketchId]?.status === "open" ? portals[sketchId].shapes ?? [] : []) : hostPicture.shapes;
    return linksOf(list);
  }, openPortalId) : undefined;

  return (
    <div
      ref={rootRef}
      className={`sketch sketch-tool-${tool} ${panning ? "sketch-panning" : ""} ${gliding ? "sketch-gliding" : ""} ${portalGlide ? "sketch-portal-glide" : ""} ${portalTravel === "in" ? "sketch-portal-in" : ""} ${portalTravel === "out" ? "sketch-portal-out" : ""} ${portalTravel === "pan" ? "sketch-portal-pan" : ""} ${portalFade ? "sketch-portal-fade" : ""} ${entered ? "sketch-entered" : ""} ${asking ? "sketch-asking" : ""} ${!placed && shapes.length ? "sketch-placing" : ""}`}
      {...(portalGlide || portalTravel ? { "data-testid": "portal-zoom" } : {})}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onPointerLeave={() => { setTermTip(undefined); }}
      onPointerOver={(event) => showTerm(event.target)}
      onDoubleClick={onDoubleClick}
      onKeyDown={onKeyDown}
      onKeyUp={(event) => { if (event.key === " ") spaceDown.current = false; }}
    >
      <style>{SKETCH_CSS}</style>
      <div className="sketch-stage">
      <div ref={worldRef} className="sketch-world" style={{ transform: `translate(${camera.x}px, ${camera.y}px) scale(${camera.z})`, ...(portalGlide ? { transition: "transform 640ms cubic-bezier(0.4, 0, 0.2, 1)" } : {}) }}>
        {groups.map((group) => {
          // Behind its members, around the member boxes on screen (a member
          // note hangs beside its box, outside); none, no region.
          const members = regionMembers(group, boxes);
          return members.length ? <GroupView key={group.name} group={group} pointed={pointedNames.has(group.name)} region={groupRegion(members.map(drawn))} /> : null;
        })}
        {/* Behind the boxes and notes: an arrow that passes under one is
            hidden by its ground. */}
        <svg className="sketch-arrows">
          {/* An arrow breaks where it crosses a group's edge, GROUP_GAP on
              each side, as it stops short of a box (docs/board.md, Group). */}
          {regions.size > 0 && (
            <defs>
              <mask id={gapMask} maskUnits="userSpaceOnUse" x={-100000} y={-100000} width={200000} height={200000}>
                <rect x={-100000} y={-100000} width={200000} height={200000} fill="#fff" />
                {[...regions.values()].map((region, index) => <rect key={index} x={region.x} y={region.y} width={region.w} height={region.h} rx={6} fill="none" stroke="#000" strokeWidth={2 * GROUP_GAP} />)}
              </mask>
            </defs>
          )}
          {arrows.map((arrow) => {
            // A note's connector is a headless line; an arrow between parts
            // has its head. Selection, drags, bends, labels and the text are
            // the same for both.
            const connector = isConnector(shapes, arrow);
            const drawnArrow = arrowLayout.shown(arrow);
            const stroke = { stroke: arrowStroke(arrow), strokeLinecap: "round" as const, strokeLinejoin: "round" as const, fill: "none" };
            return (
              <g key={arrow.id} data-shape-id={arrow.id} className={lit.has(arrow.id) ? "sketch-arrow-on" : undefined} mask={regions.size > 0 ? `url(#${gapMask})` : undefined}>
                <path className="sketch-arrow-hit" onPointerEnter={() => setHoveredArrow(arrow.id)} onPointerLeave={() => setHoveredArrow(undefined)} d={connector ? arrowLine(drawnArrow) : arrowPath(drawnArrow)} stroke="transparent" strokeWidth={14} fill="none" />
                <path className={connector ? "sketch-line" : "sketch-arrow"} d={arrowLine(drawnArrow)} style={stroke} />
                {!connector && <path className="sketch-arrow-head" d={arrowHead(drawnArrow)} style={stroke} />}
              </g>
            );
          })}
        </svg>
        {boxes.map((shape) => shape.kind === "rect" ? (
          <div
            key={shape.id}
            data-shape-id={shape.id}
            data-name={shape.name}
            className={`sketch-rect ${portalTarget(shape) ? "sketch-portal" : ""} ${litEnds.has(shape.id) ? "sketch-linked" : ""} ${current(shape)}`.replace(/\s+/g, " ").trim()}
            style={{ left: shape.x, top: shape.y, width: shape.w, height: shape.h, ...rectStyle(shape) }}
            {...(portalTarget(shape) ? { "data-link": portalTarget(shape), "data-status": portals?.[portalTarget(shape)!]?.status ?? "loading", ...(openPortalId === portalTarget(shape) ? { "data-portal-open": "" } : {}), ...(reach?.path.has(portalTarget(shape)!) ? { "data-portal-path": "" } : {}) } : {})}
          >
            {portalTarget(shape) ? null : <ShapeTag shape={shape} editing={editingTag === shape.id} onSave={(value) => saveTag(shape.id, value)} />}
            {portalTarget(shape) && (() => {
              const target = portalTarget(shape)!;
              const card = drawnPortals?.[target];
              const badge = portalBadge(shape.label, card);
              return (
                <>
                  {badge && <CanvasBadge text={badge} color={shape.color} />}
                  {card?.status === "open" && card.shapes?.length ? (
                    <PortalInset shapes={card.shapes} groups={card.groups} width={Math.max(1, shape.w - 28)} height={Math.max(1, shape.h - 20)} depth={0} portals={drawnPortals} host={typeof location === "undefined" ? undefined : location.hostname} onOpen={(next) => onOpenLink?.(next, { x: 0, y: 0, w: 0, h: 0 })} openId={openPortalId} highlight={(focusView ?? view)?.highlighted} view={viewSize} path={reach?.path} liveIds={reach?.live} reveal={takeReveal(target)} takeReveal={takeReveal} />
                  ) : null}
                  <button
                    type="button"
                    className="sketch-link"
                    data-link={target}
                    data-status={card?.status ?? "loading"}
                    title={onOpenLink ? "Zoom into this canvas" : "A canvas of another sketch"}
                    aria-label={card?.status === "locked" ? "Private sketch" : card?.status === "missing" ? "Sketch not found" : `Zoom into ${badge || "this canvas"}`}
                    disabled={!onOpenLink}
                    style={reach?.path.has(target) ? { pointerEvents: "none" } : undefined}
                    onPointerDown={(event) => { event.stopPropagation(); event.preventDefault(); }}
                    onDoubleClick={(event) => event.stopPropagation()}
                    onClick={() => onOpenLink?.(target, { x: shape.x, y: shape.y, w: shape.w, h: shape.h })}
                  />
                </>
              );
            })()}
            {portalTarget(shape) ? null : editing === shape.id
              ? <LabelEditor initial={shape.label} onChange={(label) => change((list) => list.map((item) => (item.id === shape.id ? { ...item, label } : item)))} />
              : shape.label && <div className="sketch-label"><TermText text={shape.label} terms={terms} /></div>}
            {!portalTarget(shape) && externalHref(shape.link) && <ExternalLink href={externalHref(shape.link)!} color={shape.color} />}
          </div>
        ) : (
          <NoteView
            key={shape.id}
            note={shape}
            editing={editing === shape.id}
            fold={foldsNote(shape) ? (noteOpen(shape) ? "open" : "folded") : "none"}
            width={drawn(shape).w}
            tagged={false}
            terms={terms}
            className={current(shape)}
            onEditor={setNoteEditor}
            onChange={(html) => change((list) => list.map((item) => (item.id === shape.id ? { ...item, html } : item)))}
            onMeasure={(h) => {
              // A folding note's height is its badge, measured before layout.
              // The open panel is taller; taking that height would aim arrows
              // at a body that is gone once the note is folded.
              if (foldsNote(shape)) return;
              setShapes((list) => list.map((item) => (item.id === shape.id && item.kind === "note" && Math.abs(item.h - h) > 0.5 ? { ...item, h } : item)));
            }}
            onToggleFold={() => toggleFold(shape.id, noteOpen(shape))}
          />
        ))}
        {playing !== undefined && <Marker trace={markerTrace} point={markerPoint} zoom={camera.z} paused={beat === "paused" && hoveredRef === undefined} rate={playbackRate} instant={barInstant && !(frozenTrace && markerTrace && frozenTrace.key === markerTrace.key)} drawn={frozenTrace && markerTrace && frozenTrace.key === markerTrace.key ? frozenTrace.drawn : undefined} onTraceDone={onArrowFinished} onDrawn={(key, drawn) => { traceNow.current = { key, drawn }; }} />}
        {arrows.map((arrow) => (editing === arrow.id || editingSeq === arrow.id || arrow.label || arrow.seq) && (
          <div
            key={arrow.id}
            data-shape-id={arrow.id}
            className={["sketch-arrow-label", arrow.seq || editingSeq === arrow.id ? "sketch-arrow-label-seq" : "", lit.has(arrow.id) ? "sketch-arrow-on" : "", hopsOn.has(arrow.id) ? "sketch-arrow-current" : ""].filter(Boolean).join(" ")}
            style={{ left: arrowLayout.label(arrow).x, top: arrowLayout.label(arrow).y, color: FOREGROUND }}
            onPointerEnter={() => setHoveredArrow(arrow.id)}
            onPointerLeave={() => setHoveredArrow(undefined)}
          >
            <ArrowSeq arrow={arrow} editing={editingSeq === arrow.id} onSave={(value) => saveSeq(arrow.id, value)} onHover={(over) => setHoveredSeq(over ? arrow.id : undefined)} />
            {editing === arrow.id
              ? <LabelEditor initial={arrow.label ?? ""} onChange={(label) => change((list) => list.map((item) => (item.id === arrow.id ? { ...item, label } : item)))} />
              : arrow.label && <div className="sketch-label"><TermText text={arrow.label} terms={terms} /></div>}
          </div>
        ))}
        <div className="sketch-ui">
          {selectedShapes.map((shape) => {
            if (shape.kind === "arrow") {
              if (readOnly) return null;
              // Ends sit on the stroke that is drawn. While one is dragged
              // they follow the pointer, which is the stored point.
              const painted = arrowLayout.shown(shape);
              const dragging = drag.current?.kind === "arrow-end" && drag.current.id === shape.id ? drag.current.end : undefined;
              const ends: [string, Point][] = [
                ["from", dragging === "from" ? shape.from : painted.from],
                ["to", dragging === "to" ? shape.to : painted.to],
                ["bend", arrowMidpoint(shape.from, shape.to, arrowLayout.bend(shape))],
              ];
              return ends.map(([which, point]) => (
                <div
                  key={`${shape.id}-${which}`}
                  className={`sketch-handle sketch-handle-round ${which === "bend" ? "sketch-handle-bend" : ""}`}
                  data-id={shape.id}
                  data-handle={which}
                  style={{ left: point.x - handleSize / 2, top: point.y - handleSize / 2, width: handleSize, height: handleSize, borderWidth: line }}
                />
              ));
            }
            const box = drawn(shape);
            const corners = readOnly || selectedShapes.length > 1 || editing === shape.id ? [] : shape.kind === "rect" ? ["nw", "ne", "sw", "se"] : ["e"];
            return (
              <div key={shape.id}>
                <div className="sketch-outline" style={{ left: box.x - 3 / camera.z, top: box.y - 3 / camera.z, width: box.w + 6 / camera.z, height: box.h + 6 / camera.z, borderWidth: line }} />
                {!readOnly && selectedShapes.length === 1 && shape.kind === "rect" && !shape.tag && editingTag !== shape.id && editing !== shape.id && playing === undefined && (
                  <button
                    className="sketch-chrome sketch-tag-add"
                    style={{ left: shape.x + 10, top: shape.y - 10 }}
                    title="Add a tag"
                    onClick={() => startTagEditing(shape.id)}
                  >
                    + tag
                  </button>
                )}
                {corners.map((corner) => (
                  <div
                    key={corner}
                    className={`sketch-handle sketch-handle-${corner}`}
                    data-id={shape.id}
                    data-handle={corner}
                    style={{
                      left: (corner.includes("w") ? box.x : box.x + box.w) - handleSize / 2,
                      top: (corner === "e" ? box.y + box.h / 2 : corner.includes("n") ? box.y : box.y + box.h) - handleSize / 2,
                      width: handleSize,
                      height: handleSize,
                      borderWidth: line,
                    }}
                  />
                ))}
              </div>
            );
          })}
          {marquee && (
            <div
              className="sketch-marquee"
              style={{ left: Math.min(marquee.a.x, marquee.b.x), top: Math.min(marquee.a.y, marquee.b.y), width: Math.abs(marquee.b.x - marquee.a.x), height: Math.abs(marquee.b.y - marquee.a.y), borderWidth: 1 / camera.z }}
            />
          )}
        </div>
      </div>
      {hostPicture && (
        <div ref={hostWorldRef} className="sketch-world sketch-host" style={{ pointerEvents: "none" }}>
          <HostWorld shapes={hostPicture.shapes} groups={hostPicture.groups} portals={drawnPortals} openId={openPortalId} path={hostReach?.path} liveIds={hostReach?.live} view={viewSize} host={typeof location === "undefined" ? undefined : location.hostname} labelSizes={labelSizes} />
        </div>
      )}
      </div>

      {playing === undefined && !ready && !readOnly && <div ref={toolbarRef} className={`sketch-chrome sketch-toolbar ${stacked ? "sketch-toolbar-stacked" : ""}`}>
        <div className="sketch-row">
          {TOOLS.map((item) => (
            <button key={item.id} className={tool === item.id ? "sketch-active" : ""} title={`${item.label} (${item.key.toUpperCase()})`} onClick={() => setTool(item.id)}>
              <item.icon size={15} />
            </button>
          ))}
          <span className="sketch-divider" />
          <button title="Undo (⌘Z)" onClick={() => restore(past, future)}><Undo2 size={15} /></button>
          <button title="Redo (⇧⌘Z)" onClick={() => restore(future, past)}><Redo2 size={15} /></button>
          <button title="Delete (⌫)" disabled={selected.length === 0} onClick={deleteSelected}><Trash2 size={15} /></button>
        </div>
        <div className="sketch-row">
          {COLOR_NAMES.map((color) => (
            <button key={color} className={`sketch-swatch ${style.color === color ? "sketch-active" : ""}`} title={color} onClick={() => applyStyle({ color })}>
              <span style={{ background: COLORS[color] }} />
            </button>
          ))}
        </div>
        {noteEditor && editing && <FormatBar editor={noteEditor} />}
      </div>}

      {topLeft && <div ref={topLeftRef} className="sketch-chrome sketch-topleft">{topLeft}</div>}
      {playing === undefined && (steps.length > 0 || topRight) && (
        <div ref={topRightRef} className="sketch-chrome sketch-topright">
          {steps.length > 0 && !ready && (
            <button className="sketch-play" title="Walk through the sketch step by step" onClick={play}>
              <Play size={13} />Play<span className="sketch-play-count">{steps.length} steps</span>
            </button>
          )}
          {topRight}
        </div>
      )}
      {ask && (
        <div className="sketch-chrome sketch-steps sketch-steps-ask" data-ask="true" {...(playing !== undefined ? { "data-playback": beat } : {})}>
          {ask.view && ask.phase !== "compose" && panelHeader}
          {ask.view && ask.phase !== "compose" ? <div className="sketch-caption sketch-ask" data-testid="ask" data-ask-phase={ask.phase}>{ask.view}</div>
            : <AskView phase={ask.phase} question={ask.question} copied={ask.copied} summary={ask.summary} fieldRef={askFieldRef} onQuestion={ask.onQuestion} onCopy={ask.onCopy} onCancel={ask.onCancel} onClose={ask.onClose} onContinue={ask.onContinue} />}
        </div>
      )}
      {!ask && ready && (
        // Ready: the whole drawing, and the caption waits for the reader to
        // start (docs/board.md, Walkthrough).
        <div className={`sketch-chrome sketch-steps sketch-steps-ready ${preparing ? "sketch-steps-waiting" : ""}`.trim()}>
          {preparing && <span className="sketch-wave" aria-hidden />}
          {panelHeader}
          <div className="sketch-caption sketch-caption-ready">
            {/* As wide as the close button, so the start sits in the middle. */}
            <span className="sketch-ready-balance" aria-hidden />
            {preparing ? <div className="sketch-ready-start sketch-preparing">{preparing}</div>
              : standby ? <div className="sketch-ready-start" data-standby="true">{standby}</div> : (
              <div className="sketch-ready-body">
                {/* What the walkthrough is about before Play: the why. */}
                {readyText.teaser && <p className="sketch-ready-teaser">“{readyText.teaser}”</p>}
                <div className="sketch-ready-play">
                  <button className="sketch-start" title="Start the walkthrough (Space)" onClick={start}><Play size={14} />{startLabel ?? "Play"}<kbd>Space</kbd></button>
                  {speedControl}
                  <span className="sketch-ready-meta">{readyText.meta}</span>
                </div>
              </div>
            )}
            <div className="sketch-step-end">
              <button className="sketch-step-close" title="Show the whole sketch (Esc)" onClick={stop}><X size={15} /></button>
            </div>
          </div>
          <div className="sketch-step-progress" ref={progressRef}>
            {steps.slice(first).map((item, index) => <span key={index} data-kind={item.kind} />)}
          </div>
        </div>
      )}
      {!ask && step && playing !== undefined && (
        // The narration is a caption at the bottom centre, under the step's
        // shapes: words next to the picture (docs/board.md, Walkthrough).
        <div className={`sketch-chrome sketch-steps ${stepWaiting ? "sketch-steps-waiting" : ""}`.trim()} data-quiet={quiet ? "true" : "false"} data-playback={beat}>
          {/* Waiting for the step's voice looks as the wait before the first. */}
          {stepWaiting && <span className="sketch-wave" aria-hidden />}
          {panelHeader}
          <div className="sketch-caption">
            <div className="sketch-step-top">
              <div className="sketch-step-tools">
                {onQuiet && step.narration && (
                  <button className="sketch-step-words" title={quiet ? "Show the words" : "Hide the words"} aria-label={quiet ? "Show the words" : "Hide the words"} onClick={() => onQuiet(!quiet)}>
                    {quiet ? <Captions size={15} /> : <CaptionsOff size={15} />}{quiet ? "Show text" : "Hide text"}
                  </button>
                )}
                {stepEnd}
                {onAsk && (
                  <button type="button" className="sketch-ask-toggle" title="Ask your agent about this step (C)" aria-label="Ask" onClick={openAsk}>
                    <MessageSquare size={15} />Ask
                  </button>
                )}
              </div>
              <div className="sketch-step-end">
                <button className="sketch-step-close" title="Show the whole sketch (Esc)" onClick={stop}><X size={15} /></button>
              </div>
            </div>
            <div className="sketch-narration-column">
              {/* The step's voice is not made yet: the wait in place of its
                  words, which come with the voice. */}
              {stepWaiting ? <div key={playing} className="sketch-ready-start sketch-preparing">{waiting!.view}</div> : step.narration && !quiet && (
                <p className="sketch-narration">
                  {narrationParts(step.narration, referable).map((part, index) => part.name ? (
                    <span
                      key={index}
                      className={`sketch-ref ${pointed === part.name ? "sketch-ref-on" : ""}`.trim()}
                      data-ref={part.name}
                      onPointerEnter={() => setHoveredRef(part.name)}
                      onPointerLeave={() => setHoveredRef(undefined)}
                    ><TermText text={part.text} terms={terms} /></span>
                  ) : <TermText key={index} text={part.text} terms={terms} />)}
                </p>
              )}
              {!stepWaiting && caption}
            </div>
          </div>
          <div className="sketch-step-foot">
            {/* Where we are, in front of the bar: the overview and summary
                point at no hop, so a still board says so here. */}
            <span className="sketch-step-title" data-kind={step.kind ?? "step"}>{stepTitle(steps, playing, first)}</span>
            <div className="sketch-step-progress" ref={progressRef} {...(barInstant ? { "data-instant": "true" } : {})}>
              {/* With a voice the frame loop sets each fill: a segment drawn
                  full by its class until the loop's first frame flashed
                  full, then emptied (the first step's bar is new). */}
              {steps.slice(first).map((item, index) => {
                const at = index + first;
                const finished = at < playing || (at === playing && beat === "done");
                return <span key={index} data-kind={item.kind} className={!filling && at <= playing ? "sketch-step-done" : ""} {...(!filling && finished ? { "data-said": "true" } : {})} />;
              })}
            </div>
            <div className="sketch-step-controls">
              {speedControl}
              <button title="Previous step (←)" onClick={back}><ChevronLeft size={16} /></button>
              <button type="button" className="sketch-step-pause" aria-pressed={beat === "paused"} title={beat === "paused" ? "Resume (Space)" : beat === "playing" ? "Pause (Space)" : "Replay (Space)"} onClick={spaceStep}>
                {beat === "playing" ? <Pause size={16} /> : beat === "done" ? <RotateCcw size={16} /> : <Play size={16} />}
              </button>
              <button title="Next step (→)" disabled={playing === steps.length - 1} onClick={() => goTo(playing + 1)}><ChevronRight size={16} /></button>
            </div>
          </div>
        </div>
      )}

      <div className="sketch-chrome sketch-hints">
        {asking ? (
          <>
            {ask?.phase === "summary" ? <span><kbd>Space</kbd>Continue</span> : <span><kbd>⌘⏎</kbd>Ask</span>}
            <span><kbd>Esc</kbd>{ask?.phase === "waiting" ? "Cancel" : "Back"}</span>
            <span><kbd>↑</kbd>Canvas</span>
            <span><kbd>↓</kbd>Out</span>
          </>
        ) : ready ? (
          <>
            {!preparing && !standby && <span><kbd>Space</kbd>Start</span>}
            <span><kbd>Esc</kbd>Close</span>
            <span><kbd>↑</kbd>Canvas</span>
            <span><kbd>↓</kbd>Out</span>
            <span>Drag to pan</span>
          </>
        ) : playing === undefined && readOnly ? (
          <>
            <span>View only</span>
            <span>Click to select</span>
            <span><kbd>↑</kbd>Canvas</span>
            <span><kbd>↓</kbd>Out</span>
            <span>Drag to pan</span>
          </>
        ) : playing === undefined ? (
          <>
            <span><kbd>V</kbd>Select</span>
            <span><kbd>R</kbd>Box</span>
            <span><kbd>T</kbd>Note</span>
            <span><kbd>A</kbd>Arrow</span>
            <span><kbd>↑</kbd>Canvas</span>
            <span><kbd>↓</kbd>Out</span>
          </>
        ) : (
          <>
            <span><kbd>Space</kbd>{beat === "playing" ? "Pause" : beat === "paused" ? "Resume" : "Replay"}</span>
            <span><kbd>C</kbd>Ask</span>
            <span><kbd>←</kbd><kbd>→</kbd>Steps</span>
            <span><kbd>↑</kbd>Canvas</span>
            <span><kbd>↓</kbd>Out</span>
            <span><kbd>Esc</kbd>Stop</span>
            <span>Drag to pan</span>
          </>
        )}
      </div>

      <TermTip tip={termTip} />

      <button className="sketch-chrome sketch-zoom" title="Zoom to fit" onClick={() => {
        viewUntouched.current = false;
        zoomToFit();
      }}>
        <Maximize size={13} />{Math.round(camera.z * 100)}%
      </button>

    </div>
  );
}

// What a reference points at (docs/format.md, References): a shape by its
// name, or a group's members with it, lit up; or a numbered arrow ("#2"),
// whose badge is coloured and whose two ends the camera moves to.
function pointedSet(name: string | undefined, shapes: Shape[], groups: SketchGroup[]): { names: Set<string>; focus: Set<string>; arrows: Set<string> } {
  if (!name) return { names: new Set(), focus: new Set(), arrows: new Set() };
  if (!name.startsWith("#")) {
    const names = new Set([name, ...(groups.find((group) => group.name === name)?.members ?? [])]);
    return { names, focus: names, arrows: new Set() };
  }
  const hop = hopEnds(shapes).get(name);
  return { names: new Set(), focus: new Set(hop?.names ?? []), arrows: new Set(hop?.arrows ?? []) };
}

function withAlpha(color: string, alpha: number) {
  const parts = color.match(/[\d.]+/g);
  if (!parts || parts.length < 3) return color;
  return `rgba(${parts[0]}, ${parts[1]}, ${parts[2]}, ${alpha})`;
}

// cubic-bezier(0.4, 0, 0.2, 1), the same curve as the zoom in.
function portalEase(t: number) {
  const x1 = 0.4;
  const x2 = 0.2;
  const at = (s: number, p1: number, p2: number) => 3 * p1 * s * (1 - s) * (1 - s) + 3 * p2 * s * s * (1 - s) + s * s * s;
  let s = t;
  for (let i = 0; i < 6; i++) {
    const dx = 3 * (1 - s) * (1 - s) * x1 + 6 * (1 - s) * s * (x2 - x1) + 3 * s * s * (1 - x2);
    if (Math.abs(dx) < 1e-4) break;
    s = Math.min(1, Math.max(0, s - (at(s, x1, x2) - t) / dx));
  }
  return at(s, 0, 1);
}

// The name a canvas badge shows, once the linked sketch has resolved.
// Loading is left out: the box stays at its label until the name is known,
// and the layout runs again then.
function canvasTitlesOf(portals: Readonly<Record<string, PortalRecord>> | undefined): Record<string, string> {
  const titles: Record<string, string> = {};
  if (!portals) return titles;
  for (const [id, card] of Object.entries(portals)) {
    if (card.status === "locked") titles[id] = "Private";
    else if (card.status === "missing") titles[id] = "Not found";
    else if (card.status === "open" && card.title?.trim()) titles[id] = card.title.trim();
  }
  return titles;
}

function canvasTitlesKey(portals: Readonly<Record<string, PortalRecord>> | undefined) {
  return Object.entries(canvasTitlesOf(portals)).sort(([a], [b]) => a.localeCompare(b)).map(([id, title]) => `${id}=${title}`).join("\n");
}

function boundsKeyOf(bounds: Readonly<Record<string, ContentBounds>> | undefined) {
  if (!bounds) return "";
  return Object.entries(bounds).sort(([a], [b]) => a.localeCompare(b)).map(([id, box]) => `${id}:${Math.round(box.w)}x${Math.round(box.h)}`).join(",");
}

function portalLayoutKey(shapes: Shape[], titlesKey: string, boundsKey = "") {
  return `${titlesKey}\n${boundsKey}\n${shapes.map((shape) => shape.kind === "arrow"
    ? `a${shape.id}:${Math.round(shape.from.x)}:${Math.round(shape.from.y)}:${Math.round(shape.to.x)}:${Math.round(shape.to.y)}`
    : `b${shape.id}:${Math.round(shape.x)}:${Math.round(shape.y)}:${Math.round(shape.w)}:${Math.round(shape.h)}:${shape.kind === "rect" ? `${shape.link ?? ""}:${shape.label}` : ""}`).join("|")}`;
}

function withFittedPortals(portals: Readonly<Record<string, PortalRecord>> | undefined, fitted: Map<string, { key: string; titlesKey: string; shapes: Shape[] }>) {
  if (!portals) return portals;
  let changed = false;
  const next: Record<string, PortalRecord> = {};
  for (const [id, card] of Object.entries(portals)) {
    const hit = fitted.get(id);
    if (card.status === "open" && hit && hit.shapes !== card.shapes) {
      next[id] = { ...card, shapes: hit.shapes };
      changed = true;
    } else if (card.status === "open" && !hit) {
      // Not measured yet. The text-only layout pops in, then grows once the
      // linked name is known. Show nothing until the one real layout exists.
      next[id] = { ...card, shapes: [] };
      changed = true;
    } else next[id] = card;
  }
  return changed ? next : portals;
}

// How long a preview waits for a linked canvas's name before it fades in
// on the box label. The name is fetched with the parent, so this is a cap,
// not the usual path.
const NAME_WAIT = 200;
const FONT_WAIT = 150;

// A direct linked sketch that has not answered yet, or whose text is
// still on its way. Deeper sketches are not asked about: the preview
// does not chain a level.
function drawingLate(shapes: Shape[] | undefined, portals: Readonly<Record<string, PortalRecord>> | undefined, host?: string) {
  for (const shape of shapes ?? []) {
    if (shape.kind !== "rect") continue;
    const id = portalSketchId(shape.link, host) ?? portalLabelId(shape.label, host);
    if (!id) continue;
    const card = portals?.[id];
    if (!card || card.status === "loading") return true;
    if (card.status === "open" && card.pendingDrawing && !(card.bounds && card.bounds.w > 0)) return true;
  }
  return false;
}

function linkNames(shapes: Shape[], portals: Readonly<Record<string, PortalRecord>> | undefined) {
  const pending: string[] = [];
  for (const shape of shapes) {
    if (shape.kind !== "rect") continue;
    const id = portalTarget(shape);
    if (!id) continue;
    const card = portals?.[id];
    if (!card || card.status === "loading") pending.push(id);
    else if (card.status === "open" && !card.title?.trim()) pending.push(id);
  }
  return { ready: pending.length === 0, pending };
}

function portalMark(kind: string, id: string, detail?: string) {
  if (typeof window === "undefined") return;
  const holder = window as unknown as { __ttmiPortal?: { t: number; kind: string; id: string; detail?: string }[] };
  const list = (holder.__ttmiPortal ??= []);
  list.push({ t: Math.round(performance.now()), kind, id, ...(detail ? { detail } : {}) });
}

function namedRects(scope: ParentNode, selector: string) {
  const out: Record<string, { x: number; y: number; w: number; h: number }> = {};
  scope.querySelectorAll<HTMLElement>(selector).forEach((el) => {
    if (!el.dataset.name || out[el.dataset.name]) return;
    const r = el.getBoundingClientRect();
    out[el.dataset.name] = { x: r.x, y: r.y, w: r.width, h: r.height };
  });
  return out;
}

function portalBoxOf(shapes: Shape[], id: string) {
  for (const shape of shapes) {
    if (shape.kind !== "rect" || portalTarget(shape) !== id) continue;
    return { x: shape.x, y: shape.y, w: shape.w, h: shape.h };
  }
  return undefined;
}

function portalTarget(shape: RectShape) {
  const host = typeof location === "undefined" ? undefined : location.hostname;
  return portalSketchId(shape.link, host) ?? portalLabelId(shape.label, host);
}

// The badge is the target's name. A refusal says Private or Not found and
// never the title. A label that is itself the URL is not shown.
function portalBadge(label: string, card: { status: string; title?: string } | undefined) {
  const host = typeof location === "undefined" ? undefined : location.hostname;
  const labelIsUrl = Boolean(portalLabelId(label, host));
  if (!card || card.status === "loading") return labelIsUrl ? "" : label;
  if (card.status === "locked") return "Private";
  if (card.status === "missing") return "Not found";
  return card.title || (labelIsUrl ? "" : label);
}

// The names a step's narration points at (docs/format.md, References).
// The first note among these names, in the order they are said.
function firstNote(names: Set<string>, shapes: Shape[]): NoteShape | undefined {
  for (const name of names) {
    const note = shapes.find((shape): shape is NoteShape => shape.kind === "note" && shape.name === name);
    if (note) return note;
  }
  return undefined;
}

function namedIn(step: SketchStep | undefined, shapes: Shape[], groups: SketchGroup[]): Set<string> {
  if (!step?.narration) return new Set();
  return new Set(narrationParts(step.narration, referableNames(shapes, groups)).flatMap((part) => (part.name ? [part.name] : [])));
}
