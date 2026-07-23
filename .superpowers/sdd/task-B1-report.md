# Task B1 completion report

## Commit

- Worktree: `/Users/emilionunezgarcia/Developer/the-mountain-lanes/luna-inspector-totem`
- Branch: `ant-hill/luna-inspector-totem-20260722`
- Commit: `bc57514 feat(server): per-source lastHealthyAt + POST /api/recollect`
- Not pushed.

## Final type contract

The landed snapshot already exposed an aggregate `SourceHealthSummary`. The backend preserves that aggregate and adds an additive provider detail map:

```ts
export interface SourceHealth {
  healthy: boolean;
  lastHealthyAt: string | null;
}

export interface SourceHealthSummary {
  healthy: number;
  degraded: number;
  total: number;
  byProvider?: Record<Provider, SourceHealth>;
}
```

`byProvider` keys are `omp`, `codex`, `claude`, and `cursor`. `HubState` and `emptySnapshot()` always emit all four entries. Each entry starts as `{ healthy: false, lastHealthyAt: null }`. A provider collect with no errors sets `healthy: true` and records an ISO timestamp. A later failed collect sets `healthy: false` while preserving the previous `lastHealthyAt`. The TypeScript property is optional only to preserve compatibility with older hand-built snapshots and fixtures that contain the pre-B1 aggregate shape.

## Route contract

`POST /api/recollect` accepts no body and triggers `state.refresh({ cmux: true })`, which runs the full session, cmux, notification, identity, decoration, and pulse path.

- Success: `200`, JSON body is the fresh decorated `HubSnapshot`, identical in shape to `GET /api/snapshot`; response is `no-store`.
- Concurrency: concurrent POSTs share one in-flight refresh promise. The collector runs once and every caller receives the same fresh snapshot. No in-flight `503` response is returned.
- Refresh failure: `500` JSON body `{ "ok": false, "error": { "code": "RECOLLECT_FAILED", "message": "<message>" } }`; the shared in-flight slot is cleared so a later request can retry.
- Existing app shutdown behavior remains: requests after disposal receive `503`.

## Files changed

- `src/shared/types.ts` — `SourceHealth`, additive `SourceHealthSummary.byProvider`.
- `src/server/state.ts` — per-provider timestamp state, success/failure preservation, initial and refreshed snapshot wiring.
- `src/server/app.ts` — single-flight recollect state and `POST /api/recollect` route; empty snapshot defaults.
- `tests/state-health.test.ts` — `per-source health timestamps set on success and survive later failure`.
- `tests/app-lifecycle.test.ts` — `POST /api/recollect returns the fresh snapshot after one full refresh`; `concurrent POST /api/recollect requests share one in-flight refresh`.

No files under `src/web/` or `tests/web-client.test.ts` were changed.

## Verification

`bun run check` tail:

```text
 240 pass
 0 fail
 922 expect() calls
Ran 240 tests across 20 files.
```

`bunx tsc --noEmit` passed as part of `bun run check`. `git diff --check` passed before commit. The committed worktree is clean.

## Concern / assumption

The landed code had only the aggregate `SourceHealthSummary`; it did not contain the per-source objects referenced by the brief. The additive `byProvider` map is the minimal compatibility-preserving location for the required `SourceHealth.lastHealthyAt` contract. Frontend consumers should read `snapshot.totals.sourceHealth?.byProvider?.[provider]?.lastHealthyAt` and continue using the aggregate counts for verdict totals.

## Review fix — same-origin guard and error contract

Commit: `ad4a950 fix(server): same-origin guard + error contract for /api/recollect`

The recollect route now applies the same exact-origin loopback guard as the other mutating endpoints:

- `127.0.0.1`, `localhost`, and `[::1]` are accepted only when the `Origin` header exactly equals the request URL origin.
- Rejected requests return `403` with `{ ok: false, error: { code: "ORIGIN_REJECTED", message } }`.
- Rejected requests do not call `state.refresh()`.
- Refresh failures return `500` with `{ ok: false, error: { code: "RECOLLECT_FAILED", message } }`.
- The existing `.finally()` cleanup clears the single-flight slot, so a failed request can be retried successfully.

Focused regression tests in `tests/app-lifecycle.test.ts`:

- `POST /api/recollect rejects cross-origin requests without refreshing`
- `failed POST /api/recollect returns the error envelope and allows a retry`

TDD evidence:

- Before the fix, the new tests failed with `200` instead of `403` and with the prior bare `{ error }` response.
- After the fix, `bun test tests/app-lifecycle.test.ts` passed: `6 pass`, `0 fail`, `27 expect() calls`.
- Full `bun run check` passed: `242 pass`, `0 fail`, `931 expect() calls`, `Ran 242 tests across 20 files`.
- No push performed.
