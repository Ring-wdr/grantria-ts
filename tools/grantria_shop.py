#!/usr/bin/env python3
"""Export Grantria NPC shop / blacksmith tables for the web port.

Reads decoded_grantria/assets/d.dat (loaded verbatim at Ghidra 0x3dc324, so
DAT_X -> d.dat offset X-0x3dc324), libGrantria.so .rodata (file offset =
address - 0x10000) and the text files. Spec: analysis/features/shop.md.

  menus.json         shop kinds, 0x16 menu table, merchant NPCs and their maps
  stock.json         FUN_0003d020 stock per shop region (equipment/item shop, potion craft list)
  dark_merchant.json FUN_0003d020(3) candidate table + price table per map group
  prices.json        FUN_0003967c price rules, buy/sell multipliers (FUN_0003f9ec)
  enhance.json       FUN_000372ac/FUN_0003732c/d+0x24641 computed per (tier, sub, grade, enh)
  decompose.json     FUN_0003feb8 tables (stones, material, gold cost FUN_00036ca0)
  craft.json         potion recipes (d+0x26816) and blacksmith combine (0x19 recipe) materials

--verify runs the original FUN_0003d020 (param 0/1, craft list) through
tools/grantria_thumb_emu.py and compares the item lists with this file's port.

usage: python -I tools/grantria_shop.py [--out analysis/features/data/shop] [--verify]
"""
import argparse
import json
import os
import struct
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import grantria_data   # noqa: E402
import grantria_items  # noqa: E402  (model/icon helpers; globals set in main)

D = b''
SO = b''
T = {}


def u8(o):
    return D[o]


def u16(o):
    return struct.unpack_from('<H', D, o)[0]


def bs(o, n):
    return list(D[o:o + n])


def so_i32(addr, n):
    return list(struct.unpack_from('<%di' % n, SO, addr - 0x10000))


def so_u8(addr, n):
    return list(SO[addr - 0x10000:addr - 0x10000 + n])


def text(i):
    return T.get(i)


LEVEL = None            # d+0x24655, 22 entries (11 normal + 11 tier2)
REGION_MAPS = {}        # region -> [map...] (filled from map files)
KIND_NAMES = {0x41c: 0, 0x41d: 1, 0x41e: 2, 0x442: 3}
KIND_LABEL = ['equipment', 'item', 'blacksmith', 'dark']


