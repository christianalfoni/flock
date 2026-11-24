// The clip cache kept clean (clipStore.ts): a clip lives two days from
// when it was last made or played, and the open sketch's never go. The
// cache also stays under its size, oldest first.
import { describe, expect, test } from "vitest";
import { ClipStore, KEEP_MS, readClip, type ClipCache } from "./clipStore";
import { clipUrl } from "./protocol";

function memoryCache() {
  const entries = new Map<string, Response>();
  const cache: ClipCache = {
    async match(url) {
      return entries.get(String(url))?.clone();
    },
    async put(url, response) {
      entries.set(String(url), response);
    },
    async delete(url) {
      return entries.delete(String(url));
    },
    async keys() {
      return [...entries.keys()].map((url) => ({ url }));
    },
  };
  return { cache, entries };
}

const clip = () => new Response(new Uint8Array(8), { headers: { "content-type": "audio/wav" } });

describe("the clip store", () => {
  test("a clip lasts two days", () => {
    expect(KEEP_MS).toBe(48 * 60 * 60 * 1000);
  });

  test("keeps clips made or played in the last two days and deletes the rest", async () => {
    const { cache, entries } = memoryCache();
    let now = 1_000_000;
    const store = new ClipStore(async () => cache, () => now);
    await store.put("old", clip());
    await store.put("played", clip());
    now += KEEP_MS - 60_000;
    await store.put("new", clip());
    expect(await store.match("played")).toBeDefined();
    now += 120_000;
    expect(await store.sweep()).toEqual(["old"]);
    expect(entries.has(clipUrl("old"))).toBe(false);
    expect(entries.has(clipUrl("played"))).toBe(true);
    expect(entries.has(clipUrl("new"))).toBe(true);
  });

  test("never deletes a clip of the sketch that is open", async () => {
    const { cache, entries } = memoryCache();
    let now = 0;
    const store = new ClipStore(async () => cache, () => now);
    await store.put("open", clip());
    await store.put("closed", clip());
    now += KEEP_MS * 3;
    expect(await store.sweep(new Set(["open"]))).toEqual(["closed"]);
    expect(entries.has(clipUrl("open"))).toBe(true);
  });

  test("remembers when each clip was used across engines, in the cache itself", async () => {
    const { cache } = memoryCache();
    let now = 0;
    await new ClipStore(async () => cache, () => now).put("a", clip());
    now += KEEP_MS / 2;
    const next = new ClipStore(async () => cache, () => now);
    expect(await next.sweep()).toEqual([]);
    now += KEEP_MS;
    expect(await next.sweep()).toEqual(["a"]);
  });

  test("deletes a clip it has no record of: one from before the store", async () => {
    const { cache, entries } = memoryCache();
    entries.set(clipUrl("stray"), clip());
    const store = new ClipStore(async () => cache, () => 0);
    expect(await store.sweep()).toEqual(["stray"]);
  });

  test("an expired clip is a miss, and is dropped", async () => {
    const { cache, entries } = memoryCache();
    let now = 0;
    const store = new ClipStore(async () => cache, () => now);
    await store.put("old", clip());
    now += KEEP_MS + 1;
    expect(await store.match("old")).toBeUndefined();
    expect(entries.has(clipUrl("old"))).toBe(false);
  });

  test("drops the oldest clips once the cache is over its size", async () => {
    const { cache, entries } = memoryCache();
    let now = 0;
    const store = new ClipStore(async () => cache, () => now, 20);
    await store.put("first", clip());
    now += 1;
    await store.put("second", clip());
    now += 1;
    await store.put("third", clip());
    expect(await store.sweep()).toEqual(["first"]);
    expect(entries.has(clipUrl("first"))).toBe(false);
    expect(entries.has(clipUrl("second"))).toBe(true);
    expect(entries.has(clipUrl("third"))).toBe(true);
  });

  test("a clip still being stored is not deleted by a lookup or a sweep", async () => {
    const { cache, entries } = memoryCache();
    let release: () => void = () => {};
    let entered: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const inside = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const slow: ClipCache = {
      ...cache,
      async put(url, response) {
        if (String(url).endsWith("/fresh.wav")) {
          entered();
          await gate;
        }
        await cache.put(url, response);
      },
    };
    const store = new ClipStore(async () => slow, () => 1_000);
    const storing = store.put("fresh", clip());
    await inside;
    expect(await store.match("fresh")).toBeUndefined();
    expect(await store.sweep()).toEqual([]);
    release();
    await storing;
    expect(entries.has(clipUrl("fresh"))).toBe(true);
    expect(await store.match("fresh")).toBeDefined();
  });

  test("a cache that throws is a miss", async () => {
    const broken = { match: () => Promise.reject(new Error("quota")) };
    expect(await readClip(broken, "step")).toBeUndefined();
  });

  test("a miss is not a use", async () => {
    const { cache } = memoryCache();
    const store = new ClipStore(async () => cache, () => 0);
    expect(await store.match("nothing")).toBeUndefined();
    expect(await store.sweep()).toEqual([]);
  });
});
