// misaki's phonemizer for the voice (docs/plan-voice-g2p.md): Kokoro was
// trained on its phonemes. Its dictionaries and fallback model are served
// at /g2p/ (vite.config.ts) and kept in Cache Storage, like the model, so
// a visit after the first needs no network. compromise tags the parts of
// speech that pick between a word's readings (g2p/tagger.ts).
import { createBart, readSafetensors, type BartConfig } from "./g2p/bart";
import { createG2P, type Around } from "./g2p/g2p";
import { withPatches, type Dictionary } from "./g2p/lexicon";
import { createTagger } from "./g2p/tagger";

export const G2P_CACHE = "ttmi-g2p";
let loading: Promise<(text: string, around?: Around) => string> | undefined;

async function file(name: string): Promise<Response> {
  const url = new URL(`/g2p/${name}`, self.location.origin).href;
  const cache = await caches.open(G2P_CACHE).catch(() => undefined);
  const hit = await cache?.match(url);
  if (hit) return hit;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`The phonemizer's ${name} could not be fetched.`);
  await cache?.put(url, response.clone()).catch(() => {});
  return response;
}

let parts: Promise<{ gold: Dictionary; silver: Dictionary; fallback: (word: string) => string | undefined; nlp: Parameters<typeof createTagger>[0] }> | undefined;

// What misaki is made from, for the listening page (/voice-patches), which
// makes it with and without the patches.
export function misakiParts() {
  return (parts ??= (async () => {
    const [gold, silver, config, model, { default: nlp }] = await Promise.all([
      file("us_gold.json").then((response) => response.json() as Promise<Dictionary>),
      file("us_silver.json").then((response) => response.json() as Promise<Dictionary>),
      file("config.json").then((response) => response.json() as Promise<BartConfig>),
      file("model.safetensors").then((response) => response.arrayBuffer()),
      import("compromise/two"),
    ]);
    return { gold, silver, fallback: createBart(readSafetensors(model), config), nlp };
  })().catch((error) => {
    parts = undefined;
    throw error;
  }));
}

// misaki with ttmi's patches over its gold dictionary (g2p/lexicon.ts).
export function makeMisaki({ gold, silver, fallback, nlp }: Awaited<ReturnType<typeof misakiParts>>, patches?: Dictionary, context = true) {
  const dictionary = withPatches(gold, patches);
  return createG2P({ gold: dictionary, silver, fallback, tag: createTagger(nlp, dictionary, { context }) });
}

export function loadMisaki(): Promise<(text: string, around?: Around) => string> {
  return (loading ??= misakiParts().then((made) => makeMisaki(made)).catch((error) => {
    loading = undefined;
    throw error;
  }));
}
