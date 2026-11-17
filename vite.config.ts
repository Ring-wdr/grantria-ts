import { resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';

// Tauri runs `npm run dev` / `npm run build` from src-tauri (tauri.conf.json); the dev server must stay on 5173.
// PORT (set by the Claude preview launcher) moves only that preview server.
//
// `vite build --mode pages` (npm run build:pages) is the public web build for GitHub Pages: the game page only,
// pwa/ instead of the public/ folder, so game data made with npm run assets can never ship with it. Players import their
// own APK in the page instead (src/web/assetGate.ts).

/** Original game files or data made from them: never in a public build */
const GAME_DATA = /\.(apk|so|dat|pal|pxl|ogg)$|(^|\/)(images|cmf|maps|sound|items|ref)\/|(^|\/)(images|text|tables|boss_boxes)\.json$/;

/** pages build: index.html opens the game, the game page is an installable app (pwa/: manifest, icons, service
 *  worker; iPhone: the home screen tags) with a link preview (pwa/og-image.png, an original picture made for this
 *  repository, no game art), and the build fails if any game data got into the bundle */
function pagesOnly(base: string, site: string): Plugin {
  const title = '그란트리아 (grantria-ts)';
  const description = '그란트리아 웹 포트. 가지고 있는 grantria.apk에서 기기 안에서 에셋을 만들어 실행합니다.';
  return {
    name: 'grantria-pages',
    transformIndexHtml: () => [
      { tag: 'meta', attrs: { name: 'description', content: description }, injectTo: 'head' },
      { tag: 'meta', attrs: { property: 'og:type', content: 'website' }, injectTo: 'head' },
      { tag: 'meta', attrs: { property: 'og:title', content: title }, injectTo: 'head' },
      { tag: 'meta', attrs: { property: 'og:description', content: description }, injectTo: 'head' },
      { tag: 'meta', attrs: { property: 'og:url', content: `${site}game.html` }, injectTo: 'head' },
      { tag: 'meta', attrs: { property: 'og:image', content: `${site}og-image.png` }, injectTo: 'head' },
      { tag: 'meta', attrs: { property: 'og:image:width', content: '1200' }, injectTo: 'head' },
      { tag: 'meta', attrs: { property: 'og:image:height', content: '630' }, injectTo: 'head' },
      { tag: 'meta', attrs: { property: 'og:image:alt', content: title }, injectTo: 'head' },
      { tag: 'meta', attrs: { name: 'twitter:card', content: 'summary_large_image' }, injectTo: 'head' },
      { tag: 'link', attrs: { rel: 'manifest', href: `${base}manifest.webmanifest` }, injectTo: 'head' },
      { tag: 'link', attrs: { rel: 'apple-touch-icon', href: `${base}icons/apple-touch-icon.png` }, injectTo: 'head' },
      { tag: 'meta', attrs: { name: 'theme-color', content: '#000000' }, injectTo: 'head' },
      { tag: 'meta', attrs: { name: 'mobile-web-app-capable', content: 'yes' }, injectTo: 'head' },
      { tag: 'meta', attrs: { name: 'apple-mobile-web-app-capable', content: 'yes' }, injectTo: 'head' },
      { tag: 'meta', attrs: { name: 'apple-mobile-web-app-title', content: '그란트리아' }, injectTo: 'head' },
      { tag: 'meta', attrs: { name: 'apple-mobile-web-app-status-bar-style', content: 'black' }, injectTo: 'head' },
    ],
    generateBundle(_, bundle) {
      const leaked = Object.keys(bundle).filter((f) => GAME_DATA.test(f));
      if (leaked.length) this.error(`game data in the public build: ${leaked.slice(0, 5).join(', ')}`);
      this.emitFile({
        type: 'asset',
        fileName: 'index.html',
        // link previews read the page they were given, so the redirect carries the same card
        source: '<!doctype html><meta charset="utf-8"><title>Grantria</title>'
          + `<meta property="og:type" content="website"><meta property="og:title" content="${title}">`
          + `<meta property="og:description" content="${description}"><meta property="og:url" content="${site}">`
          + `<meta property="og:image" content="${site}og-image.png"><meta name="twitter:card" content="summary_large_image">`
          + '<meta http-equiv="refresh" content="0; url=game.html"><a href="game.html">Grantria</a>\n',
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const pages = mode === 'pages';
  // project pages live under /<repo>/; VITE_BASE overrides (a custom domain: '/')
  const base = pages ? process.env.VITE_BASE ?? `/${process.env.GITHUB_REPOSITORY?.split('/')[1] ?? 'grantria-ts'}/` : '/';
  // link previews need absolute URLs: the project pages host, or VITE_SITE_URL (a custom domain, ending in /)
  const owner = (process.env.GITHUB_REPOSITORY_OWNER ?? 'ring-wdr').toLowerCase();
  const site = process.env.VITE_SITE_URL ?? `https://${owner}.github.io${base}`;
  return {
    base,
    // pages: only pwa/ (manifest, icons, service worker), never public/ where npm run assets puts the game data
    publicDir: pages ? 'pwa' : 'public',
    clearScreen: false,
    server: { port: Number(process.env.PORT) || 5173, strictPort: true },
    envPrefix: ['VITE_', 'TAURI_ENV_'],
    plugins: pages ? [pagesOnly(base, site)] : [],
    build: {
      target: 'es2022',
      // the bundle's own files, apart from the game data's assets/ folder (public/assets in personal builds)
      assetsDir: 'static',
      rollupOptions: {
        input: pages
          ? { game: resolve(import.meta.dirname, 'game.html') }
          : {
              viewer: resolve(import.meta.dirname, 'index.html'),
              game: resolve(import.meta.dirname, 'game.html'),
              tauri: resolve(import.meta.dirname, 'tauri.html'),
            },
      },
    },
  };
});
