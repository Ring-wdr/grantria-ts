// 원정(가제): the turn battle, drawn side-on: the encounter spot as the background, darkened (the field at its camera
// with a night shift), the party on the right facing left, the enemies on the left mirrored to face right (the
// original side frames), then the DOM: order bar, enemy gauges, party panel, AP, the command menu, the closing rings
// of an enemy's hits and the damage popups. A shot move (Move.shot) is fired from where the enemy stands: its projectile
// (the species' field shot frame) reaches the target on each hit's time. The decision kit (expedition-balance.md §18):
// status chips under every unit, an enemy's weaknesses (? till found) and its next action in a bubble over it, a boss's
// charge count and enrage count, the hellhound's three heads as their own tags, the order bar previewing a delay, and
// the defense cues: a red edge before a dodge-only hit, the screen in black and white while a parry-only one comes, a
// "!" over the attacker before a late hit. Rare creatures and shiny recruits sparkle (cmf_status 0x5d..0x63). The
// backdrop carries the field's day / night shift.
import type { Cmf } from '../../core/data/assets';
import type { Drawable } from '../../core/render';
import { ALL_OUT, AP_MAX, BK, DODGE_MS, LATE_CUE_MS, PARRY_MS, PARRY_NARROW_MS, type Battle, type BUnit } from '../../core/expedition/battle';
import { STATUS_DESC, STATUS_NAME, TYPE_NAME, animRec } from '../../core/expedition/species';
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
const ENEMY_AT: [number, number][] = [[104, 196], [62, 246], [146, 252], [40, 196], [168, 204]];
/** a boss's heads, from its body (left, middle, right) */
const HEAD_AT: [number, number][] = [[-56, -36], [0, -52], [56, -36]];
/** the party's middle, where a whole-party move is aimed */
const PARTY_MID: [number, number] = [300, 230];
/** a shot flies this long to its hit (ms) */
const SHOT_MS = 380;
/** skill rows shown at once (the list scrolls with the cursor) */
const SKILL_ROWS = 6;

export class BattleView {
  constructor(private readonly ctx: GameContext, private readonly world: WorldView, private readonly cmfs: Map<string, Cmf>) {}

  /** the unit is playing the party action (총공격: every standing member) */
  private acting(b: Battle, u: BUnit): boolean {
    const a = b.act;
    return !!a && a.kind !== 'item' && (a.actor === u || (a.kind === 'allout' && u.side === 'party' && u.hp > 0));
  }

  /** where a unit stands (screen px), stepping toward its target while it acts */
  private pos(b: Battle, u: BUnit): [number, number] {
    if (u.body) return this.pos0(b, u);
    const list = u.side === 'party' ? b.party : b.enemies, i = list.indexOf(u);
    let [x, y] = (u.side === 'party' ? PARTY_AT : ENEMY_AT)[i] ?? [240, 200];
    const a = b.act;
    if (a && this.acting(b, u)) {
      const k = Math.sin(Math.min(1, a.t / a.dur) * Math.PI), [tx, ty] = this.pos0(b, a.targets[a.kind === 'allout' ? Math.max(0, i) % a.targets.length : 0]);
      x += (tx + (u.side === 'party' ? 40 : -40) - x) * k * 0.8;
      y += (ty - y) * k * 0.8;
    }
    const ea = b.enemyAct;
    if (ea && ea.actor === u && !ea.move.shot && b.now >= ea.strikeAt - 200) {
      const [tx, ty] = ea.target ? this.pos0(b, ea.target) : PARTY_MID, end = ea.hits[ea.hits.length - 1].t + 250;
      const k = b.now >= end ? Math.max(0, 1 - (b.now - end) / 300) : Math.min(1, (b.now - ea.strikeAt + 200) / 200);
      x += (tx - 40 - x) * k * 0.85;
      y += (ty - y) * k * 0.85;
    }
    return [Math.round(x), Math.round(y)];
  }

  private pos0(b: Battle, u: BUnit): [number, number] {
    if (u.body) {
      const [x, y] = this.pos0(b, u.body), [dx, dy] = HEAD_AT[u.body.heads.indexOf(u)] ?? [0, 0];
      return [x + dx, y + dy];
    }
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
      if (a && this.acting(b, u)) {
        const ai = a.kind === 'skill' ? a.skill!.act : a.kind === 'counter' || a.kind === 'allout' ? 2 : 0, rec = acts[ai];
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
      rec = cmf.anims[animRec(sp, ea.move.anim ?? sp.anim.attack, 0, 3)] ?? rec;
      k = b.now < ea.strikeAt ? 0 : Math.floor((b.now - ea.strikeAt) / 60);
      k = Math.min(rec.n - 1, k);
    } else if (b.act && this.acting(b, u)) {
      rec = cmf.anims[animRec(sp, sp.anim.attack, 0, 3)] ?? rec;
      k = Math.min(rec.n - 1, Math.floor((b.act.t / b.act.dur) * rec.n));
    } else k %= rec.n;
    return { cmfName: name, cmf, frame: rec.frames[k] ?? 0, x, y, mirror: u.side === 'enemy', shadow: true, fx };
  }

