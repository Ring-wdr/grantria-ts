# 트러블슈팅 기록

QA에서 올라온 문제 중 원인을 찾는 데 조사가 필요했던 것과, 그때 쓴 확인 방법을 남긴다. 각 항목은 증상, 원인, 수정, 확인 순서다.

## 1. 차원의 문을 들어갔다 나오기를 반복하면 필드가 흰 화면이 된다

- 증상: 반복하다 보면 플레이 화면(WebGL)만 하얗게 되고 HUD·메뉴(HTML)는 멀쩡하다.
- 원인: **GPU 자원 누수**.
  - 던전에서 나오면 입장 전 세이브를 다시 불러오면서 `FieldScene`을 통째로 새로 만든다(`screens.ts` `reloadRequest`). 이전 장면의 GPU 자원은 해제하지 않았다.
  - 가장 큰 것은 맵 바닥을 미리 그리는 under 레이어(`Field.load`)의 타일 사각형이다. 맵 렌더 타깃에 한 번 그린 뒤에는 쓰지 않는데, 맵당 수천 개의 지오메트리가 그대로 남았다. 맵 렌더 타깃, WebGL UI 레이어(글자 텍스처·흰 텍스처), 미니맵 텍스처도 남았다.
  - 모바일 GPU가 바닥나 WebGL 컨텍스트를 잃으면, 캔버스만 하얗게 비고 DOM은 그대로라 증상과 맞는다.
- 수정:
  - `Field.load`에서 렌더 타깃에 그린 직후 under 레이어를 비운다.
  - `Field.dispose`, `GlUi.dispose`, `TextRenderer.dispose`, `Minimap.dispose`, `FieldScene.dispose`, `PlayScene.dispose`를 추가했다.
  - `GameContext.go()`가 교체되는 장면의 `dispose()`를 부른다. 장면 객체는 전환할 때마다 새로 만들고 다시 쓰지 않으므로 안전하다.
- 확인: `renderer.info.memory`를 입장·퇴장마다 기록했다.

  | | 시작 지오메트리 | 반복마다 |
  |---|---|---|
  | 수정 전(브라우저) | 7,834 | +4,000~5,000 |
  | 수정 후(브라우저 6회) | 49 | 그대로 |
  | 수정 후(실기기 30회, 던전 9종 순환) | 48 | 48~50, 컨텍스트 손실 0회 |

  - 텍스처는 던전 9종의 이미지가 처음 한 번씩 캐시되면서 52개까지 늘고 그 뒤로는 멈춘다(누수 아님).
- 앞으로 장면이나 렌더 자원을 새로 만들 때: three.js의 `WebGLRenderTarget`, `BufferGeometry`, `Texture`는 GC로 GPU 메모리가 풀리지 않는다. 버리는 쪽에서 `dispose()`해야 한다. `SpriteLayer.clear()`는 지오메트리를 해제한다.

## 2. 고스트나이트(차원의 문 아칸의 무덤)에게 맞지 않는다

- 증상: 고스트나이트가 공격해도 플레이어가 맞지 않는다. 와이번(꿈의 설원)도 같은 제보가 있었다.
- 조사:
  1. 몬스터 이름은 `text[0x3e1 + type]`이다. 고스트나이트는 type 24, 와이번은 type 33이다. 맵 문제가 아니라 몬스터별 문제이고, 차원의 문 밖에서도 같다.
  2. 몬스터 공격 판정은 공격 프레임의 cmf `attack_box`와 플레이어 몸통 박스의 겹침이다. 미리보기에서 플레이어를 몬스터 위·아래·옆에 두고 `monsterHitsPlayer` 호출과 HP 감소를 틱마다 셌다.
  3. 결과: 고스트나이트가 위로 공격하는 레코드(5, 프레임 24·25)일 때는 판정이 0회였다. 그 프레임의 박스 y가 **+117**로 몬스터 한참 아래에 있었다.
