# Health Rail v2 — Fleet TL;DR Tile Fold-In (Design Spec)

**Date:** 2026-08-09
**Status:** Approved 2026-08-09 (Emilio). Implementation plan: `docs/superpowers/plans/2026-08-09-health-rail-tldr-v2-implementation.md`.
**Mockup (authoritative visual):** `docs/rhs-shots/health-rail-tldr-fold-in/mockup-v2.html`
(rendered evidence: 1440×1200 and 860×1400 headless Chrome, deterministic in-page checks `data-check="pass"`)
**Supersedes:** the two-column direction in `docs/superpowers/plans/2026-08-09-health-rail-tldr-fold-in.md` and mockup.html at `4faf452` (columns were readings-left; v2 swaps them and de-duplicates the repo tile).

## Goal

Fold the standalone `section#heartbeat-tldr` panel into `section#health-rail` as a
rich Cluster TL;DR tile that shares one shallow ribbon row with the condensed
deterministic readings — TL;DR left (60%), readings right (40%) — with chevrons
paging the tile's content between an ALL fleet synthesis and per-repo detail.

## Layout contract

- `div#health-widgets.rail-inner` owns **exactly two direct children**, in order:
  1. `div.health-tldr-lane` — ~60% width, left. Signal rail (`--signal-rail` 2px)
     on its left edge at the band edge: moss ok / ember needs-you — same language
     as `.tldr-card::before` and `.heartbeat-tldr`'s border-left.
  2. `div.readings-stack` — ~40% width, right, separated by a `--line-strong`
     hairline. Owns a `stack-head` (the folded-in `.rail-header` children:
     `Summary` heading, `#scan-window`, `#customize-summary`) above a 2×2
     readings grid.
- One shallow row: `min-height: 118px` desktop (buys a 3-line prose clamp),
  112px at ≤900px. No separate full-width header row above the columns.
- Both columns share top within 1px; ratios 56–64% / 36–44%; no blank column.
- Breakpoints: two columns hold at 1440 **and** 860. Only below 640px do the
  columns stack (lane above readings), which is outside the ribbon contract and
  exists as an explicit fallback.
- `#widget-customizer` stays a sibling of `#health-widgets` inside
  `#health-rail`, unchanged. The lane is **never** inserted between them.
- `section#heartbeat-tldr` (index.html:108–119) is removed, along with its
  standalone-panel CSS (`.heartbeat-tldr` container rules; card-family rules are
  reused, see below).

## States

**A — ALL (default).** Lane head: native `.heartbeat-tldr-label` TL;DR pill,
mono time, meta (`3 repos · 8 live · 1 needs you`), pager at right
(`‹ ALL ›`). Body: **one synthesized fleet paragraph** (13.5px/1.5, 3-line
clamp) telling the cross-repo story. Footer: per-repo status chip strip
(colored dot + repo name; overflow chip `+N quiet`).

**B — repo-specific.** Chevron pages to repo _k_ of _N_. Lane head: TL;DR pill,
repo name (`.tldr-card-repo`), signal pill (`.tldr-card-signal`), meta, pager
(`‹ k / N ›`). Body: repo prose — cause → blocker → next unblock. Footer: a
deterministic fact row from `deterministicRepoStats()` (app.js:3938):
blocker chip with age (`.tldr-card-blocker.is-alert`), branch, head sha, dirty,
PR count, roster split (`2 working · 1 blocked`) as `.tldr-det-pill`s. Sha and
roster pills carry `.is-secondary` and drop at ≤900px instead of clipping.
**Non-redundancy rule:** momentum/burn/context numbers never appear in the
lane — they live only in the readings column.

Meanwhile the readings column **re-scopes to the repo**: a mono `scope-pill`
with the repo name appears in the stack-head, and Health/Momentum/Burn/Context
show repo-scoped values with `this repo` subcopy. (Open point for the plan:
repo-scoped Momentum/Context derive from `program.agents`; repo-scoped Burn
depends on OBB attributing invocations per session/repo — if unavailable,
Burn shows `—` with `fleet-wide only` subcopy rather than a fabricated split.)

