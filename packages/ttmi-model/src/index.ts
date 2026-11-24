// What ttmi stores, shared by the web app, the functions and the tests
// (SPEC.md, Data model). Dates are ISO strings so this needs no Firebase.
import type { Shape, SketchGroup, SketchStep, SketchTerm } from "@ttmi/format";
import type { VoiceTune } from "./cloudVoice";
import type { Said } from "./pronounce";

export const collections = {
  sketches: "sketches",
  pending: "pending",
  asks: "asks",
  users: "users",
  organizations: "organizations",
  members: "members",
  settings: "settings",
  pronunciations: "pronunciations",
  pronunciationDefaults: "pronunciationDefaults",
  wordReviews: "wordReviews",
  keys: "keys",
  apiKeys: "apiKeys",
  usage: "usage",
  stats: "stats",
  feedback: "feedback",
  // Browser sessions for the account switcher. The server writes them; clients cannot read them.
  devices: "devices",
  // Written when an account is deleted, so a still-valid MCP token is refused
  // instead of recreating the user. Clients cannot read or write it.
  deletedUsers: "deletedUsers",
  // MCP OAuth, where ttmi is the authorization server in front of the account
  // picker. Clients cannot read these: they hold client registrations,
  // in-flight authorize requests, and the hashes of codes and refresh tokens.
  oauthClients: "oauthClients",
  oauthRequests: "oauthRequests",
  oauthCodes: "oauthCodes",
  oauthRefresh: "oauthRefresh",
  voiceClips: "voiceClips",
  voiceUsage: "voiceUsage",
  voiceMonths: "voiceMonths",
} as const;

export type Share = "private" | "link";
export type Role = "admin" | "member";
export type PlanStatus = "active" | "past_due" | "canceled";

// groups and terms came later; boards saved before have none, and a board
// without terms leaves the field out.
export type Board = { shapes: Shape[]; steps: SketchStep[]; groups?: SketchGroup[]; terms?: SketchTerm[] };

// sketches/{id}
export type SketchDoc = {
  id: string;              // short, unguessable, used in URLs: /s/<id>
  ownerId: string;         // WorkOS user id, orgOwner(org) for an organization sketch, or "try" for a front-page try, owned by nobody (docs/plan-try.md)
  organizationId?: string; // the organization the owner was acting in; a note, not access
  share: Share;            // "link": public, anyone with the link opens it (docs/plan-billing.md)
  // The organizations whose members may open it from its link
  // (docs/plan-organizations.md, Sharing): shared by the owner from the
  // board, the card or the agent. Absent or empty, the owner alone.
  sharedWith?: string[];
  title: string;           // from "# sketch <Title>"
  version: number;         // increments on every save (board or agent)
  board: Board | null;     // null until first opened on a board
  boardText: string | null; // the board's own export of `board`
  // Left on documents from Fix a word. Nothing reads it, and a save does
  // not write or clear it.
  pronunciations?: Said[];
  // The laid-out content's width and height. A canvas element takes its
  // aspect from this before the drawing is opened, and a PNG does too.
  canvas?: { w: number; h: number };
  // The hosted voice its stored narration is said in
  // (docs/plan-stored-voice.md). The team's current voice is what is said;
  // this field is no longer pinned. A client never writes it.
  voice?: string;
  // Set by the function when the sketch was saved through an MCP connection
  // for this team (?teamId=). A client never writes it.
  teamId?: string;
  createdAt: string;
  updatedAt: string;
};

// An organization sketch (docs/plan-ci-keys.md) is owned by the
// organization: its ownerId is "org:<id>" and it names the organization as
// its organizationId. Every member owns it. An API key acts as this id.
export const orgOwner = (organizationId: string) => `org:${organizationId}`;
export const ownerOrg = (ownerId: string) => (ownerId.startsWith("org:") ? ownerId.slice("org:".length) : undefined);

// sketches/{id}/pending/{version}: text an agent saved, applied by the board
// the next time the sketch is open, in version order.
export type PendingUpdate = { version: number; source: string; savedAt: string };

