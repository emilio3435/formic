# Lane B - Formic reskin RED contracts

Goal: Encode the plan's visual-semantic and interaction-preservation claims in one dedicated test file before production implementation begins.

Success means:
- `tests/formic-reskin.test.ts` covers tokens/assets, legacy collision rules, masthead identity, LIVE status, TL;DR hierarchy/counter, focus color, user-facing rename, local fonts/CSP, and unchanged interaction anchors.
- Each claim fails against the integration baseline for the intended missing behavior and cannot pass on arbitrary output.
- Existing dirty test files remain unchanged.
- The report pastes the exact RED failures and explains which later lane owns each green implementation.

Stop when: The RED-only contract commit is local, every failure is intentional and named, and the report contains exact output.

Read first:
1. `docs/programs/formic-reskin-2026-08-10/SPEC.md`
2. `docs/programs/formic-reskin-2026-08-10/GROUND-RULES.md`
3. `/Users/emilionunezgarcia/Developer/the-mountain-main/docs/superpowers/plans/2026-08-10-formic-reskin-plan.html`
4. Relevant sections of `tests/health-rail-v2.test.ts`, `tests/web-client.test.ts`, `tests/notification-center-a11y.test.ts`, and `tests/static-serving.test.ts`
5. Immediate production symbols each assertion inspects

Own exclusively:
- `tests/formic-reskin.test.ts`

Claims use these stable IDs:
- `FORMIC-TOKENS-ASSETS-RED`
- `FORMIC-MASTHEAD-WORDMARK-LIVE-RED`
- `FORMIC-TLDR-HIERARCHY-RED`
- `FORMIC-FOCUS-RED`
- `FORMIC-RENAME-RED`
- `FORMIC-CSP-FONTS-RED`
- `FORMIC-NOTIFICATION-STATUS-RED`
- `FORMIC-INTERACTION-RED`

Verification:

```bash
bun test tests/formic-reskin.test.ts
```

Expected outcome: intentional RED with exact missing-Formic details and no syntax/import failures. Commit the RED contract locally with a conventional `test(formic): ...` message, then return the SHA and report path.
