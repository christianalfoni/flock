// What the window can ask of the app, as one table: the preload builds the
// window's API from it, and main checks it handles every channel.

type Payload = (...args: any[]) => unknown;

const one: Payload = (value) => value;
const none: Payload = () => undefined;

// Requests: the window asks and waits for the answer.
export const INVOKE: Record<string, [channel: string, payload: Payload]> = {
  getState: ["app:state", none],
  refreshClis: ["clis:refresh", none],
  saveSettings: ["settings:save", one],
  createAgent: ["agents:create", one],
  removeAgent: ["agents:remove", one],
  removeWorker: ["workers:remove", (id, force) => ({ id, force })],
  getTranscript: ["session:transcript", one],
  sendMessage: ["session:send", one],
  restartSession: ["session:restart", one],
  answerPermission: ["permission:answer", (id, allow) => ({ id, allow })],
  getCanvas: ["canvas:get", one],
  getPullDrawings: ["canvas:pull-drawings", none],
  closeCanvasAsk: ["canvas:ask-close", (agentId, ask) => ({ agentId, ask })],
  markCanvasHeard: ["canvas:heard", (agentId, words) => ({ agentId, words })],
  canvasUnheard: ["canvas:unheard", none],
  saveCanvas: ["canvas:save", (agentId, board, boardText, applied) => ({ agentId, board, boardText, applied })],
  pickFolder: ["folder:pick", none],
  openExternal: ["external:open", one],
};

// Notices: the window tells the app something and does not wait.
export const SEND: Record<string, [channel: string, payload: Payload]> = {
  // The header drags the window (from where the cursor is when it starts,
  // following the cursor) and zooms it.
  startWindowDrag: ["window:drag-start", none],
  moveWindow: ["window:drag-move", none],
  zoomWindow: ["window:zoom", none],
};

// Updates the app pushes to the window, by the method that listens for them.
export const EVENTS: Record<string, string> = {
  onState: "app:state",
  onEntry: "session:entry",
  onCanvasUpdated: "canvas:updated",
  onPullDrawingsUpdated: "canvas:pull-drawings",
};