// sketches/{id}/asks/{id}. A reader asks during the walkthrough; the agent
// answers with save_sketch. Pending until then. The summary is what the
// board says when it is resolved. continuedAt is set once the reader
// continues past it. Old comment documents are a different collection and stay
// unread.
export type AskStatus = "pending" | "resolved" | "cancelled";
export type AskDoc = {
  id: string;
  question: string;
  step: number;            // from 1, as the step bar counts it
  canvasPath?: string;     // parent canvases and this one, when nested
  by: { id: string; name?: string };
  createdAt: string;
  status: AskStatus;
  summary?: string;
  resumeStep?: number;     // where playback continues, from 1
  resumeCanvas?: string;   // sketch id, when that step is in another canvas
  resolvedAt?: string;
  drawing?: boolean;       // the answer also queued a new drawing
  continuedAt?: string;
};

// users/{uid}/settings/board: the viewer's own board settings, the same on
// every sketch they open (docs/board.md, Walkthrough).
// voiceName is the Phonon voice (docs/plan-voice.md). voice was a saved
// mute; it is no longer read, since a board opened speaking until voiceOff:
// the viewer turned the voice off for every board, and nothing of it runs
// until they turn it on (docs/plan-voice.md, Off).
// voiceSpeed multiplies the paced speed (0.8 to 1.2), and voiceBlend mixes
// a second voice into voiceName's, voiceMix of it (up to 0.5)
// (docs/plan-voice-pacing.md).
// captionOpen shows a step's words in the caption while the voice says
// them; by default they are hidden then (docs/plan-quiet-caption.md).
export type BoardSettings = { voice?: boolean; voiceOff?: boolean; voiceName?: string; voiceSpeed?: number; voiceBlend?: string; voiceMix?: number; captionOpen?: boolean };

// users/{uid}/settings/welcome (docs/plan-welcome.md): closedAt when the
// user finished or left /welcome, hiddenAt when they dismissed the
// dashboard's checklist. Which steps are done is read from what they have.
export type WelcomeSettings = { closedAt?: string; hiddenAt?: string };

// feedback/{id}: what a viewer liked or did not about a sketch, for ttmi's
// own lab (lab/README.md), never the agent's. Kept beside the sketch's id,
// with the text and version on screen when it was written, since the sketch
// moves on. Its writer reads their own; the stats owners read all of it
// through GET /api/feedback.
export type FeedbackRating = "up" | "down";
export type FeedbackDoc = {
  id: string;
  sketchId: string;
  sketchTitle: string;
  sketchVersion: number;
  sketchText: string;      // the board's own export when it was written
  rating: FeedbackRating;
  text: string;
  step?: number;           // the walkthrough step on screen, from 1
  by: { id: string; name?: string };
  createdAt: string;
};
// GET /api/feedback: the newest, with the writer's email.
export type FeedbackReport = { feedback: (FeedbackDoc & { email?: string })[] };

// Who last called the MCP server as this user, and when: the server stamps
// it on every call, so the site can say that connecting worked. The client
// is the name it gave in its initialize request, when the call carried one.
export type AgentStamp = { client?: string; lastSeenAt: string };

// The MCP tool list's version. Clients keep the tools and instructions they
// listed until the user refreshes them, so the site warns a user whose last
// listing is older than this. Bump it, with a note on what is new, whenever
// the tools or the server's instructions change; a server test fails until
// you do.
export const TOOLS_VERSION = { version: 15, note: "Ask is a question the reader pastes to you. get_sketch lists pending asks. save_sketch answers one with ask, a short summary, and resumeStep." };

// The version the server handed out at this user's last tools/list.
export type ToolsListed = { version: number; at: string };

// users/{uid}, mirrored from WorkOS; never edited by hand. The agent stamp
// is the server's, not the mirror's.
export type UserDoc = {
  id: string;              // WorkOS user id
  email: string;
  name?: string;
  picture?: string;        // WorkOS profile picture URL
  organizations: { id: string; role: Role }[];
  plan?: { status: PlanStatus };
  agent?: AgentStamp;
  // Each client by the name it gave in initialize, and when it last did.
  agents?: Record<string, { lastSeenAt: string }>;
  toolsListed?: ToolsListed;
  // Set by the first exchange, which counts the sign-up (docs/plan-analytics.md).
  signedUpAt?: string;
  updatedAt: string;
};

