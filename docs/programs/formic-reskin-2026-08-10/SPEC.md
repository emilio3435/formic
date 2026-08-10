# Formic reskin execution spec

Goal: Apply the canonical Formic design package to the operator console as a visual reskin while preserving its density, information architecture, interaction model, and current dirty UX baseline.

Success means:
- The canonical Formic tokens, mark, licensed self-hosted fonts, favicon, and reference package live in the repository.
- The masthead reads as Formic, the TL;DR hierarchy is legible at a distance, and LIVE remains a success state.
- The dashboard, readings, board, inspector, dock, settings, and notifications use white surfaces, hairlines, restrained shadows, semantic status colors, role tags, and indigo interaction states.
- User-facing product identity reads Formic while internal identifiers and module symbols remain stable.
- Focused tests, typecheck, the repository floor, browser screenshots at 1440 and 860 widths, reduced-motion behavior, and interaction smoke checks have recorded evidence.
- The original checkout at `/Users/emilionunezgarcia/Developer/the-mountain-main` remains byte-for-byte outside this program's edits.

Stop when: The isolated integration branch has the complete locally verified reskin, lane reports record exact evidence and limits, and no publication action remains authorized.

## Locked decisions

1. Use `/Users/emilionunezgarcia/Downloads/formic-design-package_1.zip` as the canonical design input. Its unpacked `formic-design-package 2` copy is byte-identical; the older archive is incomplete.
2. Build on local snapshot `1f3efe624ebd1318e4b119bdc9951780157e952a`, which captures the tracked dirty UX baseline at current head `b93772c`. Treat the snapshot commit as an integration-only base, not a publishable project commit.
3. Keep the original dirty checkout untouched. Run all implementation and verification in `/private/tmp/the-mountain-formic-*` worktrees.
4. Keep the strict self-only CSP unchanged. Source font binaries and their license files from the official Google Fonts repository or the font author's official repository under OFL-1.1, then serve local WOFF2 files with the correct MIME type.
5. Use the package's full two-tier token file. Components reference semantic aliases. Legacy names bridge in `styles.css` while consumers migrate.
6. Reserve clay for brand identity and primary actions, indigo for interaction, and green/amber/red/blue for status.
7. Rename ended-state `--clay` to `--ended-ink`. Migrate ended consumers before brand consumers use `--clay`; a grep/test gate proves that brand clay never becomes status.
8. Keep board needs-you as danger and TL;DR needs-you as warning. Keep break/failed as danger. LIVE remains success green.
9. Preserve the current flat/chill TL;DR structure. Change hierarchy, counter, tokens, and surface treatment only.
10. Preserve `#notify-toggle`, `#settings-toggle`, `#conn-badge`, `#conn-label`, `#server-health`, `#cleanup-status`, notification disclosure semantics, focus restoration, TL;DR facet behavior, and board density.
11. Treat `renderHealthRail()` and `src/web/styles.css` as serial seams. One writer owns each seam at a time.
12. Keep publication outside this program. Local commits are allowed; push, PR, merge to a shared branch, service restart, and deployment require later explicit approval.
13. Let measured WCAG contrast override the package guide's blanket AA claim. Preserve canonical 500 colors for non-text indicators and large identity, then add same-hue accessible text/control aliases: green `#146744`, amber `#8a5100`, existing red/blue 600, and clay 600/700. Use these aliases for normal text and filled controls; retain shape and labels so status never relies on color alone.

## Baseline evidence

- `bun run typecheck`: clean.
- `tests/health-rail-v2.test.ts`: 18 passing.
- harden-notify focused suites: 64 passing.
- `tests/notification-center-a11y.test.ts`: 33 passing.
- static-serving focused suites: 17 passing.
- `tests/web-client.test.ts`: 566 passing and one inherited failure in `FE-B: harness-backed client behavior > (8) every class in styles.css is emitted by the client` for four orphan selectors: `tldr-fleet-list`, `tldr-fleet-item`, `tldr-fleet-repo`, `tldr-fleet-summary`.

Compare final failures by exact test name and detail string. A changed failure signature is a regression even when the count is unchanged.

## Architecture and dependency order

1. Foundation: vendor package, license and self-host fonts, add production tokens/mark/favicon, extend static MIME coverage, and establish dedicated Formic contract tests.
2. Phase 1 masthead: link tokens, bridge legacy variables, migrate ended ink, add Formic lockup, and retain notification/settings/connection behavior.
3. Phase 1 TL;DR: add the attention count and reskin the existing flat lane without changing its paging/filter model.
4. Phase 1 browser gate: verify masthead/TL;DR at 1440 and 860 widths plus reduced motion and live controls.
5. Phase 2 dashboard: retoken readings, board rows, inspector, dock, settings, notifications, buttons, links, focus, status pills, and role tags.
6. Phase 2 identity/docs: update user-facing Formic copy, README, favicon, and `DESIGN-LANGUAGE.md`; retain internal symbols.
7. Final QA: run focused suites, full floor, screenshot mixed states, compute new foreground/background contrast, and report inherited/unavailable verification separately.

## Mutation funnels

- Token funnel: `src/web/formic-tokens.css` -> legacy aliases in `src/web/styles.css :root` -> component selectors.
- Health funnel: `renderHealthRail()` owns readings coordination; `renderHealthTldrLane()` owns TL;DR content; `#cleanup-status` remains a static live region.
- Identity funnel: static title/wordmark in `src/web/index.html` plus notification base title in `src/web/app.js`; internal `globalThis.TheAntHill` remains unchanged.
- Static funnel: `src/server/app.ts` maps served asset MIME types while retaining the existing CSP string.

## Verification floor

Focused lanes run the commands named in their kickoff. The integration owner then runs:

```bash
bun run typecheck
bun test tests/formic-reskin.test.ts tests/health-rail-v2.test.ts tests/health-rail-v2-markup.test.ts tests/health-rail-v2-server.test.ts
bun test tests/harden-notify-hollowness-guards.test.ts tests/harden-notify-fixtures.test.ts tests/notification-center-a11y.test.ts
bun test tests/static-serving.test.ts tests/static-root-containment.test.ts
bun test tests/web-client.test.ts
bun run check
```

The browser gate records header, readings, and mixed-status board screenshots at 1440 and 860 widths, exercises Notifications, Settings, LIVE/connection state, filters, search, board selection, inspector, and reduced motion, and measures every new text/tint pair against WCAG AA.
