import { resolve } from 'node:path';
import { defineConfig } from 'vite';

// Tauri runs `npm run dev` / `npm run build` from src-tauri (tauri.conf.json); the dev server must stay on 5173.
// PORT (set by the Claude preview launcher) moves only that preview server.
export default defineConfig({
  clearScreen: false,
  server: { port: Number(process.env.PORT) || 5173, strictPort: true },
  envPrefix: ['VITE_', 'TAURI_ENV_'],
  build: {
    target: 'es2022',
    rollupOptions: {
      input: {
        viewer: resolve(import.meta.dirname, 'index.html'),
        game: resolve(import.meta.dirname, 'game.html'),
        tauri: resolve(import.meta.dirname, 'tauri.html'),
      },
    },
  },
});
