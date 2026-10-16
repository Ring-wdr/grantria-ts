#!/usr/bin/env python3
"""Long-play soak sampler for the Grantria Android app (Tauri 2 + Android System WebView).

Polls one adb device every --interval seconds (works over wireless debugging, so the phone is not charging over
USB) and appends one CSV row per sample: thermal HAL temperatures, battery level / temperature / current / voltage
and discharge power, CPU % / RSS / PSS of the app process and of its WebView renderer (a separate sandboxed
process), CPU / GPU clocks, the display and per-app refresh rate, and whether the app is in front. At the end
(duration reached or Ctrl+C) it prints a summary. See docs/perf-soak.md for running a fair A/B comparison.

    python tools/perf_soak.py --label A --duration 45m
    python tools/perf_soak.py --serial 192.0.2.10:40000 --interval 10 --out soak-a.csv
    python tools/perf_soak.py --summarize soak-a.csv soak-b.csv      # side by side, no device needed
    python tools/perf_soak.py --on-device --label A --duration 1h    # the phone samples itself (adb may drop)
    python tools/perf_soak.py --collect                              # stop that loop, pull it and write the CSV

Only the standard library is used. Each sample is one `adb shell` call (~0.35 s of dumpsys work on the phone).
--on-device pushes the same sample script to /data/local/tmp/perf_soak and runs it there in a detached loop
(setsid + nohup), so it keeps sampling while wireless debugging is off; the raw dumps become the same CSV.
"""
from __future__ import annotations

import argparse
import csv
import datetime as dt
import os
import re
import statistics
import subprocess
import sys
import tempfile
import time

PKG = 'dev.ringwdr.grantria'

# One shell script per sample, fed on stdin (no quoting through the Windows command line). Sections start with
# '@@name'; the renderer is the WebView sandboxed process whose service record belongs to the package (Chromium
# registers SandboxedProcessService under the app's package), else the newest webview sandboxed process.
REMOTE = r'''
P=__PKG__
echo @@thermal; dumpsys thermalservice 2>/dev/null | sed -n -e '/^Thermal Status/p' -e '/Current temperatures from HAL/,/Current cooling devices/p'
echo @@battery; dumpsys battery 2>/dev/null | grep -E '^ *(AC powered|USB powered|Wireless powered|status|level|voltage|temperature|current now|Charge counter):'
echo @@display; dumpsys display 2>/dev/null | grep -E 'mFrameRateOverrides=|mActiveRenderFrameRate='
echo @@focus; dumpsys window 2>/dev/null | grep 'mCurrentFocus='
echo @@power; dumpsys power 2>/dev/null | grep 'mWakefulness='
echo @@bright; settings get system screen_brightness; settings get system screen_brightness_mode
echo @@stat; head -1 /proc/stat
echo @@freq; for f in /sys/devices/system/cpu/cpufreq/policy*; do echo "${f##*/} $(cat $f/scaling_cur_freq 2>/dev/null)"; done
echo @@gpu; echo "clock $(cat /sys/kernel/gpu/gpu_clock 2>/dev/null)"; echo "busy $(cat /sys/kernel/gpu/gpu_busy 2>/dev/null)"
A=$(pidof $P | cut -d' ' -f1)
R=$(dumpsys activity services $P 2>/dev/null | grep -o 'app=ProcessRecord{[^}]*sandboxed[^}]*}' | head -1 | cut -d' ' -f2 | cut -d: -f1)
RS=svc
if [ -z "$R" ] && [ -n "$A" ]; then
  RS=newest
  R=$(for p in $(pgrep -f 'webview:sandboxed_process'); do echo "$(cut -d' ' -f22 /proc/$p/stat 2>/dev/null) $p"; done | sort -n | tail -1 | cut -d' ' -f2)
fi
d() { echo "@@proc $1 $2"; cat /proc/$2/stat 2>/dev/null; grep VmRSS /proc/$2/status 2>/dev/null; dumpsys meminfo $2 2>/dev/null | grep -E 'TOTAL PSS:|Graphics:'; }
[ -n "$A" ] && d app $A
[ -n "$R" ] && d ren $R
echo "@@rensrc $RS"
echo @@uptime; cat /proc/uptime
echo @@end
'''

# thermal HAL types (android.os.Temperature): highest sensor of each type
TEMP_TYPES = {0: 'cpu', 1: 'gpu', 2: 'battery', 3: 'skin', 4: 'usb', 5: 'pa'}
CLK_TCK = 100

BASE_COLUMNS = [
    'time', 'elapsed_s', 'label', 'ok', 'fg', 'screen', 'brightness', 'auto_brightness',
    'thermal_status', 't_skin', 't_cpu', 't_gpu', 't_battery', 't_usb', 't_pa',
    'batt_level', 'batt_temp', 'plugged', 'current_ma', 'voltage_mv', 'power_mw', 'charge_uah',
    'app_pid', 'app_cpu_pct', 'app_rss_mb', 'app_pss_mb', 'app_gfx_mb',
    'ren_pid', 'ren_src', 'ren_cpu_pct', 'ren_rss_mb', 'ren_pss_mb',
    'sys_cpu_pct', 'gpu_mhz', 'gpu_busy_pct', 'display_hz', 'app_hz', 'sample_ms',
]