  /** the sparkle over a rare creature or a shiny recruit */
  private sparkles(b: Battle): Drawable[] {
    const cmf = this.cmfs.get('cmf_status');
    if (!cmf) return [];
    return b.units.filter((u) => !u.gone && u.hp > 0 && (u.rare || u.member?.shiny)).map((u) => {
      const [x, y] = this.pos(b, u);
      return { cmfName: 'cmf_status', cmf, frame: 0x5d + (Math.floor(b.t * 10 + u.id) % 7), x, y: y - 16 };
    });
  }

  /** day: the field's day / night shift (the original's row); the backdrop is that and about 45% darker on top */
  draw(b: Battle, f: FieldSim, talk: Talk | null = null, day: [number, number, number] = [0, 0, 0]): void {
    setDayShift(14 + day[0], 30 + day[1], 12 + day[2]);
    this.world.render(f.camX, f.camY, []);
    setDayShift(0, 0, 0);
    const ents = b.units.map((u) => this.sprite(b, u)).filter((d): d is Drawable => !!d).sort((p, q) => p.y - q.y);
    this.world.overlay([...ents, ...this.shots(b), ...this.skillProj(b), ...this.sparkles(b)]);
    this.ctx.compositor.show();
    const u = this.ctx.ui;
    u.view('ex-battle', 0, 0, 480, 320, this.tree(b, talk));
    this.drawFx(b);
  }

  /** a shot move's projectiles: each leaves the shooter SHOT_MS before its hit and reaches the target on it; parried it
   *  flies back, dodged it flies on past */
  /** an original skill's projectile on its targets, in cmf_c0 frames at the original's ticks (skills.md §4.2):
   *  부메랑소드's sword circling from tick 10 for 17 ticks (frames 631 → 623), 슬라이더's sword mark from tick 6 for 5
   *  ticks (633..637) and the struck mark after its hit (651..653, two ticks a frame) */
  private skillProj(b: Battle): Drawable[] {
    const a = b.act, p = a?.skill?.proj, cmf = this.cmfs.get('cmf_c0');
    if (!a || !p || !cmf) return [];
    const tick = Math.floor(a.t / 0.05), out: Drawable[] = [];
    const at = (t: BUnit, frame: number, dy: number) => { const [x, y] = this.pos0(b, t); out.push({ cmfName: 'cmf_c0', cmf, frame, x, y: y + dy, equip: HERO_EQUIP }); };
    for (const t of a.targets) {
      if (t.hp <= 0 && t.side === 'enemy' && p === 'slider' && tick > 14) continue;
      if (p === 'boomerang' && tick >= 10 && tick < 27) at(t, 631 - ((tick - 10) % 9), -10);
      if (p === 'slider') {
        if (tick >= 6 && tick < 11) at(t, 633 + (tick - 6), -10);
        if (tick >= 8 && tick < 14) at(t, 651 + Math.min(2, Math.floor((tick - 8) / 2)), -24);
      }
    }
    return out;
  }

  private shots(b: Battle): Drawable[] {
    const ea = b.enemyAct, sp = ea?.actor.sp, shot = sp?.field.shot;
    if (!ea || !ea.move.shot || !sp || !shot) return [];
    const name = `cmf_c${sp.cmf}`, cmf = this.cmfs.get(name);
    if (!cmf) return [];
    const [ax, ay] = this.pos0(b, ea.actor), [tx, ty] = ea.target ? this.pos0(b, ea.target) : PARTY_MID, out: Drawable[] = [];
    const sx = ax + 22, sy = ay - shot.lift, ex = tx, ey = ty - shot.lift;
    for (const hit of ea.hits) {
      const k = (b.now - (hit.t - SHOT_MS)) / SHOT_MS;
      if (k < 0) continue;
      let x: number, y: number, back = false;
      if (k <= 1) { x = sx + (ex - sx) * k; y = sy + (ey - sy) * k; }
      else if (hit.result === 'parry' && k <= 2) { back = true; x = ex + (sx - ex) * (k - 1); y = ey + (sy - ey) * (k - 1); }
      else if (hit.result === 'dodge' && k <= 1.5) { x = ex + (ex - sx) * (k - 1); y = ey + (ey - sy) * (k - 1); }
      else continue;
      out.push({ cmfName: name, cmf, frame: shot.side, x: Math.round(x), y: Math.round(y), mirror: !back,
        fx: back ? { tint: [120, 200, 255], amount: 14 } : undefined });
    }
    return out;
  }

