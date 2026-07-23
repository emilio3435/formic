# Lane Report — fable-identity-20260723

Branch `ant-hill/fable-identity-20260723`, cut from main @ ea9966a. Goal: make the session↔surface identity chain inspectable and resilient (evidence trace, debug endpoint, sticky bindings, docs, tests).

## Commits

| Commit | Scope |
|---|---|
| `80cd183` | feat(identity): retain per-surface and per-agent identity evidence traces |
| `7c0e494` | feat(server): add read-only GET /api/debug/identity endpoint |
| `d9d3191` | feat(identity): persist sticky session-to-surface bindings |
| `a5f21f7` | docs: add ARCHITECTURE.md and fix README port drift (4702 → 4701) |
| `(this)`  | chore: lane report |

Not pushed; no merges. `bun.lock` has a pre-existing uncommitted modification from dep install — left untouched.

## Evidence

- `bun run check` green at every commit. Base: **295 pass**; final: **317 pass, 0 fail, 1329 expect() calls, 23 files** (`bunx tsc --noEmit` clean, TS strict).
- 22 new tests, existing tests untouched: `tests/identity-trace.test.ts` (7 — surface evidence for lsof match/conflict/command hint; tier trace for exact, cwd fallback, duplicate-cwd ambiguity, quarantine), `tests/debug-identity.test.ts` (4 — list, single agent, unknown-agent 404, POST falls through to API 404), `tests/identity-bindings.test.ts` (10 — fresh confirm via real enrichment output, re-confirm refresh, bridge on silent scan, live-evidence-outranks-binding, two-scan reassignment, conflict-stays-quarantined-with-binding, conflicted scans never record, HubState wiring end-to-end, store reopen, TTL pruning on load/save, corrupt-file fail-loud), plus 1 wiring test through `HubState.refresh`.
- Sample endpoint output (captured from a scratch run of the test fixture through `createMountainFetch`):

```json
GET /api/debug/identity
{
  "ok": true,
  "agents": [{
    "id": "claude:019f86c4-1558-7000-aeb8-26e2cfd0e8ec",
    "provider": "claude", "resolution": "exact", "tier": "session",
    "surfaceId": "SURFACE-HEALTH",
    "quarantined": false, "cwdMismatch": false, "bindingBridged": false
  }],
  "surfaceCount": 1, "conflictedSurfaceIds": []
}

GET /api/debug/identity?agent=claude:019f86c4-1558-7000-aeb8-26e2cfd0e8ec
{
  "agent": { "...summary": "...", "target": { "resolution": "exact", "surfaceId": "SURFACE-HEALTH" },
    "trace": { "matchedTier": "session", "steps": [
      { "tier": "recorded", "outcome": "skipped", "detail": "No recorded cmux target IDs on this source." },
      { "tier": "session", "outcome": "matched", "detail": "Source session ID 019f86c4-… recorded by cmux on surface SURFACE-HEALTH." } ] } },
  "relatedSurfaces": [{ "surfaceId": "SURFACE-HEALTH", "tty": "ttys033",
    "identityTrace": { "outcome": "open-file-match",
      "processes": [{ "pid": 4242, "command": "claude --resume", "recognizedAgentProcess": true }],
      "openFileMatches": [{ "pid": 4242, "path": "/Users/me/.claude/projects/p/019f86c4-….jsonl", "provider": "claude", "sessionId": "019f86c4-…" }] } }]
}
```

## Design decisions

1. **Traces are additive, resolution is untouched.** `resolveAgentTarget` became a thin wrapper over new `resolveAgentTargetWithTrace` so the returned `CmuxTarget` objects stay byte-identical (existing tests use exact `toEqual` on them). Surface evidence lives on `CmuxSurface.identityTrace`; the compact per-agent tier trace on `AgentSnapshot.identityTrace`. The full process/file dumps are NOT duplicated per agent — the debug endpoint joins agent trace + related surface traces at read time (via a new optional `MountainAppState.surfaces?()` accessor, implemented by `HubState`).
2. **`identityTrace` is excluded from `snapshotFingerprint`** (like `elapsedMs`) so evidence detail (pids, binding timestamps) never churns SSE pushes.
3. **Binding confirmation = lsof only.** Only surfaces whose trace outcome is `open-file-match` (single session, no conflict) record/refresh a binding; command hints and carried-over cmux metadata never move one. A session confirmed on two surfaces in one scan is contested and skipped.
4. **Bridge rules (fail-safe by construction):** bridging sets `agent.recordedTarget` (with `source: "binding"`, `reason: "Recorded binding, live evidence absent this scan."`) only when the agent is running/waiting, has no recordedTarget of its own, and the scan produced NO live evidence for the session. Live evidence always wins. A bound surface carrying exact evidence for a *different* session is a contradiction, not a gap — never bridged. A bound surface with `identityConflict` IS still bridged so tier 1 quarantines it visibly (binding can never un-quarantine; verified by test).
5. **Reassignment:** a scan showing the session exactly on a different surface increments `pendingReassignment` (reset if the candidate changes; cleared by re-confirmation of the current target); the binding moves only at 2 consecutive agreeing scans. A no-evidence scan leaves pending untouched (it neither agrees nor disagrees).
6. **Store:** `JsonIdentityBindingStore` copies `archive.ts`'s atomic write-temp-rename + serialized write-queue pattern, with injected file ops and clock for tests; 7-day TTL pruning on load and on save; corrupt records fail `open()` loudly (archive convention). Binding write failures surface in `controlHealth.errors` instead of breaking the refresh loop.
7. **`recordedTarget` extended** with optional `reason`/`source`/`confirmedAt` — the vehicle that makes targets.ts tier 1 live for active agents (previously dead code), exactly per the Luna diagnostic. Archive-written recordedTargets are unaffected.
8. **Endpoint uses `?agent=`** (not a path segment) because agent IDs contain a colon (`claude:<uuid>`); GET-only, `SECURITY_HEADERS` passed in from app.ts (avoids an import cycle), `no-store`, additive ~3-line route block in app.ts.

## Deferred / out of scope

- No UI for the debug endpoint or traces (lane is server-only by constraint).
- Bindings do not bridge sessions whose bound surface disappeared from discovery (tier 1 simply finds no match and falls through) — acceptable: cmux restart invalidates surface IDs anyway.
- The bridge-skip on a reclaimed surface (decision 4) is documented in ARCHITECTURE.md but not annotated as an explicit trace step; the related-surface evidence in the debug endpoint makes it visible.
- `collectors.ts`/`cursor.ts` token semantics, `control.ts` execution, triage/issue code, and all `src/web` files untouched per lane boundaries.
