import type { Shape } from "@ttmi/format";
import { embeddedFontCss } from "./fonts";
import { bounds } from "./shapes";
import { BACKGROUND, SKETCH_CSS } from "./styles";

// Clones the drawing without selection handles into an SVG foreignObject,
// with the board's CSS and fonts inlined (an SVG image loads nothing from
// outside it), and paints that onto a 2x canvas.
export async function exportSvg(world: HTMLDivElement | null, shapes: Shape[], extra: { x: number; y: number; w: number; h: number }[] = []) {
  let box = bounds(shapes);
  if (!world || !box) return undefined;
  // Group regions reach past their members.
  for (const rect of extra) box = { minX: Math.min(box.minX, rect.x), minY: Math.min(box.minY, rect.y), maxX: Math.max(box.maxX, rect.x + rect.w), maxY: Math.max(box.maxY, rect.y + rect.h) };
  const pad = 32;
  const width = Math.ceil(box.maxX - box.minX + pad * 2);
  const height = Math.ceil(box.maxY - box.minY + pad * 2);
  const clone = world.cloneNode(true) as HTMLDivElement;
  clone.querySelectorAll(".sketch-ui, .sketch-no-export").forEach((node) => node.remove());
  // A preview may be mid fade-in. The export is the finished drawing.
  clone.querySelectorAll<HTMLElement>(".sketch-portal-inset").forEach((node) => {
    node.style.animation = "none";
    node.style.opacity = "1";
  });
  clone.style.transform = `translate(${pad - box.minX}px, ${pad - box.minY}px)`;
  const markup = new XMLSerializer().serializeToString(clone);
  const fonts = await embeddedFontCss();
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><foreignObject x="0" y="0" width="${width}" height="${height}">`
    + `<div xmlns="http://www.w3.org/1999/xhtml" style="position:relative;width:${width}px;height:${height}px;overflow:hidden;background:${BACKGROUND}">`
    + `<style>${xmlText(`${fonts}\n${SKETCH_CSS}`)}</style>${markup}</div></foreignObject></svg>`;
  return { svg, width, height };
}

// The stylesheet as XML text: a "<" in it (an @property syntax) would end
// the element.
const xmlText = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;");

export async function exportPng(world: HTMLDivElement | null, shapes: Shape[], extra: { x: number; y: number; w: number; h: number }[] = []) {
  const drawing = await exportSvg(world, shapes, extra);
  if (!drawing) return undefined;
  const { svg, width, height } = drawing;
  const image = new Image();
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await image.decode();
  const scale = 2;
  const canvas = document.createElement("canvas");
  canvas.width = width * scale;
  canvas.height = height * scale;
  const context = canvas.getContext("2d")!;
  context.scale(scale, scale);
  context.drawImage(image, 0, 0);
  return await new Promise<Blob | undefined>((resolve) => canvas.toBlob((blob) => resolve(blob ?? undefined), "image/png"));
}
