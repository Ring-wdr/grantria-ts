# 데스크톱 배포: Electron vs Tauri 비교

이 문서는 grantria-ts(웹 포트)를 데스크톱 앱으로 묶을 때 Electron과 Tauri 중 무엇을 쓸지 정리한다. 웹 서비스로 배포하지는 않는다. 아래 수치는 공개 문서와 일반적인 경험치에 근거한 대략값이다. 이 프로젝트로 직접 측정한 값이 아니다.

## 1. 앱의 성격 (판단 기준)

| 항목 | 현재 구현 | 패키징에 주는 영향 |
|---|---|---|
| 빌드 결과 | Vite 정적 빌드 (`dist/`), 서버 코드 없음 | 두 프레임워크 모두 정적 파일만 실으면 된다 |
| 렌더링 | three.js + WebGL2. 컴포지터가 `copyFramebufferToTexture`·`FramebufferTexture`로 블렌드 모드를 계산하고, 메뉴 배경 블러를 셰이더로 그린다 | WebGL2 지원과 정확도가 중요하다. 브라우저 엔진 차이가 화면 차이로 바로 나타난다 |
| 오디오 | WebAudio, 원본 ogg | 자동 재생 정책이 엔진마다 다르다 (첫 입력 때 AudioContext를 만들므로 대체로 무관) |
| 저장 | localStorage(슬롯 세이브, 옵션, 계정 데이터), 파일 업로드·다운로드(원본 세이브, 계정 데이터) | 앱 데이터 디렉터리를 쓰는 편이 안전하다. 웹뷰 저장소 초기화에 데이터가 휩쓸리지 않게 해야 한다 |
| 에셋 | 원본 APK에서 `tools/build_web_assets.py`(Python)로 생성. 원본 저작물이라 저장소·배포물에 넣지 않는다 | 사용자가 자기 APK를 넣으면 앱이 에셋을 만드는 흐름이 필요하다. Python 의존을 없애려면 변환기를 TS(또는 Rust)로 옮겨야 한다 |
| 네트워크 | 없음 (카카오 제거, 상점·순위 로컬 지급) | 권한·CSP를 최소로 둘 수 있다 |
| 원본 플랫폼 | Android | 모바일 재배포를 고려하면 Tauri 2의 Android/iOS 지원이 장점이 된다 |

## 2. 비교

| 항목 | Electron | Tauri (2.x) |
|---|---|---|
| 렌더링 엔진 | Chromium을 앱에 포함. 모든 OS에서 같은 엔진 | OS 웹뷰 사용. Windows는 WebView2(Chromium 계열), macOS는 WKWebView(WebKit), Linux는 WebKitGTK |
| 화면 일관성 | 높다. 지금 Chrome에서 검증한 결과가 그대로 나온다 | Windows는 Chrome과 거의 같다. macOS·Linux는 WebKit이라 WebGL2·블렌드·텍스처 복사를 따로 검증해야 한다. 특히 WebKitGTK는 GPU 가속과 WebGL 성능이 배포판·드라이버에 따라 들쭉날쭉하다 |
| 설치 파일 크기 | 대략 80~150MB (Chromium + Node 포함) | 대략 3~15MB (웹뷰는 OS 제공) |
| 메모리 | Chromium 프로세스 여러 개로 대체로 더 많다 | 대체로 적다 (웹뷰 프로세스 + 작은 Rust 본체) |
| 백엔드 언어 | Node.js (JS/TS 그대로) | Rust. JS 쪽은 그대로이고 네이티브 기능은 Rust 명령이나 공식 플러그인으로 쓴다 |
| 파일 접근 (세이브 가져오기·내보내기) | main 프로세스의 `fs` + preload `contextBridge`로 IPC 노출. `dialog.showOpenDialog`/`showSaveDialog` | `@tauri-apps/plugin-dialog` + `plugin-fs`. capability 파일로 접근 경로 범위를 제한한다 |
| 에셋 생성 (APK → 에셋) | Node에서 zip 해제와 변환을 바로 실행할 수 있다. 기존 Python 변환기를 자식 프로세스로 부를 수도 있다(사용자에게 Python 필요) | Rust 명령이나 sidecar(별도 실행 파일)로 실행. Python 변환기를 sidecar로 묶거나 Rust/TS로 다시 써야 한다 |
| 보안 모델 | `contextIsolation`, `sandbox`, `nodeIntegration: false`를 직접 맞춰야 한다. 설정을 잘못하면 렌더러에서 Node가 열린다 | 기본이 거부(allowlist/capability). 노출할 명령만 명시 |
| 자동 업데이트 | `electron-updater`(GitHub Releases 등). 서명 권장 | 공식 updater 플러그인. 업데이트 서명 키 필수 |
| 코드 서명 | Windows Authenticode, macOS 공증 필요(둘 다 같음) | 같음 |
| 빌드 도구 | Node만 있으면 된다. electron-builder / electron-forge | Rust 툴체인(cargo) + 플랫폼별 SDK. CI 설정이 조금 더 복잡하다 |
| 모바일 | 지원 안 함 | Tauri 2부터 Android/iOS 빌드 지원 (원본이 Android 게임이라 의미가 있다) |
| localStorage 영속성 | `userData` 아래 Chromium 프로필에 저장. 앱 단위로 안정적 | 앱 식별자별 웹뷰 데이터 디렉터리에 저장. 저장 위치가 OS마다 다르고, 세이브는 `plugin-fs`로 앱 데이터 디렉터리 파일에 두는 편이 안전하다 |
| 게임 입력 | 키보드·포인터·게임패드 API 모두 Chromium 기준 | Windows는 같다. WebKit 계열은 Gamepad API 지원이 제한적인 경우가 있다 |
| 개발 경험 | 지금의 Vite 개발 서버를 그대로 띄운다 | `tauri dev`가 Vite 개발 서버를 띄운다. 마찬가지로 간단하다 |

