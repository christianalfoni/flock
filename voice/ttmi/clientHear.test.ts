// Making a step ahead of Play is urgent, so the first frames are ready when
// the reader starts. Urgent on its own must not arm the speakers: that
// played the walkthrough by itself the moment the voice finished loading.
import { describe, expect, test, vi } from "vitest";

vi.hoisted(() => {
  vi.stubGlobal("location", { origin: "http://localhost:5173" });
  vi.stubGlobal("window", { ttmiVoiceAsked: [] as { sketch: string; urgent: boolean; at: number }[] });
});

vi.mock("./stream", () => ({
  armStream: vi.fn(),
  completeStream: vi.fn(),
  pushStream: vi.fn(),
}));

import { armStream } from "./stream";
import { voice } from "./client";
import { speak } from "./sound";

const step = { segments: [{ text: "Jobs wait in the queue." }] };
const asked = () => window.ttmiVoiceAsked ?? [];

async function untilAsked(before: number) {
  for (let i = 0; i < 100; i++) {
    if (asked().length > before) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`clip was not asked for (${asked().length} recorded)`);
}

describe("a clip asked for before Play", () => {
  test("is made without arming playback", async () => {
    vi.mocked(armStream).mockClear();
    const before = asked().length;
    const pending = voice().clip(step, "miles", true, "sketch", 0, false);
    await untilAsked(before);
    expect(armStream).not.toHaveBeenCalled();
    expect(asked().at(-1)).toMatchObject({ sketch: "sketch", urgent: true });
    void pending;
  });

  test("is heard when the walkthrough starts", async () => {
    vi.mocked(armStream).mockClear();
    const before = asked().length;
    const pending = voice().clip(step, "miles", true, "sketch", undefined, true);
    await untilAsked(before);
    expect(armStream).toHaveBeenCalledTimes(1);
    void pending;
  });

  test("a nested canvas preloaded beside the sketch is not heard", async () => {
    vi.mocked(armStream).mockClear();
    const before = asked().length;
    const pending = voice().clip({ segments: [{ text: "Inside the canvas." }] }, "miles", false, "child", 2);
    await untilAsked(before);
    expect(armStream).not.toHaveBeenCalled();
    expect(asked().at(-1)).toMatchObject({ sketch: "child", urgent: false });
    void pending;
  });

  test("saying a sentence on the Voice page is heard", async () => {
    vi.mocked(armStream).mockClear();
    const before = asked().length;
    const pending = speak([{ text: "Hello from the studio." }], { name: "miles", speed: 1, mix: 0 });
    await untilAsked(before);
    expect(armStream).toHaveBeenCalledTimes(1);
    void pending;
  });
});
