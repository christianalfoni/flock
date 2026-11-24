// Reading the format: the block, lines, attributes, bodies and the estimate
// fallback for sizes (docs/format.md, The block / Lines / Sizes).
import { describe, expect, it } from "vitest";
import { CANVAS_MARK, CANVAS_MIN_WIDTH, externalHref, parseSketch, portalSketchId, serializeSketch, sketchSlug, sketchTitle, tagSize, widthForBadge, type NoteShape, type RectShape } from "../src/index";
import { arrows, boxesByName, byUser } from "./helpers";

function box(source: string, name: string) {
  return boxesByName(parseSketch(source).shapes).get(name) as RectShape;
}

function note(source: string, name: string) {
  return boxesByName(parseSketch(source).shapes).get(name) as NoteShape;
}

describe("the block", () => {
  it("reads the title from the # sketch line", () => {
    expect(sketchTitle("# sketch Job retries\napi: box \"A\"")).toBe("Job retries");
    expect(sketchTitle("#sketch   Spaced   \n")).toBe("Spaced");
    expect(sketchTitle("# Sketch Case")).toBe("Case");
  });

  it("has no title without one, or without the marker", () => {
    expect(sketchTitle("# sketch\napi: box \"A\"")).toBeUndefined();
    expect(sketchTitle("api: box \"A\"")).toBeUndefined();
    expect(sketchTitle("")).toBeUndefined();
  });

  it("finds the title past a fence", () => {
    expect(sketchTitle("````sketch\n# sketch Fenced\napi: box \"A\"\n````")).toBe("Fenced");
  });

  it("slugs titles", () => {
    expect(sketchSlug("Job retries")).toBe("job-retries");
    expect(sketchSlug("  Hello, World!  ")).toBe("hello-world");
    expect(sketchSlug("!!!")).toBe("sketch");
    expect(sketchSlug("x".repeat(60))).toHaveLength(40);
  });

  it("strips fences of backticks or tildes", () => {
    for (const source of ["````sketch\n# sketch T\na: box \"A\"\n````", "```\na: box \"A\"\n```", "~~~\na: box \"A\"\n~~~\n", "\n\n  ````sketch\na: box \"A\"\n````"]) {
      expect(boxesByName(parseSketch(source).shapes).has("a")).toBe(true);
    }
  });

  it("ignores blank lines and # comments, and accepts CRLF", () => {
    const { shapes } = parseSketch("# sketch T\r\n\r\n# a comment\r\na: box \"A\"\r\n\r\n");
    expect(boxesByName(shapes).size).toBe(1);
  });

  it("gives an empty board for empty text", () => {
    expect(parseSketch("")).toEqual({ shapes: [], steps: [], groups: [], terms: [] });
    expect(parseSketch("# sketch Only a title")).toEqual({ shapes: [], steps: [], groups: [], terms: [] });
  });
});

describe("boxes", () => {
  it("default to white, no fill, no tag", () => {
    const a = box('a: box "A"', "a");
    expect(a).toMatchObject({ kind: "rect", name: "a", label: "A", color: "white" });
    expect(a.tag).toBeUndefined();
  });

  it("take color, fill, tag, at and size in any order", () => {
    const a = box('a: box tag "Service" size 200,100 solid "A" at 10,20 blue', "a");
    expect(a).toMatchObject({ label: "A", color: "blue", tag: "Service", x: 10, y: 20, w: 200, h: 100 });
  });

  it("unescape \\n, \\\" and \\\\ in labels", () => {
    expect(box('a: box "Line 1\\nLine \\"two\\" \\\\"', "a").label).toBe('Line 1\nLine "two" \\');
  });

  it("accept negative and decimal positions", () => {
    expect(box('a: box "A" at -10.5,-20', "a")).toMatchObject({ x: -10.5, y: -20 });
  });

  it("drop a tag that is only spaces", () => {
    expect(box('a: box "A" tag "  "', "a").tag).toBeUndefined();
  });

  it("grows a box so its tag badge stays inside the corners", () => {
    const tag = "Admin projects storage: walk and page model";
    const grown = box(`a: box "A" tag "${tag}"`, "a");
    const plain = box('b: box "A"', "b");
    expect(grown.w).toBeGreaterThanOrEqual(widthForBadge(tagSize(tag).w));
    expect(grown.w).toBeGreaterThan(plain.w);
    expect(grown.h).toBe(plain.h);
    // A size the text asks for still grows, and the height stays.
    const sized = box(`a: box "A" tag "${tag}" size 80,40`, "a");
    expect(sized.w).toBeGreaterThanOrEqual(widthForBadge(tagSize(tag).w));
    expect(sized.h).toBe(40);
    // A short tag stays inside the label's box.
    const short = box('a: box "A quite long label here" tag "Go"', "a");
    const labelOnly = box('b: box "A quite long label here"', "b");
    expect(short.w).toBe(labelOnly.w);
  });

  it("grows a canvas for its name badge, including the magnifier", () => {
    const name = "Room storage census routes";
    const canvas = box(`a: box "${name}" link "sk1"`, "a");
    expect(canvas.w).toBeGreaterThanOrEqual(widthForBadge(tagSize(name).w + CANVAS_MARK));
    const plain = box(`b: box "${name}"`, "b");
    expect(canvas.w).toBeGreaterThan(plain.w);
  });

  it("allow names with digits, underscores and dashes", () => {
    const names = boxesByName(parseSketch('a_1: box "A"\nb-2: box "B"\n_c: box "C"').shapes);
    expect([...names.keys()]).toEqual(["a_1", "b-2", "_c"]);
  });
});

