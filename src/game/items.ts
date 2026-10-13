// Item system ported from analysis/features/items.md §0: records, GRAN_GET (FUN_0003ecc4),
// equipment creation (FUN_0003c944), names / icons (FUN_00036458, FUN_000365ac), equip / unequip
// (FUN_0003e860 / FUN_0003daf0), consumables and cooldown groups (FUN_00040498, FUN_00036d4c),
// quick slots (FUN_000379ac / FUN_000452a0). Counts are stored plainly (the original keeps ~u16).
import type { Assets } from '../assets';
import { idiv, type EquipTables, type Rng } from './rules';

export interface Item {
  type: number;          // 0xff = empty
  sub: number;
  grade: number;
  base: number;          // weapon ATK / armour DEF / accessory resist / gem value
  icon: number;
  count: number;         // stack count, or socket count for equipment
  enh: number;           // equipment: +0..20 ; consumables (0x11, 0x1b): remaining cooldown frames
  level: number;
  reqLevel: number;
  aux: number;
  sockets: number[];     // gem byte = grade*50 + sub, 0xff empty
  options: [number, number][];
  name: string;          // display name with colour code, fixed at creation
  /** +0x0a price unit, computed at creation (FUN_0003967c); absent in older saves */
  price?: number;
}

export interface QuickSlot {
  kind: 0 | 1 | 2;       // 0 empty, 1 skill, 2 item
  id: number;            // skill action id / inventory index
  cd: number;
  maxCd: number;
  itemType: number;
  itemSub: number;
}

interface OptionDef { id: number; derived_index: number; subtract: boolean; prefix_text_id: number; 'random_value_by_grade_1_3[base,range]': [number, number][] }
interface ItemTables {
  options: { options: OptionDef[]; pool_first2_by_slot: number[][]; pool_rest_by_slot: number[][]; 'pool_pick_count_by_slot_d+0x244cb': number[];
    unique_grade4: { type: number; sub: number; 'options[id,base,range]': number[][] }[]; socket_distribution_rand100000: [number, number][] };
  consumables: { 'potion_value_d+0x24b0f': number[]; misc_0x1b: { sub: number; stackable: boolean; hud_shows_count: boolean; permanent_unlock_bit: number | null }[];
    'buff_slots_d+0x2513b': { slot: number; stat_id: number; value: number; duration_frames: number }[] };
  sets: { grade1_by_sub: SetRec[]; grade2_by_sub: SetRec[]; grade3_by_sub: SetRec[]; grade4_by_sub: SetRec[] };
  starting: { inventory: { type: number; sub: number; count: number }[]; start_map_by_class: Record<string, number> };
}
interface SetRec { sub: number; 'pieces2+'?: number[][]; pieces2_3?: number[][]; pieces4?: number[][] }

export const EMPTY_TYPE = 0xff;
export const INV_SLOTS = 100;
export const MAX_STACK = 9999;
/** grade colour codes d+0x22795: white, green, yellow, orange, purple */
const GRADE_CODE = ['b', 'e', 'd', 'h', 'g'];

export function emptyItem(): Item {
  return { type: EMPTY_TYPE, sub: 0, grade: 0, base: 0, icon: 0, count: 0, enh: 0, level: 0, reqLevel: 0, aux: 0,
    sockets: [0xff, 0xff, 0xff, 0xff, 0xff, 0xff], options: [], name: '' };
}

export class ItemDb {
  t!: ItemTables;
  readonly a: Assets;
  constructor(a: Assets) { this.a = a; }

  async init(): Promise<void> {
    const names = ['options', 'consumables', 'sets', 'starting'] as const;
    const parts = await Promise.all(names.map((n) => this.a.json<unknown>(`items/${n}.json`)));
    this.t = Object.fromEntries(names.map((n, i) => [n, parts[i]])) as unknown as ItemTables;
  }

  private typeBase(type: number): number { return this.a.d16(0x1b998 + 2 * type); }