def adb(serial: str | None, *args: str, stdin: bytes | None = None, timeout: float = 30) -> subprocess.CompletedProcess:
    cmd = ['adb'] + (['-s', serial] if serial else []) + list(args)
    return subprocess.run(cmd, input=stdin, capture_output=True, timeout=timeout)


def devices() -> list[tuple[str, str]]:
    out = adb(None, 'devices').stdout.decode(errors='replace').splitlines()[1:]
    return [tuple(l.split('\t')[:2]) for l in out if '\t' in l]  # type: ignore[misc]


def num(s: str | None) -> float | None:
    try:
        return float(s) if s not in (None, '') else None
    except ValueError:
        return None


def sections(text: str) -> dict[str, list[str]]:
    """'@@name arg' lines start a section; '@@proc <role> <pid>' sections are keyed 'proc <role>'"""
    out: dict[str, list[str]] = {}
    cur = None
    for line in text.splitlines():
        if line.startswith('@@'):
            name, _, arg = line[2:].partition(' ')
            cur = f'proc {arg.split(" ")[0]}' if name == 'proc' else name
            out[cur] = [arg] if arg else []
        elif cur is not None:
            out[cur].append(line)
    return out


def proc_ticks(stat_line: str) -> int | None:
    """utime + stime from /proc/<pid>/stat (the comm field may hold spaces or parentheses)"""
    if ')' not in stat_line:
        return None
    rest = stat_line.rsplit(')', 1)[1].split()
    try:
        return int(rest[11]) + int(rest[12])
    except (IndexError, ValueError):
        return None


