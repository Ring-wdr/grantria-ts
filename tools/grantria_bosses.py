#!/usr/bin/env python3
"""Boss AI data for the browser port (analysis/features/monster-ai.md).

Two kinds of content end up in analysis/features/data/bosses/bosses.json:

1. Extracted (reproducible from the original files)
   * d.dat type row  d+0x22d3d + type*8         (cmf, behaviour, mode, sight ...)
   * cmf AI bytes    (cmf_cN trailing 8 bytes; normal-monster table, bosses ignore it)
   * cmf anim records (n, frames, steps) and per-frame body/attack boxes
   * attack/body box overrides of FUN_000231e4 - evaluated by running the original
     Thumb code with tools/grantria_thumb_emu.py for every frame / facing / action
   * d.dat facing tables d+0x24ab9 (4-dir FACING) and d+0x24abd (2-dir V)
   * d.dat spawn-kind record 0 (King Dusty summon) d+0x21592
2. Transcribed from the decompile/disassembly (function addresses in each entry):
   action -> record, rest cycles, decision rules, projectiles, damage multipliers.
   These are typed by hand in BOSSES / MULTIPLIERS below; derived timings (ticks per
   action) are then computed from the cmf.

usage: python -I tools/grantria_bosses.py [--assets decoded_grantria/assets]
                                          [--so decoded_grantria/lib/armeabi/libGrantria.so]
                                          [--out analysis/features/data/bosses]
                                          [--no-emu]
"""
import argparse
import json
import os
import struct
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import grantria_gfx as gg              # noqa: E402
import grantria_thumb_emu as emu       # noqa: E402

D_TYPE = 0x22d3d          # d.dat type table, 8 bytes per type
D_FACING4 = 0x24ab9       # dir(0 L,1 R,2 U,3 D) -> F (0 down, 1 side, 2 up)
D_FACING2 = 0x24abd       # lastV & 1 -> V (2 up -> 1 back, 3 down -> 0 front)
D_KIND = 0x21592          # FUN_00069528 spawn-kind records, 9 x s16

VA_FUN_231E4 = 0x131e4    # FUN_000231e4 (Ghidra 0x231e4) in ELF va space
VA_FUN_7AE1C = 0x6ae1c    # cmf slot select (stubbed)
VA_FUN_21F94 = 0x11f94    # object index (stubbed)
VA_BOXTAB = 0x3b46e4      # DAT_003c46e4: u32 per cmf slot -> 8-byte frame boxes
VA_OBJS = 0x3f96f8        # DAT_004096f8 object array (0x94 bytes each)

NAMES = {5: '킹더스티', 8: '위치트리', 11: '타우론', 14: '블랙 레오', 17: '크호르크호르', 20: '루크',
         23: '야누스카드', 26: '가디어스', 29: '크라켄', 32: '켈베로스', 35: '퀸 프로스트웜',
         38: '입실론', 39: '마더', 42: '베르무트'}
FUNCS = {5: 0x6bfb8, 8: 0x6bc88, 11: 0x6b8f0, 14: 0x6b550, 17: 0x6b314, 20: 0x6afec, 23: 0x6adc8,
         26: 0x6ab54, 29: 0x6a938, 32: 0x6a730, 35: 0x6a490, 38: 0x6a078, 39: 0x6c540, 42: 0x6a2b8}
# FUN_00061bb0(event) on boss death (game-rules.md §6); 32 uses 0x67 or 0x4c by story state
DEATH_EVENT = {5: 0x09, 8: 0x13, 11: 0x1d, 14: 0x21, 17: 0x28, 20: 0x2b, 23: 100, 26: 0x39,
               29: 0x42, 32: [0x67, 0x4c], 35: 0x58, 38: 0x6a, 39: 0x50, 42: 0x6c}
# FUN_0001b334 (game-rules.md §3.5): HP x, ATK x  [normal, hard]
HP_ATK_MULT = {5: [[5, 1.2], [6.5, 1.2]], 8: [[5, 0.84], [6.5, 0.96]], 11: [[5, 0.72], [6.5, 0.96]],
               14: [[5, 0.81], [6.5, 1.08]], 17: [[5, 1.05], [6.5, 1.2]], 20: [[5, 1.5], [6.5, 1.2]],
               23: [[6, 1.5], [7, 1.2]], 26: [[5, 1.5], [6, 1.05]], 29: [[5, 1.5], [8.4, 1.05]],
               32: [[5, 1.5], [9.6, 1.05]], 35: [[5, 1.5], [11.2, 1.2]], 38: [[10, 1.5], [30, 1.5]],
               39: [[5, 1.5], [12.6, 1.2]], 42: [[5, 1.5], [10, 1.5]]}

