// Layering: src/core is the platform-free game (rules, combat, world, saves). It must not import the
// browser renderer (src/web), a host shell (src/tauri) or rendering libraries, so it can be driven by
// any front end. tsconfig.core.json checks the same without the DOM types.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../src/', import.meta.url));
const files = (dir: string): string[] => readdirSync(dir).flatMap((f) => {
  const p = join(dir, f);
  return statSync(p).isDirectory() ? files(p) : p.endsWith('.ts') ? [p] : [];
});
const imports = (p: string) => [...readFileSync(p, 'utf-8').matchAll(/(?:from|import)\s*\(?\s*'([^']+)'/g)].map((m) => m[1]);

test('core imports nothing from web, tauri or rendering libraries', () => {
  const bad: string[] = [];
  for (const f of files(join(root, 'core'))) {
    for (const spec of imports(f)) {
      if (/(^|\/)(web|tauri)\//.test(spec) || /^(three|@tauri-apps)/.test(spec) || spec.endsWith('.css')) bad.push(`${relative(root, f)}: ${spec}`);
    }
  }
  assert.deepEqual(bad, []);
});

test('web does not import the tauri host', () => {
  const bad = files(join(root, 'web')).flatMap((f) => imports(f).filter((s) => /(^|\/)tauri\//.test(s) || s.startsWith('@tauri-apps')).map((s) => `${relative(root, f)}: ${s}`));
  assert.deepEqual(bad, []);
});
