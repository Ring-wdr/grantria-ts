// Data management (title "info" icon): JSON backup of every web save, and import / export of the
// original save.dat / gamedata.dat through file upload and download (account.md §5.3).
import { account, resetAccountCache, saveAccount } from './account';
import { AVK } from './input';
import { SAVE_SIZE, SLOT_SIZE, backupJson, buildGamedata, buildSlot, fileKind, memberFromName, parseGamedata, parseSlot, restoreJson, xtea, type OrigAccount } from './origfile';
import { SLOT_COUNT, loadSlot, saveSlot, type SaveData } from './save';
import type { GameContext, Scene } from './scene';
import { frozenTitle, render, TitleScene } from './screens';

const ITEMS = ['백업 내보내기 (JSON)', '백업 가져오기 (JSON)', '원본 세이브 가져오기', '원본 세이브 내보내기'];

function download(name: string, data: Uint8Array | string, type = 'application/octet-stream'): void {
  const blob = new Blob([typeof data === 'string' ? data : new Uint8Array(data)], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function pickFiles(accept: string, multiple: boolean): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = accept; input.multiple = multiple; input.style.display = 'none';
    input.onchange = () => { resolve([...(input.files ?? [])]); input.remove(); };
    document.body.appendChild(input); input.click();
  });
}

/** original files -> web slots and account data; returns a log line */
export async function importOriginal(files: { name: string; bytes: Uint8Array }[]): Promise<string> {
  let gd: OrigAccount | null = null, save: Uint8Array | null = null, member = 0n;
  for (const f of files) {
    const kind = fileKind(f.bytes.length);
    if (kind === 'gamedata') gd = parseGamedata(xtea(f.bytes, false));
    else if (kind === 'save') { save = xtea(f.bytes, false); member = memberFromName(f.name); }
  }
  const log: string[] = [];
  if (gd) {
    const a = account();
    Object.assign(a, { lap: gd.lap, traitPoints: gd.traitPoints, traits: gd.traits, traitBought: gd.traitBought, raw: gd.raw });
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
  const book = slots.find((s) => s?.story?.book)?.story?.book ?? Array.from({ length: 40 }, () => null);
  const gd = buildGamedata(account(), d8, book as never, slots.map((s) => s?.day ?? 0), m);
  const sfx = m ? `.${m}` : '';
  return [{ name: `save.dat${sfx}`, bytes: xtea(plain, true) }, { name: `gamedata.dat${sfx}`, bytes: xtea(gd, true) }];
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
      if (i === 0) { download(`grantria-backup-${new Date().toISOString().slice(0, 10)}.json`, backupJson(), 'application/json'); this.msg = '백업 파일을 내려받았습니다.'; }
      else if (i === 1) {
        const [f] = await pickFiles('.json,application/json', false);
        if (f) { const n = restoreJson(await f.text()); resetAccountCache(); this.msg = `백업을 복원했습니다 (${n}개 항목).`; }
      } else if (i === 2) {
        const files = await pickFiles('*', true);
        if (files.length) this.msg = await importOriginal(await Promise.all(files.map(async (f) => ({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) }))));
      } else {
        const known = account().memberNo ?? '0';
        const input = window.prompt('회원번호 (원본 파일 이름의 숫자 접미사, 모르면 0)', known);
        if (input !== null && /^\d+$/.test(input.trim())) {
          for (const f of exportOriginal((o) => this.ctx.assets.d8(o), BigInt(input.trim()))) download(f.name, f.bytes);
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
      u.window(0, 0, 0xdc, 0xd4);
      u.string('데이터 관리', 110, 5, 'center', { pen: 0xffe0 });
      ITEMS.forEach((s, i) => {
        const y = 30 + i * 34;
        u.button(14, y, 192, 24, 3, i === this.cur ? 1 : 0);
        u.hit(14, y, 192, 24, () => { if (this.cur === i) return [AVK.OK]; this.cur = i; });
        u.string(s, 110, y + 5, 'center');
      });
      u.paragraph(this.msg || '세이브는 이 브라우저에 저장됩니다. 원본 파일은 같은 이름(save.dat.회원번호)으로 내보내야 원본 앱에서 읽힙니다.', 110, 172, 200);
      u.pop();
      u.closeButton();
    });
  }
}
