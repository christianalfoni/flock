import { contextBridge, ipcRenderer } from "electron";
import { EVENTS, INVOKE } from "../shared/bridge";

// The window's API over IPC, built from the table in shared/bridge.ts.
const api: Record<string, unknown> = {};
for (const [name, [channel, payload]] of Object.entries(INVOKE)) {
  api[name] = (...args: unknown[]) => ipcRenderer.invoke(channel, payload(...args));
}
for (const [name, channel] of Object.entries(EVENTS)) {
  api[name] = (callback: (value: unknown) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, value: unknown) => callback(value);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  };
}

contextBridge.exposeInMainWorld("dispatch", api);
