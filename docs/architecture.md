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