describe("notes", () => {
  it("take the indented lines below as markdown, dedented, trailing blanks dropped", () => {
    const source = "n: note\n    ## Title\n\n    Some **bold** text.\n      - item\n\n\na: box \"A\"";
    const { shapes } = parseSketch(source);
    const n = boxesByName(shapes).get("n") as NoteShape;
    expect(n.html).toBe("<h2>Title</h2><p>Some <strong>bold</strong> text.</p><ul><li>item</li></ul>");
    expect(boxesByName(shapes).has("a")).toBe(true);
  });

  it("keep code blocks' lines and language", () => {
    const n = note("n: note\n  ```ts\n  type A = {\n    x: number;\n  };\n  ```", "n");
    expect(n.html).toBe('<pre><code class="language-ts">type A = {\n  x: number;\n};</code></pre>');
  });

  it("end code blocks at their last line, which the note editor would draw as an empty line", () => {
    const n = note("n: note\n  ```pseudo\n  one\n  two\n  ```\n\n  Then.", "n");
    expect(n.html).toBe('<pre><code class="language-pseudo">one\ntwo</code></pre><p>Then.</p>');
  });

  it("read # inside a body as a heading, not a comment", () => {
    expect(note("n: note\n  # Heading", "n").html).toBe("<h1>Heading</h1>");
  });

  it("default to width 420 (about 60 characters of 14 px prose) and size 14, and take color, text, at, width; a tag is dropped", () => {
    expect(note("n: note", "n")).toMatchObject({ kind: "note", w: 420, minWidth: 420, color: "white" });
    expect(note("n: note", "n").size).toBeUndefined();
    const n = note('n: note violet text 18 tag "Data model" at 5,6 width 500\n  hi', "n");
    expect(n).toMatchObject({ color: "violet", size: 18, x: 5, y: 6, w: 500 });
    expect(n.tag).toBeUndefined();
  });

  it("may be empty", () => {
    expect(note("n: note\na: box \"A\"", "n").html).toBe("");
  });
});

describe("arrows", () => {
  it("connect shapes, with label, color and bend in any order", () => {
    const { shapes } = parseSketch('a: box "A"\nb: box "B"\na -> b red "goes" bend -40');
    const [arrow] = arrows(shapes);
    expect(arrow).toMatchObject({ kind: "arrow", color: "red", label: "goes", bend: -40 });
  });

  it("default to white, no label, no bend when straight", () => {
    const { shapes } = parseSketch('a: box "A" at 0,0 size 100,50\nb: box "B" at 400,0 size 100,50\na -> b');
    const [arrow] = arrows(shapes);
    expect(arrow).toMatchObject({ color: "white" });
    expect(arrow!.label).toBeUndefined();
    expect(arrow!.bend).toBeUndefined();
  });

  it("accept points at either end and tolerate spacing around ->", () => {
    const { shapes } = parseSketch('a: box "A" at 0,0 size 100,50\n10,20->a\na   ->   300,400 "out"');
    const [toA, fromA] = arrows(shapes);
    expect(toA!.from).toEqual({ x: 10, y: 20 });
    expect(fromA!.to).toEqual({ x: 300, y: 400 });
    expect(fromA!.label).toBe("out");
  });

  it("land on the shapes' edges, 6 px outside", () => {
    const { shapes } = parseSketch('a: box "A" at 0,0 size 100,50\nb: box "B" at 400,0 size 100,50\na -> b');
    const [arrow] = arrows(shapes);
    expect(arrow!.from).toEqual({ x: 106, y: 25 });
    expect(arrow!.to).toEqual({ x: 394, y: 25 });
  });

  it("keep a given bend", () => {
    const { shapes } = parseSketch('a: box "A" at 0,0 size 100,50\nb: box "B" at 400,0 size 100,50\na -> b bend 90');
    expect(arrows(shapes)[0]!.bend).toBe(90);
  });

  it("bend around a shape in the way", () => {
    const { shapes } = parseSketch('a: box "A" at 0,0 size 100,50\nc: box "C" at 200,0 size 100,50\nb: box "B" at 400,0 size 100,50\na -> b');
    expect(arrows(shapes)[0]!.bend).not.toBeUndefined();
    expect(arrows(shapes)[0]!.bend).not.toBe(0);
  });
});

