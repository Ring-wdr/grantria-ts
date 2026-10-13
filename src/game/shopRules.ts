// NPC shop / blacksmith rules (analysis/features/shop.md §2): stock FUN_0003d020, price FUN_0003967c,
// buy/sell FUN_0003f9ec and the pre-check FUN_0004e6d8, enhancement FUN_0003dfe8 (stones FUN_000372ac,
// gold FUN_0003732c, failure FUN_0003dea4), decomposition FUN_0003feb8, combine FUN_00052fcc and potion
// crafting FUN_0004ce34. Account traits gd[0x36A..0x36F] come from account.ts (tracks 5..10).
import type { Assets } from '../assets';
import type { Inventory, Item, ItemDb } from './items';
import type { Rng } from './rules';
import { traitVal } from './account';

// rules.ts rdiv / cdiv (inlined so node --test can load this module without extension mapping)
const rdiv = (a: number, b: number): number => ((Math.trunc((a * 16) / b) + 8) >> 4);
const cdiv = (a: number, b: number): number => ((Math.trunc((a * 16) / b) + 15) >> 4);

const GRADE_MULT = [110, 140, 180, 250];
const GEM_BASE = [500, 2000, 10000, 20000, 50000];
const STACK_PRICE = [0x1b882, 0x1b8d6, 0x1b902, 0x1b92e, 0x1b95a];
const ENH_RATE_OFF = 0x24641;
const T1 = [0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 0, 0, 0, 1];
const T2 = [0, 0, 0, 1, 1, 1, 3, 3, 3, 4, 4, 4, 2, 2, 2, 5];

/** FUN_0003967c: price stored at creation (+0x0a) */
export function itemPrice(a: Assets, it: Item): number {
  const t = it.type;
  const equipBase = (type: number, sub: number, level: number) => a.d16(0x1b5c2 + 2 * (type * 22 + (level > 88 ? 11 : 0) + sub));
  const clamp = (v: number) => Math.max(10, Math.min(30000, v));
  if (t < 0x10) {
    const mult = (it.grade >= 1 && it.grade <= 4 ? GRADE_MULT[it.grade - 1] : 100) + it.count * 5 + it.enh * 10;
    return clamp(Math.trunc((equipBase(t, it.sub, it.level) * mult) / 100));
  }
  if (t === 0x19) return clamp(equipBase(it.sub >> 4, it.sub & 15, it.level));
  if (t === 0x10) { const b = GEM_BASE[it.sub % 5]; return b + Math.trunc((b * it.grade) / 20); }
  if (t >= 0x11 && t <= 0x15) return a.d16(STACK_PRICE[t - 0x11] + 2 * it.sub) * 10;
  if (t === 0x16) return it.sub === 0 ? 250 : 4000;
  if (t === 0x17) return a.d16(0x1b98a + 2 * it.sub);
  if (t === 0x18) return 200;
  return 10;
}
export function priceOf(a: Assets, it: Item): number { return it.price ?? (it.price = itemPrice(a, it)); }

/** shop region r = zone + (map == 0x9B) */
export function shopRegion(zone: number, map: number): number { return zone + (map === 0x9b ? 1 : 0); }

/** recipe (0x19) for an inner equipment type/sub: named and levelled after its content */
export function makeRecipe(db: ItemDb, rng: Rng, innerType: number, innerSub: number): Item {
  const it = db.create(0x19, (innerType << 4) | innerSub, 0, rng);
  const inner = db.create(innerType, innerSub, 0, rng, true);
  it.name = inner.name;
  it.level = it.reqLevel = inner.level;
  it.price = itemPrice(db.a, it);
  return it;
}

