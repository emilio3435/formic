# Evidence column exhibits: Grok 4.6 Extra Extra High Fast implementation spec

**Classification:** Frontend only (plus copying five SVG marks into `src/web/icons/`)

**Implementation model:** Cursor Grok 4.6 Extra Extra High Fast (`cursor-grok-4.6-xhigh-fast`). Subagents inherit this model. Do not route to Opus, Sonnet, Fable, Sol, or Luna.

**Design spec:** `docs/superpowers/specs/2026-08-12-evidence-column-exhibits.md`

**Visual source of truth:** `docs/rhs-shots/evidence-dossier/mockup.html`, `mockup-delta.css`, `marks/{git,github,folder,route,history}.svg`

**Verified design worktree:** `/private/tmp/formic-evidence-ux` on `docs/formic-evidence-ux-adversarial` (mockup may still be uncommitted there — copy the files, do not wait on that commit)

**Implementation location:** a fresh worktree created from current `origin/main`

**Publication boundary:** finish with a reviewed, verified local commit; stop before push, PR, merge, or deploy unless the user separately authorizes publication

## Agent directive

Goal: Make the open RHSP Evidence column match the implementation mock. Omit-empty exhibits: Workspace, Git, Pull request, Route, History. 16px inline product marks. No Verify. No Output. No stroke icons in section heads. Hydrate identity trail from `GET /api/debug/identity`.

Success means:

- `renderEvidence` emits the exhibit set in the design spec, omit-empty.
- Sticky desk title “Evidence” is gone.
- Git absent omits the exhibit. No emoji lights. No “— no git”.
- In-tree files hang under Workspace with paths relative to cwd. Transcript artifacts do not.
- Pull request is its own omit-empty exhibit with the official GitHub mark.
- Route uses Exact / Unique folder / Quarantined chips. Skipped identity tiers are omitted. Working folder appears only when that tier decided the bind.
- A quarantined session always has a Route exhibit to scroll to, even when `identityTrace` is missing from the snapshot JSON.
- After ↗ load, tty lines and `commandHints` paint. Debug errors never say “no conflicts found”.
- CWD-COPY-1 sentence stays verbatim. Evidence never contains “Linked for Focus and Send.”, “Ready · linked”, header vitals, or chat prose.
- `agent.tests` is never read or painted.
- Focused tests fail on the old renderer and pass on the implementation. Full Bun suite and typecheck are green.

Stop when: focused tests, typecheck, the full Bun suite, and diff review are green on the exact implementation commit, and the local branch is ready for publication review.

Constraints:

- Work from a fresh branch/worktree based on `origin/main`. Record the SHA before editing.
- Keep runtime changes inside the file fence below.
- Port CSS from `mockup-delta.css` into `src/web/styles.css` scoped to `.drawer-desk`. No new `:root` tokens. No 28px tiles.
- Copy marks into `src/web/icons/` and reference `/icons/….svg` like harness logos. Do not inline SVG markup via `innerHTML`.
- Preserve every unrelated local change. The shared checkout `/Users/emilionunezgarcia/Developer/the-mountain-main` is dirty and serves as context only — do not edit it.
- Do not restart a live `:4701` belonging to another worktree.
- Do not invent a tests collector, a Verify exhibit, or a second Git dirty glyph.

## Product contract

When an operator opens a session, the right column answers: where are the files, what is git, is there a PR, why is routing trustworthy, and (if retained) why is this in history.

```text
.drawer-desk
├── .inspector-panel
│   ├── Workspace exhibit     cwd + extra dirs + in-tree files + CWD-COPY-1
│   ├── Git exhibit           omit-empty; official logo; dirty pip
│   ├── Pull request exhibit  omit-empty; official GitHub logo
│   ├── Route exhibit         chip + bind rows + ↗ debug surfaces
│   └── History exhibit       retained / exceptional ending only
└── .dw-spine                 Lineage — unchanged
```

Header, Conversation, dock, and Lineage keep their current jobs. Evidence does not repeat them.