describe("steps", () => {
  it("name shapes separated by spaces or commas, with the narration joined into one paragraph", () => {
    const { steps } = parseSketch('a: box "A"\nb: box "B"\nstep: a, b\n  First line\n    second line.\n\nstep:\n  Nothing new.');
    expect(steps).toEqual([{ names: ["a", "b"], narration: "First line second line." }, { names: [], narration: "Nothing new." }]);
  });

  it("never change the drawing", () => {
    const plain = parseSketch('a: box "A"\nb: box "B"\na -> b');
    const stepped = parseSketch('a: box "A"\nb: box "B"\na -> b\nstep: a\n  One.\nstep: b\n  Two.');
    const strip = (shapes: typeof plain.shapes) => shapes.map(({ id: _id, ...rest }) => rest);
    expect(strip(stepped.shapes)).toEqual(strip(plain.shapes));
  });
});

describe("sizes without a measurer (the estimate fallback)", () => {
  it("sizes a box from its longest line and line count", () => {
    expect(box('a: box "API server"', "a")).toMatchObject({ w: 140, h: 70 });
    expect(box('a: box "A box with a rather long label on it"', "a")).toMatchObject({ w: 320, h: 70 });
    expect(box('a: box "Three\\nlines\\nhere"', "a")).toMatchObject({ w: 140, h: 107 });
  });

  it("sizes a note's height from its non-fence lines and text size", () => {
    expect(note("n: note\n  one\n  two\n  three", "n").h).toBe(81);
    expect(note("n: note text 22\n  ```ts\n  a\n  b\n  ```", "n").h).toBe(84);
    expect(note("n: note", "n").h).toBe(38);
  });

  it("uses the text's size and width when given", () => {
    expect(box('a: box "A" size 33,44', "a")).toMatchObject({ w: 33, h: 44 });
    expect(note("n: note width 600", "n").w).toBe(600);
  });
});

