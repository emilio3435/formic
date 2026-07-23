# Signal surface hybrid — implementation plan

**Visual north star (pixel target):** [`signal-surface-hybrid.html`](./signal-surface-hybrid.html)  
**Recipe:** #3 two-lane chassis + #4 inbox-dense progress rows + #2 conductor score that collapses to full-green all-clear.  
**Worktree:** `luna-ops-canvas-reconciled` · branch `ant-hill/luna-ops-canvas-reconciled-20260722`  
**Do not touch:** other `luna-*` lanes; live Mountain v2 (`~/mountain`, port 4700).

---

## Model lanes (as requested)

| Lane | Owner model | Effort | Owns |
|---|---|---|---|
| **Frontend** | **Opus 4.8** | HIGH | `src/web/*`, web-client tests, visual match to hybrid mockup |
| **Backend** | **GPT Terra xhigh** | XHIGH | `src/shared/types.ts`, snapshot/triage/state, server tests, any rollup fields the UI needs |

### Launch commands (native CLIs — keep provider identity auditable)

```bash
# Frontend — Opus 4.8 (Claude)
claude --model opus-4.8 --effort high --permission-mode auto
# If opus-4.8 slug differs on this machine, use the newest Opus 4.x available and note the exact id in the PR.

# Backend — GPT Terra xhigh (Codex)
codex --model gpt-terra -c model_reasoning_effort="xhigh"
# Stack alias if terra slug is gpt-5.6-sol on this machine:
# codex --model gpt-5.6-sol -c model_reasoning_effort="xhigh"
```

**Handoff rule:** Backend lands contracts + tests first (or in parallel behind a feature flag). Frontend consumes stable shapes only — no inventing snapshot fields client-side when the server can own them.

**Stop when:** hybrid mockup and live UI match at 1440×900 and 390×844 for both *stressed* and *all-clear*; `bun run check` green; no Subdue/ticket-marquee chrome remains.

---

## Product contract (what “just like the mockup” means)

### Always on: Conductor score
- Thin proportional strip above the lanes: **Act now / Watch / In motion / Cleared**.
- Segment widths reflect counts (CSS `grid-template-columns` from counts; no inline style attributes — use CSS variables set via classes or `svg`/attribute patterns consistent with existing CSP).
- Zero-count segments stay visible but subdued (mockup `.seg.zero`).
- **All-clear:** when Act+Watch+In motion are all 0, strip collapses to a single full-moss banner:  
  `All clear · nothing needs you`  
  and the two lanes are replaced by the calm “Colony is clear” panel.

### Two lanes
| Lane | Contents |
|---|---|
| **Act now** | Severity `error` interventions still open (not resolved) |
| **Be aware** | Advisories + in-motion triage/investigations that aren’t act-now + recently cleared |

### Inbox-dense rows (each finding)
Columns (desktop):
1. Mono **glyph** (act / warn / run / ok)
2. **State** label (Needs triage · Watching · Plan ready · Queued · Investigating · Verifying · Cleared · Blocked)
3. **Title** + one-line **impact** (plain language — never `Affects (160)`)
4. **Progress rail** (0–100 visual of triage/investigation progress)

Rules:
- Click row → existing drawer (`selectEntity`)
- **No** Generate triage / Escalate buttons on the board — drawer only
- Pin “Needs triage” act-now rows (subtle ember wash)
- Max visible rows per lane: **5**, then `+N more` that switches view or expands (frontend choice; prefer expand-in-lane over new route)

### Impact copy (shared helper)
- `0` ids → `System-wide — not tied to a specific agent`
- `1` → `Touches 1 session: {name} ({program})`
- `N` → `Touches N sessions across P programs — mainly {top1}, {top2}`
- Sample list only inside the drawer Impact block (existing `affectedImpact` / `impactBlock` direction — keep/refine)

### Work state (single vocabulary)
Priority order (already sketched in `issueWorkState` — stabilize + share with server if needed):

1. triagePending → **Triaging**
2. queue running → **Investigating**
3. queue queued → **Queued**
4. triage plan present → **Plan ready**
5. queue/lifecycle verifying → **Verifying**
6. blocked → **Blocked**
7. resolved / recentlyResolved → **Cleared**
8. severity error else → **Needs triage**
9. advisory default → **Watching**

