// Asks the shared voice engine's question from a SharedWorker: is there a
// real GPU? Chrome does not define Worker in that scope. This must not
// throw "Worker is not defined".

export type PhononProbe = { ok: boolean; message: string; worker: string };

export function probePhononShared(): Promise<PhononProbe> {
  const worker = new SharedWorker(new URL("./sharedProbe.worker.ts", import.meta.url), { type: "module", name: "ttmi-phonon-probe" });
  return new Promise((resolve) => {
    const finish = (result: PhononProbe) => {
      window.clearTimeout(timer);
      resolve(result);
    };
    const timer = window.setTimeout(() => finish({ ok: false, message: "timed out", worker: "timeout" }), 25_000);
    worker.port.onmessage = (event: MessageEvent<PhononProbe>) => finish(event.data);
    worker.onerror = () => finish({ ok: false, message: "shared worker failed to start", worker: "error" });
    worker.port.start();
  });
}
