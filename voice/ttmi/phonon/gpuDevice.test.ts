import { describe, expect, test } from "vitest";
import { shouldRememberFailure } from "../mark";
import { watchWebGpuDevice } from "./gpuDevice";

describe("watching the WebGPU device", () => {
  test("a device object, not a promise, does not throw, and a loss is heard", async () => {
    let lost: (info: { message?: string }) => void = () => {};
    const device = {
      lost: new Promise<{ message?: string }>((resolve) => {
        lost = resolve;
      }),
    };
    const heard: string[] = [];
    expect(() => watchWebGpuDevice(() => device, (message) => heard.push(message))).not.toThrow();
    expect(device).not.toHaveProperty("then");
    lost({ message: "device lost" });
    await device.lost;
    expect(heard).toEqual(["device lost"]);
  });

  test("a promise of a device is followed too", async () => {
    let lost: (info: { message?: string }) => void = () => {};
    const pending = new Promise<{ message?: string }>((resolve) => {
      lost = resolve;
    });
    const heard: string[] = [];
    watchWebGpuDevice(() => Promise.resolve({ lost: pending }), (message) => heard.push(message));
    await Promise.resolve();
    lost({});
    await pending;
    expect(heard).toEqual(["lost"]);
  });

  test("reading the device, or a device that rejects, never throws", () => {
    expect(() => watchWebGpuDevice(() => {
      throw new TypeError("this.ort.env.webgpu?.device?.then is not a function");
    }, () => {})).not.toThrow();
    const device = { lost: Promise.reject(new Error("gone")) };
    expect(() => watchWebGpuDevice(() => device, () => {})).not.toThrow();
    expect(() => watchWebGpuDevice(() => undefined, () => {})).not.toThrow();
  });
});

describe("this install failure is not remembered", () => {
  const reason = "this.ort.env.webgpu?.device?.then is not a function";

  test("Try again and the next visit are not blocked by the unsupported mark", () => {
    expect(shouldRememberFailure("installing", { state: "unsupported", device: "webgpu", reason })).toBe(false);
    expect(shouldRememberFailure("loading", { state: "unsupported", reason })).toBe(false);
    expect(shouldRememberFailure("installing", { state: "unsupported", device: "wasm", reason })).toBe(false);
  });
});