  /** effect sprites on the struck and the parry rings */
  private drawFx(b: Battle): void {
    const u = this.ctx.ui, a = b.act;
    if (a && a.lastHit !== undefined && a.kind !== 'item') {        // after every hit (a skill may land several)
      const k = Math.floor(((a.t - a.lastHit) / 0.35) * 6);
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
    const now0 = b.order(7), pv = b.preview(7), order = pv ?? now0;
    const kids: VNode[] = [];
    kids.push(h('div.v-row.exb-order', null, h('span.exb-order-l', null, pv ? '순서 (예상)' : '순서'),
      order.map((x, i) => h(`div.exb-chip.${x.side}${i === 0 && (b.phase === 'command' || b.phase === 'enemy') ? '.now' : ''}${x.broken ? '.broken' : ''}${pv && now0[i] !== x ? '.moved' : ''}`, null, x.name.slice(0, 4)))));
    kids.push(h('div.exb-line', null, b.line));
    // enemy gauges over their heads (the one being aimed at lit)
    const picking = b.phase === 'command' && b.menu === 'target', aimed = picking ? b.targets()[b.targetSel] : null;
    b.enemies.forEach((e) => {
      if (e.gone || e.hp <= 0) return;
      const [x, y] = this.pos(b, e), heads = e.heads.length > 0, big = !!e.sp?.boss;
      const ein = big ? b.enrageIn : null, top = y - (big ? 118 : 74) - (heads ? 30 : 0);
      kids.push(h(`div.v-col.exb-tag${e === aimed ? '.aimed' : ''}`, { style: `left:${x - 34}px;top:${top}px` },
        h('div.exb-name', null, `${e.rare ? '빛나는 ' : ''}${e.summoned ? '(부하) ' : ''}${e.name}${e.broken ? ' · BREAK' : ''}`),
        this.bar('hp', e.hp / e.hpMax), heads ? null : this.bar(`brk${e.broken ? '.full' : ''}`, e.brk / e.brkMax),
        this.weakTree(b, e), heads ? null : this.stTree(b, e),
        e.charge !== null && e.charge > 0 ? h('div.exb-charge', null, `차지 ${e.charge}`) : null,
        e.enraged ? h('div.exb-enrage.on', null, '광폭화!') : ein !== null ? h('div.exb-enrage', null, `광폭화까지 ${ein}턴`) : null));
      const it = b.phase !== 'enemy' || b.enemyAct?.actor !== e ? b.intentText(e) : null;
      if (it) kids.push(h(`div.exb-intent${e.intent?.charge ? '.charge' : ''}`, { style: `left:${x}px;top:${top - 14}px` }, it));
      for (const hd of e.heads) {
        const [hx, hy] = this.pos0(b, hd);
        kids.push(h(`div.v-col.exb-tag.head${hd === aimed ? '.aimed' : ''}${hd.broken ? '.broken' : ''}`, { style: `left:${hx - 23}px;top:${hy - 34}px` },
          h('div.exb-name', null, hd.name.replace(' 머리', '')), this.bar(`brk${hd.broken ? '.full' : ''}`, hd.brk / hd.brkMax), this.stTree(b, hd)));
      }
    });
    // target cursor; each target is tapped or clicked to pick it at once
    if (picking) {
      if (aimed) { const [x, y] = this.pos(b, aimed); kids.push(h('div.exb-cursor', { style: `left:${x - 6}px;top:${y - (aimed.body ? 46 : 80)}px` }, '▼')); }
      b.targets().forEach((t, i) => { const [x, y] = this.pos(b, t); kids.push(h('div.exb-pick', { style: `left:${x - 28}px;top:${y - (t.body ? 30 : 60)}px${t.body ? ';width:50px;height:44px' : ''}`, on: () => { b.tap('target', i); } })); });
    }
    if (b.phase === 'command' && b.actor) { const [x, y] = this.pos(b, b.actor); kids.push(h('div.exb-me', { style: `left:${x - 6}px;top:${y - 62}px` }, '▼')); }
    // the party
    kids.push(h('div.v-col.exb-party', null,
      h('div.v-row.exb-ap', null, h('span', null, 'AP'), Array.from({ length: AP_MAX }, (_, i) => h(`i.exb-pip${i < b.ap ? '.on' : ''}`))),
      b.party.map((p) => h(`div.v-row.exb-member${b.actor === p ? '.turn' : ''}${p.hp <= 0 ? '.down' : ''}`, null,
        h('span.exb-mname', null, `${p.name} Lv.${p.member?.lv ?? p.lv}`),
        this.bar('hp', p.hp / p.hpMax), h('span.exb-hpn', null, `${p.hp}/${p.hpMax}`), this.stTree(b, p)))));
    if (b.phase === 'command') { const m = this.menuTree(b); if (m) kids.push(m); const p = this.prompt(b); if (p) kids.push(h('div.exb-prompt', null, p)); }
    if (b.phase === 'enemy') kids.push(...this.defenseTree(b));
    for (const p of b.popups) {
      if (p.unit.gone && p.kind !== 'info') continue;
      const [x, y] = this.pos0(b, p.unit);
      kids.push(h(`div.exb-pop.${p.kind}${p.crit ? '.crit' : ''}`, { style: `left:${x - 30}px;top:${y - 50 - p.t * 26}px;opacity:${Math.min(1, (1.1 - p.t) * 3)}` }, p.text));
    }
    if (talk) kids.push(this.talkTree(talk));
    if (b.phase === 'intro') kids.push(h('div.exb-intro', null, b.line));
    if (b.phase === 'won') kids.push(h('div.v-col.exb-result', null, h('div.exb-result-t', null, b.exp ? '승리!' : '전투 종료'), b.exp ? h('div', null, `EXP +${b.exp}`) : null,
      b.gold ? h('div.exb-gold', null, `골드 +${b.gold}G`) : null,
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
    if (b.menu === 'target') {
      const touch = this.ctx.input.device === 'touch', what = b.pending?.kind === 'talk' ? '누구와 대화할까?' : '누구를 칠까?';
      const t = b.targets()[b.targetSel], sts = t ? b.statuses(t).map(([k]) => `${STATUS_NAME[k]}: ${STATUS_DESC[k]}`) : [];
      return (touch ? `${what} 적을 누르세요` : `${what}  ◀▶ 고르기 · ${this.glyph([AVK.OK])} 결정 · ${this.glyph([AVK.CLR])} 뒤로`) + (sts.length ? ` — ${sts.join(' · ')}` : '');
    }
    if (b.menu === 'item') return `회복약 ×${b.run.potions} — 누구에게?`;
    if (b.menu === 'skill') { const s = b.skills()[b.subSel]; return s ? b.skillText(s) : null; }
    const c = b.commands()[b.sel];
    if (c === ALL_OUT) return '적이 모두 브레이크! 파티 전원이 모든 적을 친다 (이후 적은 일어난다)';
    if (c === '대화' && b.allBroken && !b.blocked(c)) return '적이 모두 무릎을 꿇었다. 검사가 말을 건다';
    return c ? b.blocked(c) : null;
  }

  /** the command column at the right edge; the skill / item lists open in the same place. While a target is picked the
   *  column is gone (the eye goes to the enemies), but for a back button on touch */
  private menuTree(b: Battle): VNode | null {
    const rows: VNode[] = [];
    if (b.menu === 'target') {
      if (this.ctx.input.device !== 'touch') return null;
      return h('div.v-col.ex-menu.exb-menu', null, h('div.ex-item.exb-back', { on: () => { b.menuKey(AVK.CLR); } }, '◀ 뒤로'));
    }
    if (b.menu === 'main') {
      b.commands().forEach((c, i) => {
        const why = b.blocked(c);
        rows.push(h(`div.ex-item${i === b.sel ? '.sel' : ''}${why ? '.off' : ''}${c === ALL_OUT ? '.allout' : ''}`, { on: () => { b.tap('main', i); } }, c));
      });
    } else if (b.menu === 'skill') {
      // up to SKILL_ROWS at a time, the cursor's window (the found skills make the list long)
      const all = b.skills(), from = Math.max(0, Math.min(b.subSel - (SKILL_ROWS >> 1), all.length - SKILL_ROWS));
      if (from > 0) rows.push(h('div.exb-more', null, '▲'));
      all.slice(from, from + SKILL_ROWS).forEach((s, j) => { const i = from + j; rows.push(h(`div.v-row.ex-item${i === b.subSel ? '.sel' : ''}${b.ap < s.ap ? '.off' : ''}`, { on: () => { b.tap('skill', i); } },
        h('span.v-grow', null, s.lv ? `${s.name} ${s.lv}` : s.name), h('span.exb-cost', null, `AP ${s.ap}`))); });
      if (from + SKILL_ROWS < all.length) rows.push(h('div.exb-more', null, '▼'));
    } else if (b.menu === 'item') {
      b.liveParty.forEach((p, i) => rows.push(h(`div.v-row.ex-item${i === b.subSel ? '.sel' : ''}`, { on: () => { b.tap('item', i); } },
        h('span.v-grow', null, p.name), h('span.exb-cost', null, `${p.hp}/${p.hpMax}`))));
    }
    // touch has no cancel key: a back row under a sub-list or the target pick
    if (b.menu !== 'main' && this.ctx.input.device === 'touch') rows.push(h('div.ex-item.exb-back', { on: () => { b.menuKey(AVK.CLR); } }, '◀ 뒤로'));
    return h('div.v-col.ex-menu.exb-menu', null, ...rows);
  }

  /** a unit's status chips */
  private stTree(b: Battle, u: BUnit): VNode | null {
    const st = b.statuses(u);
    return st.length ? h('div.v-row.exb-sts', null, st.slice(0, 4).map(([k, label]) => h(`span.exb-st.${k}`, null, label))) : null;
  }

  /** an enemy's weaknesses: the found ones by name, the others "?" */
  private weakTree(b: Battle, e: BUnit): VNode | null {
    const w = e.sp?.weak ?? [];
    if (!w.length) return null;
    return h('div.exb-weak', null, '약점 ', ...w.flatMap((t, i) => [i ? '·' : '', b.run.seenWeak.has(`${e.species}:${t}`) ? h('b', null, TYPE_NAME[t]) : '?']));
  }

  /** the closing rings of the coming hits over the target (each member for a whole-party move), the cues and the
   *  defense keys the next hit allows */
  private defenseTree(b: Battle): VNode[] {
    const ea = b.enemyAct!, out: VNode[] = [], now = b.now;
    const next = ea.hits.find((hh) => !hh.result), timing = b.run.timing;
    if (next?.cue === 'parry') out.push(h('div.exb-cue-parry'));
    if (next?.cue === 'dodge' && next.t - now <= LATE_CUE_MS + 150) out.push(h('div.exb-cue-dodge'));
    if (next?.late && next.t - now <= LATE_CUE_MS && next.t - now > -80) {
      const [ax, ay] = this.pos(b, ea.by);
      out.push(h('div.exb-late', { style: `left:${ax - 10}px;top:${ay - 70}px` }, '!'));
    }
    const on = ea.target ? [ea.target] : b.liveParty;
    if (next) {
      const span = Math.max(600, ea.move.windup * 1000), k = Math.max(0, (next.t - now) / span);
      const r = 14 + k * 46, win = (next.cue === 'parry' ? PARRY_NARROW_MS : PARRY_MS) * timing, good = Math.abs(next.t - now) <= win;
      for (const t of on) {
        const [x, y] = this.pos0(b, t);
        out.push(h(`div.exb-ring.${next.cue}${good && next.cue !== 'dodge' ? '.good' : ''}`, { style: `left:${x - r}px;top:${y - 18 - r}px;width:${2 * r}px;height:${2 * r}px` }));
        out.push(h('div.exb-ring.core', { style: `left:${x - 14}px;top:${y - 32}px;width:28px;height:28px` }));
      }
    }
    if (ea.charge) out.push(h('div.exb-roar-t', null, `${ea.move.name}! 전원 ${ea.hits.length}연타`));
    const done = ea.hits.filter((hh) => hh.result).length, cue = next?.cue ?? 'any';
    const pw = Math.round((cue === 'parry' ? PARRY_NARROW_MS : PARRY_MS) * timing), dw = Math.round(DODGE_MS * timing);
    out.push(h('div.v-row.exb-defkeys', null,
      h(`span${cue === 'dodge' ? '.off' : cue === 'parry' ? '.only' : ''}`, null, `${this.glyph(BK.PARRY)} 패링 ±${pw}ms${cue === 'parry' ? ' 만!' : ''}`),
      h(`span${cue === 'parry' ? '.off' : cue === 'dodge' ? '.only' : ''}`, null, `${this.glyph(BK.DODGE)} 회피 ±${dw}ms${cue === 'dodge' ? ' 만!' : ''}`),
      h('span.exb-dim', null, `${done}/${ea.hits.length}`)));
    if (ea.whiff && now - ea.whiff.t < 380) { const [x, y] = this.pos0(b, on[0] ?? ea.actor); out.push(h('div.exb-whiff', { style: `left:${x - 30}px;top:${y - 84}px` }, '헛손질!')); }
    return out;
  }
}