  /** Tables for rules.derive (option -> derived index d+0x22a6a, sets, gems). */
  equipTables(): EquipTables {
    const optionIndex = Array.from({ length: 64 }, (_, i) => this.a.s8(0x22a6a + i));
    const sets = this.t.sets;
    return {
      optionIndex,
      setBonus: (grade, sub, n) => {
        const pick = (list: SetRec[]) => list.find((r) => r.sub === sub);
        const r = grade === 1 ? pick(sets.grade1_by_sub) : grade === 2 ? pick(sets.grade2_by_sub)
          : grade === 3 ? pick(sets.grade3_by_sub) : grade === 4 ? pick(sets.grade4_by_sub) : undefined;
        if (!r) return [];
        const recs = r['pieces2+'] ?? (n === 4 ? r.pieces4 : r.pieces2_3) ?? [];
        return recs.map(([id, v]) => [id, v] as [number, number]);
      },
      gemValue: (tier, grade) => this.a.d8(0x26912 + tier * 5 + grade),
    };
  }

  /**
   * Description text id (item detail FUN_00032344): equipment 0xa50 + model; gems share one text per
   * kind, 0xa50 + model(0x10, 0, grade) + sub / 5; types above 0x10 sit 0x18 lower (the gem block has
   * 6 descriptions for 30 models).
   */
  descId(type: number, sub: number, grade: number): number {
    if (type === 0x10) return 0xa50 + this.model(0x10, 0, grade) + idiv(sub, 5);
    return 0xa50 + this.model(type, sub, grade) - (type > 0x10 ? 0x18 : 0);
  }

  /** FUN_00036458 model number (name text 0x7fc + model; descriptions: descId). */
  model(type: number, sub: number, grade: number): number {
    if (type < 0x10) return 21 * type + this.a.d8(0x245ff + sub * 5 + grade);
    if (type === 0x1c) return this.typeBase(0x1c);
    if (type === 0x1d) return this.typeBase(0x1d) + sub + 2 + this.a.d8(0x24690 + grade);
    if (type === 0x19) return this.typeBase(0x19) + ((sub >> 4) === 15 ? 3 : (sub >> 4) % 3);
    if (type >= 0x1a) return this.typeBase(type) + sub + 3;
    return this.typeBase(type) + sub;
  }

  /** FUN_000365ac icon id; drawn from image i<icon/117> at ((icon%9)*16, ((icon%117)/9)*16). */
  icon(type: number, sub: number): number {
    if (type < 0x10) return 11 * type + sub;
    if (type === 0x10) return sub >= 25 && sub <= 29 ? 414 : 176 + idiv(sub, 5);
    if (type === 0x19) return 322;
    if (type === 0x1b) {
      const special: Record<number, number> = { 0x1b: 376, 0x1c: 377, 0x1d: 370, 0x1e: 331, 0x21: 322, 0x2f: 421, 0x30: 420, 0x31: 423, 0x32: 424 };
      if (sub in special) return special[sub];
      if (sub >= 0x22 && sub <= 0x2a) return sub + 371;
      if (sub >= 0x2b && sub <= 0x2e) return 415 + sub - 0x2b;
      if (sub >= 0x33 && sub <= 0x38) return 420;
      return 340 + sub;
    }
    if (type === 0x1d) return sub ? 366 + sub : 181;
    return this.typeBase(type) - 160 - 25 + sub;
  }

  iconRect(icon: number): { image: string; sx: number; sy: number } {
    return { image: `i${idiv(icon, 117)}`, sx: (icon % 9) * 16, sy: idiv(icon % 117, 9) * 16 };
  }

  /** DAT_003b3bef == 2: high-level (second run) tables — levels 89..189 and the second half of the base table */
  tier2 = false;
  /** slot lap (restoreTier2: lap >= 2) and the Dimension Gate floor level while in mode 2 (null outside) */
  lap = 0;
  dimLvl: number | null = null;
  /** restoreTier2() of FUN_0003f6d8 / FUN_0003f30c: lap >= 2; in the Dimension Gate the floor level >= 90 */
  restoreTier2(): void { this.tier2 = this.dimLvl !== null ? this.dimLvl >= 90 : this.lap >= 2; }

