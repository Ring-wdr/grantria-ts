// 원정(가제): the turn battle, drawn side-on: the encounter spot as the background, darkened (the field at its camera
// with a night shift), the party on the right facing left, the enemies on the left mirrored to face right (the
// original side frames), then the DOM: order bar, enemy gauges, party panel, AP, the command menu, the closing rings
// of an enemy's hits and the damage popups.
import type { Cmf } from '../../core/data/assets';
import type { Drawable } from '../../core/render';
import { AP_MAX, BK, COMMANDS, DODGE_MS, PARRY_MS, type Battle, type BUnit } from '../../core/expedition/battle';
import { animRec } from '../../core/expedition/species';
import type { FieldSim } from '../../core/expedition/field';
import type { GameContext } from '../game/scene';
import { h, type VNode } from '../render/view';
import { AVK } from '../../core/keys';
import { keyHint } from '../input/keyHints';
import { setDayShift } from '../render/sprites';
import type { WorldView } from './worldView';
import type { Talk } from '../../core/expedition/talk';
import { HERO_EQUIP } from './heroLook';

// the party stands left of the command column docked at the right edge (x ≥ 360)
const PARTY_AT: [number, number][] = [[300, 196], [334, 246], [266, 252]];
const ENEMY_AT: [number, number][] = [[104, 196], [62, 246], [146, 252]];

export class BattleView {
  constructor(private readonly ctx: GameContext, private readonly world: WorldView, private readonly cmfs: Map<string, Cmf>) {}

  /** where a unit stands (screen px), stepping toward its target while it acts */
  private pos(b: Battle, u: BUnit): [number, number] {
    const list = u.side === 'party' ? b.party : b.enemies, i = list.indexOf(u);
    let [x, y] = (u.side === 'party' ? PARTY_AT : ENEMY_AT)[i] ?? [240, 200];
    const a = b.act;
    if (a && a.actor === u && a.kind !== 'item') {
      const k = Math.sin(Math.min(1, a.t / a.dur) * Math.PI), [tx, ty] = this.pos0(b, a.targets[0]);
      x += (tx + (u.side === 'party' ? 40 : -40) - x) * k * 0.8;
      y += (ty - y) * k * 0.8;
    }
    const ea = b.enemyAct;
    if (ea && ea.actor === u && b.now >= ea.strikeAt - 200) {
      const [tx, ty] = this.pos0(b, ea.target), end = ea.hits[ea.hits.length - 1].t + 250;
      const k = b.now >= end ? Math.max(0, 1 - (b.now - end) / 300) : Math.min(1, (b.now - ea.strikeAt + 200) / 200);
      x += (tx - 40 - x) * k * 0.85;
      y += (ty - y) * k * 0.85;
    }
    return [Math.round(x), Math.round(y)];
  }

  private pos0(b: Battle, u: BUnit): [number, number] {
    const list = u.side === 'party' ? b.party : b.enemies, i = list.indexOf(u);
    return (u.side === 'party' ? PARTY_AT : ENEMY_AT)[i] ?? [240, 200];
  }

