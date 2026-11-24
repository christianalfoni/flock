// A portal target: a sketch id, or a ttmi sketch URL (docs/plan-portals.md).
const ID = /^[\w-]{1,80}$/;

function hostAllowed(name: string, host?: string) {
  const site = host?.toLowerCase().replace(/:\d+$/, "");
  return name === "ttmi.ai" || name === "www.ttmi.ai" || name.endsWith(".ttmi.ai") || (site !== undefined && name === site);
}

// The sketch id a link points at. A bare id, or a URL whose path is
// /s/<id> on ttmi.ai (or on `host`, the site the reader is on).
export function portalSketchId(value: string | undefined, host?: string): string | undefined {
  if (!value) return undefined;
  const text = value.trim();
  if (ID.test(text)) return text;
  return portalLabelId(text, host);
}

// A link that opens a page outside ttmi. A sketch id, or a ttmi sketch
// URL, is a canvas instead. javascript: and data: and anything else that
// is not http(s) are dropped.
export function externalHref(value: string | undefined): string | undefined {
  if (!value || portalSketchId(value)) return undefined;
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return undefined;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
  return value.trim();
}

// What to store for `link`: a canvas (a sketch id or a ttmi sketch URL),
// or an external http(s) URL. Anything else is left out.
export function keptLink(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const text = value.trim();
  if (!text) return undefined;
  if (portalSketchId(text)) return text;
  return externalHref(text);
}

// Sketch ids a text links to, before it has been laid out. The page
// starts fetching those sketches when the text arrives.
export function portalIdsInSource(source: string, host?: string): string[] {
  const ids = new Set<string>();
  for (const raw of source.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const link = /\blink\s+"([^"]*)"/.exec(line);
    const fromLink = link ? portalSketchId(link[1], host) : undefined;
    if (fromLink) ids.add(fromLink);
    const label = /\bbox\s+"([^"]*)"/.exec(line);
    const fromLabel = label ? portalLabelId(label[1], host) : undefined;
    if (fromLabel) ids.add(fromLabel);
  }
  return [...ids];
}

// A box label is a portal only when the whole label is a sketch URL.
// A ordinary word is not an id, or every box would be a portal.
export function portalLabelId(value: string | undefined, host?: string): string | undefined {
  if (!value) return undefined;
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return undefined;
  }
  if (!hostAllowed(url.hostname.toLowerCase(), host)) return undefined;
  return /^\/s\/([\w-]{1,80})\/?$/.exec(url.pathname)?.[1];
}
