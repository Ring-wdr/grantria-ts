// Skill detail texts (src/core/data/skillDetail.ts) against the original FUN_0004f6a8(2) run in the
// emulator over every class / skill / level / points / requirement state
// (tests/fixtures/skills/detail.json from tools/grantria_skilldetail.py, npm run fixtures; not committed).
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { skillDetail } from '../src/core/data/skillDetail.ts';

const DDAT = new URL('../public/assets/d.dat', import.meta.url), FIX = new URL('./fixtures/skills/detail.json', import.meta.url);
const skip = !existsSync(DDAT) || !existsSync(FIX) ? 'needs npm run assets and npm run fixtures (generated from your own APK)' : false;
const ddat = skip ? new Uint8Array(0) : new Uint8Array(readFileSync(DDAT));
const text = skip ? [] : JSON.parse(readFileSync(new URL('../public/assets/text.json', import.meta.url), 'utf-8')) as string[];
const a = { d8: (o: number) => ddat[o], d16: (o: number) => ddat[o] | (ddat[o + 1] << 8), text };
const data = (skip ? { descriptions: {}, cases: [] } : JSON.parse(readFileSync(FIX, 'utf-8'))) as {
  descriptions: Record<string, string>;
  cases: { cls: number; sub: number; sel: number; learned: number; eff: number; points: number; level: number; others: number; footer: string[]; body: string[] }[];
};

test('skill detail lines match the original for every case', { skip }, () => {
  let n = 0;
  for (const c of data.cases) {
    const d = skillDetail(a, { cls: c.cls, sub: c.sub, idx: c.sel - 1, learned: c.learned, eff: c.eff, points: c.points, level: c.level, learnedOf: () => c.others });
    const at = `cls ${c.cls} sub ${c.sub} sel ${c.sel} lv ${c.learned}/${c.eff} pts ${c.points} plv ${c.level} others ${c.others}`;
    assert.deepEqual(d.footer, c.footer, `footer ${at}`);
    assert.deepEqual(d.body, c.body, `body ${at}`);
    assert.equal(d.desc, data.descriptions[`${c.cls}/${c.sub}/${c.sel}`], `desc ${at}`);
    n++;
  }
  assert.ok(n > 3000);
});
