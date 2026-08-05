#!/usr/bin/env bash
# Shared helpers for anthill cursor-agent / droid hook-store shims.
# Sourced by scripts/anthill-cursor-agent and scripts/anthill-droid.

anthill_hook_shim_repo_root() {
  local here
  here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  cd "$here/../.." && pwd
}

# Resolve the real binary, skipping this shim's directory and optional extras.
# Usage: anthill_hook_shim_resolve_bin <name> [override_env_var]
anthill_hook_shim_resolve_bin() {
  local name="$1"
  local override_var="${2:-}"
  local override=""
  if [[ -n "$override_var" ]]; then
    override="${!override_var:-}"
  fi
  if [[ -n "$override" && -x "$override" ]]; then
    printf '%s\n' "$override"
    return 0
  fi

  local shim_dir self
  shim_dir="$(cd "$(dirname "${BASH_SOURCE[1]}")" && pwd)"
  self="$(cd "$(dirname "${BASH_SOURCE[1]}")" && pwd)/$(basename "${BASH_SOURCE[1]}")"

  local candidate
  while IFS= read -r candidate; do
    [[ -n "$candidate" ]] || continue
    [[ -x "$candidate" ]] || continue
    if [[ "$candidate" -ef "$self" ]]; then
      continue
    fi
    case "$candidate" in
      "$shim_dir"/*) continue ;;
    esac
    printf '%s\n' "$candidate"
    return 0
  done < <(type -aP "$name" 2>/dev/null || true)

  return 1
}

anthill_hook_shim_should_bind() {
  [[ -n "${CMUX_SURFACE_ID:-}" && -n "${CMUX_WORKSPACE_ID:-}" ]]
}

# Upsert a binding/lifecycle record via scripts/cmux-hook-store.ts.
# Args: provider session_id lifecycle pid executable_path -- remaining launch args
anthill_hook_shim_upsert() {
  local provider="$1"
  local session_id="$2"
  local lifecycle="$3"
  local pid="$4"
  local executable_path="$5"
  shift 5

  local root repo bun_bin store_ts
  root="${ANTHILL_CMUXTERM_ROOT:-$HOME/.cmuxterm}"
  repo="$(anthill_hook_shim_repo_root)"
  store_ts="$repo/scripts/cmux-hook-store.ts"
  bun_bin="${BUN_BIN:-bun}"

  local -a cmd=(
    "$bun_bin" "$store_ts" upsert
    --provider "$provider"
    --session-id "$session_id"
    --surface-id "$CMUX_SURFACE_ID"
    --workspace-id "$CMUX_WORKSPACE_ID"
    --cwd "$PWD"
    --pid "$pid"
    --lifecycle "$lifecycle"
    --root "$root"
    --executable-path "$executable_path"
  )
  local arg
  for arg in "$@"; do
    cmd+=(--arg "$arg")
  done

  # Binding must never block the agent launch.
  "${cmd[@]}" >/dev/null 2>&1 || true
}
