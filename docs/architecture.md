# 소스 구조: core / web / tauri

게임 규칙과 전투는 플랫폼과 무관한 `src/core`에 두고, 브라우저 렌더러와 호스트 셸은 그 위에 얹는다. 브라우저 버전은 그대로 돌고, 다른 호스트(Tauri, 이후 모바일이나 네이티브 렌더러)는 `Platform` 구현과 엔트리만 새로 만들면 된다.

```
web/
├─ src/
│  ├─ core/            플랫폼 무관 게임 로직 (DOM·three.js·Tauri 금지)
│  │  ├─ platform.ts   호스트 포트: 저장소, 파일, 에셋, 시계, 진동, 입력창
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
│  │  ├─ platform.ts   localStorage, 파일 입력·다운로드, fetch, navigator.vibrate
│  │  ├─ assets.ts     WebAssets = Assets + three.js 텍스처
│  │  ├─ render/       컴포지터·스프라이트(WebGL), Field 렌더러, DOM UI, 글꼴
│  │  ├─ input/        키보드·터치·게임패드 → InputState
│  │  ├─ game/         씬·화면·탭·상점·이벤트 VM·HUD (UI와 진행 흐름)
│  │  ├─ styles/       CSS
│  │  └─ viewer/       맵 뷰어(index.html, 개발용)
│  └─ tauri/           Tauri 호스트
│     ├─ main.ts       Tauri 엔트리: createTauriPlatform() → web/app
│     └─ platform.ts   앱 데이터 폴더 저장, 네이티브 열기·저장 대화상자
└─ src-tauri/          Rust 셸(Tauri 2), 창·권한(capabilities)·번들 설정
```

## 규칙

- 의존 방향은 `tauri → web → core` 한쪽뿐이다. `core`는 `web`·`tauri`·`three`·CSS를 가져오지 않고, `web`은 `tauri`를 가져오지 않는다. `tests/boundary.test.ts`가 검사한다.
- `tsconfig.core.json`은 `src/core`를 DOM 타입 없이(`lib: ES2022`) 컴파일한다. `window`, `localStorage`, `fetch`, `performance`를 쓰면 `npm run typecheck`가 실패한다. 브라우저 기능이 필요하면 `Platform`에 포트를 추가하고 각 호스트에서 구현한다.
- 호스트는 부팅 때 `setPlatform()`을 한 번 부른 다음 `web/app.ts`를 동적으로 불러온다. 설치 전에는 메모리 저장소를 쓰는 headless 플랫폼이 기본값이라 테스트(node)도 같은 코드를 그대로 돌린다.
- `KeyValueStore`는 동기 API다. 비동기 저장소를 쓰는 호스트(Tauri 파일)는 부팅 때 전부 메모리에 읽어 두고, 쓰기는 백그라운드로 내보낸다.

## 새 호스트를 붙이는 방법

1. `src/<host>/platform.ts`에 `Platform`을 구현한다(저장소, 파일, 에셋, 시계, 진동, 입력창).
2. `src/<host>/main.ts`에서 `setPlatform(...)` 후 `await import('../web/app')`. 웹뷰가 아닌 호스트라면 `web/app.ts` 대신 `core`만 쓰는 자체 렌더러와 입력을 만든다(`Drawable`, `InputState`가 경계다).
3. HTML 엔트리와 Vite 입력을 추가한다.

## 아직 남은 분리

- `web/game/fieldScene.ts`(필드 진행)와 `web/game/events.ts`(이벤트 VM)는 로직과 그리기가 한 클래스에 섞여 있다. 웹뷰 호스트(브라우저, Tauri)는 이대로 공유하면 되지만, 네이티브 렌더러를 붙이려면 이 둘의 진행 로직을 `core`로 옮기고 그리기만 `web`에 남겨야 한다.
- `web/game/gather.ts`, `fortune.ts`는 로직과 뷰가 한 파일이다(작아서 남겨 둠).

## 실행

| 대상 | 명령 | 엔트리 |
|---|---|---|
| 브라우저 | `npm run dev` → `http://localhost:5173/game.html` | `game.html` → `src/web/main.ts` |
| Tauri 개발 | `npm run tauri:dev` (Vite 개발 서버를 같이 띄운다) | `tauri.html` → `src/tauri/main.ts` |
| Tauri 배포 빌드 | `npm run tauri:build` → `src-tauri/target/release/bundle/` | 같음 |

- Tauri 빌드에는 Rust 툴체인(rustup, stable)과 Windows의 MSVC 빌드 도구·WebView2가 필요하다.
- 세이브는 Tauri에서 앱 데이터 폴더의 `grantria.json`(plugin-store)에 둔다. 처음 실행할 때 웹뷰 localStorage에 남아 있던 `grantria.*` 값을 한 번 옮긴다.
- 게임 데이터(`public/assets`, 원본 APK에서 생성)는 지금 프론트엔드 번들에 같이 들어간다. 개인 빌드용이다. 배포용으로는 APK 가져오기로 앱 데이터 폴더에 에셋을 만들고 `AssetSource`를 바꿔 끼워야 한다(`desktop-electron-vs-tauri.md` §4).
- 권한은 `src-tauri/capabilities/default.json`: 저장소, 열기·저장 대화상자, 대화상자로 고른 파일의 읽기·쓰기만 연다.
- 배포 CSP는 `tauri.conf.json`에 있다. Tauri는 빌드할 때 `style-src`에 nonce를 넣는데, 그러면 `'unsafe-inline'`이 무시되어 DOM UI의 런타임 스타일시트와 인라인 스타일이 막힌다. 그래서 `dangerousDisableAssetCspModification: ["style-src"]`로 `style-src`만 손대지 않게 했다. 스크립트는 `'self'`만 허용한다.
- Rust 크레이트(`tauri`, `tauri-plugin-*`)는 npm 패키지와 같은 버전으로 고정한다(`Cargo.toml`의 `=x.y.z`). minor가 어긋나면 `tauri dev`가 버전 불일치 오류를 낸다.
