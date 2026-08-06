# Lane EV-1 Report — evidence, census, and ledger

**Lane:** EV-1 (enumerate-and-report only)  
**Plan:** `docs/superpowers/plans/2026-08-05-unified-filtering.md` (§1, §2, §6; Tasks 1.2b / 2.0 / 4.3 / 4.4)  
**Measured:** 2026-08-05 ~22:00–22:08 CDT  
**Scratch:** `/tmp/ev1/`  
**Labels:** `confirmed` = observed in files; `inferred` = derived; `unknown` = not reachable from available files.

---

## 1. Launch-marker catalogue (Task 1.2b Step 1)

### Codex — `confirmed`: deterministically distinguishable

**Command:** `python3` over all `~/.codex/sessions/**/rollout-*.jsonl` first lines (`total_rollouts=4248`). Scratch: `/tmp/ev1/codex_markers.txt`.

Every rollout begins with `type: "session_meta"`. Launch mode is recorded on `payload.originator` + `payload.source` (and often `payload.thread_source`).

| Launch mode | `originator` | `source` | Example `thread_source` | Count (all rollouts) |
|---|---|---|---|---|
| Interactive TUI | `codex-tui` | `cli` | `user` (or absent on older) | 585 with `source=cli`; plus 499 with `source={subagent:…}` |
| Headless `codex exec` | `codex_exec` | `exec` | `user` (or absent) | 362 with `source=exec`; plus 27 subagent-shaped |

**Interactive TUI sample** (`confirmed`):

- File: `~/.codex/sessions/2026/08/05/rollout-2026-08-05T21-57-33-019fd501-3322-7180-8990-b6af48404e15.jsonl`
- `payload.originator = "codex-tui"`
- `payload.source = "cli"`
- `payload.thread_source = "user"`
- `payload.cli_version = "0.146.0"`

**Headless exec sample** (`confirmed`):

- File: `~/.codex/sessions/2026/08/04/rollout-2026-08-04T22-57-57-019fd012-2463-7e10-88b5-59fe3191db42.jsonl`
- `payload.originator = "codex_exec"`
- `payload.source = "exec"`
- `payload.thread_source = "user"`
- `payload.cli_version = "0.146.0"`

**Verdict:** exec vs TUI are **deterministically distinguishable** from recorded fields. Recommended mapping into `CollectedAgent.launch` (verbatim, if wired): e.g. `entrypoint: "codex_exec"` / `promptSource: "exec"` vs `entrypoint: "codex-tui"` / `promptSource: "cli"`. Subagent rows use `source: { "subagent": … }` + `thread_source: "subagent"` — orthogonal to exec/TUI.

Other originators observed (not required for 1.2b): `Codex Desktop` + `source=vscode` (dominant, often `thread_source=automation`), `codex-chrome-extension-sidepanel`, `codex_work_desktop`.

### Cursor — `confirmed`: no recorded launch marker for background vs interactive under `~/.cursor/chats/**`

**Commands:**

- Enumerate `~/.cursor/chats/**/meta.json` (61 files): keys are only `schemaVersion`, `createdAtMs`, `hasConversation`, `updatedAtMs`, `cwd`, optional `title`. No launch/background field. Scratch: `/tmp/ev1/cursor_markers.txt`.
- Decode `store.db` → `meta` JSON across all chats: `mode ∈ {default, search, plan}` (counts 77 / 24 / 12) — UI mode, not launch mode. Scratch: `/tmp/ev1/cursor_modes.txt`.
- Agent transcripts under `~/.cursor/projects/**/agent-transcripts/**/*.jsonl`: first-line keys are only `role` / `message` — no entrypoint/source/originator.

**Extra probe (outside the plan path, for completeness):** GUI `state.vscdb` `composerHeaders` / `composerData` expose `unifiedMode` (`agent`/`chat`/`plan`/`debug`), `isAgentic`, `agentLocation.type` (`local`/`worktree` only in this corpus — 0 `cloud` / 0 `background-composer` in headers). `workbench.backgroundComposer.persistentData` is empty (`lastOpenedBcIds: {}`). A stale glass fileTab URI mentions `vscode-remote://background-composer+bc-…`, but no matching composer transcript/header carries a usable launch marker.

**Deliverable sentence:** no recorded marker; kind stays pattern/unknown for this provider.

---

## 2. Cross-project-dir census (Task 2.0 / D1 gate)

**Command:** `python3` over every `~/.claude/projects/*/*.jsonl` — count transcripts; count those with `entrypoint == "sdk-py"` in the first 200 lines; among sdk-py, count tasks matching:

- `^Review this change for security vulnerabilit` (case-insensitive), or
- `^Review the (?:pushed|staged)\b` (case-insensitive)

Scratch: `/tmp/ev1/sdkpy_census.txt`.  
`project_dirs=63` (dirs listed); rows below omit empty dirs.