### Explicit non-goals
- No marquee / ticket ticker / Subdue chrome
- No hospital filled amber/red banners
- No dumping hundreds of affected chips on the board
- No dark-mode flip; keep light techno-orchestra graphite

---

## Backend plan (GPT Terra xhigh)

### B1 — Attention rollup on the snapshot
Add an additive rollup so the conductor doesn’t re-derive inconsistently across clients.

Suggested shape on `HubSnapshot` (names flexible; keep additive):

```ts
attentionBoard?: {
  actNow: number;      // open error-severity issues
  watch: number;       // open non-error issues not in motion
  inMotion: number;    // plan ready | queued | investigating | verifying | triaging
  cleared: number;     // recentlyResolved length (TTL window)
  allClear: boolean;   // actNow + watch + inMotion === 0
};
```

Wire in `snapshot.ts` / `state.ts` using existing `issues`, `recentlyResolved`, and triage queue state available to the snapshot builder. If queue state isn’t in the snapshot today, either:
- include a compact `triageSummaries: { issueId, state }[]` on the snapshot, **or**
- document that `inMotion` is computed client-side from `/api/triage/queue` until B1 lands — prefer server ownership.

### B2 — Finding view-model fields (optional but preferred)
Per issue (or parallel array), additive:

```ts
workState?: "needs_triage" | "watching" | "triaging" | "planned" | "queued"
  | "investigating" | "verifying" | "blocked" | "cleared";
progress?: number; // 0–100
impactSummary?: string; // plain-language one-liner
```

Progress mapping (normative):
| State | progress |
|---|---|
| needs_triage / watching | 0 |
| triaging | 15 |
| planned | 35 |
| queued | 50 |
| investigating | 70 |
| verifying | 85 |
| blocked | 70 (rail stays slate/ember via state, not %) |
| cleared | 100 |

### B3 — Tests
- Snapshot: stressed colony → correct board counts
- Snapshot: no issues + empty queue → `allClear: true`, cleared may be >0 inside TTL
- Lifecycle: resolved issues leave `actNow` and appear in cleared window
- Impact summary unit tests for 0 / 1 / N agents
- No break to existing triage generate/queue/run contracts

### B4 — Deliverables back to frontend
Short contract note in this file’s appendix or PR body:
- exact field names
- when `attentionBoard` is absent (old server) → frontend fallback derivation

**Backend stop:** `bun test` server/snapshot/triage suites green; types exported; no web UI edits.

---

## Frontend plan (Opus 4.8)

### F0 — Visual lock
Open [`signal-surface-hybrid.html`](./signal-surface-hybrid.html) side-by-side while implementing. Match:
- conductor height/padding/segment typography
- lane chrome (radius, head border, empty clear panel)
- row grid, state type, impact truncation, rail thickness
- stressed ↔ all-clear transition behavior
- fonts: prefer already-loaded stack fonts if Syne/IBM Plex aren’t in the app; **do not** invent a third visual system — map mockup Syne → existing `--font-display` / mono → `--font-mono`, or add the mockup fonts once in `index.html` if CSP `style-src`/`font-src` allows (self-host if needed)

### F1 — Rip out superseded signal chrome
Remove / stop rendering:
- ticket ticker mounts (`#interventions-ticker`, `#warnings-ticker`, `buildSignalTicker`, marquee CSS)
- Subdue/compact panel preferences (`mtn3-signal-panels*`) unless reused for lane collapse later (default: delete)
- full-width intervention “Generate triage” band as the primary surface

Keep drawer triage flows intact.

### F2 — Markup chassis (`index.html`)
Replace interventions/warnings sections with:

```
#region attention-board
  .conductor > .score (4 segs + clear banner)
  .lanes
    % Act now
    % Be aware
  .allclear (hidden unless allClear)
```

Place **above** the workboard split (same slot as today’s signal band — full frame width).

### F3 — Render pipeline (`app.js`)
- `renderAttentionBoard(snap)`:
  - derive or read `attentionBoard`
  - set conductor segment counts + column template (CSP-safe)
  - toggle `body`/`board` class `is-all-clear`
  - fill Act / Aware lists via `renderFindingRow(finding)`
- `renderFindingRow`: glyph, state, title, impact, rail; `onclick → selectEntity`
- Reuse/refine `issueWorkState`, `affectedImpact` — prefer server fields when present
- Wire into existing `render()` / SSE refresh; preserve fkey focus restore