## Verified current state

| Current mechanism | Current result | Gap |
|---|---|---|
| `src/web/app.js` `renderAgentDrawer` appends sticky `drawer-section-head` “Evidence” | Column title + 11px mono hairline above everything | Mock has no column title; first exhibit head is the start |
| `renderEvidence` `:11433` builds “Paths & Usage” `dl` including Git always | “— no git” + ⚪/🟡/🟢; heading still says Usage | Split into Workspace + Git; omit empty Git; drop Usage |
| Git row uses `icon("git-branch")` plus emoji lights | Stroke family in a noun slot; miserable next to harness logos | Official `git.svg` + pip |
| Artifacts are a separate list including transcripts | Path duplicates Workspace; transcript already in chat foot | Fold in-tree files under Workspace; filter transcript |
| `pullRequestUrls` unrendered in Evidence | PRs only on the left board group | Omit-empty Pull request exhibit |
| `renderIdentityBlock` returns null without `agent.identityTrace` | SSE strips the getter; banner “See routing evidence →” scrolls to nothing | Always mount Route when quarantined; hydrate from debug `agent.trace` |
| Identity steps include `skipped` | “Working folder / skipped” is noise when session ID already bound | Omit skipped tiers |
| `commandHints` in debug payload | Fetched, never painted | Paint after ↗ load |
| `agent.tests` typed, never assigned | Any Verify UI would be fiction | Do not paint |
| `--drawer-vitals-h: 42px` offsets `.drawer-section-head` | Vitals band is gone; header facts are in-header | Delete sticky Evidence head; drop the token if unused |

`identityTraceView` (`src/web/presentation.js:320`) reads `agent.identityTrace` only. Debug response already returns `agent.trace` (`src/server/debug-identity.ts:114-121`). Client `loadIdentityEvidence` stores `body` on `state.identity.data` and never copies `data.agent.trace` onto the view.

## File fence

| File | Required change |
|---|---|
| `src/web/icons/git.svg` | Copy official Git SCM mark from the mockup `marks/git.svg` |
| `src/web/icons/github.svg` | Copy official GitHub mark from `marks/github.svg` |
| `src/web/icons/folder.svg` | Copy from `marks/folder.svg` |
| `src/web/icons/route.svg` | Copy from `marks/route.svg` |
| `src/web/icons/history.svg` | Copy from `marks/history.svg` |
| `src/web/app.js` | Rebuild `renderEvidence`; drop sticky Evidence head; hydrate Route; fold files; omit-empty Git/PR/History |
| `src/web/presentation.js` | Let `identityTraceView` accept a resolved trace (debug hydrate). Do not change banner copy or ID-redaction |
| `src/web/styles.css` | Port `mockup-delta.css` under `.drawer-desk`. Remove unused `--drawer-vitals-h` / sticky Evidence offset |
| `tests/web-client.test.ts` | Keep CWD-COPY-1. Retarget identity trail DOM to chips + bind rows. Omit empty git. No emoji. No transcript artifact. Hydration paints trail + hints. Drop `drawer-header-vitals` assertions in Evidence/drawer tests that are already stale |
| `tests/cwd-adversarial-browser.test.ts` | Keep CWD-COPY-1. Do not require `folder = repo` badge |

No backend, collector, snapshot fingerprint, API, persistence, launchd, deployment, font, or token-accounting file is in scope. Do not edit `src/server/snapshot.ts`.

If a test file outside this fence fails because it asserted “Paths & Usage”, “— no git”, `identity-step` count including skipped, or sticky “Evidence”, update that assertion to the new contract. Do not weaken unrelated tests.

## DOM contract

Exhibit head (every exhibit):

```js
el("div", { class: "exhibit-head" },
  el("span", { class: "exhibit-mark" /* + git-dirty when dirty */ },
    el("img", { src: "/icons/git.svg", alt: "Git", width: 16, height: 16 })),
  el("h3", { class: "section-title", dataset: { evidenceSection: "git" } }, "Git"),
  /* Route only: chip + identity-expand button */
)
```

