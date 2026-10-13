// Data management (title "info" icon): JSON backup of every web save, and import / export of the
// original save.dat / gamedata.dat through file upload and download (account.md §5.3).
import { account, resetAccountCache, saveAccount } from '../../core/rules/account';
import { AVK } from '../input/input';
import { SAVE_SIZE, SLOT_SIZE, backupJson, buildGamedata, buildOption, buildSlot, fileKind, memberFromName, parseGamedata, parseOption, parseSlot, restoreJson, xtea, type OrigAccount } from '../../core/save/origfile';
import { loadOptions, saveOptions } from '../../core/save/options';
import { SLOT_COUNT, loadSlot, saveSlot, type SaveData } from '../../core/save/save';
import type { GameContext, Scene } from './scene';
import { frozenTitle, render, TitleScene } from './screens';
import { button, gt, h, sprite } from '../render/view';
import '../styles/screens-misc.css';
import { platform } from '../../core/platform';

const ITEMS = ['백업 내보내기 (JSON)', '백업 가져오기 (JSON)', '원본 세이브 가져오기', '원본 세이브 내보내기'];

const download = (name: string, data: Uint8Array | string, type = 'application/octet-stream') => platform().files.save(name, data, type);
const pickFiles = (accept: string, multiple: boolean) => platform().files.open(accept, multiple);

/** original files -> web slots and account data; returns a log line */
export async function importOriginal(files: { name: string; bytes: Uint8Array }[]): Promise<string> {
  let gd: OrigAccount | null = null, save: Uint8Array | null = null, member = 0n, optionDone = false;
  for (const f of files) {
    const kind = fileKind(f.bytes.length);
    if (kind === 'gamedata') gd = parseGamedata(xtea(f.bytes, false));
    else if (kind === 'save') { save = xtea(f.bytes, false); member = memberFromName(f.name); }
    else if (kind === 'option') {
      const o = parseOption(xtea(f.bytes, false)), cur = loadOptions();
      saveOptions({ volume: o.volume & 1, vibration: o.vibration & 1, speed: Math.min(2, o.speed), minimap: o.minimap & 1, effects: o.effects & 1 });
      try { platform().storage.set('grantria.option.raw', o.raw); } catch { /* storage unavailable */ }
      void cur; optionDone = true;
    }
  }
  const log: string[] = [];
  if (gd) {
    const a = account();
    Object.assign(a, { lap: gd.lap, traitPoints: gd.traitPoints, traits: gd.traits, traitBought: gd.traitBought, raw: gd.raw, book: gd.book, day: gd.day, unsavedUse: gd.unsavedUse });
    if (gd.memberNo !== '0') a.memberNo = gd.memberNo;
    saveAccount(); resetAccountCache();
    log.push(`gamedata${gd.checksumOk ? '' : ' (체크섬 불일치)'}`);
  }
  if (save) {
    let n = 0;
    for (let i = 0; i < SLOT_COUNT; i++) {
      const s = parseSlot(save.subarray(i * SLOT_SIZE, (i + 1) * SLOT_SIZE), gd, i);
      if (!s) continue;
      saveSlot(i, s as SaveData);
      n++;
    }
    if (member) { const a = account(); a.memberNo = member.toString(); saveAccount(); }
    log.push(`슬롯 ${n}개`);
  }
  if (optionDone) log.push('option');
  return log.length ? `가져옴: ${log.join(', ')}` : '알 수 없는 파일입니다 (save.dat 0x9A68 / gamedata.dat 0x3D8)';
}

