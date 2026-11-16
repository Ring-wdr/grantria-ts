// Browser entry (game.html): install the web platform, find the game data (bundled, stored, or the player's APK),
// then start the shared game app.
import { platform, setPlatform } from '../core/platform';
import { createWebPlatform, installAssets } from './platform';

setPlatform(createWebPlatform());
await installAssets(platform());
await import('./app');