/** FUN_0003d020: equipment shop (kind 0) / item shop (kind 1) stock; craft = potion craft list */
export function genStock(db: ItemDb, rng: Rng, kind: number, r: number, craft = false): Item[] {
  const a = db.a, out: Item[] = [];
  const add = (it: Item) => { it.price = itemPrice(a, it); out.push(it); };
  if (kind === 0) {
    if (a.d8(0x25402 + 2 * r) === 0) return out;
    const tier = a.d8(0x2542c + r), classes = r < 3 ? [r] : [0, 1, 2];
    for (const c of classes) for (let part = 0; part < 5; part++) {
      const it = db.create(c + 3 * part, tier, 0, rng, true);
      it.price = itemPrice(a, it);                         // priced with 0 sockets
      it.count = rng.rand(2);
      out.push(it);
    }
    const acc = db.create(0x0f, tier, 0, rng, true);
    acc.price = itemPrice(a, acc);
    acc.count = rng.rand(2);
    out.push(acc);
    for (const c of classes) for (let part = 0; part < 5; part++) out.push(makeRecipe(db, rng, c + 3 * part, tier));
    out.push(makeRecipe(db, rng, 0x0f, tier));
    return out;
  }
  if (craft) {
    for (let s = 0; s < 42; s++) { const m = a.d8(0x26816 + 6 * s); if (m !== 0xff && m <= r) add(db.create(0x11, s, 0, rng)); }
    return out;
  }
  const p = a.d8(0x25402 + 2 * r), q = a.d8(0x25403 + 2 * r);
  if (p === 0) return out;
  if (db.tier2) { add(db.create(0x11, 4, 0, rng)); add(db.create(0x11, 8, 0, rng)); }   // hard mode: top potions only
  else {
    for (let i = 0; i < q; i++) add(db.create(0x11, p + i, 0, rng));
    for (let i = 0; i < q; i++) add(db.create(0x11, p + 4 + i, 0, rng));
  }
  if (r > 4) { add(db.create(0x11, 13, 0, rng)); add(db.create(0x11, 0, 0, rng)); }
  const vials = a.d8(0x2541e + r);
  for (let s = 0; s < vials; s++) add(db.create(0x17, s, 0, rng));
  add(db.create(0x18, 0, 0, rng));
  return out;
}

/** buy cost of qty items (kinds 0..2): equipment ×10, gems ×qty, recipes ×qty×20, others ×qty */
export function buyCost(a: Assets, it: Item, qty: number): number {
  const p = priceOf(a, it);
  if (it.type < 0x10) return p * 10;
  if (it.type === 0x10) return p * qty;
  if (it.type === 0x19) return p * qty * 20;
  return p * qty;
}
/** the unit price shown in the list header */
export function shownBuyPrice(a: Assets, it: Item): number {
  const p = priceOf(a, it);
  return it.type < 0x10 ? p * 10 : it.type === 0x19 ? p * 20 : p;
}
/** gold received for selling qty (FUN_0003f9ec sell) */
export function sellValue(db: ItemDb, it: Item, qty: number): number {
  const p = priceOf(db.a, it);
  let v = it.type === 0x18 || !db.stackable(it.type, it.sub) ? p : p * Math.max(qty, 1);
  if (it.type < 0x10) v *= 5; else if (it.type === 0x19) v *= 10;
  return v >= 250000 ? 50000 : Math.trunc(v / 5);
}
export function shownSellPrice(a: Assets, it: Item): number {
  const p = priceOf(a, it);
  if (it.type < 0x10) return p * 5 >= 250000 ? 50000 : p;
  if (it.type === 0x19) return Math.trunc((p * 10) / 5);
  return Math.trunc(p / 5);
}

// ---- enhancement ----
const k11 = (it: Item) => (it.reqLevel > 88 ? 11 : 0);
/** FUN_000372ac: stones needed */
export function enhStones(a: Assets, it: Item): number {
  if (it.enh >= 20) return 0;
  let n = rdiv(a.d8(0x26e8f + k11(it) + it.sub) * a.d8(0x26ea5 + it.enh), 10);
  for (let g = 0; g < it.grade; g++) n = rdiv(n * (g < 2 ? 120 : 130), 100);
  return n;
}
/** FUN_0003732c: gold needed */
export function enhGold(a: Assets, it: Item): number {
  if (it.enh >= 20) return 0;
  const k = it.sub === 10 && it.reqLevel === 89 ? 0 : k11(it);
  const c = a.d16(0x22176 + 2 * (k + it.sub)), e = it.enh;
  let g = ((e * e * c) >> 1) + (e + 5) * 2 * c;
  for (let i = 0; i < it.grade; i++) g = Math.trunc((g * 12) / 10);
  g = rdiv(g, 10);
  if (it.sub >= 7) g -= g % 100; else if (it.sub >= 3) g -= g % 10;
  return g;
}
export function enhRate(a: Assets, enh: number): number { return enh >= 20 ? 0 : a.d8(ENH_RATE_OFF + enh); }
export function auxNeeded(stones: number): number { return stones < 20 ? 1 : Math.trunc(stones / 10); }