class Sampler:
    def __init__(self, serial: str, pkg: str, label: str):
        self.serial, self.pkg, self.label = serial, pkg, label
        self.script = REMOTE.replace('__PKG__', pkg).replace('\r\n', '\n').encode()
        self.prev: dict[str, tuple[int, int, float]] = {}   # app / ren -> (pid, ticks, uptime)
        self.prev_sys: tuple[int, int] | None = None        # (busy, total) jiffies
        self.uid: str | None = None
        self.policies: list[str] = []

    def app_uid(self) -> str | None:
        if self.uid is None:
            try:
                out = adb(self.serial, 'shell', 'pm', 'list', 'packages', '-U', self.pkg, timeout=15).stdout.decode()
                m = re.search(rf'package:{re.escape(self.pkg)} uid:(\d+)', out)
                self.uid = m.group(1) if m else None
            except (subprocess.SubprocessError, OSError):
                pass
        return self.uid

    def sample(self) -> dict[str, object] | None:
        t0 = time.monotonic()
        try:
            r = adb(self.serial, 'shell', 'sh', '-s', stdin=self.script, timeout=30)
        except (subprocess.SubprocessError, OSError):
            return None
        text = r.stdout.decode('utf-8', errors='replace').replace('\r', '')
        if r.returncode != 0 or '@@end' not in text:
            return None
        return self.parse(text, round((time.monotonic() - t0) * 1000))

    def parse(self, text: str, sample_ms: int | None) -> dict[str, object]:
        """one REMOTE dump -> CSV row; CPU % against the previous dump this Sampler parsed"""
        s = sections(text)
        row: dict[str, object] = {'ok': 1, 'sample_ms': '' if sample_ms is None else sample_ms}

        # thermal
        temps: dict[str, float] = {}
        for line in s.get('thermal', []):
            if line.startswith('Thermal Status'):
                row['thermal_status'] = line.split(':', 1)[1].strip()
            m = re.search(r'mValue=([-\d.]+), mType=(\d+), mName=([^,]+)', line)
            if m:
                v, ty = float(m.group(1)), int(m.group(2))
                name = TEMP_TYPES.get(ty)
                if name and v != 0.0 and v > temps.get(name, -1e9):
                    temps[name] = v
        for k, v in temps.items():
            row['t_' + k] = v

        # battery (dumpsys: voltage mV, temperature 0.1 C, current now uA on this Samsung, mA on some others)
        b: dict[str, str] = {}
        for line in s.get('battery', []):
            k, _, v = line.strip().partition(':')
            b[k.strip()] = v.strip()
        row['batt_level'] = b.get('level', '')
        t = num(b.get('temperature'))
        row['batt_temp'] = t / 10 if t is not None else ''
        plugged = [n for n, k in (('ac', 'AC powered'), ('usb', 'USB powered'), ('wireless', 'Wireless powered')) if b.get(k) == 'true']
        row['plugged'] = '+'.join(plugged) or 'no'
        cur, volt = num(b.get('current now')), num(b.get('voltage'))
        if cur is not None:
            cur_ma = cur / 1000 if abs(cur) >= 20000 else cur
            row['current_ma'] = round(cur_ma, 1)
            if volt is not None:
                row['power_mw'] = round(-cur_ma * volt / 1000)   # discharge power: positive while discharging
        row['voltage_mv'] = volt if volt is not None else ''
        row['charge_uah'] = b.get('Charge counter', '')

        # display: the display's render rate and this app's frame rate override
        for line in s.get('display', []):
            m = re.search(r'mActiveRenderFrameRate=([\d.]+)', line)
            if m:
                row['display_hz'] = round(float(m.group(1)), 1)
            uid = self.app_uid()
            if uid and 'mFrameRateOverrides=' in line:
                m = re.search(rf'uid={uid}\s+frameRateHz=([\d.]+)', line)
                row['app_hz'] = round(float(m.group(1)), 1) if m else 'none'
        row['fg'] = int(any(self.pkg in l for l in s.get('focus', [])))
        row['screen'] = next((l.split('=', 1)[1].strip() for l in s.get('power', []) if 'mWakefulness=' in l), '')
        br = [l.strip() for l in s.get('bright', [])]
        row['brightness'] = br[0] if br else ''
        row['auto_brightness'] = br[1] if len(br) > 1 else ''

        # whole-device CPU (all cores = 100 %)
        st = s.get('stat', [''])[0].split()
        if st and st[0] == 'cpu':
            vals = [int(x) for x in st[1:9]]
            total, idle = sum(vals), vals[3] + vals[4]
            if self.prev_sys and total > self.prev_sys[1]:
                row['sys_cpu_pct'] = round(100 * ((total - idle) - self.prev_sys[0]) / (total - self.prev_sys[1]), 1)
            self.prev_sys = (total - idle, total)
        policies = []
        for line in s.get('freq', []):
            name, _, v = line.partition(' ')
            if v.strip().isdigit():
                row[f'cpu_mhz_{name}'] = int(v) // 1000
                policies.append(name)
        if policies and not self.policies:
            self.policies = policies
        for line in s.get('gpu', []):
            k, _, v = line.partition(' ')
            m = re.search(r'\d+', v)
            if m:
                v = int(m.group(0))
                row['gpu_mhz' if k == 'clock' else 'gpu_busy_pct'] = round(gpu_mhz(v)) if k == 'clock' else v

        # processes: CPU % of one core since the previous sample, RSS, PSS and (app) graphics memory
        up = num((s.get('uptime') or [''])[0].split(' ')[0]) or 0.0
        row['ren_src'] = (s.get('rensrc') or [''])[0]
        for role in ('app', 'ren'):
            lines = s.get(f'proc {role}')
            if not lines:
                self.prev.pop(role, None)
                continue
            pid = int(lines[0].split(' ')[1])
            row[f'{role}_pid'] = pid
            ticks = None
            for line in lines[1:]:
                if line.startswith(f'{pid} ('):
                    ticks = proc_ticks(line)
                elif line.startswith('VmRSS:'):
                    row[f'{role}_rss_mb'] = round(int(line.split()[1]) / 1024, 1)
                elif 'TOTAL PSS:' in line:
                    row[f'{role}_pss_mb'] = round(int(line.split()[2]) / 1024, 1)
                elif line.strip().startswith('Graphics:') and role == 'app':
                    row['app_gfx_mb'] = round(int(line.split()[1]) / 1024, 1)
            p = self.prev.get(role)
            if ticks is not None:
                if p and p[0] == pid and up > p[2]:
                    row[f'{role}_cpu_pct'] = round(100 * (ticks - p[1]) / CLK_TCK / (up - p[2]), 1)
                self.prev[role] = (pid, ticks, up)
        return row


def live_line(elapsed: float, row: dict[str, object]) -> str:
    return (f'  {elapsed:7.0f}s  skin {row.get("t_skin", "-")}  cpu {row.get("t_cpu", "-")}  bat {row.get("batt_temp", "-")}C'
            f'  {row.get("power_mw", "-")} mW  app {row.get("app_cpu_pct", "-")}%/{row.get("app_pss_mb", "-")}MB'
            f'  ren {row.get("ren_cpu_pct", "-")}%/{row.get("ren_pss_mb", "-")}MB'
            f'  {row.get("app_hz", "-")}Hz{"" if row.get("fg") else "  (app not in front)"}')


def parse_duration(s: str) -> float:
    """'45m', '90s', '1h', '1h30m'; a bare number is minutes; 0 = until Ctrl+C"""
    s = s.strip().lower()
    if re.fullmatch(r'[\d.]+', s):
        return float(s) * 60
    parts = re.findall(r'([\d.]+)\s*([hms])', s)
    if not parts or ''.join(a + b for a, b in parts) != s.replace(' ', ''):
        raise argparse.ArgumentTypeError(f'bad duration {s!r} (use 45m, 90s, 1h30m)')
    return sum(float(a) * {'h': 3600, 'm': 60, 's': 1}[b] for a, b in parts)


