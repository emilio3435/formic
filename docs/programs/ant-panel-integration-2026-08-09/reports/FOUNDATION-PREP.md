# Foundation Luna Preparation

Status: implementation-ready handoff only. This file is the sole change in
this preparation pass. Parser commits, `LANE-REPORT-parser.md`, and
`.lane-evidence/` are preserved; no product or test code was edited.

## Gate before implementation

Foundation Luna may start only after both conditions are explicit:

1. The OBB auditor reports `OBB CLEAR`, including the restored 24-hour
   OpenBurnBar evidence gate. This prep does not inspect or alter OBB state.
2. The integration owner produces the reconciled Prime/refiner/pricing
   checkpoint from the dirty integration checkout and confirms its full gate.

The current integration checkout is not that checkpoint: read-only inspection
found `/Users/emilionunezgarcia/Developer/the-mountain-main` on
`chore/docker-local-ci` at `6678e6530aaf83b89b6eb4fd0c7452348fca7b07`, ahead of
its remote by six commits, with broad tracked and untracked Prime/refiner,
UI, test, and documentation changes. Do not implement Foundation against that
dirty snapshot.

## Exact future fence

Foundation Luna owns only these paths after the gate clears:

- `src/shared/types.ts`: add optional `AgentSnapshot.rawTask` immediately beside
  `task?: string` in `AgentSnapshot` (`:346-364` in the current source).
- `src/server/snapshot.ts`: the refined-task sidecar seam only, currently the
  `taskSummaryRoot` input around `:130` and the `refinedTask`/`publishable`
  block around `:493-507`. Preserve all unrelated integration-owner hunks.
- `tests/refined-task-publish.test.ts`: create the focused server publication
  contract test.

The parser fence is already landed in `src/web/presentation.js` and
`tests/task-envelope.test.ts`; do not reopen it. `src/web/app.js`,
`src/web/transcript.js`, `src/web/styles.css`, and `tests/web-client.test.ts`
belong to later UI/Chat lanes.

## Named red tests

Create and run `bun test tests/refined-task-publish.test.ts` red before the
server/type change. The minimum approved claims are:

1. **Sidecar landed:** a nonterminal source with raw `task` and a summary file
   publishes refined `task` plus `rawTask` equal to the original raw envelope.
2. **No sidecar:** raw `task` remains unchanged and `rawTask` is absent.
3. **No source task:** a summary may publish refined `task`, but `rawTask` is
   absent; never invent an envelope.
4. **Sidecar not applied:** terminal or empty/unreadable sidecar behavior stays
   as the current seam defines it; no `rawTask` appears unless the sidecar
   actually replaced `task`.

Keep the existing `tests/task-refiner-launch.test.ts` expectations intact. The
current integration checkout already asserts refined `task` and
`lastHumanMessage` at `:49-59`; that dirty integration-owned test is not part
of this lane's fence.

## Data-flow contract

1. Collectors produce `CollectedAgent.task` (`src/server/types.ts:18-70`) as
   the provider's raw task envelope. `buildSnapshot` removes only server-only
   fields from `source`, leaving the source task in `publishable`.
2. The current dirty integration seam reads
   `data/task-summaries/<source.id with :/\\ replaced by _>.txt`, trims it,
   takes at most 120 characters, and only applies it to nonterminal agents.
   Missing, unreadable, or empty sidecars leave the source task untouched.
3. When `refinedTask` is truthy, publish both `task: refinedTask` and
   `rawTask: publishable.task` only when the original source task is present.
   `rawTask` is the original envelope, not the refined text and not a 120-char
   slice. When no replacement occurs, omit `rawTask` entirely.
4. Later Task UI consumes `rawTask` for parser metadata and the closed Full
   brief, while `task` is the refined face text. Foundation publishes the wire
   contract only; it does not change the drawer.

## Conflict risks and unresolved questions

- `src/server/snapshot.ts` is directly dirty in the integration checkout
  (20 additions, 1 deletion in the current sidecar/Prime work). Reconcile and
  re-read that exact block before applying the additive `rawTask` spread; do
  not overwrite the owner’s imports, task-refiner seam, or adjacent changes.
- `src/shared/types.ts` currently has no `rawTask`, and no current main source
  reference does. The field must remain optional and additive so old snapshots,
  archived rows, and agents without sidecars retain their current shape.
- Server sender verification reads the source task in
  `src/server/sender-verification.ts:44-66` before publication. The client
  fallback in `src/web/presentation.js:697-717` reads published `agent.task`
  when `lastUserMessage` is absent. Once `task` becomes refined, that fallback
  can lose the headed raw claim while the server still verifies the raw source.
  The later UI lane must either consume `rawTask` for this fallback or produce
  direct evidence that the fallback case is impossible. Foundation must not
  expand into `app.js` or sender policy without the integration owner’s gate.
- Existing clients currently render `agent.task` directly in the drawer
  (`src/web/app.js:9622-9635`), carry it into Chat
  (`:10676-10690`), and use it for row summaries (`:7860-7867`). Those are
  intentional later-lane consumers, not Foundation edits.
- Snapshot payload size increases for refined agents because the raw envelope
  is retained alongside the 120-character refinement. The integration owner
  must keep the existing SSE/full-gate size checks active.
- OBB state, the reconciled Prime checkpoint, the final sidecar semantics after
  reconciliation, and whether sender fallback needs `rawTask` are not proven
  here. Treat each as an explicit gate or owner decision, not an assumption.

## Future lane command floor

Run from the future Foundation worktree, after the two gates and after reading
the reconciled source:

```bash
git status --short --branch
git diff -- src/server/snapshot.ts src/shared/types.ts
bun test tests/refined-task-publish.test.ts
bun test tests/task-envelope.test.ts tests/refined-task-publish.test.ts
bunx tsc --noEmit
git diff --check
```

The final focused Foundation floor is the two-suite Bun command plus the
typecheck and whitespace gate. The integration owner must independently rerun
the same floor and the program’s full `bun run check`, preserving the
non-vacuous OpenBurnBar cross-source test. If local `bunx` again lacks its
dependency environment, report that as unavailable and use the installed
integration-toolchain verifier rather than claiming a green local typecheck:

```bash
/Users/emilionunezgarcia/Developer/the-mountain-main/node_modules/.bin/tsc \
  --noEmit \
  -p /Users/emilionunezgarcia/Developer/the-mountain.worktrees/ant-task-parser-luna/tsconfig.json \
  --typeRoots /Users/emilionunezgarcia/Developer/the-mountain-main/node_modules/@types
```

No implementation, commit, push, deploy, restart, browser action, main
checkout mutation, or OBB action is authorized by this preparation handoff.
