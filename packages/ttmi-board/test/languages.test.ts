// The languages a save may name (LANGUAGES in @ttmi/format) are the ones
// the board highlights: lowlight's common set, by name and alias.
import { LANGUAGES } from "@ttmi/format";
import { common, createLowlight } from "lowlight";
import { describe, expect, it } from "vitest";

describe("LANGUAGES", () => {
  const lowlight = createLowlight(common);

  it("names only languages the board highlights", () => {
    expect(LANGUAGES.filter((name) => !lowlight.registered(name))).toEqual([]);
  });

  it("names every language the board highlights", () => {
    expect(lowlight.listLanguages().filter((name) => !LANGUAGES.includes(name))).toEqual([]);
  });
});