def reconnect(serial: str) -> str:
    """ip:port from wireless debugging: connect again; when the phone restarted wireless debugging on a new port
    (screen off, Wi-Fi blip), follow the port that mDNS announces for the same IP. Returns the serial to use."""
    m = re.fullmatch(r'([\d.]+):\d+', serial)
    if not m:
        return serial
    try:
        if b'connected to' in adb(None, 'connect', serial, timeout=15).stdout:
            return serial
        out = adb(None, 'mdns', 'services', timeout=15).stdout.decode(errors='replace')
        for port in re.findall(rf'_adb-tls-connect\._tcp\s+{re.escape(m.group(1))}:(\d+)', out):
            new = f'{m.group(1)}:{port}'
            if new != serial and b'connected to' in adb(None, 'connect', new, timeout=15).stdout:
                print(f'  wireless debugging moved to {new}', file=sys.stderr)
                return new
    except (subprocess.SubprocessError, OSError):
        pass
    return serial


def pick_serial(serial: str | None) -> str | None:
    if serial:
        return serial
    devs = [d for d in devices() if d[1] == 'device']
    if len(devs) != 1:
        print('perf_soak: pick a device with --serial (connected: %s)' % (', '.join(d[0] for d in devs) or 'none'), file=sys.stderr)
        print('  wireless debugging: adb connect <ip:port> (Developer options > Wireless debugging)', file=sys.stderr)
        return None
    return devs[0][0]


def default_out(label: str, stamp: str) -> str:
    return f'perf_soak_{re.sub(r"[^A-Za-z0-9_.-]+", "_", label) or "run"}_{stamp}.csv'


def run(args: argparse.Namespace) -> int:
    serial = pick_serial(args.serial)
    if not serial:
        return 2
    stamp = dt.datetime.now().strftime('%Y%m%d-%H%M%S')
    out = args.out or default_out(args.label, stamp)
    sampler = Sampler(serial, args.package, args.label)
    print(f'perf_soak: {serial} {args.package} every {args.interval:g}s'
          f'{f" for {args.duration / 60:g} min" if args.duration else " until Ctrl+C"} -> {out}')

    writer = None
    f = None
    start = time.monotonic()
    lost = 0
    warned_plug = False
    columns: list[str] = []
    try:
        while True:
            t = time.monotonic()
            elapsed = t - start
            if args.duration and elapsed > args.duration + 0.5:
                break
            row = sampler.sample()
            now = dt.datetime.now().astimezone()
            if row is None:
                lost += 1
                print(f'  {elapsed:7.0f}s  device lost ({lost} in a row), retrying', file=sys.stderr)
                serial = sampler.serial = reconnect(serial)
                row = {'ok': 0}
            else:
                if lost:
                    print(f'  {elapsed:7.0f}s  device back')
                lost = 0
            row.update(time=now.isoformat(timespec='seconds'), elapsed_s=round(elapsed, 1), label=args.label)
            if row['ok'] and writer is None:
                columns = BASE_COLUMNS + [f'cpu_mhz_{p}' for p in sampler.policies]
                new = not os.path.exists(out) or os.path.getsize(out) == 0
                f = open(out, 'a', newline='', encoding='utf-8')
                writer = csv.DictWriter(f, fieldnames=columns, extrasaction='ignore')
                if new:
                    writer.writeheader()
            if writer is not None and f is not None:
                writer.writerow({c: row.get(c, '') for c in columns})
                f.flush()
            if row['ok']:
                if row.get('plugged') not in ('no', '') and not warned_plug:
                    warned_plug = True
                    print(f'  warning: the phone is charging ({row["plugged"]}): power and heat are not comparable', file=sys.stderr)
                print(live_line(elapsed, row))
            nxt = start + (int(elapsed / args.interval) + 1) * args.interval
            time.sleep(max(0.0, nxt - time.monotonic()))
    except KeyboardInterrupt:
        print('\nperf_soak: stopped')
    finally:
        if f:
            f.close()
    if writer is None:
        print('perf_soak: no sample reached the device; nothing written', file=sys.stderr)
        return 1
    print()
    summarize([out])
    return 0


# ---- on-device loop ----------------------------------------------------------------------------------------------
# Wireless debugging can drop mid-run, and the PC loop loses those samples. Here the phone runs the same REMOTE
# script in a loop detached from the adb session and appends the raw dumps to a file; the PC starts it, shows
# progress while it reaches the phone, and at the end pulls the file and parses it like live samples.
# The loop survives a dropped connection, a new wireless port, the PC sleeping or this script dying. It does not
# survive adbd being stopped (debugging switched off, e.g. by Samsung Auto Blocker turning itself back on): init
# kills everything in adbd's cgroup, and shell cannot leave it. When adb comes back, the PC restarts the loop, which
# appends to the same file (the outage is a gap in the CSV).

DEV_DIR = '/data/local/tmp/perf_soak'
DEV_RAW = f'{DEV_DIR}/raw.txt'
ON_DEVICE_CAP_S = 6 * 3600      # without --duration the loop on the phone ends by itself after this

