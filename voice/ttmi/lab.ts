// The voice lab (/voice-lab): proofs of concept for a calmer narration.
// Not used by the board. Round two: a step is always ONE call to Kokoro,
// as on the board, because cutting it into calls sounded artificial. What
// is left to play with is what Kokoro understands on its own:
//   speed         one number per call, so per step
//   punctuation   , ; : — … . ? !  each makes its own pause and melody
//   stress        ˈ and ˌ in the phonemes it is given
//
// Kokoro's own pauses are all short (about 0.25 to 0.3 s, whichever the
// mark), so a pause can also be HELD: the step is still one call, and
// silence is put into its audio where the mark was said, found from the
// model's timings. The melody stays whole.
//
// The lab's markup compiles to those:
//   [beat] [pause] [long]   a pause: a mark, and how long to hold it
//   a blank line            a paragraph, likewise
//   a sentence's end        likewise, when a hold is set for it
//   *word*                  emphasis, in whichever way is chosen

export const MARKS = [" ", ",", ";", ":", " —", "…", ".", "...", ". …", "… …", "?"] as const;
export type Mark = (typeof MARKS)[number];

export type Emphasis = "none" | "stress" | "dash" | "commas" | "colon";
export const EMPHASES: { id: Emphasis; name: string; about: string }[] = [
  { id: "none", name: "None", about: "The word as written." },
  { id: "stress", name: "Stress", about: "Every syllable's stress made primary in the phonemes, which is what misaki's [word](+2) does." },
  { id: "dash", name: "Dash before", about: "A dash before the word: a held breath, then the word." },
  { id: "commas", name: "Commas around", about: "Set off with commas, as if in apposition." },
  { id: "colon", name: "Colon before", about: "A colon before: the word as the payoff." },
];

export type LabOptions = {
  speed: number;
  // Slower for a dense step, a little faster for a light one.
  paced: boolean;
  beat: Mark;
  pause: Mark;
  long: Mark;
  paragraph: Mark;
  emphasis: Emphasis;
  // Silence added where each kind of pause is said, in seconds.
  hold: Hold;
  // Silence before the step speaks: the board's timing, not the voice's.
  leadIn: number;
};

export type Hold = { sentence: number; beat: number; pause: number; long: number; paragraph: number };
export const NO_HOLD: Hold = { sentence: 0, beat: 0, pause: 0, long: 0, paragraph: 0 };

export const TODAY: LabOptions = { speed: 1, paced: false, beat: " ", pause: " ", long: " ", paragraph: " ", emphasis: "none", hold: NO_HOLD, leadIn: 0 };

// A piece of the text Kokoro gets: an emphasized one is stressed in its
// phonemes, and hold is the silence to put in before it is said.
export type Piece = { text: string; emphasis?: boolean; hold?: number };

// text: what Kokoro is given. shown: the same with the holds, ⏸0.40.
export type Compiled = { pieces: Piece[]; text: string; shown: string; speed: number; complexity: Complexity; leadIn: number };

// Where a hold goes, inside the text until it is cut into pieces.
const held = (seconds: number) => (seconds > 0 ? `\u0001${seconds}\u0001` : "");

const STOP = /^[.!?…]/;

