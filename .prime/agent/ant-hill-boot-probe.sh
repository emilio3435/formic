#!/bin/bash
# Ant Hill boot probe — A→B heartbeat auto-wire
# Idempotent: second boot does not create duplicate heartbeats or processes.
# A primary is tried via Python (rlm_heartbeat.list/create) in orchestrator's first turn;
# this shell ensures B fallback ~/.prime/agent/ant-hill-heartbeat-fallback.sh is running if A is unavailable.
# Log: /tmp/ant-hill-heartbeat.log
set -euo pipefail
LOG="/tmp/ant-hill-heartbeat.log"
FALLBACK="$HOME/.prime/agent/ant-hill-heartbeat-fallback.sh"

log() { echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] $*" | tee -a "$LOG"; }

# Guard: pkill -f equivalent check before nohup (idempotent)
if pgrep -f "ant-hill-heartbeat-fallback.sh" >/dev/null 2>&1; then
  PID=$(pgrep -f "ant-hill-heartbeat-fallback.sh" | head -n 1)
  log "BOOT PROBE: B fallback already running PID $PID — no-op (idempotent)"
  exit 0
fi

if [[ ! -f "$FALLBACK" ]]; then
  log "BOOT PROBE: ERROR fallback not found at $FALLBACK"
  exit 1
fi

log "BOOT PROBE: B fallback not running — starting nohup $FALLBACK"
# nohup + disown so it survives session exit
nohup bash "$FALLBACK" >>"$LOG" 2>&1 &
sleep 0.5
if pgrep -f "ant-hill-heartbeat-fallback.sh" >/dev/null 2>&1; then
  PID=$(pgrep -f "ant-hill-heartbeat-fallback.sh" | head -n 1)
  log "BOOT PROBE: B fallback started PID $PID"
else
  log "BOOT PROBE: B fallback failed to start — check $LOG"
  exit 1
fi
