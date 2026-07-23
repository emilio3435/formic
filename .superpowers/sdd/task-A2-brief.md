# Task A2: Body audit against the design language + review of Task A1 (pre-G0, Sonnet 5 1M, read-only)

**Files:**
- Create: `/Users/emilionunezgarcia/Developer/the-mountain-lanes/qa-baseline-20260722/AUDIT.md` (outside the repo; findings fold into tasks A3–A6)
- Read: `/Users/emilionunezgarcia/Developer/the-mountain-main/DESIGN-LANGUAGE.md` (Task A1's deliverable — the language + checklist you verify and deepen)
- Read: `/Users/emilionunezgarcia/Developer/anthill-pulse/src/web/styles.css`, `.../index.html`, `.../app.js` (the post-pulse FE — the base the restyle lanes will build on)
- Read for reference: `/Users/emilionunezgarcia/Developer/the-mountain-main/.superpowers/sdd/task-A1-brief.md` (A1's requirements) and `.../task-A1-report.md` (A1's self-review, open questions, and the "?" cell)

## Part 1 — Task review of A1 (required verdicts)

You are also the task reviewer for A1. After (not before) doing enough of Part 2 to have evidence, report two verdicts:
- **Spec compliance:** ✅/❌ — does DESIGN-LANGUAGE.md contain everything the A1 brief required (all named tokens with exact property names, the six rules named exactly, the 16-section × 6-rule checklist), and nothing beyond scope?
- **Quality:** Approved / Not approved — are the token names and values accurate against source (verify independently, do not trust A1's grep claims), are checklist cells defensible, is the doc usable as a test-target vocabulary?
List any defects as findings with severity (Critical/Important/Minor). Wrong token names or wrong rule names are Critical (later tests grep for them).

## Part 2 — The audit (the plan's Task A2)

With DESIGN-LANGUAGE.md + full `styles.css` + `index.html` + the render functions of `app.js` in context, fill/verify the conformance checklist. For every FAIL record: selector or function name, which of the six rules it breaks, and the concrete fix (e.g. "`.view-tab[aria-pressed=true]` uses a filled pill — replace with ink text + 2px bottom signal rail"). Order findings by styles.css section, and tag each finding **A3** (toolbar/views), **A4** (masthead/program headers), **A5** (empty state/toast/broadcast dock/usage tab), or **A6** (motion/responsive) so the implementing agents pick up scoped lists. Findings in sections outside those four tasks' scope (agent rows, inspector, vitals band, controls) go in a separate "WS-B/WS-C input" section — do not tag them A3–A6.

**Adjudicate A1's flagged judgment calls with evidence, and mark what remains genuinely ambiguous `ESCALATE` for the controller instead of guessing.** Known open items from A1: the pervasive mono micro-label idiom vs a strict reading of Rule 2 (note: the pulse reference itself uses it — a reading that fails the reference vocabulary is probably the wrong reading); the flood-fill boundary (≤10% edge-marked tints and filled action buttons judged pass); the usage-tab "?" cell (token/cost values in `--font-ui` tabular-nums rather than mono); non-token hexes (`#34302a` warm hover, literal `#b42318`).

## Global Constraints (binding, from BODY-RESTYLE-PLAN-2026-07-22.md)

- Strict CSP: never inline `style`; meters/colors via SVG attributes and classes.
- Light scheme only; no dark variant work.
- Mono (`--font-mono`) reserved for identifiers, paths, timestamps, token/cost values.
- Indicator inks, not flood fills; 2px left-edge signal rails (`--signal-rail`).
- Full-width bands align to `--frame: min(1680px, calc(100vw - 64px))`.
- Inspector `--inspector-w: clamp(480px, 32vw, 520px)` desktop; full-surface drawer <1024px; 44px touch targets <1024px.
- `prefers-reduced-motion` disables every animation.
- No feature flags for visible UI.

## Hard boundaries

- Read-only everywhere except the one file you create (`AUDIT.md`). The pulse worktree has live agents — never write there, never run git state-changing commands anywhere.
- Useful context: the 16 body sections of `styles.css` are byte-identical between main and the pulse worktree except `responsive` (A1 verified), so your audit of the pulse copy transfers to main. The pulse FE implementation phase is complete (its workflow is in test/verify), but if you see a file visibly mid-edit (mtime racing, truncated content), note it and audit around it rather than failing.

## Report

Write AUDIT.md as the deliverable. Then report back with ONLY (under 15 lines):
- **A1 spec compliance:** ✅/❌ (+ one line why, defects listed by severity if ❌)
- **A1 quality:** Approved / Not approved
- Finding counts per tag (A3/A4/A5/A6/WS-B/WS-C input) + count of ESCALATE items
- The AUDIT.md path
- Any concerns