# $1 interval (centiseconds), $2 duration (s), $3 label, $4 new | resume. raw.txt: '@@@start <epoch> <uptime>
# <interval s> <label>' and '@@@uid <app uid>', then per sample '@@@sample <epoch> <uptime>' and the REMOTE sections;
# a restarted loop writes '@@@resume <epoch> <uptime>' and keeps the first start's end time ($D/end, epoch).
# /proc/uptime (counts suspend too) keeps the cadence and gives elapsed_s; the epoch is the wall clock for `time`.
# $D/pid stays behind when the loop is killed: that is how the PC tells 'killed' from 'done'.
LOOP = r'''
D=__DIR__
echo $$ > $D/pid
up() { u=$(cut -d' ' -f1 /proc/uptime); echo ${u%.*}${u#*.}; }
cs() { echo $(($1 / 100)).$(printf %02d $(($1 % 100))); }
I=$1
if [ "$4" = resume ]; then
  echo "@@@resume $(date +%s) $(cut -d' ' -f1 /proc/uptime)" >> $D/raw.txt
else
  echo $(($(date +%s) + $2)) > $D/end
  echo "@@@start $(date +%s) $(cut -d' ' -f1 /proc/uptime) $(cs $I) $3" > $D/raw.txt
  echo "@@@uid $(pm list packages -U __PKG__ 2>/dev/null | grep -o 'uid:[0-9]*' | cut -d: -f2)" >> $D/raw.txt
fi
END=$(cat $D/end)
S=$(up); n=0
while [ $(date +%s) -le $END ]; do
  echo "@@@sample $(date +%s) $(cut -d' ' -f1 /proc/uptime)" >> $D/raw.txt
  sh $D/sample.sh >> $D/raw.txt 2>/dev/null
  n=$((n + 1))
  w=$((S + n * I - $(up)))
  [ $w -gt 0 ] && sleep $(cs $w)
done
rm -f $D/pid
'''

# running / done (ended by itself or stopped) / killed (pid file left, process gone) / gone (never started)
STATE = (f'p=$(cat {DEV_DIR}/pid 2>/dev/null); if [ -z "$p" ]; then [ -f {DEV_DIR}/end ] && echo done || echo gone;'
         f' elif grep -q loop.sh /proc/$p/cmdline 2>/dev/null; then echo running; else echo killed; fi')


def dev_sh(serial: str, cmd: str, timeout: float = 20) -> str | None:
    """output of one shell command on the phone; None when it cannot be reached"""
    try:
        r = adb(serial, 'shell', cmd, timeout=timeout)
    except (subprocess.SubprocessError, OSError):
        return None
    return r.stdout.decode('utf-8', errors='replace').replace('\r', '') if r.returncode == 0 else None


def dev_state(serial: str) -> str | None:
    """the loop's state (see STATE); None when the phone cannot be reached"""
    out = dev_sh(serial, STATE)
    return None if out is None else out.strip()


def start_on_device(serial: str, pkg: str, interval: float, duration: float, label: str, resume: bool = False) -> bool:
    """push the scripts and start the loop (resume: restart a killed loop, appending)"""
    state = dev_state(serial)
    if state is None:
        print('perf_soak: the phone does not answer', file=sys.stderr)
        return False
    if state == 'running':
        print('perf_soak: a loop is already running on the phone; --collect it first', file=sys.stderr)
        return False
    if not resume:
        with tempfile.TemporaryDirectory() as tmp:
            dev_sh(serial, f'mkdir -p {DEV_DIR} && rm -f {DEV_DIR}/end {DEV_DIR}/pid')
            for name, body in (('sample.sh', REMOTE.replace('__PKG__', pkg)),
                               ('loop.sh', LOOP.replace('__DIR__', DEV_DIR).replace('__PKG__', pkg))):
                path = os.path.join(tmp, name)
                with open(path, 'wb') as f:
                    f.write(body.replace('\r\n', '\n').encode())
                if adb(serial, 'push', path, f'{DEV_DIR}/{name}', timeout=30).returncode != 0:
                    print(f'perf_soak: adb push {name} failed', file=sys.stderr)
                    return False
    lab = re.sub(r'[^A-Za-z0-9_.-]+', '_', label) or '-'
    # own session, no tty, no inherited fds: the loop outlives the adb connection (not adbd itself, see above)
    dev_sh(serial, f'cd {DEV_DIR} && setsid nohup sh loop.sh {round(interval * 100)} {round(duration or ON_DEVICE_CAP_S)}'
                   f' {lab} {"resume" if resume else "new"} </dev/null >/dev/null 2>&1 &')
    for _ in range(10):
        if dev_state(serial) == 'running':
            return True
        time.sleep(0.5)
    print('perf_soak: the loop did not start on the phone', file=sys.stderr)
    return False