  private sprite(b: Battle, u: BUnit): Drawable | null {
    if (u.gone) return null;
    const [x, y] = this.pos(b, u), down = u.hp <= 0;
    const fx = down ? { tint: [40, 40, 60] as [number, number, number], amount: 18, alpha: 18 }
      : b.popups.some((p) => p.unit === u && p.kind === 'dmg' && p.t < 0.12) ? { tint: [255, 255, 255] as [number, number, number], amount: 24 }
      : u.broken ? { tint: [255, 230, 90] as [number, number, number], amount: 8 } : undefined;
    if (u.species === null) {
      const t = this.ctx.assets.tables, acts = t.playerActions[0], mult = t.actionMult[0], a = b.act;
      let frame = 6 + (Math.floor(b.t * 8) % 6);
      if (a && a.actor === u && a.kind !== 'item') {
        const ai = a.kind === 'skill' ? a.skill!.act : a.kind === 'counter' ? 2 : 0, rec = acts[ai];
        const k = Math.min(rec.n - 1, Math.floor((a.t / a.dur) * rec.n));
        frame = rec.frame[k] + (mult[ai] ?? 0);
      } else if (down) frame = 6;
      return { cmfName: 'cmf_c0', cmf: this.cmfs.get('cmf_c0')!, frame, x, y, equip: HERO_EQUIP, shadow: true, fx };
    }
    const sp = u.sp!, name = `cmf_c${sp.cmf}`, cmf = this.cmfs.get(name);
    if (!cmf) return null;
    const ea = b.enemyAct;
    let rec = cmf.anims[animRec(sp, sp.anim.idle, 0, 3)], k = Math.floor(b.t * 8);
    if (ea && ea.actor === u) {
      rec = cmf.anims[animRec(sp, sp.anim.attack, 0, 3)] ?? rec;
      k = b.now < ea.strikeAt ? 0 : Math.floor((b.now - ea.strikeAt) / 60);
      k = Math.min(rec.n - 1, k);
    } else if (b.act && b.act.actor === u) {
      rec = cmf.anims[animRec(sp, sp.anim.attack, 0, 3)] ?? rec;
      k = Math.min(rec.n - 1, Math.floor((b.act.t / b.act.dur) * rec.n));
    } else k %= rec.n;
    return { cmfName: name, cmf, frame: rec.frames[k] ?? 0, x, y, mirror: u.side === 'enemy', shadow: true, fx };
  }

  draw(b: Battle, f: FieldSim, talk: Talk | null = null): void {
    setDayShift(14, 30, 12);                                     // subtracted from the colour: about 45% darker
    this.world.render(f.camX, f.camY, []);
    setDayShift(0, 0, 0);
    const ents = b.units.map((u) => this.sprite(b, u)).filter((d): d is Drawable => !!d).sort((p, q) => p.y - q.y);
    this.world.overlay(ents);
    this.ctx.compositor.show();
    const u = this.ctx.ui;
    u.view('ex-battle', 0, 0, 480, 320, this.tree(b, talk));
    this.drawFx(b);
  }

  /** effect sprites on the struck and the parry rings */
  private drawFx(b: Battle): void {
    const u = this.ctx.ui, a = b.act;
    if (a && a.done && a.kind !== 'item') {
      const k = Math.floor(((a.t - a.hitAt) / 0.35) * 6);
      if (k < 6) for (const t of a.targets) { const [x, y] = this.pos0(b, t); u.effect(k, x, y - 18); }
    }
    for (const p of b.popups) {
      if (p.kind !== 'dmg' || p.t > 0.3 || p.unit.side !== 'party') continue;
      const [x, y] = this.pos0(b, p.unit);
      u.effect(Math.min(5, Math.floor(p.t * 20)), x, y - 18);
    }
  }

  private glyph(keys: readonly number[]): string {
    for (const k of keys) { const g = keyHint(this.ctx.input, k); if (g) return g.glyph; }
    return '';
  }

  private bar(cls: string, v: number): VNode {
    return h(`div.exb-bar.${cls}`, null, h('div.exb-fill', { style: `width:${Math.max(0, Math.min(1, v)) * 100}%` }));
  }