# ---------------------------------------------------------------- damage switch
# FUN_0006f370 switch on attacker type (jump table 0x3a8d78, verified by disassembly
# 0x6f782..0x6fcea). mult = percent applied as rdiv(dmg*mult, 100) (FUN_0007b1f0).
# knock: FUN_00060d10(attacker, player, 6 stun-push | 7 knockback).
# "attacker" is the boss itself for melee, and for projectiles it is the OWNER
# (boss, using the boss's current +0x76) except type 17 where the projectile object
# itself is the attacker (FUN_0006fd44 0x6ff40).
MULTIPLIERS = [
    {'type': 5, 'action': 12, 'mult': 150, 'knock': 6, 'cond': 'knock skipped if player +0x79 == 13',
     'pre': 'before the invincibility check: DAT_00413a1e=12, DAT_00413a1f=push dir by landing corner, knock 6 (push speed +5)'},
    {'type': 8, 'action': 6, 'mult': 240, 'knock': None,
     'pre': 'before the invincibility check: player +0x76 = 5 and knock 6 -> player stunned 20 ticks after the push'},
    {'type': 11, 'action': 6, 'mult': 100, 'knock': None},
    {'type': 11, 'action': 8, 'mult': 140, 'knock': 7},
    {'type': 11, 'action': 'other', 'mult': 100, 'knock': 6},
    {'type': 14, 'action': 9, 'mult': 200, 'knock': 6, 'cond': 'knock skipped if player +0x79 == 2'},
    {'type': 17, 'action': 9, 'mult': 100, 'knock': None, 'extra': 'player poison timer +0x58 = 200 (projectile is the attacker)'},
    {'type': 17, 'action': 'other', 'mult': 100, 'knock': 7, 'cond': 'rand(5) <= 1 (40%)'},
    {'type': 20, 'action': 6, 'mult': 200, 'knock': 7},
    {'type': 20, 'action': 8, 'mult': 300, 'knock': None},
    {'type': 23, 'action': 'any', 'mult': 100, 'knock': None, 'extra': 'DAT_00413a1e += 1 (hit counter, enables transform)'},
    {'type': 26, 'action': 9, 'mult': 200, 'knock': 6},
    {'type': 29, 'action': 3, 'mult': 150, 'knock': 7},
    {'type': 29, 'action': 4, 'mult': 200, 'knock': None},
    {'type': 32, 'action': 2, 'mult': 300, 'knock': None},
    {'type': 32, 'action': 3, 'mult': 200, 'knock': None},
    {'type': 32, 'action': 4, 'mult': 200, 'knock': 6},
    {'type': 32, 'action': 'other', 'mult': 100, 'knock': 6, 'extra': 'action 1: FUN_00060d10 forces player dir 2 (pushed down)'},
    {'type': 35, 'action': 2, 'mult': 300, 'knock': 6},
    {'type': 38, 'action': 2, 'mult': 100, 'knock': 6, 'extra': 'FUN_00060d10 forces player dir 2'},
    {'type': 38, 'action': 3, 'mult': 300, 'knock': None},
    {'type': 38, 'action': 4, 'mult': 70, 'knock': None},
    {'type': 39, 'action': 5, 'mult': 200, 'knock': 6},
    {'type': 42, 'action': 2, 'mult': 100, 'knock': 6, 'extra': 'FUN_00060d10 forces player dir 2'},
    {'type': 42, 'action': 3, 'mult': 200, 'knock': None},
]

PLAYER_KNOCK = {
    'func': 'FUN_0007172c (player state 6/7), started by FUN_00060d10',
    'state6': {'counter_start': 5, 'speed_by_counter': [0, 1, 2, 5, 10, 20], 'ticks': 6, 'total_px': 38},
    'state7': {'counter_start': 9, 'speed_by_counter': [0, 1, 0, 1, -2, 3, -4, 5, -6, 64], 'ticks': 10, 'total_px': 62},
    'king_dusty_bonus': 'while DAT_00413a1e == 12 every push step uses stun table + 5 (state 6: 25,15,10,7,6,5 = 68 px)',
    'frame': 'fixed idle frame: dir 2 -> 12, dir 0/1 -> 6, dir 3 -> 0',
    'end': 'counter 0: if +0x76 == 5 -> state 5, +0x5a = 20 (stun 20 ticks) else state 0, rec 0; +0x76 = 0 (attack cancelled)',
    'direction': 'player dir set to face the attacker (|dx|>|dy| -> 0/1 else 2/3); push = away from attacker; '
                 'overrides: DAT_00413a1e==12 (King Dusty) uses landing corner; type 38/42 action 2 and type 32 action 1 force dir 2',
}

