# 소스 구조: core / web / tauri

게임 규칙과 전투는 플랫폼과 무관한 `src/core`에 두고, 브라우저 렌더러와 호스트 셸은 그 위에 얹는다. 브라우저 버전은 그대로 돌고, 다른 호스트(Tauri, 이후 모바일이나 네이티브 렌더러)는 `Platform` 구현과 엔트리만 새로 만들면 된다.

```
web/
├─ src/
│  ├─ core/            플랫폼 무관 게임 로직 (DOM·three.js·Tauri 금지)
│  │  ├─ platform.ts   호스트 포트: 저장소, 파일, 에셋, 시계, 진동, 입력창, 생명주기(백그라운드·뒤로), 터치 우선 여부
│  │  ├─ render.ts     렌더러에 넘기는 그리기 명세(Drawable, Equip, SpriteFx, 480×320)
│  │  ├─ input.ts      로직이 읽는 입력(InputState, AVK 정규화)
│  │  ├─ runtime.ts    TextDecoder·atob·btoa 래퍼 (모든 JS 런타임에 있음)
│  │  ├─ keys.ts       원본 가상 키 AVK
│  │  ├─ data/         d.dat·텍스트·cmf·맵 로더(Assets), 스토리 DB, 스킬 설명
│  │  ├─ rules/        능력치·공식, 아이템·인벤토리, 버프, 상자, 드롭, 상점 공식, 퀘스트, 업적, 계정, 길안내
│  │  ├─ combat/       플레이어, 몬스터, 보스 14종, 투사체
│  │  ├─ world/        맵 데이터·통행 레이어(FieldMap), 경로 탐색, 이벤트 액터, 기믹, 화면 필터
│  │  └─ save/         슬롯 세이브, 원본 파일 변환(XTEA·체크섬), 옵션
│  ├─ web/             브라우저 실행 환경 (현재 게임)
│  │  ├─ main.ts       브라우저 엔트리: createWebPlatform() → app
│  │  ├─ app.ts        공용 부트스트랩(20Hz 루프, 씬, DOM 레이어). 모든 호스트가 같이 쓴다
│  │  ├─ platform.ts   localStorage, 파일 입력·다운로드, fetch, navigator.vibrate, 페이지 생명주기.
│  │  │                다른 웹뷰 호스트가 같이 쓰는 조각(에셋 fetch, 패드 진동, PageLifecycle, promptDialog)도 여기서 내보낸다
│  │  ├─ assets.ts     WebAssets = Assets + three.js 텍스처
│  │  ├─ render/       컴포지터·스프라이트(WebGL), Field 렌더러, DOM UI, 글꼴
│  │  ├─ input/        키보드·터치·게임패드 → InputState
│  │  ├─ game/         씬·화면·탭·상점·이벤트 VM·HUD (UI와 진행 흐름)
│  │  ├─ styles/       CSS
│  │  └─ viewer/       맵 뷰어(index.html, 개발용)
│  └─ tauri/           Tauri 호스트
│     ├─ main.ts       Tauri 엔트리: createTauriPlatform() → web/app
│     └─ platform.ts   Tauri API(invoke·이벤트·플러그인)로 Platform을 구현한다(아래 표)
└─ src-tauri/          Rust 셸(Tauri 2), 창·권한(capabilities)·번들 설정
   ├─ build.rs         ACL: 앱 명령(AppManifest)과 인라인 플러그인 native의 권한 생성
   ├─ src/lib.rs       플러그인·명령 등록, 창 최소화와 Android Suspended/Resumed → 'host-pause' 이벤트, touch_first
   ├─ src/native.rs    플러그인 native: vibrate, display_name. 데스크톱은 Rust, Android는 NativePlugin.kt
   ├─ src/rumble.rs    Windows DualSense 진동(hidapi, USB 0x02 / 블루투스 0x31 + CRC32)
   ├─ src/saves.rs     saves_load / saves_write: 앱 데이터 폴더의 saves/<키>.json, 원자적 쓰기
   └─ gen/android/…/   MainActivity.kt(창: 전체 화면, 자동 재생, 패드 B 대체 BACK 차단),
                       NativePlugin.kt(@TauriPlugin: 진동, ContentResolver 파일 이름)
```

