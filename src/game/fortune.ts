// Daily fortune (운세, analysis/features/fortune.md): popup 0x54 on the first field frame of a new day,
// the local draw FUN_00052610 (대길 10 % / 소길 50 % / 꽝 40 %), one item from d.dat 0x26ABF by level band,
// the 대길 counter (+0x2e24, max 30) for titles 0x18 / 0x19. The server only granted permission (op 0x28).
import type { Rng } from './rules';
import type { Cmf } from '../assets';
import { cmfFrame, gt, h, sprite, type VNode } from './view';

export interface FortuneResult { grade: 0 | 1 | 2; slot: number; type: number; sub: number; count: number }

/** today as YYYYMMDD (the original compared only the day of the month) */
export function today(): number { const d = new Date(); return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate(); }

/** FUN_00052610(1): rand(10000) < 1000 대길 (slot rand(10)), < 6000 소길 (slot 10 + rand(15)), else 꽝 */
export function drawFortune(a: { d8(o: number): number }, rng: Rng, level: number): FortuneResult | null {
  const r = rng.rand(10000);
  if (r >= 6000) return null;
  const grade: 1 | 2 = r < 1000 ? 1 : 2, slot = grade === 1 ? rng.rand(10) : 10 + rng.rand(15);
  const band = level < 30 ? 0 : level < 60 ? 1 : 2, o = 0x26abf + (band * 25 + slot) * 3;
  return { grade, slot, type: a.d8(o), sub: a.d8(o + 1), count: Math.max(1, a.d8(o + 2)) };
}

/** the fortune teller in the portrait box: 어둠의 상인 (actor 0x9e / 0xcd, cmf c72) at an idle frame */
export interface FortuneArt { cmf: Cmf; frame: number }

/** cmf of the portrait: FUN_00051edc loads actor 0xcd on map 0x79, else 0x9e (both type 72) via FUN_0004ed94 */
export const FORTUNE_CMF = 'cmf_c72';

/**
 * FUN_00051cc4 portrait box (14,12) 78x61, grey 0x999999 at alpha 16; while the teller is there
 * (states < 4) the shadow (DrawImageNoPal shadow 120,0 36x20 at (34,55)) and the actor's idle frame
 * frame % 6 at (54,65). Coordinates below are relative to the box.
 */
function portrait(art: FortuneArt | null): VNode {
  return h('div.fortune-portrait', null, art && [
    sprite('shadow', 120, 0, 36, 20, { cls: 'fortune-shadow', style: 'position:absolute;left:20px;top:43px' }),
    cmfFrame(art.cmf, art.frame % 6, 40, 53, (c) => art.cmf.clip_images?.[c] ?? null),
  ]);
}

/** popup 0x54 upper panel (states 0..2): the portrait and the yellow greeting text 0x95 */
export function fortuneAskView(text: string[], art: FortuneArt | null): VNode {
  return h('div.v-col.fortune', null,
    h('div.v-box.v-row.fortune-top', null, portrait(art),
      h('div.v-col.v-center.v-grow', null, gt(text[0x95] ?? '', { pen: 0xffe0 }))));
}

/**
 * popup 0x55 contents (FUN_00051cc4 state 3 / 4, fortune.md §6): the upper panel (portrait, title,
 * grade) and the lower panel (message, reward item). On 꽝 the teller has run away: the box stays empty.
 */
export function fortuneResultView(text: string[], res: FortuneResult | null, item: { name: string; icon: { image: string; sx: number; sy: number } } | null, art: FortuneArt | null, held = false): VNode {
  const lost = !res || !item;
  return h('div.v-col.fortune', null,
    h('div.v-box.v-row.fortune-top', null, portrait(lost ? null : art),
      h('div.v-col.v-center.v-grow', { style: 'gap:4px' },
        gt(text[lost ? 0x1b60 : 0x1b5f] ?? ''),
        !lost && gt(text[res.grade === 1 ? 0x1c23 : 0x1c24] ?? '', { pen: 0xffe0 }))),
    h('div.v-box.v-col.v-center.fortune-bottom', null,
      lost ? gt(text[0x1b61] ?? '', { pen: 0xf800 }) : [
        gt(text[res.grade === 1 ? 0x99 + res.slot : 0xa3 + res.slot - 10] ?? '', { pen: 0xffe0 }),
        h('div.v-row.v-center', { style: 'gap:4px' },
          sprite(item.icon.image, item.icon.sx, item.icon.sy, 16, 16), gt(`${item.name} X ${res.count}`)),
        held && gt('가방이 가득 찼습니다. 빈 칸을 만들면 받습니다.', { pen: 0xf800 }),
      ]));
}
