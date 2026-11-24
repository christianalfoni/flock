// The CLIs the app knows, in the order it prefers them when you have not
// chosen: the first one installed and logged in is the default.
import type { CliId, CliStatus } from "../../shared/types";
import { claude } from "./claude";
import { codex } from "./codex";
import { loadShellPath } from "./shell";
import type { Adapter } from "./types";

export const ADAPTERS: Record<CliId, Adapter> = { claude, codex };

export async function detectClis(): Promise<CliStatus[]> {
  await loadShellPath();
  return Promise.all(Object.values(ADAPTERS).map((adapter) => adapter.detect().catch((): CliStatus => ({ id: adapter.id, name: adapter.name, installed: false, loggedIn: false }))));
}

export function firstReady(clis: CliStatus[]): CliId | undefined {
  return clis.find((cli) => cli.installed && cli.loggedIn)?.id ?? clis.find((cli) => cli.installed)?.id;
}
