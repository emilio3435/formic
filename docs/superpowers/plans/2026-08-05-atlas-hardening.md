# Atlas Hardening Plan — truth, lineage, and the parked/blocked/done distinction

> **Status: DRAFT for Emilio's ratification — not yet ratified, no lanes spawned.**
> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or superpowers:executing-plans, task-by-task, checkbox tracking. Same repo conventions as `2026-08-05-agent-atlas-regroup.md` (NUL file, docs parity, single-writer files, sandbox caveat, spawn contract).

**Goal:** Close the gaps the atlas program's own live run exposed: sessions that are *done* or *parked* still read as needing you; lineage binds only what was declared at birth; one session wears different names on different surfaces; and trust in declarations is unverified.

**Evidence base (live QA, 2026-08-05 ~10:20):** FE lane finished ALL tasks yet sat in Needs-You as `Waiting · Alert` ("Standing by. Working tree clean"); harden lane rendered inside "disposable checkouts" until a one-line manifest backfill rebound it live (retroactivity proven); FE's security-review subagents sit parentless in the ephemeral fold; be-spine's cycled session-1 lingers un-retired; one session showed three names across surfaces (`fe-regroup` / `atlas/be-spine` workspace title / stale distilled "Begin F1a feature…"); `#hex` tags appear on names with no visible collision.

**Lane assignments (model routing: the right model for the cause):**
| Lane | Model / CLI | Territory |
|---|---|---|
| be-truth | GPT 5.6 SOL MAX (codex, writable_roots) | `src/server/**` lineage + identity |
| be-live | GPT 5.6 SOL MAX (codex, writable_roots) | `src/server/**` events + trust (disjoint files from be-truth) |
| fe-states | Opus 5 xhigh (claude, permission-mode auto) | `src/web/**`, owns `tests/web-client.test.ts` |
| harden2 | Grok 4.5 High Fast (cursor-agent) | shims, `scripts/**`, `tests/**` fences as before |
| orchestrator | Fable (this session pattern) | contract design, audits, merges, the cmux-restart drill |

## Parallel structure (three tracks from minute one)