  /** FUN_000369b0 item level: equipment d+0x24655 (+11 in tier 2), consumables d+0x2466b (all 1), others 1. */
  itemLevel(type: number, sub: number): number {
    if (type < 0x10) return this.levelOf(sub);
    return type === 0x11 ? this.a.d8(0x2466b + sub) : 1;
  }

  /** Item level table d+0x24655 (+11 entries in tier 2). */
  levelOf(sub: number): number { return this.a.d8(0x24655 + (this.tier2 ? 11 : 0) + Math.min(sub, 10)); }

  /** FUN_000364dc base value. */
  baseStat(type: number, sub: number, grade: number): number {
    if (type === 15) {                                               // .rodata 0x103704; in the Dimension Gate the floor level > 88 decides
      const on = this.dimLvl !== null ? this.dimLvl > 88 : this.tier2;
      return sub + 1 + (on && sub < 11 ? [10, 10, 9, 9, 8, 7, 7, 6, 5, 4, 4][sub] : 0);
    }
    const m = this.model(type, sub, grade);
    return this.a.d16(4 + 2 * (idiv(m, 21) * 21 + m + 0xdce8 + (this.tier2 ? 21 : 0)));   // d16[0x1b9d4 + 2*(42*type + 21*tier2 + k)]
  }

  stackable(type: number, sub: number): boolean {
    if (type >= 0x10 && type <= 0x17) return true;
    if (type === 0x1b) return this.t.consumables.misc_0x1b.find((m) => m.sub === sub)?.stackable ?? false;
    return false;
  }

  /** FUN_00036cbc: whether the count is drawn next to the icon. */
  showsCount(it: Item): boolean {
    if (it.type >= 0x10 && it.type <= 0x18) return true;
    if (it.type === 0x1b) return this.t.consumables.misc_0x1b.find((m) => m.sub === it.sub)?.hud_shows_count ?? false;
    return false;
  }

  prefixText(id: number): number { return 1910 + (id > 11 ? id - 2 : id); }

  /** Display name (FUN_0003c944): colour code + prefixes (grade 1/2) + name. */
  makeName(it: Item, rng: Rng): string {
    const text = this.a.text;
    const name = text[0x7fc + this.model(it.type, it.sub, it.grade)] ?? '?';
    const col = `|${GRADE_CODE[Math.min(it.grade, 4)]}`;
    if (it.type === 0x19) {                                          // text 0x1ab8 "%s%s %s": product name, then the recipe kind
      const product = text[0x7fc + this.model(it.sub >> 4, it.sub & 15, it.grade)] ?? '?';
      return `${col}${product} ${name}`;
    }
    if (it.type >= 0x10 || it.grade === 0 || it.grade >= 3) return `${col}${name}`;
    const pre = (id: number) => text[this.prefixText(id)] ?? '';
    if (it.grade === 1) return `${col}${pre(it.options[rng.rand(2)]?.[0] ?? 0)} ${name}`;
    const first = pre(it.options[rng.rand(2)]?.[0] ?? 0);
    return `${col}${first} ${pre(it.options[2 + rng.rand(1)]?.[0] ?? 0)} ${name}`;   // second prefix slot 2 + rand(n - 2)
  }

  /** FUN_0003c944 item creation. */
  create(type: number, sub: number, grade: number, rng: Rng, noSockets = false): Item {
    const it = emptyItem();
    Object.assign(it, { type, sub, grade, count: 1 });
    rng.rand(256);                                                   // uid FUN_00037b3c (frames << 8 | rand(256))
    if (type === 0x10) {
      it.aux = [6, 8, 9, 7, 21, 22][idiv(sub, 5)];
      it.base = this.a.d8(0x26912 + (sub % 5) * 5 + grade);
    } else if (type === 0x18) {
      it.base = this.a.d8(0x24b39 + sub);
    } else if (type < 0x10) {
      it.base = this.baseStat(type, sub, grade);
      it.aux = sub;
      if (grade === 4) {
        const lv = this.levelOf(sub);
        rng.rand(this.a.d8(0x2268a + (lv < 40 ? idiv(lv, 10) + 1 : 4)));   // FUN_000f8518, result overwritten
        const u = this.t.options.unique_grade4.find((r) => r.type === type && r.sub === sub);
        if (u) it.options = u['options[id,base,range]'].map(([id, b, r]) => [id, b + rng.rand(r + 1)] as [number, number]);
      }
      const roll = rng.rand(100000);
      it.count = noSockets && grade !== 4 ? 0 : (this.t.options.socket_distribution_rand100000.find(([lim]) => roll < lim)?.[1] ?? 0);
      if (grade >= 1 && grade <= 3) this.rollOptions(it, [2, 3, 4][grade - 1], rng);
    }
    it.reqLevel = this.itemLevel(type, sub);                                         // +0xf
    it.level = type === 0x19 ? this.itemLevel(sub >> 4, sub & 15) : it.reqLevel;    // +0xe: a recipe takes its product's level
    it.icon = this.icon(type, sub);
    it.name = this.makeName(it, rng);
    return it;
  }

