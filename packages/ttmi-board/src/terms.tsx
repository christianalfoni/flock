// Terms on the board (docs/board.md, Terms): the sketch's words marked
// where they are read, in labels, note prose and narration, with what they
// mean on hover. The marks are plain spans with the term on them, so one
// handler on the board shows the definition for any of them.
import { Extension, type Editor } from "@tiptap/react";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { Node as PmNode } from "@tiptap/pm/model";
import { termRuns, type SketchTerm } from "@ttmi/format";

export const TERM_CLASS = "sketch-term";

const markAttrs = (term: SketchTerm) => ({ class: TERM_CLASS, "data-term": term.term, "data-definition": term.definition });

// A label or a narration with its terms marked.
export function TermText({ text, terms }: { text: string; terms: SketchTerm[] }) {
  if (terms.length === 0) return <>{text}</>;
  return (
    <>
      {termRuns(text, terms).map((run, index) => (run.term ? <span key={index} {...{ className: TERM_CLASS, "data-term": run.term.term, "data-definition": run.term.definition }}>{run.text}</span> : run.text))}
    </>
  );
}

const termsKey = new PluginKey("sketchTerms");

function decorate(doc: PmNode, terms: SketchTerm[]) {
  if (terms.length === 0) return DecorationSet.empty;
  const found: Decoration[] = [];
  doc.descendants((node, pos) => {
    // Code is code: a term inside it is left alone.
    if (node.type.name === "codeBlock") return false;
    if (!node.isText || node.marks.some((mark) => mark.type.name === "code")) return;
    let at = pos;
    for (const run of termRuns(node.text ?? "", terms)) {
      if (run.term) found.push(Decoration.inline(at, at + run.text.length, markAttrs(run.term)));
      at += run.text.length;
    }
  });
  return DecorationSet.create(doc, found);
}

type TermStorage = { terms: SketchTerm[] };
const storageOf = (editor: Editor) => (editor.storage as unknown as Record<string, TermStorage>).sketchTerms!;

// The note editor's marks: decorations, so the note's HTML and what is
// saved never change. setNoteTerms redraws them when the sketch's terms
// change.
export const NoteTerms = Extension.create<TermStorage, TermStorage>({
  name: "sketchTerms",
  addOptions: () => ({ terms: [] }),
  addStorage() {
    return { terms: this.options.terms };
  },
  addProseMirrorPlugins() {
    const { editor } = this;
    // The last marks drawn, for the document and terms they were made for.
    let drawn: { doc: PmNode; terms: SketchTerm[]; set: DecorationSet } | undefined;
    return [
      new Plugin({
        key: termsKey,
        props: {
          decorations: (state) => {
            const { terms } = storageOf(editor);
            if (drawn?.doc !== state.doc || drawn.terms !== terms) drawn = { doc: state.doc, terms, set: decorate(state.doc, terms) };
            return drawn.set;
          },
        },
      }),
    ];
  },
});

// New terms are drawn without a transaction: the note's document and its
// history do not change, and nothing listening for edits hears of it.
export function setNoteTerms(editor: Editor, terms: SketchTerm[]) {
  const storage = storageOf(editor);
  if (!storage || storage.terms === terms) return;
  const same = JSON.stringify(storage.terms) === JSON.stringify(terms);
  storage.terms = terms;
  if (!same && !editor.isDestroyed) editor.view.updateState(editor.view.state);
}

// The definition, floating under the word the pointer is on. Screen
// coordinates, outside the world, so the PNG export leaves it out.
export type TermTipState = { term: string; definition: string; x: number; y: number };

export function TermTip({ tip }: { tip?: TermTipState }) {
  if (!tip) return null;
  return (
    <div className="sketch-term-tip sketch-no-export" role="tooltip" style={{ left: tip.x, top: tip.y }}>
      <strong>{tip.term}</strong>
      <span>{tip.definition}</span>
    </div>
  );
}

// The term under an event's target, if it is on one.
export function termAt(target: EventTarget | null): HTMLElement | undefined {
  const element = target instanceof Element ? target.closest(`.${TERM_CLASS}`) : null;
  return element instanceof HTMLElement && element.dataset.term ? element : undefined;
}