export function countOf(inv: Inventory, type: number, sub: number): number {
  return inv.items.filter((x) => x.type === type && x.sub === sub).reduce((n, x) => n + Math.max(1, x.count), 0);
}
/** take n of (type, sub) from the stacks (a stack with <= n left is removed) */
export function consume(inv: Inventory, type: number, sub: number, n: number): void {
  for (let i = inv.items.length - 1; i >= 0 && n > 0; i--) {
    const x = inv.items[i];
    if (x.type !== type || x.sub !== sub) continue;
    if (x.count <= n) { n -= x.count; inv.remove(i); } else { x.count -= n; n = 0; }
  }
}

function renameEnh(a: Assets, it: Item, oldEnh: number): void {
  let base = it.name;
  const col = base.startsWith('|') ? base.slice(0, 2) : '';
  let rest = col ? base.slice(2) : base;
  if (oldEnh > 0) rest = rest.slice(oldEnh >= 10 ? 4 : 3);
  base = it.enh > 0 ? (a.text[0x1acd] ?? '+%d %s').replace('%d', String(it.enh)).replace('%s', rest) : rest;
  it.name = col + base;
}

export type EnhResult = { ok: true } | { ok: false; destroyed: boolean };
/** FUN_0003dfe8 (consumption order: gold, stones, aux, protect) */
export function enhance(db: ItemDb, inv: Inventory, it: Item, rng: Rng, useAux: boolean, useProtect: boolean, fromInventory = false): EnhResult {
  const a = db.a, N = enhStones(a, it), G = enhGold(a, it), aux = auxNeeded(N);
  let th = enhRate(a, it.enh) * 1000;
  const r = rng.rand(100000);
  inv.gold = G < inv.gold ? inv.gold - G : 0;
  if (!fromInventory) consume(inv, 0x16, 0, N);
  if (useAux) { consume(inv, 0x16, 1, aux); th += Math.trunc(th / 10); }
  if (useProtect) consume(inv, 0x1b, 0, 1);
  if (fromInventory) consume(inv, 0x1b, 0x0c, 1);           // inventory path: one enhance scroll instead of stones
  const old = it.enh;
  if (r <= th) { it.enh++; renameEnh(a, it, old); return { ok: true }; }
  if (useProtect) return { ok: false, destroyed: false };
  const e = it.enh, keep = traitVal(10) * 10;              // FUN_0003dea4, gd[0x36F] = track 10 강화숙련
  if (e >= 16) { const i = inv.items.indexOf(it); if (i >= 0) inv.remove(i); return { ok: false, destroyed: true }; }
  if (e >= 11) it.enh = rng.rand(1000) <= keep ? e >> 1 : 0;
  else if (e >= 6) { if (rng.rand(1000) > keep) it.enh = e - 1; }
  if (it.enh !== e) renameEnh(a, it, e);
  return { ok: false, destroyed: false };
}

/** enhancement bonus FUN_00037238(it, d): base + bonus shown on the enhance screen */
export function enhBonus(it: Item, d: number): number {
  const STEP = [4, 4, 4, 5, 5, 5, 6, 6, 7, 7, 8, 9, 11, 13, 16, 20, 25, 32, 41, 53, 68];
  const e = it.enh + d;
  if (it.type >= 3 && it.type <= 14 && it.base < 10) return e;
  let sum = 0;
  for (let i = 0; i < e; i++) sum += STEP[i] ?? 0;
  return Math.max(e, rdiv(sum * it.base, 100));
}

