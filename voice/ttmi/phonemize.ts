// Text to phonemes the way kokoro-js does it before it speaks, for one piece
// of a step at a time (docs/plan-voice-cues.md, The engine). kokoro-js does
// not export it, so it is copied here from kokoro-js 1.2.1 (src/phonemize.js,
// Apache License 2.0, by Joshua Lochner); keep it in step with the kokoro-js
// in package.json.
import { phonemize as espeak } from "phonemizer";
import { normalize } from "./normalize";

const PUNCTUATION = ';:,.!?¡¿—…"«»“”(){}[]';
const PUNCTUATION_PATTERN = new RegExp(`(\\s*[${PUNCTUATION.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}]+\\s*)+`, "g");

function splitPunctuation(text: string) {
  const parts: { match: boolean; text: string }[] = [];
  let at = 0;
  for (const match of text.matchAll(PUNCTUATION_PATTERN)) {
    if (at < match.index) parts.push({ match: false, text: text.slice(at, match.index) });
    if (match[0].length > 0) parts.push({ match: true, text: match[0] });
    at = match.index + match[0].length;
  }
  if (at < text.length) parts.push({ match: false, text: text.slice(at) });
  return parts;
}

// American English, as the voices ttmi offers starting with "a"; "b" is
// British.
export async function phonemize(text: string, language: "a" | "b" = "a") {
  const parts = splitPunctuation(normalize(text));
  const lang = language === "a" ? "en-us" : "en";
  const said = (await Promise.all(parts.map(async ({ match, text }) => (match ? text : (await espeak(text, lang)).join(" "))))).join("");
  let out = said
    .replace(/kəkˈoːɹoʊ/g, "kˈoʊkəɹoʊ")
    .replace(/kəkˈɔːɹəʊ/g, "kˈəʊkəɹəʊ")
    .replace(/ʲ/g, "j")
    .replace(/r/g, "ɹ")
    .replace(/x/g, "k")
    .replace(/ɬ/g, "l")
    .replace(/(?<=[a-zɹː])(?=hˈʌndɹɪd)/g, " ")
    .replace(/ z(?=[;:,.!?¡¿—…"«»“” ]|$)/g, "z");
  if (language === "a") out = out.replace(/(?<=nˈaɪn)ti(?!ː)/g, "di");
  return out.trim();
}
