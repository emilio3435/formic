# RHS-6 backend handoff

Commits: `3e870e5` and `716bddf` on `fix/backend-silent-failures-and-freshness`.

## Changed

- `src/server/control.ts`: disabled Send and Interrupt responses now recompute the same `transmitRefusal` used by advertised controls. The endpoint keeps its existing error code and returns the combined actionable message.
- `src/server/targets.ts`: `transmitRefusal` now separates cause, remedy, resolver steps, and scanned-surface observations. Each ready pane observation carries its pane/surface identity, reported session IDs, session and cwd match results, and the reason it did or did not match.
- `src/server/snapshot.ts`: active refused agents publish one `controlRefusal`; ended history rows do not repeat it. Identity traces remain lazy, and unsafe routing refusals include the ready surfaces actually scanned.
- `src/server/debug-identity.ts`: the on-demand evidence response returns every ready surface considered by routing, rather than filtering away the negative comparisons.

## Verified first-hand

- A direct production `GET /api/snapshot` before the change showed only `target.reason` plus repeated disabled-control conclusions; `controlRefusal` and `identityTrace` were absent on the live process.
- A direct isolated-preview `GET /api/snapshot` after the change showed the unbound Cursor session with 20 scanned panes, zero session-ID matches, and a concrete observation for every pane.
- A direct isolated-preview `GET /api/debug/identity?agent=...` returned the same 20 panes with zero missing pane/session/reason fields.
- The focused routing, refusal-shape, debug-identity, and endpoint-agreement tests passed: 66 passed, 0 failed. A scoped TypeScript check passed when the concurrent untracked frontend test was excluded.
- The measured preview snapshot grew from 1,346,415 to 1,401,799 bytes: +55,384 bytes, about 4.1%.

## Assumed or supplied, not remeasured here

- The existing SSE payload is 2.23 MB. That figure was supplied in the handoff request; this lane did not independently remeasure the production SSE frame.
- The frontend will consume the newly published observation shape. This backend lane did not edit `src/web/`.

## Left open

- The observation list is repeated under each active routing refusal. Against a 2.23 MB SSE payload, the +55 KB measurement warrants a follow-up that deduplicates the shared surface inventory or moves detailed observations fully on demand without losing operator-visible proof.
- Production was not restarted or deployed, so the live process still serves the pre-change shape until the normal deployment owner updates it.
- The full shared-tree gate remained red from pre-existing cross-source token drift and concurrent frontend liveness-copy work. No backend-focused regression failed.
- Concurrent frontend files, tests, and screenshots remain owned by their lanes and were not staged or altered here.
