// Browser entry (game.html): install the web platform, then start the shared game app.
import { setPlatform } from '../core/platform';
import { createWebPlatform } from './platform';

setPlatform(createWebPlatform());
await import('./app');
