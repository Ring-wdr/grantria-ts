# 장시간 플레이 발열·전력·메모리 측정 (A/B 비교)

"오래 하면 폰이 뜨거워진다"는 제보를 빌드끼리 숫자로 비교하기 위한 절차다. 게임에는 입력 녹화가 없으므로(`replay.ts`는 스토리 이벤트 회상이다) 같은 루트를 손으로 반복한다. 그래서 측정 조건을 맞추는 것이 결과의 대부분을 좌우한다.

도구는 셋이다.

| 도구 | 위치 | 무엇을 | 언제 |
|---|---|---|---|
| PC 샘플러 | `tools/perf_soak.py` | 기기 전체: 온도, 배터리 전류·전력, 앱·렌더러 CPU %·메모리, CPU/GPU 클럭, 주사율 | 매 측정 (15초 간격 CSV, `--on-device`면 휴대폰이 직접 기록) |
| 인게임 성능 기록 | 개발자 모드 → 성능 기록 (`src/web/perfLog.ts`) | 게임 안: tick·draw 시간, rAF 간격, 롱태스크, JS 힙, three.js 자원, 장면·맵·몬스터 수·옵션 | 원인을 좁힐 때 (1분 단위 JSON) |
| Perfetto | `tools/perfetto_deep.pbtxt` | 30초 시스템 트레이스: 스케줄링, CPU/GPU 주파수, 열, 배터리 전류 | 차이가 보인 뒤 짧게 파고들 때 |

## 1. 준비

### 무선 디버깅으로 연결 (충전 없이)

USB로 연결하면 충전되면서 온도와 전력이 둘 다 의미가 없어진다. 무선 디버깅을 쓴다.

1. 개발자 옵션 → 무선 디버깅 켜기 → "페어링 코드로 기기 페어링". PC에서 한 번만:
   ```bash
   adb pair 172.30.1.23:41234
   ```
   (화면에 나온 IP:포트와 6자리 코드)
2. 연결 (무선 디버깅 화면의 IP:포트, 페어링 포트와 다르다). 포트를 모르면 `adb mdns services`로 찾는다.
   ```bash
   adb connect 172.30.1.23:42643
   ```
3. 케이블을 뺀다. `adb devices`에 IP:포트 하나만 보이면 된다.

### 무선 디버깅은 측정 중에 저절로 꺼질 수 있다

실제 1시간 측정(2026-10-16)에서 16:25에 무선 디버깅이 꺼져 35분 동안 PC 샘플러가 아무것도 받지 못했다. 로그를 보면 Samsung **자동 차단(Auto Blocker, `com.samsung.android.rampart`)이 스스로 다시 켜지면서**(`AutoTurnOnReceiver`) USB 디버깅(`adb_enabled`)과 무선 디버깅(`adb_wifi_enabled`)을 모두 껐다. 17:01에 다시 켰을 때 포트가 바뀌어 있었다. 이 밖에도 Wi‑Fi가 잠깐 끊기거나 화면이 꺼지면 연결이 끊기고 포트가 바뀔 수 있다.

- 측정 전에 설정 → 보안 및 개인 정보 보호 → 자동 차단이 꺼져 있는지, 일정 시간 뒤 자동으로 다시 켜지는 설정이 없는지 확인한다. `adb shell settings list secure | grep rampart`에서 `rampart_main_switch_enabled=0`, `rampart_auto_enabled_switch_enabled=0`이면 꺼져 있다.
- 끊길 것에 대비해 **기기 안에서 샘플링**(`--on-device`, 3장)을 쓴다.
- 다시 연결할 때 포트는 `adb mdns services`로 찾는다. 샘플러도 같은 IP의 새 포트를 mDNS로 따라간다.

### 빌드 설치

비교하는 두 빌드는 **같은 종류**여야 한다(둘 다 debug, 또는 둘 다 release). debug 빌드는 Rust 쪽이 최적화되지 않고 WebView 디버깅이 켜진다.

```bash
npm run tauri:android:build -- --debug --target aarch64
```

