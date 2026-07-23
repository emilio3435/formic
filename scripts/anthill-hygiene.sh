#!/usr/bin/env bash
# Ant Hill hygiene — keep the LaunchAgent on main the-mountain, port 4701 healthy,
# and programs.json covering worktree lanes. Safe to re-run anytime.
set -euo pipefail

REPO="${ANTHILL_REPO:-/Users/emilionunezgarcia/Developer/the-mountain}"
PORT="${MOUNTAIN_PORT:-4701}"
LABEL="ai.imaginethat.anthill"
PLIST="${HOME}/Library/LaunchAgents/${LABEL}.plist"
SERVER_ENTRY="${REPO}/src/server/index.ts"
PROGRAMS_JSON="${REPO}/config/programs.json"
BUN_BIN="${BUN_BIN:-$(command -v bun || true)}"
UID_NUM="$(id -u)"
DOMAIN="gui/${UID_NUM}"
SERVICE="${DOMAIN}/${LABEL}"
URL="http://127.0.0.1:${PORT}"

red() { printf '\033[31m%s\033[0m\n' "$*"; }
green() { printf '\033[32m%s\033[0m\n' "$*"; }
yellow() { printf '\033[33m%s\033[0m\n' "$*"; }
info() { printf '%s\n' "$*"; }

die() { red "error: $*"; exit 1; }

need() { command -v "$1" >/dev/null 2>&1 || die "missing required command: $1"; }

need launchctl
need curl
need plutil
need python3
[[ -n "${BUN_BIN}" && -x "${BUN_BIN}" ]] || die "bun not found (set BUN_BIN)"
[[ -d "${REPO}" ]] || die "repo not found: ${REPO}"
[[ -f "${SERVER_ENTRY}" ]] || die "server entry not found: ${SERVER_ENTRY}"
[[ -f "${PROGRAMS_JSON}" ]] || die "programs.json not found: ${PROGRAMS_JSON}"

FIXED_PLIST=0
RESTARTED=0
PROGRAMS_WARN=0

plist_working_dir() {
  plutil -extract WorkingDirectory raw "${PLIST}" 2>/dev/null || true
}

plist_server_arg() {
  plutil -extract ProgramArguments.1 raw "${PLIST}" 2>/dev/null || true
}

cmux_capability() {
  if [[ -f "${PLIST}" ]]; then
    plutil -extract EnvironmentVariables.CMUX_SOCKET_CAPABILITY raw "${PLIST}" 2>/dev/null || true
  fi
}

write_plist() {
  local capability
  capability="$(cmux_capability)"
  [[ -n "${capability}" ]] || capability="${CMUX_SOCKET_CAPABILITY:-}"

  mkdir -p "$(dirname "${PLIST}")"
  cat >"${PLIST}" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>EnvironmentVariables</key>
	<dict>
		<key>CMUX_SOCKET_CAPABILITY</key>
		<string>${capability}</string>
		<key>MOUNTAIN_PORT</key>
		<string>${PORT}</string>
		<key>PATH</key>
		<string>${HOME}/.local/bin:${HOME}/.bun/bin:/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
	</dict>
	<key>KeepAlive</key>
	<true/>
	<key>Label</key>
	<string>${LABEL}</string>
	<key>ProgramArguments</key>
	<array>
		<string>${BUN_BIN}</string>
		<string>${SERVER_ENTRY}</string>
	</array>
	<key>RunAtLoad</key>
	<true/>
	<key>StandardErrorPath</key>
	<string>${HOME}/Library/Logs/${LABEL}.err.log</string>
	<key>StandardOutPath</key>
	<string>${HOME}/Library/Logs/${LABEL}.out.log</string>
	<key>WorkingDirectory</key>
	<string>${REPO}</string>
</dict>
</plist>
EOF
  FIXED_PLIST=1
}

ensure_plist() {
  local wd arg
  if [[ ! -f "${PLIST}" ]]; then
    yellow "LaunchAgent missing — writing ${PLIST}"
    write_plist
    return
  fi
  wd="$(plist_working_dir)"
  arg="$(plist_server_arg)"
  if [[ "${wd}" != "${REPO}" || "${arg}" != "${SERVER_ENTRY}" ]]; then
    yellow "LaunchAgent pointed at wrong tree:"
    info "  WorkingDirectory=${wd:-<missing>}"
    info "  ProgramArguments[1]=${arg:-<missing>}"
    yellow "Repointing to ${REPO}"
    write_plist
  else
    green "LaunchAgent OK → ${REPO}"
  fi
}

boot_service() {
  launchctl bootout "${SERVICE}" >/dev/null 2>&1 || true
  # Clear a stale listener if KeepAlive lost a race.
  local pid
  for pid in $(lsof -nP -iTCP:"${PORT}" -sTCP:LISTEN -t 2>/dev/null || true); do
    yellow "Freeing :${PORT} (pid ${pid})"
    kill -9 "${pid}" 2>/dev/null || true
  done
  launchctl bootstrap "${DOMAIN}" "${PLIST}"
  launchctl kickstart -k "${SERVICE}" >/dev/null 2>&1 || launchctl kickstart "${SERVICE}" >/dev/null 2>&1 || true
  RESTARTED=1
}

