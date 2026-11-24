// People who already had the voice installed (phonon-tts, or the ONNX
// weights before it) find it gone: the new voice is a different cache.
// The notice is for them only. A browser that never installed a voice
// stays quiet. Dismissing is this device's, and the old weights are
// deleted so they stop taking space.

export const PREVIOUS_VOICE_CACHES = ["phonon-tts-v1", "phonon-model"] as const;
export const NEW_VOICE_CACHE = "phonon-webgpu";
const NEW_WEIGHT = "int8.bin";

// Written once leftovers are found, so the notice survives deleting them.
export const HAD_PREVIOUS_VOICE = "ttmi.voice.hadPrevious";
export const DISMISS_VOICE_UPGRADE = "ttmi.voice.upgrade.dismissed";
export const DISMISS_VOICE_GPU = "ttmi.voice.gpuNote.dismissed";

export type VoiceUpgradeKind = "upgrade" | "gpu-note" | "none";

export type VoiceStorageEntry = { key: string; value: string | null };

export type VoiceLeftovers = {
  cacheNames: string[];
  databaseNames: string[];
  storage: VoiceStorageEntry[];
  newInstalled: boolean;
  realGpu: boolean;
};

const DISMISS_KEYS = new Set([DISMISS_VOICE_UPGRADE, DISMISS_VOICE_GPU]);

// IndexedDB names the old runtimes may have opened. phonon-tts itself
// keeps the weights in Cache Storage; a leftover database with one of
// these names is still the old model.
export function isPreviousVoiceDatabase(name: string): boolean {
  return /^(phonon-tts|phonon-model|onnxruntime)/i.test(name);
}

export function isPreviousVoiceCache(name: string): boolean {
  return (PREVIOUS_VOICE_CACHES as readonly string[]).includes(name);
}

// An install flag, or a versioned record of the old engine (the
// unsupported latch names `phonon-ort-1.31`). Dismiss keys are not a
// previous install.
export function isPreviousVoiceStorage(key: string, value: string | null): boolean {
  if (DISMISS_KEYS.has(key)) return false;
  if (key === HAD_PREVIOUS_VOICE) return value === "1";
  if (/phonon-tts|phonon-model|voice\.installed/i.test(key)) return true;
  if (!value) return false;
  return /phonon-tts-v1|phonon-model|phonon-ort-1\.31|model\.q8\.gguf/.test(value);
}

export function hadPreviousVoice(found: Pick<VoiceLeftovers, "cacheNames" | "databaseNames" | "storage">): boolean {
  if (found.cacheNames.some(isPreviousVoiceCache)) return true;
  if (found.databaseNames.some(isPreviousVoiceDatabase)) return true;
  return found.storage.some((entry) => isPreviousVoiceStorage(entry.key, entry.value));
}

export function voiceUpgradeNotice(input: {
  hadPrevious: boolean;
  newInstalled: boolean;
  realGpu: boolean;
  dismissedUpgrade: boolean;
  dismissedGpuNote: boolean;
}): VoiceUpgradeKind {
  if (!input.hadPrevious || input.newInstalled) return "none";
  if (input.realGpu) return input.dismissedUpgrade ? "none" : "upgrade";
  return input.dismissedGpuNote ? "none" : "gpu-note";
}

export function planVoiceUpgrade(found: VoiceLeftovers, dismissed: { upgrade: boolean; gpu: boolean }) {
  const hadPrevious = hadPreviousVoice(found);
  return {
    notice: voiceUpgradeNotice({
      hadPrevious,
      newInstalled: found.newInstalled,
      realGpu: found.realGpu,
      dismissedUpgrade: dismissed.upgrade,
      dismissedGpuNote: dismissed.gpu,
    }),
    deleteCaches: found.cacheNames.filter(isPreviousVoiceCache),
    deleteDatabases: found.databaseNames.filter(isPreviousVoiceDatabase),
    remember: hadPrevious && !found.newInstalled,
    forgetRemembered: found.newInstalled,
  };
}

type UpgradeSnapshot = { kind: VoiceUpgradeKind | "checking"; installing: boolean };

let snapshot: UpgradeSnapshot = { kind: "checking", installing: false };
const listeners = new Set<() => void>();
let probing = false;
let sketchWalkthrough = false;
const surfaceListeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

