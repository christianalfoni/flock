// Every error message in docs/format.md (Errors), with its line number.
import { describe, expect, it } from "vitest";
import { parseSketch, SketchFormatError } from "../src/index";

const cases: [string, string, string][] = [
  ["direction", "direction: left", 'Line 1: direction is "right" or "down", not "left".'],
  ["a reused name", 'a: box "A"\na: box "B"', 'Line 2: "a" is already used; every shape needs its own name.'],
  ["a reused name across kinds", 'a: box "A"\na: note', 'Line 2: "a" is already used; every shape needs its own name.'],
  ["a bad position", 'a: box "A" at foo', 'Line 1: expected a position after "at" as two numbers like 40,60, got "foo".'],
  ["a missing position", 'a: box "A" at', 'Line 1: expected a position after "at" as two numbers like 40,60, got "".'],
  ["a bad size", 'a: box "A" size 10', 'Line 1: expected a size after "size" as two numbers like 40,60, got "10".'],
  ["a bad width", "a: note width wide", 'Line 1: expected a number after "width".'],
  ["a missing width", "a: note width", 'Line 1: expected a number after "width".'],
  ["a bad text size", "a: note text big", 'Line 1: expected a number after "text".'],
  ["a bad bend", 'a: box "A"\nb: box "B"\na -> b bend lots', 'Line 3: expected a number after "bend".'],
  ["a missing bend", 'a: box "A"\nb: box "B"\na -> b bend', 'Line 3: expected a number after "bend".'],
  ["a bad seq", 'a: box "A"\nb: box "B"\na -> b seq first', 'Line 3: expected a number like 2 or 2a after "seq".'],
  ["a missing seq", 'a: box "A"\nb: box "B"\na -> b seq', 'Line 3: expected a number like 2 or 2a after "seq".'],
  ["a seq of zero", 'a: box "A"\nb: box "B"\na -> b seq 0', 'Line 3: expected a number like 2 or 2a after "seq".'],
  ["an unquoted tag", 'a: box "A" tag Service', 'Line 1: expected the tag in quotes after "tag", like tag "Service".'],
  ["a missing tag", 'a: box "A" tag', 'Line 1: expected the tag in quotes after "tag", like tag "Service".'],
  ["a word a box does not take", 'a: box "A" dashed', 'Line 1: "dashed" is not something a box takes.'],
  ["a fill on a note", "a: note solid", 'Line 1: "solid" is not something a note takes.'],
  ["a label on a note", 'a: note "hello"', 'Line 1: "hello" is not something a note takes.'],
  ["a size on a note", "a: note size 10,10", 'Line 1: "size" is not something a note takes.'],
  ["a width on a box", 'a: box "A" width 10', 'Line 1: "width" is not something a box takes.'],
  ["a word an arrow does not take", 'a: box "A"\nb: box "B"\na -> b dashed', 'Line 3: "dashed" is not something an arrow takes.'],
  ["an arrow with no start", 'a: box "A"\n-> a', 'Line 2: the arrow\'s start should be a shape\'s name or a point like 40,60, not "".'],
  ["an arrow with a bad start", 'a: box "A"\n1,2,3 -> a', 'Line 2: the arrow\'s start should be a shape\'s name or a point like 40,60, not "1,2,3".'],
  ["an arrow with no end", 'a: box "A"\na ->', 'Line 2: the arrow\'s end should be a shape\'s name or a point like 40,60, not "".'],
  ["an arrow with a bad end", 'a: box "A"\na -> b!', 'Line 2: the arrow\'s end should be a shape\'s name or a point like 40,60, not "b!".'],
  ["an arrow with a quoted end, which is read as a name", 'a: box "A"\na -> "b"', 'Line 2: no shape is called "b".'],
  ["an arrow to an unknown shape", 'a: box "x"\na -> nowhere', 'Line 2: no shape is called "nowhere".'],
  ["an arrow from an unknown shape", 'a: box "x"\nnowhere -> a', 'Line 2: no shape is called "nowhere".'],
  ["a step naming an unknown shape", 'a: box "A"\nstep: a b\n  Hi.', 'Line 2: no shape is called "b".'],
  ["a step with something that is not a name", 'a: box "A"\nstep: a 1x', 'Line 2: a step lists shape names and hops (#2), and "1x" is neither.'],
  ["a line that is nothing", "hello world", 'Line 1: could not read "hello world". Expected a shape (name: box …), a note, a group (name: group "Label" of a b), an arrow (a -> b), a step (step: a b), an overview or summary (overview:), or a term (term "Word" "what it means").'],
  ["an unknown shape kind", 'a: circle "A"', 'Line 1: could not read "a: circle "A"". Expected a shape (name: box …), a note, a group (name: group "Label" of a b), an arrow (a -> b), a step (step: a b), an overview or summary (overview:), or a term (term "Word" "what it means").'],
  ["a bad name", '1a: box "A"', 'Line 1: could not read "1a: box "A"". Expected a shape (name: box …), a note, a group (name: group "Label" of a b), an arrow (a -> b), a step (step: a b), an overview or summary (overview:), or a term (term "Word" "what it means").'],
  // Links (docs/format.md, Boxes).
  ["an unquoted link", 'a: box "A" link k3f9', 'Line 1: expected a sketch id or an http(s) url in quotes after "link", like link "k3f9".'],
  ["a missing link", 'a: box "A" link', 'Line 1: expected a sketch id or an http(s) url in quotes after "link", like link "k3f9".'],
  ["a link on a note", 'a: note link "x"', 'Line 1: "link" is not something a note takes.'],
  // Groups (docs/format.md, Groups).
  ["a group member that does not exist", 'a: box "A"\ng: group "G" of a, b', 'Line 2: no shape is called "b".'],
  ["a shape in two groups", 'a: box "A"\ng: group "G" of a\nh: group "H" of a', 'Line 3: "a" is already in group "g"; a shape is in one group at most.'],
  ["a nested group", 'a: box "A"\ng: group "G" of a\nh: group "H" of g', 'Line 3: "g" is a group; groups do not nest.'],
  ["a group without members", 'a: box "A"\ng: group "G"', 'Line 2: a group lists its members after "of", like of a, b.'],
  ["a group with of and nothing after it", 'a: box "A"\ng: group "G" of', 'Line 2: a group lists its members after "of", like of a, b.'],
  ["a group with a member that is not a name", 'a: box "A"\ng: group "G" of 1x', 'Line 2: a group lists shape names after "of", and "1x" is not one.'],
  ["a word a group does not take", 'a: box "A"\ng: group "G" solid of a', 'Line 2: "solid" is not something a group takes.'],
  ["an unquoted tag on a group", 'a: box "A"\ng: group "G" tag Domain of a', 'Line 2: expected the tag in quotes after "tag", like tag "Service".'],
  ["a group named like a shape", 'a: box "A"\na: group "G" of a', 'Line 2: "a" is already used; every shape needs its own name.'],
  ["a shape named like a group", 'g: group "G" of a\ng: box "A"', 'Line 2: "g" is already used; every shape needs its own name.'],
];

describe("errors", () => {
  for (const [what, source, message] of cases) {
    it(`reports ${what}`, () => {
      expect(() => parseSketch(source)).toThrow(SketchFormatError);
      expect(() => parseSketch(source)).toThrow(message);
    });
  }

  it("count lines after a stripped fence", () => {
    expect(() => parseSketch("````sketch\n# sketch T\n\nbad line\n````")).toThrow("Line 3: could not read");
  });

  it("report the first problem only", () => {
    expect(() => parseSketch("direction: up\nalso bad")).toThrow("Line 1:");
  });

  it("count a note's body lines", () => {
    expect(() => parseSketch("n: note\n  one\n  two\nbad")).toThrow("Line 4:");
  });

  it("are checked after the whole text is read, for arrows and steps", () => {
    // The unknown name on line 2 is reported, not the later unreadable line,
    // only once the text has been read in full.
    expect(() => parseSketch('a: box "A"\na -> b\nnonsense')).toThrow("Line 3: could not read");
  });
});
