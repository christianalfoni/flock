import { marked } from "marked";
import TurndownService from "turndown";

export function markdownToHtml(markdown: string) {
  // The note editor drops the line breaks between blocks and reads a line
  // break inside a paragraph as a space; done here as well, so measuring
  // (where note text keeps its whitespace) matches what the board shows.
  // Code keeps its lines, but not the line break marked ends it with: the
  // editor draws that as an empty last line, and measuring does not.
  const html = (marked.parse(markdown, { async: false, gfm: true }) as string).replace(/\n<\/code><\/pre>/g, "</code></pre>").replace(/>\n+</g, "><").trim();
  return html.split(/(<pre[\s\S]*?<\/pre>)/).map((part) => (part.startsWith("<pre") ? part : part.replace(/\n/g, " "))).join("");
}

let turndown: TurndownService | undefined;
export function htmlToMarkdown(html: string) {
  turndown ??= new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced", bulletListMarker: "-", emDelimiter: "*", strongDelimiter: "**" });
  return turndown.turndown(html).trim();
}
