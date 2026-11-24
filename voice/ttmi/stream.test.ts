// The start of a step used to drop out. A cached clip shares the hardware
// with a context opened on the same press, and a stream meets the next
// frame at a raw buffer boundary. Neither may open a hole, and frames
// buffered ahead of Play must stay silent.
import { afterEach, describe, expect, test, vi } from "vitest";
import { armStream, completeStream, mediaTime, pushStream, setStreamRate, stopStream, streamFraction, streamOwnsClock, unlockStream, warmStream } from "./stream";

type Source = { started: number[]; connected?: unknown; ended: null | (() => void) };

let latest: { state: AudioContextState; destination: object; currentTime: number; resume: () => Promise<void> } | undefined;
let constructed = 0;
const sources: Source[] = [];

class FakeAudioContext {
  state: AudioContextState = "suspended";
  currentTime = 5;
  destination = {};
  constructor() {
    constructed += 1;
    latest = this;
  }
  resume() {
    this.state = "running";
    return Promise.resolve();
  }
  suspend() {
    this.state = "suspended";
    return Promise.resolve();
  }
  createBuffer(_channels: number, length: number) {
    return { getChannelData: () => new Float32Array(length) };
  }
  createBufferSource() {
    const source: Source = { started: [], ended: null };
    const node = {
      playbackRate: { value: 1 },
      get onended() { return source.ended; },
      set onended(handler: null | (() => void)) { source.ended = handler; },
      buffer: null as unknown,
      connect: (dest: unknown) => { source.connected = dest; },
      stop: () => {},
      start: (when: number) => source.started.push(when),
    };
    sources.push(source);
    return node;
  }
}

vi.stubGlobal("window", {});
vi.stubGlobal("AudioContext", FakeAudioContext);

const frame = () => {
  const samples = new Float32Array(1920);
  samples.fill(0.2);
  return samples;
};
const dur = 1920 / 24000;