# ---------------------------------------------------------------- per-boss spec
# rec formulas: 'F+k' (4-dir, F = FACING[dir]), 'V+k' (2-dir, V = lastV==2 ? 1 : 0),
# 'k' (fixed). rest = +0x8e cycles of idle (state 0, idle rec) after the action ends.
BOSSES = {
    5: {
        'dir_mode': 4, 'chase_speed': 'step + DAT_00413a26', 'attack_range': 'DAT_00413a24*16, a24 = 5 if dir==2 else 3',
        'hold': '+0x81 (hit freeze) stops t',
        'actions': {
            6: {'rec': 'F+6', 'rest': 1, 'start': 'chase until in range', 'what': 'swipe; steps -2,-4,+10,-4 along facing'},
            12: {'rec': 'F+12', 'rest': 4, 'start': 'immediately (rand(5)==0)', 'what': 'jump smash to a room corner',
                 'timeline': {'78': 'pick corner by player vs (232,302); store delta=(corner-pos)/4 in +0x08/+0x0c',
                              '79,80,80,81': 'pos += delta', '82': 'pos = corner', '83': 'screen shake 2; attack box override'}},
            9: {'rec': 'F+9', 'rest': None, 'state': 9, 'what': 'summon Dusty (type 3) at frame F*4+0x45 (69/73/77)'},
        },
        'corners': [[120, 300], [356, 300], [236, 222], [240, 382]],
        'phases': [{'hp_below': 0.8, 'a1c': 1}, {'hp_below': 0.5, 'a1c': 2}, {'hp_below': 0.3, 'a1c': 3}],
        'phase_effect': '+0x7f = 4 summons (one per cycle while a free spot exists)',
        'summon': {'kind': 0, 'type': 3, 'pos': 'boss dir 0:x-70 1:x+70 2:y-92 3:y+42 (FUN_0002e824 tests 4 spots in order L,R,U,D; '
                   'spot must not overlap player and be walkable)', 'level': 'boss level - 7',
                   'hp': '10L+140+400L^2/300', 'atk': 'rdiv(boss ATK*50,100)', 'state': 2,
                   'note': 'parent +0x48 = boss; FUN_00072400 forces state 2 every tick while parent type == 5'},
    },
    8: {
        'dir_mode': '2 (move/idle/attack 4 use V; charge uses FACING)', 'chase_speed': 'step + DAT_00413a26',
        'attack_range': 'a24*16, a24 = 5 if lastV==2 else 3', 'hold': '+0x81 stops t',
        'timer': '+0x18 counts every tick; when >= 301 at a cycle end: +0x18 = rand(150), state 4 (back off)',
        'actions': {
            4: {'rec': 'V+4', 'rest': 1, 'start': 'chase until in range', 'what': 'branch swipe'},
            6: {'rec': 'F+6', 'rest': 2, 'start': 'cycle end while in state 4', 'what': 'charge (steps 48,54,50,34,...)',
                'collide': 'wall (axis blocked) -> DAT_00413a25=1 -> stun 30 ticks (state 0xd, frame F*6+0x2f), shake 2; '
                           'player body overlap -> a25=2 -> shake 2, state 0xd without timer'},
        },
        'retreat': 'state 4: face player (4-dir), move AWAY at rec step (V+2, 5 px), one cycle, then action 6',
    },
    11: {
        'dir_mode': 2, 'chase_speed': 'step + DAT_00413a26', 'attack_range': 'a24*16, a24 = 5 if lastV==2 else 3',
        'hold': '+0x81 stops t', 'back_flip': 'when lastV==2 lastH/dir are inverted (back sprite)',
        'actions': {
            4: {'rec': 'V+4', 'rest': 3, 'start': 'chase until in range', 'what': 'axe smash; frames 36/46 shake 2'},
            6: {'rec': 'V+6', 'rest': 2, 'start': 'chase until in range', 'what': 'two-hit swing'},
            8: {'rec': 'V+8', 'rest': 5, 'start': 'immediately', 'what': 'homing rush at rec step (16) toward player'},
        },
        'decision': ['rand(100) always drawn', 'a1c==0 and HP < 0.8 max -> a1c=1, action 8 now',
                     'HP < max/2 and r < 10 -> action 8 now',
                     'else chase; a1c<3: rand(3)==0 -> action 6, a1c=0 ; else action 4, a1c++ ; a1c>=3 -> action 6, a1c=0'],
    },
    14: {
        'dir_mode': 4, 'chase_speed': 'step + DAT_00413a26 + (+0x82: 4 while DAT_00413a1d>0)',
        'attack_range': 'a24*16, a24 = 5 if dir==2 else 4', 'hold': '+0x81 stops t',
        'actions': {
            6: {'rec': 'F+6', 'rest': 1, 'start': 'chase until in range', 'what': 'claw'},
            9: {'rec': 'F+9', 'rest': 2, 'start': 'immediately (rand(5)==1)', 'what': 'dash 40 px/tick x5; body overlap -> shake 2'},
            12: {'rec': 'F+12', 'rest': 2, 'start': 'phase change', 'what': 'roar; frame (F+0x15)*4 (84/88/92): player slow timer +0x54 = 60, player state 2'},
        },
        'phases': [{'hp_below': 0.7, 'a1c': 1}, {'hp_below': 0.5, 'a1c': 2}, {'hp_below': 0.3, 'a1c': 3}],
        'phase_effect': 'action 12 now, ATK(+0x6a) += 4, DAT_00413a1d = 3 (speed buff 3 x 100 ticks via a1e counter)',
        'decision': ['player +0x79 == 2 (slowed) -> chase, action 6', '+0x8e==0: chase; rand(5)==1 -> action 9 now else action 6',
                     'phase check overrides (see phases)'],
    },
    17: {
        'dir_mode': 4, 'chase_speed': 'step + DAT_00413a26', 'attack_range': 'a24*16, a24 = 4', 'hold': '+0x81 stops t',
        'actions': {
            6: {'rec': 'F+6', 'rest': 3, 'start': 'chase until in range', 'what': 'melee'},
            9: {'rec': 'F+9', 'rest': 2, 'start': 'immediately', 'what': 'cast: 3 poison globs at frame F*6+0x41 (65/71/77)'},
        },
        'decision': ['r = rand(10); +0x8e==0: r < 3 and player poison timer (+0x58) == 0 -> action 9 now; else chase, action 6'],
        'projectiles': [{'spawn': 'FUN_0006205c/FUN_00061c10 case 0x11', 'count': 3, 'frame': 0x4e, 'life': 45,
                         'pos': 'boss (x, y-50)', 'behaviour': 4, 'action(+0x76)': 9,
                         'motion': 'life >= 35 and not hit: per idx (+0x7f) velocity below; afterwards frame 0x4f, static',
                         'vel': {'dir1': [[7, -2], [8, 3], [7, 8]], 'dir0': [[-7, -2], [-8, 3], [-7, 8]],
                                 'dir2': [[-4, -7], [0, -8], [4, -7]], 'dir3': [[-4, 9], [0, 11], [4, 9]]},
                         'hit': 'attacker = projectile (level 0, ATK = boss ATK): poison 200; projectile +0x79 = 1 (stops)'}],
    },
    20: {
        'dir_mode': 2, 'chase_speed': 'step + DAT_00413a26 + DAT_00413a1e (5 while charging)',
        'attack_range': 'a24*16, a24 = 5 if lastV==2 else 3', 'hold': '+0x81 stops t',
        'actions': {
            4: {'rec': 'V+4', 'rest': 2, 'start': 'chase until in range', 'what': 'punch (a1c++)'},
            6: {'rec': 'V+6', 'rest': 3, 'start': 'chase until in range (after two 4s)', 'what': 'heavy blow; frames 46/55 flash, 47/56 shake'},
            8: {'rec': 'V+8', 'rest': 6, 'start': 'after charge reaches range', 'what': 'charged blow (25 ticks)'},
        },
        'decision': ['a1d = 10 if HP < max/2 else 5', 'a1e != 0 -> keep charging (action 8)',
                     '+0x8e==0: rand(100) < a1d -> a1e=5 (charge: +5 speed, t advances twice, screen flash 5 per tick), action 8',
                     'else chase with action 4 (a1c 0,1) or 6 (a1c 2)'],
    },
    23: {
        'dir_mode': 'rec ignores facing (sprite mirrored by dir)', 'chase_speed': 'step', 'hold': 'none',
        'attack_range': 'a24*16; lastV==2: form1 6 / form0 8 ; else form0 5 / form1 6',
        'forms': 'DAT_00413a1c: 0 or 1; rec = form*3 + k',
        'actions': {
            1: {'rec': '1', 'rest': 4, 'start': 'chase until in range (form 0)', 'what': 'form 0 attack'},
            4: {'rec': '4', 'rest': 2, 'start': 'chase until in range (form 1)', 'what': 'form 1: 3 cards at frame 0x28'},
            2: {'rec': '2', 'rest': 2, 'state': 0, 'what': 'transform 0->1 (frame 0x16 sets a1c=1)'},
            5: {'rec': '5', 'rest': 2, 'state': 0, 'what': 'transform 1->0 (frame 0xe sets a1c=0)'},
        },
        'decision': ['r = rand(5); +0x8e==0: r==0 and a1e(player hit count) > 1 -> transform (state 0, rec form*3+2)',
                     'else chase, action form*3+1'],
        'projectiles': [{'spawn': 'FUN_00061c10 case 0x17', 'count': 3, 'frame': '0x2e+idx (idx2 facing right: 0x31)', 'life': 25,
                         'behaviour': 4, 'action(+0x76)': 4, 'y': 'boss y-46 (idx2 facing right: y-35)',
                         'facing_right': [{'dir': 1, 'x': 100, 'v': [7, 0]}, {'dir': 3, 'x': 5, 'v': [0, 7]},
                                          {'dir': 2, 'x': 80, 'v': [6, 6]}],
                         'facing_left_or_vertical': [{'dir': 0, 'x': -100, 'v': [-7, 0]}, {'dir': 3, 'x': -40, 'v': [0, 7]},
                                                     {'dir': 2, 'x': -5, 'v': [-6, 6]}],
                         'hit': 'attacker = boss (owner)'}],
        'death_frame': 'a1c*30',
    },
    26: {
        'dir_mode': 4, 'chase_speed': 'step', 'attack_range': 'a24*16, a24 = 5 if dir==2 else 3', 'hold': 'none',
        'actions': {
            6: {'rec': 'F+6', 'rest': 1, 'start': 'chase until in range', 'what': 'slash (a1c++)'},
            9: {'rec': 'F+9', 'rest': 2, 'start': 'chase until in range', 'what': 'dash slash 16 px x5 (a1c++)'},
            12: {'rec': 'F+12', 'rest': 0, 'start': 'see decision', 'what': 'special (25 ticks), resets a1c,a1d'},
        },
        'decision': ['+0x8e==0: chase; r=rand(10)', 'a1e==1 and a1d==0 -> action 12 now, a1e=0',
                     'a1d==1 and r<3 -> action 12 (on range); r==0 -> a1e=1 (repeat once more right after)',
                     'else rand(2): 0 -> 6, 1 -> 9', 'after starting 6/9: a1c > 2 -> a1d = 1'],
    },
    29: {
        'dir_mode': 'stationary, rec = action', 'chase_speed': 'never chases', 'hold': 'none',
        'actions': {
            1: {'rec': '1', 'rest': 3, 'what': 'tentacle A'}, 2: {'rec': '2', 'rest': 3, 'what': 'tentacle B'},
            3: {'rec': '3', 'rest': 5, 'what': '3 ink drops at frame 20'}, 4: {'rec': '4', 'rest': 6, 'what': 'homing bubble at frame 21'},
        },
        'decision': ['every cycle end: +0x8d = 1 (act) unless resting', 'r = rand(10); a1c != 0 -> a1c = 0, repeat previous action',
                     'r<2 -> 3 (r==0: a1c=1 -> repeated once)', 'r<4 -> 4',
                     'player x in [171,369] and y < 510 -> rand(2) ? 2 : 1', 'else rand(10) < 2 ? 3 : 4'],
        'projectiles': [
            {'frame_trigger': 20, 'count': 3, 'frame': '0x18+idx', 'life': 25, 'behaviour': 4, 'action(+0x76)': 3,
             'start': [[-70, 20], [-20, 20], [15, 20]], 'vel': [[-10, 10], [0, 15], [10, 10]], 'hit': 'attacker = boss'},
            {'frame_trigger': 21, 'count': 1, 'frame': '0x1c..0x1f loop', 'life': 40, 'behaviour': 5, 'action(+0x76)': 4,
             'start': [[-40, -20]], 'motion': 'homing 5 px/tick (FUN_000609c0)', 'hit': 'attacker = boss; removed on hit'}],
    },
    32: {
        'dir_mode': 'stationary, rec = action', 'chase_speed': 'never chases', 'hold': 'none',
        'actions': {
            1: {'rec': '1', 'rest': 3, 'what': 'wide melee'}, 2: {'rec': '2', 'rest': 7, 'what': 'close melee'},
            3: {'rec': '3', 'rest': 5, 'what': '2 falling fireballs at frame 22'}, 4: {'rec': '4', 'rest': 6, 'what': '2 homing fireballs at frame 23'},
        },
        'decision': ['every cycle end +0x8d = 1 unless resting', 'rand(10)==0 -> 4',
                     'py > by+150 and bx-66 <= px <= bx+72 -> 3',
                     'py <= by+119 and bx-66 <= px <= bx+72 -> 2',
                     'bx-166 <= px <= bx+162 and py <= by+141 -> 1', 'else 4'],
        'projectiles': [
            {'frame_trigger': 22, 'count': 2, 'frame': 0x24, 'life': 35, 'scale': 2, 'behaviour': 4, 'action(+0x76)': 3,
             'start': [[-60, 30], [15, 30]], 'vel': [[0, 15], [0, 15]], 'hit': 'attacker = boss; removed'},
            {'frame_trigger': 23, 'count': 2, 'frame': '0x24..0x27 loop', 'life': 40, 'behaviour': 5, 'action(+0x76)': 4,
             'start': [[-60, 30], [15, 30]], 'motion': 'homing 6 px/tick',
             'hit': 'attacker = boss; if frame==0x24 at hit: flame at player (x, y+15) (frame 0x20..0x23 loop, life 20, '
                    '+0x7f=-2, stays and keeps hitting); projectile removed'}],
    },
    35: {
        'dir_mode': 'three objects, role = +0x7f', 'hold': 'none',
        'objects': {'main(role 1)': 'DAT_00413a1e, rec 0, decides when DAT_00413a1f == 1 (every tick)',
                    'A(role 0)': 'DAT_00413a1c, copy at frame 6, rec 1 idle / 3 bite / 4 suck',
                    'B(role 2)': 'DAT_00413a1d, copy at (x-180, y-10), inactive; strikes once (rec 2) then deactivates at t == n+1'},
        'actions': {
            3: {'rec': '3 (A)', 'what': 'bite, attack box frame 30'},
            4: {'rec': '4 (A)', 'what': 'suck: frame 0x22 -> player state 8 (pulled to (230,300) at 9 px/tick, 4 if holding away); '
                                        'player inside x 215..245, y 305..335 -> player state 0, A plays rec 3'},
            2: {'rec': '2 (B)', 'what': 'B appears at (px+100, py-100) facing left or (px-100, py-100) facing right and strikes'},
            1: {'rec': '1 (A)', 'what': 'idle'},
        },
        'decision': ['A cycle end: B inactive -> (a20==0 ? a1f=1 : a20--), A rec 1',
                     'main, a1f==1: player x in [151,329] and y < 380 -> A action 3, a20=2',
                     'else rand(3): 0 -> A action 4, a20=3 ; 1 -> B strike if px > mainX+44 or px < mainX-46 (else retry next tick), a20=1 ;'
                     ' 2 -> A rec 1'],
    },
    38: {
        'dir_mode': 'stationary (dir forced 3), rec = action', 'hold': '+0x81 stops t',
        'actions': {
            2: {'rec': '2', 'rest': 4, 'what': 'flash strike: frame 0xf spawns 1-tick object at (x, y-90)'},
            3: {'rec': '3', 'rest': 7, 'what': 'beam: tracks player x at 4 px/tick (dead zone 9); frame 0x1c spawns beam (life 16) '
                                               'that follows boss x; always done twice in a row'},
            4: {'rec': '4', 'rest': 6, 'what': '4 homing orbs at frame 0x33'},
        },
        'idle': 'state 0: returns to spawn x at 6 px/tick (dead zone 9)',
        'decision': ['a1c==1 -> action 3 (second beam)', '+0x8e==0: r=rand(10)',
                     'player outside x [bx-171, bx+167] or py > by+95 -> rand(10) < 5 ? 3 : 4',
                     'else r==1 -> 3, r==2 -> 4, else 2'],
        'projectiles': [
            {'frame_trigger': 0x33, 'count': 4, 'frame': 0x36, 'life': 25, 'behaviour': 5, 'action(+0x76)': 4, '+0x7f': 4,
             'start': [[-40, 20], [30, 20], [-20, 50], [50, 50]],
             'motion': 'homing at rand(8)*2 px/tick (re-rolled each tick)',
             'hit': 'first contact: +0x7f=6, +0x76=6, life=7, no damage; then explodes (damage by boss, boss +0x76)'},
            {'frame_trigger': 0x1c, 'count': 1, 'frame': 0x3d, 'life': 16, 'behaviour': 7, '+0x7f': 3, 'start': [[0, 10]],
             'motion': 'x += boss +0x72 each tick'},
            {'frame_trigger': 0xf, 'count': 1, 'frame': 0x4d, 'life': 1, 'behaviour': 7, '+0x7f': 2, 'start': [[0, -90]]}],
    },
    39: {
        'dir_mode': 'three objects, role = +0x7f', 'hold': '+0x81 stops t',
        'objects': {'body(role 0)': 'DAT_00413a1c, rec 0', 'arm(role 1)': 'DAT_00413a1d, at (x+40, y-30), rec 1/3/4',
                    'head(role 2)': 'DAT_00413a1e, at (x-20, y-10), rec 2/5'},
        'enrage': 'HP < max/2 at a cycle end -> a20 = 25, a22 = 1 (else a20 = 10)',
        'actions': {
            3: {'rec': '3 (arm)', 'what': 'grab: monster attack box contact sets player state 1 (frozen), rec 0; '
                                          'released at frame 0x23'},
            4: {'rec': '4 (arm)', 'what': 'swipe'},
            5: {'rec': '5 (head)', 'what': 'breath: frame 0x35 spawns hit object (x-20, y+60) life 4 following head x'},
        },
        'arm': ['idle (rec 1, +0x8d==0): a22==0: a1f==0 -> fly to (px-35, py-90) at 4 px/tick; when player-(35,90) is in '
                '[x-20,x+30]x[y,y+5] -> action 4 ; a1f==1 -> return to spawn at 6',
                'a22==1: band [y,y+10]; aligned -> rand(2) ? action 4 : action 3'],
        'head': ['rec 2: follow player x at 3 px/tick (dead zone x-39..x-21); rec 5: 5+2*a22 px/tick (dead zone x-49..x-31)',
                 'cycle end: player grabbed -> +0x8d=1, a1f=1 ; else rand(100) < a20 -> +0x8d=3, a1f=1',
                 'rec 2: +0x8d-- ; reaching 0 from 1 -> action 5 ; rec 5 -> rec 2, a1f=0'],
        'sync': 'head/arm hit tint (+0x1c) copied from body every tick',
    },
    42: {
        'dir_mode': 2, 'hold': '+0x81 stops t', 'back_flip': 'after facing the player lastH/dir are inverted every cycle end',
        'actions': {
            2: {'rec': '2', 'rest': 4, 'what': 'melee (box frame 26)'},
            3: {'rec': '3', 'rest': 7, 'what': '5 falling shards at frame 0x11'},
        },
        'decision': ['every cycle end +0x8d = 1 unless resting',
                     'player outside x [bx-147, bx+141] or py > by+107 or rand(10)==0 -> 3 ; else 2'],
        'projectiles': [{'frame_trigger': 0x11, 'count': 5, 'frames': [0x22, 0x23, 0x24, 0x25, 0x26], 'life': 30, 'scale': 2,
                         'behaviour': 4, 'start': [[-100, 0], [-40, -10], [-30, 0], [-20, -10], [20, 0]],
                         'vel': [[-7, 6], [-5, 8], [0, 9], [5, 8], [7, 6]], 'hit': 'attacker = boss'}],
    },
}