| Project dir (cwd-key) | transcripts | sdk-py | review sdk-py | non-review sdk-py |
|---|---:|---:|---:|---:|
| `-Users-emilionunezgarcia` | 45 | 0 | 0 | 0 |
| `-Users-emilionunezgarcia--codex-worktrees-bea9-LaHormigaDormida` | 7 | 0 | 0 | 0 |
| `-Users-emilionunezgarcia--worktrees-semuni-p3d-sem-ui` | 1 | 0 | 0 | 0 |
| `-Users-emilionunezgarcia-Developer--worktrees-ah-atlas-fe-20260805` | 6 | 5 | 5 | 0 |
| `-Users-emilionunezgarcia-Developer--worktrees-ah-findings-20260805` | 1 | 1 | 1 | 0 |
| `-Users-emilionunezgarcia-Developer--worktrees-ah-hardening-states-2026` | 3 | 2 | 2 | 0 |
| `-Users-emilionunezgarcia-Developer-LaHormigaDormida` | 65 | 51 | 50 | 1 |
| `-Users-emilionunezgarcia-Developer-anthill-pulse` | 5 | 5 | 5 | 0 |
| `-Users-emilionunezgarcia-Developer-cooper-scheduler` | 2 | 2 | 2 | 0 |
| `-Users-emilionunezgarcia-Developer-cooper-scheduler-worktrees-draft-c1` | 1 | 1 | 1 | 0 |
| `-Users-emilionunezgarcia-Developer-cooper-scheduler-worktrees-draft-e1` | 4 | 2 | 2 | 0 |
| `-Users-emilionunezgarcia-Developer-cooper-scheduler-worktrees-draft-f1` | 4 | 3 | 3 | 0 |
| `-Users-emilionunezgarcia-Developer-cooper-scheduler-worktrees-fe0-shel` | 14 | 8 | 8 | 0 |
| `-Users-emilionunezgarcia-Developer-cooper-scheduler-worktrees-fe1-queu` | 12 | 6 | 6 | 0 |
| `-Users-emilionunezgarcia-Developer-cooper-scheduler-worktrees-fe2-fair` | 10 | 5 | 5 | 0 |
| `-Users-emilionunezgarcia-Developer-cooper-scheduler-worktrees-fe3-load` | 10 | 6 | 6 | 0 |
| `-Users-emilionunezgarcia-Developer-cooper-scheduler-worktrees-fe4-ahea` | 15 | 8 | 8 | 0 |
| `-Users-emilionunezgarcia-Developer-cooper-scheduler-worktrees-integrat` | 14 | 12 | 12 | 0 |
| `-Users-emilionunezgarcia-Developer-hd-cockpit-performance-fix10-x-2026` | 3 | 2 | 2 | 0 |
| `-Users-emilionunezgarcia-Developer-hd-inbox-lane-fe1` | 5 | 4 | 4 | 0 |
| `-Users-emilionunezgarcia-Developer-hd-inbox-lane-fe2` | 2 | 1 | 1 | 0 |
| `-Users-emilionunezgarcia-Developer-hd-inbox-lane-fe3` | 1 | 0 | 0 | 0 |
| `-Users-emilionunezgarcia-Developer-hd-inbox-lane-fe4` | 4 | 3 | 3 | 0 |
| `-Users-emilionunezgarcia-Developer-hd-inbox-lane-fe5` | 1 | 0 | 0 | 0 |
| `-Users-emilionunezgarcia-Developer-hd-inbox-lane-fe6` | 2 | 1 | 1 | 0 |
| `-Users-emilionunezgarcia-Developer-hd-inbox-lane-fe7` | 2 | 1 | 1 | 0 |
| `-Users-emilionunezgarcia-Developer-hd-inbox-ux-overhaul` | 3 | 2 | 2 | 0 |
| `-Users-emilionunezgarcia-Developer-hd-miga-parchment-integration` | 25 | 24 | 24 | 0 |
| `-Users-emilionunezgarcia-Developer-hd-sem-audit-l11-frontend` | 3 | 2 | 2 | 0 |
| `-Users-emilionunezgarcia-Developer-hd-sem-audit-l13-claude-contract` | 3 | 2 | 2 | 0 |
| `-Users-emilionunezgarcia-Developer-hd-sem-audit-l6-ui` | 3 | 2 | 2 | 0 |
| `-Users-emilionunezgarcia-Developer-hd-settings-cockpit-be-ipc-20260722` | 4 | 2 | 2 | 0 |
| `-Users-emilionunezgarcia-Developer-hd-settings-land-20260722` | 6 | 6 | 6 | 0 |
| `-Users-emilionunezgarcia-Developer-hd-wizard-critic-stability` | 6 | 5 | 5 | 0 |
| `-Users-emilionunezgarcia-Developer-hd-wizard-engine-scanner` | 2 | 1 | 1 | 0 |
| `-Users-emilionunezgarcia-Developer-hd-wizard-engine-staging` | 4 | 3 | 3 | 0 |
| `-Users-emilionunezgarcia-Developer-hd-wizard-wizard-budget` | 3 | 2 | 2 | 0 |
| `-Users-emilionunezgarcia-Developer-hd-wizard-wizard-core` | 2 | 1 | 1 | 0 |
| `-Users-emilionunezgarcia-Developer-hd-wizard-wizard-frame` | 3 | 2 | 2 | 0 |
| `-Users-emilionunezgarcia-Developer-the-mountain` | 12 | 3 | 3 | 0 |
| `-Users-emilionunezgarcia-Developer-the-mountain-lanes-land-20260804` | 3 | 3 | 3 | 0 |
| `-Users-emilionunezgarcia-Developer-the-mountain-lanes-lifecycle-contra` | 16 | 16 | 16 | 0 |
| `-Users-emilionunezgarcia-Developer-the-mountain-lanes-luna-body-langua` | 3 | 3 | 3 | 0 |
| `-Users-emilionunezgarcia-Developer-the-mountain-lanes-luna-inspector-t` | 6 | 6 | 6 | 0 |
| `-Users-emilionunezgarcia-Developer-the-mountain-lanes-luna-integration` | 6 | 6 | 6 | 0 |
| `-Users-emilionunezgarcia-Developer-the-mountain-lanes-luna-operations-` | 1 | 1 | 1 | 0 |
| `-Users-emilionunezgarcia-Developer-the-mountain-lanes-luna-ops-canvas-` | 10 | 8 | 7 | 1 |
| `-Users-emilionunezgarcia-Developer-the-mountain-lanes-luna-scroll-shel` | 4 | 4 | 4 | 0 |
| `-Users-emilionunezgarcia-Developer-the-mountain-lanes-luna-tree-glance` | 8 | 8 | 8 | 0 |
| `-Users-emilionunezgarcia-Developer-the-mountain-lanes-naming-contract-` | 5 | 5 | 5 | 0 |
| `-Users-emilionunezgarcia-Developer-the-mountain-lanes-opus-cursor-poli` | 4 | 4 | 4 | 0 |
| `-Users-emilionunezgarcia-Developer-the-mountain-lanes-opus-fe-ux-20260` | 7 | 6 | 6 | 0 |
| `-Users-emilionunezgarcia-Developer-the-mountain-lanes-sol-under-hood-2` | 1 | 1 | 1 | 0 |
| `-Users-emilionunezgarcia-Developer-the-mountain-lanes-trunk-20260804` | 1 | 1 | 1 | 0 |
| `-Users-emilionunezgarcia-Developer-the-mountain-lanes-w7-control-outco` | 1 | 1 | 1 | 0 |
| `-Users-emilionunezgarcia-Developer-the-mountain-luna-be` | 3 | 3 | 3 | 0 |
| `-Users-emilionunezgarcia-Developer-the-mountain-main` | 404 | 388 | 388 | 0 |
| `-Users-emilionunezgarcia-elio-intelligence-suite` | 17 | 1 | 1 | 0 |
| `-private-tmp` | 3 | 0 | 0 | 0 |
| `-private-tmp-claude-501--Users-emilionunezgarcia-3e89dbde-858b-4007-92` | 2 | 0 | 0 | 0 |
| **TOTAL** | **823** | **651** | **649** | **2** |

