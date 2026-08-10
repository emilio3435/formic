# Formic reskin verification

## Outcome

The Formic reskin plan is implemented and verified in its intended scope. The focused deterministic suites, typecheck, browser interaction checks, responsive viewports, reduced-motion behavior, asset comparison, CSP inspection, and contrast checks pass.

The repository-wide test commands are not all green. Their remaining failures are baseline-identical project debt or fail-loud live dependencies, not regressions introduced by this branch. They remain visible below rather than being relabeled as Formic success.

## Requirement matrix

| Requirement | Evidence | Result |
| --- | --- | --- |
| Formic identity without an IA or layout redesign | Existing routes, panels, dashboard density, and interaction model retained; product copy and design language updated | Pass |
| Canonical local assets | Nine files compare byte-for-byte with `formic-design-package_1.zip`; repository additions are provenance and license files | Pass |
| Local font family | Seven expected font files have server and source contracts; exercised faces return HTTP 200 | Pass |
| Strict self-only CSP | CSP remains self-only; inspector markup no longer emits inline style attributes | Pass |
| Legacy clay compatibility | `--clay` maps to `--ended-ink`, while branded controls use the dedicated brand token | Pass |
| Masthead | 26px mark, 18-degree tilt, 3.2s mark motion, 2s LIVE breathing, success tint, and static favicon are contract-tested | Pass |
| Reduced motion | Browser emulation reports zero visible CSS animations; source fallback also disables the SVG pulse | Pass |
| TLDR hierarchy | Attention count, white hairline, semantic rails, and compact information hierarchy are present | Pass |
| Dashboard retokening | Role and status colors remain distinct; focus uses indigo; primary controls use the brand clay token | Pass |
| Responsive behavior | 1440x900 and 860x900 have no page overflow; tablet instrument cells align and contain long labels | Pass |
| Existing interactions | Search, status filtering, notifications, Settings, Escape dismissal, and agent inspector were exercised | Pass |
| Accessibility and contrast | Accessible menu/modal states remain exposed; sampled semantic and control pairs range from 5.15:1 to 7.98:1 | Pass |
| Documentation | Design language, identity references, provenance, licenses, execution spec, and this verification record are present | Pass |

The implementation retains cache token `ah-t17`; it is the current token and supersedes the plan draft's `ah-t16` example.

## Browser evidence

The local preview ran on port 4710. Production port 4701 was not started, stopped, or modified.

| Viewport or mode | Evidence |
| --- | --- |
| 1440x900 | No horizontal overflow or console errors; masthead mark computes to 26px; LIVE tint and 2s motion match the plan |
| 860x900 | No horizontal overflow or console errors; seven rendered instrument cells align to seven explicit tracks; long labels ellipsize within their cells |
| Reduced motion at 1440x900 | `prefers-reduced-motion: reduce` matches; LIVE animation computes to `none`; no visible element retains a non-none animation |
| Overlays | Notifications and Settings open within the viewport, expose accessible state, and close with Escape |
| Data interactions | Search for `Luna`, `Working` status selection, and agent inspector selection update the UI correctly |

Screenshots are retained in the ignored local QA artifact directory:

- `.gstack/qa-reports/screenshots/formic-1440-final.png`
- `.gstack/qa-reports/screenshots/formic-860-final.png`
- `.gstack/qa-reports/screenshots/formic-reduced-motion-1440.png`
- `.gstack/qa-reports/screenshots/formic-notifications-1440.png`
- `.gstack/qa-reports/screenshots/formic-inspector-1440.png`

## Contrast evidence

| Pair | Ratio |
| --- | ---: |
| Success text / success tint | 6.18:1 |
| Warning text / warning tint | 5.75:1 |
| Danger text / danger tint | 5.15:1 |
| Info text / info tint | 5.83:1 |
| Brand control / white | 5.35:1 |
| Brand hover / white | 7.81:1 |
| Link / white | 7.79:1 |
| Secondary control / white | 7.98:1 |

All sampled pairs meet WCAG AA for normal text.

## Deterministic verification

The following scoped gates pass on the implementation:

```text
bun run typecheck
bun test tests/formic-reskin.test.ts tests/formic-plan.regression-1.test.ts tests/formic-plan.regression-2.test.ts tests/formic-plan.regression-3.test.ts tests/formic-plan.regression-4.test.ts tests/formic-plan.regression-5.test.ts tests/formic-plan-verification.test.ts tests/health-rail-v2.test.ts tests/health-rail-v2-markup.test.ts tests/health-rail-v2-server.test.ts
bun test tests/harden-notify-hollowness-guards.test.ts tests/harden-notify-fixtures.test.ts tests/notification-center-a11y.test.ts
bun test tests/static-serving.test.ts tests/static-root-containment.test.ts
bun test tests/web-client.test.ts
```

The final results on the recorded implementation are:

- Typecheck: exit 0.
- Formic and health rail: 44 passing, 0 failing, 310 assertions.
- Notification/accessibility floor: 97 passing, 0 failing, 354 assertions.
- Static serving/CSP: 18 passing, 0 failing, 53 assertions.
- Web client: 567 passing, 0 failing, 3,503 assertions.

## Repository-wide gate classification

`bun run test:ci` reports 2,926 passing and 3 failing tests. Running the two failing files at the pre-reskin snapshot `1f3efe624ebd1318e4b119bdc9951780157e952a` produces the same three failures:

- Two `tests/overhaul-guards.test.ts` failures for pre-existing collapsed drawer disclosures.
- One `tests/ant-hill-task-refine.test.ts` failure because its assertion expects `Ran 21 tests` while the underlying Python suite successfully reports `Ran 24 tests`.

`bun run check` additionally exercises local/live-only gates and reports 3,062 passing and 9 failing tests:

- The same three baseline-identical failures above.
- Two `notification-center-geometry` failures caused by the test harness receiving `EADDRINUSE` from `Bun.serve({ port: 0 })`; the pre-reskin snapshot fails the same standalone probe.
- Four explicit unavailable live-evidence checks: production on port 4701 is intentionally untouched, and BurnBar does not expose readable live rows/identities in this environment.

These results support a scoped Formic-green conclusion. They do not support an all-repository-green or live-production-verified claim.

## QA fixes

| Commit | Resolution |
| --- | --- |
| `f47cb0b` | Preserve ended-state clay compatibility |
| `1a53167` | Match Formic masthead dimensions, tint, and motion |
| `1789ada` | Remove obsolete TLDR selectors |
| `eeec62b` | Keep dynamic inspector markup CSP-safe |
| `3886994` | Align tablet instrument columns |
| `dfbb05d` | Contain tablet instrument labels |

## Publication boundary

This work remains local. No push, pull request, merge, or deployment was performed. The integration branch is based on a synthetic snapshot of the original dirty checkout so that foreign work remained untouched; it therefore requires an intentional rebase or cherry-pick plan before publication.