## 규칙

- 의존 방향은 `tauri → web → core` 한쪽뿐이다. `core`는 `web`·`tauri`·`three`·CSS를 가져오지 않고, `web`은 `tauri`를 가져오지 않는다. `tests/boundary.test.ts`가 검사한다.
- `tsconfig.core.json`은 `src/core`를 DOM 타입 없이(`lib: ES2022`) 컴파일한다. `window`, `localStorage`, `fetch`, `performance`를 쓰면 `npm run typecheck`가 실패한다. 브라우저 기능이 필요하면 `Platform`에 포트를 추가하고 각 호스트에서 구현한다.
- 호스트는 부팅 때 `setPlatform()`을 한 번 부른 다음 `web/app.ts`를 동적으로 불러온다. 설치 전에는 메모리 저장소를 쓰는 headless 플랫폼이 기본값이라 테스트(node)도 같은 코드를 그대로 돌린다.
- `KeyValueStore`는 동기 API다. 비동기 저장소를 쓰는 호스트(Tauri 파일)는 부팅 때 전부 메모리에 읽어 두고, 쓰기는 백그라운드로 내보낸다.
- 공유 코드(`core`, `web`)는 호스트가 무엇인지 묻지 않는다. `web`에서 `platform().name` 비교는 금지다(`tests/boundary.test.ts`).
- 네이티브 쪽은 Tauri를 거쳐서만 페이지와 말한다: 페이지 → 네이티브는 `invoke`(앱 명령, 플러그인 명령), 네이티브 → 페이지는 Tauri 이벤트와 플러그인 리스너. 셸이 부를 `window` 전역을 만들거나, Kotlin에서 `evaluateJavascript`·`addJavascriptInterface`를 쓰지 않는다(같은 테스트가 `src/`와 `gen/android`의 Kotlin을 검사한다. Tauri가 만드는 `generated/`는 제외).
- 네이티브 기능은 Kotlin만 따로 두지 않고 Rust 명령 하나로 받는다. 데스크톱은 Rust가 답하고, Android는 Rust가 `run_mobile_plugin`으로 Kotlin 플러그인에 넘긴다(`native.rs`). 그래서 TS에는 플랫폼 분기가 없다.
- 새 명령은 `build.rs`(ACL)와 `capabilities/default.json`(허용)에 같이 넣는다. 빠지면 빌드나 호출이 거부된다. 호스트마다 다른 동작은 `Platform` 필드(`saveLocation`, `touchFirst`, `lifecycle`, `vibrate` …)로 받는다.
- `src/tauri`는 `core`, `web/platform`(공유 웹뷰 조각), `web/app`(엔트리), `@tauri-apps/*`만 가져온다(같은 테스트).
- 네이티브로 할 수 있는 것은 네이티브 쪽에 둔다. 웹 구현은 브라우저 호스트와 웹뷰가 원래 잘하는 것(렌더링, 오디오, 키보드·포인터·게임패드)에만 쓴다.

## 호스트별 구현

| 포트 | 브라우저 (`web`) | Tauri 데스크톱 | Tauri Android |
|---|---|---|---|
| 저장소 | localStorage (막히면 메모리) | Rust `saves_*`: `<앱 데이터>/saves/<키>.json`, 임시 파일 + sync + rename | 같음 |
| 파일 | `<input type=file>`, `<a download>` | plugin-dialog + plugin-fs, 이름은 `native\|display_name`(경로의 마지막 부분) | 같음. 고른 파일은 `content://` URI라 이름을 NativePlugin이 ContentResolver로 찾는다 |
| 진동 | `navigator.vibrate` + 패드 진동 | `native\|vibrate`: Windows는 DualSense를 HID 출력 리포트로 직접 진동(`rumble.rs`, WebView2 Gamepad API가 못 움직임) + 웹뷰 패드 진동(XInput) | `native\|vibrate` → NativePlugin(시스템 Vibrator, `VIBRATE` 권한) + 패드 진동 |
| 생명주기: 백그라운드 | `visibilitychange` | + `'host-pause'` 이벤트(창 최소화. WebView2는 최소화해도 visible) | + `'host-pause'` 이벤트(`WindowEvent::Suspended`/`Resumed` = onPause/onResume) |
| 생명주기: 뒤로 | 없음 | 없음 | Tauri app 플러그인의 `back-button` 이벤트(`onBackButtonPress`). 게임이 쓰지 않으면(로고·타이틀) plugin-dialog `ask` 후 `exit()`. 패드 B가 대체 BACK으로 다시 오는 것은 MainActivity가 막는다 |
| 터치 우선 | `(pointer: coarse)` 미디어 쿼리(바뀌면 다시 배치) | Rust `touch_first` = `cfg!(mobile)` → false | true |
| 입력창 | `window.prompt` | HTML 대화상자(`promptDialog`) | 같음 |


