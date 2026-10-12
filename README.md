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
| `npm run fixtures` | 상점 공식 테스트용 픽스처를 원본 코드 실행으로 생성 (`tests/fixtures/`, 커밋하지 않음) |
| `python -I tools/grantria_origverify.py DIR MEMBER` | 데이터 관리 화면에서 내보낸 원본 세이브(`save.dat`/`gamedata.dat`/`option.dat`)를 원본 라이브러리의 암·복호화·체크섬 함수로 대조 |

## 조작
키보드: 방향키/WASD 이동, Z·Enter·Space = '5'(공격·대화·확인), X = '#', C = '*', 1/2/3/4 = 퀵슬롯 '1'/'3'/'7'/'9', Esc = 메뉴/취소, M = 지도, P = 저장. 터치(포인터)는 원본 touchdata 영역과 화면 버튼을 그대로 씁니다.

## 원본과 다른 점 (오프라인화)
- 카카오·결제·광고·서버 기능은 없습니다. 쿠폰상점은 무료 로컬 지급, 고급상점은 클라이언트에 남아 있던 기본 목록을 쿠폰으로 판매, 창고는 슬롯 공용 로컬 저장소, 게임순위는 로컬 랭킹입니다.
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
