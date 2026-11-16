// Item rule tables from the player's APK, as tools/grantria_items.py writes them (items/options, sets, gems,
// consumables, drops, starting, misc .json; its catalog is recomputed from d.dat at runtime and not shipped).
// d.dat offsets are DAT_X - 0x3dc324, libGrantria.so .rodata file offsets are address - 0x10000; the function
// next to each table is where the original consumes it (analysis/features/items.md).
import { DDAT, LIB_SO, loadTexts, need } from './data';
import type { ApkFiles, Emit } from './zip';

/** grantria_items.py dumps with indent=1 (ensure_ascii off) */
const json1 = (obj: unknown) => JSON.stringify(obj, null, 1);

const pyHex = (v: number) => (v < 0 ? '-0x' + (-v).toString(16) : '0x' + v.toString(16));

/** '#rrggbb' of an RGB565 colour (grantria_data.rgb565_to_hex) */
function rgb565ToHex(v: number): string {
  const r = (v >> 11) & 0x1f, g = (v >> 5) & 0x3f, b = v & 0x1f;
  return '#' + [(r << 3) | (r >> 2), (g << 2) | (g >> 4), (b << 3) | (b >> 2)].map((x) => x.toString(16).padStart(2, '0')).join('');
}

const range = (n: number) => Array.from({ length: n }, (_, i) => i);

class Tables {
  readonly typeBase: number[];
  private readonly D: Uint8Array;
  private readonly T: Map<number, string>;
  private readonly dv: DataView;
  private readonly sv: DataView;

  constructor(D: Uint8Array, SO: Uint8Array, T: Map<number, string>) {
    this.D = D;
    this.T = T;
    this.dv = new DataView(D.buffer, D.byteOffset, D.byteLength);
    this.sv = new DataView(SO.buffer, SO.byteOffset, SO.byteLength);
    this.typeBase = range(32).map((i) => this.dv.getUint16(0x1b998 + i * 2, true));   // FUN_00036458 / FUN_000365ac
  }

  u8 = (o: number) => this.D[o];
  s8 = (o: number) => { const v = this.D[o]; return v > 127 ? v - 256 : v; };
  bs = (o: number, n: number) => Array.from(this.D.subarray(o, o + n));
  soI32 = (addr: number, n: number) => range(n).map((i) => this.sv.getInt32(addr - 0x10000 + i * 4, true));
  text = (i: number): string | null => this.T.get(i) ?? null;

  /** FUN_00036458: model index; name text = 0x7fc + model */
  model(t: number, sub: number, grade = 0): number {
    let k: number;
    if (t === 0x1c) k = 0;
    else if (t === 0x1d) k = sub + 2 + this.u8(0x24690 + grade);
    else if (t === 0x19) k = (sub >> 4) === 0xf ? 3 : (sub >> 4) % 3;
    else if (t < 0x10) k = this.u8(0x245ff + sub * 5 + grade);
    else if (t > 0x19) k = sub + 3;
    else k = sub;
    return k + this.typeBase[t];
  }
}

// FUN_0003bdfc jump table .rodata 0x103358 (after the normal derived[k] +/- v)
const SPECIAL_EXTRA: Record<number, string | string[]> = {
  2: 'armor_pct', 33: 'armor_pct',
  36: ['+0x3028', '+0x302c'], 37: ['+0x3010', '+0x3014', '+0x3018'],
  45: ['+0x3074', '+0x3078', '+0x307c'], 54: ['+0x30c8'],
  61: ['-0x3028', '-0x302c'],
};

