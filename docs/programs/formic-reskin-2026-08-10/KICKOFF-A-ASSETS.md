# Lane A - Formic assets, fonts, tokens, and static boundary

Goal: Land the canonical Formic asset substrate and CSP-safe local font delivery as one independently verified foundation commit.

Success means:
- `docs/design/formic/` contains the nine canonical archive members plus upstream font license evidence.
- `src/web/formic-tokens.css` contains the complete two-tier token file and local `@font-face` declarations for Syne 700/800, Inter 400/500/600, and JetBrains Mono 400/500.
- `src/web/icons/formic-mark.svg` and a static favicon asset follow the package geometry and sizing notes.
- Font binaries come from an official OFL-licensed upstream and are stored under `src/web/fonts/` with provenance recorded.
- `src/server/app.ts` serves WOFF2, SVG, and favicon types correctly while the CSP string remains unchanged.
- Dedicated static tests go red first, then pass; the lane's focused floor and typecheck are recorded.

Stop when: The owned paths are committed locally, the report contains the exact red and green evidence, and any unavailable upstream asset is named precisely.

Read first:
1. `docs/programs/formic-reskin-2026-08-10/SPEC.md`
2. `docs/programs/formic-reskin-2026-08-10/GROUND-RULES.md`
3. `/Users/emilionunezgarcia/Developer/the-mountain-main/docs/superpowers/plans/2026-08-10-formic-reskin-plan.html`
4. Every canonical archive member relevant to assets, typography, CSP, and motion
5. `src/server/app.ts` static MIME/CSP path and `tests/static-serving.test.ts`

Own exclusively:
- `docs/design/formic/**`
- `src/web/formic-tokens.css`
- `src/web/fonts/**`
- `src/web/icons/formic-mark.svg`
- `src/web/favicon.svg` or `src/web/favicon.ico`
- the MIME map only in `src/server/app.ts`
- static asset assertions only in `tests/static-serving.test.ts`

Claims:
- `FORMIC-ASSET-1 canonical package is vendored byte-faithfully`
- `FORMIC-FONT-1 every requested family/weight is local and licensed`
- `FORMIC-CSP-1 WOFF2/SVG/favicon serve with correct MIME under unchanged self-only CSP`
- `FORMIC-MOTION-1 mark has a static/reduced-motion path`

Focused floor:

```bash
bun test tests/static-serving.test.ts tests/static-root-containment.test.ts
bun run typecheck
```

Commit locally with a conventional `feat(formic): ...` message, then return the SHA and report path. Keep all existing interface files outside this lane.
