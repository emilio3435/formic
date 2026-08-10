# Lane F - Formic full dashboard surfaces and semantics

Goal: Retoken the complete dashboard through the Formic semantic system while preserving its layout, density, data, and interaction model.

Success means:
- Readings, board, agent rows, inspector, dock, settings, notifications, buttons, links, status pills, and role tags use the selector map from `LANE-REPORT-visual-map.md`.
- Primary surfaces are white with hairline borders and restrained shadows; subtle fills appear only for hover or nested content.
- Status rails/pills preserve business state, role tags use `--tag-*`, primary actions use brand clay, and links/hover/focus use indigo.
- Global and component focus-visible states use `--color-focus-ring` without erasing status rails.
- User-facing page/notification/empty-state identity reads Formic while internal `TheAntHill` symbols remain stable.
- New foreground/background pairs clear WCAG AA and dedicated Formic claims plus existing accessibility/interaction suites pass.

Stop when: The complete dashboard reskin is committed locally with exact focused evidence, a contrast ledger, and no documentation-only edits.

Read first:
1. `SPEC.md`, `GROUND-RULES.md`, and `LANE-REPORT-visual-map.md`
2. Canonical tokens guide, brand guidelines, preview, and logo book
3. Current selector sections and immediate render callers for every owned surface
4. Existing web-client, notification accessibility, harden-notify, and health-rail contracts

Own exclusively during this serial lane:
- component selector sections in `src/web/styles.css` outside the already-landed masthead/TL;DR fences
- user-facing identity strings and minimal semantic class additions in `src/web/app.js`
- page/empty-state identity markup outside the masthead in `src/web/index.html`
- Phase 2 assertions in `tests/formic-reskin.test.ts`
- exact expectation updates required by the semantic focus/title change in existing UX tests

Claims:
- `FORMIC-FOCUS-RED`
- `FORMIC-RENAME-RED`
- `FORMIC-NOTIFICATION-STATUS-RED`
- `FORMIC-INTERACTION-RED`

Focused floor:

```bash
bun test tests/formic-reskin.test.ts tests/health-rail-v2.test.ts
bun test tests/harden-notify-hollowness-guards.test.ts tests/harden-notify-fixtures.test.ts tests/notification-center-a11y.test.ts
bun test tests/web-client.test.ts
bun run typecheck
```

Create `LANE-REPORT-dashboard.md` first. Commit only owned paths locally and return the SHA and report path. Record the inherited orphan-selector failure by exact text if it persists; treat any changed detail as candidate-owned red.
