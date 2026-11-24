// The open phonemizer with misaki's real dictionaries and fallback model,
// against the eSpeak one the board uses today (docs/plan-voice-g2p.md).
// Needs `node scripts/fetch-g2p.mjs`; skipped without it. Writes the table
// to apps/web/.g2p/compare.md.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { phonemize } from "../phonemize";
import { createBart, readSafetensors, type BartConfig } from "./bart";
import { createG2P } from "./g2p";

const DATA = join(__dirname, "../../../.g2p");
const has = existsSync(join(DATA, "model.safetensors"));
const read = (name: string) => readFileSync(join(DATA, name));

// What a ttmi narration says: the cue test's sentence, jargon as written,
// and the respellings ttmi's core and web presets use for it.
const SENTENCES = [
  "When the worker fails, a backoff.",
  "The client sends the request to the server, which writes it to the queue.",
  "If the cache misses, we read from the database and retry 3 times.",
  "In 2026 the service handled 1,500 requests a second.",
];
const JARGON = ["Redis", "WorkOS", "Firestore", "Vite", "CLI", "Kubernetes", "PostgreSQL", "OAuth", "JSON", "webhook", "GitHub", "TypeScript", "npm", "nginx", "async", "localhost", "frontend", "Firebase", "MCP", "kubectl", "Vitest", "SaaS", "Deno", "enum", "stdout", "ttmi", "Kokoro", "WebGPU", "SharedWorker"];
const RESPELLED = ["Reddiss", "veet", "veet-test", "oh-auth", "Jason", "C L I", "post-gress Q L", "cube control", "a-sink", "ee-num", "Dee-no", "sass", "T T M I"];

describe.skipIf(!has)("with misaki's data", () => {
  const load = () => {
    const started = performance.now();
    const gold = JSON.parse(read("us_gold.json").toString());
    const silver = JSON.parse(read("us_silver.json").toString());
    const config = JSON.parse(read("config.json").toString()) as BartConfig;
    const model = read("model.safetensors");
    const guess = createBart(readSafetensors(model.buffer.slice(model.byteOffset, model.byteOffset + model.byteLength) as ArrayBuffer), config);
    const g2p = createG2P({ gold, silver, fallback: guess });
    return { gold, silver, guess, g2p, ms: performance.now() - started };
  };
  const loaded = has ? load() : undefined!;

  test("the fallback model says most dictionary words the way the dictionary does", () => {
    // Every 397th one-reading gold word, words it was trained on: about 69%
    // come out exactly as the dictionary has them, and most of the rest
    // differ in stress or a reduced vowel. A bug in the port is far below.
    const words = Object.entries(loaded.gold as Record<string, unknown>).filter((entry): entry is [string, string] => typeof entry[1] === "string" && /^[a-z]{3,}$/.test(entry[0])).filter((_, i) => i % 397 === 0);
    const started = performance.now();
    const right = words.filter(([word, ps]) => loaded.guess(word) === ps).length;
    const ms = (performance.now() - started) / words.length;
    console.log(`fallback: ${right}/${words.length} exact, ${ms.toFixed(2)} ms a word; load ${loaded.ms.toFixed(0)} ms`);
    expect(right / words.length).toBeGreaterThan(0.6);
  }, 30_000);

  test("camel case keeps the pieces the dictionary knows", () => {
    const asked: string[] = [];
    const g2p = createG2P({ gold: loaded.gold, silver: loaded.silver, fallback: (word) => (asked.push(word), loaded.guess(word)) });
    // Only "Postgre" is guessed; SQL is the dictionary's "sequel".
    expect(g2p("PostgreSQL")).toBe("pˈOstɡəɹsˌikwəl");
    expect(g2p("useEffect")).toBe("jˌuzəfˈɛkt");
    expect(g2p("getServerSideProps")).toBe("ɡɛtsˈɜɹvəɹsˌIdpɹˈɑps");
    expect(asked).toEqual(["Postgre"]);
  });

  test("side by side with eSpeak", async () => {
    const rows: string[] = ["| text | eSpeak (today) | misaki + BART |", "| --- | --- | --- |"];
    for (const text of [...SENTENCES, ...JARGON, ...RESPELLED]) rows.push(`| ${text} | ${await phonemize(text)} | ${loaded.g2p(text)} |`);
    writeFileSync(join(DATA, "compare.md"), rows.join("\n") + "\n");
    console.log(rows.join("\n"));
    expect(loaded.g2p("When the worker fails, a backoff.")).toBe("wˌɛn ðə wˈɜɹkəɹ fˈAlz, ɐ bˈækɔf.");
  }, 30_000);
});
