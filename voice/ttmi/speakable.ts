// Text as it is said, for the voice lab's experiment
// (docs/research-browser-tts.md, Q2 and Q3): the symbols, units and asides
// a small TTS model reads badly, written as a speaker would say them. The
// phonemizers already say numbers, years, times and money. A word written
// with its phonemes is left as it is (docs/plan-voice-phonemes.md).
import { PHONEME_MARK } from "@ttmi/model";

const UNITS: Record<string, string> = {
  ms: "milliseconds",
  s: "seconds",
  sec: "seconds",
  min: "minutes",
  h: "hours",
  kb: "kilobytes",
  mb: "megabytes",
  gb: "gigabytes",
  tb: "terabytes",
  "%": "percent",
};

// Each word with its phonemes stands in as a character of its own while
// the rest is cleaned up, so nothing reads inside it.
const HOLDER = /\uE000([\uE100-\uF8FF])/g;

export function speakable(text: string): string {
  const kept: string[] = [];
  const held = text.replace(PHONEME_MARK, (mark) => `\uE000${String.fromCharCode(0xe100 + kept.push(mark) - 1)}`);
  return said(held).replace(HOLDER, (_, at: string) => kept[at.charCodeAt(0) - 0xe100]!);
}

function said(text: string): string {
  return text
    // Asides in parentheses are said between commas.
    .replace(/\s*\(([^()]+)\)\s*([,.;:!?]?)/g, (_, inside: string, after: string) => `, ${inside.trim()}${after || ","} `)
    .replace(/\be\.g\.,?\s*/gi, "for example, ")
    .replace(/\bi\.e\.,?\s*/gi, "that is, ")
    .replace(/\betc\.?/gi, "and so on")
    .replace(/\bvs\.?\s/gi, "versus ")
    .replace(/\s*(?:->|→|=>)\s*/g, " to ")
    .replace(/\s*(?:<-|←)\s*/g, " from ")
    .replace(/\s+&\s+/g, " and ")
    // Words either side of a slash are a choice.
    .replace(/\b([A-Za-z]{2,})\/([A-Za-z]{2,})\b/g, "$1 or $2")
    // Version and multiplier.
    .replace(/\bv(\d+(?:\.\d+)*)\b/g, "version $1")
    .replace(/\b(\d+(?:\.\d+)?)x\b/g, "$1 times")
    // Units after a number.
    .replace(/\b(\d+(?:\.\d+)?)\s?(ms|sec|min|kb|mb|gb|tb|s|h)\b/gi, (_, n: string, unit: string) => `${n} ${UNITS[unit.toLowerCase()]}`)
    .replace(/(\d)\s?%/g, "$1 percent")
    // Inline code marks and leftovers.
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\s+,/g, ",")
    .replace(/,\s*,/g, ",")
    .replace(/,\s*([.;:!?])/g, "$1")
    .replace(/ {2,}/g, " ")
    .trim();
}