Machine-readable twin: `/tmp/ev1/sdkpy_census.txt`.

### Non-review sdk-py (n=2) — `confirmed`

Both are security-guidance **follow-up** sessions, not third-party automation:

1. `…/LaHormigaDormida/814e927f-….jsonl` — task starts `You previously flagged these candidate vulnerabilities:`
2. `…/the-mountain-lanes-luna-ops-canvas-reconciled/d9228271-….jsonl` — same prefix

### D1 answer

**Does material NON-review sdk-py automation exist that an automation-kind Board gate would also hide?**

- **Material third-party / non-security-guidance automation:** **no** (`confirmed` in this fleet census).
- **Strict pattern miss:** **yes, 2/651 (0.3%)** — still the same plugin, different prompt prefix. An `automation` gate keyed only on `sdk-py` without the review-task patterns would hide these two as `automation` rather than `review`.
- **Implication for D1:** review-only hiding covers 649/651 sdk-py rows with current patterns; widening to hide all `automation` would add at most these 2 follow-ups (and any future non-review SDK launchers — none observed). **No material non-review automation volume to reopen D1.**

---

## 3. Yield ledger (Task 4.3)

### State location — `confirmed`

`SECURITY_WARNINGS_STATE_DIR` / `~/.claude/security` holds session warning JSON + logs, **not** the reviewed-SHA ledger.

