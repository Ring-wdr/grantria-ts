// Data management (title "info" icon): JSON backup of every web save, and import / export of the
// original save.dat / gamedata.dat through file upload and download (account.md §5.3).
// State and keys; the host draws it (web/game/dataScene.ts).
import { account, resetAccountCache, saveAccount } from '../rules/account';
import { resetRecordsCache } from '../rules/records';
import { resetDevCache } from '../rules/dev';
import { resetReadLogCache } from '../save/readLog';
import { AVK } from '../keys';
import { SAVE_SIZE, SLOT_SIZE, backupJson, buildGamedata, buildOption, buildSlot, fileKind, origOverflow, memberFromName, parseGamedata, parseOption, parseSlot, restoreJson, xtea, type OrigAccount } from '../save/origfile';
import { loadOptions, saveOptions } from '../save/options';
import { SLOT_COUNT, loadSlot, saveSlot, type SaveData } from '../save/save';
import type { SceneHost } from './host';
import { decodeText } from '../runtime';
import type { Assets } from '../data/assets';
import { priceOf } from '../rules/shopRules';
import { platform } from '../platform';

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
      saveOptions({ ...cur, volume: o.volume & 1, vibration: o.vibration & 1, speed: Math.min(2, o.speed), minimap: o.minimap & 1, effects: o.effects & 1 });   // settings outside option.dat stay
      try { platform().storage.set('grantria.option.raw', o.raw); } catch { /* storage unavailable */ }
      optionDone = true;
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
export function exportOriginal(a: Assets, m: bigint): { name: string; bytes: Uint8Array }[] {
  const d8 = (o: number) => a.d8(o);
  const plain = new Uint8Array(SAVE_SIZE), slots = Array.from({ length: SLOT_COUNT }, (_, i) => loadSlot(i));
  slots.forEach((s, i) => {
    let b: Uint8Array;
    if (s) b = buildSlot(s, m, (it) => priceOf(a, it));
    else {
      b = new Uint8Array(SLOT_SIZE);
      new DataView(b.buffer).setBigInt64(0x3340, m, true);
      b[0x3370] = b.subarray(0, 0x3370).reduce((x, v) => x + v, 0) & 0xff;
    }
    plain.set(b, i * SLOT_SIZE);
  });
  const acc = account(), book = acc.book ?? slots.find((s) => s?.story?.book)?.story?.book ?? Array.from({ length: 40 }, () => null);
  const gd = buildGamedata(acc, d8, book as never, [0, 1, 2].map((i) => acc.day?.[i] ?? slots[i]?.day ?? 0), m);
  const sfx = m ? `.${m}` : '';
  let optRaw: string | undefined;
  optRaw = platform().storage.get('grantria.option.raw') ?? undefined;
  const opt = buildOption(loadOptions(), optRaw);
  return [{ name: `save.dat${sfx}`, bytes: xtea(plain, true) }, { name: `gamedata.dat${sfx}`, bytes: xtea(gd, true) }, { name: `option.dat${sfx}`, bytes: xtea(opt, true) }];
}

/** the data screen's rows: 백업 내보내기 / 가져오기 (JSON), 원본 세이브 가져오기 / 내보내기 */
const ROWS = 4;

export class DataLogic {
  protected cur = 0;
  private t = 0;
  protected msg = '';
  protected busy = false;
  constructor(protected readonly ctx: SceneHost) {}

  update(presses: number[]): void {
    this.t++;
    if (this.busy) return;
    for (const k of presses) {
      if (k === AVK.UP) this.cur = (this.cur + ROWS - 1) % ROWS;
      else if (k === AVK.DOWN) this.cur = (this.cur + 1) % ROWS;
      else if (k === AVK.OK) void this.run(this.cur);
      else if (k === AVK.CLR) this.ctx.screens.title();
    }
  }

  private async run(i: number): Promise<void> {
    this.busy = true;
    try {
      if (i === 0) { await download(`grantria-backup-${new Date().toISOString().slice(0, 10)}.json`, backupJson(), 'application/json'); this.msg = '백업 파일을 내려받았습니다.'; }
      else if (i === 1) {
        const [f] = await pickFiles('.json,application/json', false);
        // Android's picker "Recent" list can hand a browser a just-downloaded file at the size it was registered with
        // (0 bytes), though the file itself is whole; the same file chosen from its folder reads in full
        if (f && f.bytes.length === 0) this.msg = '빈 파일(0B): 폴더에서 다시 고르세요';
        else if (f) {
          const n = restoreJson(decodeText('utf-8', f.bytes));
          // drop every in-memory copy of what the backup replaced, or the next write puts the old one back
          resetAccountCache(); resetRecordsCache(); resetDevCache(); resetReadLogCache();
          this.ctx.options = loadOptions(); this.ctx.applyOptions();
          this.msg = `백업을 복원했습니다 (${n}개 항목).`;
        }
      } else if (i === 2) {
        const files = await pickFiles('*', true);
        if (files.length) this.msg = await importOriginal(files);
      } else {
        const known = account().memberNo ?? '0';
        const input = await platform().prompt('회원번호 (원본 파일 이름의 숫자 접미사, 모르면 0)', known);
        if (input !== null && /^\d+$/.test(input.trim())) {
          for (const f of exportOriginal(this.ctx.assets, BigInt(input.trim()))) await download(f.name, f.bytes);
          // the original holds 80 bag slots: more bags (BAG_MAX) do not go into its file
          const lost = Array.from({ length: SLOT_COUNT }, (_, k) => loadSlot(k)).reduce((n, d) => n + (d ? origOverflow(d) : 0), 0);
          this.msg = lost ? `원본 세이브 파일을 내려받았습니다. 원본 가방(80칸)을 넘는 아이템 ${lost}개는 빠졌습니다.` : '원본 세이브 파일을 내려받았습니다.';
        }
      }
    } catch (e) { this.msg = `실패: ${(e as Error).message}`; }
    this.busy = false;
  }
}
