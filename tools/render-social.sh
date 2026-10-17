#!/usr/bin/env bash
# Renders the 60 s preview tour at 30 fps for social media, with soundtrack:
#   3:4 1080x1440 (Xiaohongshu), 4:5 1080x1350 (LinkedIn), 16:9 1920x1080 (X).
# Builds nothing: run `npm run build` first. Resumable: rerun after an interruption and it
# skips finished formats and continues a partial one. Output: video/social/*.mp4
# Usage: tools/render-social.sh
set -u
cd "$(dirname "$0")/.."
OUT=video/social
mkdir -p "$OUT"
LOG="$OUT/render.log"

npx vite preview --port 8643 --strictPort > "$OUT/preview-server.log" 2>&1 &
PREVIEW=$!
trap 'kill $PREVIEW 2>/dev/null' EXIT
for i in $(seq 60); do curl -sk -o /dev/null https://localhost:8643/ && break; sleep 1; done

render() {
  local name=$1 w=$2 h=$3
  local dir="$OUT/$name"
  # resumable: a container restart only costs a quick replay, finished formats are skipped
  [ -f "$OUT/chinese-garden-$name.mp4" ] && { echo "[$(date +%T)] $name already done" >> "$LOG"; return 0; }
  echo "[$(date +%T)] $name ${w}x${h} start" >> "$LOG"
  for attempt in 1 2; do
    RESUME=1 FPS=30 WIDTH=$w HEIGHT=$h node tools/video2.mjs "$dir/frames" >> "$LOG" 2>&1 && break
    echo "[$(date +%T)] $name capture failed (attempt $attempt)" >> "$LOG"
    [ "$attempt" = 2 ] && return 1
  done
  node tools/soundtrack.mjs "$dir/events.json" "$dir/soundtrack.wav" 60 >> "$LOG" 2>&1 || return 1
  ffmpeg -loglevel error -y -framerate 30 -i "$dir/frames/%05d.png" -i "$dir/soundtrack.wav" \
    -c:v libx264 -preset slow -crf 18 -pix_fmt yuv420p -r 30 \
    -c:a aac -b:a 192k -ar 48000 -movflags +faststart -shortest \
    "$OUT/chinese-garden-$name.mp4" >> "$LOG" 2>&1 || return 1
  rm -rf "$dir/frames"
  echo "[$(date +%T)] $name done -> $OUT/chinese-garden-$name.mp4" >> "$LOG"
}

render xiaohongshu-3x4 1080 1440
render linkedin-4x5 1080 1350
render x-1080p 1920 1080
echo "[$(date +%T)] ALL DONE" >> "$LOG"