listener_cwd() {
  local pid
  pid="$(lsof -nP -iTCP:"${PORT}" -sTCP:LISTEN -t 2>/dev/null | head -1 || true)"
  [[ -n "${pid}" ]] || { echo ""; return; }
  lsof -a -d cwd -p "${pid}" 2>/dev/null | awk 'NR==2 {print $9; exit}'
}

http_ok() {
  local code
  code="$(curl -sS -m 5 -o /dev/null -w '%{http_code}' "${URL}/" 2>/dev/null || echo 000)"
  [[ "${code}" == "200" ]]
}

ensure_server() {
  local cwd
  if http_ok; then
    cwd="$(listener_cwd)"
    if [[ "${cwd}" == "${REPO}" ]]; then
      green "Server OK → ${URL} (cwd ${cwd})"
      return
    fi
    yellow "Port ${PORT} is up but cwd is '${cwd:-unknown}' — restarting onto main"
  else
    yellow "Server not healthy on ${URL} — starting LaunchAgent"
  fi
  boot_service
  local i
  for i in 1 2 3 4 5 6 7 8 9 10; do
    sleep 0.5
    if http_ok; then
      cwd="$(listener_cwd)"
      if [[ "${cwd}" == "${REPO}" ]]; then
        green "Server restarted → ${URL}"
        return
      fi
    fi
  done
  die "server did not come up cleanly on ${URL} (see ~/Library/Logs/${LABEL}.err.log)"
}

check_programs_json() {
  python3 - <<'PY' "${PROGRAMS_JSON}" || return 1
import json, sys
path = sys.argv[1]
data = json.load(open(path))
programs = data.get("programs") or []
needles = " ".join(" ".join(p.get("match") or []) for p in programs)
required = [
    "/Developer/.worktrees/hd-",
    "/.worktrees/hd-",
    "hd-inbox",
    "hd-sem-",
]
missing = [n for n in required if n.lower() not in needles.lower()]
names = [p.get("name") for p in programs if isinstance(p.get("name"), str)]
print("programs.json programs:", len(programs))
for name in names:
    print(f"  - {name}")
if missing:
    print("MISSING needles:", ", ".join(missing))
    sys.exit(2)
print("programs.json needles: OK (worktrees + Inbox + SEM)")
PY
}

check_cmux_password() {
  local env_file="${REPO}/data/cmux-socket.env"
  if [[ -f "${env_file}" ]] || [[ -n "${CMUX_SOCKET_PASSWORD:-}" ]]; then
    green "cmux password: configured (data/cmux-socket.env or env)"
  else
    yellow "cmux password: missing — run: bun run setup:cmux"
  fi
}

snapshot_summary() {
  python3 - <<'PY' "${URL}"
import json, sys, urllib.request
url = sys.argv[1].rstrip("/") + "/api/snapshot"
try:
    with urllib.request.urlopen(url, timeout=12) as resp:
        data = json.load(resp)
except Exception as exc:
    print(f"snapshot: unavailable ({exc})")
    sys.exit(0)
programs = data.get("programs") or []
names = sorted(p.get("name") or "" for p in programs)
orphans = [n for n in names if n.startswith("hd-")]
agent_count = sum(len(p.get("agents") or []) for p in programs)
control = data.get("controlHealth") or {}
print(f"snapshot: {len(programs)} programs · {agent_count} agents")
print("  groups:", ", ".join(names) if names else "(none)")
print(f"  orphan hd-* headers: {len(orphans)}" + (f" → {', '.join(orphans[:8])}" if orphans else ""))
if "cmuxReachable" in control:
    print(f"  cmuxReachable: {control.get('cmuxReachable')}")
PY
}

info "=== Ant Hill hygiene ==="
info "repo: ${REPO}"
info "port: ${PORT}"
info ""

ensure_plist
if [[ "${FIXED_PLIST}" -eq 1 ]]; then
  yellow "LaunchAgent updated — reloading service"
  boot_service
fi
ensure_server

info ""
if check_programs_json; then
  green "programs.json OK"
else
  PROGRAMS_WARN=1
  yellow "programs.json needs needle updates (see config/programs.json)"
fi

info ""
check_cmux_password

info ""
snapshot_summary

info ""
info "=== summary ==="
info "UI:            ${URL}"
info "LaunchAgent:   ${LABEL} → ${REPO}"
info "plist fixed:   ${FIXED_PLIST}"
info "restarted:     ${RESTARTED}"
info "programs warn: ${PROGRAMS_WARN}"
info ""
info "Operator loop: open ${URL} · swarm in one repo · drive agents via cmux ·"
info "  new lane family? add a match needle in config/programs.json then re-run:"
info "  bun run hygiene"
info ""

if [[ "${PROGRAMS_WARN}" -ne 0 ]]; then
  exit 2
fi
exit 0