describe("streamed playback", () => {
  afterEach(() => {
    stopStream();
    completeStream("step", 1, []);
    sources.length = 0;
    if (latest) latest.state = "suspended";
    setStreamRate(1);
  });

  test("a click does not open a context", () => {
    unlockStream();
    expect(constructed).toBe(0);
    expect(sources).toEqual([]);
  });

  test("frames that arrive before Play are not heard, and a click does not start them", async () => {
    pushStream("step", frame(), 24000, []);
    unlockStream();
    warmStream();
    await Promise.resolve();
    expect(sources).toEqual([]);
    armStream("step");
    await Promise.resolve();
    expect(sources).toHaveLength(1);
    expect(sources[0]?.started[0]).toBeCloseTo(5.04, 5);
    expect(sources[0]?.connected).toBe(latest?.destination);
  });

  test("the next frame starts where the one before ends", async () => {
    if (latest) latest.state = "running";
    pushStream("step", frame(), 24000, []);
    armStream("step");
    await Promise.resolve();
    pushStream("step", frame(), 24000, []);
    pushStream("step", frame(), 24000, []);
    const [first, second, third] = sources;
    const firstEnd = (first?.started[0] ?? 0) + dur;
    const secondEnd = (second?.started[0] ?? 0) + dur;
    expect(second?.started[0] ?? 0).toBeCloseTo(firstEnd, 5);
    expect(third?.started[0] ?? 0).toBeCloseTo(secondEnd, 5);
    if (latest && second?.started[0] !== undefined) latest.currentTime = second.started[0];
    expect(mediaTime()).toBeCloseTo(dur, 5);
  });

  test("a slower playback stretches the audio and the clock stays on the original samples", async () => {
    setStreamRate(0.8);
    if (latest) latest.state = "running";
    const samples = new Float32Array(Math.round(24000 * 0.25));
    samples.fill(0.2);
    pushStream("slow", samples, 24000, []);
    armStream("slow");
    await Promise.resolve();
    expect(sources).toHaveLength(1);
    const start = sources[0]?.started[0] ?? 0;
    if (latest) latest.currentTime = start + 0.3125 / 2;
    expect(mediaTime()).toBeCloseTo(0.125, 2);
  });

  test("arming while the context is still suspended waits, and still plays once", async () => {
    pushStream("step", frame(), 24000, []);
    armStream("step");
    expect(sources).toEqual([]);
    unlockStream();
    armStream("step");
    await Promise.resolve();
    expect(sources).toHaveLength(1);
  });

  test("a clock that jumps after a stall does not finish the clip", async () => {
    if (latest) {
      latest.state = "running";
      latest.currentTime = 10;
    }
    const samples = new Float32Array(24000);
    samples.fill(0.2);
    pushStream("next", samples, 24000, []);
    armStream("next");
    await Promise.resolve();
    const first = sources[0]?.started[0] ?? 0;
    expect(first).toBeGreaterThan(10);
    expect(streamFraction() ?? 1).toBeLessThan(0.1);
    if (latest) latest.currentTime += 30;
    // The device slept through the quiet after the previous audio and
    // caught up when this clip was scheduled. The step is still at the start.
    expect(streamFraction() ?? 1).toBeLessThan(0.2);
    expect(streamOwnsClock()).toBe(true);
    expect(sources.at(-1)?.started[0] ?? 0).toBeGreaterThan(first + 20);
  });

  test("an end event that arrives before the buffer could have played does not finish the clip", async () => {
    if (latest) {
      latest.state = "running";
      latest.currentTime = 10;
    }
    const samples = new Float32Array(24000);
    samples.fill(0.2);
    pushStream("next", samples, 24000, []);
    armStream("next");
    await Promise.resolve();
    // The clip is finished as far as the worker is concerned, but the
    // source's end event is the device discarding a start time that was
    // already in the past. Nothing has been heard.
    completeStream("next", 1, []);
    const skipped = sources[0];
    skipped?.ended?.();
    expect(streamOwnsClock()).toBe(true);
    expect(streamFraction() ?? 1).toBeLessThan(0.2);
    expect(sources.length).toBeGreaterThan(1);
  });

  test("stopping a stream leaves a suspended device suspended", () => {
    if (!latest) return;
    latest.state = "suspended";
    stopStream();
    expect(latest.state).toBe("suspended");
  });

  test("a stream that has already been said does not wake the device on the next key", async () => {
    if (latest) {
      latest.state = "running";
      latest.currentTime = 10;
    }
    const samples = new Float32Array(24000);
    samples.fill(0.2);
    pushStream("spent", samples, 24000, []);
    armStream("spent");
    await Promise.resolve();
    const wall = performance.now();
    const clock = vi.spyOn(performance, "now").mockImplementation(() => wall + 1000);
    try {
      if (latest) latest.currentTime = (sources[0]?.started[0] ?? 0) + 1;
      expect(streamFraction()).toBe(1);
      expect(streamOwnsClock()).toBe(true);
      if (!latest) return;
      latest.state = "suspended";
      let resumes = 0;
      const resume = latest.resume.bind(latest);
      latest.resume = () => {
        resumes += 1;
        return resume();
      };
      unlockStream();
      expect(resumes).toBe(0);
      expect(latest.state).toBe("suspended");
    } finally {
      clock.mockRestore();
    }
  });

  test("a finished stream does not wake a suspended device on the next key", async () => {
    if (latest) {
      latest.state = "running";
      latest.currentTime = 10;
    }
    pushStream("spent", frame(), 24000, []);
    armStream("spent");
    await Promise.resolve();
    completeStream("spent", dur, []);
    const wall = performance.now();
    const clock = vi.spyOn(performance, "now").mockImplementation(() => wall + 1000);
    try {
      if (latest) latest.currentTime = (sources[0]?.started[0] ?? 0) + dur;
      sources[0]?.ended?.();
      expect(streamOwnsClock()).toBe(false);
      if (!latest) return;
      latest.state = "suspended";
      let resumes = 0;
      const resume = latest.resume.bind(latest);
      latest.resume = () => {
        resumes += 1;
        return resume();
      };
      unlockStream();
      expect(resumes).toBe(0);
      expect(latest.state).toBe("suspended");
    } finally {
      clock.mockRestore();
    }
  });
});
