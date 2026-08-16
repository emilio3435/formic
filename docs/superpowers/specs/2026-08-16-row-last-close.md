# Spec: Board rows show last close, not the kickoff

Source issues: [#73](https://github.com/emilio3435/the-ant-hill/issues/73) (F2, this PR) + [#78](https://github.com/emilio3435/the-ant-hill/issues/78) (watch-only ring rider, same `renderAgentRow`).
Emilio approved 2026-08-16: every-row closing + muted kickoff; #78 rides; #74 stays a sibling PR; #69 parallel.
Verified against `47985f8` (`main` / live `:4701`) on 2026-08-16.

## Goal

When a session has spoken, the roster prints what it last said (or asked). The original kickoff stays visible as a quiet second line. An operator scanning Done / Needs-you does not have to open the drawer to learn the outcome.

Success means: a fixture with `task: "Port the rate limiter"` and `lastAgentClosing: "Should I land this now?"` paints the ask as the loud line and the kickoff muted beneath it. A fixture with no closing and no unclipped `lastAgentMessage` still paints the kickoff, as today.

Stop when: `rowSummary` + the second line are covered by failing-then-passing tests, headless row snapshots that pinned kickoff-as-primary are updated, and the drawer Chat path is unchanged.

## Why now

The board is the scan surface. After #67 import and overnight swarms, most live rows still quote the prompt they started with. That hides the only sentence that changes what you do next. #74 will retint states; without this, a green Done row still reads as the kickoff.

## Who

Emilio, scanning Formic. No other product consumer of `rowSummary`.

## Current state (verified)

`rowSummary` in `src/web/app.js:9002` prefers `agent.task` on purpose (row stability), then `formatLastHumanMessage`, then `statusReason`:

```
task (conciseText 120)
  else last-human-message
  else statusReason
  else "No readable message yet"
```

`renderAgentRow` (`:9330`, `:9518`) dumps that string into one span, `.row-summary.row-description`, also joined with `swarmNote`. Search (`:7802`) indexes the same function.

The server already publishes the fields this row should read:

| Field | Meaning | Source |
|---|---|---|
| `lastAgentClosing` | End-anchored, role-attributed last assistant words | `extractClosingByRole` in `src/server/human-message.ts:188` |
| `lastAgentMessage` | Front window of that last assistant message; often clipped with `…` | `extractLastMessageByRole` |
| `task` | Provider-recorded kickoff | collectors |

Attention already prefers closing over a clipped front window (`readableClosingText` in `src/server/attention-signal.ts:397`). The row does not. `nextAction` was deleted because it was the same sentence on 214/243 rows — do not revive it.

`lastAgentClosing` is already on the snapshot wire (`src/shared/types.ts:488`, `snapshot.ts` copies it). No server change required.

## Locked decisions

1. **Primary line** = `readableClosingText` semantics on the client: use `lastAgentClosing` when present and not machine-text; else `lastAgentMessage` only when it does not end in `…` and is not machine-text. Do not reimplement detectors. Import or copy the same clean/clip rules the tests already pin in `tests/machine-text-never-speaks.test.ts`.
2. **Every activity**, not only Done / Needs-you. A working row that has already asked still shows the ask. Kickoff-as-primary was the defect on those rows too.
3. **Kickoff is a muted second line** when it exists and is not byte-identical (case-fold, whitespace-collapse) to the primary. Class: `row-kickoff` (new, muted, one line, `conciseText(task, 120)`).
4. **No ask-classifier on the client.** If the closing is an ask, it is already primary. If it is "Done.", it is already primary. Attention pills stay in the drawer / strip.
5. **Search** indexes `primary + " " + kickoff` so a kickoff-only query still hits.
6. **Length:** primary `conciseText(..., 160)` so a short closing question is not cut at 88. Kickoff stays 120.
7. **Fallbacks** when no readable closing exists: keep today's chain (`task` → last human → `statusReason` → empty). No second line in that case (kickoff already is the primary).
8. **Drawer Chat is out of scope.** `renderChat` already dedupes task vs turns (`tests/web-client.test.ts:7503`). Do not change it.
9. **#78 rider:** stop calling `watchOnlyMark` for `key === "observed"`. Keep the filled red quarantined dot. Leave `controlState` on the wire, leave Send disabled when not `linked`, leave drawer copy. Do not treat observed-only as linked.
10. **Do not touch** `isLive`, dyes, Momentum, or pulse chips. That is #74.

## Acceptance

1. Fixture `{ task: "Port the limiter", lastAgentClosing: "Should I land this now?" }` → primary contains "Should I land", kickoff contains "Port the limiter".
2. Same fixture with `lastAgentClosing` absent and `lastAgentMessage: "Should I land this now?"` (no trailing `…`) → same paint.
3. `lastAgentMessage: "I reviewed the diff and…"` (clipped) and no closing → primary stays the kickoff. Never promote a clipped front window.
4. Machine-text closing (fixture from `machine-text-never-speaks`) → treated as absent.
5. No closing, no message, task present → one line, today's kickoff. No empty second line.
6. Closing === task (same words) → one line, no duplicate mute.
7. `rowSummary` used by search returns a string containing both primary and kickoff when both exist.
8. `renderChat` tests at `web-client.test.ts:7503` still pass unchanged.
9. Headless / row-diet snapshots that asserted kickoff-as-only-body are updated to the two-line contract; they still refuse `diff --git` and tool paths.
10. An observed-only live Grok row paints **no** hollow `.control-dot.is-observed`. A quarantined row still paints `.control-dot.is-quarantined`. Send stays disabled on observed-only.

## Testing

| Layer | What | Count |
|---|---|---|
| Unit (DOM) | `rowSummary` / paint: cases 1–7 | +6 |
| Existing | `provider-aware row summaries` still refuse transcript machinery | 0 new, keep |
| Existing | `renderChat` task dedupe | 0 new, keep |
| Headless | any snapshot of `.row-description` | update, do not delete |

No server tests. Collectors already emit the fields.

## Files

| File | Change |
|---|---|
| `src/web/app.js` `rowSummary` | new precedence; return primary for callers that want one string |
| `src/web/app.js` `renderAgentRow` / `watchOnlyMark` | two-line paint: `.row-summary` + optional `.row-kickoff`; skip observed-only ring |
| `src/web/app.js` search site `:7802` | index primary + kickoff |
| `src/web/styles.css` | `.row-kickoff` muted, one line, ellipsis |
| `src/web/presentation.js` | only if `conciseText` / a shared `readableClosingText` helper is extracted here rather than inlined |
| `tests/web-client.test.ts` | new cases; update snapshots that pin kickoff-as-primary |
| `tests/attention-reachability.test.ts` | if it asserts `rowSummary` text |

No new route. No cache-bust beyond the usual `ah-tXX` if CSS class is new (it is).

## Rollback

Revert the PR. Snapshot still carries `task` / `lastAgentClosing`. No data migration.

## Effort

~2h paint + helper, ~2h tests/snapshots, ~0.5h cache-bust + preview. One PR.

## Out of scope

- #74 operator states, `isLive`, Momentum magnify, pulse-chip omission
- #78 as a separate PR (it rides here)
- Reviving `nextAction`
- Changing collectors or `extractClosingByRole`
- Drawer Chat / inspector body
- New Provider keys

## Pairing (open GitHub board, 2026-08-16)

Open: #73, #74, #78, #71, #70, #69.

```
#73 row last-close     ──┐
#78 watch-only ring    ──┤  same function (renderAgentRow), both row-diet
                         │  pair in ONE PR if you want less rebase
#74 states / live /    ──┘  SAME files (app.js, styles.css) but different
    Momentum / chips        contract. Parallel PR, not the same commit.
                            Land either first; rebase the other.

#69 Grok Bot parser    ──  parallel, different layer (collector)
#70 extra Grok CLI     ──  parallel, different layer (collector)
#71 Muse / Antigravity ──  do not pair; new PROVIDERS epic
```

**Recommend:** ship #73 alone (this spec). Run #69 in the existing `grok-bot-parser` worktree at the same time. Do not fold #74 into this PR — it already says merge independently, and mixing dyes with copy will hide regressions. #78 is 10 lines in the same `renderAgentRow` name-line; optional rider, not required.

Do not wait on #74. Live/stalled retints do not change which string the row prints.