## 3. 이 프로젝트에서 갈리는 지점

1. **렌더링 정확도**: 컴포지터는 원본 블렌드 모드를 프레임 버퍼 복사와 셰이더로 재현하고, 참조 이미지와 픽셀 단위로 비교해 왔다(맵 18/36/108 오차 0). 이 검증은 Chromium 기준이다. Electron은 이 결과를 모든 OS에서 보장한다. Tauri는 Windows만 사실상 같고, macOS·Linux는 다시 검증해야 한다.
2. **배포 크기**: 게임 에셋(약 27MB)은 사용자 APK에서 만들어 배포물에 넣지 않는다. 그래서 앱 본체 크기가 그대로 체감 크기가 된다. Tauri는 10MB 안팎, Electron은 100MB 안팎이다.
3. **에셋 변환기**: 어느 쪽이든 "사용자가 APK를 고르면 앱 데이터 폴더에 에셋을 만든다"는 첫 실행 흐름이 필요하다. 변환기를 TypeScript로 옮기면 두 프레임워크 모두에서(그리고 브라우저에서도) 같은 코드로 돌릴 수 있어 가장 깔끔하다. Python을 유지하면 Electron은 사용자 Python에 의존하고, Tauri는 PyInstaller 등으로 sidecar를 만들어야 한다.
4. **세이브 파일 API**: 계정 데이터와 원본 세이브의 가져오기·내보내기는 지금 브라우저 파일 입력과 다운로드로 구현한다. 데스크톱에서는 이것을 네이티브 열기·저장 대화상자로 바꾸면 된다. 두 프레임워크 모두 공식 API가 있어 차이가 작다.
5. **모바일 재이식**: 원본처럼 Android에서도 돌리고 싶다면 Tauri 2가 같은 코드베이스로 갈 수 있는 유일한 선택지다. 터치 입력(Ui.hit, touchdata 영역)은 이미 구현되어 있다.

## 4. 권장

- **1순위: Tauri 2.** 작은 배포물, 기본 거부 보안 모델, Android 빌드 가능성이 이 프로젝트 성격(오프라인 단일 플레이, 원본이 모바일)과 맞는다. Windows는 WebView2라 현재 검증 결과와 차이가 거의 없다.
  - 조건: macOS(WebKit)에서 컴포지터 블렌드 경로와 메뉴 블러를 참조 이미지 비교로 다시 검증한다. Linux는 WebKitGTK 성능 문제가 있으면 "지원 대상 아님" 또는 AppImage에 대한 별도 안내로 정리한다.
  - 세이브는 `plugin-fs`로 앱 데이터 디렉터리에 두고, localStorage는 캐시로만 쓴다.
- **대안: Electron.** 모든 OS에서 Chrome과 같은 화면이 반드시 필요하거나, Rust 툴체인을 CI에 넣기 어렵다면 Electron이 위험이 적다. 크기와 메모리를 감수하는 대가로 렌더링 검증 비용이 사라진다.
- **공통 선행 작업**
  1. `tools/build_web_assets.py`의 변환 로직을 TypeScript로 옮겨 "APK 가져오기" 첫 실행 화면을 만든다(원본 에셋을 배포물에 넣지 않기 위해 필수).
  2. 저장소 계층을 인터페이스로 분리한다(`localStorage` / 파일 시스템). 데스크톱에서는 파일 구현을 끼운다.
  3. 파일 가져오기·내보내기 UI를 네이티브 대화상자 구현으로 바꿀 수 있게 추상화한다.

## 5. 범위 밖

- 웹 서비스 배포(호스팅, CDN)는 하지 않는다.
- 실제 패키징 스크립트, 서명, 업데이트 서버 구성은 이 문서 범위 밖이다.