COMMON = {
    'dispatch': 'FUN_0007343c: +0x89 == 11 -> FUN_0006c960(obj) -> per-type function; afterwards '
                'if HP*5 < maxHP: DAT_00413a26 = 4 (chase speed bonus for 5/8/11/14/17/20)',
    'globals': {'DAT_00413a1c..DAT_00413a26': 'u8 x 11 boss scratch (meaning per boss)',
                'reset': 'FUN_00017cd0 (game init), FUN_00019dd0 (map load), FUN_0006e120 when a boss dies; '
                         'FUN_0001b334 stores part slots for 35/39'},
    'skeleton': ['n = FUN_00061088(m): n = rec length, frame = rec.frame[t%n], +0x72 = rec.step[t%n], +0x73 = 0',
                 'event running (DAT_003b3be9): per-boss special (usually t++ only)',
                 'state 1: velocity = step along facing (dir<2: x * (dir&1?+1:-1), else y) ; FUN_000681f8 move ; per-type effects',
                 'state 2: player alive and dist(player,m) < range -> FUN_00063218 (clear hit lists), +0x8d = 1 ; '
                 'else FUN_000609c0 chase at speed, FUN_000681f8',
                 'FUN_000231e4 boxes',
                 'if +0x81: +0x81-- (t frozen) else t++   [types with hold]',
                 'if t == n: face player (FUN_00061158), set range, choose next (rest / pattern), t = 0',
                 'if +0x8d: +0x8e = rest(action), +0x8d--, state 1, rec = formula(action), t = 0'],
    'hit_freeze': 'FUN_0006d2f8: player hit on a boss in state 0 or 2 -> boss +0x81 = 1 (one tick hold)',
    'no_hurt_state': 'bosses never enter hurt/knockback state 6/7 (combat.md §3.2)',
    'rng': 'FUN_000f8490 rand(n) (game-rules.md §8)',
    'tick': '20 FPS fixed',
    'player_knock': PLAYER_KNOCK,
}


