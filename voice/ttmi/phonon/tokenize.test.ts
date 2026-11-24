import { describe, expect, test } from "vitest";
import fixture from "./tokenize.fixture.json";
import model from "./tokenizer.json";
import { encode, normalize } from "./tokenize";
import type { TokenizerModel } from "./tokenize";

const tokenizer = model as unknown as TokenizerModel;

describe("Phonon tokenizer", () => {
  test("matches the checkpoint's tokenizer on the lab sentences", () => {
    for (const sample of fixture) {
      expect(normalize(tokenizer, sample.text)).toBe(sample.norm);
      expect(encode(tokenizer, sample.text)).toEqual({ ids: sample.ids, tokens: sample.tokens });
    }
  });
});
