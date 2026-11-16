// boss_boxes.json: the attack/body box overrides of FUN_000231e4, keyed type -> frame, for the bosses and the
// normal monsters with a type case. The port of the part of tools/grantria_bosses.py (box_overrides,
// normal_box_overrides) and tools/build_web_assets.py (pick) that makes this file: the original Thumb code runs
// (thumbEmu.ts) for every frame / facing / action of a synthetic object, and a frame is kept when its boxes
// differ from the cmf's boxes under the generic mirror rule.

import { CPU, Mem, s16, s32, type Stub } from './thumbEmu';
import { jsonText, type ApkFiles, type Emit } from './zip';

const SO = 'lib/armeabi/libGrantria.so';
const D_TYPE = 0x22d3d;          // d.dat type table, 8 bytes per type (cmf, behaviour, ...)
const VA_FUN_231E4 = 0x131e4;    // FUN_000231e4 (Ghidra 0x231e4) in ELF va space
const VA_FUN_7AE1C = 0x6ae1c;    // cmf slot select (stubbed)
const VA_FUN_21F94 = 0x11f94;    // object index (stubbed)
const VA_BOXTAB = 0x3b46e4;      // DAT_003c46e4: u32 per cmf slot -> 8-byte frame boxes
const VA_OBJS = 0x3f96f8;        // DAT_004096f8 object array (0x94 bytes each)
const BOX = 0x7e000000;          // where the run puts the cmf's frame boxes
const SLOT = 7, IDX = 5;

/** boss type -> the actions its box overrides are evaluated for: 0 and the actions of grantria_bosses.py BOSSES
 *  (that table's key order is the output's key order) */
const BOSS_ACTIONS: [number, number[]][] = [
  [5, [0, 6, 9, 12]], [8, [0, 4, 6]], [11, [0, 4, 6, 8]], [14, [0, 6, 9, 12]], [17, [0, 6, 9]],
  [20, [0, 4, 6, 8]], [23, [0, 1, 2, 4, 5]], [26, [0, 6, 9, 12]], [29, [0, 1, 2, 3, 4]], [32, [0, 1, 2, 3, 4]],
  [35, [0, 1, 2, 3, 4]], [38, [0, 2, 3, 4]], [39, [0, 3, 4, 5]], [42, [0, 2, 3]],
];
const BOSS_TYPES = new Set(BOSS_ACTIONS.map(([t]) => t));

/** (dir +0x7a, lastH +0x7b, lastV +0x7c) per run */
const COMBOS: [number, number, number][] = [[0, 0, 3], [1, 1, 3], [0, 1, 3], [1, 0, 3], [2, 0, 2], [3, 1, 3]];

type Box = [number, number, number, number];

/** the cmf's per-frame boxes, 8 bytes each: body (s8 dx, s8 dy, u8 w, u8 h), attack (the same) — the part of
 *  grantria_gfx.parse_cmf this needs */
function cmfBoxes(data: Uint8Array): { n: number; raw: Uint8Array } {
  const n = data[0] | (data[1] << 8);
  const nclip = data[2];
  const o = 6 + nclip * 4 + n * 4;
  if (o + n * 8 > data.length) throw new Error('cmf: boxes past the end');
  return { n, raw: data.subarray(o, o + n * 8) };
}

const cmfBox = (raw: Uint8Array, f: number, attack: boolean): Box => {
  const o = f * 8 + (attack ? 4 : 0);
  return [(raw[o] << 24) >> 24, (raw[o + 1] << 24) >> 24, raw[o + 2], raw[o + 3]];
};

/** cmf box with the generic FUN_000231e4 mirror rule (dx' = -dx - w when dir & 1) */
function defaultBox(b: Box, dir: number): Box {
  if (b[2] === 0 && b[3] === 0) return [0, 0, 0, 0];
  return [dir & 1 ? -b[0] - b[2] : b[0], b[1], b[2], b[3]];
}

const norm = (b: Box): Box => (b[2] || b[3] ? b : [0, 0, 0, 0]);
const same = (a: Box, b: Box): boolean => a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3];

/** runs FUN_000231e4 for a synthetic object and reads back its body/attack boxes */
class BoxEmu {
  private readonly mem: Mem;
  private readonly cpu: CPU;

  constructor(so: Uint8Array) {
    this.mem = new Mem(so);
    const retIdx: Stub = (c) => { c.r[0] = IDX; };
    this.cpu = new CPU(this.mem, new Map<number, Stub>([[VA_FUN_7AE1C, () => {}], [VA_FUN_21F94, retIdx]]));
  }

