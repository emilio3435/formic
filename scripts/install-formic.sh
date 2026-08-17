#!/usr/bin/env bash
# Greenfield Formic install for a stranger's Mac.
#
# Label: ai.imaginethat.anthill
# Why this label: hygiene, deploy, and ANT-GUIDE already kickstart this job.
# WorkingDirectory is the checkout this script resolved (script location, cwd,
# or ~/formic) — never a hardcoded operator path.
#
# The LaunchAgent starts `bun src/server/index.ts` (same argv hygiene uses),
# not `bun start`. anthill-start.sh exits 0 when :4701 is already up, which
# would loop under KeepAlive.
#
# Public clone: https://github.com/emilio3435/formic.git → ~/formic
# If you are already inside a Formic checkout, that tree is used.
#
# ~/.local/bin/formic is installed only when src/cli/formic.ts exists.
#
# Safe to re-run.
set -euo pipefail

PUBLIC_REMOTE="https://github.com/emilio3435/formic.git"
LABEL="ai.imaginethat.anthill"
PORT="${MOUNTAIN_PORT:-4701}"
URL="http://127.0.0.1:${PORT}"

export PATH="${HOME}/.bun/bin:${HOME}/.local/bin:${PATH:-/usr/bin:/bin}"

die() {
  printf 'error: %s\n' "$*" >&2
  exit 1
}

is_checkout() {
  local dir="$1"
  [[ -f "${dir}/src/server/index.ts" && -f "${dir}/scripts/anthill-start.sh" && -f "${dir}/package.json" ]]
}

need_bun() {
  if command -v bun >/dev/null 2>&1; then
    return 0
  fi
  cat <<'EOF' >&2
Formic needs bun (https://bun.sh). Install it, then re-run this script.

  curl -fsSL https://bun.sh/install | bash
  export PATH="$HOME/.bun/bin:$PATH"

The first line downloads bun's installer and runs it (pipe curl to bash).
Review https://bun.sh/docs/installation if you prefer not to pipe curl to bash.
EOF
  if [[ "${FORMIC_INSTALL_BUN:-}" == "1" ]]; then
    echo "FORMIC_INSTALL_BUN=1 — running bun's installer after the PATH note above." >&2
    curl -fsSL https://bun.sh/install | bash
    export PATH="${HOME}/.bun/bin:${PATH}"
    command -v bun >/dev/null 2>&1 || die "bun was still not on PATH after install"
    return 0
  fi
  exit 1
}

resolve_root() {
  local script_root
  script_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
  if is_checkout "${script_root}"; then
    ROOT="${script_root}"
    return
  fi
  if is_checkout "${PWD}"; then
    ROOT="${PWD}"
    return
  fi
  if is_checkout "${HOME}/formic"; then
    ROOT="${HOME}/formic"
    return
  fi
  if [[ -e "${HOME}/formic" ]]; then
    die "${HOME}/formic exists and is not a Formic checkout"
  fi
  command -v git >/dev/null 2>&1 || die "git is required to clone ${PUBLIC_REMOTE}"
  echo "Not inside a Formic checkout — cloning ${PUBLIC_REMOTE} to ${HOME}/formic"
  git clone -- "${PUBLIC_REMOTE}" "${HOME}/formic"
  ROOT="${HOME}/formic"
  is_checkout "${ROOT}" || die "clone did not look like a Formic checkout"
}

write_plist() {
  local bun_bin server_entry plist
  bun_bin="$(command -v bun)"
  server_entry="${ROOT}/src/server/index.ts"
  plist="${HOME}/Library/LaunchAgents/${LABEL}.plist"
  [[ -f "${server_entry}" ]] || die "server entry not found: ${server_entry}"
  mkdir -p "$(dirname "${plist}")" "${HOME}/Library/Logs"
  cat >"${plist}" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>EnvironmentVariables</key>
	<dict>
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
		<string>${bun_bin}</string>
		<string>${server_entry}</string>
	</array>
	<key>RunAtLoad</key>
	<true/>
	<key>StandardErrorPath</key>
	<string>${HOME}/Library/Logs/${LABEL}.err.log</string>
	<key>StandardOutPath</key>
	<string>${HOME}/Library/Logs/${LABEL}.out.log</string>
	<key>WorkingDirectory</key>
	<string>${ROOT}</string>
</dict>
</plist>
EOF
}

write_wrapper() {
  local wrapper="${HOME}/.local/bin/formic"
  mkdir -p "$(dirname "${wrapper}")"
  cat >"${wrapper}" <<EOF
#!/usr/bin/env bash
export FORMIC_ROOT="${ROOT}"
exec bun "${ROOT}/src/cli/formic.ts" "\$@"
EOF
  chmod +x "${wrapper}"
}

kick_agent() {
  local uid_num domain service plist
  plist="${HOME}/Library/LaunchAgents/${LABEL}.plist"
  if ! command -v launchctl >/dev/null 2>&1; then
    echo "launchctl not found — plist written. Start the board with: bun start"
    return 0
  fi
  uid_num="$(id -u)"
  domain="gui/${uid_num}"
  service="${domain}/${LABEL}"
  launchctl bootout "${service}" >/dev/null 2>&1 || true
  launchctl bootstrap "${domain}" "${plist}"
  launchctl kickstart -k "${service}" >/dev/null 2>&1 || launchctl kickstart "${service}" >/dev/null 2>&1 || true
}

wait_for_board() {
  local i
  command -v curl >/dev/null 2>&1 || return 0
  for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20; do
    if curl -fsS --max-time 1 "${URL}/" >/dev/null 2>&1; then
      return 0
    fi
    sleep 0.25
  done
  return 1
}

need_bun
resolve_root
write_plist
if [[ -f "${ROOT}/src/cli/formic.ts" ]]; then
  write_wrapper
fi
kick_agent
if ! wait_for_board; then
  echo "Board did not answer yet. See ~/Library/Logs/${LABEL}.err.log or run: bun start" >&2
fi

echo "Formic checkout: ${ROOT}"
echo "Board: ${URL}"
if [[ -f "${ROOT}/src/cli/formic.ts" ]]; then
  echo "CLI: ${HOME}/.local/bin/formic"
  case ":${PATH}:" in
    *":${HOME}/.local/bin:"*) ;;
    *) echo "Add ${HOME}/.local/bin to PATH to run \`formic\` from any folder." ;;
  esac
else
  echo "CLI: not installed (no src/cli/formic.ts in this checkout)"
fi
