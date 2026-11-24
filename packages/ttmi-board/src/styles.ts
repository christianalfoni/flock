// The board's colours, shared with the web app's tokens (apps/web/src/
// index.css): the same ground, the same grape accent for the person's own
// marks, round corners on everything that floats. Each is a CSS variable,
// light on :root and dark under .dark (the page's theme, docs/board.md,
// Theme), so one stylesheet draws both; an export has no .dark above it and
// is always light.
import { TAG_LEFT } from "@ttmi/format";
import { MONO, SANS } from "./fonts";
import { COLORS } from "./shapes";

const LIGHT = {
  "board": "#fbfaff",
  "board-foreground": "#2a2745",
  "board-accent": "#7c5cff",
  "board-on-accent": "#ffffff",
  "board-border": "#e6e2f5",
  "board-panel": "#ffffff",
  "board-muted": "#7a7699",
  "board-hover": "#f1eefc",
  "board-active": "#ebe7fb",
  "board-code": "#f4f2fc",
  // An arrow's lit ends: a step brighter than the ground.
  "board-lit": "#ffffff",
  "board-shadow": "76 56 180",
  "shape-white": "#3d3a5c",
  "shape-red": "#ef4565",
  "shape-orange": "#f5762a",
  "shape-yellow": "#e0a400",
  "shape-green": "#1fae6b",
  "shape-blue": "#2f8cf0",
  "shape-violet": "#8b5cf6",
  "shape-on-white": "#ffffff",
  "shape-on-red": "#ffffff",
  "shape-on-orange": "#ffffff",
  "shape-on-yellow": "#2a2745",
  "shape-on-green": "#ffffff",
  "shape-on-blue": "#ffffff",
  "shape-on-violet": "#ffffff",
  "code-keyword": "#d6336c",
  "code-string": "#0f8a5f",
  "code-number": "#1c6fd1",
  "code-comment": "#9893b8",
  "code-title": "#7048e8",
  "code-type": "#d9590b",
};

// The same at night: a deep grape ground, the colours lifted to read on it,
// and ink on every solid fill.
const DARK: typeof LIGHT = {
  "board": "#1b1932",
  "board-foreground": "#ebe8ff",
  "board-accent": "#9d87ff",
  "board-on-accent": "#160f3a",
  "board-border": "#342f5a",
  "board-panel": "#24203f",
  "board-muted": "#a29dc8",
  "board-hover": "#2d2952",
  "board-active": "#332e5e",
  "board-code": "#221f3c",
  "board-lit": "#2e2a55",
  "board-shadow": "0 0 0",
  "shape-white": "#cfcae8",
  "shape-red": "#ff6b85",
  "shape-orange": "#ff8f4d",
  "shape-yellow": "#f5c330",
  "shape-green": "#3fd38f",
  "shape-blue": "#5aa8ff",
  "shape-violet": "#a78bfa",
  "shape-on-white": "#1b1932",
  "shape-on-red": "#1b1932",
  "shape-on-orange": "#1b1932",
  "shape-on-yellow": "#1b1932",
  "shape-on-green": "#1b1932",
  "shape-on-blue": "#1b1932",
  "shape-on-violet": "#1b1932",
  "code-keyword": "#ff7aa8",
  "code-string": "#4fd6a0",
  "code-number": "#6cb6ff",
  "code-comment": "#8a85b0",
  "code-title": "#b39dff",
  "code-type": "#ffa45c",
};

const declarations = (palette: typeof LIGHT) => Object.entries(palette).map(([name, value]) => `--${name}: ${value};`).join(" ");
// The palette alone, for pages that draw sketch previews without a board.
export const BOARD_PALETTE_CSS = `:root { ${declarations(LIGHT)} }\n.dark { ${declarations(DARK)} }\n`;

export const BACKGROUND = "var(--board)";
export const FOREGROUND = "var(--board-foreground)";
export const ACCENT = "var(--board-accent)";
const ON_ACCENT = "var(--board-on-accent)";
const BORDER = "var(--board-border)";
const PANEL = "var(--board-panel)";
const MUTED = "var(--board-muted)";
const HOVER = "var(--board-hover)";
const ACTIVE = "var(--board-active)";
const CODE = "var(--board-code)";
export const LIT = "var(--board-lit)";
const SHADOW = "0 1px 2px rgb(var(--board-shadow) / 0.06), 0 10px 30px rgb(var(--board-shadow) / 0.12)";