function genOptions(x: Tables) {
  const omap = x.bs(0x22a6a, 62);
  const jt = x.soI32(0x103358, 62);
  const rows = range(62).map((i) => {
    const k = omap[i];
    const pfx = 0x776 + (i > 0xb ? i - 2 : i);
    const vals = i < 52 ? range(3).map((g) => x.bs(0x24393 + (g + i * 3) * 2, 2)) : null;
    return {
      id: i, derived_index: k === 255 ? null : k,
      derived_offset: k === 255 ? null : '+0x' + (0x2ff4 + 4 * k).toString(16),
      subtract: i >= 0x38,
      extra: SPECIAL_EXTRA[i] ?? null,
      jump_target: pyHex(0x103358 + jt[i]),
      desc_text_id: 1972 + i, desc: x.text(1972 + i),
      prefix_text_id: i < 52 ? pfx : null, prefix: i < 52 ? x.text(pfx) : null,
      'random_value_by_grade_1_3[base,range]': vals,
    };
  });
  const pool = (base: number) => range(6).map((s) => range(0x13).map((j) => x.s8(base + s * 0x13 + j)).filter((v) => v >= 0));
  const uniq = range(48).map((idx) => {
    const rec = x.bs(0x23fa3 + idx * 0x15, 0x15);
    return { type: Math.floor(idx / 3), sub: 8 + idx % 3, 'options[id,base,range]': range(7).map((j) => rec.slice(j * 3, j * 3 + 3)) };
  });
  return {
    source: 'd+0x22a6a option->derived idx (FUN_0003bdfc); d+0x24393 random values (FUN_0003c944); pools d+0x226b1/d+0x22723 stride 0x13, pick count d+0x244cb; unique d+0x23fa3',
    options: rows,
    random_option_count_by_grade_1_3: x.soI32(0x1038d8, 3),
    'pool_pick_count_by_slot_d+0x244cb': x.bs(0x244cb, 6),
    pool_first2_by_slot: pool(0x226b1), pool_rest_by_slot: pool(0x22723),
    unique_grade4_index: '(type*3 + sub-8)',
    unique_grade4: uniq,
    'grade_name_colour_code_d+0x22795': x.bs(0x22795, 5).map((c) => String.fromCharCode(c)),
    socket_distribution_rand100000: [[25000, 0], [50000, 1], [70000, 2], [85000, 3], [95000, 4], [100000, 5]],
  };
}

function genSets(x: Tables) {
  const g1 = range(11).map((s) => x.bs(0x244d1 + s * 4, 4));
  const g2 = range(11).map((s) => x.bs(0x244fd + s * 6, 6));
  const g3 = range(7).map((s) => x.bs(0x2453f + s * 16, 16));
  const g4 = range(3).map((s) => x.bs(0x245af + s * 20, 20));
  const pairs = (r: number[]) => range(r.length >> 1).map((i) => [r[i * 2], r[i * 2 + 1]]);
  return {
    source: 'FUN_0003bdfc 0x3c022..0x3c7d4 (set bonus), applied when >=2 armor pieces (slots 1..4, usable) share sub and grade',
    apply: 'derived[d[0x22a6a+id]] += (id==34 ? 10*v : v) ; id 255 skipped ; no subtract / special-extra handling',
    grade1_by_sub: range(11).map((s) => ({ sub: s, 'pieces2+': pairs(g1[s]) })),
    grade2_by_sub: range(11).map((s) => ({ sub: s, 'pieces2+': pairs(g2[s]) })),
    grade3_by_sub: range(7).map((s) => ({ sub: s + 4, pieces2_3: pairs(g3[s].slice(0, 8)), pieces4: pairs(g3[s].slice(8)) })),
    grade4_by_sub: range(3).map((s) => ({ sub: s + 8, pieces2_3: pairs(g4[s].slice(0, 10)), pieces4: pairs(g4[s].slice(10)) })),
  };
}

function genGems(x: Tables) {
  return {
    source: 'FUN_0003c944 case 0x10 (item), FUN_0003bdfc 0x3c20a (socket bonus, jump table .rodata 0x103450)',
    gem_item: 'type 0x10, sub = kind*5 + tier (kind 0..5, tier 0..4), grade 0..4',
    socket_byte: 'grade*50 + sub  (0xff = empty)',
    value: 'd[0x26912 + tier*5 + grade]',
    'value_table[tier][grade]': range(5).map((t) => x.bs(0x26912 + t * 5, 5)),
    kind_to_stat: [
      { kind: 0, option_id: 6, stat: 'STR +0x300c' }, { kind: 1, option_id: 8, stat: 'VIT +0x3014' },
      { kind: 2, option_id: 9, stat: 'INT +0x3018' }, { kind: 3, option_id: 7, stat: 'AGI +0x3010' },
      { kind: 4, option_id: 21, stat: 'luck +0x3038' }, { kind: 5, option_id: 22, stat: 'EXP% +0x3030' }],
    'item_base_field_+0x04': 'same value d[0x26912 + (sub%5)*5 + grade]; +0x14 = option_id of the kind',
  };
}

