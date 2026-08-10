# Ant Hill Panel Integration Program

Goal: Land the structured TL;DR, durable Prime task refiner and pricing work, Task widget anatomy, and mini-chat transcript feed as one locally verified Ant Hill release.

Success means:
- Existing commit `0472d7c` remains the structured TL;DR implementation.
- The current Prime/refiner/pricing work becomes a clean checkpoint only after the full repository gate is green.
- Task-envelope parsing and `rawTask` publication land as a separate foundation commit.
- The existing Claude/Opus chat lane integrates mini-chat first; a later Luna UI lane adds Task anatomy without regressing TL;DR rendering.
- The integration owner runs every focused floor and the full repository gate directly.
- One guarded Ant Hill deploy occurs after all commits are integrated, followed by health, live-browser, and task-refiner ledger evidence.

Stop when: Local `main` contains the integrated commits, the guarded deploy is healthy, and the ledger report records sessions, tokens, actual cost availability, list-price estimate, and Sol counterfactual savings; stop earlier if an Emilio-only decision blocks a hard gate.

## Locked decisions

- Ship the three visible lane outcomes together: structured TL;DR, Task widget redesign, and mini-chat feed.
- Include the already reconciled Prime/refiner/provider-pricing work in the same release.
- Preserve coherent commits and deploy once; "together" means one release, not one squashed commit.
- Reuse the already-active Claude/Opus mini-chat lane as directed; use fresh GPT-5.6 Luna lanes for the remaining deterministic implementation and verification work to control cost.
- Keep one integration owner. Existing long-context planning sessions remain handoff-only.
- Keep `src/web/app.js`, `src/web/styles.css`, `src/web/transcript.js`, and `tests/web-client.test.ts` under a serial UI fence: the existing Chat Opus lane finishes before Task UI Luna starts.
- Preserve the non-vacuous OpenBurnBar cross-source test. The integration owner will not weaken or skip it.
- Keep all work local. No push or PR is authorized by this program.
- A targeted `com.openburnbar.daemon` restart was authorized and completed. OBB reinstall is operator-owned; continue only OBB-independent slices until its 24-hour evidence gate returns.
- While OBB reinstalls, land the durable program documents and pure Task-envelope parser. The existing Chat Opus lane may implement and verify the RHS mini-chat in an isolated worktree, but its overlapping commit remains held until the current reconciled checkpoint is green. Hold `rawTask`, Task anatomy, final integration, and deploy behind the restored full gate.

## Architecture and dependency graph

The shared mutation funnel is the integration branch in `/Users/emilionunezgarcia/Developer/the-mountain-main`. Only the integration owner updates it.

1. Parser Luna - pure Task-envelope parser in an isolated worktree; OBB-independent and safe to land during reinstall.
2. Chat Opus - the existing RHS mini-chat session implements in a separate isolated worktree; OBB-independent to implement and verify, but held because `tests/web-client.test.ts` overlaps integration-owned dirty work.
3. Phase 0 - restore the external accounting verifier, run `bun run check`, and checkpoint the current reconciled work.
4. Integration owner - independently verify and land the held Chat Opus commit.
5. Foundation Luna - additive `rawTask` snapshot contract in an isolated worktree based on the checkpoint.
6. Integration owner - verify and land the foundation commit.
7. Task UI Luna - consume the landed chat and foundation commits, then add Task anatomy through the same serial drawer fence.
8. Integration owner - verify and land the Task UI commit.
9. Verifier Luna - read-only adversarial review and browser evidence against the integrated SHA.
10. Integration owner - full gate, local `main` fast-forward, guarded deploy, health checks, and ledger report.

The Chat Opus and Task UI Luna lanes are serial because both plans modify the same DOM builder, stylesheet integration layer, and client harness. Chat may run alongside the parser, but Task UI starts only from the landed chat and foundation commits.

## Ownership fences

### Foundation Luna

- `src/web/presentation.js`
- `src/shared/types.ts`
- the refined-task block in `src/server/snapshot.ts`
- `tests/task-envelope.test.ts`
- `tests/refined-task-publish.test.ts`

During the OBB reinstall, the parser sub-fence (`src/web/presentation.js` and `tests/task-envelope.test.ts`) lands first from its own worktree. The remaining server contract waits for the current reconciled checkpoint because `src/server/snapshot.ts` already carries integration-owned task-refiner changes.

### Chat Opus

- `src/web/app.js`
- `src/web/transcript.js`
- `src/web/styles.css`
- `tests/web-client.test.ts`

The Chat Opus commit is held outside the integration branch until the OBB-gated current checkpoint is green. Browser evidence remains integration-owned because the browser daemon is machine-global.

### Task UI Luna

- `src/web/app.js`
- `src/web/transcript.js`
- `src/web/styles.css`
- `tests/web-client.test.ts`
- Task browser evidence under `docs/rhs-shots/ant-panel-integration/`

### Integration owner

- Current dirty Prime/refiner/pricing changes and their tests/docs
- `0472d7c` compatibility
- lane commit verification and landing
- full suite, local `main`, launchd deployment, health, and ledger evidence

## Verification floor

Foundation:

```bash
bun test tests/task-envelope.test.ts tests/refined-task-publish.test.ts
bunx tsc --noEmit
```

UI:

```bash
bun test tests/task-envelope.test.ts tests/refined-task-publish.test.ts tests/web-client.test.ts tests/cwd-adversarial.test.ts tests/b2-render-proof.test.ts tests/overhaul-guards.test.ts
bunx tsc --noEmit
```

Integration:

```bash
bun run check
git diff --check
```

Live acceptance:
- Structured TL;DR cards still parse and link correctly.
- Five representative Task envelope shapes share one anatomy.
- Loaded transcripts render once as bubbles; empty/error/loading states remain honest.
- Browser evidence covers 1440px and 860px widths.
- `/api/health` is healthy after the guarded deploy.
- `python3 scripts/ant-hill-task-refine.py --report-ledger` reports the venture counters.