// organizations/{id}, mirrored from WorkOS.
export type OrganizationDoc = {
  id: string;              // WorkOS organization id
  name: string;
  domains: string[];       // verified
  subscription?: Subscription;
  // false: its admins turned public links off (docs/plan-billing.md, Public
  // links). Set by the function, never by a client.
  publicLinks?: boolean;
  // The hosted voice its sketches are said in, "eleven:<model>:<voice id>",
  // chosen by an admin (docs/plan-cloud-voice.md). Set by the function,
  // never by a client. Absent, Flash v2.5 and Rachel.
  voice?: string;
  // Monthly hosted-voice spend cap in US dollars. Absent, the function's
  // VOICE_MONTHLY_USD or DEFAULT_VOICE_USD_LIMIT. Set by hand, never by a client.
  voiceUsdLimit?: number;
  // ElevenLabs voice settings for this team's model. Absent, the defaults.
  // Set by the function, never by a client.
  voiceTune?: VoiceTune;
  updatedAt: string;
};

// The organization's Team (docs/plan-billing.md). In phase 1 it is set by
// hand in the Firebase console, { status: "active", source: "manual" };
// Paddle writes it later, with the seats.
export type Subscription = { status: PlanStatus; source?: "manual" | "paddle"; seats?: number };

// voiceClips/{sketchId}_{key}: a step of a shared sketch said by its
// hosted voice and kept in Cloud Storage at `path`
// (docs/plan-stored-voice.md). "making" while one request makes it, the
// claim the others wait on; "ready" once stored. chars: what ElevenLabs was
// paid for; by: who asked, a user id or "anonymous". Server only.
export type VoiceClipDoc = {
  sketchId: string;
  voice: string;
  status: "making" | "ready";
  claimedAt: string;
  path?: string;
  seconds?: number;
  cues?: { name: string; from: number; to: number }[];
  chars?: number;
  by?: string;
  madeAt?: string;
};

// A team is any organization document. Subscription fields may still sit
// on old documents and are not read: every team is free.
export const hasTeam = (organization: object | undefined | null) => organization != null;

// Whether a sketch shared with or owned by the organization may be public.
// The rules check the same.
export const allowsPublicLinks = (organization: Pick<OrganizationDoc, "publicLinks"> | undefined) => organization?.publicLinks !== false;

// organizations/{id}/members/{uid}: the member list an organization's
// members may read (a user's own document is theirs alone). Kept by the
// exchange and the webhooks.
export type MemberDoc = {
  id: string;              // WorkOS user id
  email: string;
  name?: string;
  role: Role;
  updatedAt: string;
};

// organizations/{id}/keys/{keyId}: an organization's API key as its
// admins see it (docs/plan-ci-keys.md). The key itself is shown once and
// never stored; apiKeys/{sha256 of the key} is the server's lookup.
export type ApiKeyDoc = {
  id: string;
  name: string;
  last4: string;
  createdBy: { id: string; name?: string };
  createdAt: string;
  lastUsedAt?: string;
};
export type ApiKeyLookup = { org: string; keyId: string };
export const API_KEY_PREFIX = "ttmi_";

// The instructions users once set up for agents (settings/guide) were
// removed, 2026-10-21: a project's own instructions carry its house style.

// users/{uid}/pronunciations/{wordId}: how the voice says a word
// (docs/plan-voice.md), the user's own, fixed on a sketch and copied onto
// the sketches they save. phonemes are what the voice says, made from say
// when it was heard and saved, never again (docs/plan-voice-phonemes.md).
// An organization's list was dropped (2026-10-21): a sketch carries its
// owner's words instead. A spelling without phonemes, as stored before
// 2026-10-22, is no longer read, and was cleared.
export type PronunciationDoc = { word: string; say: string; phonemes: string; updatedAt: string };
// { word: "Redis", say: "Reddiss", phonemes: "ɹˈɛdɪs", updatedAt: "2026-10-22T09:00:00.000Z" }

// pronunciationDefaults/{wordId}: ttmi's own words made on /admin/words
// from what users fixed (docs/plan-voice.md, Defaults), said by everyone's
// boards after ttmi's shipped list and before anyone's own. Read by all,
// written by the server for the owners.
export type PronunciationDefaultDoc = PronunciationDoc;
// wordReviews/{wordId}: the owners' mark on a fixed word, the server's
// alone. dismissed: not for a default; patch: an English word whose reading
// depends on its part of speech, for the dictionary (apps/web/src/voice/g2p).
export type WordReviewDoc = { word: string; state: "dismissed" | "patch"; at: string };

