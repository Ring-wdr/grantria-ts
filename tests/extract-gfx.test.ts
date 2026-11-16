// src/extract/gfx.ts against the Python build (tools/build_web_assets.py build_images / build_cmf).
import assert from 'node:assert/strict';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { inflateSync } from 'node:zlib';
import { buildCmf, buildImages } from '../src/extract/gfx.ts';
import { apkDir, REF_DIR, refBytes, refJson, skipExtract } from './extract-helper.ts';

/** PNG -> [w, h, RGBA] (8-bit RGBA, every row filter 0, as write_png / encodePng make it) */
function decodePng(png: Uint8Array): [number, number, Uint8Array] {
  const dv = new DataView(png.buffer, png.byteOffset, png.byteLength);
  let p = 8, w = 0, h = 0;
  const idat: Uint8Array[] = [];
  while (p < png.length) {
    const len = dv.getUint32(p), type = String.fromCharCode(...png.subarray(p + 4, p + 8));
    const body = png.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') {
      w = dv.getUint32(p + 8); h = dv.getUint32(p + 12);
      assert.deepEqual([...body.subarray(8, 13)], [8, 6, 0, 0, 0]);
    } else if (type === 'IDAT') idat.push(body);
    p += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = w * 4, out = new Uint8Array(w * h * 4);
  assert.equal(raw.length, h * (stride + 1));
  for (let y = 0; y < h; y++) {
    assert.equal(raw[y * (stride + 1)], 0, 'filter 0');
    out.set(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)), y * stride);
  }
  return [w, h, out];
}

function refFiles(dir: string, out: string[] = []): string[] {
  for (const f of readdirSync(join(REF_DIR, dir))) {
    const r = `${dir}/${f}`;
    if (statSync(join(REF_DIR, r)).isDirectory()) refFiles(r, out); else out.push(r);
  }
  return out;
}

test('images and cmf match the Python build', { skip: skipExtract }, async () => {
  const files = apkDir();
  const out = new Map<string, Uint8Array | string>();
  const emit = (path: string, data: Uint8Array | string) => { out.set(path, data); };
  const t0 = performance.now();
  const nImg = await buildImages(files, emit);
  const t1 = performance.now();
  const nCmf = await buildCmf(files, emit);
  const t2 = performance.now();
  console.log(`buildImages ${nImg} in ${(t1 - t0).toFixed(0)} ms, buildCmf ${nCmf} in ${(t2 - t1).toFixed(0)} ms`);

  const want = [...refFiles('images'), ...refFiles('cmf'), 'images.json'].sort();
  assert.deepEqual([...out.keys()].sort(), want);

  assert.deepStrictEqual(JSON.parse(out.get('images.json') as string), refJson('images.json'));
  for (const [path, data] of out) {
    if (path.startsWith('cmf/')) {
      assert.deepStrictEqual(JSON.parse(data as string), refJson(path), path);
    } else if (path.endsWith('.png')) {
      const [w, h, px] = decodePng(data as Uint8Array);
      const [rw, rh, rpx] = decodePng(refBytes(path));
      assert.deepEqual([w, h], [rw, rh], path);
      assert.ok(Buffer.from(px).equals(Buffer.from(rpx)), `${path} pixels`);
    }
  }
});
