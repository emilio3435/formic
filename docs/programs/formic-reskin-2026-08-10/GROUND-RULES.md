# Formic reskin swarm ground rules

Goal: Let independent Luna Max lanes produce mergeable, evidence-backed slices while the orchestrator retains the only global mutation view.

Success means:
- Each lane owns an exact worktree, branch, file fence, and named test claims.
- Each lane creates its report before source work and keeps it current.
- Each lane commits only its owned paths after its focused floor produces recorded output.
- The orchestrator verifies every lane independently before merging.

Stop when: The lane has a local commit and complete report, or its report names the exact blocker and preserved work.

## First action

Create `LANE-REPORT-<lane>.md` in the worktree root with these five headings, each initially marked `PENDING`:

1. What this lane was
2. Which claims went red first, by exact name and failure detail
3. What shipped, by file and fence
4. Floor results pasted verbatim
5. Anything unverified, including sandbox or network refusals

Update the report as work lands. Section 4 contains real command output before the lane reports completion.

## Shared invariants

- Read this spec, the canonical plan, and the relevant production callers before editing.
- Use `/Users/emilionunezgarcia/Downloads/formic-design-package_1.zip` as design truth.
- Preserve density, DOM order, interaction targets, and state semantics.
- Build every new test around a named business claim that fails before the implementation change.
- Keep untrusted content on `textContent`/`el({ text })` paths.
- Keep `#cleanup-status` static across paints.
- Keep clay as brand, indigo as interaction, and status hues as live state.
- Keep browser security policy self-only and retain `style-src 'self'`.
- Keep scratch artifacts under `.lane-evidence/` and reports at the worktree root; both are ignored.

## Git and ownership

- Work only in the kickoff's named worktree and branch.
- Inspect `git status --short --branch` before and after every meaningful step.
- Stage and commit exact owned paths. Use conventional messages and one coherent unit per commit.
- Leave shared publication state unchanged: no push, PR, merge, rebase, amend, service restart, or deployment.
- Preserve files outside the lane fence. Record a cross-fence need in the lane report for orchestrator handling.
- Retain every pre-existing failure by exact test name and failure text; report changed signatures loudly.

## Silent traps

- The current integration base is a synthetic snapshot of foreign dirty work. Its parentage is local orchestration machinery, not release history.
- `src/web/styles.css`, `src/web/index.html`, and `src/web/app.js` are serial seams. Edit them only when the kickoff explicitly assigns the named section or function.
- Existing `tests/web-client.test.ts` has a baseline orphan-selector failure for four `tldr-fleet-*` selectors.
- The Formic reference HTML uses remote fonts and inline styles. Port the design into local CSS/assets while preserving CSP.
- The archive contains no standalone font files or license text. Vendor both binaries and license evidence from the same official upstream.
- The mark's embedded SVG `<style>` is unsuitable for inline document use under current CSP. Use a same-origin image or move animation rules into local CSS.

## Handoff

Return the local commit SHA, exact paths changed, exact focused commands, baseline-vs-candidate failure comparison, and report path. The orchestrator reruns the floor before merging.