function genConsumables(x: Tables) {
  const buffs = range(35).map((i) => {
    const r = x.bs(0x2513b + i * 4, 4);
    const src = i < 28 ? { type: 0x11, sub: 14 + i } : i < 31 ? { type: 0x1b, sub: i - 7 } : { type: 0x1b, sub: i + 4 };
    const m = x.model(src.type, src.sub);
    return {
      slot: i, stat_id: r[0] === 255 ? null : r[0], value: r[0] === 255 ? null : (r[1] > 127 ? r[1] - 256 : r[1]),
      duration_frames: r[2] === 255 ? 20000 : r[2] * 10, b3: r[3],
      item: src, item_name: x.text(0x7fc + m),
    };
  });
  const flagShow = x.soI32(0x103798, 39);
  const flagStack = [1, ...x.soI32(0x103624, 56)];
  const perm = x.bs(0x26e85, 10).filter((v) => v !== 255);
  const misc = range(57).map((s) => ({
    sub: s, name: x.text(0x7fc + x.model(0x1b, s)), stackable: s < flagStack.length ? Boolean(flagStack[s]) : true,
    hud_shows_count: s < 39 ? Boolean(flagShow[s]) : false,
    permanent_unlock_bit: perm.includes(s) ? perm.indexOf(s) : null,
  }));
  const pv = x.bs(0x24b0f, 16);
  const potions = range(12).map((i) => {
    const s = i + 1;
    const e: Record<string, unknown> = { sub: s, name: x.text(0x7fc + x.model(0x11, s)), table: pv[s] };
    if (s <= 4) e.hp = pv[s] * 10;
    else if (s <= 8) e.mp = pv[s] * 10;
    else { e.hp = pv[s] * 10; e.mp = pv[s] * 8; }
    return e;
  });
  const idx48 = '+0x30b4 (idx48) %';
  return {
    source: 'FUN_00040498 (use), FUN_00036d4c (cooldown groups), FUN_000373cc / FUN_0002c99c (buffs)',
    'potion_value_d+0x24b0f': pv,
    potions,
    potion_formula: 'amount = (100 + potion%(+0x3054)) * k * table[sub] / 100 ; k = 10 (HP, MP), 8 (MP part of sub 9..12)',
    cooldown_groups: [
      { type: 0x11, subs: [1, 4], frames: 100, reduced_by: idx48 },
      { type: 0x11, subs: [5, 8], frames: 100, reduced_by: idx48 },
      { type: 0x11, subs: [9, 12], frames: 100, reduced_by: idx48 },
      { type: 0x11, subs: [13, 13], frames: 100, reduced_by: idx48 },
      { type: 0x11, subs: [14, 41], frames: 900 },
      { type: 0x1b, subs: [2, 2], frames: 16 },
      { type: 0x1b, subs: [0x15, 0x17], frames: 900 },
      { type: 0x1b, subs: [0x23, 0x23], frames: 900 }, { type: 0x1b, subs: [0x24, 0x24], frames: 900 },
      { type: 0x1b, subs: [0x25, 0x25], frames: 900 }, { type: 0x1b, subs: [0x26, 0x26], frames: 900 }],
    'buff_slots_d+0x2513b': buffs,
    'buff_slot34_special_value_x10_d+0x251c4': x.u8(0x251c4),
    misc_0x1b: misc,
    'misc_permanent_list_d+0x26e85': perm,
  };
}

