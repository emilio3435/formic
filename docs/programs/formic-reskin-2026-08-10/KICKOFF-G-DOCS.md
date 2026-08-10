# Lane G - Formic design language and user-facing documentation

Goal: Align the project-facing design documentation with the implemented Formic system and rename the product in the plan-required public entry points.

Success means:
- `DESIGN-LANGUAGE.md` documents the two-tier token system, three color roles, white/hairline/shadow surfaces, typography, motion, accessibility, and the danger-fill person-blocker invariant.
- `README.md` presents Formic as the product while retaining accurate setup, architecture, and internal compatibility names.
- Documentation statements match the landed implementation and verified screenshots.
- Historical records remain historical and internal package/code identifiers remain stable.
- Documentation tests and the asset/cache contracts pass.

Stop when: The owned documentation is committed locally with exact verification evidence and all broader rename candidates are listed for orchestrator classification.

Read first:
1. `SPEC.md`, `GROUND-RULES.md`, and the landed implementation diff
2. Canonical tokens guide and brand guidelines
3. Current `DESIGN-LANGUAGE.md`, `README.md`, and documentation tests

Own exclusively:
- `DESIGN-LANGUAGE.md`
- `README.md`
- documentation assertions that directly pin these two files

Focused floor:

```bash
bun test tests/web-client.test.ts --test-name-pattern 'guide and the architecture map|cache-buster'
bun run typecheck
```

Create `LANE-REPORT-docs.md` first. Commit only owned paths locally and return the SHA and report path. Report other current user-facing `The Ant Hill` strings without editing them unless the orchestrator expands the fence.
