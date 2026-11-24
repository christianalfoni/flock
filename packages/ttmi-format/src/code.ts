// Code in a note (docs/format.md, Code). Pseudo code is TypeScript,
// simplified: it parses, and what it leaves out is a call to a function it
// never defines. The board shows code as it is written, so a new save holds
// the agent to it: a language the board highlights, lines of 80 characters
// at most, and code that parses where a parser is at hand.

// The names the board highlights a block by: highlight.js's common
// languages and their aliases, as lowlight registers them
// (packages/board/test/languages.test.ts keeps the two lists equal).
export const LANGUAGES = [
  "arduino", "ino", "bash", "sh", "zsh", "c", "h", "cpp", "cc", "c++", "h++", "hpp", "hh", "hxx", "cxx",
  "csharp", "cs", "c#", "css", "diff", "patch", "go", "golang", "graphql", "gql", "ini", "toml",
  "java", "jsp", "javascript", "js", "jsx", "mjs", "cjs", "json", "jsonc", "json5", "kotlin", "kt", "kts",
  "less", "lua", "pluto", "makefile", "mk", "mak", "make", "markdown", "md", "mkdown", "mkd",
  "objectivec", "mm", "objc", "obj-c", "obj-c++", "objective-c++", "perl", "pl", "pm", "php", "php-template",
  "plaintext", "text", "txt", "python", "py", "gyp", "ipython", "python-repl", "pycon", "r",
  "ruby", "rb", "gemspec", "podspec", "thor", "irb", "rust", "rs", "scss", "shell", "console", "shellsession",
  "sql", "swift", "typescript", "ts", "tsx", "mts", "cts", "vbnet", "vb", "wasm",
  "xml", "html", "xhtml", "rss", "atom", "xjb", "xsd", "xsl", "plist", "wsf", "svg", "yaml", "yml",
];

// The names the parse check takes: TypeScript and JavaScript go to the
// checker the caller gives (the server's parser), JSON is parsed here.
export const SCRIPT_LANGUAGES = ["typescript", "ts", "tsx", "mts", "cts", "javascript", "js", "jsx", "mjs", "cjs"];
const JSON_LANGUAGES = ["json"];

// A code line's most characters. The guide asks for 60, a note's width of
// prose; past 80 the note is widened far beyond it.
export const MAX_CODE_LINE = 80;

// A parse check for TypeScript and JavaScript: the line inside the code,
// from 1, and the parser's message, or nothing when it parses.
export type CodeCheck = (language: string, code: string) => { line: number; message: string } | undefined;

export type CodeBlock = { language: string; code: string; line: number };

// The fenced code blocks in a note's markdown: the language after the
// fence (empty when none), the code, dedented by the fence's indent, and
// the index of its first line in the markdown.
export function codeBlocks(markdown: string): CodeBlock[] {
  const lines = markdown.split("\n");
  const blocks: CodeBlock[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const open = /^(\s*)(`{3,}|~{3,})\s*([^\s`]*)/.exec(lines[index]!);
    if (!open) continue;
    const [, indent, fence] = open as unknown as [string, string, string];
    const start = index + 1;
    const code: string[] = [];
    for (index = start; index < lines.length; index += 1) {
      const line = lines[index]!;
      if (line.trim().startsWith(fence) && new RegExp(`^\\s*\\${fence[0]}{${fence.length},}\\s*$`).test(line)) break;
      code.push(line.startsWith(indent) ? line.slice(indent.length) : line.trimStart());
    }
    blocks.push({ language: open[3]!.toLowerCase(), code: code.join("\n"), line: start });
  }
  return blocks;
}

// The first problem with a note's code, with the index of its line in the
// markdown, or nothing.
export function codeProblem(markdown: string, checkCode?: CodeCheck): { line: number; message: string } | undefined {
  for (const block of codeBlocks(markdown)) {
    const fence = block.line - 1;
    if (!block.language) return { line: fence, message: "a code block names its language: ```ts for code and types (pseudo code is TypeScript too), ```text for none." };
    if (block.language === "pseudo" || block.language === "pseudocode") {
      return { line: fence, message: `\`\`\`${block.language} is gone: pseudo code is TypeScript, simplified. Write it in a \`\`\`ts block that parses, and call what you leave out, like await chargeCard(order).` };
    }
    if (!LANGUAGES.includes(block.language)) return { line: fence, message: `the board does not highlight "${block.language}"; use a language it does (ts, sql, json, yaml, sh, …) or \`\`\`text.` };
    const lines = block.code.split("\n");
    const long = lines.findIndex((line) => line.length > MAX_CODE_LINE);
    if (long >= 0) return { line: block.line + long, message: `a code line is ${MAX_CODE_LINE} characters at most (aim for 60); this one is ${lines[long]!.length}. Break it, or shorten names.` };
    if (JSON_LANGUAGES.includes(block.language)) {
      try {
        JSON.parse(block.code);
      } catch (error) {
        return { line: fence, message: `the json block does not parse: ${error instanceof Error ? error.message : String(error)}.` };
      }
    }
    if (checkCode && SCRIPT_LANGUAGES.includes(block.language)) {
      const problem = checkCode(block.language, block.code);
      if (problem) {
        return {
          line: block.line + Math.min(Math.max(problem.line, 1), lines.length) - 1,
          message: `the ${block.language} block does not parse: ${problem.message.replace(/\.$/, "")}. Pseudo code is still TypeScript: simplify by calling what you leave out, like await chargeCard(order), not by writing prose.`,
        };
      }
    }
  }
  return undefined;
}
