# Lane kickoff — a11y-sweep (Opus 5 xhigh)

**Program:** `docs/superpowers/plans/2026-08-05-confidence-header-and-notification-center.md`. Read §7 (live verification) and §6 (claims-first tests) before anything else. §10 carries live status and the rulings.

**Worktree:** `/Users/emilionunezgarcia/Developer/the-mountain-main`, branch `fix/cmux-control-health-lifecycle`. **Shared — three other agents are writing to it.** Re-run `git branch --show-current` before any git action.

**Routing exception, stated on purpose:** hardening normally runs on Grok 4.5 High Fast. This lane is Claude because the job needs live browser and AX-tree verification through the `/browse` skill, which cursor-agent cannot run. The exception is the browser requirement, nothing else.

---

## Commit form — this bit is not optional

```
git commit -F - -- <explicit paths>
```

**Never `git add <paths> && git commit`.** Path-scoped `add` is not path-scoped `commit`: plain `git commit` takes the whole index, including hunks another lane has staged. That happened tonight — 835 insertions of someone else's panel landed under a server-fix commit message. Run `git diff --cached --stat` before every commit and confirm it holds only your work.

## Your territory

- `docs/**` — your findings, and ANT-GUIDE / DESIGN-LANGUAGE parity for anything you correct
- `tests/**` — a11y regression tests **except** `tests/web-client.test.ts`, which fe-notify owns for the whole program
- **You may not edit `src/web/**`.** If you find a defect, write it up with the exact selector, the failing assertion, and the fix you would make, then hand it to me. Do not fix it yourself — fe-notify is live in those files right now.

## What to audit — the notification center only

The header (S2–S4) is still being built. **Audit only what is merged and stable:** the notification center panel, its toggle, its rows, and the delivery contract. Do not audit half-finished header work; you will file bugs against code that is mid-change.

Run against a **throwaway server so the operator's board on 4701 is untouched**:

```
MOUNTAIN_PORT=4799 bun src/server/index.ts
```

Use `/browse` for everything. Screenshot each check.

1. **AX tree** with the panel open. `#notify-toggle` exposes `aria-expanded` and `aria-controls`. Every row is a *named* control — a screen reader must not have to infer a row's meaning from a bare digit or an icon. The badge count belongs in the accessible name, not only in a visual glyph.
2. **Focus contract.** Open → Esc → focus is back on `#notify-toggle`. Tab reaches Focus and Reply on each row. Outside-press closes. No focus trap, and no focus lost to `<body>`.
3. **Console clean.** Zero errors across open, route to a drawer, and close.
4. **`(hover: none)`.** Row actions must *stand* — no hover-only affordance. Verify at 420px.
5. **`prefers-reduced-motion`.** Nothing animates that the setting asks not to animate.
6. **Responsive.** No horizontal body scroll at 420px, 768px, 1280px.
7. **The ember contract, visually.** Ember fill appears only when a person is the blocker. An amber/`noticed`-only board must not render an ember badge. This is the contract the whole surface rests on; verify it with your eyes on a real board, not only from tests.

## What "done" looks like

`docs/A11Y-SWEEP-NOTIFICATION-CENTER.md`, committed: every check, pass or fail, with the evidence. For each failure — the exact selector, what a user hits, and the fix you would make. **A check you could not run is reported as not-run, never as a pass.** Silence about a check is the one outcome that makes this document worthless.

Then report and stand by for the header audit once S2–S4 land.

## Verify before committing

`bunx tsc --noEmit` (exit 0), then `bun run test:ci` — **not** plain `bun test`. CI runs `test:ci`, which excludes four suites that assert against this specific machine. Baseline is **0 fail**; anything else is yours to explain.
