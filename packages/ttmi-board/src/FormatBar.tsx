import type { Editor } from "@tiptap/react";
import { Bold, Code, Italic, List, ListOrdered, SquareCode } from "lucide-react";
import { useEffect, useState } from "react";

// Formatting buttons for the note being written in. Pressing one keeps the
// caret in the note.
export function FormatBar({ editor }: { editor: Editor }) {
  const [, setVersion] = useState(0);
  useEffect(() => {
    const update = () => setVersion((current) => current + 1);
    editor.on("transaction", update);
    return () => { editor.off("transaction", update); };
  }, [editor]);
  const items = [
    { label: "Bold (⌘B)", icon: Bold, active: editor.isActive("bold"), run: () => editor.chain().focus().toggleBold().run() },
    { label: "Italic (⌘I)", icon: Italic, active: editor.isActive("italic"), run: () => editor.chain().focus().toggleItalic().run() },
    { label: "Inline code (⌘E)", icon: Code, active: editor.isActive("code"), run: () => editor.chain().focus().toggleCode().run() },
    { label: "Bullet list (- then space)", icon: List, active: editor.isActive("bulletList"), run: () => editor.chain().focus().toggleBulletList().run() },
    { label: "Numbered list (1. then space)", icon: ListOrdered, active: editor.isActive("orderedList"), run: () => editor.chain().focus().toggleOrderedList().run() },
    { label: "Code block (``` then Enter)", icon: SquareCode, active: editor.isActive("codeBlock"), run: () => editor.chain().focus().toggleCodeBlock().run() },
  ];
  return (
    <div className="sketch-row">
      {items.map((item) => (
        <button key={item.label} className={item.active ? "sketch-active" : ""} title={item.label} onMouseDown={(event) => event.preventDefault()} onClick={item.run}>
          <item.icon size={15} />
        </button>
      ))}
    </div>
  );
}
