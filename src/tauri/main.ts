// Tauri entry (tauri.html): install the Tauri platform, find the game data (bundled in the app, or imported from
// the player's APK into the webview's storage), then start the shared game app from src/web.
import { platform, setPlatform } from '../core/platform';
import { installAssets } from '../web/platform';
import { createTauriPlatform } from './platform';

setPlatform(await createTauriPlatform());
await installAssets(platform());
await import('../web/app');
