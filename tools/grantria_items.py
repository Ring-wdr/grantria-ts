#!/usr/bin/env python3
"""Export Grantria item-system tables for the web port.

Everything here is read from decoded_grantria/assets/d.dat (loaded verbatim to
Ghidra address 0x3dc324, so DAT_X -> d.dat offset X-0x3dc324) and from small
.rodata tables in libGrantria.so (file offset = address - 0x10000). Function
addresses next to each table say where the table is consumed. See
analysis/features/items.md for the rules that use these tables.

usage: python -I tools/grantria_items.py [--out analysis/features/data/items]
"""
import argparse
import json
import os
import struct
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import grantria_data  # noqa: E402  (text loader, rgb565 helper)

D = b''
SO = b''
T = {}


def u8(o):
    return D[o]


def s8(o):
    v = D[o]
    return v - 256 if v > 127 else v


def bs(o, n):
    return list(D[o:o + n])


def u16s(o, n):
    return list(struct.unpack_from('<%dH' % n, D, o))


def so_i32(addr, n):
    return list(struct.unpack_from('<%di' % n, SO, addr - 0x10000))


def text(i):
    return T.get(i)


# ---------------------------------------------------------------- identity
TYPE_BASE = None          # d16[0x1b998 + 2*type]   FUN_00036458 / FUN_000365ac


def model_id(t, sub, grade=0):
    """FUN_00036458: model index; name text = 0x7fc + model, desc text = 0xa50 + model."""
    if t == 0x1c:
        k = 0
    elif t == 0x1d:
        k = sub + 2 + u8(0x24690 + grade)
    elif t == 0x19:
        k = 3 if (sub >> 4) == 0xf else (sub >> 4) % 3
    elif t < 0x10:
        k = u8(0x245ff + sub * 5 + grade)
    elif t > 0x19:
        k = sub + 3
    else:
        k = sub
    return k + TYPE_BASE[t]


ICON_1B = {0x1b: 0x178, 0x1c: 0x179, 0x1d: 0x172, 0x1e: 0x14b, 0x21: 0x142,
           0x2b: 0x19f, 0x2c: 0x1a0, 0x2d: 0x1a1, 0x2e: 0x1a2, 0x2f: 0x1a5,
           0x31: 0x1a7, 0x32: 0x1a8}


def icon_id(t, sub):
    """FUN_000365ac."""
    if t == 0x19:
        return TYPE_BASE[0x19] - 0xb9
    if t == 0x10:
        if 0x19 <= sub < 0x1e:
            return 0x19e
        return TYPE_BASE[0x10] - 0xa0 + sub // 5
    if t == 0x1b:
        if sub in ICON_1B:
            return ICON_1B[sub]
        if 0x22 <= sub <= 0x2a:
            return sub + 0x173
        if sub == 0x30 or 0x33 <= sub <= 0x38:
            return 0x1a4
        return TYPE_BASE[0x1b] - 0xb9 + sub
    if t == 0x1d:
        return (TYPE_BASE[0x1d] - 0xd9 + sub) if sub else (TYPE_BASE[0x11] - 0xb9)
    return TYPE_BASE[t] - 10 * min(t, 16) + sub - (25 if t > 16 else 0)


