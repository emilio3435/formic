#!/usr/bin/env bash
# Start The Ant Hill. You normally just run: bun start
#
# Auto mode (default):
#   1) if already up → open the UI
#   2) if you're inside cmux → start here
#   3) else try a dedicated cmux workspace
#   4) else fall back to this shell (password mode)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

MODE="auto"
PORT="${MOUNTAIN_PORT:-4702}"
OPEN_BROWSER=1
CMUX_BIN="${CMUX_EXECUTABLE:-/Applications/cmux.app/Contents/Resources/bin/cmux}"
ENV_FILE="$ROOT/data/cmux-socket.env"
WORKSPACE_NAME="Ant Hill · ops"

usage() {
  cat <<'EOF'
Start The Ant Hill (usually just: bun start)

  (default)     Auto: reuse if up, prefer cmux workspace, else this shell.
  --in-cmux     Force the dedicated cmux workspace path.
  --external    Force this shell (uses saved password for cmux access).
  --port N      Bind port (default: 4702).
  --no-open     Do not open the browser.
  -h, --help    Show this help.

One-time machine setup (already done if data/cmux-socket.env exists):
  bun run setup:cmux
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --auto) MODE="auto"; shift ;;
    --in-cmux) MODE="in-cmux"; shift ;;
    --external) MODE="external"; shift ;;
    --port) PORT="${2:?}"; shift 2 ;;
    --no-open) OPEN_BROWSER=0; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage >&2; exit 2 ;;
  esac
done

if ! [[ "$PORT" =~ ^[0-9]+$ ]] || (( PORT < 1 || PORT > 65535 )); then
  echo "Invalid --port: $PORT" >&2
  exit 2
fi

load_password() {
  if [[ -n "${CMUX_SOCKET_PASSWORD:-}" ]]; then
    return 0
  fi
  if [[ -f "$ENV_FILE" ]]; then
    # shellcheck disable=SC1090
    set -a
    # Only import CMUX_SOCKET_PASSWORD lines.
    while IFS= read -r line || [[ -n "$line" ]]; do
      [[ "$line" =~ ^[[:space:]]*# ]] && continue
      [[ "$line" =~ ^[[:space:]]*$ ]] && continue
      if [[ "$line" =~ ^[[:space:]]*(export[[:space:]]+)?CMUX_SOCKET_PASSWORD[[:space:]]*= ]]; then
        eval "$line"
      fi
    done < "$ENV_FILE"
    set +a
  fi
}

cmux_cli() {
  load_password
  if [[ -n "${CMUX_SOCKET_PASSWORD:-}" ]]; then
    "$CMUX_BIN" --password "$CMUX_SOCKET_PASSWORD" "$@"
  else
    "$CMUX_BIN" "$@"
  fi
}

inside_cmux() {
  [[ -n "${CMUX_SURFACE_ID:-}" || -n "${CMUX_WORKSPACE_ID:-}" ]]
}

already_up() {
  curl -fsS --max-time 1 "http://127.0.0.1:${PORT}/" >/dev/null 2>&1
}

open_ui() {
  if [[ "$OPEN_BROWSER" -eq 1 ]]; then
    if command -v open >/dev/null 2>&1; then
      open "http://127.0.0.1:${PORT}/" || true
    fi
  fi
  echo "The Ant Hill: http://127.0.0.1:${PORT}/"
}

run_server_here() {
  export MOUNTAIN_PORT="$PORT"
  load_password
  if [[ -n "${CMUX_SOCKET_PASSWORD:-}" ]]; then
    export CMUX_SOCKET_PASSWORD
  fi
  echo "Starting Ant Hill on 127.0.0.1:${PORT} ($(inside_cmux && echo 'inside cmux' || echo 'this shell'))…"
  exec bun run start:server
}

resolve_cmux_bin() {
  if [[ -x "$CMUX_BIN" ]] || command -v "$CMUX_BIN" >/dev/null 2>&1; then
    return 0
  fi
  if command -v cmux >/dev/null 2>&1; then
    CMUX_BIN="$(command -v cmux)"
    return 0
  fi
  return 1
}

launch_in_cmux_workspace() {
  if ! resolve_cmux_bin; then
    echo "cmux binary not found." >&2
    return 1
  fi
  load_password
  echo "Launching dedicated cmux workspace: ${WORKSPACE_NAME}"
  cmux_cli new-workspace \
    --name "$WORKSPACE_NAME" \
    --description "Ant Hill ops server — leave this pane running" \
    --cwd "$ROOT" \
    --command "MOUNTAIN_PORT=${PORT} bun run start:server" \
    --focus true
}

wait_for_up() {
  echo "Waiting for http://127.0.0.1:${PORT}/ …"
  for _ in $(seq 1 40); do
    if already_up; then
      open_ui
      return 0
    fi
    sleep 0.25
  done
  return 1
}

if already_up; then
  echo "Ant Hill is already running."
  open_ui
  exit 0
fi

case "$MODE" in
  external)
    load_password
    if ! inside_cmux && [[ -z "${CMUX_SOCKET_PASSWORD:-}" ]]; then
      echo "Need one-time setup first: bun run setup:cmux" >&2
      exit 1
    fi
    open_ui &
    run_server_here
    ;;
  in-cmux)
    if inside_cmux; then
      open_ui &
      run_server_here
    fi
    if ! launch_in_cmux_workspace; then
      echo "Could not start inside cmux. Try: bun run setup:cmux && bun start" >&2
      exit 1
    fi
    if ! wait_for_up; then
      echo "Check the '${WORKSPACE_NAME}' pane in cmux — server command was sent there." >&2
      exit 1
    fi
    ;;
  auto)
    # Prefer starting inside cmux when we can; otherwise just run here.
    if inside_cmux; then
      open_ui &
      run_server_here
    fi
    if launch_in_cmux_workspace && wait_for_up; then
      exit 0
    fi
    load_password
    if [[ -n "${CMUX_SOCKET_PASSWORD:-}" ]]; then
      echo "cmux workspace launch unavailable — starting in this shell with password mode."
    else
      echo "cmux not detected — starting in this shell (monitoring only; Focus/Send stay disabled)."
    fi
    open_ui &
    run_server_here
    ;;
  *)
    echo "Unknown mode: $MODE" >&2
    exit 2
    ;;
esac