function genDrops(x: Tables) {
  return {
    source: 'FUN_0006ca90 / FUN_00037e04 (roll), FUN_0003b9c8 (spawn), FUN_0003b6e4 (scatter spawn), FUN_00063360 (bounce/despawn), FUN_0002f184 (draw/auto-loot)',
    'consumable_drop_weights_by_monster_type_d+0x23f22[type][return,hp_mp_potion,cure_all]': range(48).map((t) => x.bs(0x23f22 + t * 3, 3)),
    'material_0x12_sub_by_monster_type_d+0x23e38': x.bs(0x23e38, 48),
    object_slots: [116, 140],
    pickup_box: { monster_drop: [-30, -30, 60, 60], scatter_drop: [-20, -20, 40, 40] },
    bounce_dy_by_phase: { 1: -12, 2: 2, 3: 3, 4: 3, 5: 4, 7: -2, 9: 1 },
    despawn_frames: 550,
  };
}

function genStart(x: Tables) {
  return {
    source: 'FUN_00053510 case 2 (new game) after FUN_0001a8d8',
    equipment: [{ slot: 0, create: 'FUN_0003c944(200, type=class, level=0, grade=0, sub=0, opt=0)', note: 'class weapon sub0 grade0, random sockets' }],
    inventory: [{ type: 0x11, sub: 1, count: 10, name: x.text(0x7fc + x.model(0x11, 1)) },
      { type: 0x18, sub: 0, count: 20, name: x.text(0x7fc + x.model(0x18, 0)) }],
    quick_slots: [{ slot: 0, kind: 'skill', id: 0 }, { slot: 5, key: '#', kind: 'item', inventory_index: 0 }],
    start_map_by_class: { 0: 10, 1: 0x2f, 2: 0x62 },
    gold: 0,
  };
}

// the grade colour codes' RGB565 (FUN_00078474 |a..|h)
const GRADE_RGB: Record<string, number> = { a: 0x0000, b: 0xffff, c: 0xf800, d: 0xffe0, e: 0x666c, g: 0xc99f, h: 0xed26 };

function genMisc(x: Tables) {
  const grades = x.bs(0x22795, 5).map((c, g) => {
    const code = String.fromCharCode(c);
    if (!(code in GRADE_RGB)) throw new Error(`d.dat 등급 색 코드 |${code} 를 알 수 없습니다`);
    return { grade: g, code: '|' + code, rgb: rgb565ToHex(GRADE_RGB[code]) };
  });
  return {
    grade_colour: grades,
    'level_table_d+0x24655(+11 tier2)': x.bs(0x24655, 22),
    'max_grade_by_sub_d+0x24636': x.bs(0x24636, 11),
    accessory_base_extra_rodata_0x103704: x.soI32(0x103704, 11),
    enhance_side_bonus_FUN_000371c4: {
      'slot1 (type 3..5)': 'crit +0x3004 += rdiv(e^3, 580) + 1',
      'slot2 (type 6..8)': 'STR/AGI/VIT/INT += rdiv(e^3, 200) + 5',
      'slot3 (type 9..11)': 'luck +0x3038 += rdiv(e^3, 40) + 5',
      'slot4 (type 12..14)': 'crit dmg +0x30a4 += rdiv(e^3, 200) + 1',
    },
    text_ids: {
      name_plain: 0x1a7b, name_1prefix: 0x1ab8, name_2prefix: 0x1ab7, enhanced: 0x1acd,
      got_n: 0x1ab9, got: 0x1aba, cannot_hold_more: 0x1abb, gold_cap: 0x1abc,
      log_got_n: 0x3b5, log_got: 0x3b6, log_gold: 0x3b8, log_inventory_full: 0x3cc,
      use: 0x1ac0, no_area: 0x1abe, no_area_dim: 0x1ac2, no_slot: 0x1ac1, hp_full: 211,
      inventory_full_popup: 0x507,
    },
  };
}

/** items/{options,sets,gems,consumables,drops,starting,misc}.json */
export async function buildItems(files: ApkFiles, emit: Emit): Promise<void> {
  const texts = new Map<number, string>();
  for (const t of loadTexts(files)) texts.set(t.id, t.text);
  const x = new Tables(need(files, DDAT), need(files, LIB_SO), texts);
  const outs: [string, unknown][] = [
    ['options', genOptions(x)], ['sets', genSets(x)], ['gems', genGems(x)], ['consumables', genConsumables(x)],
    ['drops', genDrops(x)], ['starting', genStart(x)], ['misc', genMisc(x)]];
  for (const [name, obj] of outs) await emit(`items/${name}.json`, json1(obj));
}
