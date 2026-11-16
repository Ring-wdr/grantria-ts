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
 *  worker; iPhone: the home screen tags), and the build fails if any game data got into the bundle */
function pagesOnly(base: string): Plugin {
  return {
    name: 'grantria-pages',
    transformIndexHtml: () => [
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
        source: '<!doctype html><meta charset="utf-8"><title>Grantria</title>'
          + '<meta http-equiv="refresh" content="0; url=game.html"><a href="game.html">Grantria</a>\n',
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const pages = mode === 'pages';
  // project pages live under /<repo>/; VITE_BASE overrides (a custom domain: '/')
  const base = pages ? process.env.VITE_BASE ?? `/${process.env.GITHUB_REPOSITORY?.split('/')[1] ?? 'grantria-ts'}/` : '/';
  return {
    base,
    // pages: only pwa/ (manifest, icons, service worker), never public/ where npm run assets puts the game data
    publicDir: pages ? 'pwa' : 'public',
    clearScreen: false,
    server: { port: Number(process.env.PORT) || 5173, strictPort: true },
    envPrefix: ['VITE_', 'TAURI_ENV_'],
    plugins: pages ? [pagesOnly(base)] : [],
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