# ---------------------------------------------------------------- extraction
def load(p):
    with open(p, 'rb') as f:
        return f.read()


def type_row(d, t):
    r = d[D_TYPE + t * 8:D_TYPE + t * 8 + 8]
    return {'cmf': r[0], 'behaviour': r[1], 'draw': r[2], 'b3': r[3], 'exp_bonus': r[4],
            'dir_mode': r[5], 'wander_b6': r[6], 'sight_x8': r[7]}


def cmf_info(cmf):
    recs = []
    for a in cmf['anims']:
        fr = a['frames']
        atk = []
        for k, f in enumerate(fr):
            ab = cmf['frames'][f]['attack_box']
            if ab[2] > 0 and ab[3] > 0:
                atk.append({'k': k, 'frame': f, 'box': ab})
        recs.append({'rec': a['index'], 'n': a['n'], 'frames': fr, 'step': a['step'], 'attack': atk})
    return recs


class BoxEmu:
    """Run FUN_000231e4 for a synthetic object and read back body/attack boxes."""

    def __init__(self, so):
        self.so = so

    def run(self, typ, cmf, frame, dir_, lastH, lastV, action, state=1, slot=7, idx=5):
        m = emu.Mem(self.so)
        BOX = 0x7e000000
        for i, f in enumerate(cmf['frames']):
            m.write(BOX + i * 8, struct.pack('<bbBBbbBB', *f['body_box'], *f['attack_box']))
        m.w32(VA_BOXTAB + slot * 4, BOX)
        o = VA_OBJS + idx * 0x94
        m.w32(o + 0x20, typ)
        m.w16(o + 0x6e, frame)
        for off, v in ((0x78, slot), (0x7a, dir_), (0x7b, lastH), (0x7c, lastV), (0x76, action),
                       (0x79, state), (0x8c, 1), (0x89, 11)):
            m.w8(o + off, v)

        def ret_idx(cpu):
            cpu.r[0] = idx
        cpu = emu.CPU(m, {VA_FUN_7AE1C: lambda c: None, VA_FUN_21F94: ret_idx})
        cpu.call(VA_FUN_231E4, [o])
        att = [emu.s32(m.r32(o + 0x28)), emu.s16(m.r16(o + 0x62)), m.r16(o + 0x64), m.r16(o + 0x66)]
        body = [emu.s16(m.r16(o + 0x4c)), emu.s16(m.r16(o + 0x4e)), m.r16(o + 0x50), m.r16(o + 0x52)]
        return body, att, m.r8(o + 0x80)


