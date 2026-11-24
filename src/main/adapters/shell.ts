// Running the CLIs the way your terminal does. An app opened from the Dock
// gets a bare PATH (no Homebrew, no ~/.local/bin), so the login shell's PATH
// is taken once, at start.
import { execFile, spawn } from "node:child_process";

let loaded: Promise<void> | undefined;

export function loadShellPath(): Promise<void> {
  loaded ??= new Promise((resolve) => {
    if (process.platform === "win32") return resolve();
    const shell = process.env.SHELL || "/bin/zsh";
    execFile(shell, ["-ilc", "printf '__PATH__%s__PATH__' \"$PATH\""], { timeout: 5000 }, (error, stdout) => {
      const found = /__PATH__(.*)__PATH__/.exec(stdout ?? "")?.[1];
      if (!error && found) process.env.PATH = [...new Set([...found.split(":"), ...(process.env.PATH ?? "").split(":")])].filter(Boolean).join(":");
      resolve();
    });
  });
  return loaded;
}

// A command's output, or undefined when it fails or is not there.
export function run(command: string, args: string[], options: { cwd?: string; timeout?: number; env?: NodeJS.ProcessEnv } = {}): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd: options.cwd, env: options.env ?? process.env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => child.kill(), options.timeout ?? 20_000);
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ code: -1, stdout, stderr: stderr || error.message });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? -1, stdout, stderr });
    });
  });
}

// Splits a stream into lines and hands each one over.
export function lines(onLine: (line: string) => void) {
  let rest = "";
  return (chunk: Buffer | string) => {
    rest += chunk.toString();
    const parts = rest.split("\n");
    rest = parts.pop() ?? "";
    for (const line of parts) if (line.trim()) onLine(line);
  };
}