def raw_blocks(text: str) -> tuple[dict[str, str], list[tuple[float, float, str]]]:
    """the raw file's header and its complete samples (epoch, uptime, REMOTE dump); one cut off by a kill is dropped"""
    head: dict[str, str] = {'resumes': '0'}
    blocks: list[tuple[float, float, str]] = []
    for part in text.replace('\r', '').split('\n@@@'):
        first, _, body = part.removeprefix('@@@').partition('\n')
        kind, *f = first.split(' ')
        if kind == 'start' and len(f) >= 3:
            head.update(epoch=f[0], uptime=f[1], interval=f[2], label=' '.join(f[3:]))
        elif kind == 'uid':
            head['uid'] = ''.join(f)
        elif kind == 'resume':
            head['resumes'] = str(int(head['resumes']) + 1)
        elif kind == 'sample' and len(f) >= 2 and '\n@@end' in '\n' + body:
            blocks.append((float(f[0]), float(f[1]), body))
    return head, blocks


def parse_raw(text: str, pkg: str, label: str) -> tuple[list[dict[str, object]], dict[str, str], list[str]]:
    """raw on-device dumps -> CSV rows (the live sampler's columns), the raw header, cpufreq policy names"""
    head, blocks = raw_blocks(text)
    sampler = Sampler('', pkg, label)
    sampler.uid = head.get('uid', '')                 # app_hz without asking the phone
    lab = label or ('' if head.get('label') in (None, '-') else head['label'])
    up0 = num(head.get('uptime')) or (blocks[0][1] if blocks else 0.0)
    rows: list[dict[str, object]] = []
    prev: tuple[float, float, float] | None = None    # epoch, elapsed, uptime
    for epoch, up, body in blocks:
        if prev and up < prev[2]:                      # the phone rebooted: carry elapsed on by the wall clock
            up0 = up - (prev[1] + epoch - prev[0])
        end = num(((sections(body).get('uptime') or [''])[0]).split(' ')[0])
        row = sampler.parse(body, round((end - up) * 1000) if end is not None and end >= up else None)
        row.update(time=dt.datetime.fromtimestamp(epoch).astimezone().isoformat(timespec='seconds'),
                   elapsed_s=round(up - up0, 1), label=lab)
        rows.append(row)
        prev = (epoch, up - up0, up)
    return rows, head, sampler.policies


def convert(raw: str, args: argparse.Namespace, stamp: str) -> int:
    """a pulled raw file -> CSV (overwritten) and the summary; reports gaps longer than 1.5 intervals"""
    with open(raw, encoding='utf-8', errors='replace') as f:
        rows, head, policies = parse_raw(f.read(), args.package, args.label)
    if not rows:
        print(f'perf_soak: no complete sample in {raw}', file=sys.stderr)
        return 1
    out = args.out or default_out(str(rows[0]['label']), stamp)
    columns = BASE_COLUMNS + [f'cpu_mhz_{p}' for p in policies]
    with open(out, 'w', newline='', encoding='utf-8') as f:
        w = csv.DictWriter(f, fieldnames=columns, extrasaction='ignore')
        w.writeheader()
        for r in rows:
            w.writerow({c: r.get(c, '') for c in columns})
    interval = num(head.get('interval')) or 0.0
    el = [float(r['elapsed_s']) for r in rows]          # type: ignore[arg-type]
    gaps = [b - a for a, b in zip(el, el[1:]) if interval and b - a > 1.5 * interval]
    print(f'perf_soak: {len(rows)} samples over {(el[-1] - el[0]) / 60:.1f} min -> {out}; '
          + (f'{len(gaps)} gaps, longest {max(gaps):.0f} s' if gaps else 'no gaps')
          + (f'; the loop was restarted {head["resumes"]}x' if head['resumes'] != '0' else ''))
    print()
    summarize([out])
    return 0


def collect(serial: str, args: argparse.Namespace, stamp: str) -> int:
    """stop the loop on the phone, pull its raw file next to the CSV and convert it"""
    if dev_state(serial) is None:
        serial = reconnect(serial)
    if dev_sh(serial, f'p=$(cat {DEV_DIR}/pid 2>/dev/null); [ -n "$p" ] && grep -q loop.sh /proc/$p/cmdline 2>/dev/null'
                      f' && kill $p; rm -f {DEV_DIR}/pid; echo ok') is None:
        print('perf_soak: the phone does not answer; its loop keeps sampling. Reconnect adb, then run --collect', file=sys.stderr)
        return 1
    raw = os.path.splitext(args.out)[0] + '.raw.txt' if args.out else f'perf_soak_raw_{stamp}.txt'
    if adb(serial, 'pull', DEV_RAW, raw, timeout=120).returncode != 0:
        print(f'perf_soak: could not pull {DEV_RAW}', file=sys.stderr)
        return 1
    print(f'perf_soak: pulled {DEV_RAW} -> {raw}')
    return convert(raw, args, stamp)