def default_box(b, dir_):
    """cmf box with the generic FUN_000231e4 mirror rule (dx' = -dx - w when dir & 1)."""
    if b[2] == 0 and b[3] == 0:
        return [0, 0, 0, 0]
    return [(-b[0] - b[2]) if dir_ & 1 else b[0], b[1], b[2], b[3]]


COMBOS = [(0, 0, 3), (1, 1, 3), (0, 1, 3), (1, 0, 3), (2, 0, 2), (3, 1, 3)]


def box_overrides(be, typ, cmf, actions):
    out = []
    for f in range(cmf['n_frames']):
        fb = cmf['frames'][f]
        results = {}
        differs = False
        for a in actions:
            for (d, h, v) in COMBOS:
                body, att, sz = be.run(typ, cmf, f, d, h, v, a)
                exp_att = default_box(fb['attack_box'], d)
                exp_body = default_box(fb['body_box'], d)
                norm = lambda b: b if b[2] or b[3] else [0, 0, 0, 0]  # noqa: E731
                if norm(att) != norm(exp_att) or norm(body) != norm(exp_body):
                    differs = True
                results[(a, d, h, v)] = (body, att)
        if not differs:
            continue
        # collapse: describe the unmirrored box (dir 0, lastH 0) per action and the mirror flag
        per_action = {}
        for a in actions:
            r00 = results[(a, 0, 0, 3)][1]
            r_dir = results[(a, 1, 0, 3)][1]
            r_h = results[(a, 0, 1, 3)][1]
            mirror = 'none'
            if r_dir != r00 and r_h == r00:
                mirror = 'dir&1 (+0x7a)'
            elif r_h != r00 and r_dir == r00:
                mirror = 'lastH (+0x7b)'
            elif r_h != r00 and r_dir != r00:
                mirror = 'both?'
            per_action[a] = {'attack': r00, 'mirror': mirror, 'mirrored_attack': results[(a, 1, 1, 3)][1],
                             'body': results[(a, 0, 0, 3)][0]}
        uniq = {json.dumps(v, sort_keys=True) for v in per_action.values()}
        entry = {'frame': f, 'cmf_attack': fb['attack_box'], 'cmf_body': fb['body_box']}
        if len(uniq) == 1:
            entry.update(next(iter(per_action.values())))
        else:
            entry['by_action'] = {str(a): v for a, v in per_action.items()}
        out.append(entry)
    return out


