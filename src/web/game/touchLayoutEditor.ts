// 편의 설정 → 조작 배치 (not in the original): the field's touch controls on an empty stage, dragged to a new place
// and resized like the layout editors of phone console emulators. One finger drags a control, a second finger (or
// the mouse wheel, or the toolbar) sizes the selected one; with nothing selected the size buttons size them all.
// 저장 keeps the layout (touchLayout.ts), 취소 / Esc leaves it as it was. A plain DOM overlay over the stage:
// the game keeps ticking under it but gets no keys (captured here) and no pointers (not the canvas).
import type { Input } from '../input/input';
import { ICONS } from '../render/touchIcons';
import {
  ALPHA_MAX, ALPHA_MIN, BASE, CTRL_IDS, SCALE_MAX, SCALE_MIN, VIEW_W, copyLayout, ctrlAt, defaultLayout, placeCtrl,
  setTouchLayout, touchLayout, type CtrlId, type TouchLayout,
} from '../input/touchLayout';
import '../styles/touchLayout.css';

const NAMES: Record<CtrlId, string> = {
  stick: '이동 스틱', attack: '공격', slot0: '슬롯 1', slot1: '슬롯 3', slot2: '슬롯 7', slot3: '슬롯 9', slot4: '슬롯 *',
  slot5: '슬롯 #', menu: '메뉴', log: '대사 로그',
};
const SLOT_LABEL = ['1', '3', '7', '9', '*', '#'];
const HELP = '끌어서 이동 · 두 손가락/휠로 크기';

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const round2 = (v: number) => Math.round(v * 100) / 100;

function div(cls: string, parent?: HTMLElement, html?: string): HTMLDivElement {
  const d = document.createElement('div');
  d.className = cls;
  if (html !== undefined) d.innerHTML = html;
  parent?.append(d);
  return d;
}

/** the control as the HUD draws it (fieldHud.ts touchButtons), at scale 1, in a box of BASE[id]'s size */
function visual(id: CtrlId, box: HTMLElement): void {
  const b = BASE[id];
  const at = (el: HTMLElement, w: number, h: number, dx = 0, dy = 0) => {
    Object.assign(el.style, { left: `${b.w / 2 - w / 2 + dx}px`, top: `${b.h / 2 - h / 2 + dy}px`, width: `${w}px`, height: `${h}px` });
    return el;
  };
  if (id === 'stick') {
    at(div('t-stick', box), 60, 60);
    for (const [dx, dy, rot] of [[0, -42, 0], [-43, 0, 270], [0, 42, 180], [43, 0, 90]] as const)
      at(div('t-arrow', box, ICONS.chevron), 20, 20, dx, dy).style.setProperty('--rot', `${rot}deg`);
    at(div('t-knob', box), 30, 30);
  } else if (id === 'attack') at(div('t-circle t-attack', box, ICONS.sword), 58, 58);
  else if (id === 'menu') at(div('t-circle t-menu', box, ICONS.menu), 38, 38);
  else if (id === 'log') at(div('t-pill', box, `${ICONS.log}<span>대사 로그</span>`), 0x4c, 22);
  else at(div('t-circle t-slot tl-slot', box, `<span>${SLOT_LABEL[+id.slice(4)]}</span>`), 38, 38);
}

let open: Promise<void> | null = null;

