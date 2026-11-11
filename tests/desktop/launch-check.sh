#!/usr/bin/env bash
# Starts the installed app on a virtual display and checks that it stays up and
# opens its window. Used in the release workflow to check each Linux package on
# the distribution it is meant for.
#
#   tests/desktop/launch-check.sh policy-debate
#   tests/desktop/launch-check.sh ./squashfs-root/AppRun
set -u

if [ "$#" -lt 1 ]; then
  echo "usage: $0 <command to start the app>" >&2
  exit 2
fi

export HOME="$(mktemp -d)"
export XDG_RUNTIME_DIR="$(mktemp -d)"
chmod 700 "$XDG_RUNTIME_DIR"
# No graphics card on a build server: draw in software.
export WEBKIT_DISABLE_COMPOSITING_MODE=1
export WEBKIT_DISABLE_DMABUF_RENDERER=1
export LIBGL_ALWAYS_SOFTWARE=1
export GDK_BACKEND=x11
export NO_AT_BRIDGE=1

Xvfb :99 -screen 0 1366x768x24 -nolisten tcp >/dev/null 2>&1 &
XVFB=$!
export DISPLAY=:99
sleep 2

LOG="$(mktemp)"
"$@" >"$LOG" 2>&1 &
APP=$!

status=0
window=""
for _ in $(seq 1 20); do
  sleep 1
  if ! kill -0 "$APP" 2>/dev/null; then
    echo "FAIL: the app exited during start-up."
    status=1
    break
  fi
  if command -v xwininfo >/dev/null 2>&1; then
    window="$(xwininfo -root -tree 2>/dev/null | grep -i 'Policy Debate' | head -1 || true)"
    [ -n "$window" ] && break
  fi
done

if [ "$status" -eq 0 ]; then
  if command -v xwininfo >/dev/null 2>&1 && [ -z "$window" ]; then
    echo "FAIL: the app is running but never opened a window titled 'Policy Debate'."
    status=1
  else
    echo "PASS: the app started and stayed up.${window:+ Window: $window}"
  fi
fi

echo "--- app output (last 40 lines) ---"
tail -40 "$LOG"
kill "$APP" 2>/dev/null
kill "$XVFB" 2>/dev/null
exit "$status"