// Kept in one string so the PNG export can embed exactly what the page
// shows. No "<" or "&" in here: it is inlined into XML.
// The toolbar sits in the middle of the free part of the top edge: the
// board sets --sketch-chrome-left and --sketch-chrome-right to the widths
// of its corner slots, and the toolbar wraps its rows when that is tight.
export const SKETCH_CSS = `${BOARD_PALETTE_CSS}
.sketch { position: absolute; inset: 0; overflow: hidden; outline: none; touch-action: none; user-select: none; background-color: ${BACKGROUND}; }
.sketch-tool-rect, .sketch-tool-arrow { cursor: crosshair; }
.sketch-tool-note { cursor: text; }
.sketch-panning { cursor: grabbing; }
.sketch-stage { position: absolute; inset: 0; transform-origin: center; pointer-events: none; }
.sketch-world { position: absolute; left: 0; top: 0; width: 0; height: 0; transform-origin: 0 0; pointer-events: auto; font-family: ${SANS}, -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", system-ui, sans-serif; font-size: 14px; line-height: 1.5; color: ${FOREGROUND}; -webkit-font-smoothing: antialiased; }
.sketch-group { position: absolute; box-sizing: border-box; border: 1.5px dashed color-mix(in srgb, ${COLORS.white} 50%, transparent); border-radius: 6px; background: color-mix(in srgb, ${FOREGROUND} 1.5%, transparent); pointer-events: none; }
.sketch-group-head { position: absolute; top: 5px; left: 14px; display: flex; align-items: center; gap: 8px; font-size: 12px; font-weight: 700; letter-spacing: 0.02em; line-height: 1.2; white-space: nowrap; }
.sketch-group-tag { font-family: ${MONO}, ui-monospace, "SF Mono", Menlo, monospace; padding: 1px 6px; border: 1px solid; border-radius: 999px; font-size: 10px; font-weight: 650; letter-spacing: 0.05em; text-transform: uppercase; }
.sketch-rect { position: absolute; box-sizing: border-box; display: flex; align-items: center; justify-content: center; border: 2px solid; border-radius: 12px; padding: 8px 12px; }
.sketch-tag { font-family: ${MONO}, ui-monospace, "SF Mono", Menlo, monospace; position: absolute; top: -11px; left: ${TAG_LEFT}px; z-index: 1; display: inline-flex; align-items: center; gap: 4px; padding: 1px 7px; border: 1.5px solid; border-radius: 999px; background: ${BACKGROUND}; font-size: 10.5px; font-weight: 650; letter-spacing: 0.05em; line-height: 1.35; text-transform: uppercase; white-space: nowrap; }
.sketch-canvas-mark { flex: none; display: block; }
.sketch-link { position: absolute; top: -11px; right: 10px; z-index: 1; display: inline-flex; align-items: center; justify-content: center; width: 20px; height: 20px; box-sizing: border-box; padding: 0; border: 1.5px solid; border-radius: 999px; background: ${BACKGROUND}; color: inherit; cursor: pointer; pointer-events: auto; text-decoration: none; }
.sketch-link:hover:not(:disabled) { background: ${HOVER}; }
.sketch-link:disabled { cursor: default; opacity: 0.7; }
/* A portal is the same box. The hit target fills the content, and the
   miniature sits where the label would (docs/plan-portals.md). The name
   is a .sketch-tag on the border. */
.sketch-rect.sketch-portal > .sketch-link { position: absolute; inset: 0; top: 0; right: 0; z-index: 0; width: auto; height: auto; display: block; margin: 0; padding: 0; border: 0; border-radius: 0; background: transparent; box-shadow: none; cursor: pointer; opacity: 1; }
.sketch-rect.sketch-portal > .sketch-link:hover { background: transparent; }
.sketch-rect.sketch-portal > .sketch-link:disabled { opacity: 1; cursor: default; }
.sketch-portal-fit { position: absolute; inset: 0; }
.sketch-portal-inset { pointer-events: none; }
@keyframes sketch-inset-in { from { opacity: 0; } to { opacity: 1; } }
.sketch-portal-reveal { animation: sketch-inset-in 0.32s ease; }
@media (prefers-reduced-motion: reduce) { .sketch-portal-reveal { animation: none; } }
.sketch-portal-inset .sketch-portal { pointer-events: auto; }
.sketch-portal-shape { position: absolute; box-sizing: border-box; border: 1.5px solid ${COLORS.white}; border-radius: 4px; background: color-mix(in srgb, ${COLORS.white} 12%, transparent); }
.sketch-chrome { z-index: 3; }
/* While the camera is inside a portal, the parent's other shapes do not
   take clicks. They fade out on the way in and fade back on the way out,
   so the swap never cuts them in or out. */
.sketch-entered .sketch-world > .sketch-rect:not([data-portal-path]),
.sketch-entered .sketch-world > .sketch-note,
.sketch-entered .sketch-world > .sketch-group,
.sketch-entered .sketch-world > .sketch-arrows,
.sketch-entered .sketch-world > .sketch-arrow-label,
.sketch-entered .sketch-portal[data-portal-path]:not([data-portal-open]) > .sketch-portal-inset > div > .sketch-rect:not([data-portal-path]),
.sketch-entered .sketch-portal[data-portal-path]:not([data-portal-open]) > .sketch-portal-inset > div > .sketch-note:not([data-portal-path]),
.sketch-entered .sketch-portal[data-portal-path]:not([data-portal-open]) > .sketch-portal-inset > div > .sketch-arrows,
.sketch-entered .sketch-portal[data-portal-path]:not([data-portal-open]) > .sketch-portal-inset > div > .sketch-arrow-label { pointer-events: none; }
/* The open frame's picture can sit off the resting inset while the border
   grows past the screen. Clipping it would cut the picture mid-zoom. */
.sketch-portal-in .sketch-portal[data-portal-open] > .sketch-portal-inset,
.sketch-portal-out .sketch-portal[data-portal-open] > .sketch-portal-inset { overflow: visible; }
.sketch-portal-in .sketch-host > .sketch-rect:not([data-portal-path]),
.sketch-portal-in .sketch-host > .sketch-note,
.sketch-portal-in .sketch-host > .sketch-group,
.sketch-portal-in .sketch-host > .sketch-arrows,
.sketch-portal-in .sketch-host > .sketch-arrow-label { opacity: 0; transition: opacity 640ms cubic-bezier(0.4, 0, 0.2, 1); }
.sketch-portal-out .sketch-host > .sketch-rect:not([data-portal-path]),
.sketch-portal-out .sketch-host > .sketch-note,
.sketch-portal-out .sketch-host > .sketch-group,
.sketch-portal-out .sketch-host > .sketch-arrows,
.sketch-portal-out .sketch-host > .sketch-arrow-label { opacity: 0; }
.sketch-portal-out.sketch-portal-fade .sketch-host > .sketch-rect:not([data-portal-path]),
.sketch-portal-out.sketch-portal-fade .sketch-host > .sketch-note,
.sketch-portal-out.sketch-portal-fade .sketch-host > .sketch-group,
.sketch-portal-out.sketch-portal-fade .sketch-host > .sketch-arrows,
.sketch-portal-out.sketch-portal-fade .sketch-host > .sketch-arrow-label { opacity: 1; transition: opacity 420ms cubic-bezier(0.4, 0, 0.2, 1); }
.sketch-entered:not(.sketch-portal-in):not(.sketch-portal-out):not(.sketch-portal-pan) .sketch-host > .sketch-rect:not([data-portal-path]),
.sketch-entered:not(.sketch-portal-in):not(.sketch-portal-out):not(.sketch-portal-pan) .sketch-host > .sketch-note,
.sketch-entered:not(.sketch-portal-in):not(.sketch-portal-out):not(.sketch-portal-pan) .sketch-host > .sketch-group,
.sketch-entered:not(.sketch-portal-in):not(.sketch-portal-out):not(.sketch-portal-pan) .sketch-host > .sketch-arrows,
.sketch-entered:not(.sketch-portal-in):not(.sketch-portal-out):not(.sketch-portal-pan) .sketch-host > .sketch-arrow-label,
.sketch-entered:not(.sketch-portal-in):not(.sketch-portal-out):not(.sketch-portal-pan) .sketch-portal[data-portal-path]:not([data-portal-open]) > .sketch-portal-inset > div > .sketch-rect:not([data-portal-path]),
.sketch-entered:not(.sketch-portal-in):not(.sketch-portal-out):not(.sketch-portal-pan) .sketch-portal[data-portal-path]:not([data-portal-open]) > .sketch-portal-inset > div > .sketch-arrows { opacity: 0; }
.sketch-entered .sketch-portal[data-portal-open] > .sketch-portal-inset,
.sketch-entered .sketch-portal[data-portal-open] > .sketch-portal-inset .sketch-rect,
.sketch-entered .sketch-portal[data-portal-open] > .sketch-portal-inset .sketch-arrows { pointer-events: auto; }
.sketch-portal-glide .sketch-world { transition: transform 640ms cubic-bezier(0.4, 0, 0.2, 1); will-change: transform; }
.sketch-tag-editing { min-width: 3em; outline: none; cursor: text; user-select: text; }
.sketch-tag-add { font-family: ${MONO}, ui-monospace, "SF Mono", Menlo, monospace; position: absolute; padding: 1px 7px; border: 1.5px dashed ${ACCENT}; border-radius: 999px; background: ${BACKGROUND}; color: ${ACCENT}; font-size: 10.5px; font-weight: 600; line-height: 1.35; white-space: nowrap; cursor: pointer; pointer-events: auto; }
.sketch-tag-add:hover { background: ${HOVER}; }
.sketch-label { max-width: 100%; text-align: center; white-space: pre-wrap; overflow-wrap: anywhere; font-weight: 500; outline: none; }
.sketch-label-editing { min-width: 2px; cursor: text; user-select: text; }
.sketch-arrow-label { position: absolute; transform: translate(-50%, -50%); border-radius: 999px; background: ${BACKGROUND}; padding: 1px 6px; font-size: 13px; white-space: nowrap; }
.sketch-arrow-label .sketch-label { white-space: pre; }
.sketch-arrow-label-seq { display: flex; align-items: center; gap: 5px; }
.sketch-seq { box-sizing: border-box; flex: none; min-width: 18px; height: 18px; padding: 0 4px; border-radius: 9px; display: inline-flex; align-items: center; justify-content: center; color: ${BACKGROUND}; font-size: 11px; font-weight: 700; line-height: 1; font-variant-numeric: tabular-nums; }
.sketch-seq-editing { min-width: 24px; outline: none; cursor: text; user-select: text; }
.sketch-arrows path { transition: stroke 0.15s; }
.sketch-rect { transition: background-color 0.15s; }
.sketch-note { position: absolute; box-sizing: border-box; padding: 4px 6px; border-radius: 6px; background: ${BACKGROUND}; }
.sketch-note-folded { background: transparent; }
.sketch-note .sketch-tag { top: -9px; }
.sketch-note-tagged { padding-top: 15px; }
.sketch-note-editing { cursor: text; user-select: text; }
.sketch-note-open { z-index: 2; border: 1.5px solid; border-radius: 12px; background: ${PANEL}; box-shadow: ${SHADOW}; }
.sketch-note-head { display: inline-flex; align-items: center; gap: 10px; max-width: 100%; box-sizing: border-box; padding: 2px 3px 2px 10px; border-radius: 999px; font-size: 13px; font-weight: 650; line-height: 1.35; white-space: nowrap; }
.sketch-note-title { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.sketch-note-chevron { flex: none; display: flex; align-items: center; justify-content: center; width: 20px; height: 20px; margin: 0 0 0 -4px; padding: 0; border: 0; border-radius: 999px; background: transparent; color: inherit; cursor: pointer; pointer-events: auto; }
.sketch-note-chevron:hover { background: rgb(255 255 255 / 0.22); }
.sketch-note-foldable { padding: 0; }
.sketch-note-folded { border-radius: 999px; }
.sketch-note-folded .ProseMirror { display: none; }
.sketch-note-open { padding: 22px 12px 10px; }
.sketch-note-open .sketch-note-head { position: absolute; top: -11px; left: 10px; max-width: calc(100% - 20px); }
.sketch-note-open:not(.sketch-note-editing) .ProseMirror > :first-child { display: none; }
.sketch-note-open:not(.sketch-note-editing) .ProseMirror > :nth-child(2) { margin-top: 0; }
.sketch-note .ProseMirror { outline: none; white-space: pre-wrap; overflow-wrap: anywhere; }
.sketch-note .ProseMirror > * + * { margin-top: 0.5em; }
.sketch-note p, .sketch-note h1, .sketch-note h2, .sketch-note h3, .sketch-note ul, .sketch-note ol, .sketch-note pre, .sketch-note blockquote { margin: 0; }
.sketch-note h1 { font-size: 1.5em; font-weight: 650; line-height: 1.25; }
.sketch-note h2 { font-size: 1.25em; font-weight: 650; line-height: 1.3; }
.sketch-note h3 { font-size: 1.1em; font-weight: 650; }
.sketch-note strong { font-weight: 700; }
.sketch-note em { font-style: italic; }
.sketch-note s { text-decoration: line-through; }
.sketch-note u { text-decoration: underline; }
.sketch-note ul { list-style: disc; padding-left: 1.4em; }
.sketch-note ol { list-style: decimal; padding-left: 1.4em; }
.sketch-note li p { margin: 0; }
.sketch-note blockquote { border-left: 3px solid ${BORDER}; padding-left: 0.8em; color: ${MUTED}; }
.sketch-note a { color: ${ACCENT}; text-decoration: underline; }
.sketch-note hr { border: 0; border-top: 1px solid ${BORDER}; }
.sketch-note code { font-family: ${MONO}, ui-monospace, "SF Mono", Menlo, monospace; font-size: 0.86em; background: ${ACTIVE}; color: ${FOREGROUND}; border-radius: 4px; padding: 0.1em 0.3em; }
.sketch-note pre { background: ${CODE}; border: 1px solid ${BORDER}; border-radius: 10px; padding: 10px 12px; color: ${FOREGROUND}; white-space: pre-wrap; }
.sketch-note pre code { background: none; padding: 0; font-size: 0.9em; color: inherit; }
.sketch-code { position: relative; }
.sketch-code pre { padding-right: 36px; }
.sketch-code-actions { position: absolute; top: 6px; right: 6px; display: flex; gap: 4px; }
.sketch-code-button { display: flex; align-items: center; justify-content: center; width: 22px; height: 22px; border: 1px solid ${BORDER}; border-radius: 5px; background: ${PANEL}; color: ${MUTED}; padding: 0; opacity: 0; cursor: pointer; transition: opacity 0.12s; }
.sketch-code:hover .sketch-code-button, .sketch-code-copied { opacity: 1; }
.sketch-code-button:hover { color: ${FOREGROUND}; }
.sketch-code-copied, .sketch-code-copied:hover { color: ${ACCENT}; }
.hljs-keyword, .hljs-selector-tag, .hljs-literal, .hljs-doctag { color: var(--code-keyword); }
.hljs-string, .hljs-regexp, .hljs-template-variable { color: var(--code-string); }
.hljs-number, .hljs-symbol { color: var(--code-number); }
.hljs-comment, .hljs-quote { color: var(--code-comment); font-style: italic; }
.hljs-title, .hljs-section { color: var(--code-title); }
.hljs-type, .hljs-built_in, .hljs-class { color: var(--code-type); }
.hljs-attr, .hljs-attribute, .hljs-property, .hljs-meta { color: var(--code-number); }
.hljs-tag, .hljs-name, .hljs-selector-id, .hljs-selector-class { color: var(--code-string); }
.hljs-variable, .hljs-params { color: ${FOREGROUND}; }
.hljs-addition { color: var(--code-string); }
.hljs-deletion { color: var(--code-keyword); }
.sketch-arrows { position: absolute; left: 0; top: 0; width: 1px; height: 1px; overflow: visible; pointer-events: none; }
.sketch-arrow-hit { pointer-events: stroke; cursor: move; }
.sketch-arrow, .sketch-arrow-head { stroke-width: 2px; }
.sketch-line { stroke-width: 1.5px; }
.sketch-outline { position: absolute; box-sizing: border-box; border: solid ${ACCENT}; border-radius: 10px; pointer-events: none; }
.sketch-handle { position: absolute; box-sizing: border-box; background: ${BACKGROUND}; border: solid ${ACCENT}; border-radius: 2px; pointer-events: auto; }
.sketch-handle-round { border-radius: 999px; cursor: grab; }
.sketch-handle-bend { background: ${ACCENT}; }
.sketch-handle-nw, .sketch-handle-se { cursor: nwse-resize; }
.sketch-handle-ne, .sketch-handle-sw { cursor: nesw-resize; }
.sketch-handle-e { cursor: ew-resize; }
.sketch-marquee { position: absolute; box-sizing: border-box; border: solid ${ACCENT}; background: color-mix(in srgb, ${ACCENT} 8%, transparent); }
.sketch-steps-ask { width: min(420px, calc(100% - 20px)); }
.sketch-ask { gap: 8px; }
.sketch-ask .sketch-step-top { min-height: 0; }
.sketch-ask-composer { display: flex; flex-direction: column; gap: 6px; box-sizing: border-box; border: 1px solid ${BORDER}; border-radius: 16px; background: ${BACKGROUND}; padding: 8px 8px 8px 12px; }
.sketch-ask-composer textarea { box-sizing: border-box; width: 100%; min-height: 24px; max-height: 140px; resize: none; overflow: auto; border: 0; background: transparent; color: ${FOREGROUND}; padding: 2px 0; font-family: inherit; font-size: 15px; font-weight: 400; line-height: 1.45; outline: none; }
.sketch-ask-composer textarea::placeholder { color: ${MUTED}; }
.sketch-ask-composer-bar { display: flex; align-items: center; justify-content: flex-end; gap: 8px; }
.sketch-ask-hint { display: inline-flex; align-items: center; gap: 3px; margin-right: auto; color: ${MUTED}; }
.sketch-ask-hint kbd { display: inline-flex; align-items: center; height: 16px; padding: 0 4px; border: 1px solid ${BORDER}; border-bottom-width: 2px; border-radius: 4px; background: ${HOVER}; color: ${MUTED}; font-family: inherit; font-size: 10px; line-height: 1; }
.sketch-ask-continue { display: flex; align-items: center; align-self: stretch; min-height: 28px; }
.sketch-ask-continue .sketch-ask-hint { gap: 6px; }
.sketch-ask-send { height: 28px; border: 0; border-radius: 999px; background: ${ACCENT}; color: ${ON_ACCENT}; padding: 0 12px; font-family: inherit; font-size: 13px; font-weight: 600; cursor: pointer; }
.sketch-ask-send:disabled { opacity: 0.35; cursor: default; }
.sketch-ask-send[data-copied="true"] { background: transparent; color: ${ACCENT}; }
.sketch-ask-wait { display: flex; flex-direction: column; align-items: flex-start; gap: 10px; padding: 0 2px 2px; }
.sketch-ask-bubble { align-self: flex-end; max-width: 92%; margin: 0; padding: 8px 12px; border-radius: 16px 16px 4px 16px; background: color-mix(in srgb, ${ACCENT} 16%, ${BACKGROUND}); color: ${FOREGROUND}; font-size: 15px; line-height: 1.45; }
.sketch-ask-waiting { display: flex; align-items: center; gap: 8px; margin: 0; color: ${MUTED}; font-size: 13px; line-height: 1.4; }
.sketch-ask-dots { display: inline-flex; align-items: center; gap: 3px; }
.sketch-ask-dots span { width: 5px; height: 5px; border-radius: 999px; background: ${ACCENT}; animation: sketch-ask-dot 1.1s infinite; }
.sketch-ask-dots span:nth-child(2) { animation-delay: 0.15s; }
.sketch-ask-dots span:nth-child(3) { animation-delay: 0.3s; }
@keyframes sketch-ask-dot { 0%, 80%, 100% { opacity: 0.25; } 40% { opacity: 1; } }
.sketch-ask-actions { display: flex; align-items: center; gap: 12px; }
.sketch-ask-quiet { border: 0; background: transparent; color: ${MUTED}; padding: 0; font-family: inherit; font-size: 13px; font-weight: 500; cursor: pointer; }
.sketch-ask-quiet:hover { color: ${FOREGROUND}; }
.sketch-ask-quiet[data-copied="true"] { color: ${ACCENT}; }
.sketch-step-end { display: flex; flex: none; align-self: flex-start; align-items: center; gap: 4px; margin-left: auto; }
.sketch-chrome { font-size: 12px; }
.sketch-toolbar { position: absolute; top: 10px; left: calc(var(--sketch-chrome-left, 0px) + (100% - var(--sketch-chrome-left, 0px) - var(--sketch-chrome-right, 0px)) / 2); transform: translateX(-50%); display: flex; flex-wrap: wrap; justify-content: center; align-items: center; gap: 2px; width: max-content; max-width: calc(100% - var(--sketch-chrome-left, 0px) - var(--sketch-chrome-right, 0px) - 20px); box-sizing: border-box; border: 1px solid ${BORDER}; border-radius: 16px; background: ${PANEL}; padding: 5px; box-shadow: ${SHADOW}; }
.sketch-row { display: flex; align-items: center; gap: 2px; }
.sketch-row + .sketch-row { margin-left: 4px; padding-left: 6px; border-left: 1px solid ${BORDER}; }
.sketch-toolbar-stacked { flex-direction: column; align-items: stretch; gap: 4px; }
.sketch-toolbar-stacked .sketch-row { justify-content: center; }
.sketch-toolbar-stacked .sketch-row + .sketch-row { margin-left: 0; padding-left: 0; padding-top: 4px; border-left: 0; border-top: 1px solid ${BORDER}; }
.sketch-toolbar button, .sketch-zoom { display: inline-flex; align-items: center; justify-content: center; gap: 4px; height: 30px; min-width: 30px; border: 1px solid transparent; border-radius: 10px; background: transparent; color: ${MUTED}; padding: 0 6px; font-size: 12px; cursor: pointer; }
.sketch-toolbar button:hover { background: ${HOVER}; color: ${FOREGROUND}; }
.sketch-toolbar button:disabled { opacity: 0.35; cursor: default; }
.sketch-toolbar .sketch-active { border-color: transparent; background: ${ACTIVE}; color: ${ACCENT}; }
.sketch-swatch span { display: block; width: 15px; height: 15px; border-radius: 999px; box-shadow: inset 0 -2px 0 rgb(0 0 0 / 0.12); }
.sketch-divider { width: 1px; height: 18px; margin: 0 3px; background: ${BORDER}; }
.sketch-zoom { position: absolute; right: 10px; bottom: 10px; height: 32px; padding: 0 12px; border-color: ${BORDER}; border-radius: 999px; background: ${PANEL}; box-shadow: ${SHADOW}; font-variant-numeric: tabular-nums; }
.sketch-zoom:hover { color: ${FOREGROUND}; }
.sketch-hints { position: absolute; left: 10px; bottom: 10px; display: flex; align-items: center; gap: 10px; height: 32px; box-sizing: border-box; padding: 0 12px; border: 1px solid ${BORDER}; border-radius: 999px; background: ${PANEL}; color: ${MUTED}; font-size: 12px; box-shadow: ${SHADOW}; pointer-events: none; }
.sketch-hints span { display: inline-flex; align-items: center; gap: 5px; }
.sketch-hints kbd { display: inline-flex; align-items: center; height: 18px; padding: 0 5px; border: 1px solid ${BORDER}; border-bottom-width: 2px; border-radius: 5px; background: ${HOVER}; color: ${MUTED}; font-family: ${MONO}, ui-monospace, "SF Mono", Menlo, monospace; font-size: 10.5px; line-height: 1; }
.sketch-gliding, .sketch-gliding .sketch-world { transition: transform 0.4s ease; }
.sketch-placing .sketch-world { visibility: hidden; }
.sketch-step-new { animation: sketch-step-in 0.2s ease-out backwards; }
@keyframes sketch-step-in { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }
.sketch-topleft { position: absolute; top: 10px; left: 10px; z-index: 3; display: flex; align-items: center; gap: 8px; }
.sketch-topright { position: absolute; top: 10px; right: 10px; z-index: 3; display: flex; align-items: center; gap: 8px; }
.sketch-play { display: inline-flex; align-items: center; gap: 6px; height: 32px; border: 1px solid ${BORDER}; border-radius: 999px; background: ${PANEL}; color: ${FOREGROUND}; padding: 0 14px; font-size: 13px; font-weight: 600; cursor: pointer; box-shadow: ${SHADOW}; }
.sketch-play:hover { background: ${HOVER}; }
.sketch-play-count { color: ${MUTED}; font-weight: 400; }
.sketch-steps { position: absolute; bottom: 52px; left: 50%; transform: translateX(-50%); display: flex; width: min(600px, calc(100% - 20px)); box-sizing: border-box; flex-direction: column; gap: 8px; border: 1px solid ${BORDER}; border-radius: 20px; background: ${PANEL}; padding: 10px 10px 10px 14px; box-shadow: ${SHADOW}; }
/* Three rows: the tools and close, the words, then where we are, the
   bar and the step buttons. */
.sketch-caption { display: flex; flex-direction: column; gap: 6px; }
.sketch-step-top { display: flex; align-items: center; gap: 10px; min-height: 28px; }
.sketch-step-tools { display: flex; flex-wrap: wrap; align-items: center; gap: 2px; margin-left: -6px; }
.sketch-step-tools button, .sketch-step-top .sketch-step-end button { width: 28px; height: 28px; }
.sketch-step-top .sketch-step-end { margin-left: auto; }
.sketch-step-foot { display: flex; align-items: center; gap: 10px; }
.sketch-step-foot .sketch-step-progress { flex: 1; }
.sketch-step-title { flex: none; min-width: 4.4em; padding-left: 2px; color: ${MUTED}; font-size: 12px; font-weight: 600; font-variant-numeric: tabular-nums; white-space: nowrap; }
.sketch-step-title[data-kind="overview"], .sketch-step-title[data-kind="summary"] { color: ${ACCENT}; }
.sketch-step-controls { display: flex; flex: none; align-items: center; gap: 2px; }
.sketch-step-controls button, .sketch-step-end button, .sketch-step-tools button { display: grid; flex: none; width: 30px; height: 30px; place-items: center; border: 0; border-radius: 999px; background: transparent; color: ${FOREGROUND}; cursor: pointer; }
.sketch-speed { display: flex; align-items: center; gap: 1px; margin-right: 4px; }
.sketch-speed button { width: auto; height: 26px; padding: 0 6px; font-size: 11px; font-weight: 600; font-variant-numeric: tabular-nums; letter-spacing: 0; }
.sketch-speed button[aria-pressed="true"] { color: ${ACCENT}; background: ${HOVER}; }
.sketch-hints .sketch-speed { margin-right: 8px; pointer-events: auto; }
.sketch-step-controls button:hover:not(:disabled), .sketch-step-end button:hover:not(:disabled), .sketch-step-tools button:hover:not(:disabled) { background: ${HOVER}; color: ${ACCENT}; }
.sketch-step-controls button:disabled, .sketch-step-end button:disabled { opacity: 0.3; cursor: default; }
/* The caption's tools, each an icon and a word (2026-10-22). */
.sketch-steps .sketch-step-tools button { display: inline-flex; width: auto; height: 28px; align-items: center; gap: 5px; padding: 0 9px 0 7px; color: ${MUTED}; font-family: inherit; font-size: 12px; font-weight: 500; white-space: nowrap; }
.sketch-narration-column { display: flex; min-width: 0; flex-direction: column; gap: 6px; padding: 0 2px; }
.sketch-narration-column:empty { display: none; }
.sketch-narration { margin: 0; padding-top: 1px; color: ${FOREGROUND}; font-size: 17px; line-height: 1.5; text-align: left; }
.sketch-step-progress { display: flex; gap: 4px; }
/* The overview and summary are the bookends of the bar: short, set
   apart from the steps between them. */
.sketch-step-progress span[data-kind="overview"], .sketch-step-progress span[data-kind="summary"] { flex: 0 0 28px; }
.sketch-step-progress span[data-kind="overview"] { margin-right: 6px; }
.sketch-step-progress span[data-kind="summary"] { margin-left: 6px; }
.sketch-step-progress span { position: relative; flex: 1; height: 6px; overflow: hidden; border-radius: 999px; background: ${HOVER}; }
/* The accent fills a step from the left as it is said; the page's voice
   sets it every frame, and without one a step reached is full. */
.sketch-step-progress span::after { content: ""; position: absolute; inset: 0; transform-origin: left; background: ${ACCENT}; transform: scaleX(var(--said, 0)); transition: transform 0.1s linear; }
.sketch-step-progress .sketch-step-done { --said: 1; }
/* The step on screen said to its end: green, with one soft pulse, the
   cue to go on (in place of a sound, 2026-10-22). */
.sketch-step-progress span[data-said]::after { background: ${COLORS.green}; transition: transform 0.1s linear, background 0.3s; }
.sketch-step-progress span[data-said] { animation: sketch-step-said 0.6s ease-out; }
.sketch-step-progress[data-instant] span::after,
.sketch-step-progress[data-instant] span[data-said]::after { transition: none; }
.sketch-step-progress[data-instant] span[data-said] { animation: none; }
@keyframes sketch-step-said { 0% { box-shadow: 0 0 0 0 color-mix(in srgb, ${COLORS.green} 60%, transparent); } 100% { box-shadow: 0 0 0 6px transparent; } }
.sketch-ref { color: ${ACCENT}; border-radius: 4px; cursor: default; transition: background 0.15s; }
.sketch-ref-on { background: color-mix(in srgb, ${ACCENT} 18%, transparent); }
/* The presenter's marker (Marker.tsx, docs/board.md, Marker). */
.sketch-marker-tap { position: absolute; left: -14px; top: -14px; width: 28px; height: 28px; border-radius: 999px; border: 2.5px solid ${ACCENT}; box-sizing: border-box; animation: sketch-marker-tap 0.45s ease-out forwards; }
@keyframes sketch-marker-tap { from { transform: scale(0.3); opacity: 1; } to { transform: scale(1.4); opacity: 0; } }
.sketch-marker-press { animation: sketch-marker-press 0.22s ease-in-out; }
@keyframes sketch-marker-press { 50% { transform: translate(-3px, -3px); } }
.sketch-marker-pen { filter: drop-shadow(0 3px 4px rgb(42 39 69 / 0.25)); }
.sketch-marker-ink-fade { animation: sketch-marker-fade 0.8s ease-out forwards; }
@keyframes sketch-marker-fade { to { opacity: 0; } }
.sketch-steps-waiting { border-color: transparent; }
.sketch-caption-ready { flex-direction: row; align-items: center; }
.sketch-start { display: inline-flex; flex: none; align-items: center; gap: 6px; height: 34px; line-height: 1; border: 0; border-radius: 999px; background: ${ACCENT}; color: ${ON_ACCENT}; padding: 0 16px 0 13px; font-size: 14px; font-weight: 600; cursor: pointer; }
.sketch-start svg { fill: currentColor; }
.sketch-start:hover { filter: brightness(1.08); }
.sketch-ready-balance { flex: none; width: 30px; }
.sketch-ready-body { display: flex; flex: 1; min-width: 0; flex-direction: column; align-items: center; gap: 4px; padding: 12px 0 6px; }
.sketch-ready-teaser { margin: 0 0 6px; color: ${FOREGROUND}; font-size: 18px; font-weight: 600; line-height: 1.45; text-align: center; text-wrap: balance; }
.sketch-ready-start { display: flex; flex: 1; flex-direction: column; align-items: center; justify-content: center; gap: 10px; padding: 14px 0 10px; }
.sketch-ready-play { display: flex; flex-wrap: wrap; align-items: center; justify-content: center; gap: 6px 14px; padding: 4px 0; }
.sketch-start kbd { display: inline-flex; align-items: center; height: 18px; margin-left: 4px; border: 1px solid color-mix(in srgb, ${ON_ACCENT} 45%, transparent); border-radius: 5px; padding: 0 5px; font: inherit; font-size: 11px; font-weight: 600; line-height: 1; }
.sketch-ready-meta { color: ${MUTED}; font-size: 13px; line-height: 1; }
.sketch-ready-meta:empty { display: none; }
.sketch-preparing { min-width: 0; padding: 10px 0 6px; }
/* The border's wave is a square of gradient turning behind a fixed ring
   mask: a transform, which the compositor runs without repainting. It
   animated the gradient's angle, repainted on the main thread every frame
   while the voice was made (2026-10-22). */
.sketch-wave { position: absolute; inset: -1px; overflow: hidden; border-radius: inherit; padding: 2px; pointer-events: none; filter: drop-shadow(0 0 6px color-mix(in srgb, ${ACCENT} 50%, transparent)); -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0); -webkit-mask-composite: xor; mask: linear-gradient(#000 0 0) content-box exclude, linear-gradient(#000 0 0); }
.sketch-wave::before { content: ""; position: absolute; left: 50%; top: 50%; width: max(120%, 160px); aspect-ratio: 1; background: conic-gradient(${BORDER} 0deg, ${ACCENT} 45deg, ${BORDER} 100deg, ${BORDER} 180deg, ${ACCENT} 225deg, ${BORDER} 280deg); transform: translate(-50%, -50%); will-change: transform; animation: sketch-wave 1.8s linear infinite; }
@keyframes sketch-wave { to { transform: translate(-50%, -50%) rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .sketch-wave { animation: sketch-wave-pulse 2s ease-in-out infinite; background: ${ACCENT}; } .sketch-wave::before { display: none; } @keyframes sketch-wave-pulse { 50% { opacity: 0.35; } } }
.sketch-term { text-decoration: underline dotted ${MUTED}; text-decoration-thickness: 1.5px; text-underline-offset: 3px; cursor: help; }
.sketch-term:hover { text-decoration-color: ${ACCENT}; }
.sketch-term-tip { position: absolute; z-index: 30; display: flex; flex-direction: column; gap: 2px; max-width: 280px; padding: 8px 10px; border: 1px solid ${BORDER}; border-radius: 12px; background: ${PANEL}; box-shadow: ${SHADOW}; color: ${FOREGROUND}; font-family: ${SANS}, system-ui, sans-serif; font-size: 13px; line-height: 1.4; pointer-events: none; }
.sketch-term-tip strong { font-weight: 650; }
.sketch-term-tip span { color: ${MUTED}; }
`;