// ---- decomposition ----
export function decomposeCost(it: Item): number {
  const s = it.sub + (it.level > 88 ? 8 : 0);
  return (s * 40 + 20) * s + 20;
}
/** FUN_0003feb8: returns the gains, or null when a stack would pass 9999 */
export function decompose(db: ItemDb, inv: Inventory, idx: number, rng: Rng, payFee: boolean): [number, number, number][] | null {
  const a = db.a, it = inv.items[idx];
  const m = it.type === 0x0f ? 18 + (it.sub >> 1) : (it.type % 3) * 6 + (it.sub >> 1);
  const o = 0x26eb9 + it.sub * 4 + (it.level > 88 ? 0x2c : 0);
  const [b0, r0, b1, r1] = [a.d8(o), a.d8(o + 1), a.d8(o + 2), a.d8(o + 3)];
  const s0 = b0 + rng.rand(r0 + 1) > 1 ? Math.trunc((b0 + rng.rand(r0 + 1)) / 2) : 1;
  let s1 = b1 + rng.rand(r1 + 1);
  if (it.grade) s1 += (it.grade === 1 ? 1 : (it.grade - 1) * 2) + (it.grade === 4 ? 2 : 0);
  if (rng.rand(100) > 100 - traitVal(7)) s1 += cdiv(s1, 10); // track 7 해체 전문가 (gd[0x36c])
  if (it.sub < 3) s1 = 0;
  const n = it.sub & 1 ? 3 + rng.rand(3) : 1 + rng.rand(2);
  const gains: [number, number, number][] = [[0x15, m, n], [0x16, 0, s0]];
  if (s1 > 0) gains.push([0x16, 1, s1]);
  if (gains.some(([t, s, c]) => countOf(inv, t, s) + c > 9999)) return null;
  if (payFee) inv.gold = Math.max(0, inv.gold - decomposeCost(it));
  inv.remove(idx);
  for (const [t, s, c] of gains) inv.gain(t, s, 0, Math.max(c, 1), rng);
  return gains;
}

// ---- combine (recipes 0x19) ----
export interface Need { type: number; sub: number; count: number; }
export function combineNeeds(a: Assets, rec: Item): Need[] {
  const it = rec.sub >> 4, is = rec.sub & 15, add = rec.level > 88 ? 10 : 1;
  const cnt = (k: number) => a.d8(0x2279a + rec.grade * 0xc6 + is * 0x12 + T2[it] * 3 + k) + add;
  return [
    { type: 0x12, sub: is * 2 + T1[it], count: cnt(0) },
    { type: 0x13, sub: is * 2 + (rec.grade >= 2 ? 1 : 0), count: cnt(1) },
    { type: 0x15, sub: (it === 15 ? 18 : (it % 3) * 6) + (is >> 1), count: cnt(2) },
  ];
}
export function haveNeeds(inv: Inventory, needs: Need[]): boolean { return needs.every((n) => countOf(inv, n.type, n.sub) >= n.count); }
/** FUN_00052fcc: result grade by the recipe grade, the item is created and the materials taken */
export function combine(db: ItemDb, inv: Inventory, recIdx: number, rng: Rng): Item | null {
  const rec = inv.items[recIdx], needs = combineNeeds(db.a, rec);
  if (!haveNeeds(inv, needs) || inv.items.length >= inv.cap) return null;
  const r = rng.rand(100000) + traitVal(6) * 1000, is = rec.sub & 15;   // track 6 대장장이 (gd[0x36b])
  const g = rec.grade === 0 ? (r <= 60000 ? 0 : r <= 90000 ? 1 : 2) : rec.grade === 1 ? (r <= 70000 ? 1 : 2)
    : rec.grade === 2 ? (r <= 90000 ? 2 : is > 3 ? 3 : 0) : 3;
  for (const n of needs) consume(inv, n.type, n.sub, n.count);
  consume(inv, 0x19, rec.sub, 1);
  const made = db.create(rec.sub >> 4, is, g, rng);
  made.price = itemPrice(db.a, made);
  inv.gain(made.type, made.sub, made.grade, 1, rng, made);
  return made;
}

// ---- potion crafting ----
export function potionNeeds(a: Assets, sub: number): Need[] {
  const o = 0x26816 + 6 * sub, out: Need[] = [];
  if (a.d8(o + 1) !== 0xff) out.push({ type: 0x14, sub: a.d8(o + 1), count: a.d8(o + 2) });
  if (a.d8(o + 3) !== 0xff) out.push({ type: 0x14, sub: a.d8(o + 3), count: a.d8(o + 4) });
  out.push({ type: 0x17, sub: a.d8(o + 5), count: 1 });
  return out;
}
/** FUN_0004ce34: yield 1, or 2 with the track-5 chance */
export function craftPotion(db: ItemDb, inv: Inventory, sub: number, rng: Rng): 'ok' | 'full' | 'lack' {
  const needs = potionNeeds(db.a, sub);
  if (!haveNeeds(inv, needs)) return 'lack';
  if (countOf(inv, 0x11, sub) + 1 >= 10000) return 'full';
  for (const n of needs) consume(inv, n.type, n.sub, n.count);
  const made = 2 - (traitVal(5) * 1000 <= rng.rand(100000) ? 1 : 0);   // track 5 제조의 달인 (gd[0x36a])
  return inv.gain(0x11, sub, 0, made, rng) ? 'ok' : 'full';
}

