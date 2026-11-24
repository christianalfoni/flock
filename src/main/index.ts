// Flock's main process: the window, the app's MCP server for the sessions
// it starts, and what the window asks of it (shared/bridge.ts).
import { app, BrowserWindow, dialog, ipcMain, nativeTheme, net, protocol, shell } from "electron";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { INVOKE } from "../shared/bridge";
import { answerPermission, appState, createAgent, refreshClis, removeAgent, removeWorker, restartSession, saveSettings, sendMessage, startAgents, stopAll, transcriptOf } from "./agents";
import { closeAsk, markHeard, readCanvas, readPullDrawings, saveBoard, startCanvases, unheardCounts } from "./canvas";
import { startMcpServer } from "./mcp";

let mainWindow: BrowserWindow | undefined;

function broadcast(channel: string, payload?: unknown) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
}

// The built window is served from app://flock rather than file://: a page
// from file:// cannot start a shared worker, which the canvas's voice
// (TTMI's, made on this machine) runs in. A standard, secure origin can.
const APP_ORIGIN = "app://flock";
protocol.registerSchemesAsPrivileged([{ scheme: "app", privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }]);
function serveApp() {
  const root = join(__dirname, "../renderer");
  protocol.handle("app", (request) => {
    const path = decodeURIComponent(new URL(request.url).pathname);
    const file = join(root, path);
    if (!file.startsWith(root)) return new Response("Not found", { status: 404 });
    return net.fetch(pathToFileURL(file).toString());
  });
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: "Flock",
    // No title bar: the page's header is where the window is dragged, and a
    // double-click on it zooms the window (macOS does that for a draggable
    // area, as its own title bar does, by the system's setting).
    titleBarStyle: "hiddenInset",
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#0e0e10" : "#f7f6fe",
    webPreferences: { preload: join(__dirname, "../preload/index.mjs"), sandbox: false, contextIsolation: true },
  });
  // Links open in the browser, never in the window.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) await mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  else await mainWindow.loadURL(`${APP_ORIGIN}/index.html`);
}

// The window's requests, by channel (shared/bridge.ts names them).
const handlers: Record<string, (payload: any) => unknown> = {
  "app:state": () => appState(),
  "clis:refresh": () => refreshClis(),
  "settings:save": (settings) => saveSettings(settings),
  "agents:create": (input) => createAgent(input),
  "agents:remove": (id) => removeAgent(id),
  "workers:remove": (input) => removeWorker(input.id, Boolean(input.force)),
  "session:transcript": (id) => transcriptOf(id),
  "session:send": (input) => sendMessage(input),
  "session:restart": (id) => restartSession(id),
  "permission:answer": (input) => answerPermission(input.id, Boolean(input.allow)),
  "canvas:get": (agentId) => readCanvas(agentId),
  "canvas:pull-drawings": () => readPullDrawings(),
  "canvas:ask-close": (input) => closeAsk(input.agentId, input.ask),
  "canvas:heard": (input) => markHeard(input.agentId, input.words),
  "canvas:unheard": () => unheardCounts(appState().agents.map((agent) => agent.id)),
  "canvas:save": (input) => saveBoard(input.agentId, input),
  "folder:pick": async () => {
    const picked = await dialog.showOpenDialog(mainWindow!, { title: "Pick a git repository", properties: ["openDirectory"] });
    return picked.canceled ? undefined : picked.filePaths[0];
  },
  "external:open": (url) => {
    if (typeof url === "string" && /^https?:/.test(url)) return shell.openExternal(url);
  },
};

for (const [, [channel]] of Object.entries(INVOKE)) {
  const handler = handlers[channel];
  if (!handler) throw new Error(`No handler for ${channel}`);
  ipcMain.handle(channel, async (_event, payload) => handler(payload));
}

app.setName("Flock");

void app.whenReady().then(async () => {
  serveApp();
  // FLOCK_DATA_DIR: another place for everything the app keeps (for trying
  // it out without touching your agents).
  const data = process.env.FLOCK_DATA_DIR || app.getPath("userData");
  startCanvases(data, broadcast);
  await startMcpServer();
  await startAgents(data, broadcast);
  // Flock's icon in the Dock (the app runs from its folder).
  const icon = join(app.getAppPath(), "src/renderer/public/icon-512.png");
  if (existsSync(icon)) app.dock?.setIcon(icon);
  await createWindow();
  app.on("activate", () => {
    if (!BrowserWindow.getAllWindows().length) void createWindow();
  });
});

app.on("before-quit", () => stopAll());
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
