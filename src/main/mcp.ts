// The app's tools for the sessions it starts, served over MCP (Streamable
// HTTP, JSON answers) on localhost: /mcp/orchestrator and /mcp/worker, each
// with only its own tools. Every session gets its own token, sent as a
// bearer header, so the app knows which agent is calling without the agent
// having to say who it is.
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { randomBytes } from "node:crypto";

const PROTOCOL = "2025-06-18";

export type Role = "orchestrator" | "worker";
// Who is calling: its role and its id (O1, W3).
export type Caller = { role: Role; id: string };

type Rpc = { jsonrpc?: string; id?: string | number | null; method?: string; params?: Record<string, unknown> };
type Tool = {
  name: string;
  description: string;
  inputSchema: { type: "object"; properties: Record<string, unknown>; required?: string[] };
  run(caller: Caller, args: Record<string, unknown>): Promise<string>;
};

// What the tools do, given by the app (agents.ts). Each answers in words for
// the session, and throws to say what went wrong.
export type McpDeps = {
  draw(caller: Caller, input: { source?: string; playFrom?: number; ask?: string; summary?: string; pullRequest?: string }): Promise<string>;
  getCanvas(caller: Caller): Promise<string>;
  startWorker(caller: Caller, input: { title: string; task: string; kind?: string }): Promise<string>;
  workerKinds(caller: Caller): Promise<string>;
  messageWorker(caller: Caller, input: { worker: string; text: string }): Promise<string>;
  workers(caller: Caller): Promise<string>;
  removeWorker(caller: Caller, input: { worker: string; force: boolean }): Promise<string>;
  report(caller: Caller, input: { text: string; pullRequests: string[] }): Promise<string>;
  // A tool call that needs your yes (permission mode "ask"): resolves with
  // whether you allowed it.
  permission(caller: Caller, input: { tool: string; input: unknown }): Promise<{ allow: boolean; message?: string }>;
};

const text = (args: Record<string, unknown>, name: string) => {
  const value = args[name];
  if (typeof value !== "string" || !value.trim()) throw new Error(`Give ${name}.`);
  return value.trim();
};
const optional = (args: Record<string, unknown>, name: string) => (typeof args[name] === "string" && (args[name] as string).trim() ? (args[name] as string).trim() : undefined);
const workerId = (args: Record<string, unknown>) => {
  const value = text(args, "worker").toUpperCase();
  if (!/^W\d+$/.test(value)) throw new Error("worker is a worker's id, like W3.");
  return value;
};
const PULL = /^https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/\d+/;
const PULL_IN_TEXT = /https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/pull\/\d+/g;
const pull = (value: string) => {
  const match = value.trim().match(PULL);
  if (!match) throw new Error(`${value} is not a GitHub pull request link.`);
  return match[0];
};
const playFrom = (args: Record<string, unknown>) => {
  const value = Number(args.play_from);
  return Number.isInteger(value) && value > 0 ? value : undefined;
};
const answer = (args: Record<string, unknown>) => {
  const ask = optional(args, "ask");
  if (ask && !optional(args, "summary")) throw new Error("Answer the ask with a summary they will hear.");
  return ask ? { ask, summary: optional(args, "summary") } : {};
};

let deps: McpDeps | undefined;
const need = () => {
  if (!deps) throw new Error("Flock is still starting. Try again in a moment.");
  return deps;
};

// Answers a permission prompt (Claude's --permission-prompt-tool): the
// session waits on it until you say yes or no in the app.
const PERMISSION: Tool = {
  name: "permission",
  description: "Used by Flock to ask the person you work for before a tool call that needs their yes. Flock calls it for you; do not call it yourself.",
  inputSchema: { type: "object", properties: { tool_name: { type: "string" }, input: { type: "object" }, tool_use_id: { type: "string" } }, required: ["tool_name", "input"] },
  run: async (caller, args) => {
    const input = (args.input ?? {}) as Record<string, unknown>;
    const decision = await need().permission(caller, { tool: String(args.tool_name), input });
    return JSON.stringify(decision.allow ? { behavior: "allow", updatedInput: input } : { behavior: "deny", message: decision.message ?? "The person you work for said no. Ask them on your canvas if you need it." });
  },
};

const DRAW_SOURCE = { type: "string", description: "The whole drawing, starting with \"# sketch <Title>\" (always the same title), as the canvas guide in your instructions describes. Leave it out only to answer an ask without changing the picture." };
const DRAW_PLAY_FROM = { type: "integer", description: "The walkthrough step they should hear first, as the step bar counts: the overview (when it has words) is 1, then each numbered arrow in seq order, then the summary. With ask: the earliest step they should rewatch, where it resumes when they continue (their own step when left out)." };
const DRAW_ASK = { type: "string", description: "The id of the ask this answers, from the [Ask …] at the start of their message." };
const DRAW_SUMMARY = { type: "string", description: "With ask: what they hear first, a sentence or two that answers them. The drawing carries the rest." };

