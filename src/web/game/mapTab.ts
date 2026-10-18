// Map tab 0x22 (ui-tabs.md §0.10, leftovers-ui.md §2). World view: region table d.dat 0x4016D2 + r*6 =
// {ax, ay, up, down, left, right} (0x0F = none, FUN_000494c4). Floor view ('5' on a visited region):
// grid FUN_00049abc, drawing FUN_00057b88, keys FUN_00056a60 — a port of tools/grantria_mapfloor.py,
// which matches the original draw calls in all 296 emulated cases.
// The state and keys are core/menu/mapTab.ts; this draws them.
import type { FieldScene } from './fieldScene';
import { AVK } from '../input/input';
import { popupPaint } from './popup';
import type { GameContext } from './scene';
import { tri, type Ui } from '../render/ui';
import { gt, h, sprite, TAB_BODY, type VChild, type VNode } from '../render/view';
import { ARROW, CORR, FLOOR, MapTabLogic, type FloorView } from '../../core/menu/mapTab';
import '../styles/map-community.css';
import '../styles/convenience.css';
import { platform } from '../../core/platform';

const C_OUT = 0x678ca0, C_IN = 0x3b516c;

export class MapTab extends MapTabLogic {
  declare protected readonly ctx: GameContext;
  declare protected readonly fs: FieldScene;

  constructor(ctx: GameContext, fs: FieldScene) { super(ctx, fs); }

  /**
   * The tab body as one view: the artwork, rooms and markers sit on a stage in the 220-window
   * coordinates of the original draw calls (that geometry is the map itself); the labels are CSS boxes.
   */
  draw(u: Ui): void {
    const t = this.ctx.assets.text;
    let stage: VChild[] = [], label = '', centre = '';
    if (this.fs.gardenMode === 2) centre = t[0x1a21] ?? '';                       // "지도를 볼수 없는 지역입니다."
    else if (this.floor) ({ stage, label, centre } = this.floorView(this.floor));
    else { stage = this.worldView(); label = t[this.fs.story.zones.has(this.cur) ? 0x1d6 + this.cur : 0x1a22] ?? ''; }
    u.mount('tab', 'map', h('div.v-fill.mc-map-tab', null,
      h('div.mc-stage', { style: `left:${-TAB_BODY.x}px;top:${-TAB_BODY.y}px` }, stage),
      centre && h('div.v-fill.v-col.v-center.mc-map-centre', null, gt(centre)),
      h('div.v-box.v-note.mc-map-foot', null, label && gt(label))));
  }

  /** world view (FUN_000494c4 drawing): the region map, tap areas, the player's dot and the bobbing cursor */
  private worldView(): VChild[] {
    const b = tri(this.t % 16, 8), here = this.here;
    const out: VChild[] = [h('b.mc-abs.mc-map-frame'), at(sprite('map', 0, 0, 202, 162), 9, 32)];
    for (let r = 0; r < 14; r++) {
      out.push(h('b.mc-abs.mc-region', {
        style: rect(this.row(r, 0) - 5, this.row(r, 1) - 5, 20, 20),
        on: () => { if (this.cur === r) return [AVK.OK]; this.cur = r; },
      }));
    }
    out.push(at(sprite('c', 90, 17, 7, 8), this.row(here, 0) + 1, this.row(here, 1) + 2));
    out.push(at(sprite('c', 236, 79, 11, 13), this.row(this.cur, 0) - 1, this.row(this.cur, 1) - 15 - (b >> 1)));
    return out;
  }

