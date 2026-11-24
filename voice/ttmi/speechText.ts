// What the voice is given, as words. blixt/phonon does not run Gradium's
// rewriter, so the cases that rewriter changes are written out here. The
// product's own rules sit on top: a spaced em dash or en dash becomes a
// comma, a bare "id" or "ids" is said "I-D", and a line with no stop is
// given one so the ending can fall. A hyphen inside a word stays.

const TLD = new Set(["ai", "app", "co", "com", "de", "dev", "edu", "fr", "gov", "io", "net", "org", "uk"]);

function spellShort(word: string): string {
  if (/^www$/i.test(word)) return "W-W-W";
  if (/^[A-Za-z]{2}$/.test(word)) return `${word[0]!.toUpperCase()}-${word[1]!.toUpperCase()}`;
  return word;
}

function speakPiece(part: string): string {
  const words: string[] = [];
  let start = 0;
  for (let i = 0; i < part.length; i++) {
    const c = part[i]!;
    const spoken = c === "-" ? "dash" : c === "/" ? "slash" : /[0-9]/.test(c) ? c : "";
    if (!spoken) continue;
    if (start < i) words.push(spellShort(part.slice(start, i)));
    words.push(spoken);
    start = i + 1;
  }
  if (start < part.length) words.push(spellShort(part.slice(start)));
  return words.filter(Boolean).join(" ");
}

function speakUrl(word: string): string | undefined {
  let rest = word;
  const lead: string[] = [];
  if (rest.startsWith("https://")) {
    lead.push("H-T-T-P-S", "colon", "slash", "slash");
    rest = rest.slice("https://".length);
  } else if (rest.startsWith("http://")) {
    lead.push("H-T-T-P", "colon", "slash", "slash");
    rest = rest.slice("http://".length);
  }
  const body = /^[\w.-]+(?:\/[\w./-]*)?/.exec(rest);
  if (!body) return undefined;
  const hostAndPath = body[0]!;
  const slash = hostAndPath.indexOf("/");
  const host = slash < 0 ? hostAndPath : hostAndPath.slice(0, slash);
  const path = slash < 0 ? "" : hostAndPath.slice(slash);
  const labels = host.split(".").filter(Boolean);
  if (labels.length < 2 || !TLD.has(labels.at(-1)!.toLowerCase())) return undefined;
  const spoken = [...lead];
  labels.forEach((label, index) => {
    if (index) spoken.push("dot");
    spoken.push(speakPiece(label));
  });
  if (path) spoken.push(speakPiece(path));
  const suffix = word.slice((word.startsWith("https://") ? "https://".length : word.startsWith("http://") ? "http://".length : 0) + hostAndPath.length);
  return `${spoken.join(" ")}${suffix}`;
}

function speakEmail(word: string): string | undefined {
  const match = /^([\w.+-]+)@([\w.-]+\.[A-Za-z]{2,})(.*)$/.exec(word);
  if (!match) return undefined;
  const local = match[1]!.split(".").join(" dot ");
  const host = speakUrl(match[2]!);
  if (!host) return undefined;
  return `${local} at ${host}${match[3] ?? ""}`;
}

function spellAddresses(text: string): string {
  return text
    .split(/(\s+)/)
    .map((part) => {
      if (!part || /^\s+$/.test(part)) return part;
      return speakEmail(part) ?? speakUrl(part) ?? part;
    })
    .join("");
}

function spellSymbols(text: string): string {
  return text
    .replace(/\$(\d+(?:\.\d+)?)/g, "$1 dollars")
    .replace(/£(\d+(?:\.\d+)?)/g, "$1 pounds")
    .replace(/€(\d+(?:\.\d+)?)/g, "$1 euros")
    .replace(/×/g, " times ")
    .replace(/≈/g, " approximately ")
    .replace(/@/g, " at ")
    .replace(/\+/g, " plus ")
    .replace(/=/g, " equals ")
    .replace(/\b(\d{1,3}),000\b/g, "$1 thousand")
    .replace(/\b(\d+)\.(\d+)\b/g, "$1 point $2");
}

function spellPauses(text: string): string {
  return text
    .replace(/\s*\(\s*/g, ", ")
    .replace(/\s*\)\s*/g, ", ")
    .replace(/\s*;\s*/g, ", ")
    .replace(/\s+:\s+/g, ", ");
}

function tidy(text: string): string {
  return text
    .replace(/\s+/g, " ")
    .replace(/\s+,/g, ",")
    .replace(/,(?=[^\s])/g, ", ")
    .replace(/(?:,\s*){2,}/g, ", ")
    .trim();
}

// The words a bare "id" is said as. Inside another word ("valid") it stays.
function spellIds(text: string): string {
  return text.replace(/(?<![\p{L}\p{N}_])ids?(?![\p{L}\p{N}_])/giu, (word) => (word.toLowerCase() === "ids" ? "I-Ds" : "I-D"));
}

function pauseAtDashes(text: string): string {
  return text.replace(/([,;:]?)(?:\s+[–—]\s*|\s*[–—]\s+)/g, (_match, mark: string) => (mark ? `${mark} ` : ", "));
}

function closeStatement(text: string): string {
  const trimmed = text.trim();
  if (!trimmed || /[.!?…]["')\]]*$/u.test(trimmed)) return text;
  return `${trimmed}.`;
}

// The text the model is given.
export function speechText(text: string): string {
  return closeStatement(tidy(spellPauses(spellSymbols(spellAddresses(pauseAtDashes(spellIds(text)))))));
}
