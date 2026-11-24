// The bundled font files, as URLs (Vite's ?url).
declare module "*.woff2?url" {
  const url: string;
  export default url;
}