Per `diffstate.py:257–295`, `sg-reviewed-shas` lives at `<git-common-dir>/sg-reviewed-shas` (i.e. `.git/sg-reviewed-shas`), format:

```text
<40-hex-sha>\t<unix-ts>\t<pv>\t<vulns_found>
```

Cap: `_REVIEWED_SHAS_CAP = 500` (`diffstate.py:258`) — GC keeps the newest 500 entries.

**Command:** resolve `.git` / `gitdir:` / worktree common dir for seed repos under `~/Developer`, `~/Job-Bored`, `~/elio-intelligence-suite`; read each unique `sg-reviewed-shas`. Scratch: `/tmp/ev1/yield_final.txt`.

| Repo root | reviews recorded | `vulns_found > 0` | notes |
|---|---:|---:|---|
| `~/Developer/the-mountain` | 500 | 0 | at cap; shared by worktree `the-mountain-main` |
| `~/Developer/LaHormigaDormida` | 500 | 2 | at cap; `vulns_found` sum = 3 |
| `~/Job-Bored` | 146 | 0 | |
| `~/elio-intelligence-suite` | 124 | 0 | |
| `~/Developer/cooper-scheduler` | 64 | 0 | |
| `~/Developer/anthill-pulse` | 18 | 0 | |
| **TOTAL (unique files)** | **1352** | **2** | |

Finding yield: **2 / 1352 entries (0.15%)** with `vulns_found > 0` in the retained windows (`confirmed`). Caps mean older reviews on mountain / Hormiga are dropped — true lifetime yield is `unknown` beyond the 500-entry windows.

### cooper-scheduler duplicate-SHA across worktree roots — `confirmed` = 0

- Worktrees under `~/Developer/cooper-scheduler.worktrees/*` point `gitdir:` → `~/Developer/cooper-scheduler/.git/worktrees/<name>`.
- `sg-reviewed-shas` exists only on the **common** git dir; each worktree gitdir has **no** copy (`draft-b1`…`integration`: all false).
- Therefore duplicate-SHA count across worktree roots of this multi-worktree repo is **0** by construction (one shared ledger, 64 unique SHAs). D3 “N worktrees re-review the same commits” does **not** apply to linked git worktrees; it would apply only to **separate clones** (not observed for cooper-scheduler here).

### Dollar figure — `unknown`

BurnBar per-session join by `sourceSessionId` is not reachable from `sg-reviewed-shas` or `~/.claude/security` files alone. No estimate.

---

## 4. Stop-trim switch hunt (Task 4.4 Step 1)

**Read:** `security-guidance/2.0.6/hooks/extensibility.py` (guidance/patterns only — **no** Stop-trim switch) and `security-guidance/2.0.6/README.md` §Configuration. Implementation gate in `security_reminder_hook.py` (not extensibility).

### Supported switch exists — `confirmed`

| Variable | Default | Effect |
|---|---|---|
| `ENABLE_STOP_REVIEW=0` | on (`!= "0"`) | Disables **only** the Stop-hook diff review; keeps commit/push LLM reviews |

README (verbatim intent): *"Disable only the Stop-hook diff review, keeping commit/push reviews. Useful for multi-agent / shared-worktree setups…"*

Code (`security_reminder_hook.py:160–162`, gate at `:1910–1911`):

```python
ENABLE_STOP_REVIEW = os.environ.get("ENABLE_STOP_REVIEW", "1") != "0"
# ...
if not ENABLE_STOP_REVIEW:
    debug_log("Stop hook: ENABLE_STOP_REVIEW=0")
    _skip(50)
```

Related (broader, **not** the D2 trim):

- `ENABLE_CODE_SECURITY_REVIEW=0` — disables **all** LLM reviews (Stop + commit/push)
- `ENABLE_COMMIT_REVIEW=0` — disables agentic commit review only
- `SECURITY_GUIDANCE_DISABLE=1` — full plugin kill switch

**EV-1 did not set any of these** (report-only).

---

## Summary for swarm consumers

| Item | Result | Confidence |
|---|---|---|
| Codex exec vs TUI marker | `originator`/`source`: `codex_exec`/`exec` vs `codex-tui`/`cli` | confirmed |
| Cursor background vs interactive marker | no recorded marker; kind stays pattern/unknown | confirmed |
| Non-review sdk-py volume | 2/651, both plugin follow-ups; no material alien automation | confirmed |
| D1 widen-to-automation? | No material volume to reopen; review-only gate sufficient | confirmed |
| Yield | 1352 retained reviews; 2 with vulns>0; $ unknown | confirmed / unknown |
| cooper-scheduler SHA dup across worktrees | 0 (shared `.git/sg-reviewed-shas`) | confirmed |
| Stop-trim switch | `ENABLE_STOP_REVIEW=0` | confirmed |
