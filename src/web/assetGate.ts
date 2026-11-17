// Where the game data comes from, decided once at boot before the game app loads (game.html, tauri.html):
// 1. assets/ bundled next to the page (a personal build made with npm run assets, the Tauri apps built that way)
// 2. a build made earlier from the player's APK, stored in this browser / webview (IndexedDB)
// 3. otherwise the import screen: the player picks their own grantria.apk and it is extracted here, on the device.
// The public web build ships no game data at all; it only ever has (2) and (3).
import type { Platform } from '../core/platform';
import { apkIcon, buildAssets, EXTRACT_VERSION, openApk } from '../extract/build';
import { useAppIcon } from './appIcon';
import { clearStore, memoryAssetSource, openStore, readMeta, storedAssetSource, writeBuild } from './assetStore';

const MIME: Record<string, string> = { png: 'image/png', json: 'application/json', ogg: 'audio/ogg' };

/** assets/ bundled with the page: images.json answers as JSON (a dev server or a static host answers a missing
 *  file with a 404 or an HTML page) */
async function bundled(): Promise<boolean> {
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}assets/images.json`, { cache: 'no-store' });
    if (!res.ok || !(res.headers.get('content-type') ?? '').includes('json')) return false;
    await res.json();
    return true;
  } catch {
    return false;
  }
}

/** Extract the APK into memory; progress through the screen */
async function extract(apk: Uint8Array, screen: Screen | null, confirmUnknown: boolean) {
  screen?.busy('APK 읽는 중…', 0);
  const { files, known } = await openApk(apk);
  if (!known && confirmUnknown && screen && !(await screen.confirm(
    '알려진 그란트리아 버전과 다른 APK입니다. 데이터 위치가 달라 게임이 제대로 돌지 않을 수 있습니다. 계속할까요?'))) {
    return null;
  }
  const out = new Map<string, Blob>();
  await buildAssets(files, (path, data) => {
    const ext = path.slice(path.lastIndexOf('.') + 1);
    out.set(path, new Blob([data as BlobPart], { type: MIME[ext] ?? 'application/octet-stream' }));
  }, (f, stage) => screen?.busy(`${stage} 추출 중…`, f));
  return { out, known, icon: apkIcon(files) };
}

/** iPhone / iPad Safari not yet installed to the home screen (navigator.standalone exists only there): no
 *  fullscreen for a page, and Safari clears a site's storage after 7 days of use without a visit */
function iosBrowser(): boolean {
  const nav = navigator as Navigator & { standalone?: boolean };
  return nav.standalone === false;
}

export async function installAssets(p: Platform): Promise<void> {
  const force = location.hash === '#apk';             // game.html#apk: pick the APK again
  if (!force && await bundled()) return;              // p.assets already reads assets/ next to the page
  let db: IDBDatabase | null = null;
  try { db = await openStore(); } catch { /* storage blocked (private mode): extract into memory each visit */ }
  if (db && !force) {
    const { build, apk } = await readMeta(db).catch(() => ({ build: undefined, apk: undefined }));
    if (build?.version === EXTRACT_VERSION) {
      p.assets = await storedAssetSource(db);
      void useAppIcon(db, undefined, apk);            // in the background: the game does not wait for it
      return;
    }
    if (build && apk) {
      // made by an older extractor: make it again from the APK kept with it
      const screen = new Screen(p);
      try {
        const r = await extract(new Uint8Array(await apk.arrayBuffer()), screen, false);
        if (r) {
          await writeBuild(db, r.out, { version: EXTRACT_VERSION, known: r.known, count: r.out.size, date: Date.now() }, null);
          p.assets = await storedAssetSource(db);
          await useAppIcon(db, r.icon);
          screen.close();
          return;
        }
      } catch (e) {
        console.error('asset rebuild:', e);
      }
      screen.close();
    }
  }
  const screen = new Screen(p);
  for (;;) {
    const picked = await screen.pick([
      db ? '' : '이 브라우저는 저장소를 쓸 수 없어 다음 방문 때 APK를 다시 골라야 합니다.',
      iosBrowser() ? 'iPhone·iPad는 공유 → 홈 화면에 추가로 설치해 실행하면 화면을 꽉 채우고, 오래 쉬어도 에셋과 세이브가 지워지지 않습니다. '
        + '설치한 앱은 Safari와 저장소가 따로라 그 안에서 APK를 다시 골라야 합니다. '
        + 'APK를 먼저 고른 뒤 홈 화면에 추가하면 원본 게임 아이콘으로 설치됩니다.'
        // only the public build is an installable app (pwa/)
        : import.meta.env.MODE === 'pages' ? '앱으로 설치할 때는 APK를 먼저 고른 뒤 설치하면 원본 게임 아이콘으로 설치됩니다.' : '',
    ].filter(Boolean).join('\n\n') || null);
    try {
      const r = await extract(picked, screen, true);
      if (!r) continue;
      if (db) {
        screen.busy('저장 중…', 1);
        try {
          await clearStore(db);
          await writeBuild(db, r.out, { version: EXTRACT_VERSION, known: r.known, count: r.out.size, date: Date.now() },
            new Blob([picked as BlobPart], { type: 'application/vnd.android.package-archive' }));
          p.assets = await storedAssetSource(db);
          await useAppIcon(db, r.icon);
        } catch (e) {
          console.error('asset store:', e);
          p.assets = memoryAssetSource(r.out);         // quota: play this visit from memory
        }
        void navigator.storage?.persist?.().catch(() => false);
      } else {
        p.assets = memoryAssetSource(r.out);
        await useAppIcon(null, r.icon);
      }
      if (force) history.replaceState(null, '', location.pathname + location.search);
      screen.close();
      return;
    } catch (e) {
      console.error('asset import:', e);
      screen.error(e instanceof Error ? e.message : String(e));
    }
  }
}

/** The import screen: plain DOM over the page, before the game has any data to draw with */
class Screen {
  private root = document.createElement('div');
  private msg = document.createElement('p');
  private bar = document.createElement('div');
  private fill = document.createElement('div');
  private buttons = document.createElement('div');
  private err = document.createElement('p');

  constructor(private p: Platform) {
    const r = this.root;
    r.style.cssText = 'position:fixed;inset:0;z-index:100;display:flex;flex-direction:column;align-items:center;'
      + 'justify-content:center;gap:14px;padding:24px;box-sizing:border-box;background:#0b0d14;color:#ddd;'
      + 'font:14px/1.6 system-ui,sans-serif;text-align:center;';
    const h = document.createElement('h1');
    h.textContent = '그란트리아';
    h.style.cssText = 'margin:0;font-size:22px;color:#f0d67a;letter-spacing:2px;';
    this.msg.style.cssText = 'margin:0;max-width:420px;white-space:pre-line;';
    this.bar.style.cssText = 'width:min(320px,80vw);height:6px;background:#222;border-radius:3px;overflow:hidden;display:none;';
    this.fill.style.cssText = 'height:100%;width:0;background:#f0d67a;transition:width .15s;';
    this.bar.append(this.fill);
    this.buttons.style.cssText = 'display:flex;gap:10px;flex-wrap:wrap;justify-content:center;';
    this.err.style.cssText = 'margin:0;max-width:420px;color:#f88;min-height:1.6em;';
    r.append(h, this.msg, this.bar, this.buttons, this.err);
    document.body.append(r);
  }

  private button(label: string, primary: boolean, onClick: () => void): HTMLButtonElement {
    const b = document.createElement('button');
    b.textContent = label;
    b.style.cssText = `padding:10px 18px;font:inherit;border-radius:6px;cursor:pointer;border:1px solid #f0d67a;`
      + (primary ? 'background:#f0d67a;color:#111;font-weight:600;' : 'background:transparent;color:#f0d67a;');
    b.onclick = onClick;
    this.buttons.append(b);
    return b;
  }

  /** Wait for an APK: the file picker, or a file dropped on the page */
  pick(note: string | null): Promise<Uint8Array> {
    this.msg.textContent = '이 페이지에는 게임 데이터가 들어 있지 않습니다.\n'
      + '가지고 있는 grantria.apk를 고르면 이 기기 안에서 이미지·맵·사운드·텍스트를 추출해 저장합니다.\n'
      + 'APK는 어디로도 전송되지 않습니다.' + (note ? `\n\n${note}` : '');
    this.bar.style.display = 'none';
    this.buttons.replaceChildren();
    return new Promise((resolve) => {
      const take = (b: Uint8Array) => {
        this.root.ondragover = this.root.ondrop = null;
        this.buttons.replaceChildren();
        resolve(b);
      };
      this.button('APK 선택', true, async () => {
        this.err.textContent = '';
        try {
          const [f] = await this.p.files.open('.apk', false);
          if (f) take(f.bytes);
        } catch (e) {
          this.error(e instanceof Error ? e.message : String(e));
        }
      });
      this.root.ondragover = (e) => e.preventDefault();
      this.root.ondrop = async (e) => {
        e.preventDefault();
        const f = e.dataTransfer?.files[0];
        if (f) take(new Uint8Array(await f.arrayBuffer()));
      };
    });
  }

  busy(text: string, f: number): void {
    this.msg.textContent = text;
    this.err.textContent = '';
    this.buttons.replaceChildren();
    this.bar.style.display = 'block';
    this.fill.style.width = `${Math.round(f * 100)}%`;
  }

  confirm(text: string): Promise<boolean> {
    this.msg.textContent = text;
    this.bar.style.display = 'none';
    this.buttons.replaceChildren();
    return new Promise((resolve) => {
      this.button('계속', true, () => resolve(true));
      this.button('다른 파일', false, () => resolve(false));
    });
  }

  error(text: string): void { this.err.textContent = text; }

  close(): void { this.root.remove(); }
}
