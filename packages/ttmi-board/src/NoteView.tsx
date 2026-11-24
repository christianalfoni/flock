import { CodeBlockLowlight } from "@tiptap/extension-code-block-lowlight";
import { EditorContent, Extension, NodeViewContent, NodeViewWrapper, ReactNodeViewRenderer, useEditor, type Editor, type ReactNodeViewProps } from "@tiptap/react";
import { StarterKit } from "@tiptap/starter-kit";
import type { NoteShape, SketchTerm } from "@ttmi/format";
import { Check, ChevronDown, ChevronUp, Copy } from "lucide-react";
import { common, createLowlight } from "lowlight";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { pseudo } from "./pseudo";
import { COLORS, DEFAULT_TEXT_SIZE, NOTE_COLOR, NOTE_ON_COLOR, noteTitle, ON_COLORS } from "./shapes";
import { FOREGROUND } from "./styles";
import { NoteTerms, setNoteTerms } from "./terms";

const lowlight = createLowlight({ ...common, pseudo });

// Enter on a line that reads ``` or ```ts turns it into a code block. The
// built-in shortcut only fires on typed characters, which keyboards with a
// dead-key backtick never deliver.
const FenceOnEnter = Extension.create({
  name: "fenceOnEnter",
  priority: 1000,
  addKeyboardShortcuts() {
    return {
      Enter: ({ editor }) => {
        const { $from, empty } = editor.state.selection;
        if (!empty || $from.parent.type.name !== "paragraph" || $from.parentOffset !== $from.parent.content.size) return false;
        const match = /^```([\w+#-]*)$/.exec($from.parent.textContent);
        if (!match) return false;
        return editor.chain()
          .deleteRange({ from: $from.start(), to: $from.end() })
          .setCodeBlock(match[1] ? { language: match[1] } : undefined)
          .run();
      },
    };
  },
});

// Tab writes two spaces instead of leaving the note. In a list it indents
// the item, as Linear does; Shift+Tab outdents it again.
const TabIndent = Extension.create({
  name: "tabIndent",
  priority: 1000,
  addKeyboardShortcuts() {
    return {
      Tab: ({ editor }) => editor.commands.sinkListItem("listItem") || editor.commands.insertContent("  "),
      "Shift-Tab": ({ editor }) => {
        editor.commands.liftListItem("listItem");
        return true;
      },
    };
  },
});

const noteExtensions = [
  // No empty paragraph kept after a last code block: it would draw a blank
  // line under the code that measuring does not count.
  StarterKit.configure({ codeBlock: false, trailingNode: false, link: { openOnClick: false } }),
  // Guessing the language of a short snippet mostly guesses wrong.
  CodeBlockLowlight.extend({ addNodeView: () => ReactNodeViewRenderer(CodeBlockView) }).configure({ lowlight, defaultLanguage: "typescript" }),
  FenceOnEnter,
  TabIndent,
  // The sketch's terms, kept per editor and set by NoteView. One list for
  // every note: a new list each render would make a new editor.
  NoteTerms,
];

// Buttons that act on their own: they neither select, start a drag or a pan,
// nor open a comment.
const ownClick = {
  onPointerDown: (event: { stopPropagation(): void; preventDefault(): void }) => { event.stopPropagation(); event.preventDefault(); },
  onDoubleClick: (event: { stopPropagation(): void }) => event.stopPropagation(),
};

// A code block with a copy button in its corner. Copy works whether the
// note is edited, played or only looked at. The button is left out of the
// PNG export. Code is shown as it was written (docs/format.md, Code).
function CodeBlockView({ node }: ReactNodeViewProps) {
  const [copied, setCopied] = useState(false);
  const language = (node.attrs.language as string | null) ?? null;

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(timer);
  }, [copied]);

  function copy() {
    navigator.clipboard.writeText(node.textContent).then(() => setCopied(true), () => {});
  }

  return (
    <NodeViewWrapper className="sketch-code">
      <pre><NodeViewContent<"code"> as="code" className={language ? `language-${language}` : undefined} /></pre>
      <div className="sketch-code-actions sketch-no-export" contentEditable={false}>
        <button
          type="button"
          className={`sketch-code-button sketch-code-copy ${copied ? "sketch-code-copied" : ""}`}
          title={copied ? "Copied" : "Copy code"}
          {...ownClick}
          onClick={copy}
        >
          {copied ? <Check size={12} /> : <Copy size={12} />}
        </button>
      </div>
    </NodeViewWrapper>
  );
}

const NO_TERMS: SketchTerm[] = [];

// Where an open note's panel sits from the note: its pill is 10px in from
// the panel's 1.5px border and 11px above it (styles.ts), so the panel moves
// for the pill to stay where the folded note was.
export const OPEN_SHIFT = { x: -11.5, y: 9.5 };

// A rich text note. Always a Tiptap editor, read-only until edited, so code
// blocks keep their highlighting while not being edited. A note with more
// than one block is drawn folded to its first line, or open as a raised
// card (docs/board.md, Notes fold); the board says which, and how wide.
export function NoteView({ note, editing, fold, width, tagged, terms = NO_TERMS, className = "", onEditor, onChange, onMeasure, onToggleFold }: {
  note: NoteShape;
  editing: boolean;
  fold: "none" | "folded" | "open";
  width: number;
  // The note has a tag (or one is being typed), which it makes room for at
  // its top (docs/board.md, Tag).
  tagged: boolean;
  // The sketch's terms, marked in the note's prose (docs/board.md, Terms).
  terms?: SketchTerm[];
  // Extra classes from the board, such as the one marking a step's shapes.
  className?: string;
  onEditor(editor?: Editor): void;
  onChange(html: string): void;
  onMeasure(height: number): void;
  // The chevron: folds an open note, opens a folded one.
  onToggleFold(): void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onMeasureRef = useRef(onMeasure);
  onMeasureRef.current = onMeasure;
  const onEditorRef = useRef(onEditor);
  onEditorRef.current = onEditor;
  const editor = useEditor({
    extensions: noteExtensions,
    content: note.html,
    editable: editing,
    onUpdate: ({ editor: current }) => onChangeRef.current(current.getHTML()),
  });

  // Text that changed outside the editor (an import merging the agent's
  // update into this note) replaces what it shows; its own edits come back
  // through onChange as the same HTML, so they never reset it.
  useEffect(() => {
    if (!editor || editing || editor.getHTML() === note.html) return;
    editor.commands.setContent(note.html, { emitUpdate: false });
  }, [editor, editing, note.html]);

  useEffect(() => {
    if (editor) setNoteTerms(editor, terms);
  }, [editor, terms]);

  useEffect(() => {
    if (!editor) return;
    editor.setEditable(editing, false);
    if (!editing) return;
    editor.commands.focus("end");
    onEditorRef.current(editor);
    return () => onEditorRef.current(undefined);
  }, [editor, editing]);

  useEffect(() => {
    const element = ref.current!;
    const observer = new ResizeObserver(() => onMeasureRef.current(element.offsetHeight));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      data-shape-id={note.id}
      data-name={note.name}
      className={`sketch-note ${editing ? "sketch-note-editing" : ""} ${fold === "none" ? "" : `sketch-note-foldable sketch-note-${fold}`} ${tagged ? "sketch-note-tagged" : ""} ${className}`}
      style={{ left: note.x + (fold === "open" ? OPEN_SHIFT.x : 0), top: note.y + (fold === "open" ? OPEN_SHIFT.y : 0), width, color: FOREGROUND, fontSize: note.size ?? DEFAULT_TEXT_SIZE, ...(fold === "open" ? { borderColor: noteColours(note).background } : {}) }}
    >
      {fold !== "none" && (
        // A note that folds wears one head, its tag, its title (the first
        // block) and the chevron: folded it is the head alone, open the head
        // sits on the panel's edge over the rest (docs/board.md, Notes fold).
        <NoteHead note={note} title={noteTitle(note.html)} open={fold === "open"} onToggleFold={onToggleFold} />
      )}
      <EditorContent editor={editor} />
    </div>
  );
}

// A folding note's head: its title (the first block) and the chevron on a
// pill drawn like a tag, in the note's amber, or its state's colour when it
// has one; an open note's panel is edged in the same colour. A note has no
// tag: it is detail on a part that has one. The measurer builds the same pill
// (measure.ts, noteFolded).
function NoteHead({ note, title, open, onToggleFold }: { note: NoteShape; title: string; open: boolean; onToggleFold(): void }) {
  return (
    <div className="sketch-note-head" style={noteColours(note)}>
      <span className="sketch-note-title">{title}</span>
      {/* Its own control: it neither selects nor starts a drag. */}
      <button
        type="button"
        className="sketch-note-chevron sketch-no-export"
        title={open ? "Fold the note" : "Open the note"}
        onPointerDown={(event) => { event.stopPropagation(); event.preventDefault(); }}
        onDoubleClick={(event) => event.stopPropagation()}
        onClick={onToggleFold}
      >
        {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
      </button>
    </div>
  );
}

// A note's pill colours: its amber, or its state's colour.
function noteColours(note: NoteShape) {
  return note.color === "white" ? { background: NOTE_COLOR, color: NOTE_ON_COLOR } : { background: COLORS[note.color], color: ON_COLORS[note.color] };
}