`adb install -r <apk>`로 설치하면 세이브가 유지된다. 패키지 이름이 같으므로 두 빌드가 같은 세이브·옵션·개발자 모드 설정을 쓴다.

## 2. 공정한 A/B 조건

측정 전 체크리스트. CSV에 대부분이 기록되므로 끝난 뒤 맞았는지 확인할 수 있다(괄호 안은 CSV 열).

- **충전 안 함.** 케이블 없음, 무선 충전 패드 위 아님 (`plugged` = `no`). 샘플러가 충전을 보면 경고한다.
- **밝기 고정.** 자동 밝기를 끄고 같은 값으로 (`auto_brightness` = 0, `brightness` 같음). 화면은 가장 큰 전력 소비원이다.
  ```bash
  adb shell settings put system screen_brightness_mode 0
  adb shell settings put system screen_brightness 128
  ```
  측정이 끝나면 `screen_brightness_mode 1`로 되돌린다.
- **같은 시작 온도.** 화면을 끄고 10분 이상 식혀서 skin이 32 °C 이하, 두 측정의 시작 skin·배터리 온도 차이가 1 °C 이내로 (`t_skin`, `batt_temp` 첫 행). 같은 방, 같은 케이스(또는 케이스 없음), 같은 바닥(책상 위에 눕혀서 등). 손에 쥐면 손 온도가 섞인다. 가능하면 거치대에 둔다.
- **비슷한 배터리 구간.** 시작 잔량이 비슷하게(예: 둘 다 80~90 %). 잔량이 낮으면 전압이 낮아 같은 일에도 전류가 다르다.
- **같은 맵·루트·옵션.** 예: 슬롯 1을 불러와 같은 사냥터에서 같은 순환 루트를 30분. 옵션(속도·화면 효과·풀스크린·흔들림)은 같은 값으로. 성능 기록 JSON의 `options`로 확인할 수 있다. 메뉴·대화창을 오래 열어 두는 구간이 섞이면 비교가 흐려진다.
- **같은 앱 상태에서 시작.** 측정 전 강제 종료 후 실행 (`adb shell am force-stop dev.ringwdr.grantria`). 다른 앱은 최근 앱에서 모두 닫는다. Wi‑Fi는 adb에 필요하므로 켜 두고, 블루투스·위치·핫스팟 등은 두 측정에서 같게.
- **Samsung Game Booster / Game Optimizing Service.** 앱이 게임으로 분류되면 Game Launcher가 성능 프로필·해상도·프레임 제한을 바꿀 수 있다. Game Launcher → Game Booster 설정(성능 프로필, "게임 중 알림 차단" 등)을 두 측정에서 같게 두고, 바꾸지 않는다. 디스플레이 설정 "화면 모션 부드럽게"(120 Hz 적응형)도 그대로. 실제 주사율은 `display_hz`, 앱에 걸린 프레임 레이트 오버라이드는 `app_hz`(지금 빌드는 60)로 확인한다.
- **성능 기록 상태도 같게.** 성능 기록은 켜 두면 tick·draw마다 `performance.now()`를 두 번 부르는 정도라 무시할 만하지만, 이 기능이 없는 옛 빌드와 비교할 때는 꺼 둔다.
- **순서 효과.** A 다음 B를 바로 재면 B가 덜 식은 상태에서 시작한다. 차이가 작으면 A, B, B, A 순서로 재고 식히는 시간을 같게 한다.
- **길이.** 30~60분. 처음 5분은 데우는 구간이라 비교할 때는 같은 구간(예: 5~35분)을 쓴다.

## 3. 측정

```bash
python -I tools/perf_soak.py --label A-584c79c --duration 40m --out soak-A.csv
```

