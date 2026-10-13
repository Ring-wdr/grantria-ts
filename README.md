# grantria-ts

Enerve의 안드로이드 액션 RPG "그란트리아(Grantria)"를 리버스 엔지니어링 분석을 바탕으로 TypeScript + three.js로 옮긴 브라우저 포트입니다. 원본 엔진의 20 FPS 고정 틱, 480×320 화면, 전투·몬스터 AI·이벤트 스크립트·퀘스트·상점·보스·하드 모드·어둠의 정원·차원의 문 등을 원본 규칙대로 재현합니다.

**이 저장소에는 원본 게임 파일이 들어 있지 않습니다.** APK, smali, 네이티브 라이브러리, 디컴파일 결과, 이미지·사운드·맵·텍스트 등 게임 에셋, 그리고 원본에서 추출한 데이터 표는 커밋하지 않습니다. 실행하려면 직접 가진 `grantria.apk`에서 에셋을 만들어야 합니다.

## 요구 사항
- Node.js 22 이상 (테스트는 Node의 TypeScript 타입 제거 실행을 씁니다)
- Python 3.10 이상 (에셋·데이터 변환 도구, 표준 라이브러리만 사용)
- [apktool](https://apktool.org/) (APK 디코드)

## 준비
```bash
npm ci
apktool d grantria.apk -o apk        # apk/assets, apk/lib/armeabi/libGrantria.so, apk/res/raw
npm run assets                        # apk/ -> public/assets (이미지·cmf·맵·텍스트·d.dat·규칙 표·사운드)
npm run dev                           # http://localhost:5173/game.html
```
- `npm run assets -- <APK의 assets 폴더> [출력 폴더]`로 경로를 바꿀 수 있습니다. 규칙 표(아이템·보스 박스)는 같은 APK의 `libGrantria.so`를 내장 Thumb 에뮬레이터로 실행해 `work/data/`에 만듭니다.
- `npm run ref`는 맵 뷰어(`index.html`)의 픽셀 비교용 참조 이미지를 만듭니다.

## 스크립트
| 명령 | 내용 |
|---|---|
| `npm run dev` | 개발 서버 (`game.html` 게임, `index.html` 맵 뷰어) |
| `npm run build` | 타입 검사 + 정적 빌드 (`dist/`) |
| `npm test` | 단위 테스트 (규칙 공식, 원본 세이브 XTEA·변환 등). 에셋이나 픽스처가 필요한 테스트는 없으면 건너뜁니다 |
| `npm run fixtures` | 상점 공식·스킬 상세 테스트용 픽스처를 원본 코드 실행으로 생성 (`tests/fixtures/`, 커밋하지 않음) |
| `python -I tools/grantria_origverify.py DIR MEMBER` | 데이터 관리 화면에서 내보낸 원본 세이브(`save.dat`/`gamedata.dat`/`option.dat`)를 원본 라이브러리의 암·복호화·체크섬 함수로 대조 |

## 조작
키보드: 방향키/WASD 이동, Z·Enter·Space = '5'(공격·대화·확인), X = '#', C = '*', 1/2/3/4 = 퀵슬롯 '1'/'3'/'7'/'9', Esc = 메뉴/취소, M = 지도, P = 저장, Q/E = 메뉴 이전/다음 탭. 터치(포인터)는 원본 touchdata 영역과 화면 버튼을 그대로 씁니다.

게임패드(PS·Xbox, Web Gamepad API): 아래(✕/A) = 확인, 오른쪽(○/B)·Start = 메뉴/취소, 왼쪽(□/X) = '1', 위(△/Y) = '3', L1/LB = '7', R1/RB = '9', L2/LT = '*', R2/RT = '#', Select(CREATE/VIEW)·터치패드 = 지도, R3 = 저장. 왼쪽 스틱은 터치 가상 스틱과 같은 아날로그 이동입니다. 필드에서 D패드는 이동 대신 HUD 버튼을 누릅니다(위 = QUEST, 왼쪽 = SHOP, 오른쪽 = 쿠폰상점, 아래 = 차원의 문 아이콘). 메뉴에서는 L1/R1(LB/RB)이 이전/다음 탭이고(하위 화면에서도 동작, 탭 클릭도 같음), 오른쪽 스틱 상하로 스킬 설명·도움말 같은 긴 글을 스크롤합니다. 퀵슬롯 등록·해제 창에서는 ↑↓로 고르거나 슬롯 버튼(□/△/L1/R1/L2/R2)을 바로 누릅니다. 키패드 '0' 기능은 화면별로 대신합니다: 캐릭터 칭호는 ↑, 퀵슬롯해제는 →, 아이템 보석 장착은 L2, 랭킹은 △/Y. 가방정리는 인벤토리·상점 판매/강화 화면에서 R2('#')입니다. 타이틀의 옵션·도움말·데이터는 □·△·L2입니다. 창고의 골드전송 입력은 키보드 숫자 키 또는 화면 숫자 버튼이고, 패드는 방향키로 금액을 조절(위/아래 ±1, 좌/우 ±10, 천 골드 단위)한 뒤 확인으로 보냅니다. 패드를 쓰면 HUD 버튼 옆에 패드 종류에 맞는 버튼 표시가 나옵니다. 표준 매핑이 아닌 DualShock 4/DualSense/Xbox(xpad)는 vendor/product 표로 맞추며, WebKitGTK처럼 Gamepad API가 없는 환경에서는 동작하지 않습니다.

UI는 HTML/CSS(`src/game/domUi.ts`, `view.ts`, `ui.css`)로 그리고, 필드와 월드 이펙트만 WebGL로 그립니다. 게임 로직은 20 FPS 틱 그대로이고 UI 애니메이션은 화면 주사율로 돕니다. 글꼴은 Galmuri9(OFL)을 번들합니다.

## 원본과 다른 점 (오프라인화)
- 카카오·결제·광고·서버 기능은 없습니다. 쿠폰상점은 무료 로컬 지급, 고급상점은 클라이언트에 남아 있던 기본 목록을 쿠폰으로 판매, 창고는 슬롯 공용 로컬 저장소, 게임순위는 로컬 랭킹입니다.
- 서버가 처리하던 쿠폰 구매는 로컬에서 원본 흐름대로 처리합니다. 도구 없이 강화·분해·제작서 사용을 고르면 도구를 쿠폰으로 사고 이어서 진행합니다(팝업 0x49, 강화석 10개 = 10장, 마법 해체기·대장장이의 모루 = 15장). 고급상점의 특성·스탯·스킬 포인트 상품(가격은 임의로 29/19/19장)과 창고의 골드전송(슬롯 공용 창고에 천 골드 단위로 맡김)도 있습니다.
- 원본에 없는 편의: 가방이 가득 찬 날의 운세 보상은 잃지 않고 보관했다가 빈 칸이 생기면 지급합니다.
- 진동 설정은 원본처럼 500ms 진동(설정 변경, 스킬 적중, 강한 타격, 피격)을 휴대폰(`navigator.vibrate`)과 진동 모터가 있는 게임패드에 보냅니다.
- 차원의 문(원래 서버가 층 데이터를 내려주던 던전)은 같은 클라이언트 규칙을 쓰는 로컬 생성기로 대체했습니다.
- 세이브는 브라우저 localStorage에 JSON으로 저장합니다. 타이틀의 info 아이콘(데이터 관리)에서 JSON 백업을 내보내고 가져오거나, 원본 `save.dat`/`gamedata.dat`를 가져오고(복호화·체크섬 검사) 원본 형식으로 내보낼 수 있습니다(회원번호 필요).

## 구조
```
src/            three.js 렌더러(컴포지터, 스프라이트), 맵 뷰어
src/game/       게임 로직·화면 (fieldScene, monster, boss, events, quests, shop, dimension, origfile, ...)
tests/          node --test 단위 테스트
tools/          APK 에셋 → 웹 에셋 변환, 규칙 표 추출(에뮬레이터)
docs/           설계 문서 (데스크톱 배포: Electron vs Tauri 비교)
```
소스 주석의 `analysis/features/*.md`, `FUN_xxxxxxxx` 표기는 이 포트를 만들 때 쓴 분석 노트(이 저장소에 없음)와 원본 함수 주소를 가리킵니다.

## 배포
웹 서비스로 배포하지 않습니다. 데스크톱 패키징 검토는 [docs/desktop-electron-vs-tauri.md](docs/desktop-electron-vs-tauri.md)를 보세요.
