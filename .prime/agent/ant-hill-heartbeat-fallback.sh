#!/bin/bash
# Ant Hill B2 fallback heartbeat — Option B — EXACT instruction per user 2026-08-08
# Prime Global Skill · WANG GANG — workspace:workspace:64 window:5301CEEF-35D5-43EA-8077-9BF778DE09B8 session:019fe46c-d482-706c-b080-08f1420c8ae3
set -euo pipefail
WORKSPACE="workspace:64"
WINDOW="5301CEEF-35D5-43EA-8077-9BF778DE09B8"
SESSION="019fe46c-d482-706c-b080-08f1420c8ae3"
SESSION_JSONL="$HOME/.prime/agent/sessions/019fe46c-d482-706c-b080-08f1420c8ae3.jsonl"
LOG="/tmp/ant-hill-heartbeat.log"
CMUX="/Applications/cmux.app/Contents/Resources/bin/cmux"
INSTRUCTION='Ant Hill B2 heartbeat v4 — tail last 8 transcript turns from ~/.prime/agent/sessions/019fe46c-d482-706c-b080-08f1420c8ae3.jsonl, check cmux (cmux workspace list --window 5301CEEF-35D5-43EA-8077-9BF778DE09B8 --json) + curl 127.0.0.1:4701/api/health, then emit as your assistant turn: prefix "[TL;DR HH:MM] " followed by ONE LINE of JSON: {"v":4,"fleet":"<cross-repo story: who needs the operator, why, what unblocks it - 2-3 sentences>","repos":[{"repo":"<name>","summary":"<cause -> blocker -> next action, 2-4 sentences>","blocker":"<48 chars max, or all-clear>","signal":"ok|working|idle|needs-you|blocked|failed|all-clear"}]}. Style inside fleet and summary strings: mini-markup only - *strong*, backtick-mono, !alert! - no HTML, no markdown headers. NEVER restate momentum, burn, or context numbers; the board renders those deterministically. Length is yours to judge for content; the board clamps prose to 3 lines and the wire backstop is 6000 chars - end sentences early rather than relying on the clamp.'

log() { echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] $*" | tee -a "$LOG"; }

send() {
  local tmp=$(mktemp /tmp/ant-hill-instr.XXXXXX)
  printf "%s" "$INSTRUCTION" > "$tmp"
  log "SEND Option B -> $WORKSPACE ($WINDOW)"
  if ! $CMUX send --workspace "$WORKSPACE" "$(cat "$tmp")" 2>>"$LOG"; then
    log "cmux send failed"
    rm -f "$tmp"; return 1
  fi
  sleep 0.3
  $CMUX send-key --workspace "$WORKSPACE" Enter 2>>"$LOG" || log "send-key failed"
  rm -f "$tmp"
  log "sent Option B (Enter) — next assistant turn will be [TL;DR HH:MM] → transcriptTail → board in ~5s"
}

log "=== Ant Hill Option B fallback starting — workspace $WORKSPACE window $WINDOW session $SESSION ==="
log "health $(curl -s http://127.0.0.1:4701/api/health 2>&1 | head -c 250)"
log "workspaces $($CMUX workspace list --window $WINDOW --json 2>&1 | python3 -c "import json,sys; d=json.load(sys.stdin); print([(w['ref'], w.get('custom_title')) for w in d['workspaces']])" 2>&1 | head -c 300)"

# Immediate first for verification
send

# Loop: 3m live (Option B). Idle (10m) not needed for Option B single-instruction mode — but keep 10m staggered idle check as second send if you want both
while true; do
  sleep 180
  send
done