def rdiv(a, b):
    """FUN_0007b1f0: ((a*16/b) + 8) >> 4 (C truncating division; a >= 0 here)."""
    return ((a * 16) // b + 8) >> 4


# ---------------------------------------------------------------- price (FUN_0003967c)
def item_level(t, sub, tier2=False):
    k = 11 if tier2 else 0
    if t == 0x19:
        return LEVEL[k + (sub & 15)]
    return LEVEL[k + sub] if sub < 11 else 0


def price(t, sub, grade=0, sockets=0, enh=0, level=None):
    """FUN_0003967c. level = item +0x0e (only >88 matters)."""
    mult = 100
    if t < 0x11:
        if 1 <= grade <= 4:
            mult = so_i32(0x103890, 4)[grade - 1]
        mult += sockets * 5 + enh * 10
    if t == 0x10:
        base = so_i32(0x1038a0, 5)[sub % 5]
        return base * grade // 20 + base
    if 0x11 <= t <= 0x15:
        off = {0x11: 0x1b882, 0x12: 0x1b8d6, 0x13: 0x1b902, 0x14: 0x1b92e, 0x15: 0x1b95a}[t]
        return u16(off + 2 * sub) * 10
    if t == 0x16:
        return 250 if sub == 0 else 4000
    if t == 0x17:
        return u16(0x1b98a + 2 * sub)
    if t == 0x18:
        return 200
    if t >= 0x1a:
        return 10
    k = 11 if (level or 0) > 0x58 else 0
    if t == 0x19:
        idx = (sub >> 4) * 22 + k + (sub & 15)
        mult = 100
    else:
        idx = t * 22 + k + sub
    v = u16(0x1b5c2 + 2 * idx) * mult // 100
    if v < 10:
        return 10
    return min(v, 30000)


def buy_unit(t, kind):
    """Multiplier applied to it.price when buying (FUN_0003f9ec charge) and shown in 0x15 (FUN_0005a41c)."""
    if kind == 3:
        return {'charge': 10, 'display': 15 if t < 0x10 else (20 if t == 0x19 else 10)}
    if t < 0x10:
        return {'charge': 10, 'display': 10}
    if t == 0x19:
        return {'charge': 20, 'display': 20}
    return {'charge': 1, 'display': 1}


def sell_total(t, p, qty=1):
    """FUN_0003f9ec sell branch."""
    if t < 0x10:
        v = p * 5
        return 50000 if v >= 250000 else v // 5
    v = p * qty * (10 if t == 0x19 else 1)
    return 50000 if v >= 250000 else v // 5


def entry(t, sub, grade=0, tier2=False, kind=0, extra=None):
    lv = item_level(t, sub, tier2) if (t < 0x10 or t == 0x19) else 0
    m = grantria_items.model_id(t, sub, grade)
    if t == 0x19:
        name_model = grantria_items.model_id(sub >> 4, sub & 15, grade)
    else:
        name_model = m
    p = price(t, sub, grade, 0, 0, lv)
    bu = buy_unit(t, kind)
    e = {'type': t, 'sub': sub, 'grade': grade, 'level': lv,
         'name_text_id': 0x7fc + name_model, 'name': text(0x7fc + name_model),
         'icon': grantria_items.icon_id(t, sub), 'price': p,
         'buy_price': p * bu['charge'], 'buy_price_shown': p * bu['display'],
         'sell_price': sell_total(t, p)}
    if t == 0x19:
        e['inner'] = {'type': sub >> 4, 'sub': sub & 15}
    if extra:
        e.update(extra)
    return e


# ---------------------------------------------------------------- stock (FUN_0003d020)
def stock_equipment(r, tier2=False):
    """FUN_0003d020(0): r = zone + (map == 0x9b)."""
    if u8(0x25402 + 2 * r) == 0:
        return []
    tier = u8(0x2542c + r)
    out = []
    classes = [r] if r < 3 else [0, 1, 2]
    for c in classes:
        for part in range(5):
            out.append(entry(c + 3 * part, tier, 0, tier2, 0, {'sockets': 'rand(2) (0/1, price unaffected)'}))
    out.append(entry(0xf, tier, 0, tier2, 0, {'sockets': 'rand(2)'}))
    for c in classes:
        for part in range(5):
            out.append(entry(0x19, ((c + 3 * part) << 4) | tier, 0, tier2, 0))
    out.append(entry(0x19, 0xf0 | tier, 0, tier2, 0))
    return out


def stock_item(r, tier2=False):
    """FUN_0003d020(1) with DAT_00410753 == 0 (buy). tier2 = DAT_003d1df5 >= 2."""
    p, q = u8(0x25402 + 2 * r), u8(0x25403 + 2 * r)
    if p == 0:
        return []
    out = []
    if not tier2:
        for base in (0, 4):
            for k in range(q):
                out.append(entry(0x11, p + base + k, 0, tier2, 1))
    else:
        out += [entry(0x11, 4, 0, tier2, 1), entry(0x11, 8, 0, tier2, 1)]
    if r > 4:
        out += [entry(0x11, 13, 0, tier2, 1), entry(0x11, 0, 0, tier2, 1)]
    for k in range(u8(0x2541e + r)):
        out.append(entry(0x17, k, 0, tier2, 1))
    out.append(entry(0x18, 0, 0, tier2, 1))
    return out


def craft_list(r):
    """FUN_0003d020(1) with DAT_00410753 != 0 (item merchant 제조): recipes with minRegion <= r."""
    return [s for s in range(42) if u8(0x26816 + 6 * s) != 0xff and u8(0x26816 + 6 * s) <= r]


def potion_recipe(s):
    b = bs(0x26816 + 6 * s, 6)
    mats = []
    if b[1] != 0xff:
        mats.append({'type': 0x14, 'sub': b[1], 'count': b[2]})
    if b[3] != 0xff:
        mats.append({'type': 0x14, 'sub': b[3], 'count': b[4]})
    if b[5] != 0xff:
        mats.append({'type': 0x17, 'sub': b[5], 'count': 1})
    for mt in mats:
        mm = grantria_items.model_id(mt['type'], mt['sub'])
        mt['name'] = text(0x7fc + mm)
    pm = grantria_items.model_id(0x11, s)
    return {'sub': s, 'name': text(0x7fc + pm), 'min_region': None if b[0] == 0xff else b[0],
            'raw': b, 'materials': mats}


# ---------------------------------------------------------------- blacksmith combine (0x19 recipe)
COMBINE_T1 = None   # .rodata 0x3a4b98 / 0x3a5098 (+1 to 0x12 material sub)
COMBINE_T2 = None   # .rodata 0x3a4b28 int[16] (part group for material count table)


def combine_materials(inner_t, inner_sub, grade, level):
    """FUN_0004bb08 (display) / FUN_00052fcc (consume) / FUN_0004946c (counts)."""
    add = 10 if level > 0x58 else 1
    g2 = COMBINE_T2[inner_t] * 3
    cnt = [u8(0x2279a + grade * 0xc6 + inner_sub * 0x12 + g2 + k) + add for k in range(3)]
    m0 = (0x12, inner_sub * 2 + COMBINE_T1[inner_t])
    m1 = (0x13, inner_sub * 2 + (1 if grade >= 2 else 0))
    cls6 = 18 if inner_t == 15 else (inner_t % 3) * 6
    m2 = (0x15, cls6 + (inner_sub >> 1))
    out = []
    for (t, s), c in zip((m0, m1, m2), cnt):
        mm = grantria_items.model_id(t, s)
        out.append({'type': t, 'sub': s, 'count': c, 'name': text(0x7fc + mm)})
    return out


# ---------------------------------------------------------------- enhance
def enhance_cost(sub, grade, enh, tier2):
    """FUN_000372ac stones N, FUN_0003732c gold G, success %, aux-stone need."""
    if enh >= 20:
        return None
    lv = LEVEL[(11 if tier2 else 0) + sub]
    k = 11 if lv > 0x58 else 0
    n = rdiv(u8(0x26e8f + k + sub) * u8(0x26ea5 + enh), 10)
    for i in range(grade):
        n = rdiv(n * (120 if i < 2 else 130), 100)
    kg = k
    if sub == 10 and lv == 0x59:
        kg = 0
    c = u16(0x22176 + 2 * (kg + sub))
    g = ((enh * enh * c) >> 1) + (enh + 5) * 2 * c
    for _ in range(grade):
        g = g * 12 // 10
    g = rdiv(g, 10)
    if 3 <= sub < 7:
        g -= g % 10
    elif sub >= 7:
        g -= g % 100
    rate = u8(0x24641 + enh)
    return {'stones': n, 'gold': g, 'rate_pct': rate, 'rate_with_aux_pct_shown': min(100, rate + int(rate / 10.0)),
            'threshold': rate * 1000, 'threshold_with_aux': rate * 1000 + rate * 1000 // 10,
            'aux_stones': 1 if n < 20 else n // 10}


def gen_enhance():
    table = []
    for tier2 in (False, True):
        for sub in range(11):
            for grade in range(5):
                row = [enhance_cost(sub, grade, e, tier2) for e in range(20)]
                table.append({'tier2': tier2, 'sub': sub, 'grade': grade,
                              'level': LEVEL[(11 if tier2 else 0) + sub], 'by_enh': row})
    return {
        'source': 'FUN_0003dfe8 (run), FUN_0004c990 (screen strings), FUN_000372ac (stones), '
                  'FUN_0003732c (gold), FUN_0003dea4 (fail), FUN_00037238 (bonus), d+0x24641 (rate)',
        'stone_item': {'type': 0x16, 'sub': 0, 'name': text(0x9ee)},
        'aux_item': {'type': 0x16, 'sub': 1, 'name': text(0x9ef), 'need': 'stones<20 ? 1 : stones/10',
                     'effect': 'threshold += threshold/10 (display: rate + (int)(rate/10.0), cap 100)'},
        'protect_item': {'type': 0x1b, 'sub': 0, 'name': text(0xa0c), 'need': 1, 'effect': 'no penalty on failure'},
        'inventory_scroll': {'type': 0x1b, 'sub': 0xc, 'name': text(0x7fc + grantria_items.model_id(0x1b, 0xc)),
                             'note': 'enhance opened from inventory (return state 0x1E): consumes 1 of this instead of stones'},
        'success': 'rand(100000) <= threshold',
        'failure_penalty': {
            '0..5': 'none', '6..10': 'r=rand(1000); r > gd[0x36f]*10 -> enh-1',
            '11..15': 'r=rand(1000); r <= gd[0x36f]*10 -> enh>>1 else enh=0',
            '16..19': 'item destroyed (DAT_00408527=1, popup 0x30 shows text 0x1a29)'},
        'bonus_pct_step_rodata_0x103834': so_i32(0x103834, 21),
        'table': table,
    }


# ---------------------------------------------------------------- decompose (FUN_0003feb8)
def decompose_cost(sub, level):
    s = sub + (8 if level > 0x58 else 0)
    return (s * 40 + 20) * s + 20


def gen_decompose():
    rows = []
    for tier2 in (False, True):
        for sub in range(11):
            lv = LEVEL[(11 if tier2 else 0) + sub]
            a = bs(0x26eb9 + sub * 4 + (0x2c if lv > 0x58 else 0), 4)
            rows.append({'tier2': tier2, 'sub': sub, 'level': lv,
                         'stone0_base': a[0], 'stone0_range': a[1], 'stone1_base': a[2], 'stone1_range': a[3],
                         'material_count': '3+rand(3)' if sub & 1 else '1+rand(2)',
                         'stone1_zero': sub < 3,
                         'gold_cost_blacksmith': decompose_cost(sub, lv)})
    return {
        'source': 'FUN_0003feb8 (run), FUN_00036ca0 (gold), FUN_0005bd10 (result window)',
        'material': {'type': 0x15, 'sub': 'type==15 ? 18 + sub/2 : (type%3)*6 + sub/2',
                     'names': [text(0x7fc + grantria_items.model_id(0x15, s)) for s in range(24)]},
        'stone0': {'type': 0x16, 'sub': 0, 'rule': 'v=b0+rand(r0+1); v>1 ? (b0+rand(r0+1))/2 (new roll) : 1'},
        'stone1': {'type': 0x16, 'sub': 1,
                   'rule': 'v=b1+rand(r1+1); grade g>0: v += (g==1 ? 1 : (g-1)*2) + (g==4 ? 2 : 0); '
                           'rand(100) > 100-gd[0x36c] -> v += cdiv(v,10) (FUN_0007b218 = ((v*16/10)+15)>>4); sub<3 -> 0'},
        'gold': '(s*40+20)*s+20, s = sub + (level>88 ? 8 : 0); charged only at blacksmith (state != 0x1E)',
        'overflow': 'any of the three stacks + gain > 9999 -> nothing happens, DAT_003b3cb8=1 -> popup 0x7b',
        'table_d+0x26eb9': rows,
    }


# ---------------------------------------------------------------- dark merchant (FUN_0003d020(3))
def gen_dark():
    kinds = [0x00, 0x03, 0x06, 0x09, 0x0c, 0x0f, 0x16, 0x13, 0x10, 0x10, 0x10, 0x10, 0x10, 0x11, 0x11]
    prices = [so_i32(0x1038f4 + 44 * g, 11) for g in range(4)]
    groups = []
    for g, mp in enumerate((0x79, 0x9b, 0xa8, 0xdf)):
        cand = []
        for idx, kt in enumerate(kinds):
            if kt == 0x11:
                if g == 0:
                    subs = (0x16, 0x14)
                elif g == 1:
                    subs = (0xe, 0x12)
                elif g == 2:
                    subs = (0x10, 0xe)
                else:
                    subs = (0x1d, 0xf)
                opts = [{'when': 'rand(100)<50', 'type': 0x11, 'sub': subs[0], 'grade': 0, 'price_col': 9},
                        {'when': 'rand(100)>=50', 'type': 0x11, 'sub': subs[1], 'grade': 0, 'price_col': 10}]
            elif kt == 0x10:
                s = idx * 5 - 40 + (0, 1, 1, 3)[g]
                opts = [{'type': 0x10, 'sub': s, 'grade': 1, 'price_col': 8}]
            elif kt == 0x13:
                opts = [{'type': 0x13, 'sub': (3, 7, 9, 15)[g], 'grade': 0, 'price_col': 7}]
            elif kt == 0x16:
                opts = [{'type': 0x16, 'sub': 1, 'grade': 0, 'price_col': 6}]
            else:
                s = (1, 3, 4, 9)[g]
                tl = [kt] if kt == 0xf else [kt, kt + 1, kt + 2]
                opts = [{'when': 'type = %d + rand(3)' % kt if kt != 0xf else None, 'type': t2, 'sub': s,
                         'grade': 1, 'price_col': kt // 3} for t2 in tl]
            for o in opts:
                mm = grantria_items.model_id(o['type'], o['sub'], o['grade'])
                o['name'] = text(0x7fc + mm)
                o['price'] = prices[g][o['price_col']]
                o['buy_price'] = o['price'] * 10
                o['buy_price_shown'] = o['price'] * (15 if o['type'] < 0x10 else 10)
            cand.append({'index': idx, 'options': opts})
        groups.append({'group': g, 'map': mp, 'stock_items': [700 + 4 * g + i for i in range(4)],
                       'candidates': cand})
    return {
        'source': 'FUN_0003d020(3) (regen), FUN_00036fa4 (clear), FUN_000529f4 (list copy), FUN_0003f9ec (buy)',
        'storage': 'items 700..715 (DAT_003c4124 + i*0x5c), 4 per merchant map; bought slot is emptied (sold out)',
        'candidate_bytes_local_3c': kinds,
        'price_table_rodata_0x1038f4': prices,
        'price_columns': ['weapon(type0..2)', 'type3..5', 'type6..8', 'type9..11', 'type12..14', 'accessory 15',
                          'stone 0x16/1', 'gather 0x13', 'gem 0x10', 'potion rand<50', 'potion rand>=50'],
        'note': 'price field (+0x0a) of each generated item is overwritten with the table value; '
                'equipment grade 1 (2 random options), sockets by normal distribution (opt 0)',
        'groups': groups,
    }


# ---------------------------------------------------------------- menus / NPCs
def gen_menus(assets):
    menu = []
    for v in range(10):
        row = struct.unpack_from('<4h', D, 0x1bec0 + v * 8)
        menu.append({'action': v, 'label_text_id': 0x17b + v, 'label': text(0x17b + v),
                     'label_kind1_text_id': 0x1a37 if v == 3 else None,
                     'desc_text_id': 0x1c4 + v, 'desc': text(0x1c4 + v),
                     'enabled_by_kind': list(row)})
    npcs = []
    for aid in range(300):
        nm = u16(0x1bfb0 + 2 * aid)
        if nm in KIND_NAMES or nm == 0x441:
            npcs.append({'actor': aid, 'name_text_id': nm, 'name': text(nm),
                         'kind': KIND_NAMES.get(nm, 'inn'), 'maps': []})
    by = {n['actor']: n for n in npcs}
    for mp in range(447):
        m = grantria_data.load_map(assets, mp)
        for a in m['actors']:
            if a['actor'] in by:
                zone = m['header']['zone']
                by[a['actor']]['maps'].append({'map': mp, 'zone': zone,
                                               'shop_region': zone + (1 if mp == 0x9b else 0)})
    kinds = []
    for k in range(4):
        en = [v['action'] for v in menu if v['enabled_by_kind'][k]]
        kinds.append({'kind': k, 'label': KIND_LABEL[k], 'title_text_id': 0x1c0 + k, 'title': text(0x1c0 + k),
                      'menu_actions': en})
    return {
        'source': 'FUN_00045008 (NPC talk -> 0x16), FUN_00059c30/FUN_000529f4 (0x16), d+0x1bec0 menu table, '
                  'd+0x1bfb0 NPC name ids',
        'kinds': kinds, 'menu_table_d+0x1bec0': menu, 'merchants': npcs,
        'dark_merchant_actors_visible_only_if_DAT_003b3afc>=2': [0x9e, 0xcd, 0xde, 0xf2],
    }


def gen_stock(npcs):
    regions = sorted({m['shop_region'] for n in npcs['merchants'] if n['kind'] in (0, 1, 2) for m in n['maps']})
    out = []
    for r in range(15):
        out.append({'region': r, 'used_by_maps': sorted({m['map'] for n in npcs['merchants']
                                                         if n['kind'] in (0, 1, 2)
                                                         for m in n['maps'] if m['shop_region'] == r}),
                    'equipment_tier_sub_d+0x2542c': u8(0x2542c + r),
                    'item_pair_d+0x25402': [u8(0x25402 + 2 * r), u8(0x25403 + 2 * r)],
                    'vial_count_d+0x2541e': u8(0x2541e + r),
                    'equipment_shop': stock_equipment(r),
                    'equipment_shop_tier2': stock_equipment(r, True),
                    'item_shop': stock_item(r),
                    'item_shop_tier2': stock_item(r, True),
                    'potion_craft': craft_list(r)})
    return {'source': 'FUN_0003d020 param 0 (equipment), 1 (item / craft list); region = zone(DAT_0040f374) + '
                      '(map == 0x9b)',
            'regions_with_merchants': regions,
            'notes': ['stock is regenerated every time 구매/제조 is chosen in 0x16',
                      'tier2 = DAT_003d1df5 >= 2 (DAT_003b3bef == 2): equipment level/base from the 2nd half of '
                      'the tables (FUN_0003c944); item shop then sells only 0x11 sub 4/8 (+13/0 if region>4)'],
            'regions': out}


def gen_prices():
    return {
        'source': 'FUN_0003967c (it.price), FUN_0003f9ec (buy/sell), FUN_0005a41c (shown unit price), '
                  'FUN_0004e6d8 (gold check)',
        'equipment': 'clamp(10, 30000, d16[0x1b5c2 + 2*(type*22 + (lv>88?11:0) + sub)] * mult / 100), '
                     'mult = (grade1..4 -> 110/140/180/250 else 100) + sockets*5 + enh*10',
        'recipe_0x19': 'same table with (sub>>4, sub&15), mult 100, clamp 10..30000',
        'gem_0x10': 'b + b*grade/20, b = [500,2000,10000,20000,50000][sub%5]',
        'stack_x10': {'0x11': [u16(0x1b882 + 2 * i) for i in range(42)],
                      '0x12': [u16(0x1b8d6 + 2 * i) for i in range(22)],
                      '0x13': [u16(0x1b902 + 2 * i) for i in range(22)],
                      '0x14': [u16(0x1b92e + 2 * i) for i in range(22)],
                      '0x15': [u16(0x1b95a + 2 * i) for i in range(24)]},
        'stack_note': '0x11..0x15 price = value*10 (tables overlap; index by sub)',
        'type16': [250, 4000], 'type17_d16_0x1b98a': [u16(0x1b98a + 2 * i) for i in range(8)],
        'type18': 200, 'type1a_1d': 10,
        'grade_mult_rodata_0x103890': so_i32(0x103890, 4), 'gem_base_rodata_0x1038a0': so_i32(0x1038a0, 5),
        'equip_base_d16_0x1b5c2': [u16(0x1b5c2 + 2 * i) for i in range(16 * 22)],
        'buy': {'kind0..2': {'equipment(type<0x10)': 'price*10', '0x10 gem': 'price*qty', '0x19': 'price*qty*20',
                             'other stack': 'price*qty', '0x18': 'price (qty forced to 20 on gain)'},
                'kind3 (dark)': 'price*10 charged; list shows price*15 for equipment',
                'gold': 'gold -= cost; if cost >= gold then gold = 0 (check done before by FUN_0004e6d8)'},
        'sell': {'equipment': 'price (=price*5/5; 50000 if price*5 >= 250000, never with clamp 30000)',
                 '0x19': 'min(price*qty*10/5, 50000 if >= 250000)',
                 'stack': 'price*qty/5 (50000 if price*qty >= 250000)',
                 '0x18': 'price/5, whole stack removed',
                 'not sellable': 'type 0x1a, 0x1b, 0x1d (FUN_0004e6d8 code 7); 판매 hidden for 0x1b in popup'},
    }


def gen_craft():
    combine = []
    for grade in range(4):
        for inner_t in range(16):
            for inner_sub in range(11):
                for tier2 in (False, True):
                    lv = LEVEL[(11 if tier2 else 0) + inner_sub]
                    combine.append({'grade': grade, 'inner_type': inner_t, 'inner_sub': inner_sub, 'tier2': tier2,
                                    'level': lv, 'materials': combine_materials(inner_t, inner_sub, grade, lv)})
    return {
        'source': 'potion: d+0x26816 (FUN_0003d020(1), FUN_0004a560, FUN_0004ce34); combine: FUN_0004bb08, '
                  'FUN_00052fcc, FUN_0004946c (d+0x2279a), .rodata 0x3a4b98/0x3a4b28',
        'potion_recipes': [potion_recipe(s) for s in range(42)],
        'potion_yield': 'rand(100000) < gd[0x36a]*1000 ? 2 : 1 (stack must stay < 10000)',
        'combine_t1_rodata_0x3a4b98': COMBINE_T1, 'combine_t2_rodata_0x3a4b28': COMBINE_T2,
        'combine_count_rule': 'd[0x2279a + grade*0xc6 + innerSub*0x12 + T2[innerType]*3 + k] + (level>88 ? 10 : 1)',
        'combine_grade': {'r': 'rand(100000) + gd[0x36b]*1000',
                          '0': 'r<=60000 -> 0, r<=90000 -> 1, else 2',
                          '1': 'r<=70000 -> 1, else 2',
                          '2': 'r<=90000 -> 2, else (innerSub>3 ? 3 : 0)',
                          '3+': '3'},
        'combine': combine,
    }


# ---------------------------------------------------------------- verify against the original code
def verify():
    import grantria_thumb_emu as emu
    G = lambda a: a - 0x10000  # noqa: E731

    def run(param, region, mapid=0, act=0, df5=0):
        m = emu.Mem(SO)
        m.write(G(0x3dc324), D)
        m.w8(G(0x40f374), region)
        m.w16(G(0x40f368), mapid)
        m.w8(G(0x410753), act)
        m.w8(G(0x3d1df5), df5)
        calls = []

        def c944(c):
            sp = c.r[13]
            calls.append((c.r[1], c.m.r32(sp), c.r[3]))   # type, sub, grade

        def rand(c):
            c.r[0] = 0
        cpu = emu.CPU(m, {G(0x3c944): c944, G(0xf8490): rand, G(0x37008): lambda c: None})
        cpu.call(G(0x3d020), [param], max_steps=2000000)
        return calls

    bad = 0
    for r in range(15):
        for tier2 in (False, True):
            a = [(e['type'], e['sub'], e['grade']) for e in stock_equipment(r, tier2)]
            b = run(0, r, df5=2 if tier2 else 0)
            bad += a != b
            a = [(e['type'], e['sub'], e['grade']) for e in stock_item(r, tier2)]
            b = run(1, r, df5=2 if tier2 else 0)
            bad += a != b
        a = [(0x11, s, 0) for s in craft_list(r)]
        b = run(1, r, act=3)
        bad += a != b
    print('verify FUN_0003d020: %s' % ('OK' if bad == 0 else '%d mismatches' % bad))

    def s64(lo, hi):
        v = (hi << 32) | lo
        return v - (1 << 64) if v >> 63 else v

    def ldivmod(c):                    # __aeabi_ldivmod (ARM thunk, ghidra 0xfd000)
        x, y = s64(c.r[0], c.r[1]), s64(c.r[2], c.r[3])
        q = abs(x) // abs(y)
        q = q if (x < 0) == (y < 0) else -q
        r = x - q * y
        c.r[0], c.r[1], c.r[2], c.r[3] = q & 0xffffffff, (q >> 32) & 0xffffffff, r & 0xffffffff, (r >> 32) & 0xffffffff

    def idivmod(c):                    # __aeabi_idiv / __aeabi_idivmod
        x, y = emu.s32(c.r[0]), emu.s32(c.r[1])
        q = abs(x) // abs(y)
        q = q if (x < 0) == (y < 0) else -q
        c.r[0], c.r[1] = q & 0xffffffff, (x - q * y) & 0xffffffff

    def run_it(fn, sub, grade, enh, lv):
        m = emu.Mem(SO)
        m.write(G(0x3dc324), D)
        it = 0x7e000000
        m.w16(it + 0xc, enh)
        for off, v in ((0xe, lv), (0xf, lv), (0x10, 0), (0x11, sub), (0x12, grade)):
            m.w8(it + off, v)
        cpu = emu.CPU(m, {G(0xfd000): ldivmod, G(0xfbdb4): idivmod, G(0xfbe90): idivmod})
        return emu.s32(cpu.call(G(fn), [it], max_steps=200000))

    bad2 = 0
    for tier2 in (False, True):
        for sub in range(11):
            lv = LEVEL[sub + (11 if tier2 else 0)]
            for grade in range(5):
                for enh in range(20):
                    e = enhance_cost(sub, grade, enh, tier2)
                    got = (run_it(0x372ac, sub, grade, enh, lv), run_it(0x3732c, sub, grade, enh, lv))
                    bad2 += got != (e['stones'], e['gold'])
    print('verify FUN_000372ac/FUN_0003732c (2200 cases): %s' % ('OK' if bad2 == 0 else '%d mismatches' % bad2))
    return bad + bad2


def main():
    global D, SO, T, LEVEL, COMBINE_T1, COMBINE_T2
    ap = argparse.ArgumentParser()
    ap.add_argument('--assets', default='apk/assets')
    ap.add_argument('--so', default='apk/lib/armeabi/libGrantria.so')
    ap.add_argument('--out', default='tests/fixtures/shop')
    ap.add_argument('--verify', action='store_true')
    a = ap.parse_args()
    D = open(os.path.join(a.assets, 'd.dat'), 'rb').read()
    SO = open(a.so, 'rb').read()
    T = {t['id']: t['text'] for t in grantria_data.load_texts(a.assets)}
    grantria_items.D, grantria_items.SO, grantria_items.T = D, SO, T
    grantria_items.TYPE_BASE = grantria_items.u16s(0x1b998, 32)
    LEVEL = bs(0x24655, 22)
    COMBINE_T1 = so_u8(0x3a4b98, 16)
    COMBINE_T2 = so_i32(0x3a4b28, 16)
    if a.verify:
        return 1 if verify() else 0
    os.makedirs(a.out, exist_ok=True)
    menus = gen_menus(a.assets)
    outs = {'menus.json': menus, 'stock.json': gen_stock(menus), 'dark_merchant.json': gen_dark(),
            'prices.json': gen_prices(), 'enhance.json': gen_enhance(), 'decompose.json': gen_decompose(),
            'craft.json': gen_craft()}
    for n, o in outs.items():
        p = os.path.join(a.out, n)
        with open(p, 'w', encoding='utf-8') as f:
            json.dump(o, f, ensure_ascii=False, indent=1)
        print('wrote', p)
    return 0


if __name__ == '__main__':
    sys.exit(main())