## 새 호스트를 붙이는 방법

1. `src/<host>/platform.ts`에 `Platform`을 구현한다(저장소, 파일, 에셋, 시계, 진동, 입력창).
2. `src/<host>/main.ts`에서 `setPlatform(...)` 후 `await import('../web/app')`. 웹뷰가 아닌 호스트라면 `web/app.ts` 대신 `core`만 쓰는 자체 렌더러와 입력을 만든다(`Drawable`, `InputState`가 경계다).
3. HTML 엔트리와 Vite 입력을 추가한다.

## 아직 남은 분리

- `web/game/fieldScene.ts`(필드 진행)와 `web/game/events.ts`(이벤트 VM)는 로직과 그리기가 한 클래스에 섞여 있다. 웹뷰 호스트(브라우저, Tauri)는 이대로 공유하면 되지만, 네이티브 렌더러를 붙이려면 이 둘의 진행 로직을 `core`로 옮기고 그리기만 `web`에 남겨야 한다.
- `web/game/gather.ts`, `fortune.ts`는 로직과 뷰가 한 파일이다(작아서 남겨 둠).

## 문제 기록

원인 조사가 필요했던 문제와 그때 쓴 확인 방법(실기기 CDP, 데스크톱 WebView2 디버깅)은 [troubleshooting.md](troubleshooting.md)에 있다.

## 실행

| 대상 | 명령 | 엔트리 |
|---|---|---|
| 브라우저 | `npm run dev` → `http://localhost:5173/game.html` | `game.html` → `src/web/main.ts` |
| Tauri 개발 | `npm run tauri:dev` (Vite 개발 서버를 같이 띄운다) | `tauri.html` → `src/tauri/main.ts` |
| Tauri 배포 빌드 | `npm run tauri:build` → `src-tauri/target/release/bundle/` | 같음 |

- Tauri 빌드에는 Rust 툴체인(rustup, stable)과 Windows의 MSVC 빌드 도구·WebView2가 필요하다.
- 세이브는 Tauri에서 앱 데이터 폴더의 `saves/<키>.json`에 키마다 한 파일로 둔다(`src-tauri/src/saves.rs`). 쓰기는 임시 파일에 쓰고 sync한 뒤 rename하므로 쓰다가 죽어도 이전 값이 남고, 파일 하나가 깨져도 그 키만 잃는다. 값은 쓰는 즉시 나간다(디바운스 없음). `saves/`가 비어 있으면 처음 한 번 이전 빌드의 `grantria.json`(plugin-store)을 옮기고 `grantria.json.migrated`로 이름을 바꿔 둔다. 그것도 없으면 웹뷰 localStorage의 `grantria.*`를 옮긴다.
- Claude 데스크톱 앱(MSIX) 안에서 띄운 `tauri dev`는 `%APPDATA%` 쓰기가 `%LOCALAPPDATA%\Packages\Claude_*\LocalCache\Roaming`으로 가상화된다. 그 안에서 확인한 세이브 상태는 실제 `%APPDATA%\dev.ringwdr.grantria`와 다를 수 있다.
- 게임 데이터(`public/assets`, 원본 APK에서 생성)는 지금 프론트엔드 번들에 같이 들어간다. 개인 빌드용이다. 배포용으로는 APK 가져오기로 앱 데이터 폴더에 에셋을 만들고 `AssetSource`를 바꿔 끼워야 한다(`desktop-electron-vs-tauri.md` §4).
- 권한은 `src-tauri/capabilities/default.json`: 앱 명령(`saves_*`, `touch_first`), native 플러그인, 열기·저장·질문 대화상자, 대화상자로 고른 파일의 읽기·쓰기, 앱 종료만 연다. 앱 명령도 `build.rs`의 AppManifest로 권한을 만들어 기본 허용이 아니다.
- 배포 CSP는 `tauri.conf.json`에 있다. Tauri는 빌드할 때 `style-src`에 nonce를 넣는데, 그러면 `'unsafe-inline'`이 무시되어 DOM UI의 런타임 스타일시트와 인라인 스타일이 막힌다. 그래서 `dangerousDisableAssetCspModification: ["style-src"]`로 `style-src`만 손대지 않게 했다. 스크립트는 `'self'`만 허용한다.
- Rust 크레이트(`tauri`, `tauri-plugin-*`)는 npm 패키지와 같은 버전으로 고정한다(`Cargo.toml`의 `=x.y.z`). minor가 어긋나면 `tauri dev`가 버전 불일치 오류를 낸다.

