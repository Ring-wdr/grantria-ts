# Scripted play loop for long A/B soak runs (docs/perf-soak.md): runs ON THE PHONE (adb shell, toybox sh),
# so two builds get the same input pattern and the same `input` process overhead, and it keeps going while
# wireless debugging drops. It injects touches through `input motionevent` / `input tap` (the real touch path:
# pointer events, the HUD stick and button states), in a cycle that returns to where it started:
#   stick right HOLD, attack TAPS x, stick left HOLD, attack, stick up HOLD, attack, stick down HOLD, attack
# The game itself is not deterministic (monster AI, drops), so the route drifts a little; the load is what repeats.
#
#   adb push tools/perf_input_loop.sh /data/local/tmp/perf_loop.sh
#   adb shell "setsid nohup sh /data/local/tmp/perf_loop.sh 284 833 2126 878 2400 > /data/local/tmp/perf_loop.log 2>&1 < /dev/null &"
#   adb shell "kill \$(cat /data/local/tmp/perf_loop.pid)"          # stop early
#
# Arguments: stick centre x y, attack button x y (screen pixels in the current rotation, e.g. from a
# `screencap`), duration in seconds, then optionally the stick offset in pixels (default 180: past the
# 48-game-pixel full-speed band at 3.375x), hold seconds (default 2) and attack taps per stop (default 3).
# The coordinates above are a Galaxy Note10 5G (2280x1080) in the edge layout.

CX=$1 CY=$2 AX=$3 AY=$4 DUR=$5 OFF=${6:-180} HOLD=${7:-2} TAPS=${8:-3}
if [ -z "$DUR" ]; then echo "usage: perf_loop.sh cx cy ax ay seconds [offset] [hold] [taps]"; exit 2; fi
echo $$ > /data/local/tmp/perf_loop.pid
END=$(( $(date +%s) + DUR ))
cycles=0

hold() {                                   # one finger on the stick, pushed to (x, y), for HOLD seconds
  input motionevent DOWN $CX $CY
  input motionevent MOVE $1 $2
  sleep $HOLD
  input motionevent UP $1 $2
}
attack() {
  i=0
  while [ $i -lt $TAPS ]; do input tap $AX $AY; i=$((i + 1)); done
}

while [ $(date +%s) -lt $END ]; do
  hold $((CX + OFF)) $CY; attack
  hold $((CX - OFF)) $CY; attack
  hold $CX $((CY - OFF)); attack
  hold $CX $((CY + OFF)); attack
  cycles=$((cycles + 1))
  echo "$(date +%T) cycle $cycles"
done
echo "$(date +%T) done after $cycles cycles"
rm -f /data/local/tmp/perf_loop.pid
