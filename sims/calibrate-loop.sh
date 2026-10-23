#!/usr/bin/env bash
# impact -> calibrate -> profiles, twice, then a final impact run to verify. usage: sims/calibrate-loop.sh <diff> <bossIds...>
set -e
cd "$(dirname "$0")/.."
DIFF=$1; shift
KEYS=$(for b in "$@"; do printf '%s_%s ' "$b" "$DIFF"; done)
for round in 1 2; do
  node tools/impact.js $KEYS | grep -v "Not Yet Verified"
  node tools/calibrate.js $KEYS
  for b in "$@"; do node tools/profile.js "$b" "$DIFF" > /dev/null; done
done
node tools/impact.js $KEYS | grep -v "Not Yet Verified"
echo CALIBRATION DONE
