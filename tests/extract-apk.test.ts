// The whole browser build (src/extract/build.ts) from the APK file itself, through the zip reader: the same file set
// as the Python build (public/assets) and the same contents (JSON parsed, binaries byte for byte; PNG pixels are
// checked in extract-gfx.test.ts). GRANTRIA_APK=<path to your grantria.apk> turns it on.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { buildAssets, openApk } from '../src/extract/build.ts';
import { REF_DIR, refBytes, refJson } from './extract-helper.ts';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const APK = process.env.GRANTRIA_APK ?? '';
const skip = APK && existsSync(APK) && existsSync(join(REF_DIR, 'tables.json')) ? false
  : 'set GRANTRIA_APK to your grantria.apk (and run npm run assets for the reference)';

const refFiles = (d = REF_DIR, rel = ''): string[] => readdirSync(d).flatMap((f) => {
  const p = join(d, f), r = rel ? `${rel}/${f}` : f;
  return statSync(p).isDirectory() ? refFiles(p, r) : [r];
});

test('the APK builds the same files as tools/build_web_assets.py', { skip }, async () => {
  const { files, known } = await openApk(new Uint8Array(readFileSync(APK)));
  assert.equal(known, true);
  const out = new Map<string, Uint8Array | string>();
  const t0 = performance.now();
  await buildAssets(files, (p, d) => { out.set(p, d); });
  console.log(`build ${Math.round(performance.now() - t0)} ms, ${out.size} files`);
  assert.deepEqual([...out.keys()].sort(), refFiles().sort());
  for (const [p, d] of out) {
    if (p.endsWith('.json')) assert.deepStrictEqual(JSON.parse(d as string), refJson(p), p);
    else if (!p.endsWith('.png')) assert.ok(Buffer.from(d as Uint8Array).equals(refBytes(p)), p);
  }
});