- 원인:
  - cmf 박스의 x·y는 부호 있는 1바이트다. 원래 값 −139가 들어가지 않아 +117로 저장돼 있다.
  - 원작은 박스 함수 `FUN_000231e4`의 type별 switch(case 0x18)에서 프레임 ≥ 16일 때 박스를 코드로 다시 쓴다(디스어셈블 0x23f14: ax −86, ay −139, 151×129).
  - 포트는 이 덮어쓰기를 보스에만 적용하고 있었다. 일반 몬스터 중 원작이 덮어쓰는 type이 7종 더 있었다: 12, 24, 27, 31, 37, 40, 41.
- 수정:
  - `tools/grantria_bosses.py`의 `normal_box_overrides()`가 원본 Thumb 코드를 에뮬레이션(`BoxEmu`)해 일반 몬스터의 덮어쓰기도 뽑는다.
  - `tools/build_web_assets.py`가 그 결과를 `boss_boxes.json`에 같이 넣는다.
  - `Monster`의 `body()`·`attackBox()`가 `overrideBox()`를 쓰고, `FieldScene`이 일반 몬스터에도 표를 건다.
- 와이번: 원작 switch에 case가 없어(기본 처리) 포트와 같다.
  - 와이번은 위로 공격할 때 박스가 몬스터 위쪽에만 있다. 그래서 같은 높이 옆에 있는 플레이어는 원작에서도 맞지 않는다.
  - 2방향 몬스터는 `lastV`(플레이어가 아래면 3, 아니면 2)로 위·아래 공격을 고르는데, 이 로직도 원작과 같다. 그래서 고치지 않았다.
- 확인: 아래·대각선에서 다가와 위로 공격하는 고스트나이트의 적중이 0회에서 18회가 되었다(400틱).

## 3. 차원의 문 한 층에 몬스터가 한 종류만 나온다

- 원인:
  - 게임 난수 `Rng`는 원작 그대로의 64비트 LCG에 시계 값을 더한 것이다. 같은 밀리초 안에 연달아 부르면 최하위 비트가 0, 1, 0, 1로 번갈아 나온다.
  - 층 생성기(`generateFloor`, 원작은 서버가 하던 일이라 포트가 만든 코드)는 칸 고르기 `rand(cells)`와 종류 고르기 `rand(2)`를 번갈아 불렀다. 그래서 종류 쪽은 늘 같은 값이 나왔다.
- 수정: 생성기의 선택은 `pick(rng, n) = floor(rand(n × 1024) / 1024)`로 높은 비트를 쓴다. 원작 경로의 난수 호출은 바꾸지 않는다.
- 확인: 꿈의 설원 1층에서 와이번 4, 프로스트웜 5가 섞여 나온다.

## 4. 모바일에서 HUD 숏컷(QUEST·SHOP·차원의 문)을 누르면 다른 탭으로 넘어간다

- 원인:
  - HUD 숏컷은 캔버스 터치 영역이라 손가락이 **닿는 순간**(pointerdown) 메뉴를 연다.
  - 손을 **뗄 때** 브라우저가 만드는 click이 그 사이 손가락 밑에 생긴 메뉴 탭 버튼(예: 스킬 탭)에 떨어졌다.
- 수정: `DomUi.view`는 그 뷰 안에서 pointerdown이 먼저 있었던 click만 받는다.
- 확인: 실기기에서 `adb shell input tap`·`input swipe`(180 ms 누름)로 세 숏컷을 눌렀다. 모두 해당 화면에서 멈추고, 메뉴 안 탭바 터치는 정상으로 넘어간다.

## 5. Tauri 데스크톱에서 진동이 없다

- 원인:
  - PC에는 모터가 없어 데스크톱 진동은 게임패드 럼블뿐이다. 그런데 연결된 패드가 DualSense였다.
  - WebView2의 Gamepad API(`vibrationActuator`)는 XInput 패드만 진동시키고 DualSense에는 효과가 없다.