const ORCHESTRATOR: { instructions: string; tools: Tool[] } = {
  instructions: "Flock runs you as an orchestrator: you plan, and workers (each a git worktree with its own coding session) build. You talk to the person you work for through your canvas: keep it current with draw. Flock tells you when a worker reports.",
  tools: [
    {
      name: "draw",
      description: "Sets your canvas, the picture the person you work for sees and plays, to the whole drawing in source. It merges into their board: what they moved stays put. Every open or draft pull request of your workers must be on it, as a box labelled with its number (pr12: box \"#12\"). Each of their messages on the canvas is an ask ([Ask A3, on step 2] …): answer it here with ask, a summary they hear, play_from at the step to resume from, and source when the picture should change. Answers with the version, or with what is wrong on which line (nothing is drawn then).",
      inputSchema: { type: "object", properties: { source: DRAW_SOURCE, play_from: DRAW_PLAY_FROM, ask: DRAW_ASK, summary: DRAW_SUMMARY } },
      run: async (caller, args) => need().draw(caller, { source: optional(args, "source"), playFrom: playFrom(args), ...answer(args) }),
    },
    {
      name: "get_canvas",
      description: "Your canvas as text, with where the person you work for put things (at, size, width on every shape). Call it before you draw when they may have changed it.",
      inputSchema: { type: "object", properties: {} },
      run: async (caller) => need().getCanvas(caller),
    },
    {
      name: "start_worker",
      description: "Starts a worker on one task: Flock makes a git worktree and a branch for it from the repository's current commit, starts a coding session there with the worker's instructions, and hands it the task. Answers with its id (like W3). It reports back to you when it has news.",
      inputSchema: {
        type: "object",
        properties: {
          title: { type: "string", description: "What it works on, in a few words. Names its branch and shows in Flock." },
          task: { type: "string", description: "Its whole task: what to build or fix, what done means, and anything it needs to know. It cannot see your conversation." },
          kind: { type: "string", description: "The kind of worker, by id (worker_kinds lists them, with what each is for). Leave it out for the first kind." },
        },
        required: ["title", "task"],
      },
      run: async (caller, args) => need().startWorker(caller, { title: text(args, "title"), task: text(args, "task"), kind: optional(args, "kind") }),
    },
    {
      name: "worker_kinds",
      description: "The kinds of workers you can start, as the person you work for set them up: each one's id, what it is for, and the CLI and model it runs on. Pick one for start_worker's kind.",
      inputSchema: { type: "object", properties: {} },
      run: async (caller) => need().workerKinds(caller),
    },
    {
      name: "message_worker",
      description: "Sends one of your workers a message. It arrives in its session as a turn from you.",
      inputSchema: { type: "object", properties: { worker: { type: "string", description: "The worker's id, like W3." }, text: { type: "string" } }, required: ["worker", "text"] },
      run: async (caller, args) => need().messageWorker(caller, { worker: workerId(args), text: text(args, "text") }),
    },
    {
      name: "workers",
      description: "Your workers: for each, its task, its branch and worktree, whether it is working now, its last report, and its pull requests with where they stand.",
      inputSchema: { type: "object", properties: {} },
      run: async (caller) => need().workers(caller),
    },
    {
      name: "remove_worker",
      description: "Removes a worker you no longer need: Flock stops its session and removes its worktree. Refused while its worktree has uncommitted changes or commits not pushed anywhere, unless force is true (the branch is kept then, so no commit is lost).",
      inputSchema: { type: "object", properties: { worker: { type: "string", description: "The worker's id, like W3." }, force: { type: "boolean", description: "Remove it even with uncommitted or unpushed work. Only when the person you work for said so." } }, required: ["worker"] },
      run: async (caller, args) => need().removeWorker(caller, { worker: workerId(args), force: args.force === true }),
    },
    PERMISSION,
  ],
};