describe("links (docs/format.md, Boxes)", () => {
  it("reads a box's link, writes it back, and keeps it through a user's edits and an agent's update", () => {
    const first = parseSketch('a: box "Billing" link "k3f9abcd1234"\nb: box "B"');
    expect(boxesByName(first.shapes).get("a")).toMatchObject({ link: "k3f9abcd1234" });
    expect((boxesByName(first.shapes).get("a") as RectShape).w).toBe(CANVAS_MIN_WIDTH);
    expect(box('a: box "Billing"', "a").w).toBeLessThan(CANVAS_MIN_WIDTH);
    expect((boxesByName(first.shapes).get("b") as RectShape).link).toBeUndefined();
    expect(serializeSketch(first.shapes).text).toContain('a: box "Billing" link "k3f9abcd1234" at ');
    // The user moves and relabels the box on the board: the link stays.
    const edited = byUser(first.shapes).map((shape) => (shape.kind === "rect" && shape.name === "a" ? { ...shape, x: 500, label: "Billing v2" } : shape));
    expect(serializeSketch(edited).text).toContain('a: box "Billing v2" link "k3f9abcd1234" at 500,');
    // The agent's update changes the link, or drops it; the position stays.
    const second = parseSketch('a: box "Billing" link "other"\nb: box "B"', undefined, edited);
    expect(boxesByName(second.shapes).get("a")).toMatchObject({ x: 500, link: "other" });
    const third = parseSketch('a: box "Billing"\nb: box "B"', undefined, second.shapes);
    expect((boxesByName(third.shapes).get("a") as RectShape).link).toBeUndefined();
  });

  it("keeps an http(s) url as an external link and drops anything else", () => {
    const href = "https://github.com/acme/app/pull/42/files";
    expect(externalHref(href)).toBe(href);
    expect(portalSketchId(href)).toBeUndefined();
    expect(box(`a: box "The diff" link "${href}"`, "a")).toMatchObject({ link: href, label: "The diff" });
    expect(serializeSketch(parseSketch(`a: box "The diff" link "${href}"`).shapes).text).toContain(`link "${href}"`);
    expect(box('a: box "A" link "http://example.com/a"', "a").link).toBe("http://example.com/a");
    expect(box('a: box "A" link "javascript:alert(1)"', "a").link).toBeUndefined();
    expect(box('a: box "A" link "data:text/html,hi"', "a").link).toBeUndefined();
    expect(box('a: box "A" link "ftp://files.example/a"', "a").link).toBeUndefined();
    expect(box('a: box "A" link "not a url"', "a").link).toBeUndefined();
    // A ttmi sketch url stays a canvas, not an external page.
    expect(externalHref("https://ttmi.ai/s/skdetail")).toBeUndefined();
    expect(externalHref("k3f9abcd1234")).toBeUndefined();
  });

  it("treats a ttmi.ai sketch url as a portal, on the link or as the whole label", () => {
    expect(portalSketchId("skdetail")).toBe("skdetail");
    expect(portalSketchId("https://ttmi.ai/s/skdetail")).toBe("skdetail");
    expect(portalSketchId("https://www.ttmi.ai/s/skdetail/")).toBe("skdetail");
    expect(portalSketchId("https://ttmi.ai/s/skdetail", "localhost")).toBe("skdetail");
    expect(portalSketchId("http://localhost:5173/s/skdetail", "localhost")).toBe("skdetail");
    expect(portalSketchId("https://evil.example/s/skdetail")).toBeUndefined();
    expect(portalSketchId("https://ttmi.ai/s/skdetail/edit")).toBeUndefined();
    expect(portalSketchId("not an id")).toBeUndefined();
    expect(box('a: box "Billing" link "https://ttmi.ai/s/skdetail"', "a")).toMatchObject({ link: "https://ttmi.ai/s/skdetail" });
    expect(box('a: box "https://ttmi.ai/s/skdetail"', "a").label).toBe("https://ttmi.ai/s/skdetail");
  });

  it("round-trips with the tag, in either order", () => {
    const { shapes } = parseSketch('a: box "A" blue tint link "x1" tag "Service"');
    const text = serializeSketch(shapes).text;
    expect(text).toContain('a: box "A" blue tag "Service" link "x1" at ');
    expect(boxesByName(parseSketch(text, undefined, shapes).shapes).get("a")).toMatchObject({ link: "x1", tag: "Service" });
  });
});

describe("groups (docs/format.md, Groups)", () => {
  it("reads a group with its label, colour, tag and members, written before or after them", () => {
    const { groups, shapes } = parseSketch('g: group "Billing" blue tag "Domain" of a, b\na: box "A"\nb: box "B"\nc: box "C"\nh: group of c');
    expect(groups).toEqual([{ name: "g", label: "Billing", color: "blue", tag: "Domain", members: ["a", "b"] }, { name: "h", label: "", color: "white", members: ["c"] }]);
    expect(boxesByName(shapes).size).toBe(3);
  });

  it("takes members separated by spaces or commas, once each", () => {
    expect(parseSketch('a: box "A"\nb: box "B"\ng: group "G" of a b, a').groups[0]!.members).toEqual(["a", "b"]);
  });

  it("lets a step name a group", () => {
    const { steps } = parseSketch('a: box "A"\ng: group "G" of a\nstep: g\n  Hi.');
    expect(steps).toEqual([{ names: ["g"], narration: "Hi." }]);
  });

  it("gives no groups when the text has none", () => {
    expect(parseSketch('a: box "A"').groups).toEqual([]);
  });
});