**C — no summaries.** When `parseHeartbeatStructured` yields no envelope
(`repos:[]` / no heartbeat agent): lane absent (hidden), no placeholder,
readings-stack spans the band as the native 4-across row at 84px.

**D — customized readings.** Two new widget options in the existing customizer
(rendered via `summaryWidgetData`/`pulseStripModel` like any widget):
- **Mix** — sessions by provider as colored square marks + counts using existing
  provider tokens (`--claude/--codex/--cursor/--omp`, slate for prime), subline
  of top models from `modelConfig.displayLabels`. No external logos: CSP
  forbids remote assets; rail doctrine is status by shape+label+color.
  Provider names hide at ≤900px (dots + counts only).
- **Spend** — OBB window cost total: `costUsd` or the `§` floor when
  `costKnown` is false, with provenance subcopy (`3/4 measured`) and $/hr.

## Interaction

- **Chevrons are the pager** (`‹ ›` replace the lane's content; they never add
  a row or move the tile). Order is **attention-sorted**: from ALL, `›` lands on
  the highest-attention repo first (needs-you > blocked/failed > working > idle,
  then by live count), not alphabetical.
- **Repo chips are jump targets**: clicking a chip in the ALL strip goes
  straight to that repo's view. Chevrons remain for sequential paging.
- **No view yanking**: if a repo goes needs-you while the operator is parked on
  another view, the view does not change; the alert surfaces via the chip color
  in ALL, the meta count, and the lane signal rail on that repo's own view.
- **Selected view persists** (localStorage, alongside widget prefs): repaints
  from `renderHealthRail`'s signature changes and full reloads restore the
  selected repo view; a persisted repo that no longer exists falls back to ALL.
- **Staleness is visible**: heartbeat cadence is ~3m. Past ~2 missed beats
  (>6–7m), the lane time goes `.is-frozen` (existing dotted-ember pattern) and
  the signal rail greys to `--line-strong`; deterministic readings stay live.
  The stale lane still renders its last story — marked stale, never silently
  current.
- Deferred (explicitly out of scope for v2): arrow-key pager navigation and
  richer SR announcement choreography beyond what exists.

## Accessibility

- Lane is `role=group` with a state-specific `aria-label`. The pager position
  (`lane-pos`) is the single `aria-live=polite` region for view changes —
  it does not compete with the visually-hidden `#cleanup-status` region.
- Chip strip is `role=list` of `listitem`s; chips become buttons (jump targets)
  with visible focus.
- Chevron hit area ≥34px at ≤900px.
- Context gauge SVG keeps `role=progressbar` + attributes (SVG attrs only, CSP).

## Data & writer contract

**Envelope v4** (heartbeat writer, `prime:ant-heartbeat-monitor`):

```
[TL;DR HH:MM] {"v":4,"fleet":"…","repos":[{"repo":"…","summary":"…","blocker":"…","signal":"ok|working|idle|needs-you|blocked|failed|all-clear"}]}
```

- `fleet` is new — the ALL-state synthesis. `parseHeartbeatStructured`
  (app.js:3869) gains v4 handling: `fleet` string surfaced alongside `repos`;
  v3 envelopes (no `fleet`) still parse, and the ALL state then falls back to a
  deterministic fleet line composed client-side (counts + top repo), so old
  writers degrade gracefully.
- **Wire cap raised for the heartbeat monitor**: `MAX_TRANSCRIPT_TAIL_CHARS`
  stays 800 globally (types.ts:16), but the heartbeat agent's tail keeps a
  generous backstop (~6000 chars) at the collection site (prime.ts:100).
  Rationale: truncation is `slice(-N)` — keeps the tail end — so an oversized
  envelope loses its `[TL;DR …] {"v":4,"fleet":` head and fails parse entirely,
  which is the worst failure mode. Length is governed by writer guidance, not
  the wire.
