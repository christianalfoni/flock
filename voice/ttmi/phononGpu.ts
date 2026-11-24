// blixt/phonon loads a WebAssembly SIMD CPU tier when `Phonon.load` is
// left on "auto" and the browser gives no WebGPU adapter. This app never
// does that: walkthroughs without a GPU show their words. The CPU files
// are a dynamic import inside the published bundle (`dist/cpu`, two wasm
// modules and a worker). Cutting that import out means a build does not
// emit them.

/** The only backend `Phonon.load` is asked for. */
export const PHONON_BACKEND = "webgpu" as const;

const CPU_IMPORT = /await import\(\s*["'](?:\.\/cpu\/[^"']+|\.\/remote)["']\s*\)/g;
// After the bundle, the same import is a chunk: import(`./remote-<hash>.js`).
const CPU_CHUNK = /await import\(\s*[`'"]\.\/(?:cpu\/)?remote-[^`'"]+[`'"]\s*\)/g;

// The published bundle's `startCpu` is the only caller. Replacing the
// import removes the chunk, the worker and both wasm modules from the graph.
const CPU_DISABLED = 'await Promise.reject(new Error("The CPU voice is not included."))';

export function stripPhononCpuImport(code: string): string {
  return code.replace(CPU_IMPORT, CPU_DISABLED);
}

// The emitted worker chunk, where the import has been rewritten to its file name.
export function stripPhononCpuChunk(code: string): string {
  return code.replace(CPU_CHUNK, CPU_DISABLED);
}

// A specifier the CPU tier uses: the dynamic chunk, its worker, or a wasm module.
export function isPhononCpuSpecifier(source: string): boolean {
  return /(?:^|\/)(?:cpu\/|phonon-cpu)|(?:^|\/)remote(?:\.js|\.ts)?$|^\.\/remote$/.test(source);
}
