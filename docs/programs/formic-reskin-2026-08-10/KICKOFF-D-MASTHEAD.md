# Lane D - Formic token bridge and masthead

Goal: Apply the Formic token bridge and rebuild the masthead identity while preserving every header control and connection behavior.

Success means:
- `index.html` links the Formic tokens before the application stylesheet and keeps the latest inherited cache-bust baseline.
- Legacy aliases in `styles.css :root` point to semantic Formic tokens, ended consumers use `--ended-ink`, and brand clay is free for identity.
- The masthead renders the production mark plus `Form<span class="wm-accent">i</span>c`, with only the `i` in clay.
- Notifications, Settings, connection label, server health, and their accessible relationships retain their identifiers and behavior.
- LIVE uses success green and a reduced-motion-safe breathing treatment.
- The dedicated Formic masthead/token claims go from RED to green and the existing notification/static contracts remain green.

Stop when: The token bridge and masthead are committed locally with exact focused evidence and no TL;DR/dashboard edits.

Read first:
1. `SPEC.md` and `GROUND-RULES.md`
2. Canonical tokens guide, preview, wordmark specimen, brand guidelines, and logo book under `docs/design/formic/`
3. `src/web/index.html`, `src/web/styles.css :root` and masthead section
4. `renderConn()`, `renderBeacon()`, boot header wiring, and relevant tests

Own exclusively:
- `src/web/index.html` head and masthead only
- `src/web/styles.css :root`, global font/focus prerequisites needed by this phase, and masthead/connection section only
- masthead/token assertions only in `tests/formic-reskin.test.ts`

Claims:
- `FORMIC-TOKENS-ASSETS-RED`
- `FORMIC-MASTHEAD-WORDMARK-LIVE-RED`
- the masthead subset of `FORMIC-INTERACTION-RED`

Focused floor:

```bash
bun test tests/formic-reskin.test.ts
bun test tests/notification-center-a11y.test.ts
bun test tests/static-serving.test.ts tests/static-root-containment.test.ts
bun run typecheck
```

Create `LANE-REPORT-masthead.md` first. Commit only owned paths locally and return the SHA and report path. Leave TL;DR, readings, board, inspector, dock, settings-panel, and notifications-panel styling for later lanes.
