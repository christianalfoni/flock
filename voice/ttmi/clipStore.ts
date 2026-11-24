// The spoken steps in Cache Storage (CLIP_CACHE). A clip is this viewer's,
// named by the voice, the words and how they are said (clipKey). It lives
// two days from when it was last made or played. The cache stays under
// about 80 MB by dropping the least recently used. The open sketch's clips
// are kept while it is open, so a walkthrough is not pulled out from under
// the reader. When each was used is kept in the cache too, in a small
// index, so the next engine knows.
import { clipUrl } from "./protocol";

export const KEEP_MS = 48 * 60 * 60 * 1000;
export const MAX_BYTES = 80 * 1024 * 1024;
const INDEX = "https://voice.ttmi.invalid/index.json";

export type ClipCache = {
  match(url: string): Promise<Response | undefined>;
  put(url: string, response: Response): Promise<void>;
  delete(url: string): Promise<boolean>;
  keys(): Promise<readonly { url: string }[]>;
};

type Used = { at: number; bytes: number };

const keyOf = (url: string) => /^https:\/\/voice\.ttmi\.invalid\/(.+)\.wav$/.exec(url)?.[1];

export class ClipStore {
  private used?: Promise<Map<string, Used>>;
  private writing: Promise<unknown> = Promise.resolve();
  // Clips whose index is written and whose body is not stored yet.
  private pending = new Set<string>();

  constructor(private open: () => Promise<ClipCache>, private now: () => number = Date.now, private maxBytes = MAX_BYTES) {}

  private index() {
    return (this.used ??= (async () => {
      try {
        const saved = (await (await (await this.open()).match(INDEX))?.json()) as Record<string, number | Used> | undefined;
        const entries = Object.entries(saved ?? {}).flatMap(([key, value]): [string, Used][] => {
          if (typeof value === "number") return [[key, { at: value, bytes: 0 }]];
          if (value && typeof value.at === "number" && typeof value.bytes === "number") return [[key, value]];
          return [];
        });
        return new Map(entries);
      } catch {
        return new Map<string, Used>();
      }
    })());
  }

  // One write at a time, of the whole index: it is small.
  private save(used: Map<string, Used>) {
    this.writing = this.writing.then(async () => {
      const body = JSON.stringify(Object.fromEntries(used));
      await (await this.open()).put(INDEX, new Response(body, { headers: { "content-type": "application/json" } }));
    }).catch(() => undefined);
    return this.writing;
  }

  private async touch(key: string, bytes?: number) {
    const used = await this.index();
    const previous = used.get(key);
    used.set(key, { at: this.now(), bytes: bytes ?? previous?.bytes ?? 0 });
    await this.save(used);
  }

  private fresh(at: number) {
    return at >= this.now() - KEEP_MS;
  }

  // A clip, which counts as playing it. One older than two days is a miss
  // and is dropped.
  async match(key: string): Promise<Response | undefined> {
    await this.writing;
    const cache = await this.open();
    const used = await this.index();
    const entry = used.get(key);
    if (entry && !this.fresh(entry.at)) {
      if (!this.pending.has(key)) {
        await cache.delete(clipUrl(key));
        used.delete(key);
        await this.save(used);
      }
      return undefined;
    }
    const hit = await cache.match(clipUrl(key));
    if (!hit) return undefined;
    // A body with no index is a clip from before the store, unless one is
    // being written right now: deleting that one loses it.
    if (!entry) {
      if (this.pending.has(key)) return undefined;
      await cache.delete(clipUrl(key));
      return undefined;
    }
    await this.touch(key);
    return hit;
  }

  // Whether a clip is made, without playing it. An expired one does not count.
  async has(key: string) {
    const used = await this.index();
    const entry = used.get(key);
    if (entry && !this.fresh(entry.at)) return false;
    return Boolean(await (await this.open()).match(clipUrl(key)));
  }

  async put(key: string, response: Response) {
    const bytes = await clipBytes(response);
    this.pending.add(key);
    try {
      const used = await this.index();
      used.set(key, { at: this.now(), bytes });
      await this.save(used);
      await (await this.open()).put(clipUrl(key), response);
    } finally {
      this.pending.delete(key);
    }
  }

  // Deletes clips older than two days, then the least recently used until
  // the cache is under its size, except the ones kept (the open sketch's).
  async sweep(keep: ReadonlySet<string> = new Set()): Promise<string[]> {
    await this.writing;
    const cache = await this.open();
    const used = await this.index();
    const gone: string[] = [];
    const drop = async (key: string) => {
      await cache.delete(clipUrl(key));
      used.delete(key);
      gone.push(key);
    };
    for (const request of await cache.keys()) {
      const key = keyOf(request.url);
      if (!key || keep.has(key)) continue;
      if (this.pending.has(key)) continue;
      const entry = used.get(key);
      if (!entry || !this.fresh(entry.at)) await drop(key);
    }
    const sized: { key: string; at: number; bytes: number }[] = [];
    let total = 0;
    for (const request of await cache.keys()) {
      const key = keyOf(request.url);
      if (!key) continue;
      if (this.pending.has(key)) continue;
      const entry = used.get(key) ?? { at: -Infinity, bytes: 0 };
      if (entry.bytes <= 0) {
        const hit = await cache.match(request.url);
        entry.bytes = hit ? await bodyBytes(hit) : 0;
        if (used.has(key)) used.set(key, { ...entry, at: entry.at });
      }
      total += entry.bytes;
      if (!keep.has(key)) sized.push({ key, at: entry.at, bytes: entry.bytes });
    }
    sized.sort((a, b) => a.at - b.at);
    for (const item of sized) {
      if (total <= this.maxBytes) break;
      await drop(item.key);
      total -= item.bytes;
    }
    const present = new Set((await cache.keys()).map((request) => keyOf(request.url)));
    for (const key of used.keys()) if (!present.has(key) && !this.pending.has(key)) used.delete(key);
    await this.save(used);
    return gone;
  }

  // The cache was deleted: nothing is known any more.
  forget() {
    this.used = undefined;
  }
}

// A cache that throws is a miss. The step is made again; the page is not
// left waiting on a rejection nobody handles.
export async function readClip(store: { match(key: string): Promise<Response | undefined> }, key: string): Promise<Response | undefined> {
  try {
    return await store.match(key);
  } catch {
    return undefined;
  }
}

async function bodyBytes(response: Response) {
  const header = Number(response.headers.get("content-length"));
  if (header > 0) return header;
  return (await response.clone().arrayBuffer()).byteLength;
}

async function clipBytes(response: Response) {
  return bodyBytes(response.clone());
}
