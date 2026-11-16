// Browser entry (game.html): install the web platform, find the game data (bundled, stored, or the player's APK),
// then start the shared game app.
import { platform, setPlatform } from '../core/platform';
import { createWebPlatform, installAssets } from './platform';

setPlatform(createWebPlatform());
// the public web build is an installable app that opens offline (pwa/sw.js); a personal build has no worker
if (import.meta.env.PROD && import.meta.env.MODE === 'pages') {
  navigator.serviceWorker?.register(`${import.meta.env.BASE_URL}sw.js`).catch((e) => console.warn('service worker:', e));
}
await installAssets(platform());
await import('./app');
