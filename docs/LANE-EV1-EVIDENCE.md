# Lane EV-1 — evidence, census, and ledger (read-only)

You are lane EV-1 in a multi-lane swarm executing
`docs/superpowers/plans/2026-08-05-unified-filtering.md` (read §1, §2, §6,
and Tasks 1.2b / 2.0 / 4.3 / 4.4 for full context). Your lane is
**enumerate-and-report only**: you never edit repository source, never change
any config, never run git commit. Your deliverable is one report file.

## Deliverable

Write findings to `docs/LANE-EV1-REPORT.md` (leave it untracked). Scratch
scripts go in `/tmp/ev1/`, never in the repo. Label every number with the
command that produced it. Use `confirmed` / `inferred` / `unknown` labels.

## Your items, in order

1. **Launch-marker catalogue (plan Task 1.2b, Step 1).** For codex: compare
   one real `codex exec` (headless) session file against one interactive TUI
   session under `~/.codex/sessions/**` — diff the session_meta/header fields
   (candidates: `originator`, `source`). For cursor: compare a background
   composer transcript against an interactive one under `~/.cursor/chats/**`.
   Report: exact field names, exact values per launch mode, and whether the
   modes are deterministically distinguishable. If no recorded marker exists
   for a provider, the sentence "no recorded marker; kind stays
   pattern/unknown for this provider" IS the deliverable.
2. **Cross-project-dir census (plan Task 2.0, D1 gate).** For every
   `~/.claude/projects/*/` dir: count transcripts, count
   `"entrypoint":"sdk-py"` transcripts, and among those count how many carry
   a known review prompt (task starts with "Review this change for security
   vulnerabilit" or "Review the pushed/staged …"). The question this answers:
   does material NON-review sdk-py automation exist that an automation-kind
   Board gate would also hide? Summarize per-dir and in total.
3. **Yield ledger (plan Task 4.3).** Find every `sg-reviewed-shas` state file
   (start from the security-guidance plugin's state dir convention —
   `_base.py:33` in `~/.claude/plugins/cache/claude-plugins-official/security-guidance/2.0.6/hooks/`
   shows where state lives). Per repo root: reviews recorded vs entries with
   `vulns_found > 0`. Also: duplicate-SHA count across worktree roots of one
   multi-worktree repo (cooper-scheduler is the natural sample). If a
   BurnBar per-session join is not reachable from files, mark the dollar
   figure `unknown` — do not estimate.
4. **Stop-trim switch hunt (plan Task 4.4, Step 1).** Read
   `security-guidance/2.0.6/hooks/extensibility.py` and the plugin README.
   Report whether a supported config/env exists that scopes the LLM review
   to commit/push only (dropping the per-Stop review). Quote the exact
   mechanism if found. Do NOT set it, do NOT edit any hooks.json or env —
   report only.

## Hard boundaries

- Read-only everywhere: no file writes outside `docs/LANE-EV1-REPORT.md` and
  `/tmp/ev1/`. No git commits, no config changes, no plugin-cache edits.
- Reading other repos' state files is fine; modifying anything is not.

## Status protocol

Append one line to `docs/LANE-EV1-STATUS.md` after each item:

```
[HH:MM] ITEM1 DONE
[HH:MM] ITEM3 BLOCKED <one-line reason>
```

Finish line: `[HH:MM] LANE DONE`.