- `--serial`(연결이 하나면 생략), `--interval`(초, 기본 15), `--duration`(`45m`, `1h`, `90s`; 숫자만 쓰면 분; 생략하면 Ctrl+C까지), `--out`(이어서 추가), `--label`(모든 행에 기록).
- 샘플러를 먼저 띄우고, 게임을 시작해 루트를 돈다. 매 샘플이 한 줄씩 찍힌다: `skin / cpu / bat 온도, 전력 mW, 앱 CPU%/PSS, 렌더러 CPU%/PSS, 앱 주사율`. 앱이 화면 앞에 없으면 `(app not in front)`가 붙는다.
- 연결이 끊기면 `device lost`를 찍고 계속 재시도한다(IP:포트면 `adb connect`도 다시 한다). 끊긴 샘플은 `ok=0` 행으로 남는다. 휴대폰 화면이 꺼지면 무선 디버깅이 끊길 수 있으니 화면 꺼짐 시간을 길게 둔다.
- 끝나면(시간 도달 또는 Ctrl+C) 요약을 찍는다. 두 결과를 나란히 보려면:
  ```bash
  python -I tools/perf_soak.py --summarize soak-A.csv soak-B.csv
  ```

### 기기 안에서 샘플링 (`--on-device`)

PC가 15초마다 묻는 기본 방식은 adb가 끊긴 동안의 샘플을 잃는다. `--on-device`는 같은 샘플 스크립트를 `/data/local/tmp/perf_soak/`에 올리고 휴대폰에서 루프로 돌린다(`setsid nohup`, adb 세션과 분리). 휴대폰이 원시 덤프를 `raw.txt`에 시각과 함께 쌓고, 끝나면 PC가 그 파일을 받아 기본 방식과 **같은 CSV 열**로 바꾼다. CPU %도 똑같이 이웃한 두 덤프의 차이로 계산한다.

```bash
python -I tools/perf_soak.py --on-device --label A-584c79c --duration 40m --out soak-A.csv
```

- PC는 30초마다 마지막 샘플을 보여 준다. adb가 끊기면 `adb lost; the phone keeps sampling`을 찍고 다시 연결을 시도한다. 휴대폰은 그동안에도 계속 기록한다.
- 시간이 다 되면 휴대폰 루프가 스스로 멈추고, PC가 `raw.txt`를 `soak-A.raw.txt`로 받아 `soak-A.csv`를 쓰고 요약을 찍는다. 15초 간격의 1.5배보다 긴 빈틈이 있으면 `gaps`로 알려 준다.
- PC 창이 닫혔거나 PC가 잠들었어도 휴대폰은 계속 기록한다. 나중에 다시 연결해서 받는다(루프가 아직 돌고 있으면 멈춘다):
  ```bash
  python -I tools/perf_soak.py --collect --out soak-A.csv
  ```
  이미 받은 원시 파일을 다시 변환할 때는 `--collect soak-A.raw.txt --out soak-A.csv`(기기 불필요).
- `--duration`을 생략하면 Ctrl+C까지 돌고, PC가 사라져도 휴대폰은 최대 6시간 뒤 스스로 멈춘다. 한 번에 루프 하나만 돈다. 새로 시작하면 이전 `raw.txt`를 덮어쓰므로 먼저 `--collect`한다.
- **한계: 디버깅 자체가 꺼지면 루프도 죽는다.** USB/무선 디버깅이 꺼지면(위의 자동 차단처럼) init이 adbd를 멈추면서 adbd의 cgroup에 있는 프로세스를 모두 죽이고, shell 권한으로는 그 cgroup을 벗어날 수 없다. 이때는 PC가 다시 연결된 뒤 루프가 죽은 것을 보고(`the loop on the phone was killed`) 같은 파일에 이어서 다시 시작한다. 꺼져 있던 구간은 CSV에 빈틈으로 남는다(`the loop was restarted Nx`). 연결만 끊긴 경우(Wi‑Fi 끊김, 포트 변경, PC 절전)에는 빈틈이 없다.
- 샘플 하나의 비용은 기본 방식과 같다(휴대폰에서 dumpsys 약 0.4초). 다만 A/B는 같은 방식끼리 비교한다.