## Android (APK)

| 대상 | 명령 | 결과 |
|---|---|---|
| 디버그 APK (디버그 키 서명, 바로 설치 가능) | `npm run tauri:android:build -- --debug` | `src-tauri/gen/android/app/build/outputs/apk/universal/debug/app-universal-debug.apk` |
| 릴리스 APK | `npm run tauri:android:build` | `.../apk/universal/release/app-universal-release.apk` (`keystore.properties`가 있으면 서명, 없으면 미서명) |
| 기기·에뮬레이터 실행 | `npm run tauri:android:dev` | 연결된 기기에 설치 후 개발 서버에 붙는다 |

- 필요한 것: Android SDK·NDK(`NDK_HOME`, 예: `%LOCALAPPDATA%\Android\Sdk\ndk\28.2.13676358`), JDK 17 이상, Rust 타깃 `aarch64-linux-android armv7-linux-androideabi i686-linux-android x86_64-linux-android`. Windows에서는 Tauri가 빌드한 `.so`를 심볼릭 링크로 연결하므로 **개발자 모드**가 켜져 있어야 한다(설정 → 시스템 → 개발자용).
- 일부 ABI만: `-- --target aarch64` (실기기), `--target x86_64` (에뮬레이터).
- Android 프로젝트는 `src-tauri/gen/android`(커밋 대상). 가로 고정(`sensorLandscape`), 시스템 바 숨김(`MainActivity.kt`), 릴리스 서명은 `app/keystore.properties`(git 제외: `storeFile`, `storePassword`, `keyAlias`, `keyPassword`).
- 화면은 2배 이상 정수 배율이 안 나오면(휴대폰 가로) 화면에 맞춰 소수 배율로 늘린다(`web/app.ts` `fit()`). 터치 입력은 원본 touchdata 영역 그대로다.
- 실기기 확인(2026-10-13, Android 17 실기기, 디버그 APK): 가로 전체 화면, 필드·HUD·터치 조작, 사운드, 설정·세이브 유지, 백업 내보내기·가져오기(Android 파일 선택 창) 모두 정상.
- 앱 아이콘은 `src-tauri/app-icon.png`에서 `npx tauri icon src-tauri/app-icon.png`로 만든다. 이 저장소의 아이콘은 임시 그림이다. 원본 아이콘을 쓰려면 직접 가진 APK의 `res/drawable-hdpi-v4/icon.png`(72×72)를 1024로 키워 `app-icon.png`로 두고 다시 만든다(원본 그림이므로 커밋하지 않는다). Android는 적응형 아이콘(`mipmap-anydpi-v26`)을 지워 사각 아이콘을 그대로 쓴다(적응형은 가장자리를 잘라 낸다). `tauri icon`을 다시 돌리면 적응형 파일이 다시 생기므로 지워야 한다.
- 릴리스 서명 키는 저장소 밖 `%USERPROFILE%\.grantria-signing\grantria-release.jks`, 비밀번호는 git에서 빠진 `gen/android/app/keystore.properties`에 있다. 같은 키로 서명해야 설치된 앱을 업데이트할 수 있으므로 둘 다 따로 백업해 둔다.
