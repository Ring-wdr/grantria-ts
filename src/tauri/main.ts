// Tauri entry (tauri.html): install the Tauri platform, then start the shared game app from src/web.
import { setPlatform } from '../core/platform';
import { createTauriPlatform } from './platform';

setPlatform(await createTauriPlatform());
await import('../web/app');
