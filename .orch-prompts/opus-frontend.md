# Frontend lane — Signal surface hybrid (F0–F7)

You are the **frontend implementer** for The Ant Hill hybrid signal surface.

## Scope
Work ONLY in: `/Users/emilionunezgarcia/Developer/the-mountain-lanes/luna-ops-canvas-reconciled`
Branch: `ant-hill/luna-ops-canvas-reconciled-20260722`

**Allowed:** `src/web/**`, `tests/web-client.test.ts`
**Forbidden:** `src/server/**` collectors/triage semantics (consume types only), other `luna-*` lanes, commits/pushes

## Spec
Read and follow exactly:
- `SIGNAL-SURFACE-HYBRID-PLAN.md` → section **Frontend plan (Opus 4.8)** (F0–F7)
- **Pixel target:** `signal-surface-hybrid.html` (open it; match stressed + all-clear)

## Recipe
#3 two-lane chassis + #4 inbox-dense progress rows + #2 conductor that collapses to full-green all-clear.

## Rules
- Rip ticket ticker / Subdue / marquee chrome
- No Generate triage on the board (drawer only)
- No `Affects (N)` dumps — plain-language impact
- Consume `attentionBoard` / `workState` / `progress` / `impactSummary` when present; **client fallback derivation** if backend fields absent yet
- CSP: no inline `style:` props in app.js
- Preserve drawer triage + selectEntity

## Stop when
web-client tests green; stressed + all-clear match the mockup structurally; ticker/Subdue gone.

Do not commit. Do not push. Report files touched + test results.