def normal_wander(d, assets):
    """FUN_0007210c inputs per normal monster type: radius R = (type[6]>>1)*16 and the
    size class +0x80 = (max(body w, h) & 0xfff) >> 5 written by FUN_000231e4 every tick."""
    out = {}
    for t in range(3, 43):
        if t in BOSSES:
            continue
        row = type_row(d, t)
        p = os.path.join(assets, 'cmf_c%d.dat' % row['cmf'])
        if not os.path.isfile(p):
            continue
        cmf = gg.parse_cmf(load(p))
        four = row['dir_mode'] != 2
        idle = [0, 1, 2] if four else [0, 1]
        move = [3, 4, 5] if four else [2, 3]
        def sizes(recs):
            v = set()
            for r in recs:
                if r < len(cmf['anims']):
                    for f in cmf['anims'][r]['frames']:
                        bb = cmf['frames'][f]['body_box']
                        v.add((max(bb[2], bb[3]) & 0xfff) >> 5)
            return sorted(v)
        steps = sorted({s for r in move if r < len(cmf['anims']) for s in cmf['anims'][r]['step']})
        out[str(t)] = {'R': (row['wander_b6'] >> 1) * 16, 'b6': row['wander_b6'], 'dir_mode': row['dir_mode'],
                       'size_class_idle': sizes(idle), 'size_class_move': sizes(move), 'move_steps': steps,
                       'sight_px': row['sight_x8'] * 8, 'ai_bytes': cmf['trailing_hex']}
    return out


