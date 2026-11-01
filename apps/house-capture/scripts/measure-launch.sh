#!/usr/bin/env bash
set -euo pipefail

root=$(cd "$(dirname "$0")/.." && pwd)
cd "$root"

if ! command -v xcodebuild >/dev/null 2>&1 || ! command -v xcrun >/dev/null 2>&1 || ! xcrun simctl help >/dev/null 2>&1; then
  echo "measure-launch: xcodebuild or simctl is not available, so launch time was not measured" >&2
  exit 2
fi
if ! command -v xcodegen >/dev/null 2>&1 || ! command -v python3 >/dev/null 2>&1; then
  echo "measure-launch: xcodegen or python3 is not available, so launch time was not measured" >&2
  exit 2
fi

booted=$(xcrun simctl list devices booted | sed -n 's/.*(\([A-F0-9-]\{36\}\)) (Booted).*/\1/p' | head -n 1 || true)
if [[ -z "${booted}" ]]; then
  echo "measure-launch: no booted simulator, so launch time was not measured" >&2
  exit 2
fi

bundle=com.wesbos.housecapture
shots=${SHOT_DIR:-/tmp/measure-launch}
mkdir -p "$shots"
trunk_ref=${TRUNK_REF:-origin/main}

build_app() {
  local dir=$1
  local derived=$2
  (
    cd "$dir"
    xcodegen generate >&2
    xcodebuild -project HouseCapture.xcodeproj -scheme HouseCapture -configuration Debug \
      -destination "platform=iOS Simulator,id=${booted}" \
      -derivedDataPath "$derived" \
      build >&2
  )
  find "$derived/Build/Products" -name HouseCapture.app -type d | head -n 1
}

time_selftest() {
  xcrun simctl terminate "$booted" "$bundle" >/dev/null 2>&1 || true
  local start now elapsed
  start=$(python3 -c 'import time; print(int(time.time()*1000))')
  elapsed=-1
  while IFS= read -r line; do
    if [[ "$line" == *SELFTEST:* ]]; then
      now=$(python3 -c 'import time; print(int(time.time()*1000))')
      elapsed=$((now - start))
      xcrun simctl terminate "$booted" "$bundle" >/dev/null 2>&1 || true
      break
    fi
  done < <(xcrun simctl launch --console "$booted" "$bundle" -selftest || true)
  echo "$elapsed"
}

shoot() {
  local label=$1
  local i
  xcrun simctl terminate "$booted" "$bundle" >/dev/null 2>&1 || true
  xcrun simctl launch "$booted" "$bundle" >/dev/null
  for i in $(seq 0 200 2800); do
    xcrun simctl io "$booted" screenshot "$shots/${label}-${i}.png" >/dev/null
    sleep 0.2
  done
  xcrun simctl terminate "$booted" "$bundle" >/dev/null 2>&1 || true
  echo "measure-launch: saved ${label} screenshots under ${shots}. Subtitle visibility was not judged."
}

work=$(mktemp -d)
trunk_derived=$(mktemp -d)
head_derived=$(mktemp -d)
cleanup() {
  git worktree remove --force "$work" >/dev/null 2>&1 || true
  rm -rf "$work" "$trunk_derived" "$head_derived"
}
trap cleanup EXIT

git worktree add --detach "$work" "$trunk_ref" >&2
trunk_app=$(build_app "$work" "$trunk_derived")
head_app=$(build_app "$root" "$head_derived")
if [[ -z "$trunk_app" || -z "$head_app" ]]; then
  echo "measure-launch: the app did not build, so launch time was not measured" >&2
  exit 2
fi

trunk_times=()
head_times=()
for _ in 1 2 3 4 5; do
  xcrun simctl install "$booted" "$trunk_app" >/dev/null
  elapsed=$(time_selftest)
  trunk_times+=("$elapsed")
  echo "trunk selftest ${elapsed} ms"
  xcrun simctl install "$booted" "$head_app" >/dev/null
  elapsed=$(time_selftest)
  head_times+=("$elapsed")
  echo "head selftest ${elapsed} ms"
done

python3 - "${trunk_times[@]}" -- "${head_times[@]}" << 'PY'
import sys
split = sys.argv.index("--")
trunk = [int(x) for x in sys.argv[1:split]]
head = [int(x) for x in sys.argv[split + 1:]]

def median(vals):
    if not vals or any(v < 0 for v in vals):
        raise SystemExit("measure-launch: a selftest run did not print SELFTEST")
    ordered = sorted(vals)
    return ordered[len(ordered) // 2]

trunk_median = median(trunk)
head_median = median(head)
print(f"measure-launch: trunk selftest median {trunk_median} ms")
print(f"measure-launch: head selftest median {head_median} ms")
if trunk_median > 5000 or head_median > 5000 or head_median > trunk_median + 150:
    raise SystemExit(1)
PY

xcrun simctl install "$booted" "$trunk_app" >/dev/null
shoot trunk
xcrun simctl install "$booted" "$head_app" >/dev/null
shoot head
echo "measure-launch: the English switch was not tapped, so switch time was not measured"
