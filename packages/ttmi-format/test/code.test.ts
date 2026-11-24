// Code in a note (docs/format.md, Code). Pseudo code is TypeScript,
// simplified, and a new save is held to it: every block names a language
// the board highlights, pseudo is gone, a line is 80 characters at most,
// JSON parses, and TypeScript parses through the checker the server gives.
// Text saved before still reads.
import { describe, expect, it } from "vitest";
import { codeBlocks, LANGUAGES, parseSketch, type CodeCheck } from "../src/index";

const strict = (source: string, checkCode?: CodeCheck) => () => parseSketch(source, undefined, [], { strict: true, checkCode });
const note = (...body: string[]) => ["n: note", ...body.map((line) => (line ? `  ${line}` : ""))].join("\n");

describe("code blocks", () => {
  it("are found with their language and the line their code starts on", () => {
    expect(codeBlocks("## N\n```ts\nconst a = 1;\n```\n- item\n  ```sql\n  select 1\n  ```")).toEqual([
      { language: "ts", code: "const a = 1;", line: 2 },
      { language: "sql", code: "select 1", line: 6 },
    ]);
    expect(codeBlocks("```\nplain\n```")).toEqual([{ language: "", code: "plain", line: 1 }]);
    expect(codeBlocks("````md\n```ts\nx\n```\n````")).toEqual([{ language: "md", code: "```ts\nx\n```", line: 1 }]);
  });
});

describe("a new save", () => {
  it("refuses a block with no language", () => {
    expect(strict(note("## N", "```", "x", "```"))).toThrow(/^Line 3: a code block names its language/);
  });

  it("refuses pseudo: pseudo code is TypeScript", () => {
    expect(strict(note("## N", "```pseudo", "do the thing", "```"))).toThrow(/^Line 3: ```pseudo is gone: pseudo code is TypeScript/);
    expect(strict(note("## N", "```pseudocode", "x", "```"))).toThrow(/```pseudocode is gone/);
  });

  it("refuses a language the board does not highlight", () => {
    expect(strict(note("## N", "```dockerfile", "FROM node", "```"))).toThrow(/^Line 3: the board does not highlight "dockerfile"/);
    for (const name of ["ts", "tsx", "sql", "json", "yaml", "sh", "html", "css", "graphql", "diff", "text", "rust", "py"]) {
      expect(LANGUAGES).toContain(name);
      expect(strict(note("## N", `\`\`\`${name}`, "x", "```"))).not.toThrow(/highlight/);
    }
  });

  it("refuses a code line over 80 characters, on its own line", () => {
    const long = `const total = ${"price + ".repeat(9)}tax;`;
    expect(long.length).toBeGreaterThan(80);
    expect(strict(note("## N", "```ts", "const a = 1;", long, "```"))).toThrow(new RegExp(`^Line 5: a code line is 80 characters at most \\(aim for 60\\); this one is ${long.length}`));
    expect(strict(note("## N", "```text", "x".repeat(80), "```"))).not.toThrow();
    // Prose wraps; only code is held to it.
    expect(strict(note("## N", "word ".repeat(30)))).not.toThrow();
  });

  it("refuses JSON that does not parse", () => {
    expect(strict(note("## N", "```json", '{ "a": 1, }', "```"))).toThrow(/^Line 3: the json block does not parse/);
    expect(strict(note("## N", "```json", '{ "a": 1 }', "```"))).not.toThrow();
  });

  it("hands TypeScript and JavaScript to the checker, and fails on the line it names", () => {
    const seen: [string, string][] = [];
    const check: CodeCheck = (language, code) => {
      seen.push([language, code]);
      return code.includes(":") && !code.includes("type") ? { line: 2, message: "Unexpected token" } : undefined;
    };
    expect(strict(note("## N", "```ts", "type A = { a: 1 };", "```", "```js", "const a = 1;", "```"), check)).not.toThrow();
    expect(seen).toEqual([["ts", "type A = { a: 1 };"], ["js", "const a = 1;"]]);
    expect(strict(note("## N", "```ts", "const a = 1;", "if failures > 50:", "```"), check)).toThrow(/^Line 5: the ts block does not parse: Unexpected token\. Pseudo code is still TypeScript/);
  });

  it("reports the line inside a note that starts below its first line", () => {
    expect(strict(`a: box "A"\n\n${note("## N", "", "Some prose.", "```", "x", "```")}`)).toThrow(/^Line 7: a code block names its language/);
  });
});

describe("text saved before", () => {
  it("still reads pseudo, a block with no language, and long lines", () => {
    expect(() => parseSketch(note("## N", "```pseudo", "do it", "```", "```", "y".repeat(120), "```", "```dockerfile", "FROM node", "```"))).not.toThrow();
  });
});