// ---- dark merchant (kind 3, shop.md §2.1.3) ----
const DARK_CAND = [0x00, 0x03, 0x06, 0x09, 0x0c, 0x0f, 0x16, 0x13, 0x10, 0x10, 0x10, 0x10, 0x10, 0x11, 0x11];
/** .rodata 0x1038F4: price per group g × column (weapon, 3..5, 6..8, 9..11, 12..14, accessory, holylight, 0x13, gem, potion A, potion B) */
const DARK_PRICE = [
  [150, 90, 120, 120, 90, 120, 250, 17, 100, 25, 50],
  [1200, 700, 900, 700, 900, 1000, 250, 47, 400, 175, 125],
  [1500, 900, 1200, 1200, 900, 1200, 250, 55, 400, 200, 175],
  [20000, 12000, 15000, 15000, 12000, 17000, 250, 92, 5000, 1500, 1000],
];
/** stock group of a dark merchant map: 0x79 -> 0, 0x9B -> 1, 0xA8 -> 2, 0xDF -> 3 */
export function darkGroup(map: number): number { return [0x79, 0x9b, 0xa8, 0xdf].indexOf(map); }
/**
 * FUN_0003d020(3): 16 slots, 4 per group (type, sub and price by the slot's group). The duplicate check compares the
 * candidate index with A[gs..gs+3], a window chosen by the map current at generation time (0x79 / 0x9B / 0xA8 /
 * 0xDF, others the first); A starts at 0, which is also candidate 0, so the check has holes (original). Rerolls
 * rand(15) come before the slot's item. Checked against the original over 2000 seeds × maps.
 */
export function genDarkStock(db: ItemDb, rng: Rng, mapId: number): (Item | null)[] {
  const gs = Math.max(0, darkGroup(mapId)) * 4, ge = gs + 3;
  const A = new Array<number>(16).fill(0), out: (Item | null)[] = [];
  for (let i = 0; i < 16; i++) {
    let idx = rng.rand(15);
    if (i === 0) A[0] = idx;
    else for (;;) {
      if (A[gs] === idx) { idx = rng.rand(15); continue; }
      if (A[gs] === 0) { A[i] = idx; break; }
      let again = false;
      for (let j = gs + 1; j <= ge; j++) {
        if (A[j] === idx) { again = true; break; }
        if (j !== 3 && A[j] === 0) { A[i] = idx; break; }
      }
      if (again) { idx = rng.rand(15); continue; }
      break;                                           // past the window: taken without storing
    }
    const g = i >> 2, c = DARK_CAND[idx], step = [1, 3, 4, 9][g];
    let it: Item, col: number;
    if (c <= 0x0c) { it = db.create(c + rng.rand(3), step, 1, rng); col = c / 3; }
    else if (c === 0x0f) { it = db.create(0x0f, step, 1, rng); col = 5; }
    else if (c === 0x16) { it = db.create(0x16, 1, 0, rng); col = 6; }
    else if (c === 0x13) { it = db.create(0x13, [3, 7, 9, 15][g], 0, rng); col = 7; }
    else if (c === 0x10) { it = db.create(0x10, (idx - 8) * 5 + [0, 1, 1, 3][g], 1, rng); col = 8; }
    else {
      const [A, B] = ([[0x16, 0x14], [0x0e, 0x12], [0x10, 0x0e], [0x1d, 0x0f]] as [number, number][])[g];
      const pickA = rng.rand(100) < 50;
      it = db.create(0x11, pickA ? A : B, 0, rng); col = pickA ? 9 : 10;
    }
    it.price = DARK_PRICE[g][col];
    out.push(it);
  }
  return out;
}
