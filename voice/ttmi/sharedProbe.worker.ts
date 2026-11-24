// A SharedWorker that asks the same GPU question the voice engine asks.
import { realGpu, VOICE_GPU_REASON } from "./gpu";
import type { PhononProbe } from "./sharedProbe";

const scope = self as unknown as { onconnect: (event: { ports: MessagePort[] }) => void };

scope.onconnect = (event) => {
  const port = event.ports[0];
  if (!port) return;
  port.start();
  void run(port);
};

async function run(port: MessagePort) {
  const worker = typeof Worker;
  try {
    const gpu = await realGpu();
    port.postMessage({
      ok: gpu.ok,
      message: gpu.ok ? gpu.label : gpu.reason,
      worker,
    } satisfies PhononProbe);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    port.postMessage({ ok: false, message: message || VOICE_GPU_REASON, worker } satisfies PhononProbe);
  }
}
