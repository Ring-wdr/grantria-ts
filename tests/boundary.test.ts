// Layering: src/core is the platform-free game (rules, combat, world, saves). It must not import the
// browser renderer (src/web), a host shell (src/tauri) or rendering libraries, so it can be driven by
// any front end. tsconfig.core.json checks the same without the DOM types.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
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

// The APK extractor (src/extract) turns the player's APK into the asset files: plain bytes in, files out. It runs in a
// page, a Tauri webview and node tests alike, so it reaches no game code, renderer, host or node module.
test('extract imports only its own files', () => {
  const bad = files(join(root, 'extract')).flatMap((f) => imports(f).filter((s) => !s.startsWith('./')).map((s) => `${relative(root, f)}: ${s}`));
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

// 절전 모드: the 0.1.7 ways live in web/legacy/ and only web/power.ts picks between them and the current ones, so no
// other module branches on the option and retiring a legacy way touches nothing else
test('only web/power.ts imports web/legacy and reads powerSave', () => {
  const web = join(root, 'web'), power = join(web, 'power.ts'), legacy = join(web, 'legacy');
  const settings = join(web, 'game', 'convenience.ts');                    // the 편의 설정 row that sets it
  const bad = files(web).filter((f) => f !== power && !f.startsWith(legacy)).flatMap((f) => [
    ...imports(f).filter((s) => /(^|\/)legacy\//.test(s)).map((s) => `${relative(root, f)}: ${s}`),
    ...(f !== settings && /\bpowerSave\b/.test(readFileSync(f, 'utf-8')) ? [`${relative(root, f)}: powerSave`] : []),
  ]);
  assert.deepEqual(bad, []);
});

test('tauri uses only core, the shared web entry points and @tauri-apps', () => {
  const ok = (s: string) => s.startsWith('@tauri-apps/') || s.startsWith('../core/') || s === '../web/platform' || s === '../web/app' || s.startsWith('./');
  const bad = files(join(root, 'tauri')).flatMap((f) => imports(f).filter((s) => !ok(s)).map((s) => `${relative(root, f)}: ${s}`));
  assert.deepEqual(bad, []);
});

// 원정(가제): the standalone extra mode stays apart from main play. Its two folders reach none of the field game, combat,
// rules or saves (only the skeleton: data loaders, render drawables, input, sound, the web renderer), and main play
// reaches it only through the title's screen change (WebScreens in web/game/screens.ts)
test('expedition stays apart from main play', () => {
  const core = join(root, 'core', 'expedition'), web = join(root, 'web', 'expedition');
  const inside = (f: string) => f.startsWith(core) || f.startsWith(web);
  const target = (f: string, s: string) => relative(root, resolve(dirname(f), s)).replaceAll('\\', '/');   // src-relative
  const banned = (f: string, s: string) => s.startsWith('.') && /^core\/(field|combat|rules)\/|^core\/save\/save$/.test(target(f, s));
  const wiring = [join(root, 'web', 'game', 'screens.ts')];
  const bad = [
    ...[...files(core), ...files(web)].flatMap((f) => imports(f).filter((s) => banned(f, s)).map((s) => `${relative(root, f)}: ${s}`)),
    ...files(root).filter((f) => !inside(f) && !wiring.includes(f)).flatMap((f) =>
      imports(f).filter((s) => s.startsWith('.') && /^(core|web)\/expedition\//.test(target(f, s))).map((s) => `${relative(root, f)}: ${s}`)),
  ];
  assert.deepEqual(bad, []);
});
