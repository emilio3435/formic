# Harden-notify lane state — handoff

**Branch:** `fix/cmux-control-health-lifecycle`  
**Program:** `docs/superpowers/plans/2026-08-05-confidence-header-and-notification-center.md`  
**Lane fence:** `docs/LANE-HARDEN-NOTIFY.md`  
**Last harden-notify commits:** `12b6db7` (CI hermeticity), `99cac4b` (board-never-deletes + docs parity), `74b2b69` (cleanup sweep), `b0bc577` (attention/promotion fixtures).

Territory (sole writer): `tests/fixtures/**` (except process-liveness), `scripts/**`, `docs/**` for ANT-GUIDE / DESIGN-LANGUAGE parity. Do **not** edit `src/web/**`, `src/server/**`, or `tests/web-client.test.ts`.

---

## CI hermeticity (done)

`origin/main` runs `bun run test:ci` → `scripts/ci-tests.sh`, which runs every `tests/*.test.ts` **except** a named `LOCAL_ONLY` list. Anything we add runs on a fresh macOS runner by default.

| File | LOCAL_ONLY? | Proof |
|---|---|---|
| `tests/cleanup-sweep.test.ts` | **No — keep in CI** | Temp repos under `SCRATCH` only; stubbed `SweepHost` (never production host factory); git env forces `HOME=SCRATCH` + null global config; refuses git cwd outside SCRATCH. |
| `tests/harden-notify-fixtures.test.ts` | **No — keep in CI** | In-repo fixtures/docs via `import.meta.dir` only; pure detectors + client modules; no home, localhost, or live git. |

**How proved:**  
`env -i HOME=<empty temp> PATH=… TMPDIR=…` with `cwd` outside this repo →  
`bun test tests/cleanup-sweep.test.ts tests/harden-notify-fixtures.test.ts` → **77 pass / 0 fail**; empty HOME stayed empty (no `~/.cmuxterm`, no `~/.anthill`).

**No file owned by this lane belongs on `LOCAL_ONLY`.** If a future test needs live board / `~/.cmuxterm` / real worktrees, add it to that list in `scripts/ci-tests.sh` with a comment naming the machine evidence — do not skip inside the file.

---

## What already shipped (do not redo)

- Golden fixture per `AttentionSignalKind` + blocked/noticed matrix + §4.3 promotion table + truth-safety (standby absent; heartbeat-churn as regression guard only) + parked-then-asks + S5-T1 history routes — `tests/fixtures/*`, locked by `tests/harden-notify-fixtures.test.ts`.
- S0-T1 ruling baked in: `blockedSince` may never arrive; do not require `standbyMs` or a dead-time hero.
- Cleanup sweep S6-T1/T2: `scripts/anthill-cleanup-sweep.ts` — propose/report + confirm with `-d` only.
- **THE BOARD NEVER DELETES:** chip runs `propose` only; `confirm` is terminal paste. Contract + JSON shape for fe-notify: `docs/CLEANUP-SWEEP.md`.
- ANT-GUIDE / DESIGN-LANGUAGE: handoff / dataflow / investigation, blocking vs noticed, ember-means-a-person.

---

## Still outstanding

1. **A11y sweep** — held until fe-notify S1 merges. Focus order, accessible names, touch/hover divergence, gauge accessible name enumerating every reading. **Do not start this until a fresh lane is spawned for it**, even if S1 lands meanwhile.
2. **Docs parity with be-dwell wire fields** — when `attentionClass` / related unions land on the wire, update ANT-GUIDE / DESIGN-LANGUAGE **in the same commit** as those types (lane rule).
3. **S6-T3/T4 UI** — fe-notify owns chip spinner + dataflow item rendering against `docs/CLEANUP-SWEEP.md`; harden-notify does not wire confirm to any route.

Shared worktree: path-scoped `git add` only; re-check `git branch --show-current` before every git action; never `git add -A`.