def run_on_device(args: argparse.Namespace) -> int:
    serial = pick_serial(args.serial)
    if not serial:
        return 2
    stamp = dt.datetime.now().strftime('%Y%m%d-%H%M%S')
    if not start_on_device(serial, args.package, args.interval, args.duration, args.label):
        return 1
    print(f'perf_soak: the phone ({serial}) samples itself every {args.interval:g}s'
          + (f' for {args.duration / 60:g} min' if args.duration else f' until Ctrl+C (at most {ON_DEVICE_CAP_S / 3600:g} h)')
          + f' -> {DEV_RAW}')
    print('  adb may drop meanwhile; if this window closes, run --collect later')
    start = time.monotonic()
    end = start + (args.duration or ON_DEVICE_CAP_S)
    lost = False
    shown: object = None
    try:
        while time.monotonic() < end + args.interval + 5:
            time.sleep(max(args.interval, 30))
            elapsed = time.monotonic() - start
            # progress from the last two dumps (the second for CPU %); the phone samples whether this works or not
            tail = dev_sh(serial, f'head -2 {DEV_RAW}; tail -c 40000 {DEV_RAW}')   # header: uid, start uptime
            if tail is None:
                if not lost:
                    print(f'  {elapsed:7.0f}s  adb lost; the phone keeps sampling', file=sys.stderr)
                lost = True
                serial = reconnect(serial)
                continue
            if lost:
                print(f'  {elapsed:7.0f}s  adb back')
            lost = False
            rows = parse_raw(tail, args.package, args.label)[0]
            if rows and rows[-1]['time'] != shown:
                shown = rows[-1]['time']
                print(live_line(float(rows[-1]['elapsed_s']), rows[-1]))   # type: ignore[arg-type]
            state = dev_state(serial)
            if state == 'killed' and time.monotonic() < end:
                print(f'  {elapsed:7.0f}s  the loop on the phone was killed (adbd stopped: debugging switched off?);'
                      ' restarting it', file=sys.stderr)
                start_on_device(serial, args.package, args.interval, args.duration, args.label, resume=True)
            elif state != 'running':
                break
    except KeyboardInterrupt:
        print('\nperf_soak: stopping the loop on the phone')
    for i in range(20):                                        # the phone may still be out of reach: keep trying
        if dev_state(serial) is not None:
            break
        if i == 0:
            print('  waiting for adb (turn wireless debugging back on) ...', file=sys.stderr)
        time.sleep(15)
        serial = reconnect(serial)
    return collect(serial, args, stamp)


# ---- summary ---------------------------------------------------------------------------------------------------

def gpu_mhz(v: float) -> float:
    """/sys/kernel/gpu/gpu_clock in MHz: Adreno (Snapdragon) reports MHz, Mali (Exynos) kHz (156000 = 156 MHz);
    no GPU clock is anywhere near 10 GHz, so a larger value is kHz"""
    return v / 1000 if v > 10000 else v


def load(path: str) -> list[dict[str, str]]:
    with open(path, newline='', encoding='utf-8') as f:
        return list(csv.DictReader(f))


def col(rows: list[dict[str, str]], k: str) -> list[float]:
    return [v for v in (num(r.get(k)) for r in rows) if v is not None]


def slope_per_10min(rows: list[dict[str, str]], k: str) -> float | None:
    pts = [(num(r['elapsed_s']), num(r.get(k))) for r in rows]
    pts = [(x, y) for x, y in pts if x is not None and y is not None]
    if len(pts) < 3:
        return None
    xs, ys = [p[0] for p in pts], [p[1] for p in pts]
    mx, my = statistics.fmean(xs), statistics.fmean(ys)
    den = sum((x - mx) ** 2 for x in xs)
    return sum((x - mx) * (y - my) for x, y in pts) / den * 600 if den else None


def fmt(v: float | None, nd: int = 1) -> str:
    return '-' if v is None else f'{v:.{nd}f}'