Route ↗ keeps `dataset.fkey` `identity-load:{agentId}` so focus restoration still works. `aria-expanded` toggles the surfaces list.

Relative path helper (pure, export on `TheAntHill` if tests need it):

```text
if artifact.path starts with cwd + "/", return path.slice(cwd.length + 1)
else return path
never return "" — fall back to label
```

Filter artifacts:

```text
kind !== "transcript"
and path is not the transcript foot path
and label does not match /transcript/i unless kind is an explicit non-transcript kind
```

## Acceptance criteria

A test **fails** when the condition holds. Implement these as assertions in `tests/web-client.test.ts` (and keep CWD-COPY-1).

1. Evidence text contains a Header fact (context %, session tokens, model short, “Terminal: {title}”).
2. Evidence contains Conversation prose or the transcript path already in the foot.
3. Evidence contains “Linked for Focus and Send.” or “Ready · linked”.
4. Evidence contains “Paths & Usage”, “— no git”, ⚪, 🟡, or 🟢.
5. Evidence contains a Verify heading or “Tests not reported” or reads `agent.tests`.
6. Git object absent still paints a Git exhibit.
7. A transcript-kind artifact appears in Evidence while the chat foot already has that path.
8. An in-tree artifact under cwd reprints the absolute workspace prefix.
9. `cwdRelation === "different"` is missing the CWD-COPY-1 sentence, or contains “mismatch” / “≠”.
10. Identity exhibit says authorized Send when `attestation==="remembered"` or `resolution!=="exact"`.
11. Quarantined session with no `identityTrace` on the agent object has no `[data-evidence-section="route"]` (V11).
12. Exact session still shows a “Working folder” / “skipped” row.
13. Debug payload with `commandHints` is loaded and the hints never appear.
14. Debug fetch error paints “no conflicts found”.
15. Sticky Evidence `drawer-section-head` still exists in `renderAgentDrawer`.
16. Section heads use `icon("folder-open")` / `icon("git-branch")` / `icon("paperclip")` / `icon("shield")`.
17. `.drawer-desk` contains `.chat-msg` or 16px bubble radius.
18. Full Bun suite or typecheck fails, or new skips/filters are added to hide red tests.

Keyboard: Tab reaches Route ↗, copy, and the chat log. Desk `role="region"` stays “Evidence and lineage”. Empty note stays a status sentence.

## Implementation plan

### Task 0: create a clean implementation lane

1. Fetch the current remote state.
2. Record `git rev-parse origin/main`.
3. Create a fresh worktree and `feat/evidence-column-exhibits` branch from that exact SHA.
4. Confirm `git status --short` is empty in the new worktree.
5. Copy the visual contract into the worktree if it is not already on that SHA:
   - `docs/rhs-shots/evidence-dossier/mockup.html`
   - `docs/rhs-shots/evidence-dossier/mockup-delta.css`
   - `docs/rhs-shots/evidence-dossier/marks/*.svg`
   - `docs/superpowers/specs/2026-08-12-evidence-column-exhibits.md`
   - this plan
   Source: `/private/tmp/formic-evidence-ux` if `origin/main` does not have them yet.
6. Open `mockup.html` via `file://` and keep it beside the implementation. Match it. Do not match `desktop.html`.

Verify:

```bash
git status --short --branch
git rev-parse HEAD
git rev-parse origin/main
```

Stop with `BLOCKED` if the implementation worktree is dirty before the first edit.

### Task 1: write the red tests first

In `tests/web-client.test.ts`:

- Keep `CWD-COPY-1` (`:28-60`) and directory provenance (`:4146-4180`). Labels stay “Workspace”, “Repository”, “Launch folder”, “Terminal shell folder”.
- Add: no Git exhibit when `git` is absent; no ⚪/🟡/🟢 / “— no git”.
- Add: transcript artifact omitted when the foot would own that path.
- Add: in-tree artifact under cwd renders the relative suffix only.
- Add: `pullRequestUrls: ["https://github.com/example/the-mountain/pull/42"]` paints a Pull request exhibit; empty array omits it.
- Rewrite “(1) Evidence renders the tier trail…” (`:9659`): assert `.route-chip`, `.route-bind`, omitted skipped recorded tier, Session ID + Working folder details still contain `ttys082` / working-folder copy. Do not require `identity-step` count === 3.
- Add: `renderEvidence(quarantinedAgentWithoutTrace)` still returns `[data-evidence-section="route"]`.
- Add: `renderEvidence(exactAgent, identityUi with data.agent.trace)` paints bind rows from the debug trace.
- Add: after a fake debug payload with `commandHints`, those hint strings appear.
- Add: source of `renderEvidence` does not contain `agent.tests` or `"Verify"`.
- Add: `renderAgentDrawer` source does not contain sticky `drawer-section-head` titled Evidence.
- Retarget stale `drawer-header-vitals` assertions that already disagree with `drawer-session-facts` — do not resurrect the vitals band.

Run focused tests against unmodified `app.js` and capture the exact failures. The old renderer must fail omit-empty Git, no-emoji, no-Verify, Route-without-trace, and skipped-tier omission.

Verify red:

```bash
bun test tests/web-client.test.ts tests/cwd-adversarial-browser.test.ts
```

### Task 2: ship the marks and CSS

1. Copy the five SVGs into `src/web/icons/`.
2. Append the rules from `mockup-delta.css` to `src/web/styles.css`, still scoped to `.drawer-desk` / exhibit classes. Keep `.directory-relation-note` (class already emitted, currently unstyled).
3. Delete 28px tile / inset-rail rules if any copy of them sneaks in. Heads are 16px inline.
4. Remove sticky Evidence offset: delete `--drawer-vitals-h` if nothing else uses it; set `.drawer-section-head` unused or delete the node in Task 3.

Do not change harness/agent `.provider-mark` rules.

### Task 3: rebuild `renderEvidence`

Replace `renderEvidence` (`src/web/app.js` ~`:11433`) with omit-empty exhibits per the design spec. Suggested helpers in the same file, not a new module unless a test needs an export:

- `exhibitHead({ mark, title, section, extra })`
- `relativeArtifactPath(cwd, path)`
- `workspaceFiles(agent)`
- `resolvedIdentityTrace(agent, ui)` — `ui.identity.data.agent.trace` when `ui.identity.agentId === agent.id`, else `agent.identityTrace`
- `renderRouteExhibit(agent, ui)`

`renderIdentityBlock` becomes the Route exhibit (keep class `identity-block` for banner scroll + existing tests that query it). Filter `view.steps` with `outcome !== "skipped"`. Chip from `view.resolution`. Bind rows from remaining steps.

`renderSurfaceEvidence`: keep load/Retry/error copy. Also render `commandHints` from the debug payload (surface traces / `identity.data`). Toggle visibility with `aria-expanded` on the ↗ button; default collapsed.

`renderAgentDrawer`: delete the sticky “Evidence” `drawer-section-head`. `desk` still appends `renderEvidence` then `renderLineageSpine`.

`renderRowFacts`: stop using it as a separate “Row facts” heading. Fold specialty into Workspace; history into History. Delete unused `role` / `source` locals if they become dead.

`renderControlLink`: do not resurrect. Delete if still unused.

`evidenceInventory` stays a walk of `data-evidence-section`. New names must be the five exhibit keys, never `"paths & usage"`.

Do not call `renderVitalsBand`. Do not print Ready · linked.

### Task 4: hydrate the trace without touching the snapshot fingerprint

In `renderRouteExhibit` / `identityTraceView`:

```text
trace = (ui.identity.agentId === agent.id && ui.identity.data?.agent?.trace)
     || agent.identityTrace
     || null
```

Pass that into `identityTraceView` without mutating `agent`. Do not change `src/server/snapshot.ts`. Do not make the getter enumerable.