export function subscribeVoiceUpgrade(listener: () => void) {
  listeners.add(listener);
  void probeVoiceUpgrade();
  return () => listeners.delete(listener);
}

export function getVoiceUpgrade(): UpgradeSnapshot {
  return snapshot;
}

export function setSketchWalkthrough(on: boolean) {
  if (sketchWalkthrough === on) return;
  sketchWalkthrough = on;
  for (const listener of surfaceListeners) listener();
}

export function sketchHasWalkthrough(): boolean {
  return sketchWalkthrough;
}

export function subscribeSketchWalkthrough(listener: () => void) {
  surfaceListeners.add(listener);
  return () => surfaceListeners.delete(listener);
}

export function startVoiceUpgradeInstall() {
  snapshot = { ...snapshot, installing: true };
  emit();
}

export function finishVoiceUpgradeInstall() {
  try {
    localStorage.removeItem(HAD_PREVIOUS_VOICE);
  } catch {
    // The notice is already gone for this visit.
  }
  snapshot = { kind: "none", installing: false };
  emit();
}

export function dismissVoiceUpgrade(kind: "upgrade" | "gpu-note") {
  const key = kind === "upgrade" ? DISMISS_VOICE_UPGRADE : DISMISS_VOICE_GPU;
  try {
    localStorage.setItem(key, "1");
  } catch {
    // Nothing to remember it with; it shows again next time.
  }
  snapshot = { kind: "none", installing: false };
  emit();
}

async function databaseNames(): Promise<string[]> {
  const listed = indexedDB.databases;
  if (typeof listed !== "function") return [];
  try {
    const rows = await listed.call(indexedDB);
    return rows.flatMap((row) => (row.name ? [row.name] : []));
  } catch {
    return [];
  }
}

async function storageEntries(): Promise<VoiceStorageEntry[]> {
  try {
    const entries: VoiceStorageEntry[] = [];
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (key) entries.push({ key, value: localStorage.getItem(key) });
    }
    return entries;
  } catch {
    return [];
  }
}

async function weightsInstalled(names: string[]): Promise<boolean> {
  if (!names.includes(NEW_VOICE_CACHE) || typeof caches === "undefined") return false;
  try {
    const cache = await caches.open(NEW_VOICE_CACHE);
    const keys = await cache.keys();
    return keys.some((key) => key.url.includes(NEW_WEIGHT));
  } catch {
    return false;
  }
}

// Reads the leftovers, drops the old weights, and decides the notice.
export async function probeVoiceUpgrade() {
  if (probing || typeof window === "undefined") return;
  if (snapshot.kind !== "checking") return;
  probing = true;
  try {
    const { realGpu } = await import("./gpu");
    const cacheNames = typeof caches === "undefined" ? [] : await caches.keys().catch(() => [] as string[]);
    const [gpu, names, storage] = await Promise.all([
      realGpu().catch(() => ({ ok: false as const })),
      databaseNames(),
      storageEntries(),
    ]);
    const found: VoiceLeftovers = {
      cacheNames,
      databaseNames: names,
      storage,
      newInstalled: await weightsInstalled(cacheNames),
      realGpu: gpu.ok,
    };
    let dismissed = { upgrade: false, gpu: false };
    try {
      // Read again at the end: a dismiss during the probe has to win.
      dismissed = {
        upgrade: localStorage.getItem(DISMISS_VOICE_UPGRADE) === "1",
        gpu: localStorage.getItem(DISMISS_VOICE_GPU) === "1",
      };
    } catch {
      // Unreadable storage: show it, and forget it when the tab closes.
    }
    const plan = planVoiceUpgrade(found, dismissed);
    try {
      if (plan.forgetRemembered) localStorage.removeItem(HAD_PREVIOUS_VOICE);
      else if (plan.remember) localStorage.setItem(HAD_PREVIOUS_VOICE, "1");
    } catch {
      // The decision for this visit still stands.
    }
    await Promise.all(plan.deleteCaches.map((name) => caches.delete(name).catch(() => false)));
    for (const name of plan.deleteDatabases) {
      try {
        indexedDB.deleteDatabase(name);
      } catch {
        // A database still open is freed when its page lets go.
      }
    }
    snapshot = { kind: plan.notice, installing: snapshot.installing };
    emit();
  } catch {
    snapshot = { kind: "none", installing: false };
    emit();
  } finally {
    probing = false;
  }
}