### F4 — CSS (`styles.css`)
Port hybrid mockup rules into the app under a clear namespace (`.attn-*` or keep `.conductor` / `.lanes` / `.finding` as in mockup).  
Delete dead `.signal-ticker*` / old hospital fills for these surfaces.  
Respect `prefers-reduced-motion` (no reliance on marquee; optional 120–180ms fade on all-clear swap only).

### F5 — Drawer alignment
- Keep Impact block (plain language + program chips + sample disclosure)
- Keep work-state banner
- Board rows must not duplicate drawer CTAs

### F6 — Tests (`tests/web-client.test.ts`)
Replace ticker/Subdue assertions with:
- conductor + lanes + allclear markup anchors exist
- all-clear class/logic when counts are zero
- finding row contains state + impact + no board-level `Generate triage`
- CSP: no inline `style:` props in app.js (use classes / CSS variables on elements via attributes already allowed — if setting `--cols`, prefer class map or `setProperty` on a stylesheet-owned node only if existing code already does equivalent; otherwise class presets for N counts)
- reduced-motion still disables transitions you add

### F7 — Visual QA checklist
- [ ] 1440×900 stressed matches mockup structure
- [ ] 1440×900 all-clear = full green conductor + colony clear panel
- [ ] 390×844 lanes stack; rails may hide; rows still tappable (44px target)
- [ ] Click row opens correct drawer kind
- [ ] Clearing last act-now/watch/motion finding flips to all-clear without full page flash

**Frontend stop:** mockup parity + web-client tests green + no ticker/Subdue left.

---

## Sequence

```
1) Backend B1–B3 (Terra)     ──┐
2) Frontend F0–F1 scaffold   ──┤ parallel OK after contract sketch
3) Frontend F2–F4 UI         ──┘ consumes attentionBoard with fallback
4) Frontend F5–F7 + Backend B4 contract freeze
5) Dual smoke on :4702 (reconciled only)
```

### Parallelism / file locks
| Agent | Allowed | Forbidden |
|---|---|---|
| Terra | `src/server/**`, `src/shared/**`, `tests/snapshot*.ts`, `tests/**/triage*` | `src/web/**` |
| Opus | `src/web/**`, `tests/web-client.test.ts`, mockup HTML reference | snapshot collectors, triage runner semantics |

If both must touch `types.ts`, **Terra goes first**.

---

## Acceptance criteria

1. Live UI matches [`signal-surface-hybrid.html`](./signal-surface-hybrid.html) for stressed + all-clear (structure, hierarchy, green signal).
2. Conductor never disappears; all-clear is unmistakable full-moss.
3. No `Affects (N)` dumps on the board; impact is plain language.
4. Work state visible on every row; progress rail reflects triage/investigation.
5. Triage actions only in drawer.
6. `bun run check` green.
7. Other agents’ unrelated server work (burnbar/settings/etc.) left untouched unless it blocks compile — then minimal fix only.

---

## Appendix — current code touchpoints

| Area | Files |
|---|---|
| Signal render | `src/web/app.js` (`renderIssues`, ticker helpers, `issueWorkState`, drawers) |
| Signal chrome | `src/web/index.html`, `src/web/styles.css` |
| Lifecycle / resolved TTL | `src/server/snapshot.ts` (`lifecycleIssues`, `RECENTLY_RESOLVED_TTL_MS`) |
| Triage queue | `src/server/triage.ts`, `/api/triage/*` |
| Types | `src/shared/types.ts` |
| Mockup | `signal-surface-hybrid.html` |

---

## Prompt blurb (paste to each lane)

**Terra:**  
> Implement Backend B1–B4 in `luna-ops-canvas-reconciled` per `SIGNAL-SURFACE-HYBRID-PLAN.md`. Additive snapshot rollup + tests only. Do not edit `src/web/**`. Stop when server tests green and contract is written for Opus.

**Opus:**  
> Implement Frontend F0–F7 in `luna-ops-canvas-reconciled` per `SIGNAL-SURFACE-HYBRID-PLAN.md`. Pixel-target `signal-surface-hybrid.html`. Rip ticker/Subdue. Build conductor + two inbox lanes + all-clear. Drawer keeps triage. Stop when web-client tests green and stressed/all-clear match the mockup.