- **Writer guidance (prompt, not hard caps)**: fleet reads well at 2–3
  sentences (renders into a 3-line clamp); repo summaries at 2–4 sentences;
  `blocker` ≤48 chars (parser slices). Content rules: `fleet` tells who needs
  the operator, why, and what unblocks it; `repos[].summary` narrates
  cause → blocker → next action; **never restate momentum/burn/context** — the
  readings column renders those deterministically. The heartbeat instruction
  (`.prime/agent/skills/ant-hill-orchestrator/references/heartbeat-tldr.md` and
  `ant-hill-heartbeat-fallback.sh`) is updated to carry this contract.
- **Mini-markup, not HTML**: writer emits `*strong*`, `` `mono` ``, `!alert!`.
  The client renders these to `<strong>`, `.mono`, `.is-alert` spans via a
  deterministic allowlist tokenizer (text nodes + createElement — no innerHTML
  of transcript content; transcripts are untrusted input and the XSS boundary
  holds).
- Overflow behavior: prose renders with a 3-line clamp; a long summary is
  clamped, never rejected. When no envelope parses at all, state C applies
  (the deterministic-finisher fallback path is unchanged).

## Rendering architecture

- `renderHealthRail()` (app.js:3746) keeps ownership of `#health-widgets` and
  builds the two-child structure: it renders the readings into
  `.readings-stack`'s grid and calls `renderHealthTldrLane()` to fill
  `.health-tldr-lane` — both inside `.rail-inner`, after `renderScanWindow()`.
  `renderHeartbeatTldr()`'s standalone-panel duties are absorbed;
  `heartbeatTldrAgent`, `parseHeartbeatStructured`, `programForTldrRepo`,
  `deterministicRepoStats`, `tldrCardSignalClass` are reused as-is (plus v4).
- The lane's paint signature includes: parsed envelope hash, selected view,
  staleness bucket, and attention ordering — so chevron paging and staleness
  transitions repaint without a widget-value change (the CLEAN-1 lesson).
- Readings re-scope derivation runs from the selected program's agents;
  fleet scope remains the default path (state A/C/D).
- CSS reuses the existing card family (`.tldr-card-signal`, `.tldr-det-pill`,
  `.tldr-card-blocker`, `.heartbeat-tldr-label`) and readings family
  (`.reading*`, `.rail-heading`, `.scan-window`, `.rail-action`,
  `.context-toggle`, `.spread-toggle`, gauge rules). New selectors:
  `.health-tldr-lane`, `.tldr-lane-head/-meta/-prose/-det`, `.tldr-chip*`,
  `.lane-pager/.lane-pos/.chev`, `.readings-stack/.stack-head/.readings-grid`,
  `.scope-pill`, `.mix-row/.mix-seg/.prov-dot`.

## Testing

- DOM contract: `.rail-inner` two-child order, 60/40 ratios, shared top,
  no blank column at 1440 and 860 (mirrors the mockup's in-page checks) in
  `tests/web-client.test.ts` / the a11y-geometry style of assertion.
- Parser: v4 with `fleet`; v3 without `fleet` (graceful ALL fallback); legacy
  pipe format; truncated-envelope head-loss case.
- Mini-markup renderer: allowlist only — script/HTML injection attempts render
  as literal text (behavior test, not implementation detail).
- Persistence: selected repo survives repaint + reload; vanished repo → ALL.
- Attention ordering: needs-you repo is first `›` target.
- Staleness: stamp goes `.is-frozen` and rail greys past the threshold.
- Non-redundancy: repo view's lane contains no momentum/burn/context values.
- Wire cap: heartbeat agent tail preserves an envelope >800 chars end-to-end.

## Out of scope

- Keyboard pager navigation / extended SR choreography (deferred by Emilio).
- Repo-scoped Burn attribution work beyond the honest `—` fallback.
- Any change to the widget customizer mechanics beyond registering Mix/Spend.
- `<640px` visual polish beyond the documented stack fallback.
