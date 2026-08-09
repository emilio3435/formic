# Heartbeat TL;DR — B2 summarized tail (Prime global)

## What the board already shows

- `transcriptTail` (800c, last assistant text) + `task` (500c, first user text) + `lastAgentMessage` flow from `~/.prime/agent/sessions/*.jsonl` → `prime.ts` parser → `collectors.ts` (poll ~5s) → `snapshot.ts` → SSE → `renderAgentRow` (summary row) + `renderAgentDrawer` (expanded panel Chat, last 3 bubbles via `dedupeTurns`).
- Full transcript (jsonl) is NOT truncated — only the snapshot wire is. Archive + `session-artifacts` retain everything for History.

## A primary, B fallback — how to light

**A primary (daemon):** `await rlm_heartbeat.create(..., delivery_mode="steer" 3m + follow_up 10m)` — only Prime can steer. Try this first on every orchestrator start. If host returns "not available", immediately fall back to B.

**B fallback (no daemon):** `~/.prime/agent/ant-hill-heartbeat-fallback.sh` — cmux `send` loop every 3m to `workspace:64` window `5301CEEF…` session `019fe46c…` with exact Option B instruction. Installed now (PID via `ps aux | grep ant-hill-heartbeat`). B emulates A by sending the same B2 prompt as a queued user turn; assistant's next turn becomes `[TL;DR]` → `transcriptTail` → board ~5s.

## B2 recipe — summarized tail heartbeat (same instruction for A or B)

Create once per orchestrator session (this session) — try A first, else B is already running:

```python
from rlm_heartbeat import rlm_heartbeat

# Live swarm — steer (interrupt) so a stuck turn still reports
await rlm_heartbeat.create(
    instruction=(
        "Ant Hill heartbeat — B2 summarized tail. "
        "1) tail -n 40 ~/.prime/agent/sessions/$(basename $PWD).jsonl or read last 8 messages from "
        "  this session's jsonl via python. "
        "2) Summarize in 2 sentences + 1 bullet 'Blockers:' line (or 'all-clear'). "
        "3) Include provider/model/workspace/cwd + 6/6 health if 4701 reachable. "
        "4) Emit the summary as your assistant turn — this becomes transcriptTail and will auto-appear "
        "  on the board's summary row + expanded drawer on next ~5s poll. No cmux send, no extra API."
    ),
    interval="3m",
    label="ant-hill-orchestrator-live",
    delivery_mode="steer",
)

# Idle / all-clear — follow_up (queue after turn) to avoid churn
await rlm_heartbeat.create(
    instruction="Ant Hill idle heartbeat — same B2 check but only if no lane changed in 10m; emit 'all-clear — N tracked, 0 waiting' if idle.",
    interval="10m",
    label="ant-hill-orchestrator-idle",
    delivery_mode="follow_up",
)
```

List / pause / resume:

```python
await rlm_heartbeat.list()
await rlm_heartbeat.update("<id>", status="pause")
await rlm_heartbeat.update("<id>", status="resume")
await rlm_heartbeat.delete("<id>")
```

## Why steer vs follow_up vs every harness' queue

- **Prime `steer` (ONLY harness that can)**: interrupts mid-token. Use when YOUR orchestrator is working and you need TL;DR now even if it truncates the turn.
- **Prime `follow_up`**: queues until turn_complete. Identical to how Claude, Codex, and Cursor behave always.
- **Claude / Codex (queued)**: `cmux send` or `followUpQueueMode=queue` buffers until turn ends. Ant Hill's `transcriptTail` only updates AFTER the turn — board lags one turn, never corrupts.
- **Cursor (interrupt-required)**: no queue. Raw `surface.send_text` while `running` races the Composer box — may be lost/corrupt. Must `interrupt` (Esc) then `instruct`. See cursor row above.
- **OMP (queued)**: resume-only, stricter than queued — must wait for exit then `omp --resume <id>` / append.
- **OMP (queued)**: no queue store at all. Must wait for exit, then `omp --resume <id>` / append message as new turn. Any mid-turn `send` would start a second session, not queue.

**Verdict for your question "is Claude the ONLY harness with this behavior?" — No.** Claude is *one of three* that queue (Claude + Codex + Cursor all queue). OMP and Factory don't queue either — they are resume-only (stricter). Prime is the *only* one that CAN steer instream (via `rlm_heartbeat steer`). So the safe default for cross-harness orchestration is: **assume queued unless you are the Prime orchestrator in `steer` mode.**

## Verifying the TL;DR reached the board

```bash
# ~5s after heartbeat fires:
curl -s http://127.0.0.1:4701/api/snapshot | python3 -c "
import json,urllib.request
d=json.load(urllib.request.urlopen('http://127.0.0.1:4701/api/snapshot'))
for p in d['programs']:
  for a in p['agents']:
    if a['provider']=='prime':
      print(a['displayName'], a['task'][:80], a['transcriptTail'][:120])
"
# and directly:
tail -n 20 ~/.prime/agent/sessions/<current>.jsonl | python3 -m json.tool | tail
```

