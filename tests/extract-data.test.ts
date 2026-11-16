// src/extract/data.ts and items.ts read from your own decoded APK give the Python build's maps, text, tables and
// item tables (tools/build_web_assets.py, tools/grantria_items.py) value for value.
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { buildMaps, buildTables, buildText } from '../src/extract/data.ts';
import { buildItems } from '../src/extract/items.ts';
import type { ApkFiles, Emit } from '../src/extract/zip.ts';
import { apkDir, REF_DIR, refJson, skipExtract } from './extract-helper.ts';

const files: ApkFiles = skipExtract ? { get: () => undefined, list: () => [] } : apkDir();

async function run(build: (f: ApkFiles, e: Emit) => Promise<unknown>): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  await build(files, (path, data) => { out.set(path, typeof data === 'string' ? data : new TextDecoder().decode(data)); });
  return out;
}

const same = (out: Map<string, string>, path: string) =>
  assert.deepStrictEqual(JSON.parse(out.get(path) ?? 'null'), refJson(path), path);

test('maps/*.json', { skip: skipExtract }, async () => {
  const out = await run(buildMaps);
  const ref = readdirSync(join(REF_DIR, 'maps')).map((f) => `maps/${f}`).sort();
  assert.deepStrictEqual([...out.keys()].sort(), ref);
  for (const p of ref) same(out, p);
});

test('text.json', { skip: skipExtract }, async () => {
  same(await run(buildText), 'text.json');
});

test('tables.json', { skip: skipExtract }, async () => {
  same(await run(buildTables), 'tables.json');
});

test('items/*.json', { skip: skipExtract }, async () => {
  const out = await run(buildItems);
  const names = ['options', 'sets', 'gems', 'consumables', 'drops', 'starting', 'misc'].map((n) => `items/${n}.json`);
  assert.deepStrictEqual([...out.keys()], names);
  for (const p of names) same(out, p);
});