  run(typ: number, boxes: Uint8Array, frame: number, dir: number, lastH: number, lastV: number, action: number): { body: Box; att: Box } {
    const m = this.mem;
    m.reset();
    this.cpu.reset();
    m.write(BOX, boxes);
    m.w32(VA_BOXTAB + SLOT * 4, BOX);
    const o = VA_OBJS + IDX * 0x94;
    m.w32(o + 0x20, typ);
    m.w16(o + 0x6e, frame);
    m.w8(o + 0x78, SLOT);
    m.w8(o + 0x7a, dir);
    m.w8(o + 0x7b, lastH);
    m.w8(o + 0x7c, lastV);
    m.w8(o + 0x76, action);
    m.w8(o + 0x79, 1);   // state
    m.w8(o + 0x8c, 1);
    m.w8(o + 0x89, 11);
    this.cpu.call(VA_FUN_231E4, [o]);
    return {
      att: [s32(m.r32(o + 0x28)), s16(m.r16(o + 0x62)), m.r16(o + 0x64), m.r16(o + 0x66)],
      body: [s16(m.r16(o + 0x4c)), s16(m.r16(o + 0x4e)), m.r16(o + 0x50), m.r16(o + 0x52)],
    };
  }
}

interface PerAction { attack: Box; mirror: string; mirrored_attack: Box; body: Box }
type Picked = { attack: Box; mirrored_attack: Box; body: Box; mirror: string } | { by_action: Record<string, PerAction> };

/** grantria_bosses.box_overrides followed by build_web_assets pick: frame -> the override */
function boxOverrides(be: BoxEmu, typ: number, cmf: Uint8Array, actions: number[]): Record<string, Picked> {
  const { n, raw } = cmfBoxes(cmf);
  const out: Record<string, Picked> = {};
  for (let f = 0; f < n; f++) {
    const cmfAtt = cmfBox(raw, f, true), cmfBody = cmfBox(raw, f, false);
    // results[a][combo]
    const results: { body: Box; att: Box }[][] = [];
    let differs = false;
    for (const a of actions) {
      const row: { body: Box; att: Box }[] = [];
      for (const [d, h, v] of COMBOS) {
        const res = be.run(typ, raw, f, d, h, v, a);
        if (!same(norm(res.att), norm(defaultBox(cmfAtt, d))) || !same(norm(res.body), norm(defaultBox(cmfBody, d)))) differs = true;
        row.push(res);
      }
      results.push(row);
    }
    if (!differs) continue;
    // collapse: the unmirrored box (dir 0, lastH 0) per action and the mirror flag
    const perAction: PerAction[] = results.map((row) => {
      const r00 = row[0].att, rDir = row[3].att, rH = row[2].att;  // COMBOS (0,0,3), (1,0,3), (0,1,3)
      let mirror = 'none';
      if (!same(rDir, r00) && same(rH, r00)) mirror = 'dir&1 (+0x7a)';
      else if (!same(rH, r00) && same(rDir, r00)) mirror = 'lastH (+0x7b)';
      else if (!same(rH, r00) && !same(rDir, r00)) mirror = 'both?';
      return { attack: r00, mirror, mirrored_attack: row[1].att, body: row[0].body };
    });
    const key = (p: PerAction) => JSON.stringify([p.attack, p.mirror, p.mirrored_attack, p.body]);
    const first = key(perAction[0]);
    if (perAction.every((p) => key(p) === first)) {
      const p = perAction[0];
      out[String(f)] = { attack: p.attack, mirrored_attack: p.mirrored_attack, body: p.body, mirror: p.mirror };
    } else {
      const by: Record<string, PerAction> = {};
      actions.forEach((a, i) => { by[String(a)] = perAction[i]; });
      out[String(f)] = { by_action: by };
    }
  }
  return out;
}

/** boss_boxes.json: {type: {frame: {attack, mirrored_attack, body, mirror} | {by_action: {action: ...}}}}, the
 *  bosses in grantria_bosses.py BOSSES order, then the normal monsters (behaviour 1) with overrides, 3..42 */
export async function buildBossBoxes(files: ApkFiles, emit: Emit): Promise<void> {
  const so = files.get(SO);
  const d = files.get('assets/d.dat');
  if (!so || !d) throw new Error(`need assets/d.dat and ${SO}`);
  const be = new BoxEmu(so);
  // an entry list, not an object: JS would put the integer-like type keys in numeric order, and Python keeps
  // the bosses first
  const boxes: [string, Record<string, Picked>][] = [];
  for (const [t, actions] of BOSS_ACTIONS) {
    const cmf = files.get(`assets/cmf_c${t}.dat`);
    if (!cmf) throw new Error(`need assets/cmf_c${t}.dat`);
    boxes.push([String(t), boxOverrides(be, t, cmf, actions)]);
  }
  for (let t = 3; t < 43; t++) {
    const cmfId = d[D_TYPE + t * 8], behaviour = d[D_TYPE + t * 8 + 1];
    if (BOSS_TYPES.has(t) || behaviour !== 1) continue;
    const cmf = files.get(`assets/cmf_c${cmfId}.dat`);
    if (!cmf) continue;
    const ov = boxOverrides(be, t, cmf, [0]);
    if (Object.keys(ov).length) boxes.push([String(t), ov]);
  }
  await emit('boss_boxes.json', `{${boxes.map(([k, v]) => `${jsonText(k)}:${jsonText(v)}`).join(',')}}`);
}