인게임 기록도 함께 쓰려면, 측정 전에 개발자 모드(편의 설정 → 버프 표시를 10번 연속 바꾸면 열린다) → **성능 기록: 켜짐**. 켜는 순간 새 기록이 시작되고, 앱을 다시 켜도 켜진 채로 기록을 이어간다(기록 자체는 메모리에만 있다). 측정이 끝나면 같은 메뉴의 **성능 기록 내보내기**로 JSON을 저장한다(세이브 내보내기와 같은 저장 창). 최근 4시간(240분)까지 남는다. 브라우저 개발 서버에서는 콘솔의 `__game.perf.start() / export()`로도 쓸 수 있다.

## 4. 결과 읽기

### CSV (`perf_soak.py`)

| 열 | 뜻 |
|---|---|
| `time`, `elapsed_s` | PC 시계(타임존 포함 ISO, `--on-device`면 휴대폰 시계를 PC 타임존으로), 시작부터 초 |
| `ok`, `fg`, `screen` | 샘플 성공, 앱이 포커스, 화면 상태(`Awake`) |
| `thermal_status` | 0 정상, 1 이상이면 OS가 쓰로틀링을 요청하기 시작한 단계 |
| `t_skin`, `t_cpu`, `t_battery`, `t_usb`, `t_pa` | thermal HAL 온도(°C). 이 기기의 CPU는 `AP` 센서. skin은 38 °C부터 단계별 임계값이 있다 |
| `batt_level`, `batt_temp` | 잔량 %, 배터리 온도 |
| `current_ma`, `voltage_mv`, `power_mw` | 순간 전류(방전이 음수), 전압, 방전 전력(양수 = 방전). 연료 게이지가 몇 초 간격으로 갱신하므로 한 행은 잡음이 크다 |
| `charge_uah` | 배터리 남은 전하(µAh). 긴 측정의 평균 전력은 이 값의 감소량이 가장 정확하다 |
| `app_cpu_pct`, `ren_cpu_pct` | 앱 프로세스(Tauri·Java·WebView 브라우저 쪽·GPU 스레드)와 WebView 렌더러(JS 실행) 프로세스의 CPU 사용률. 100 = 코어 하나를 다 씀 |
| `app_rss_mb`, `app_pss_mb`, `app_gfx_mb` | 앱 메모리. `app_gfx_mb`는 dumpsys meminfo의 Graphics(EGL/GL mtrack, 텍스처·렌더 타깃) |
| `ren_pid`, `ren_src`, `ren_rss_mb`, `ren_pss_mb` | 렌더러 프로세스. `ren_src`가 `svc`면 앱의 서비스 기록에서 찾은 것, `newest`면 가장 최근 WebView 렌더러로 추정한 것 |
| `sys_cpu_pct` | 기기 전체 CPU(모든 코어 = 100) |
| `cpu_mhz_policy*`, `gpu_mhz`, `gpu_busy_pct` | 클러스터별 CPU 클럭, GPU 클럭·사용률. 같은 일에 클럭이 높으면 전력이 많이 든다 |
| `display_hz`, `app_hz` | 디스플레이 렌더 주사율, 앱 uid에 걸린 프레임 레이트 오버라이드(`none` = 없음) |
| `sample_ms` | 이 샘플을 읽는 데 걸린 시간(`--on-device`면 휴대폰 안에서 걸린 시간이라 adb 왕복이 빠진다) |

요약에서 볼 것:

- **온도**: 시작/끝/최대. 끝이 계속 오르는지(아직 평형 전), 어디서 평평해지는지. 같은 조건이면 0.5 °C 안쪽은 잡음으로 본다.
- **전력**: `power mW avg (p50)`은 순간 전류 샘플의 평균, `charge used`는 전하 감소량으로 낸 평균(연료 게이지가 약 10 mAh 단위라 20 mAh 미만이면 표시하지 않는다). 30분 이상이면 후자를 믿는다.
- **CPU %**: 앱이 앞에 있던 샘플의 평균. 렌더러는 게임 로직·DOM, 앱 쪽은 합성·GPU 명령 제출이 크다.
- **메모리 추세**: `trend /10min`은 전 구간 최소제곱 기울기(MB/10분, 5분 이상일 때만). PSS·graphics가 꾸준히 오르면 누수를 의심하고, 처음 몇 분 오르다 평평하면 캐시가 차는 것이다.
- **주사율**: `app refresh Hz (front)`에 60 말고 다른 값이 섞이면 오버라이드가 풀린 구간이 있었다는 뜻이다.
- **재시작**: 앱·렌더러 pid가 바뀌면 `restarts`로 표시된다(렌더러 크래시나 메모리 압박으로 죽은 경우).