const WORKER: { instructions: string; tools: Tool[] } = {
  instructions: "Flock runs you as a worker for an orchestrator, in your own git worktree. Tell your orchestrator where you are with report. Draw each pull request you open with draw.",
  tools: [
    {
      name: "report",
      description: "Tells your orchestrator where you are: you started, you opened or updated a pull request, you are blocked or have a question, or you are done. It gets it at once. Say the whole state: it replaces your last report.",
      inputSchema: {
        type: "object",
        properties: {
          text: { type: "string", description: "What you did, what is left, what you need. Short." },
          pull_requests: { type: "array", items: { type: "string" }, description: "Links of every pull request you opened or work on. Flock follows these (CI, conflicts, merges) and shows them on your orchestrator's canvas." },
        },
        required: ["text"],
      },
      run: async (caller, args) => {
        const said = text(args, "text");
        const listed = (Array.isArray(args.pull_requests) ? args.pull_requests : []).filter((item): item is string => typeof item === "string").map(pull);
        return need().report(caller, { text: said, pullRequests: [...new Set([...listed, ...[...said.matchAll(PULL_IN_TEXT)].map((match) => match[0])])] });
      },
    },
    {
      name: "draw",
      description: "Sets a pull request's canvas, the picture the person you work for reviews it by, to the whole drawing in source: what the change does and why. It shows inside that pull request's box on your orchestrator's canvas. Draw it when you open the pull request and again when the change changes. What they ask about it comes to you as [Ask A2, on step 3 of #12 (link)] …: answer it here with ask, a summary they hear, play_from, and source when the picture should change.",
      inputSchema: { type: "object", properties: { pull_request: { type: "string", description: "The pull request's link." }, source: DRAW_SOURCE, play_from: DRAW_PLAY_FROM, ask: DRAW_ASK, summary: DRAW_SUMMARY }, required: ["pull_request"] },
      run: async (caller, args) => need().draw(caller, { pullRequest: pull(text(args, "pull_request")), source: optional(args, "source"), playFrom: playFrom(args), ...answer(args) }),
    },
    PERMISSION,
  ],
};

const SERVERS: Record<Role, { instructions: string; tools: Tool[] }> = { orchestrator: ORCHESTRATOR, worker: WORKER };

// Tokens, each for one session.
const tokens = new Map<string, Caller>();
let base = "";

export function tokenFor(caller: Caller): { url: string; token: string } {
  for (const [token, known] of tokens) if (known.role === caller.role && known.id === caller.id) return { url: `${base}/mcp/${caller.role}`, token };
  const token = randomBytes(24).toString("hex");
  tokens.set(token, caller);
  return { url: `${base}/mcp/${caller.role}`, token };
}

export function revokeTokens(id: string) {
  for (const [token, caller] of tokens) if (caller.id === id) tokens.delete(token);
}

export function setMcpDeps(input: McpDeps) {
  deps = input;
}

export async function handleRpc(role: Role, caller: Caller, message: Rpc): Promise<unknown> {
  const server = SERVERS[role];
  const { id, method, params = {} } = message ?? {};
  if (id === undefined || id === null) return undefined;
  const reply = (result: unknown) => ({ jsonrpc: "2.0", id, result });
  const fail = (code: number, text: string) => ({ jsonrpc: "2.0", id, error: { code, message: text } });
  if (method === "initialize") {
    return reply({
      protocolVersion: typeof params.protocolVersion === "string" ? params.protocolVersion : PROTOCOL,
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: `flock-${role}`, title: `Flock ${role}`, version: "0.1.0" },
      instructions: server.instructions,
    });
  }
  if (method === "ping" || method === "server/discover") return reply({});
  if (method === "tools/list") return reply({ tools: server.tools.map(({ run: _run, ...tool }) => tool) });
  if (method === "tools/call") {
    const tool = server.tools.find((item) => item.name === params.name);
    if (!tool) return fail(-32602, `Unknown tool ${String(params.name)}.`);
    try {
      return reply({ content: [{ type: "text", text: await tool.run(caller, (params.arguments ?? {}) as Record<string, unknown>) }] });
    } catch (error) {
      return reply({ content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }], isError: true });
    }
  }
  return fail(-32601, `Method not found: ${method}.`);
}

async function onRequest(request: IncomingMessage, response: ServerResponse) {
  const role = /^\/mcp\/(orchestrator|worker)\/?$/.exec(request.url ?? "")?.[1] as Role | undefined;
  if (!role) return void response.writeHead(404).end();
  if (request.method !== "POST") return void response.writeHead(405, { allow: "POST" }).end();
  const token = /^Bearer\s+(.+)$/i.exec(request.headers.authorization ?? "")?.[1]?.trim();
  const caller = token ? tokens.get(token) : undefined;
  if (!caller || caller.role !== role) return void response.writeHead(401).end();
  let body = "";
  for await (const chunk of request) body += chunk;
  let message: unknown;
  try { message = JSON.parse(body); } catch { return void response.writeHead(400).end(); }
  const answers = Array.isArray(message)
    ? (await Promise.all(message.map((item) => handleRpc(role, caller, item as Rpc)))).filter(Boolean)
    : await handleRpc(role, caller, message as Rpc);
  if (answers === undefined || (Array.isArray(answers) && !answers.length)) return void response.writeHead(202).end();
  response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(answers));
}

// Starts the server on a free port on localhost; resolves with its address.
export function startMcpServer(): Promise<string> {
  return new Promise((resolve, reject) => {
    const server = createServer((request, response) => {
      onRequest(request, response).catch((error) => {
        console.warn("[mcp]", error);
        if (!response.headersSent) response.writeHead(500).end();
      });
    });
    // A permission prompt waits for you as long as it takes.
    server.requestTimeout = 0;
    server.headersTimeout = 60_000;
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      resolve(base);
    });
  });
}