  private tree(b: Battle, talk: Talk | null): VNode {
    const order = b.order(7);
    const kids: VNode[] = [];
    kids.push(h('div.v-row.exb-order', null, h('span.exb-order-l', null, '순서'),
      order.map((x, i) => h(`div.exb-chip.${x.side}${i === 0 && (b.phase === 'command' || b.phase === 'enemy') ? '.now' : ''}${x.broken ? '.broken' : ''}`, null, x.name.slice(0, 4)))));
    kids.push(h('div.exb-line', null, b.line));
    // enemy gauges over their heads
    b.enemies.forEach((e) => {
      if (e.gone || e.hp <= 0) return;
      const [x, y] = this.pos(b, e);
      kids.push(h('div.v-col.exb-tag', { style: `left:${x - 34}px;top:${y - 66}px` },
        h('div.exb-name', null, `${e.name}${e.broken ? ' · BREAK' : ''}`),
        this.bar('hp', e.hp / e.hpMax), this.bar(`brk${e.broken ? '.full' : ''}`, e.brk / e.brkMax)));
    });
    // target cursor
    if (b.phase === 'command' && b.menu === 'target') {
      const t = b.targets()[b.targetSel];
      if (t) { const [x, y] = this.pos(b, t); kids.push(h('div.exb-cursor', { style: `left:${x - 6}px;top:${y - 80}px` }, '▼')); }
    }
    if (b.phase === 'command' && b.actor) { const [x, y] = this.pos(b, b.actor); kids.push(h('div.exb-me', { style: `left:${x - 6}px;top:${y - 62}px` }, '▼')); }
    // the party
    kids.push(h('div.v-col.exb-party', null,
      h('div.v-row.exb-ap', null, h('span', null, 'AP'), Array.from({ length: AP_MAX }, (_, i) => h(`i.exb-pip${i < b.ap ? '.on' : ''}`))),
      b.party.map((p) => h(`div.v-row.exb-member${b.actor === p ? '.turn' : ''}${p.hp <= 0 ? '.down' : ''}`, null,
        h('span.exb-mname', null, `${p.name} Lv.${p.member?.lv ?? p.lv}`),
        this.bar('hp', p.hp / p.hpMax), h('span.exb-hpn', null, `${p.hp}/${p.hpMax}`)))));
    if (b.phase === 'command') { kids.push(this.menuTree(b)); const p = this.prompt(b); if (p) kids.push(h('div.exb-prompt', null, p)); }
    if (b.phase === 'enemy') kids.push(...this.defenseTree(b));
    for (const p of b.popups) {
      if (p.unit.gone && p.kind !== 'info') continue;
      const [x, y] = this.pos0(b, p.unit);
      kids.push(h(`div.exb-pop.${p.kind}`, { style: `left:${x - 30}px;top:${y - 50 - p.t * 26}px;opacity:${Math.min(1, (1.1 - p.t) * 3)}` }, p.text));
    }
    if (talk) kids.push(this.talkTree(talk));
    if (b.phase === 'intro') kids.push(h('div.exb-intro', null, b.line));
    if (b.phase === 'won') kids.push(h('div.v-col.exb-result', null, h('div.exb-result-t', null, b.exp ? '승리!' : '전투 종료'), b.exp ? h('div', null, `EXP +${b.exp}`) : null,
      b.levelUps.map((l) => h('div.exb-lvup', null, l)), h('div.exb-cont', { on: () => [0x35] }, `${this.glyph([0x35])} 계속`)));
    if (b.phase === 'lost') kids.push(h('div.v-col.exb-result.lost', null, h('div.exb-result-t', null, '전멸...'), h('div.exb-cont', { on: () => [0x35] }, `${this.glyph([0x35])} 계속`)));
    return h('div.v-fill.exb', null, ...kids);
  }

  /** the negotiation box: a line, a choice, or the chance roll */
  private talkTree(t: Talk): VNode {
    const st = t.step, ok = this.glyph([0x35]);
    if (st.kind === 'roll') {
      const k = Math.min(1, t.rollT / 1.2), shown = st.chance * 100;
      return h('div.v-col.ex-talk.roll', null,
        h('div.ext-who', null, '영입 확률'),
        st.parts.filter(([, v]) => Math.abs(v) > 0.001).map(([l, v]) => h('div.v-row.ext-part', null, h('span.v-grow', null, l), h(`span${v < 0 ? '.neg' : ''}`, null, `${v >= 0 ? '+' : ''}${Math.round(v * 100)}%`))),
        h('div.v-row.ext-total', null, h('span.v-grow', null, '합계'), h('span', null, `${Math.round(shown)}%`)),
        h('div.ext-meter', null, h('div.ext-chance', { style: `width:${shown}%` }), h('div.ext-needle', { style: `left:${k < 1 ? (Math.abs(Math.sin(t.rollT * 9)) * 100) : (st.success ? shown * 0.5 : shown + (100 - shown) * 0.5)}%` })),
        k >= 1 ? h(`div.ext-res${st.success ? '.ok' : ''}`, { on: () => [0x35] }, `${st.success ? '성공!' : '실패...'}  ${ok}`) : null);
    }
    const body: VNode[] = [h('div.ext-who', null, st.who || '…'), h('div.ext-text', null, st.text)];
    if (st.kind === 'choose') st.options.forEach((o, i) => body.push(h(`div.ex-item.ext-opt${i === t.sel ? '.sel' : ''}`, { on: () => { t.choose(i); } }, o)));
    else body.push(h('div.ext-next', { on: () => [0x35] }, `${ok} ▶`));
    return h('div.v-col.ex-talk', null, ...body);
  }