  /** FUN_00057b88: rooms and corridors (outer rim, then inner fill), icons, door arrows, the selected room flash */
  private floorView(v: FloorView): { stage: VChild[]; label: string; centre: string } {
    const t = this.t, f = v.f, [a7c, a80, a8a] = this.counts(f), text = this.ctx.assets.text;
    const nr = this.d8(FLOOR + f * 3), nc = this.d8(FLOOR + f * 3 + 1), na = this.d8(FLOOR + f * 3 + 2);
    const vbase = f > 0x13 ? 0x70 : 0, cbase = this.cur > 2 ? 0x70 : 0, hbase = this.fs.field.map.header.zone >= 3 ? 0x70 : 0;
    const quest = this.questMaps(), other = this.otherQuestMaps(), mine = f === this.curFloor;
    const out: VChild[] = [];
    const fill = (x: number, y: number, w: number, hh: number, rgb: number, extra = '') => {
      if (w > 0 && hh > 0) out.push(h('b.mc-abs', { style: `${rect(x, y, w, hh)}background:#${rgb.toString(16).padStart(6, '0')};${extra}` }));
    };
    let selIdx = -1, drawn = 0;
    for (const p of [0, 2]) {
      const col = p === 0 ? C_OUT : C_IN, grow = p === 0 ? 0 : -4;
      for (let i = a7c; i < a7c + nr; i++) {
        const [x, y, s, mp, , ic] = this.room(i);
        if (v.sel === cbase + mp) selIdx = i;
        if (!this.visited(vbase + mp)) continue;
        const [w, hh] = this.shape(s);
        fill(x + p, y + p, w + grow, hh + grow, col);
        drawn++;
        if (p === 0) continue;
        out.push(h('b.mc-abs', { style: rect(x, y, w, hh), on: () => { v.sel = cbase + mp; } }));   // touch selects the room (cell unchanged)
        const icon = quest.includes(cbase + mp) ? 1 : ic;
        if (icon === 2) out.push(at(sprite('c', 111, 43, 16, 16), x + ((w - 16) >> 1), y + ((hh - 16) >> 1)));
        else if (icon === 4) out.push(at(sprite('c', 127, 43, 16, 16), x + ((w - 16) >> 1), y + ((hh - 16) >> 1)));
        else if (icon === 1) out.push(at(sprite('c', 121, 0, 9, 19), x + ((w - 10) >> 1), y + ((hh - 16) >> 1)));
        else if (other.includes(cbase + mp)) out.push(at(sprite('c', 121, 0, 9, 19, { cls: 'mc-quest-other' }), x + ((w - 10) >> 1), y + ((hh - 16) >> 1)));
        if (mine && this.fs.field.mapId === hbase + mp) {
          const dot = sprite('c', 90, 17, 7, 8, { cls: 'mc-tint', style: tint('c', 90, 17, '255,255,255', tri(t, 16) * 2) });
          out.push(at(dot, x + ((w - 7) >> 1), y + ((hh - 8) >> 1)));
        }
      }
      const [k78, k80, k9] = p === 0 ? [-8, 8, -4] : [-6, 4, -6];
      for (let j = 0; j < nc; j++) {
        const o = CORR + (a80 + j) * 4, cx = this.d8(o), cy = this.d8(o + 1), ct = this.d8(o + 2), cr = this.d8(o + 3);
        if (!this.visited(vbase + this.room(cr + a7c)[3])) continue;
        const [sw, sh] = this.shape(ct), g = p === 0 ? 0 : -4, q = ct - 5;
        if (q === 0 || q === 1) fill(cx, cy + p, sw, sh + g, col);
        else if (q === 2 || q === 3) fill(cx + p, cy, sw + g, sh, col);
        else if (q === 4 || q === 5) {
          fill(q === 4 ? cx + p : cx + sw + k78, cy + 4, k80, sh - 4, col);
          fill(cx + (q === 4 ? p : 0), cy + p, sw - p, k80, col);
        } else if (q === 6 || q === 7) {
          fill(q === 6 ? cx + p : cx + sw + k78, cy, k80, sh + k9, col);
          fill(cx + (q === 6 ? p : 0), cy + sh + k78, sw - p, k80, col);
        }
      }
    }
    // door arrows c(60,0,7,10), quarter-turn flags 0/4/8/12, bobbing tri(t >> 2, 5)
    let tr = 4;
    for (let j = 0; j < na; j++) {
      const ao = ARROW + (a8a + j) * 3;
      const ci = this.d8(ao) + (a80 > 0xff ? 0xff : 0), dr = this.d8(ao + 1), kind = this.d8(ao + 2);
      const o = CORR + ci * 4, cx = this.d8(o), cy = this.d8(o + 1), ct = this.d8(o + 2), cr = this.d8(o + 3);
      if (!this.visited(vbase + this.room(cr + a7c)[3])) continue;
      const pos = (b: number): [number, number] => {
        const [sw, sh] = this.shape(ct), q = ct - 5;
        let dx = 0, dy = 0;
        if (q === 0 || q === 1) [dx, dy, tr] = dr === 0 ? [-2 * b - 9, -2, 0] : [2 * b + 2 + sw, -2, 8];
        else if (q === 2 || q === 3) [dx, dy, tr] = dr === 2 ? [-2, -2 * b - 12, 4] : [-2, 2 * b + 2 + sh, 12];
        else if (q === 4) [dx, dy, tr] = dr === 1 ? [2 * b + 20, -2, 8] : [-2, 2 * b + 20, 12];
        else if (q === 5) [dx, dy, tr] = dr === 0 ? [-2 * b - 9, -2, 0] : [13, 2 * b + 20, 12];
        else if (q === 6) [dx, dy, tr] = dr === 1 ? [2 * b + 20, 6, 8] : [-2, -2 * b - 12, 4];
        else if (q === 7) [dx, dy, tr] = dr === 0 ? [-2 * b - 9, 10, 0] : [13, -2 * b - 12, 4];
        return [cx + dx, cy + dy];
      };
      const [ax, ay] = pos(0);
      const [x, y] = pos(tri(t >> 2, 5));
      out.push(at(sprite('c', 60, 0, 7, 10, { style: turn(tr >> 2, 7, 10) }), x, y));
      out.push(h('b.mc-abs', { style: rect(ax - 10, ay - 10, 20, 20), on: () => (kind === 1 ? [AVK.K1] : kind === 3 ? [AVK.K3] : undefined) }));
    }
    if (t & 0x10 && selIdx >= 0) {
      const [x, y, s, mp] = this.room(selIdx);
      if (this.visited(vbase + mp)) { const [w, hh] = this.shape(s); fill(x, y, w, hh, 0xffffff, 'opacity:.5'); }
    }
    if (drawn === 0) return { stage: out, label: '', centre: text[0x1a23] ?? '' };
    return { stage: out, label: text[this.visited(v.sel) ? 0x1e4 + v.sel : 0x1a22] ?? '', centre: '' };
  }

