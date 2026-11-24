// A step that has already been said can leave its stream owning the clock
// until the end event arrives. Moving on must not treat that leftover as
// the next clip: play() would follow it and finish the new step at once.
import { afterEach, describe, expect, test, vi } from "vitest";

type Source = { started: number[] };

let latest: { state: AudioContextState; destination: object; currentTime: number } | undefined;
const sources: Source[] = [];

class FakeAudioContext {
  state: AudioContextState = "running";
  currentTime = 5;
  destination = {};
  constructor() {
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
    const source: Source = { started: [] };
    sources.push(source);
    return {
      playbackRate: { value: 1 },
      onended: null as null | (() => void),
      buffer: null as unknown,
      connect: () => undefined,
      stop: () => undefined,
      start: (when: number) => source.started.push(when),
    };
  }
}

let audio: FakeAudio | undefined;

class FakeAudio {
  ended = false;
  paused = true;
  currentTime = 0;
  duration = 3;
  volume = 1;
  playbackRate = 1;
  defaultPlaybackRate = 1;
  onended: null | (() => void) = null;
  onerror: null | (() => void) = null;
  private url = "";
  constructor() {
    audio = this;
  }
  get src() {
    return this.url;
  }
  set src(value: string) {
    this.url = value;
    this.ended = false;
    this.currentTime = 0;
  }
  play() {
    this.paused = false;
    return Promise.resolve();
  }
  pause() {
    this.paused = true;
  }
  addEventListener() {}
  setAttribute() {}
}

vi.stubGlobal("window", { addEventListener: () => undefined });
vi.stubGlobal("AudioContext", FakeAudioContext);
vi.stubGlobal("Audio", FakeAudio);

import { play, prime, release, stop } from "./player";
import { armStream, pushStream, stopStream, streamFraction, streamOwnsClock } from "./stream";

const frame = () => {
  const samples = new Float32Array(1920);
  samples.fill(0.2);
  return samples;
};

describe("handing playback to the next step", () => {
  afterEach(() => {
    stop();
    stopStream();
    sources.length = 0;
  });

  test("a stream that has run out is dropped, and the primed clip plays on the element", async () => {
    if (latest) latest.state = "running";
    pushStream("spent", frame(), 24000, []);
    armStream("spent");
    await Promise.resolve();
    const started = sources[0]?.started[0] ?? 0;
    // The clip played out. The wall clock moves with the device clock:
    // a device clock that jumps on its own, with the wall clock left
    // behind, is a stall waking up and is not this case.
    const wall = performance.now();
    const clock = vi.spyOn(performance, "now").mockImplementation(() => wall + 1000);
    try {
      if (latest) latest.currentTime = started + 1;
      expect(streamOwnsClock()).toBe(true);
      expect(streamFraction()).toBe(1);
    } finally {
      clock.mockRestore();
    }

    prime("blob:next-step");
    release();
    expect(streamOwnsClock()).toBe(false);

    let settled = false;
    const pending = play("blob:next-step").then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    // The element is driving this clip: its end handler is set. A leftover
    // stream would have returned before touching it (prime leaves the
    // handler empty).
    expect(audio?.onended).toEqual(expect.any(Function));
    expect(audio?.src).toBe("blob:next-step");
    void pending;
  });

  test("a stream still being said is what the step plays", async () => {
    if (latest) latest.state = "running";
    pushStream("live", frame(), 24000, []);
    armStream("live");
    await Promise.resolve();
    expect(streamFraction() ?? 1).toBeLessThan(1);

    const started = vi.fn();
    const pending = play("blob:this-step", started);
    expect(started).toHaveBeenCalledTimes(1);
    expect(streamOwnsClock()).toBe(true);
    let settled = false;
    void pending.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
  });

  test("a device clock that jumps while the page is quiet does not finish the next step", async () => {
    if (latest) {
      latest.state = "running";
      latest.currentTime = 8;
    }
    const samples = new Float32Array(24000);
    samples.fill(0.2);
    pushStream("next", samples, 24000, []);
    armStream("next");
    await Promise.resolve();
    const first = sources[0]?.started[0] ?? 0;
    if (latest) latest.currentTime += 30;
    let settled = false;
    const pending = play("blob:next-step", () => undefined).then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(streamOwnsClock()).toBe(true);
    expect(streamFraction() ?? 1).toBeLessThan(0.2);
    expect(sources.at(-1)?.started[0] ?? 0).toBeGreaterThan(first + 20);
    void pending;
  });

  test("a primed clip that has not sounded is not already over", async () => {
    prime("blob:next-step");
    if (audio) {
      audio.ended = true;
      audio.currentTime = 0;
    }
    let settled = false;
    const pending = play("blob:next-step").then(() => {
      settled = true;
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(audio?.src).toBe("blob:next-step");
    void pending;
  });

  test("a play the device interrupts is not the step finishing", async () => {
    if (audio) audio.play = () => Promise.reject(new DOMException("The play() request was interrupted by a call to pause().", "AbortError"));
    await expect(play("blob:next-step")).resolves.toBe("blocked");
  });
});