### 성능 기록 JSON (인게임)

`records`의 항목 하나가 1분이다. `end`(UTC ISO)와 `endEpochMs`로 CSV의 `time`과 맞춘다(CSV는 PC 시계(`--on-device`면 폰 시계), JSON은 폰 시계. 둘 다 네트워크 시간을 쓰면 1초 안쪽으로 맞는다).

| 필드 | 뜻 |
|---|---|
| `durMs`, `hiddenMs` | 창 길이, 그중 백그라운드였던 시간 |
| `ticks`, `frames` | 그 1분의 게임 tick 수(20 fps면 1200), rAF 프레임 수(60 Hz면 3600) |
| `update`, `draw` | `scene.update`와 `drawScene`의 CPU ms 분포(`n, p50, p95, max, mean`). WebGL 작업은 큐에 넣는 시간만 들어간다 |
| `raf`, `rafGaps` | rAF 간격 분포(60 Hz면 p50 ≈ 16.7), 1초 넘는 간격(백그라운드·멈춤) 수 |
| `longTasks`, `longTaskMs` | 50 ms 넘는 메인 스레드 작업 수와 합 |
| `heapUsedMb`, `heapTotalMb` | JS 힙(Chromium `performance.memory`) |
| `renderer` | three.js `geometries`, `textures`, `programs`(살아 있는 자원)와 마지막 패스의 `calls`, `triangles` |
| `scene`, `map`, `monsters`, `options`, `view` | 그 1분이 끝날 때의 장면, 맵 번호, 살아 있는 몬스터 수, 옵션(fps·speed·effects·fullscreen…), 캔버스·창 크기 |

읽는 법: 발열이 큰 구간의 `update/draw p95`·`raf`·`longTasks`가 같이 오르는지, 특정 `map`/`monsters` 수와 겹치는지 본다. `textures`·`geometries`가 맵을 오갈 때마다 늘면 GPU 자원 누수다(트러블슈팅 1번).

## 5. Perfetto (짧은 심층 트레이스)

차이가 보인 뒤 "어디서" 전력을 쓰는지 볼 때. 게임이 데워진 상태(20분 이상)에서 30초만 잡는다.

```bash
adb shell perfetto --txt -c - -o /data/misc/perfetto-traces/grantria.pftrace < tools/perfetto_deep.pbtxt
adb pull /data/misc/perfetto-traces/grantria.pftrace
```

PowerShell에서는 `<` 대신 `Get-Content tools/perfetto_deep.pbtxt | adb shell perfetto --txt -c - -o /data/misc/perfetto-traces/grantria.pftrace`. Git Bash에서는 `/data/...` 경로가 Windows 경로로 바뀌므로 두 명령 앞에 `MSYS_NO_PATHCONV=1`을 붙인다. 30초에 약 50 MB다(SM-S948N, Android 16에서 설정 확인).

<https://ui.perfetto.dev>에서 연다. 볼 것:

- CPU 트랙: `dev.ringwdr.grantria`와 `sandboxed_process` 스레드가 어느 코어(작은/큰 클러스터)에서 얼마나 깨어 있는지, `cpu_frequency`가 어디까지 오르는지. 16.7 ms마다 짧게 깨고 잠드는 모양이 이상적이다.
- GPU 주파수·`thermal` 카운터, `batt.current_ua` 카운터: 전류가 튀는 시점과 맞는 작업.
- SurfaceFlinger frame timeline: 프레임이 제때 들어가는지(janky frame).
- atrace `webview`/`gfx` 구간: WebView 합성(`DrawFrame`) 비용.

다른 기기에서 `--txt` 설정의 일부 필드(`thermal_period_ms`, `gpufreq_period_ms`, `collect_power_rails`)가 없다는 오류가 나면 그 줄을 지운다.