If `transcriptTail` contains your `[TL;DR 02:54]` prefix, the row + drawer are already rendering it.

---
## Boot probe — A→B auto-wire (runs on every Prime session start)

> **Idempotent:** second boot creates no duplicates — `rlm_heartbeat.list()` label check before `create`, `pgrep -f` guard before `nohup`.

### What runs on every Prime session start (orchestrator's first turn)

```python
# A primary — try daemon heartbeats first (session-owned, survives kernel restarts per session)
import rlm_heartbeat, subprocess, os, datetime

LOG = "/tmp/ant-hill-heartbeat.log"
def _log(msg): 
    line=f"[{datetime.datetime.utcnow().isoformat()}Z] {msg}"
    open(LOG,"a").write(line+"\n"); print(line)

try:
    existing = await rlm_heartbeat.list()
    labels = {h.get("label") for h in existing.get("heartbeats", [])}
    _log(f"BOOT PROBE: rlm_heartbeat.list labels={labels}")
    if "ant-hill-orchestrator-live" not in labels:
        await rlm_heartbeat.create(
            instruction="Ant Hill heartbeat — B2 summarized tail. 1) tail -n 40 ~/.prime/agent/sessions/019fe46c-d482-706c-b080-08f1420c8ae3.jsonl, summarize 2 sentences + Blockers bullet, include provider/model/workspace/cwd + health. Emit as assistant turn with prefix [TL;DR HH:MM]",
            interval="3m",
            label="ant-hill-orchestrator-live",
            delivery_mode="steer",
        )
        _log("BOOT PROBE: A live 3m steer created")
    else:
        _log("BOOT PROBE: A live 3m steer already exists — no-op")
    if "ant-hill-orchestrator-idle" not in labels:
        await rlm_heartbeat.create(
            instruction="Ant Hill idle heartbeat — same B2 check but only if no lane changed in 10m; emit 'all-clear — N tracked, 0 waiting' if idle.",
            interval="10m",
            label="ant-hill-orchestrator-idle",
            delivery_mode="follow_up",
        )
        _log("BOOT PROBE: A idle 10m follow_up created")
    else:
        _log("BOOT PROBE: A idle 10m follow_up already exists — no-op")
    _log("BOOT PROBE: A primary OK — B fallback not needed (already running as warm standby if needed)")
except Exception as e:
    msg = str(e)
    _log(f"BOOT PROBE: A failed: {msg}")
    if "not available" in msg.lower() or "host" in msg.lower():
        _log("BOOT PROBE: host not available — ensuring B fallback")
        subprocess.run(["bash", os.path.expanduser("~/.prime/agent/ant-hill-boot-probe.sh")], check=False)
    else:
        raise
```

### Shell fallback (B) — idempotent `~/.prime/agent/ant-hill-boot-probe.sh`

```bash
# One-liner the orchestrator's first turn runs if A is unavailable (or as health check):
bash ~/.prime/agent/ant-hill-boot-probe.sh
# Internals (idempotent):
# pgrep -f "ant-hill-heartbeat-fallback.sh" >/dev/null && echo "already running" || nohup bash ~/.prime/agent/ant-hill-heartbeat-fallback.sh >>/tmp/ant-hill-heartbeat.log 2>&1 &
```

Full shell script at `~/.prime/agent/ant-hill-boot-probe.sh` (also `~/.prime/agent/hooks/ant-hill-boot-probe.sh` for Prime hook dir):
- `pgrep -f` guard before `nohup` — second boot is no-op, no duplicate PIDs.
- Logs every decision to `/tmp/ant-hill-heartbeat.log` with UTC timestamp.
- If `A` host returns "not available", this script guarantees `B` loop is running (cmux send every 180s to `workspace:64`).

### Evidence (paste after boot)

```bash
cat /tmp/ant-hill-heartbeat.log | tail -n 20
ps aux | grep ant-hill-heartbeat | grep -v grep
ls -lh ~/.prime/agent/ant-hill-heartbeat-fallback.sh ~/.prime/agent/ant-hill-boot-probe.sh
# Dry-run idempotency (second invocation must be no-op):
bash ~/.prime/agent/ant-hill-boot-probe.sh; echo "second run exit: $?"
# Python idempotency:
# await rlm_heartbeat.list()  # labels ant-hill-orchestrator-live/idle must exist exactly once
```

### Why hooks/ vs SKILL.md

Prime currently has no documented `~/.prime/agent/hooks/` auto-run (checked `session-artifacts`, `settings.json`, `daemon-workers`). So the durable hook is **SKILL.md** itself: the orchestrator's first turn MUST read this file and run the probe above. The `hooks/` copy is forward-compatible if Prime adds hook support; `ant-hill-boot-probe.sh` is the single source of truth for B.

