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

// Host <-> game: a host reaches the game only through the Platform ports, and the native side reaches the page
// only through Tauri (invoke, events, plugins). Nothing registers window hooks for a shell to evaluate, the
// shared web app never asks which host it runs in, and the Android code never runs script in the webview.
test('no shell hooks: no window globals for the shell, no host-name branches, no script evaluation', () => {
  const kotlin = fileURLToPath(new URL('../src-tauri/gen/android/app/src/main/java/', import.meta.url));
  const kt = (dir: string): string[] => readdirSync(dir).filter((f) => f !== 'generated').flatMap((f) => {   // generated/: Tauri's own
    const p = join(dir, f);
    return statSync(p).isDirectory() ? kt(p) : p.endsWith('.kt') ? [p] : [];
  });
  const check = (paths: string[], res: RegExp[]) => paths.flatMap((f) => {
    const src = readFileSync(f, 'utf-8');
    return res.filter((re) => re.test(src)).map((re) => `${relative(root, f)}: ${re.source}`);
  });
  const bad = [
    ...check(files(root), [/__grantria\w*/, /GrantriaAndroid/]),
    ...check(files(join(root, 'web')), [/platform\(\)\.name/]),
    ...check(kt(kotlin), [/evaluateJavascript/, /addJavascriptInterface/, /webView\.eval|\.loadUrl\(\s*"javascript:/]),
  ];
  assert.deepEqual(bad, []);
});

test('tauri uses only core, the shared web entry points and @tauri-apps', () => {
  const ok = (s: string) => s.startsWith('@tauri-apps/') || s.startsWith('../core/') || s === '../web/platform' || s === '../web/app' || s.startsWith('./');
  const bad = files(join(root, 'tauri')).flatMap((f) => imports(f).filter((s) => !ok(s)).map((s) => `${relative(root, f)}: ${s}`));
  assert.deepEqual(bad, []);
});
