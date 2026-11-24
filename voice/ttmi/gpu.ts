// Whether this browser can run the voice. blixt/phonon needs a real GPU.
// A missing adapter, or a software one (SwiftShader, lavapipe), is the
// same outcome: the walkthrough shows its words, and the Voice page says
// why. The revision is in the sentence so a report says which build it was.
import { ENGINE_REV } from "./phonon/revision";

export const VOICE_GPU_REASON = `Voice needs a GPU-capable browser (voice ${ENGINE_REV}).`;

type AdapterInfo = { vendor?: string; architecture?: string; description?: string; isFallbackAdapter?: boolean };
type Adapter = { info?: AdapterInfo; requestDevice?: () => Promise<unknown> };

const SOFTWARE = /swiftshader|llvmpipe|softpipe|lavapipe|microsoft basic|software/i;

export async function realGpu(): Promise<{ ok: true; label: string } | { ok: false; reason: string }> {
  const gpu = (navigator as Navigator & { gpu?: { requestAdapter: (options?: { powerPreference?: string }) => Promise<Adapter | null> } }).gpu;
  if (!gpu?.requestAdapter) return { ok: false, reason: VOICE_GPU_REASON };
  const adapter = await gpu.requestAdapter({ powerPreference: "high-performance" }).catch(() => null);
  if (!adapter) return { ok: false, reason: VOICE_GPU_REASON };
  const info = adapter.info ?? {};
  const label = [info.vendor, info.architecture, info.description].filter(Boolean).join(" ");
  if (info.isFallbackAdapter || SOFTWARE.test(label)) return { ok: false, reason: VOICE_GPU_REASON };
  return { ok: true, label: label || "gpu" };
}
