# DRAFT — upstream issue for anthropics/claude-plugins-official (security-guidance)

> Status: awaiting Emilio's approval before posting (plan Task 4.5, D4 ruling).
> Target repo: `anthropics/claude-plugins-official`, plugin `security-guidance` (observed v2.0.6).
> Not posted anywhere. Publication is Emilio's action or explicitly delegated.

---

**Title:** security-guidance: stamp review sessions with the parent session id so fleet dashboards can group them

**Body:**

We run a multi-agent setup (5–10 concurrent Claude Code lanes against shared
worktrees) with the security-guidance plugin enabled machine-wide. It works as
designed — but at fleet scale the review sessions it spawns become a
visibility problem for session dashboards, and one small addition would fix
it.

**What we observe (censused 2026-08-05, one machine):**

- 651 of 823 transcripts across `~/.claude/projects/*/` are plugin-spawned
  review sessions (`entrypoint: "sdk-py"`, review prompt). One burst day
  produced 221.
- Summed `sessionTotal` consumption for the review population visible on our
  dashboard: ~33M tokens (~145M processed) on `claude-opus-4-7`.
- Every one of these transcripts is a top-level session file with **no
  recorded link to the session whose Stop/commit hook spawned it** — no
  `parentUuid`, no sidechain marker, nothing.

**The ask: stamp the child with its parent.**

The hook process knows the triggering session id (its own state files are
keyed by it). Recording it in the spawned SDK session — an extra field on the
transcript envelope, or an `extraArgs`/env passthrough the Agent SDK already
supports — would let dashboards group each review under the lane that
triggered it instead of showing hundreds of orphan peers. Today the only
alternative is cwd+timestamp correlation, which is guesswork we do not want
to present as lineage.

**Two smaller notes, take or leave:**

1. `ENABLE_STOP_REVIEW=0` was exactly what we needed to scope reviews to
   commit/push in the multi-lane setup — thanks for shipping a supported
   switch. Consider surfacing it more prominently in the README's
   multi-agent section; we found it only by reading
   `security_reminder_hook.py`.
2. The `sg-reviewed-shas` ledger lives in the git *common* dir, so linked
   worktrees dedupe correctly — nice. Separate clones of the same repo still
   re-review the same SHAs; `SECURITY_WARNINGS_STATE_DIR` exists but is
   all-or-nothing per environment. A per-repo (remote-keyed) state option
   would close that gap for clone-heavy setups. Low priority.

---

> Evidence file references (local, for our records, not for the issue):
> `docs/LANE-EV1-REPORT.md`; plan §1–§2 in
> `docs/superpowers/plans/2026-08-05-unified-filtering.md`.