export function compile(script: string, options: LabOptions): Compiled {
  const hold = options.hold;
  const marked = (mark: Mark, seconds: number) => `${mark === " " ? " " : mark === " —" ? " — " : `${mark} `}${held(seconds)}`;
  let text = script
    // [hold N]: silence and no mark, where the pacing puts it (not markup
    // for agents; src/voice/pacing.ts writes it).
    .replace(/\s*\[hold\s+([\d.]+)\]\s*/gi, (_, seconds: string) => `\u0000 ${held(Number(seconds))}`)
    .replace(/\s*\[beat\]\s*/gi, () => `\u0000${marked(options.beat, hold.beat)}`)
    .replace(/\s*\[pause\]\s*/gi, () => `\u0000${marked(options.pause, hold.pause)}`)
    .replace(/\s*\[long\]\s*/gi, () => `\u0000${marked(options.long, hold.long)}`)
    .replace(/\s*\n\s*\n\s*/g, () => `\u0000${marked(options.paragraph, hold.paragraph)}`)
    // A written pause after the sentence's own stop: the pause wins, but a
    // question or exclamation keeps its mark, which is its melody.
    .replace(/([.!?…,;:]*)\u0000([^\s\u0001]*)\s*((?:\u0001[\d.]+\u0001)?)\s*/g, (_, stop: string, mark: string, seconds: string) => {
      if (/[?!]/.test(stop)) return `${stop} ${seconds}`;
      if (!mark) return `${stop}${stop ? " " : " "}${seconds}`;
      return `${mark === "—" ? " — " : `${mark} `}${seconds}`;
    })
    // Every other sentence's end, held when a hold is set for sentences.
    .replace(/([.!?…]["”)]?)\s+(?=[^\s\u0001])/g, (_, stop: string) => `${stop} ${held(hold.sentence)}`)
    .replace(/[ \t\n]+/g, " ")
    .trim();
  switch (options.emphasis) {
    case "none":
      text = text.replace(/\*([^*]+)\*/g, "$1");
      break;
    case "dash":
      text = text.replace(/\s*\*([^*]+)\*/g, " — $1");
      break;
    case "commas":
      text = text.replace(/\s*\*([^*]+)\*/g, ", $1,");
      break;
    case "colon":
      text = text.replace(/\s*\*([^*]+)\*/g, ": $1");
      break;
  }
  // What emphasis put next to other marks: no space before a mark, and of
  // two marks in a row the stronger.
  text = text
    .replace(/\s+([,:;.?!])/g, "$1")
    .replace(/[,:;]+([.?!…])/g, "$1")
    .replace(/,([:;])/g, "$1")
    .replace(/([,;:])(\s*[,;:])+/g, "$1")
    .replace(/ {2,}/g, " ")
    .trim();
  const pieces: Piece[] = [];
  text.split(/\u0001([\d.]+)\u0001/).forEach((part, index) => {
    if (index % 2) {
      pieces.push({ text: "", hold: Number(part) });
      return;
    }
    part.split(/\*([^*]+)\*/).forEach((bit, inner) => {
      if (!bit) return;
      const piece: Piece = inner % 2 ? { text: bit, emphasis: true } : { text: bit };
      // The hold waiting for the next words goes on them.
      const last = pieces.at(-1);
      if (last && !last.text && last.hold) {
        pieces.pop();
        piece.hold = last.hold;
      }
      pieces.push(piece);
    });
  });
  const said = pieces.filter((piece) => piece.text);
  const complexity = measure(plainText(script));
  const speed = options.paced ? options.speed * complexity.factor : options.speed;
  return {
    pieces: said,
    text: said.map((piece) => piece.text).join("").trim(),
    shown: said.map((piece) => `${piece.hold ? `⏸${piece.hold.toFixed(2)} ` : ""}${piece.text}`).join("").trim(),
    speed: round(speed),
    complexity,
    leadIn: options.leadIn,
  };
}

// The script as the board would say it: the lab's markup gone.
export function plainText(script: string): string {
  return script.replace(/\[(?:beat|pause|long|hold\s+[\d.]+)\]/gi, " ").replace(/\*([^*]+)\*/g, "$1").replace(/[ \t]+/g, " ").trim();
}

// How dense a step is, and what that does to its speed. Speech rate and
// complexity multiply, and dense content gets more time; a light step
// speeds up a touch.
export type Complexity = { score: number; factor: number; reasons: string[] };

export function measure(text: string): Complexity {
  const sentences = text.split(/(?<=[.!?…])\s+/).filter((sentence) => /\w/.test(sentence));
  const words = text.match(/[\p{L}\p{N}][\p{L}\p{N}'_-]*/gu) ?? [];
  if (!words.length) return { score: 0, factor: 1, reasons: [] };
  const perSentence = words.length / Math.max(1, sentences.length);
  const long = words.filter((word) => word.length >= 9).length / words.length;
  const terms = words.filter((word) => /[a-z][A-Z]|_|\d|^[A-Z]{2,}$/.test(word)).length;
  const commas = (text.match(/,/g) ?? []).length / Math.max(1, sentences.length);
  const score = round(clamp(
    clamp((perSentence - 10) / 12) * 0.35 + clamp((long - 0.08) / 0.17) * 0.25 + clamp(terms / 4) * 0.25 + clamp((commas - 1) / 3) * 0.15,
  ));
  const reasons = [`${perSentence.toFixed(0)} words a sentence`, `${Math.round(long * 100)}% long words`, `${terms} term${terms === 1 ? "" : "s"}`, `${commas.toFixed(1)} commas a sentence`];
  // 0 → 1.04, 0.5 → about 0.97, 1 → 0.88.
  return { score, factor: round(1.04 - 0.16 * score ** 1.2), reasons };
}

// More weight on a word's phonemes: every stress primary, and one at the
// start when it had none.
export function emphasize(phonemes: string): string {
  const stressed = phonemes.replace(/ˌ/g, "ˈ");
  return stressed.includes("ˈ") ? stressed : `ˈ${stressed}`;
}

const clamp = (value: number) => Math.max(0, Math.min(1, value));
const round = (value: number) => Math.round(value * 1000) / 1000;