Prove with a unit test: agent fixture has no `identityTrace`; `identityUi({ agentId, data: { ok: true, agent: { trace: CONFLICTED.identityTrace } } })` still paints Session ID / Working folder details.

### Task 5: defeat-check the new assertions

1. Temporarily paint Git as “— no git” when absent; confirm the omit-empty test fails. Restore.
2. Temporarily include a skipped cwd step on an exact session; confirm the skipped-tier test fails. Restore.
3. Temporarily return null from Route when `identityTrace` is missing; confirm V11 fails. Restore.
4. Temporarily leave `commandHints` unrendered; confirm the hint test fails. Restore.

Keep only the real implementation in the final diff.

### Task 6: complete verification and local commit

Run:

```bash
bun run typecheck
bun test tests/web-client.test.ts tests/cwd-adversarial-browser.test.ts tests/formic-reskin.test.ts tests/overhaul-guards.test.ts
bun test
git diff --check
git status --short
```

Review every changed line against the design spec. Confirm the diff does not include `src/server/`, Verify UI, or dock/Lineage restyles.

Commit the verified unit with:

```text
feat(web): rebuild Evidence as omit-empty exhibits
```

Stop before publication and report:

- exact branch and commit SHA;
- changed files;
- focused and full-suite counts;
- which old tests were retargeted and why;
- any unavailable verification;
- `READY_FOR_PUBLICATION_REVIEW` or a concrete blocker.

## Testing matrix

| Layer | Test | Required proof |
|---|---|---|
| Directory provenance | `tests/web-client.test.ts` CWD-COPY-1 + compact provenance | Verbatim sentence; no mismatch/≠; Launch folder / Terminal shell folder labels |
| Exhibit contract | `tests/web-client.test.ts` new Evidence cases | Omit-empty Git/PR; relative files; no transcript; no Verify; no sticky Evidence head |
| Route | `tests/web-client.test.ts` identity block tests | Chip + bind rows; skipped omitted; V11 landing; hydration; command hints; error copy |
| Browser cwd | `tests/cwd-adversarial-browser.test.ts` | CWD-COPY-1 still holds without `folder = repo` badge |
| Semantic reskin | `tests/formic-reskin.test.ts` | Existing Formic surface/token contract remains green |
| Type safety | `bun run typecheck` | Zero TypeScript errors |
| Regression | `bun test` | Entire repository suite green with no new skips |

## Preserved behavior

- Header `drawer-session-facts` (Status / Run / Context / Session).
- Conversation bubbles, transcript foot, Refresh.
- Command dock Ready · linked, Focus, Interrupt, Archive, composer.
- Control banner lock sentence and ID-redaction.
- Lineage spine parent/child.
- `dtdd` omit-empty for null/empty values.
- Desktop 65/35 drawer grid and ≤860px stacked sheet (chat first, dock in the chat box).
- Evidence desk is not a third `overflow-y: auto` scroller.
- Three shipped font families and existing `:root` tokens.

## Out of scope

- Publishing `AgentSnapshot.tests` or any Verify exhibit.
- Enumerating `identityTrace` on the SSE payload / fingerprint.
- Restyling dock tools or Lineage marks.
- Specimen-sheet HTML (`desktop.html`, `state-*.html`).
- Header, Conversation, or roster redesign.
- Push, PR creation, merge, production fast-forward, or deployment.

## Rollback

Revert the single implementation commit. Evidence returns to Paths & Usage + always-git + null identity block. No migration, no schema change, no persistence.

## Handoff checklist for the implementing agent

- [ ] Read the design spec and open `mockup.html` before editing `app.js`.
- [ ] Fresh worktree from `origin/main`, empty `git status`.
- [ ] Red tests first.
- [ ] Five marks in `src/web/icons/`. CSS ported, no tiles.
- [ ] `renderEvidence` rebuilt. Sticky Evidence head gone.
- [ ] Route hydrates from debug `agent.trace`. Skipped tiers omitted.
- [ ] CWD-COPY-1 still green.
- [ ] Full `bun test` green. Typecheck green.
- [ ] One local commit. No push.
