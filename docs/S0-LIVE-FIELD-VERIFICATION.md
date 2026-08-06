# S0 live field verification

Measured read-only from the running board at
`http://127.0.0.1:4701/api/snapshot`. The captured HTTP 200 snapshot was
5,107,417 bytes, generated at `2026-08-06T03:19:29.974Z`, with a 36-hour scan
window. The server was not restarted.

One deployment fact changes how the wire result must be read: PID `55296`
started at `2026-08-05 19:43:31 CDT`, before `attentionClass` / `pulse.blocked`
landed at 21:12 (`365a958`) and consumption landed at 21:34 (`a018e29`). The
fresh snapshot therefore comes from a long-running process that has not loaded
those S0 commits.

> **R3 correction.** This sample proved that the original all-terms-observed
> publication gate could never pass on this machine. The raw measurement below
> is unchanged, but its consumption ruling is superseded: a known subtotal now
> publishes with same-population coverage and an optional-true floor flag. For
> this sample the corrected contract is `consumption: 75,786,036`,
> `consumptionReporting: 344`, `consumptionEligible: 384`, and
> `consumptionIsFloor: true` — rendered with a leading `≥`.

## Raw field verdicts

| Field | Live wire value | Verdict |
|---|---|---|
| `totals.consumption` | **Absent under the original gate** | **SAFE TO RENDER UNDER R3 AS A FLOOR.** Render `≥75,786,036` with `344/384` coverage; never present it as complete. |
| `attentionClass` | 34 live agents: 0 blocking, 0 noticed, **34 with the key absent** | **NOT SAFE TO RENDER.** This process predates the wire field; zero is not a measured class count. |
| `pulse.blocked` | **Absent** (`pulse` contains only `momentum`, `burn`, and `activity`) | **NOT SAFE TO RENDER.** The board has four current person-blockers, but the live process cannot publish their count yet. |
| `pulse.standbyMs` | **Absent**; zero keys anywhere in the snapshot | **SAFE TO RENDER AS ABSENT.** No dead-time duration is on the wire. |
| `blockedSince` | **Absent**; zero keys anywhere in the snapshot | **SAFE TO RENDER AS ABSENT.** No unsupported blocked-entry clock is on the wire. |

## Consumption gates and magnitude

- Session enumeration: all five source-health rows were healthy at the sample
  time (`controlHealth.errors: []`, `staleSources: []`). The completeness
  boolean is internal, so this corroborates rather than directly reads the
  gate; no live evidence says this gate failed.
- Scan window: known, `scanWindowHours: 36` and `lookbackHours: 36`.
- Terms: **partial**. Of 384 observed, non-retained sessions, 344 carried a
  finite `sessionTotal` with provenance `observed`; 40 did not: 38 Cursor, one
  Claude, and one Codex. Three missing Cursor terms were live (one working, two
  waiting), so aging finished rows out of the window would not make the total
  appear now.

The 344 reporting terms sum to the R3 publishable floor
`75,786,036` consumption tokens. Their independently named neighbors are
`3,296,702,408` cached-input tokens and `3,372,488,444` processed tokens; the
identity `consumption + cached input = processed` holds exactly. The same
snapshot's working-agent occupancy is `totals.tokens: 1,244,801`.

OpenBurnBar independently returned HTTP 200 for the exact snapshot window
`2026-08-04T15:19:29.974Z` through `2026-08-06T03:19:29.974Z`: source healthy,
`processedTokens: 3,098,282,466`, `tokensMissing: 0`, and 387 invocations. The
consumption floor is 60.88x occupancy and remains below both
processed readings (40.88x smaller than BurnBar; 44.50x smaller than the
board's complete-term subtotal). The two processed readings themselves differ:
the board subtotal is 274,205,978 tokens (8.85%) above BurnBar. Their populations
are not complete and aligned in this sample, so this proves only the requested
ordering, not cross-source equality. The direction is sane, but it cannot rescue
a complete total with 40 missing terms; under R3 it supports the labeled floor.

## Blocking population

The board's own live rollups showed `totals.needsYou: 4`, partitioned across
programs as `2 + 1 + 1`. The four raw rows were:

| Session | Live blocking evidence |
|---|---|
| `cursor:25d1d545-9fd4-46fa-b02b-133d268a1189` | `input-requested` |
| `claude:e8271e6e-f311-4d75-bd39-fa9a67f133d9` | `handoff-stated` |
| `claude:cb11c07d-11dd-4e3c-b01e-268593aca416` | `hookLifecycle: needsInput` |
| `claude:4a19673c-07b6-4ba5-b479-fbf784b2579c` | `hookLifecycle: needsInput` |

Applying the committed deterministic partition to those raw fields reconstructs
four blocking agents, exactly matching the four rows the board says need a
person. That is a plausible pre-deployment cross-check, not a live wire match:
the sampled wire contains neither the per-agent classes nor `pulse.blocked`.

**R3 verdict: render consumption only as `≥75,786,036 · 344/384 reporting` for
this measured population. Re-measure `attentionClass` and `pulse.blocked` after
a normal server restart; their live-wire verdict remains unchanged.**