  drawOverlay(): void { /* no absolute-coordinate overlays */ }
  drawPopups(): void { this.overlays.draw(popupPaint(this.ctx)); }
}

const rect = (x: number, y: number, w: number, hh: number) => `left:${x}px;top:${y}px;width:${w}px;height:${hh}px;`;

/** a stage element at (x, y) in 220-window coordinates */
function at(n: VNode, x: number, y: number): VNode {
  n.cls += ' mc-abs';
  n.style = `left:${x}px;top:${y}px;${n.style}`;
  return n;
}

/** quarter turns clockwise about the top-left, shifted back into the box (as Ui.image flags bits 2-3) */
function turn(rot: number, w: number, hh: number): string {
  return rot === 1 ? `transform:translateX(${hh}px) rotate(90deg)` : rot === 2 ? `transform:translate(${w}px,${hh}px) rotate(180deg)`
    : rot === 3 ? `transform:translateY(${w}px) rotate(270deg)` : '';
}

/** SpriteFx tint for a view sprite: its own shape filled with rgb at amount/32 (map-community.css .mc-tint) */
export function tint(img: string, sx: number, sy: number, rgb: string, amount: number): string {
  return `--tint:rgb(${rgb});--tint-a:${amount / 32};--mask:url("${platform().assets.url(`images/${img}.png`)}");--mpos:${-sx}px ${-sy}px;`;
}