// GET /api/words: every fixed word, by how many users fixed it, with no one
// named: the ways they said it, and what ttmi says today (shipped: in
// PRONUNCIATIONS; else a default made on /admin/words).
export type WordVariant = { phonemes: string; say: string; users: number };
export type WordRow = {
  word: string;
  users: number;
  variants: WordVariant[];
  firstAt: string;
  lastAt: string;
  ttmi?: { say: string; phonemes: string; shipped: boolean };
  review?: { state: WordReviewDoc["state"]; at: string };
};
export type WordsReport = { words: WordRow[] };
// POST /api/words.
export type WordAction =
  | { action: "default"; word: string; say: string; phonemes: string }
  | { action: "remove" | "dismiss" | "patch" | "reopen"; word: string };

// A word's document id: the word (case and spacing ignored), safe as an id.
export function wordId(word: string) {
  return encodeURIComponent(word.trim().toLowerCase().replace(/\s+/g, "-")).replace(/\./g, "%2E");
}

// What the Firebase token carries about the user, set when it is minted:
// every organization they are in (for reading), the one they act in (for
// creating), their role there, and the plan.
export type Claims = { org?: string; orgs: string[]; role?: Role; plan: "active" | "inactive" };

// The Admin Portal pages ttmi links an organization's admin to.
export type PortalIntent = "domain_verification";

const ALPHABET = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

// A sketch id: 12 characters, about 71 bits, drawn without bias.
export function newSketchId(length = 12) {
  let id = "";
  while (id.length < length) {
    const bytes = crypto.getRandomValues(new Uint8Array(length * 2));
    for (const byte of bytes) {
      if (byte < 248 && id.length < length) id += ALPHABET[byte % ALPHABET.length];
    }
  }
  return id;
}

export function sketchPath(id: string) {
  return `/s/${id}`;
}

export * from "./pronounce";
export * from "./cloudVoice";
export * from "./ttsLab";

// Analytics (docs/plan-analytics.md): anonymous counts per day, in
// stats/{day}_{event}, which no client reads or writes. Nothing names a
// user or a sketch; a variant splits a count (the agent's app, who opened).
export type StatsDoc = { day: string; event: StatEvent; total: number; variants?: Record<string, number> };

// Counted by the server where they happen.
// The try_ ones are the front page's free sketches (docs/plan-try.md):
// drawn (first time or fixed), failed (invalid text, the model), refused
// (the visitor's cap, everyone's).
export const SERVER_EVENTS = ["signed_up", "first_agent", "agent_connected", "sketch_created", "sketch_updated", "try_drawn", "try_failed", "try_refused"] as const;

// Sent by the web app to /api/events, each with the variants it may carry
// (an empty list: none). The server counts nothing else.
export const CLIENT_EVENTS = {
  sketch_opened: ["owner", "member", "public"],
  walkthrough_played: ["voice", "muted", "silent"],
  voice_installed: [],
  local_opened: [],
  // How far a new user got when /welcome closed: nothing, an agent, a sketch.
  welcome_closed: ["none", "connected", "sketch"],
  // A step made over the voice model's 510 tokens, its end not said.
  voice_truncated: [],
  // How long a walkthrough's voice took to make before it could start
  // (apps/web/src/voice/prep.ts).
  voice_prepared: ["under_5s", "5_15s", "15_30s", "30_60s", "1_2m", "over_2m"],
} as const satisfies Record<string, readonly string[]>;

export type ClientEvent = keyof typeof CLIENT_EVENTS;
export type StatEvent = (typeof SERVER_EVENTS)[number] | ClientEvent;

export const STAT_EVENTS: readonly StatEvent[] = [...SERVER_EVENTS, ...(Object.keys(CLIENT_EVENTS) as ClientEvent[])];

// From a sign-up to a sketch someone read, as the owner's stats page shows it.
export const FUNNEL = ["signed_up", "first_agent", "sketch_created", "sketch_opened"] as const satisfies readonly StatEvent[];

// GET /api/stats, for the owners in STATS_OWNERS: each event's counts over
// the last days, oldest first, with its variants summed over them.
export type StatsReport = {
  days: string[];
  events: Record<StatEvent, { total: number; daily: number[]; variants: Record<string, number> }>;
  // Sketches created per month, oldest first. Tries on the front page are
  // not in the count.
  voice?: VoiceMonth[];
};

// Sketches made in a month (front page tries apart). Voice is not counted:
// each listener makes it in their own browser.
export type VoiceMonth = {
  month: string;
  sketchesCreated: number;
};

// One team, one month: sketches created for it.
export type TeamVoiceMonth = {
  month: string;
  sketchesCreated: number;
};
