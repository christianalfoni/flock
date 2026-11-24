// onnxruntime-web 1.31.1's types say `env.webgpu.device` is a Promise of a
// GPUDevice. The webgpu build assigns the device itself
// (`env.webgpu.device = device` in ort.webgpu.mjs). Calling `.then` on that
// throws "…device?.then is not a function" while the sessions are already
// open, and that throw used to fail the install. Reading the device, or
// hearing that it was lost, must never do that.

type LostInfo = { message?: string };
type Lost = Promise<LostInfo> | LostInfo;
type GpuDeviceLike = { lost?: Lost };
type DeviceSource = GpuDeviceLike | Promise<GpuDeviceLike>;

const isThenable = (value: unknown): value is Promise<unknown> =>
  typeof value === "object" && value !== null && typeof (value as { then?: unknown }).then === "function";

// Listen for the GPU device going away. `read` may return a device, a
// promise of one, or throw. None of those fail the caller.
export function watchWebGpuDevice(read: () => DeviceSource | undefined, onLost: (message: string) => void): void {
  try {
    const current = read();
    const follow = (device: GpuDeviceLike | undefined) => {
      try {
        const lost = device?.lost;
        if (!lost) return;
        if (isThenable(lost)) {
          void lost.then(
            (info) => onLost(info?.message || "lost"),
            () => undefined,
          );
          return;
        }
        onLost(lost.message || "lost");
      } catch {
        // The device went away in a shape we do not understand. The next
        // run still has its own timeout.
      }
    };
    if (isThenable(current)) {
      void current.then(follow, () => undefined);
      return;
    }
    follow(current);
  } catch {
    // Installing the voice does not depend on this watch.
  }
}