describe("sizes with a measurer", () => {
  const measure = {
    box: (label: string) => ({ w: 100 + label.length, h: 50 }),
    note: (_html: string, width: number, size: number) => width + size,
    noteWidth: (html: string) => (html.includes("<pre") ? 700 : 0),
    noteFolded: () => undefined,
  };
  // Folds any note with more than one block to a 90 × 28 line
  // (docs/board.md, Notes fold).
  const blocks = (html: string) => (html.match(/<(h\d|p|pre|ul|ol|blockquote)[\s>]/g) ?? []).length;
  const folding = { ...measure, noteFolded: (html: string) => (blocks(html) > 1 ? { w: 90, h: 28 } : undefined) };

  it("takes box and note sizes from it", () => {
    const { shapes } = parseSketch('a: box "ABC"\nn: note\n  text', measure);
    expect(boxesByName(shapes).get("a")).toMatchObject({ w: 103, h: 50 });
    expect(boxesByName(shapes).get("n")).toMatchObject({ w: 420, h: 434 });
  });

  it("never measures a note as tagged: a note's tag is dropped", () => {
    // The measurer would get the tag as a fourth argument, folded or not.
    const tagged = { ...measure, note: (_html: string, _width: number, _size: number, tag?: boolean) => (tag ? 60 : 40), noteFolded: (html: string, _width: number, _size: number, tag?: string) => (blocks(html) > 1 ? { w: 90, h: tag ? 39 : 28 } : undefined) };
    const { shapes } = parseSketch('a: note tag "Data"\n  text\nb: note\n  text\nc: note tag "Data"\n  ## C\n  more\nd: note\n  ## D\n  more', tagged);
    const by = boxesByName(shapes);
    expect(by.get("a")!.h).toBe(40);
    expect(by.get("b")!.h).toBe(40);
    expect(by.get("c")!.h).toBe(28);
    expect(by.get("d")!.h).toBe(28);
  });

  it("widens a note to fit its code, up to 960", () => {
    const { shapes } = parseSketch("n: note width 400\n  ```ts\n  x\n  ```", measure);
    expect(boxesByName(shapes).get("n")!.w).toBe(700);
    const wide = parseSketch("n: note\n  ```ts\n  x\n  ```", { ...measure, noteWidth: () => 5000 });
    expect(boxesByName(wide.shapes).get("n")!.w).toBe(960);
  });

  it("keeps a given box size over the measured one", () => {
    const { shapes } = parseSketch('a: box "ABC" size 20,30', measure);
    expect(boxesByName(shapes).get("a")).toMatchObject({ w: 20, h: 30 });
  });

  it("keeps the asked width as the note's minimum, and writes it back", () => {
    const { shapes } = parseSketch("n: note width 400\n  ```ts\n  x\n  ```\nm: note\n  text", measure);
    expect(boxesByName(shapes).get("n")).toMatchObject({ w: 700, minWidth: 400 });
    expect(boxesByName(shapes).get("m")).toMatchObject({ w: 420, minWidth: 420 });
    const text = serializeSketch(shapes).text;
    expect(text).toContain("n: note at 40,40 width 400");
    expect(text).toMatch(/^m: note at \d+,\d+ width 420$/m);
  });

  it("folds a note with more than one block to the measured line, never one with one block", () => {
    const { shapes } = parseSketch("n: note width 500\n  ## Title\n  ```ts\n  x\n  ```\nm: note\n  ```ts\n  x\n  ```", folding);
    expect(boxesByName(shapes).get("n")).toMatchObject({ w: 90, h: 28, minWidth: 500 });
    expect(boxesByName(shapes).get("m")).toMatchObject({ w: 700, h: 714, minWidth: 420 });
    expect(serializeSketch(shapes).text).toContain("n: note at 40,40 width 500");
  });

  it("on an update keeps the board's width as the minimum and folds the new content", () => {
    const { shapes: before } = parseSketch("n: note width 500\n  ## Title\n  ```ts\n  x\n  ```", folding);
    const old = boxesByName(before).get("n")!;
    const { shapes } = parseSketch("n: note width 300\n  ## New title\n  more", folding, before);
    expect(boxesByName(shapes).get("n")).toMatchObject({ id: old.id, x: old.x, y: old.y, w: 90, h: 28, minWidth: 500 });
    // A note saved before minWidth existed: its width stands in.
    const legacy = { ...old, minWidth: undefined, w: 578 };
    const { shapes: kept } = parseSketch("n: note\n  ```ts\n  x\n  ```", folding, [legacy]);
    expect(boxesByName(kept).get("n")).toMatchObject({ w: 700, minWidth: 578 });
  });
});