/** web data -> encrypted save.dat / gamedata.dat for member number m (suffix when m != 0) */
export function exportOriginal(d8: (o: number) => number, m: bigint): { name: string; bytes: Uint8Array }[] {
  const plain = new Uint8Array(SAVE_SIZE), slots = Array.from({ length: SLOT_COUNT }, (_, i) => loadSlot(i));
  slots.forEach((s, i) => {
    let b: Uint8Array;
    if (s) b = buildSlot(s, m);
    else {
      b = new Uint8Array(SLOT_SIZE);
      new DataView(b.buffer).setBigInt64(0x3340, m, true);
      b[0x3370] = b.subarray(0, 0x3370).reduce((x, v) => x + v, 0) & 0xff;
    }
    plain.set(b, i * SLOT_SIZE);
  });
  const a = account(), book = a.book ?? slots.find((s) => s?.story?.book)?.story?.book ?? Array.from({ length: 40 }, () => null);
  const gd = buildGamedata(a, d8, book as never, [0, 1, 2].map((i) => a.day?.[i] ?? slots[i]?.day ?? 0), m);
  const sfx = m ? `.${m}` : '';
  let optRaw: string | undefined;
  optRaw = platform().storage.get('grantria.option.raw') ?? undefined;
  const opt = buildOption(loadOptions(), optRaw);
  return [{ name: `save.dat${sfx}`, bytes: xtea(plain, true) }, { name: `gamedata.dat${sfx}`, bytes: xtea(gd, true) }, { name: `option.dat${sfx}`, bytes: xtea(opt, true) }];
}

export class DataScene implements Scene {
  private cur = 0;
  private t = 0;
  private msg = '';
  private busy = false;
  constructor(private ctx: GameContext) { ctx.input.uiMode = true; ctx.input.zones = []; }

  update(presses: number[]): void {
    this.t++;
    for (const tap of this.ctx.input.takeTaps()) { const k = this.ctx.ui.tapAt(tap.x, tap.y); if (k) presses = [...presses, ...k]; }
    if (this.busy) return;
    for (const k of presses) {
      if (k === AVK.UP) this.cur = (this.cur + 3) % 4;
      else if (k === AVK.DOWN) this.cur = (this.cur + 1) % 4;
      else if (k === AVK.OK) void this.run(this.cur);
      else if (k === AVK.CLR) this.ctx.go(new TitleScene(this.ctx));
    }
  }

  private async run(i: number): Promise<void> {
    this.busy = true;
    try {
      if (i === 0) { await download(`grantria-backup-${new Date().toISOString().slice(0, 10)}.json`, backupJson(), 'application/json'); this.msg = '백업 파일을 내려받았습니다.'; }
      else if (i === 1) {
        const [f] = await pickFiles('.json,application/json', false);
        if (f) { const n = restoreJson(new TextDecoder().decode(f.bytes)); resetAccountCache(); this.msg = `백업을 복원했습니다 (${n}개 항목).`; }
      } else if (i === 2) {
        const files = await pickFiles('*', true);
        if (files.length) this.msg = await importOriginal(files);
      } else {
        const known = account().memberNo ?? '0';
        const input = await platform().prompt('회원번호 (원본 파일 이름의 숫자 접미사, 모르면 0)', known);
        if (input !== null && /^\d+$/.test(input.trim())) {
          for (const f of exportOriginal((o) => this.ctx.assets.d8(o), BigInt(input.trim()))) await download(f.name, f.bytes);
          this.msg = '원본 세이브 파일을 내려받았습니다.';
        }
      }
    } catch (e) { this.msg = `실패: ${(e as Error).message}`; }
    this.busy = false;
  }

  draw(): void {
    render(this.ctx, () => {
      frozenTitle(this.ctx);
      const u = this.ctx.ui;
      u.pushCenter220();
      u.view('data', 0, 0, 0xdc, 0xd4, h('div.sm-win.u-window.v-col.v-fill.sm-panel', null,
        [0, 1, 2, 3].map((i) => sprite('c', 104, 37, 8, 8, { cls: `u-corner c${i}` })),
        h('div.v-row.sm-head', null, gt('데이터 관리', { pen: 0xffe0, cls: 'v-grow sm-title' })),
        h('div.v-col.v-grow.sm-data-list', null, ITEMS.map((s, i) => button(gt(s), {
          sel: i === this.cur, cls: this.busy && i === this.cur ? 'sm-busy' : '', on: () => { if (this.cur === i) return [AVK.OK]; this.cur = i; },
        }))),
        h('div.v-box.sm-data-note', null,
          gt(this.msg || `${platform().saveLocation} ` + '원본 파일은 같은 이름(save.dat.회원번호)으로 내보내야 원본 앱에서 읽힙니다.'))));
      u.pop();
      u.closeButton();
    });
  }
}