  /** the guidance under the turn line: what to pick, the skill under the cursor, why a command is off */
  private prompt(b: Battle): string | null {
    if (b.menu === 'target') return b.pending?.kind === 'talk' ? '누구와 대화할까?' : '대상을 고르세요';
    if (b.menu === 'item') return `회복약 ×${b.run.potions} — 누구에게?`;
    if (b.menu === 'skill') { const s = b.skills()[b.subSel]; return s ? `${s.name} · ${s.desc}` : null; }
    return b.blocked(COMMANDS[b.sel]);
  }

  /** the command column at the right edge; the skill / item lists open in the same place */
  private menuTree(b: Battle): VNode {
    const rows: VNode[] = [];
    if (b.menu === 'main' || b.menu === 'target') {
      COMMANDS.forEach((c, i) => {
        const why = b.blocked(c);
        rows.push(h(`div.ex-item${i === b.sel ? '.sel' : ''}${why ? '.off' : ''}`, { on: () => { b.tap('main', i); } }, c));
      });
    } else if (b.menu === 'skill') {
      b.skills().forEach((s, i) => rows.push(h(`div.v-row.ex-item${i === b.subSel ? '.sel' : ''}${b.ap < s.ap ? '.off' : ''}`, { on: () => { b.tap('skill', i); } },
        h('span.v-grow', null, s.name), h('span.exb-cost', null, `AP ${s.ap}`))));
    } else if (b.menu === 'item') {
      b.liveParty.forEach((p, i) => rows.push(h(`div.v-row.ex-item${i === b.subSel ? '.sel' : ''}`, { on: () => { b.tap('item', i); } },
        h('span.v-grow', null, p.name), h('span.exb-cost', null, `${p.hp}/${p.hpMax}`))));
    }
    // touch has no cancel key: a back row under a sub-list or the target pick
    if (b.menu !== 'main' && this.ctx.input.device === 'touch') rows.push(h('div.ex-item.exb-back', { on: () => { b.menuKey(AVK.CLR); } }, '◀ 뒤로'));
    return h('div.v-col.ex-menu.exb-menu', null, ...rows);
  }

  /** the closing rings of the coming hits over the target and the defense keys */
  private defenseTree(b: Battle): VNode[] {
    const ea = b.enemyAct!, out: VNode[] = [];
    const [x, y] = this.pos0(b, ea.target), now = b.now;
    const next = ea.hits.find((hh) => !hh.result);
    if (next) {
      const span = Math.max(600, ea.move.windup * 1000), k = Math.max(0, (next.t - now) / span);
      const r = 14 + k * 46, good = Math.abs(next.t - now) <= PARRY_MS;
      out.push(h(`div.exb-ring${good ? '.good' : ''}`, { style: `left:${x - r}px;top:${y - 18 - r}px;width:${2 * r}px;height:${2 * r}px` }));
      out.push(h('div.exb-ring.core', { style: `left:${x - 14}px;top:${y - 32}px;width:28px;height:28px` }));
    }
    const late = ea.hits.filter((hh) => hh.result).length;
    out.push(h('div.v-row.exb-defkeys', null,
      h('span', null, `${this.glyph(BK.PARRY)} 패링 ±${PARRY_MS}ms`), h('span', null, `${this.glyph(BK.DODGE)} 회피 ±${DODGE_MS}ms`),
      h('span.exb-dim', null, `${late}/${ea.hits.length}`)));
    if (ea.whiff && now - ea.whiff.t < 380) out.push(h('div.exb-whiff', { style: `left:${x - 30}px;top:${y - 84}px` }, '헛손질!'));
    return out;
  }
}
