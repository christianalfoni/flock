import { describe, expect, test } from "vitest";
import { speechText } from "./speechText";

describe("speech text", () => {
  test("keeps a hyphen, pauses at an em dash, and gives a bare line a stop", () => {
    expect(speechText("Open the test-run controls.")).toBe("Open the test-run controls.");
    expect(speechText("Send a follow-up when the job finishes.")).toBe("Send a follow-up when the job finishes.");
    expect(speechText("You get a picture instead — one you can play.")).toBe("You get a picture instead, one you can play.");
    expect(speechText("a picture instead -- one you can play")).toBe("a picture instead -- one you can play.");
    expect(speechText("Click a canvas to dive in")).toBe("Click a canvas to dive in.");
  });

  test("says id and ids as I-D, and leaves them inside another word", () => {
    expect(speechText("The same id holds both when ids are unique.")).toBe("The same I-D holds both when I-Ds are unique.");
    expect(speechText("a valid id.")).toBe("a valid I-D.");
  });

  test("writes out the symbols and amounts Gradium's rewriter speaks", () => {
    expect(speechText("user@host and 1+1=2.")).toBe("user at host and 1 plus 1 equals 2.");
    expect(speechText("Pay $12 for 3 items.")).toBe("Pay 12 dollars for 3 items.");
    expect(speechText("1,000 people and 3.5 hours.")).toBe("1 thousand people and 3 point 5 hours.");
    expect(speechText("2 × 3 ≈ 6.")).toBe("2 times 3 approximately 6.");
    expect(speechText("hello (world) and a;b.")).toBe("hello, world, and a, b.");
    expect(speechText("See https://ttmi.ai/docs today.")).toBe("See H-T-T-P-S colon slash slash ttmi dot A-I slash docs today.");
    expect(speechText("See ttmi.ai today.")).toBe("See ttmi dot A-I today.");
  });

  test("leaves TTMI as written", () => {
    expect(speechText("Open TTMI next.")).toBe("Open TTMI next.");
    expect(speechText("Open ttmi next.")).toBe("Open ttmi next.");
  });
});