def summary_of(path: str) -> dict[str, str]:
    rows = load(path)
    ok = [r for r in rows if r.get('ok') == '1']
    fg = [r for r in ok if r.get('fg') == '1']
    s: dict[str, str] = {'file': os.path.basename(path), 'label': ok[0]['label'] if ok else ''}
    if not ok:
        s['samples'] = f'0 ok / {len(rows)}'
        return s
    dur = (num(ok[-1]['elapsed_s']) or 0) - (num(ok[0]['elapsed_s']) or 0)
    s['duration'] = f'{dur / 60:.1f} min'
    s['samples'] = f'{len(ok)} ok, {len(rows) - len(ok)} lost'
    s['app in front'] = f'{100 * len(fg) / len(ok):.0f} %'
    s['charging seen'] = 'YES' if any(r.get('plugged') not in ('no', '') for r in ok) else 'no'
    for k, name in (('t_skin', 'skin C'), ('t_cpu', 'cpu (AP) C'), ('t_battery', 'battery C (HAL)'), ('batt_temp', 'battery C')):
        v = col(ok, k)
        if v:
            s[f'{name} start/end/max'] = f'{v[0]:.1f} / {v[-1]:.1f} / {max(v):.1f}'
    ts = col(ok, 'thermal_status')
    if ts:
        s['thermal status max'] = f'{max(ts):.0f}'
    lv = col(ok, 'batt_level')
    if lv:
        s['battery %'] = f'{lv[0]:.0f} -> {lv[-1]:.0f}'
    p = col([r for r in ok if r.get('plugged') == 'no'], 'power_mw')
    if p:
        s['power mW avg (p50)'] = f'{statistics.fmean(p):.0f} ({statistics.median(p):.0f})'
    cc = col(ok, 'charge_uah')
    vv = col(ok, 'voltage_mv')
    if len(cc) >= 2 and dur > 0 and vv:
        mah = (cc[0] - cc[-1]) / 1000          # the fuel gauge counts in ~10 mAh steps: needs a long run (30+ mAh)
        s['charge used'] = (f'{mah:.0f} mAh = {mah * statistics.fmean(vv) / 1000 / (dur / 3600):.0f} mW avg' if mah >= 30
                            else f'{mah:.0f} mAh (too short to average)')
    for k, name in (('app_cpu_pct', 'app CPU % (1 core)'), ('ren_cpu_pct', 'renderer CPU %'), ('sys_cpu_pct', 'device CPU % (all)'),
                    ('gpu_busy_pct', 'GPU busy %'), ('gpu_mhz', 'GPU MHz')):
        v = col(fg or ok, k)
        if k == 'gpu_mhz':
            v = [gpu_mhz(x) for x in v]                        # CSVs written before the kHz fix
        if v:
            s[f'{name} avg'] = fmt(statistics.fmean(v))
    for k, name in (('app_pss_mb', 'app PSS MB'), ('app_gfx_mb', 'app graphics MB'), ('ren_pss_mb', 'renderer PSS MB')):
        v = col(ok, k)
        if v:
            s[f'{name} first/last/max'] = f'{v[0]:.0f} / {v[-1]:.0f} / {max(v):.0f}'
            sl = slope_per_10min(ok, k) if dur >= 300 else None    # least squares over the run; noise under 5 min
            s[f'{name} trend /10min'] = '-' if sl is None else f'{sl:+.1f}'
    hz: dict[str, int] = {}
    for r in fg:
        hz[r.get('app_hz') or '?'] = hz.get(r.get('app_hz') or '?', 0) + 1
    if hz:
        s['app refresh Hz (front)'] = ', '.join(f'{k} x{v}' for k, v in sorted(hz.items(), key=lambda kv: -kv[1]))
    pids = {r.get('app_pid') for r in ok if r.get('app_pid')}
    if len(pids) > 1:
        s['app restarts'] = str(len(pids) - 1)
    rp = {r.get('ren_pid') for r in ok if r.get('ren_pid')}
    if len(rp) > 1:
        s['renderer restarts'] = str(len(rp) - 1)
    return s


def summarize(paths: list[str]) -> None:
    sums = [summary_of(p) for p in paths]
    keys: list[str] = []
    for s in sums:
        keys += [k for k in s if k not in keys]
    w0 = max(len(k) for k in keys)
    widths = [max(18, *(len(s.get(k, '-')) for k in keys)) for s in sums]
    for k in keys:
        print(f'{k:<{w0}}  ' + '  '.join(f'{s.get(k, "-"):<{w}}' for s, w in zip(sums, widths)).rstrip())


def main() -> int:
    sys.stdout.reconfigure(line_buffering=True)        # live lines also when piped into a file / tee
    ap = argparse.ArgumentParser(description=__doc__.split('\n\n')[0], formatter_class=argparse.RawDescriptionHelpFormatter,
                                 epilog='see docs/perf-soak.md')
    ap.add_argument('--serial', '-s', help='adb serial (default: the only connected device)')
    ap.add_argument('--interval', '-i', type=float, default=15, help='seconds between samples (default 15)')
    ap.add_argument('--duration', '-d', type=parse_duration, default=0, help='45m, 1h, 90s; bare number = minutes; default until Ctrl+C')
    ap.add_argument('--out', '-o', help='CSV path (appended to; default perf_soak_<label>_<time>.csv)')
    ap.add_argument('--label', '-l', default='', help='build / run name written into every row')
    ap.add_argument('--package', default=PKG, help=f'app package (default {PKG})')
    ap.add_argument('--summarize', nargs='+', metavar='CSV', help='print the summary of existing CSVs side by side and exit')
    ap.add_argument('--on-device', action='store_true',
                    help='sample in a loop on the phone (keeps going while adb is down); pull and convert at the end')
    ap.add_argument('--collect', nargs='?', const=True, metavar='RAW',
                    help='stop the --on-device loop, pull its raw file and write the CSV; or convert a RAW file pulled earlier')
    args = ap.parse_args()
    if args.summarize:
        summarize(args.summarize)
        return 0
    if args.collect:
        stamp = dt.datetime.now().strftime('%Y%m%d-%H%M%S')
        if isinstance(args.collect, str):
            return convert(args.collect, args, stamp)
        serial = pick_serial(args.serial)
        return collect(serial, args, stamp) if serial else 2
    if args.interval < 2:
        ap.error('--interval must be at least 2 s')
    return run_on_device(args) if args.on_device else run(args)


if __name__ == '__main__':
    sys.exit(main())