/** Show the editor over the stage; resolves when it closes (saved or not). */
export function openTouchLayoutEditor(input: Input): Promise<void> {
  return open ??= new Promise<void>((done) => {
    const stage = document.getElementById('stage')!;
    const edge = input.edge;
    const work: TouchLayout = copyLayout(touchLayout());
    let sel: CtrlId | null = null;

    const root = div('ui-layer ui-hud tl-editor');
    Object.assign(root.style, { left: `${-edge}px`, width: `${VIEW_W + 2 * edge}px`, right: 'auto' });
    // the fixed HUD for reference: QUEST / SAVE / SHOP and the minimap
    div('tl-frame', root).style.left = `${edge}px`;
    for (const [icon, label, x] of [['quest', 'QUEST', 194], ['save', 'SAVE', 258], ['shop', 'SHOP', 322]] as const)
      Object.assign(div('t-pill tl-fixed', root, `${ICONS[icon]}<span>${label}</span>`).style, { left: `${x + edge}px`, top: '6px', width: '52px', height: '20px' });
    Object.assign(div('tl-fixed tl-minimap', root, '<span>MAP</span>').style, { left: `${edge + 2}px`, top: '77px', width: '76px', height: '66px' });

    const boxes = {} as Record<CtrlId, HTMLDivElement>;
    for (const id of CTRL_IDS) {
      const box = div('tl-ctrl', root);
      box.dataset.id = id;
      Object.assign(box.style, { width: `${BASE[id].w}px`, height: `${BASE[id].h}px` });
      visual(id, box);
      boxes[id] = box;
    }

    const bar = div('tl-bar v-box soft', root);
    const title = div('tl-title', bar);
    const btn = (label: string, parent: HTMLElement, act: () => void, cls = '') => {
      const b = div(`u-btn s3 v-btn v0 tl-btn ${cls}`, parent, label);
      b.addEventListener('pointerdown', (e) => { e.stopPropagation(); act(); paint(); });
      return b;
    };
    const row = (label: string) => { const r = div('tl-row', bar); div('tl-label', r).textContent = label; return r; };
    const sizeRow = row('크기');
    btn('−', sizeRow, () => resize(-0.1));
    const sizeVal = div('tl-val', sizeRow);
    btn('+', sizeRow, () => resize(0.1));
    const alphaRow = row('투명도');
    btn('−', alphaRow, () => { work.alpha = round2(clamp(work.alpha - 0.1, ALPHA_MIN, ALPHA_MAX)); });
    const alphaVal = div('tl-val', alphaRow);
    btn('+', alphaRow, () => { work.alpha = round2(clamp(work.alpha + 0.1, ALPHA_MIN, ALPHA_MAX)); });
    const acts = div('tl-row tl-acts', bar);
    btn('초기화', acts, () => { Object.assign(work, defaultLayout()); sel = null; });
    btn('취소', acts, () => close(false));
    btn('저장', acts, () => close(true), 'v1');
    div('tl-help', bar).textContent = HELP;

    function resize(d: number, id = sel): void {
      for (const k of id ? [id] : CTRL_IDS) work.ctrls[k].s = round2(clamp(work.ctrls[k].s + d, SCALE_MIN, SCALE_MAX));
    }

    function paint(): void {
      for (const id of CTRL_IDS) {
        const c = ctrlAt(id, edge, work), b = BASE[id], box = boxes[id];
        box.style.transform = `translate(${c.x + edge - b.w / 2}px, ${c.y - b.h / 2}px) scale(${c.s})`;
        box.classList.toggle('sel', id === sel);
      }
      root.style.setProperty('--t-alpha', String(work.alpha));
      title.textContent = sel ? `조작 배치 · ${NAMES[sel]}` : '조작 배치 · 전체';
      sizeVal.textContent = sel ? `${Math.round(work.ctrls[sel].s * 100)}%` : '전체';
      alphaVal.textContent = `${Math.round(work.alpha * 100)}%`;
    }

    // pointers: the first on a control drags it, a second one pinches the selected control's size
    const pts = new Map<number, { x: number; y: number }>();
    let drag: { id: CtrlId; pid: number; x0: number; y0: number; cx: number; cy: number } | null = null;
    let pinch: { d0: number; s0: number } | null = null;
    const toView = (e: PointerEvent) => {
      const r = root.getBoundingClientRect(), k = (VIEW_W + 2 * edge) / r.width;
      return { x: (e.clientX - r.left) * k - edge, y: (e.clientY - r.top) * k };
    };
    const spread = () => { const [a, b] = [...pts.values()]; return Math.hypot(a.x - b.x, a.y - b.y); };
    root.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      const p = toView(e);
      pts.set(e.pointerId, p);
      try { root.setPointerCapture(e.pointerId); } catch { /* not an active pointer */ }
      if (pts.size === 2 && sel) {
        drag = null;
        pinch = { d0: Math.max(8, spread()), s0: work.ctrls[sel].s };
      } else if (pts.size === 1) {
        const box = (e.target as HTMLElement).closest<HTMLElement>('.tl-ctrl');
        sel = (box?.dataset.id as CtrlId | undefined) ?? null;
        if (sel) { const c = ctrlAt(sel, edge, work); drag = { id: sel, pid: e.pointerId, x0: p.x, y0: p.y, cx: c.x, cy: c.y }; }
      }
      paint();
    });
    root.addEventListener('pointermove', (e) => {
      if (!pts.has(e.pointerId)) return;
      const p = toView(e);
      pts.set(e.pointerId, p);
      if (pinch && sel && pts.size >= 2) {
        work.ctrls[sel].s = round2(clamp(pinch.s0 * spread() / pinch.d0, SCALE_MIN, SCALE_MAX));
      } else if (drag && drag.pid === e.pointerId) {
        placeCtrl(work, drag.id, drag.cx + p.x - drag.x0, drag.cy + p.y - drag.y0, edge);
        root.classList.add('dragging');
      }
      paint();
    });
    const up = (e: PointerEvent) => {
      pts.delete(e.pointerId);
      if (pts.size < 2) pinch = null;
      if (drag?.pid === e.pointerId) drag = null;
      if (!pts.size) root.classList.remove('dragging');
      paint();
    };
    root.addEventListener('pointerup', up);
    root.addEventListener('pointercancel', up);
    root.addEventListener('wheel', (e) => { e.preventDefault(); resize(e.deltaY < 0 ? 0.05 : -0.05); paint(); }, { passive: false });

    // keys: Esc 취소, Enter 저장, arrows move the selected control, + / - size it, Tab picks the next one
    const key = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopImmediatePropagation();
      if (e.type !== 'keydown') return;
      const step = e.shiftKey ? 10 : 2;
      const move = (dx: number, dy: number) => { if (!sel) return; const c = ctrlAt(sel, edge, work); placeCtrl(work, sel, c.x + dx, c.y + dy, edge); };
      switch (e.code) {
        case 'Escape': case 'Backspace': close(false); return;
        case 'Enter': case 'NumpadEnter': close(true); return;
        case 'ArrowLeft': move(-step, 0); break;
        case 'ArrowRight': move(step, 0); break;
        case 'ArrowUp': move(0, -step); break;
        case 'ArrowDown': move(0, step); break;
        case 'Equal': case 'NumpadAdd': resize(0.05); break;
        case 'Minus': case 'NumpadSubtract': resize(-0.05); break;
        case 'Tab': sel = CTRL_IDS[((sel ? CTRL_IDS.indexOf(sel) : -1) + (e.shiftKey ? CTRL_IDS.length - 1 : 1)) % CTRL_IDS.length]; break;
        default: return;
      }
      paint();
    };
    addEventListener('keydown', key, true);
    addEventListener('keyup', key, true);

    function close(save: boolean): void {
      if (save) setTouchLayout(work);
      removeEventListener('keydown', key, true);
      removeEventListener('keyup', key, true);
      root.remove();
      open = null;
      done();
    }

    stage.append(root);
    paint();
  });
}