def icon_rect(icon):
    """FUN_0003bc80: image index (asset table) and 16x16 source rect."""
    return {'image': 4 + icon // 117, 'sx': (icon % 9) * 16, 'sy': ((icon % 117) // 9) * 16, 'w': 16, 'h': 16}


def item_entry(t, sub, grade=0):
    m = model_id(t, sub, grade)
    ic = icon_id(t, sub)
    return {'type': t, 'sub': sub, 'grade': grade, 'model': m,
            'name_text_id': 0x7fc + m, 'name': text(0x7fc + m),
            'desc_text_id': 0xa50 + m, 'desc': text(0xa50 + m),
            'icon': ic, 'icon_rect': icon_rect(ic)}


TYPE_SUBS = {0x10: 30, 0x11: 42, 0x12: 22, 0x13: 22, 0x14: 22, 0x15: 24, 0x16: 2,
             0x17: 6, 0x18: 1, 0x1a: 17, 0x1b: 57, 0x1d: 10}
TYPE_KIND = {0x10: 'gem', 0x11: 'consumable', 0x12: 'material_drop', 0x13: 'material_gather_a',
             0x14: 'material_gather_b', 0x15: 'material_disassemble', 0x16: 'enhance_stone',
             0x17: 'empty_bottle', 0x18: 'pickaxe', 0x19: 'recipe(sub=(type<<4)|sub)',
             0x1a: 'quest_item', 0x1b: 'misc_use', 0x1c: 'gold', 0x1d: 'collection_flag'}


def gen_catalog():
    equip = []
    for t in range(16):
        for sub in range(11):
            for g in range(5):
                e = item_entry(t, sub, g)
                e['slot'] = t // 3 if t < 15 else 5
                e['class'] = t % 3 if t < 15 else None
                e['grade_allowed'] = g <= u8(0x24636 + sub)
                equip.append(e)
    others = {}
    for t, n in TYPE_SUBS.items():
        others['0x%x' % t] = {'kind': TYPE_KIND[t], 'items': [item_entry(t, s) for s in range(n)]}
    others['0x19'] = {'kind': TYPE_KIND[0x19], 'note': 'name = inner item name (FUN_0003c944 case 0x19); model below is the scroll itself',
                      'items': [item_entry(0x19, (k << 4)) for k in (0, 1, 2, 0xf)]}
    others['0x1c'] = {'kind': 'gold', 'ground_name_text_id': 0xa45, 'ground_name': text(0xa45),
                      'ground_icon': icon_id(0x1a, 1), 'ground_icon_rect': icon_rect(icon_id(0x1a, 1))}
    return {
        'source': 'FUN_00036458 (model), FUN_000365ac (icon), FUN_0003bc80 (icon blit), FUN_0003c944 (name)',
        'rules': {
            'name_text_id': '0x7fc + model', 'desc_text_id': '0xa50 + model',
            'icon_image_index': '4 + icon/117 (images i0..i3)', 'icon_rect': '((icon%9)*16, ((icon%117)/9)*16, 16, 16)',
            'equipment_model': 'type*21 + d[0x245ff + sub*5 + grade]',
            'equipment_icon': '11*type + sub',
        },
        'type_name_base_d16_0x1b998': TYPE_BASE,
        'equipment': equip, 'others': others}


# ---------------------------------------------------------------- options
SPECIAL_EXTRA = {   # FUN_0003bdfc jump table .rodata 0x103358 (after the normal derived[k] +/- v)
    2: 'armor_pct', 33: 'armor_pct',
    36: ['+0x3028', '+0x302c'], 37: ['+0x3010', '+0x3014', '+0x3018'],
    45: ['+0x3074', '+0x3078', '+0x307c'], 54: ['+0x30c8'],
    61: ['-0x3028', '-0x302c'],
}


def gen_options():
    omap = bs(0x22a6a, 62)
    jt = so_i32(0x103358, 62)
    rows = []
    for i in range(62):
        k = omap[i]
        pfx = 0x776 + (i - 2 if i > 0xb else i)
        vals = [list(D[0x24393 + (g + i * 3) * 2:0x24393 + (g + i * 3) * 2 + 2]) for g in range(3)] if i < 52 else None
        rows.append({
            'id': i, 'derived_index': None if k == 255 else k,
            'derived_offset': None if k == 255 else '+0x%x' % (0x2ff4 + 4 * k),
            'subtract': i >= 0x38,
            'extra': SPECIAL_EXTRA.get(i),
            'jump_target': hex(0x103358 + jt[i]),
            'desc_text_id': 1972 + i, 'desc': text(1972 + i),
            'prefix_text_id': pfx if i < 52 else None, 'prefix': text(pfx) if i < 52 else None,
            'random_value_by_grade_1_3[base,range]': vals,
        })
    pool1 = [[x for x in (s8(0x226b1 + s * 0x13 + j) for j in range(0x13)) if x >= 0] for s in range(6)]
    pool2 = [[x for x in (s8(0x22723 + s * 0x13 + j) for j in range(0x13)) if x >= 0] for s in range(6)]
    uniq = []
    for idx in range(48):
        t, sub = idx // 3, 8 + idx % 3
        rec = bs(0x23fa3 + idx * 0x15, 0x15)
        uniq.append({'type': t, 'sub': sub, 'options[id,base,range]': [rec[j * 3:j * 3 + 3] for j in range(7)]})
    return {
        'source': 'd+0x22a6a option->derived idx (FUN_0003bdfc); d+0x24393 random values (FUN_0003c944); pools d+0x226b1/d+0x22723 stride 0x13, pick count d+0x244cb; unique d+0x23fa3',
        'options': rows,
        'random_option_count_by_grade_1_3': so_i32(0x1038d8, 3),
        'pool_pick_count_by_slot_d+0x244cb': bs(0x244cb, 6),
        'pool_first2_by_slot': pool1, 'pool_rest_by_slot': pool2,
        'unique_grade4_index': '(type*3 + sub-8)',
        'unique_grade4': uniq,
        'grade_name_colour_code_d+0x22795': [chr(c) for c in bs(0x22795, 5)],
        'socket_distribution_rand100000': [[25000, 0], [50000, 1], [70000, 2], [85000, 3], [95000, 4], [100000, 5]],
    }


def gen_sets():
    g1 = [bs(0x244d1 + s * 4, 4) for s in range(11)]
    g2 = [bs(0x244fd + s * 6, 6) for s in range(11)]
    g3 = [bs(0x2453f + s * 16, 16) for s in range(7)]
    g4 = [bs(0x245af + s * 20, 20) for s in range(3)]

    def pairs(r):
        return [[r[i], r[i + 1]] for i in range(0, len(r), 2)]
    return {
        'source': 'FUN_0003bdfc 0x3c022..0x3c7d4 (set bonus), applied when >=2 armor pieces (slots 1..4, usable) share sub and grade',
        'apply': 'derived[d[0x22a6a+id]] += (id==34 ? 10*v : v) ; id 255 skipped ; no subtract / special-extra handling',
        'grade1_by_sub': [{'sub': s, 'pieces2+': pairs(g1[s])} for s in range(11)],
        'grade2_by_sub': [{'sub': s, 'pieces2+': pairs(g2[s])} for s in range(11)],
        'grade3_by_sub': [{'sub': s + 4, 'pieces2_3': pairs(g3[s][:8]), 'pieces4': pairs(g3[s][8:])} for s in range(7)],
        'grade4_by_sub': [{'sub': s + 8, 'pieces2_3': pairs(g4[s][:10]), 'pieces4': pairs(g4[s][10:])} for s in range(3)],
    }


def gen_gems():
    return {
        'source': 'FUN_0003c944 case 0x10 (item), FUN_0003bdfc 0x3c20a (socket bonus, jump table .rodata 0x103450)',
        'gem_item': 'type 0x10, sub = kind*5 + tier (kind 0..5, tier 0..4), grade 0..4',
        'socket_byte': 'grade*50 + sub  (0xff = empty)',
        'value': 'd[0x26912 + tier*5 + grade]',
        'value_table[tier][grade]': [bs(0x26912 + t * 5, 5) for t in range(5)],
        'kind_to_stat': [
            {'kind': 0, 'option_id': 6, 'stat': 'STR +0x300c'}, {'kind': 1, 'option_id': 8, 'stat': 'VIT +0x3014'},
            {'kind': 2, 'option_id': 9, 'stat': 'INT +0x3018'}, {'kind': 3, 'option_id': 7, 'stat': 'AGI +0x3010'},
            {'kind': 4, 'option_id': 21, 'stat': 'luck +0x3038'}, {'kind': 5, 'option_id': 22, 'stat': 'EXP% +0x3030'}],
        'item_base_field_+0x04': 'same value d[0x26912 + (sub%5)*5 + grade]; +0x14 = option_id of the kind',
    }


def gen_consumables():
    buffs = []
    for i in range(35):
        r = bs(0x2513b + i * 4, 4)
        if i < 28:
            src = {'type': 0x11, 'sub': 14 + i}
        elif i < 31:
            src = {'type': 0x1b, 'sub': i - 7}
        else:
            src = {'type': 0x1b, 'sub': i + 4}
        m = model_id(src['type'], src['sub'])
        buffs.append({'slot': i, 'stat_id': None if r[0] == 255 else r[0], 'value': None if r[0] == 255 else (r[1] - 256 if r[1] > 127 else r[1]),
                      'duration_frames': 20000 if r[2] == 255 else r[2] * 10, 'b3': r[3],
                      'item': src, 'item_name': text(0x7fc + m)})
    flag_show = so_i32(0x103798, 39)
    flag_stack = [1] + so_i32(0x103624, 56)
    perm = [x for x in bs(0x26e85, 10) if x != 255]
    misc = []
    for s in range(57):
        m = model_id(0x1b, s)
        misc.append({'sub': s, 'name': text(0x7fc + m), 'stackable': bool(flag_stack[s]) if s < len(flag_stack) else True,
                     'hud_shows_count': bool(flag_show[s]) if s < 39 else False,
                     'permanent_unlock_bit': perm.index(s) if s in perm else None})
    potions = []
    pv = bs(0x24b0f, 16)
    for s in range(1, 13):
        e = {'sub': s, 'name': text(0x7fc + model_id(0x11, s)), 'table': pv[s]}
        if s <= 4:
            e['hp'] = pv[s] * 10
        elif s <= 8:
            e['mp'] = pv[s] * 10
        else:
            e['hp'] = pv[s] * 10
            e['mp'] = pv[s] * 8
        potions.append(e)
    return {
        'source': 'FUN_00040498 (use), FUN_00036d4c (cooldown groups), FUN_000373cc / FUN_0002c99c (buffs)',
        'potion_value_d+0x24b0f': pv,
        'potions': potions,
        'potion_formula': 'amount = (100 + potion%(+0x3054)) * k * table[sub] / 100 ; k = 10 (HP, MP), 8 (MP part of sub 9..12)',
        'cooldown_groups': [
            {'type': 0x11, 'subs': [1, 4], 'frames': 100, 'reduced_by': '+0x30b4 (idx48) %'},
            {'type': 0x11, 'subs': [5, 8], 'frames': 100, 'reduced_by': '+0x30b4 (idx48) %'},
            {'type': 0x11, 'subs': [9, 12], 'frames': 100, 'reduced_by': '+0x30b4 (idx48) %'},
            {'type': 0x11, 'subs': [13, 13], 'frames': 100, 'reduced_by': '+0x30b4 (idx48) %'},
            {'type': 0x11, 'subs': [14, 41], 'frames': 900},
            {'type': 0x1b, 'subs': [2, 2], 'frames': 16},
            {'type': 0x1b, 'subs': [0x15, 0x17], 'frames': 900},
            {'type': 0x1b, 'subs': [0x23, 0x23], 'frames': 900}, {'type': 0x1b, 'subs': [0x24, 0x24], 'frames': 900},
            {'type': 0x1b, 'subs': [0x25, 0x25], 'frames': 900}, {'type': 0x1b, 'subs': [0x26, 0x26], 'frames': 900}],
        'buff_slots_d+0x2513b': buffs,
        'buff_slot34_special_value_x10_d+0x251c4': u8(0x251c4),
        'misc_0x1b': misc,
        'misc_permanent_list_d+0x26e85': perm,
    }


def gen_drops():
    return {
        'source': 'FUN_0006ca90 / FUN_00037e04 (roll), FUN_0003b9c8 (spawn), FUN_0003b6e4 (scatter spawn), FUN_00063360 (bounce/despawn), FUN_0002f184 (draw/auto-loot)',
        'consumable_drop_weights_by_monster_type_d+0x23f22[type][return,hp_mp_potion,cure_all]': [bs(0x23f22 + t * 3, 3) for t in range(48)],
        'material_0x12_sub_by_monster_type_d+0x23e38': bs(0x23e38, 48),
        'object_slots': [116, 140],
        'pickup_box': {'monster_drop': [-30, -30, 60, 60], 'scatter_drop': [-20, -20, 40, 40]},
        'bounce_dy_by_phase': {'1': -12, '2': 2, '3': 3, '4': 3, '5': 4, '7': -2, '9': 1},
        'despawn_frames': 550,
    }


def gen_start():
    return {
        'source': 'FUN_00053510 case 2 (new game) after FUN_0001a8d8',
        'equipment': [{'slot': 0, 'create': 'FUN_0003c944(200, type=class, level=0, grade=0, sub=0, opt=0)', 'note': 'class weapon sub0 grade0, random sockets'}],
        'inventory': [{'type': 0x11, 'sub': 1, 'count': 10, 'name': text(0x7fc + model_id(0x11, 1))},
                      {'type': 0x18, 'sub': 0, 'count': 20, 'name': text(0x7fc + model_id(0x18, 0))}],
        'quick_slots': [{'slot': 0, 'kind': 'skill', 'id': 0}, {'slot': 5, 'key': '#', 'kind': 'item', 'inventory_index': 0}],
        'start_map_by_class': {0: 10, 1: 0x2f, 2: 0x62},
        'gold': 0,
    }


def gen_misc():
    return {
        'grade_colour': [{'grade': g, 'code': '|' + chr(c)} for g, c in enumerate(bs(0x22795, 5))],
        'level_table_d+0x24655(+11 tier2)': bs(0x24655, 22),
        'max_grade_by_sub_d+0x24636': bs(0x24636, 11),
        'accessory_base_extra_rodata_0x103704': so_i32(0x103704, 11),
        'enhance_side_bonus_FUN_000371c4': {
            'slot1 (type 3..5)': 'crit +0x3004 += rdiv(e^3, 580) + 1',
            'slot2 (type 6..8)': 'STR/AGI/VIT/INT += rdiv(e^3, 200) + 5',
            'slot3 (type 9..11)': 'luck +0x3038 += rdiv(e^3, 40) + 5',
            'slot4 (type 12..14)': 'crit dmg +0x30a4 += rdiv(e^3, 200) + 1'},
        'text_ids': {'name_plain': 0x1a7b, 'name_1prefix': 0x1ab8, 'name_2prefix': 0x1ab7, 'enhanced': 0x1acd,
                     'got_n': 0x1ab9, 'got': 0x1aba, 'cannot_hold_more': 0x1abb, 'gold_cap': 0x1abc,
                     'log_got_n': 0x3b5, 'log_got': 0x3b6, 'log_gold': 0x3b8, 'log_inventory_full': 0x3cc,
                     'use': 0x1ac0, 'no_area': 0x1abe, 'no_area_dim': 0x1ac2, 'no_slot': 0x1ac1, 'hp_full': 211,
                     'inventory_full_popup': 0x507},
    }


def main():
    global D, SO, T, TYPE_BASE
    ap = argparse.ArgumentParser()
    ap.add_argument('--assets', default='apk/assets')
    ap.add_argument('--so', default='apk/lib/armeabi/libGrantria.so')
    ap.add_argument('--out', default='work/data/items')
    a = ap.parse_args()
    D = open(os.path.join(a.assets, 'd.dat'), 'rb').read()
    SO = open(a.so, 'rb').read()
    T = {t['id']: t['text'] for t in grantria_data.load_texts(a.assets)}
    TYPE_BASE = u16s(0x1b998, 32)
    os.makedirs(a.out, exist_ok=True)
    misc = gen_misc()
    for g in misc['grade_colour']:
        from_code = {'a': 0x0000, 'b': 0xFFFF, 'c': 0xF800, 'd': 0xFFE0, 'e': 0x666C, 'g': 0xC99F, 'h': 0xED26}
        g['rgb'] = grantria_data.rgb565_to_hex(from_code[g['code'][1]])
    outs = {'catalog.json': gen_catalog(), 'options.json': gen_options(), 'sets.json': gen_sets(),
            'gems.json': gen_gems(), 'consumables.json': gen_consumables(), 'drops.json': gen_drops(),
            'starting.json': gen_start(), 'misc.json': misc}
    for n, o in outs.items():
        p = os.path.join(a.out, n)
        with open(p, 'w', encoding='utf-8') as f:
            json.dump(o, f, ensure_ascii=False, indent=1)
        print('wrote', p)


if __name__ == '__main__':
    main()
