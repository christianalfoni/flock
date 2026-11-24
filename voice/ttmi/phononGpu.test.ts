import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { PHONON_BACKEND, isPhononCpuSpecifier, stripPhononCpuChunk, stripPhononCpuImport } from "./phononGpu";

describe("the voice stays on WebGPU", () => {
  test("load asks for the WebGPU backend and never for the CPU tier", () => {
    expect(PHONON_BACKEND).toBe("webgpu");
    const source = readFileSync(new URL("./blixtBackend.ts", import.meta.url), "utf8");
    expect(source).toContain("backend: PHONON_BACKEND");
    expect(source).not.toMatch(/backend:\s*["'](?:auto|cpu)["']/);
    expect(source).not.toMatch(/\bthreads\s*:/);
  });

  test("the published CPU import is cut out of the bundle", () => {
    const published = 'const { CpuEngine } = await import("./cpu/remote-76VW7A46.js");';
    const stripped = stripPhononCpuImport(published);
    expect(stripped).not.toContain("import(");
    expect(stripped).not.toContain("remote-");
    expect(stripped).not.toContain(".wasm");
    expect(stripped).toContain("The CPU voice is not included.");
    expect(stripPhononCpuImport('await import("./remote")')).not.toContain("import(");
    expect(stripPhononCpuImport("await import(\"./gpu\")")).toContain("./gpu");
    const emitted = "let{CpuEngine:r}=await import(`./remote-76VW7A46-qRiAX0KW.js`),i=await r.start(e,t,n);";
    const chunk = stripPhononCpuChunk(emitted);
    expect(chunk).not.toContain("import(");
    expect(chunk).not.toContain("remote-");
    expect(chunk).toContain("The CPU voice is not included.");
  });

  test("CPU specifiers are the chunk, the worker and the wasm modules", () => {
    expect(isPhononCpuSpecifier("./cpu/remote-76VW7A46.js")).toBe(true);
    expect(isPhononCpuSpecifier("./phonon-cpu.js")).toBe(true);
    expect(isPhononCpuSpecifier("./phonon-cpu-relaxed.wasm")).toBe(true);
    expect(isPhononCpuSpecifier("./phonon-cpu-simd.wasm")).toBe(true);
    expect(isPhononCpuSpecifier("./remote")).toBe(true);
    expect(isPhononCpuSpecifier("./cache")).toBe(false);
    expect(isPhononCpuSpecifier("phonon-webgpu")).toBe(false);
  });
});
