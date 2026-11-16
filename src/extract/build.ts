// The whole asset build of tools/build_web_assets.py, from the player's APK bytes, in the browser / webview.
// Same output layout as the Python build (public/assets), so the game reads either one the same way.
import { buildBossBoxes } from './bosses';
import { buildMaps, buildTables, buildText } from './data';
import { buildCmf, buildImages } from './gfx';
import { buildItems } from './items';
import { readZip, type ApkFiles, type Emit } from './zip';

/** Bump when the output changes: stored builds of an older version are made again from the stored APK. */
export const EXTRACT_VERSION = 1;

/** SHA-256 of assets/d.dat and lib/armeabi/libGrantria.so of the release the port was made from (offsets into
 *  both are fixed in the code). Re-signed copies of the same release keep these files as they are. */
export const KNOWN_RELEASE = {
  ddat: '8438cc70a5f5a5a6fe5c316bab9154dbae9223be5ac60f7621060b697232b167',
  so: '8ce5148c5ae4e6e27299d0762a36e6d241c86a1de22b1ea016aa2ba7266eefe8',
};

const DDAT = 'assets/d.dat', SO = 'lib/armeabi/libGrantria.so';

const needed = (p: string) => p.startsWith('assets/') || p === SO || (p.startsWith('res/raw/') && p.endsWith('.ogg'));

export async function sha256(b: Uint8Array): Promise<string> {
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', b as BufferSource));
  return [...h].map((x) => x.toString(16).padStart(2, '0')).join('');
}

export interface ApkCheck {
  files: ApkFiles;
  /** both hashes match KNOWN_RELEASE */
  known: boolean;
}

/** Open the APK and check it is Grantria; throws a message for the player when it is not. */
export async function openApk(apk: Uint8Array): Promise<ApkCheck> {
  const files = await readZip(apk, needed);
  const d = files.get(DDAT), so = files.get(SO);
  if (!d || !so) throw new Error('그란트리아 APK가 아닙니다 (assets/d.dat, libGrantria.so가 없습니다)');
  const [hd, hs] = await Promise.all([sha256(d), sha256(so)]);
  return { files, known: hd === KNOWN_RELEASE.ddat && hs === KNOWN_RELEASE.so };
}

/** Build every asset file; progress(0..1, stage) between stages. */
export async function buildAssets(files: ApkFiles, emit: Emit, progress: (f: number, stage: string) => void = () => {}): Promise<void> {
  const stages: [string, number, () => Promise<unknown>][] = [
    ['이미지', 50, () => buildImages(files, emit)],
    ['애니메이션', 10, () => buildCmf(files, emit)],
    ['맵', 15, () => buildMaps(files, emit)],
    ['텍스트', 3, () => buildText(files, emit)],
    ['규칙 표', 2, () => buildTables(files, emit)],
    ['아이템 표', 2, () => buildItems(files, emit)],
    ['보스 판정', 15, () => buildBossBoxes(files, emit)],
    ['사운드', 3, async () => {
      // res/raw/sN.ogg (BGM 0..18, SFX 19..47 and 53)
      for (const p of files.list('res/raw/')) await emit(`sound/${p.slice('res/raw/'.length)}`, files.get(p)!);
    }],
  ];
  const total = stages.reduce((s, [, w]) => s + w, 0);
  let done = 0;
  for (const [stage, w, run] of stages) {
    progress(done / total, stage);
    await run();
    done += w;
  }
  // raw game DB for UI code that reads small d.dat tables by their original address
  await emit('d.dat', files.get(DDAT)!);
  progress(1, '완료');
}
