// Terms (docs/format.md, Terms): a sketch says what its words mean, and the
// board marks them where it shows text.
import { describe, expect, it } from "vitest";
import { parseSketch, serializeSketch, sketchTitle, termKey, termRuns } from "../src";
import { example, examples } from "./helpers";

const SOURCE = `# sketch Dispatch
term "Dispatch" "Routes a job to the cheapest idle runner"
term "Dead letters" "Jobs that failed every retry -> kept"
api: box "API" tint
runner: box "Runner"
api -> runner "dispatch"`;

describe("term lines", () => {
  it("read the word and what it means, in order", () => {
    expect(parseSketch(SOURCE).terms).toEqual([
      { term: "Dispatch", definition: "Routes a job to the cheapest idle runner" },
      { term: "Dead letters", definition: "Jobs that failed every retry -> kept" },
    ]);
  });

  it("are no shapes and no arrows", () => {
    const { shapes } = parseSketch(SOURCE);
    expect(shapes.filter((shape) => shape.kind !== "arrow")).toHaveLength(2);
    expect(shapes.filter((shape) => shape.kind === "arrow")).toHaveLength(1);
  });

  it("leave a shape called term alone", () => {
    const { shapes, terms } = parseSketch('# sketch T\nterm: box "Term"');
    expect(terms).toEqual([]);
    expect(shapes[0]).toMatchObject({ name: "term", label: "Term" });
  });

  it("are none in a sketch without them", () => {
    expect(parseSketch('# sketch T\na: box "A"').terms).toEqual([]);
  });

  it("refuse a term without a definition, naming the line", () => {
    expect(() => parseSketch('# sketch T\nterm "Dispatch"')).toThrow(/^Line 2: a term is the word and what it means/);
    expect(() => parseSketch('# sketch T\nterm "Dispatch" ""')).toThrow(/^Line 2: a term is/);
    expect(() => parseSketch('# sketch T\nterm "A" "b" "c"')).toThrow(/^Line 2: a term is/);
  });

  it("refuse the same term twice, whatever its case", () => {
    expect(() => parseSketch('# sketch T\nterm "Job" "a"\nterm "job" "b"')).toThrow(/^Line 3: the term "job" is already defined/);
  });

  it("round-trip: exported first, read back the same", () => {
    const first = parseSketch(SOURCE);
    const text = serializeSketch(first.shapes, sketchTitle(SOURCE), first.steps, first.groups, first.terms).text;
    expect(text.split("\n").slice(2, 4)).toEqual([
      'term "Dispatch" "Routes a job to the cheapest idle runner"',
      'term "Dead letters" "Jobs that failed every retry -> kept"',
    ]);
    const again = parseSketch(text, undefined, first.shapes);
    expect(again.terms).toEqual(first.terms);
    expect(serializeSketch(again.shapes, sketchTitle(SOURCE), again.steps, again.groups, again.terms).text).toBe(text);
  });

  it("keep quotes and backslashes in a definition", () => {
    const { shapes, steps, groups, terms } = parseSketch('# sketch T\nterm "Q" "says \\"hi\\" \\\\ bye"');
    expect(terms[0]!.definition).toBe('says "hi" \\ bye');
    expect(parseSketch(serializeSketch(shapes, "T", steps, groups, terms).text).terms).toEqual(terms);
  });
});

describe("existing sketches", () => {
  it("have no terms, so they mean what they meant", () => {
    for (const file of examples()) expect(parseSketch(example(file)).terms).toEqual([]);
  });
});

describe("termKey", () => {
  it("ignores case and spacing", () => {
    expect(termKey("  Dead   Letters ")).toBe("dead letters");
  });
});

describe("termRuns", () => {
  const terms = [
    { term: "Dead", definition: "d" },
    { term: "Dead letters", definition: "dl" },
    { term: "API", definition: "a" },
  ];
  const marked = (text: string) => termRuns(text, terms).map((run) => (run.term ? `[${run.text}]` : run.text)).join("");

  it("marks whole words in any case", () => {
    expect(marked("The api calls the API")).toBe("The [api] calls the [API]");
  });

  it("leaves a term inside a longer word", () => {
    expect(marked("APIs and rapid deadlines")).toBe("APIs and rapid deadlines");
  });

  it("takes the longest term where two overlap", () => {
    expect(marked("into dead letters, dead")).toBe("into [dead letters], [dead]");
    expect(termRuns("dead  letters", terms)[0]!.term!.definition).toBe("dl");
  });

  it("gives the text back when joined", () => {
    const text = "Dead letters hold what the API dropped.";
    expect(termRuns(text, terms).map((run) => run.text).join("")).toBe(text);
  });

  it("is the text alone without terms, and nothing for no text", () => {
    expect(termRuns("plain", [])).toEqual([{ text: "plain" }]);
    expect(termRuns("", terms)).toEqual([]);
  });

  it("reads terms with characters a pattern would", () => {
    expect(termRuns("use C++ (v2)", [{ term: "C++", definition: "c" }, { term: "(v2)", definition: "v" }]).filter((run) => run.term)).toHaveLength(2);
  });
});
