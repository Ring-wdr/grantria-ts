// The launcher icon picked from an APK for the installed web app's icon (src/web/appIcon.ts): the largest PNG among
// res/drawable*|mipmap*/icon|ic_launcher.png, by the width in its IHDR.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { apkIcon, isIconPath } from '../src/extract/build.ts';
import type { ApkFiles } from '../src/extract/zip.ts';

/** just enough of a PNG for the picker: signature, IHDR length/type, width, height */
const png = (w: number) => {
  const b = new Uint8Array(33);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  new DataView(b.buffer).setUint32(16, w);
  new DataView(b.buffer).setUint32(20, w);
  return b;
};

const files = (m: Record<string, Uint8Array>): ApkFiles => {
  const names = Object.keys(m).sort();
  return { get: (p) => m[p], list: (prefix) => names.filter((n) => n.startsWith(prefix)) };
};

test('icon paths', () => {
  assert.ok(isIconPath('res/drawable-hdpi-v4/icon.png'));
  assert.ok(isIconPath('res/drawable/icon.png'));
  assert.ok(isIconPath('res/mipmap-xxhdpi-v4/ic_launcher.png'));
  assert.ok(!isIconPath('res/mipmap-xxhdpi-v4/ic_launcher_round.png'));
  assert.ok(!isIconPath('res/raw/s0.ogg'));
  assert.ok(!isIconPath('assets/icon.png'));
});

test('the largest launcher icon wins, other files and broken PNGs are skipped', () => {
  const big = png(72);
  const f = files({
    'res/drawable-mdpi-v4/icon.png': png(48),
    'res/drawable-hdpi-v4/icon.png': big,
    'res/drawable-xhdpi-v4/icon.png': new Uint8Array(40),     // not a PNG
    'res/drawable-hdpi-v4/splash.png': png(480),
  });
  assert.equal(apkIcon(f), big);
  assert.equal(apkIcon(files({ 'res/raw/s0.ogg': new Uint8Array(4) })), undefined);
});
