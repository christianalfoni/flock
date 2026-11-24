import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import type { Plugin } from "vite";
import react from "@vitejs/plugin-react";

const here = dirname(fileURLToPath(import.meta.url));
// TTMI's voice, used in place from the TTMI checkout beside this one.
const TTMI_VOICE = resolve(here, "../ttmi/apps/web/src/voice");
const STUBS = resolve(here, "src/renderer/ttmiVoiceStubs.ts");

// The voice's imports from its own web app go to Flock's stand-ins
// (src/renderer/ttmiVoiceStubs.ts), and the packages it uses (React,
// phonon-webgpu, TTMI's own) resolve from Flock, as if it were Flock's.
function ttmiVoice(): Plugin {
  const stubbed = new Set(["../analytics", "../firebase", "../build", "./phonon/runtime"]);
  return {
    name: "flock-ttmi-voice",
    enforce: "pre",
    async resolveId(source, importer, options) {
      if (!importer || !importer.startsWith(TTMI_VOICE)) return null;
      if (stubbed.has(source)) return STUBS;
      if (source.startsWith(".") || source.startsWith("/") || source.startsWith("\0")) return null;
      return this.resolve(source, resolve(here, "src/renderer/index.html"), { ...options, skipSelf: true });
    },
  };
}

export default defineConfig({
  main: {
    // TTMI's packages are TypeScript as written: bundled, not loaded at run time.
    plugins: [externalizeDepsPlugin({ exclude: ["@ttmi/format"] })],
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
  },
  renderer: {
    plugins: [ttmiVoice(), react(), tailwindcss()],
    // TTMI's board (linked from the TTMI checkout) uses the app's React;
    // "ttmi-voice" is TTMI's voice (voice/ttmiVoice.ts).
    resolve: { dedupe: ["react", "react-dom"], alias: { "ttmi-voice": resolve(here, "voice/ttmiVoice.ts"), "ttmi-voices": resolve(here, "voice/ttmiVoices.ts") } },
    // The voice's engine runs in a shared worker, an ES module.
    worker: { format: "es", plugins: () => [ttmiVoice()] },
    optimizeDeps: { exclude: ["phonon-webgpu"] },
    // Under the dev server, TTMI's voice worker is fetched from the TTMI
    // checkout, outside this folder: allowed, or it is refused (403) and the
    // voice never starts.
    server: { fs: { allow: [here, resolve(here, "../ttmi")] } },
  },
});