- 수정: Windows에서는 `native|vibrate`가 `src-tauri/src/rumble.rs`로 DualSense에 HID 출력 리포트를 직접 보낸다(`hidapi` windows-native).
  - USB는 리포트 0x02다.
  - 블루투스는 리포트 0x31이고, 0xA2를 앞에 붙여 CRC32를 계산한다.
  - 0.5초 뒤 모터를 끄고, 그 사이 다시 부르면 시간을 새로 센다.
  - XInput 패드는 기존처럼 웹뷰가 진동시킨다.
- 확인:
  - `cargo test rumble` 중 CRC 검사값(`123456789` → `0xCBF43926`)과 리포트 배치를 확인했다.
  - `cargo test rumble -- --ignored`는 연결된 패드를 실제로 진동시킨다.
  - 데스크톱 앱에서 `plugin:native|vibrate` 호출로 USB DualSense 진동을 확인했다. 블루투스는 실물로 확인하지 않았다.

## 6. 풀스크린 옵션이 기기에서 보이지 않는다

- 원인: 기기에 새 빌드가 설치되지 않았다.
  - 설치된 앱은 릴리스 키로 서명돼 있었고, 새로 만든 것은 디버그 APK였다.
  - 서명이 다르면 `adb install -r`이 `INSTALL_FAILED_UPDATE_INCOMPATIBLE`로 거부된다.
- 확인: `adb shell dumpsys package dev.ringwdr.grantria | grep lastUpdateTime`과 APK 파일 시각을 비교한다.
- 해결:
  - 세이브를 유지하려면 같은 키로 릴리스 빌드(`npm run tauri:android:build`)를 설치한다.
  - 디버그 빌드로 바꾸려면 기존 앱을 지워야 하고, 기기 세이브가 사라진다.

## 확인 방법 모음

### 실기기 (Android, 디버그 빌드)

디버그 빌드의 WebView는 원격 디버깅이 켜져 있다.

```bash
adb shell pidof dev.ringwdr.grantria
adb forward tcp:9333 localabstract:webview_devtools_remote_<pid>
curl http://127.0.0.1:9333/json
```

- 나온 `webSocketDebuggerUrl`에 CDP로 `Runtime.evaluate`를 보내면 `window.game`(`{ ctx, scene }`)을 쓸 수 있다.
- `location.href = 'tauri.html?map=30'`이면 슬롯 3 임시 게임으로 바로 시작한다(저장하지 않음).
- 손가락 입력은 `adb shell input tap/swipe`로 넣는다.
- `adb`의 방향키(`input keyevent DPAD_*`)는 Android가 포커스 이동에 써서 게임까지 오지 않는다. 키보드 입력은 CDP `Input.dispatchKeyEvent`로 넣는다.
- 화면은 `adb exec-out screencap -p`로 받는다.
- 끝나면 `adb forward --remove tcp:9333`.

### 데스크톱 (Tauri, Windows)

```powershell
$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = '--remote-debugging-port=9223'
```

- 이 환경 변수를 둔 채로 `npx tauri build --debug --no-bundle`로 만든 `src-tauri/target/debug/grantria.exe`를 실행한다.
- `http://127.0.0.1:9223/json`에서 같은 방식으로 붙는다.
- Tauri 명령은 `window.__TAURI_INTERNALS__.invoke('plugin:native|vibrate', { ms: 500 })`처럼 직접 부를 수 있다.

### 브라우저 미리보기

- `npm run dev`의 `window.__game`(개발 빌드만)으로 `step(n, keys)` 틱을 직접 진행한다.
- Vite는 `PORT` 환경 변수가 있으면 그 포트를 쓰고, 없으면 5173을 쓴다. Tauri 개발 서버는 5173을 그대로 쓴다.
- Claude 데스크톱 앱의 브라우저 창이 숨겨져 있으면 이미지 `decode()`가 끝나지 않아 부팅이 멈춘다. 스크린샷을 한 번 찍으면 다시 진행된다.
