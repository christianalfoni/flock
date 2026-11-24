// The board draws in the site's own fonts (docs/board.md, Fonts), bundled
// here so any page that mounts the board has them and every browser,
// headless or not, measures a sketch the same way.
import "@fontsource-variable/instrument-sans";
import "@fontsource-variable/instrument-sans/wght-italic.css";
import "@fontsource-variable/geist-mono";
import sansItalicUrl from "@fontsource-variable/instrument-sans/files/instrument-sans-latin-wght-italic.woff2?url";
import sansUrl from "@fontsource-variable/instrument-sans/files/instrument-sans-latin-wght-normal.woff2?url";
import monoUrl from "@fontsource-variable/geist-mono/files/geist-mono-latin-wght-normal.woff2?url";

export const SANS = '"Instrument Sans Variable"';
export const MONO = '"Geist Mono Variable"';

// A face that never arrives (offline, blocked) must not hold the board up.
const PATIENCE = 3000;

// Resolves once the faces the text needs are loaded: before it, a cold page
// would measure with the fallback and lay the sketch out for the wrong
// font. Only the subsets the text uses are fetched.
export function fontsReady(text = "") {
  const sample = text || "A";
  const loads = Promise.all([
    document.fonts.load(`500 14px ${SANS}`, sample),
    document.fonts.load(`italic 400 14px ${SANS}`, sample),
    document.fonts.load(`400 14px ${MONO}`, sample),
  ]).then(() => document.fonts.ready);
  return Promise.race([loads, new Promise((resolve) => setTimeout(resolve, PATIENCE))]).then(() => undefined, () => undefined);
}

// The PNG export paints an SVG image, which loads nothing from outside it,
// so it carries the latin faces as data.
let embedded: Promise<string> | undefined;
export function embeddedFontCss() {
  embedded ??= Promise.all([
    face(SANS, "normal", sansUrl),
    face(SANS, "italic", sansItalicUrl),
    face(MONO, "normal", monoUrl),
  ]).then((faces) => faces.join("\n"), (cause) => {
    embedded = undefined;
    throw cause;
  });
  return embedded;
}

async function face(family: string, style: string, url: string) {
  const bytes = new Uint8Array(await (await fetch(url)).arrayBuffer());
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  return `@font-face { font-family: ${family}; font-style: ${style}; font-weight: 400 700; src: url(data:font/woff2;base64,${btoa(binary)}) format("woff2"); }`;
}