def normal_box_overrides(be, d, assets):
    """FUN_000231e4 type cases for normal monsters (behaviour 1): e.g. type 0x18 frames 24/25 put the
    attack box at y -139, which the cmf's signed byte cannot hold (it stores 117)."""
    out = {}
    for t in range(3, 43):
        row = type_row(d, t)
        if t in BOSSES or row['behaviour'] != 1:
            continue
        p = os.path.join(assets, 'cmf_c%d.dat' % row['cmf'])
        if not os.path.isfile(p):
            continue
        ov = box_overrides(be, t, gg.parse_cmf(load(p)), [0])
        if ov:
            out[str(t)] = ov
            print('type %2d normal overrides %d (frames %s)' % (t, len(ov), [o['frame'] for o in ov]))
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--assets', default='apk/assets')
    ap.add_argument('--so', default='apk/lib/armeabi/libGrantria.so')
    ap.add_argument('--out', default='work/data/bosses')
    ap.add_argument('--no-emu', action='store_true', help='skip FUN_000231e4 box override evaluation')
    a = ap.parse_args()

    d = load(os.path.join(a.assets, 'd.dat'))
    so = load(a.so)
    be = BoxEmu(so)
    kind0 = list(struct.unpack_from('<9h', d, D_KIND))

    res = {
        'source': 'tools/grantria_bosses.py (extracted from d.dat / cmf / FUN_000231e4 emulation + hand transcription)',
        'doc': 'analysis/features/monster-ai.md',
        'facing4': list(d[D_FACING4:D_FACING4 + 4]),
        'facing2': list(d[D_FACING2:D_FACING2 + 2]),
        'summon_kind0_record': {'raw': kind0, 'fields': 'frame, action, +0x73, status(+0x79), type, dx, dy, draw(+0x8a), behaviour(+0x89)'},
        'common': COMMON,
        'multipliers': MULTIPLIERS,
        'bosses': {},
    }
    for t, spec in BOSSES.items():
        cmf = gg.parse_cmf(load(os.path.join(a.assets, 'cmf_c%d.dat' % t)))
        recs = cmf_info(cmf)
        b = {'name': NAMES[t], 'name_text_id': 993 + t, 'func': 'FUN_%08x' % FUNCS[t],
             'type_row': type_row(d, t), 'cmf': 'cmf_c%d' % t,
             'cmf_ai_bytes': cmf['trailing_hex'], 'death_event': DEATH_EVENT[t], 'hp_atk_mult': HP_ATK_MULT[t],
             'multipliers': [m for m in MULTIPLIERS if m['type'] == t], 'recs': recs}
        b.update(spec)
        # ticks per action from rec formula
        timing = {}
        for act, ad in spec.get('actions', {}).items():
            f = str(ad['rec']).split()[0]
            if f.startswith('F+'):
                k = int(f[2:])
                timing[str(act)] = {'dir%d' % dd: recs[k + res['facing4'][dd]]['n'] for dd in range(4)}
            elif f.startswith('V+'):
                k = int(f[2:])
                timing[str(act)] = {'front(V0)': recs[k]['n'], 'back(V1)': recs[k + 1]['n']}
            else:
                k = int(f)
                if k < len(recs):
                    timing[str(act)] = recs[k]['n']
        b['action_ticks'] = timing
        b['frames_with_attack_box'] = {str(i): f['attack_box'] for i, f in enumerate(cmf['frames'])
                                       if f['attack_box'][2] > 0 and f['attack_box'][3] > 0}
        if not a.no_emu:
            acts = sorted({0} | {int(x) for x in spec.get('actions', {})})
            b['box_overrides'] = box_overrides(be, t, cmf, acts)
        res['bosses'][str(t)] = b
        print('type %2d %-8s recs %2d overrides %s' % (t, NAMES[t], len(recs),
                                                      len(b.get('box_overrides', [])) if not a.no_emu else '-'))
    res['normal_wander'] = normal_wander(d, a.assets)
    if not a.no_emu:
        res['normal_box_overrides'] = normal_box_overrides(be, d, a.assets)
    os.makedirs(a.out, exist_ok=True)
    p = os.path.join(a.out, 'bosses.json')
    with open(p, 'w', encoding='utf-8') as f:
        json.dump(res, f, ensure_ascii=False, indent=1)
    print('wrote', p)


if __name__ == '__main__':
    main()
