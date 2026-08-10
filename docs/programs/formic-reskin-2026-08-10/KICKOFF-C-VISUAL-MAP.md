# Lane C - Formic visual semantic map

Goal: Produce the exact selector-by-selector Phase 2 retoken map and WCAG contrast ledger without modifying production code.

Success means:
- The report maps legacy tokens and raw colors to Formic semantic aliases across masthead, TL;DR, readings, board, inspector, dock, settings, notifications, buttons, links, focus, status pills, and role tags.
- Every status mapping preserves the current business meaning, including board danger versus TL;DR warning.
- Every new foreground/background pairing has a computed contrast ratio or a named browser-only verification step.
- The report flags unmapped cases and leaves their color unchanged pending a semantic decision.
- The report identifies exact selector sections that one serial Phase 2 writer can execute.

Stop when: The read-only report gives the implementation lane a complete selector map, contrast ledger, and unresolved-case list.

Read first:
1. `docs/programs/formic-reskin-2026-08-10/SPEC.md`
2. `docs/programs/formic-reskin-2026-08-10/GROUND-RULES.md`
3. The canonical tokens guide, brand guidelines, preview, and logo book in the archive
4. `src/web/styles.css`, `src/web/index.html`, and relevant render functions in `src/web/app.js`

Own no production paths. Write only `LANE-REPORT-visual-map.md` and optional scratch under `.lane-evidence/`.

Use deterministic code or shell calculations for contrast ratios. Use model judgment only to classify selectors by brand, interaction, status, role, or neutral surface.

Return the report path and the exact unmapped cases. This lane makes no commit because its report is ignored orchestration evidence.