  private rollOptions(it: Item, n: number, rng: Rng): void {
    const o = this.t.options, slot = idiv(it.type, 3), cnt = o['pool_pick_count_by_slot_d+0x244cb'][slot];
    for (let guard = 0; it.options.length < n && guard < 500; guard++) {
      const i = it.options.length;
      const id = (i < 2 ? o.pool_first2_by_slot : o.pool_rest_by_slot)[slot][rng.rand(cnt)];
      if (i > 0 && it.options.some((op) => op[0] === id)) continue;
      const [b, r] = o.options[id]?.['random_value_by_grade_1_3[base,range]'][it.grade - 1] ?? [0, 0];
      if (b === 0) continue;
      it.options.push([id, b + rng.rand(r + 1)]);
    }
  }
}

export type LogKind = 'got' | 'gotN' | 'gold' | 'full' | 'text';

/** Player-owned items: inventory (compacted), equipment 0..5, quick slots, gold. */
/** d.dat 0x4031A9 (d+0x26e85): 0x1b subs kept as permanent unlock bits +0x32a5 instead of items, bit = index
 *  (천상의 곡괭이 / 마법 해체기 / 대장장이의 모루 / 오토루팅) */
export const UNLOCK_1B = [1, 9, 10, 13] as const;

export class Inventory {
  items: Item[] = [];                       // compacted list, length <= cap
  equip: (Item | null)[] = [null, null, null, null, null, null];
  quick: QuickSlot[] = Array.from({ length: 6 }, () => ({ kind: 0, id: 0, cd: 0, maxCd: 0, itemType: 0, itemSub: 0 }));
  gold = 0;
  cap = 48;
  /** purchased bags +0x327C (0..2): capacity (bags + 3) * 16 = 48 / 64 / 80 */
  bags = 0;
  setBags(n: number): void { this.bags = Math.max(0, Math.min(2, n)); this.cap = (this.bags + 3) * 16; }
  /** permanent unlock bits +0x32a5 (UNLOCK_1B index) */
  unlocks = 0;
  /** an unlock item (0x1b sub 1 / 9 / 10 / 13) is owned (FUN_0007b240 on +0x32a5) */
  unlocked(sub: number): boolean { const b = UNLOCK_1B.indexOf(sub as never); return b >= 0 && !!(this.unlocks & (1 << b)); }
  /** older saves held unlock items in the bag: turn them into bits (frees the slots) */
  migrateUnlocks(): void {
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i], b = UNLOCK_1B.indexOf(it.sub as never);
      if (it.type === 0x1b && b >= 0) { this.unlocks |= 1 << b; this.items.splice(i, 1); }
    }
    this.remapQuick();
  }
  /** quest key items (type 0x1a): their own 17-slot store, items 500..516 at g+0x2618 (FUN_00036204), not in the bag */
  keys: Item[] = [];
  /** FUN_0003674c: owned count of key (0x1a, sub) */
  keyCount(sub: number): number { return this.keys.filter((k) => k.sub === sub).length; }
  /** FUN_0003dc4c on FUN_000367a4's slot, then the store is compacted: the first key with this sub */
  removeKey(sub: number): void { const i = this.keys.findIndex((k) => k.sub === sub); if (i >= 0) this.keys.splice(i, 1); }
  /** older saves held key items in the bag: move them to the key store */
  migrateKeys(): void {
    for (let i = 0; i < this.items.length; i++) {
      const it = this.items[i];
      if (it.type === 0x1a && this.keys.length < 17) { this.keys.push(it); this.items.splice(i--, 1); }
    }
    this.remapQuick();
  }
  log: (kind: LogKind, text: string, n?: number) => void = () => {};

  private db: ItemDb;
  constructor(db: ItemDb) { this.db = db; }

  /** GRAN_GET FUN_0003ecc4: returns false when refused (full, or a stack would exceed 9999). */
  /** type 0x1d is a collection flag (keys, sage stones), not an item (GRAN_GET) */
  onCollect: (sub: number) => void = () => {};

  gain(type: number, sub: number, grade: number, count: number, rng: Rng, made?: Item): boolean {
    const text = this.db.a.text;
    if (type === 0x1d) { this.onCollect(sub); return true; }
    const ub = type === 0x1b ? UNLOCK_1B.indexOf(sub as never) : -1;
    if (ub >= 0) {                                                   // GRAN_GET: set the bit (FUN_0007b268), no bag slot
      this.unlocks |= 1 << ub;
      this.log('got', (text[0x3b6] ?? '%s').replace('%s', text[0x7fc + this.db.model(type, sub, 0)] ?? ''));
      return true;
    }
    if (type === 0x1a) {                                             // FUN_0003ecc4 case 0x1a: first empty key slot, no bag check
      if (this.keys.length >= 17) return false;                      // the original runs past the store (517)
      const it = made ?? this.db.create(type, sub, grade, rng);
      this.keys.push(it);
      this.logGot(it, 1);
      return true;
    }
    if (type === 0x1c) {
      this.gold = Math.min(this.gold + sub, 999_999_999);
      this.log('gold', (text[0x3b8] ?? '%d').replace('%d', String(sub)), sub);
      return true;
    }
    if (this.db.stackable(type, sub)) {
      const it = this.items.find((i) => i.type === type && i.sub === sub && i.grade === grade);
      if (it) {
        if (it.count + count > MAX_STACK) { this.log('text', text[0x1abb] ?? ''); return false; }
        it.count += count;
        this.logGot(it, count);
        this.remapQuick();
        return true;
      }
    }
    if (this.items.length >= this.cap) { this.log('full', text[0x3cc] ?? ''); return false; }
    const it = made ?? this.db.create(type, sub, grade, rng);
    if (!made) rng.rand(256);                                        // GRAN_GET assigns a fresh uid to the new slot
    if (count >= 2) it.count = Math.min(count, MAX_STACK);
    this.items.push(it);
    this.logGot(it, count);
    this.remapQuick();
    return true;
  }

  /** whether gain() would take the item without a new slot or with room left (FUN_0003632c, for FUN_0001c5cc) */
  canGain(type: number, sub: number, grade: number, count: number): boolean {
    if (type === 0x1d || type === 0x1c) return true;
    if (type === 0x1b && UNLOCK_1B.indexOf(sub as never) >= 0) return true;
    if (type === 0x1a) return this.keys.length < 17;
    if (this.db.stackable(type, sub)) {
      const it = this.items.find((i) => i.type === type && i.sub === sub && i.grade === grade);
      if (it) return it.count + count <= MAX_STACK;
    }
    return this.items.length < this.cap;
  }

  private logGot(it: Item, count: number): void {
    const text = this.db.a.text;
    const name = it.name;
    if (count < 2) this.log('got', (text[0x3b6] ?? '%s').replace('%s', name));
    else this.log('gotN', (text[0x3b5] ?? '%s %d').replace('%s', name).replace('%d', String(count)), count);
  }

  remove(idx: number): void {
    this.items.splice(idx, 1);
    this.remapQuick();
  }

  /**
   * 가방정리 FUN_0003b3a8(0): items grouped by type (record +0x10, 0..0x1D), and inside a type the
   * original's exchange sort on sub (+0x11): for i = 1.., for j < i, swap when sub[i] < sub[j]. Item
   * quick slots then follow their item (or empty) like after any compaction.
   */
  sortBag(): void {
    const groups: Item[][] = Array.from({ length: 0x1e }, () => []), rest: Item[] = [];
    for (const it of this.items) (groups[it.type] ?? rest).push(it);
    for (const g of groups) {
      for (let i = 1; i < g.length; i++) for (let j = 0; j < i; j++) if (g[i].sub < g[j].sub) [g[i], g[j]] = [g[j], g[i]];
    }
    this.items = [...groups.flat(), ...rest];
    this.remapQuick();
  }

  /** FUN_00026698: item quick slots follow their (type, sub, grade 0) item after compaction. */
  remapQuick(): void {
    for (const q of this.quick) {
      if (q.kind !== 2) continue;
      const i = this.items.findIndex((it) => it.type === q.itemType && it.sub === q.itemSub && it.grade === 0);
      if (i < 0) Object.assign(q, { kind: 0, id: 0, cd: 0 }); else q.id = i;
    }
  }

  /** FUN_00036860 */
  usable(it: Item, level: number, cls: number): boolean {
    return it.type >= 16 || (level >= it.reqLevel && (it.type === 15 || it.type % 3 === cls));
  }

  /** FUN_0003e860: slot = type/3 (15 -> 5); a filled slot swaps with the same inventory cell. */
  equipFrom(idx: number): boolean {
    const it = this.items[idx];
    if (!it || it.type >= 0x10) return false;
    const slot = it.type === 15 ? 5 : idiv(it.type, 3);
    const old = this.equip[slot];
    this.equip[slot] = it;
    if (old) this.items[idx] = old; else this.remove(idx);
    return true;
  }

  /** FUN_0003daf0: only when the inventory has room. */
  unequip(slot: number): boolean {
    const it = this.equip[slot];
    if (!it || this.items.length >= this.cap) return false;
    this.items.push(it);
    this.equip[slot] = null;
    this.remapQuick();
    return true;
  }

  /** FUN_00037118: empty a quick slot */
  clearQuick(slot: number): void {
    Object.assign(this.quick[slot], { kind: 0, id: 0, cd: 0 });
  }

  /** FUN_000379ac */
  registerQuick(slot: number, kind: 1 | 2, id: number, skillCd = 0): void {
    const q = this.quick[slot];
    for (const o of this.quick) {
      if (o !== q && o.kind === kind && (kind === 1 ? o.id === id : this.items[o.id] === this.items[id])) Object.assign(o, { kind: 0, id: 0, cd: 0 });
    }
    if (kind === 1) Object.assign(q, { kind, id, maxCd: skillCd, cd: 0 });
    else { const it = this.items[id]; Object.assign(q, { kind, id, itemType: it.type, itemSub: it.sub, cd: it.enh }); }
  }

  /** Per-frame cooldown countdown (FUN_0002c99c). */
  tick(): void {
    for (const it of this.items) if ((it.type === 0x11 || it.type === 0x1b) && it.enh > 0) it.enh--;
    for (const q of this.quick) if (q.kind && q.cd > 0) q.cd--;
  }

  /** FUN_00036d4c: every item in the same cooldown group (and its quick slots) gets cd frames. */
  setGroupCooldown(type: number, sub: number, cdReductionPct: number): void {
    let range: [number, number] | null = null, cd = 0;
    if (type === 0x11) {
      const groups: [number, number][] = [[1, 4], [5, 8], [9, 12], [13, 13]];
      range = groups.find(([a, b]) => sub >= a && sub <= b) ?? (sub >= 14 ? [14, 255] : null);
      cd = sub >= 14 ? 900 : 100 - idiv(100 * Math.min(75, cdReductionPct), 100);
    } else if (type === 0x1b) {
      if (sub === 2) { range = [2, 2]; cd = 16; }
      else if (sub >= 0x15 && sub <= 0x17) { range = [0x15, 0x17]; cd = 900; }
      else if (sub >= 0x23 && sub <= 0x26) { range = [sub, sub]; cd = 900; }
    }
    if (!range) return;
    this.items.forEach((it, i) => {
      if (it.type !== type || it.sub < range![0] || it.sub > range![1]) return;
      it.enh = cd;
      for (const q of this.quick) if (q.kind === 2 && q.id === i) q.cd = cd;
    });
  }
}