Track A (be-truth): T1 → T2 → T3.
Track B (be-live): T4 → T5.  Track C (harden2): T8 → T10 (T9 after T6's contract).
T6 (be-truth or be-live, whichever frees first) is the ONE serialization point: its wire contract gates T7 (fe-states). fe-states meanwhile owns T7a (naming unification), which needs nothing new on the wire.

---

### T1 — Kernel-verified lineage (be-truth) ✅ **[DONE 9d03fe3, merged]**

Walk pid→ppid chains (`ps -axo pid,ppid,lstart,command`, cached per collect) from each hook-store pid up to its cmux surface process. Produces `lineage.observedParentAgentId` + `lineageAgreement: "corroborated" | "contradicted" | "unobserved"` on the wire. A DECLARED parent that the kernel contradicts keeps the declared chain but carries the flag (F-side styles it hostile-red later; never silently re-parent). An UNDECLARED session whose ancestor chain reaches a known agent session gains `roleSource:"observed"` parentage — this is what binds subagents (live case: FE's security-review children) without any contract change. TDD: fixture a ps table; contradicted/corroborated/unobserved cases; subagent-adoption case.

### T2 — Session succession + cycle retirement (be-truth)

A manifest lane whose sessionId is REPLACED (orchestrator edits manifest, or T9 self-registration re-registers) leaves a predecessor: same lane, older session. Bind `succeededBy`/`supersedes` between them; the predecessor flows to the finished shelf with endEvidence `"superseded"` (union + docs + parity). Live case: be-spine session-1. Manifest schema gains nothing — succession is derived from lane sessionId history (keep `~/.anthill/runs/<runId>.history.jsonl` appended on backfill; additive).

### T3 — Repo identity by origin remote (be-truth)

`repoKey` = FNV of normalized `origin` URL when one exists (fallback: today's common-dir realpath). Two clones of one repo become one band; a lane whose declared `repoRoot` differs from cwd renders under the TARGET repo. Migration: repoKey change breaks collapse-state localStorage keys and paint keys — ship a client-side key migration (fe-states does the 5-line read-through in T7; coordinate the one shared commit like B4 did).

### T4 — B7 events tail (be-live)

As specced in the atlas plan (stretch B7): `cmux events --cursor-file ~/.anthill/events.cursor --reconnect --category agent --category workspace` as a supervised child; `boot_id` change ⇒ full re-snapshot; deltas feed between polls; polling stays the reconciler. Latency polish, not correctness — land LAST in its lane if T5 runs long.

### T5 — Provenance verification (be-live)

The `[from <agent.id> run <runId>]` header is spoof-visible, not spoof-proof. For each parsed sender: confirm the claimed sender's own transcript contains the send (tail-scan its session file for the message head, bounded). Wire: `senderVerified?: boolean`. Unverifiable (no transcript access) ⇒ absent, never false. A header whose claimed sender's transcript provably lacks the message ⇒ `senderVerified: false` (fe styles it as forged). No crypto until this cheap check proves insufficient.

### T6 — The parked / blocked / done contract (first free SOL lane) ⭐ the "what's actually cooking" fix

Today `hookLifecycle:needsInput` ⇒ wantsHuman — correct mid-task, wrong for a lane whose assignment is complete and is idling at its prompt. Declared task-state joins the manifest: lane gains `status?: "active" | "parked" | "done"` (+ `statusAt`), written by the orchestrator (stand-down = parked, DONE ALL = done) or by T9 self-registration. Precedence: declared status > hook lifecycle for the *attention* verdict only (a parked lane that later ASKS something re-alerts — hook needsInput NEWER than statusAt wins). Wire: `taskState?: "active"|"parked"|"done"` + source. ANT-GUIDE/parity/docs in the same commits. This is the plan's one serialization point — its wire shape gates T7.

### T7 — Render the truth (fe-states)

- **Needs-You admits only genuine blocks**: `needsInput` AND NOT (parked/done with older hook signal). Parked rows show a quiet "parked" chip in their lifecycle section; done rows go to the Finished shelf. The live litmus: a board where fe-regroup post-DONE-ALL does NOT sit in Needs-You.
- **T7a — one session, one name (no new wire needed, start immediately)**: every surface (row, Needs-You strip, swarm child, drawer, History) renders `identity.name` — the strip's stale distilled title and the swarm-child's workspace-title variant both die. Tag audit: `#hex` renders ONLY when the same base name appears twice in the current view (fe-regroup#8da7e056-on-a-unique-name is the red test).
- lineageAgreement styling (T1): contradicted = hostile red outline + tooltip; senderVerified:false (T5) = forged-mark on the chip.
- repoKey migration read-through (T3).

### T8 — Cursor + Factory hook-store shims (harden2)

Wrapper launchers (`cursor-agent` / `droid` wrapped) that emit the same `~/.cmuxterm/<provider>-hook-sessions.json` records the other three providers get (sessionId, surface from $CMUX_* env, cwd, pid, lifecycle heartbeat). Fenced to `scripts/**` + shim files + fixtures; server reader already accepts any provider file present (B1 tolerates absence). If lifecycle can't be derived cheaply, ship binding-only records — binding is the valuable half.

### T9 — Self-registration hook (harden2, after T6 contract)

A tiny boot script each lane's launch command sources: reads `ANTHILL_RUN`/`ANTHILL_LANE` from its env, writes its own sessionId + `status:"active"` into the manifest lane (atomic, first-write-wins per session), and on clean exit writes `status:"done"`. Removes the orchestrator's backfill step (the exact step whose omission orphaned the harden lane). Plus `anthill-backfill <runId> <laneId> <provider:sessionId>` for retroactive adoption of any visible session (the operation proven live today).

### T10 — Hardening sweep (harden2)

Truth-table + golden coverage for everything above: lineageAgreement cases, succession retirement, origin-vs-path repoKeys, parked/blocked/done matrix (esp. parked-then-asks re-alert), forged-sender fixture, shim goldens. Hook-store compaction: dead `activeSessionsBySurface` entries pruned after N days (the file only grows today).

### T11 — The cmux-restart drill (orchestrator + Emilio, scheduled)

The un-run matrix item: copy agent links, restart cmux (UUIDs re-mint), assert every link resolves via surface/transcript and no identity churns. Needs Emilio's go (kills all lane terminals); run it BETWEEN programs, capture as a scripted checklist in `docs/` so it's repeatable.

## Verification matrix

| Gate | Evidence |
|---|---|
| Per task | tsc + `bun test` real exit codes; `bun run check` per lane final; external re-verify at every merge |
| The litmus | live board: a DONE lane in Needs-You = failure; a mid-task question NOT in Needs-You = failure |
| Lineage | FE-style subagents appear under their spawner (observed) with zero manifest edits |
| Trust | a hand-forged `[from …]` message renders flagged |
| Rollback | one revertable merge per task; manifest `status`/history additive — absence ⇒ today's behavior |
