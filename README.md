# The Ant Hill

A local-first, light-mode command center for direct Codex, Claude, and Cursor Agent work across cmux. Retained OMP records are read-only history, not part of the runtime stack. This rebuild is isolated from the live Mountain v2 service in `~/mountain`.

## Run locally

**Day to day (this is the whole workflow):**

```bash
bun start
```

That one command: reuses Ant Hill if it’s already up, otherwise starts it (prefers a cmux workspace, falls back to this shell). It prints the address it bound — `bun start` defaults to <http://127.0.0.1:4701>, which is also the launchd production port. If production is already up, `bun start` reuses it rather than starting a second server. For an isolated copy, use `bash scripts/anthill-preview.sh` (4710–4719) or `MOUNTAIN_PORT=4710 bun start`. Use whichever address it prints.

Ports: **4701** is the default for both `bun start` and `bun run start:server`, and is the launchd production port — see `DEPLOY.md`, which forbids launching anything on 4701 by hand. Previews use **4710–4719** via `scripts/anthill-preview.sh`.

### Every script, and which ones bind a port

| Script | Does | Port |
|---|---|---|
| `bun start` | The whole workflow — reuses a running instance, else starts one | 4701, reused if taken |
| `bun run start:ops` | Same, forced into the dedicated cmux workspace | 4701 |
| `bun run start:external` | Same, forced into **this shell** rather than cmux | 4701 |
| `bun run start:server` | The server alone, no launcher | 4701, **no reuse** |
| `bun run dev` | The server alone, restarting on file change | 4701, **no reuse** |
| `bun run setup:cmux` | One-time cmux password setup | — |
| `bun run check` | `typecheck` then `test` — the gate `anthill-deploy.sh` runs | — |
| `bun run test` / `typecheck` | Either half of it | — |

Two of these will surprise you. **`start:external` does not bind externally** — it
means "run in this shell instead of a cmux workspace", and the server is
hardcoded to `127.0.0.1` with no override, so nothing here can serve the network.
And `dev` / `start:server` take 4701 without checking, so with the launchd
service up they exit immediately:

```
error: Failed to start server. Is port 4701 in use?  code: "EADDRINUSE"
```

That is the safe outcome, not a bug — they refuse rather than fighting
production for the port. For an instance you can actually run alongside it, use
`bash scripts/anthill-preview.sh` or `MOUNTAIN_PORT=4710 bun run dev`.

**Optional, once per machine** — only if you want Focus/Send:

```bash
bun run setup:cmux
```

That saves a local cmux password so Ant Hill can see terminal names and use Focus/Send even when started outside cmux. It requires cmux to be installed. Without it, Ant Hill still starts and collects normally; the controls stay disabled and the health card reads **Blocked**, naming the consequence (`cmux unreachable — Focus and Send cannot route.`) and what to do about it.

## Safety model

- Source session IDs and exact recorded working directories are preserved.
- cmux targets resolve from exact session/process evidence first and a unique cwd only as fallback.
- Ambiguous or missing targets have disabled controls with a visible reason.
- Controls accept a small structured action set and propagate the real cmux exit code and stderr.
- Mutating requests require an exact same-origin loopback `Origin`; arbitrary shell/spawn commands are outside the API.
- Operator-attention state combines unread cmux notifications with signals read from the agent's own text (`src/server/attention-signal.ts`). Each agent carries an `attentionSignal` kind and the evidence behind it, so a row quotes the agent rather than paraphrasing it. A situation the detectors do not recognise stays `unknown` with no next action, rather than emitting filler.
- Archived cards retain their compact source record after the original provider file leaves the live scan window.

## Data truth

- Cursor Agent cards merge direct-CLI chat metadata with GUI agents from Cursor's local conversation index, project-membership state, model tracking, transcripts, and subagent records.
- Cursor child-agent transcripts are first-class parent-linked records. Reported Cursor-native models (Grok and Composer families, per `config/models.json` `cursorNativeFamilies`) are compliant, reported non-native models are violations, and missing model evidence stays visibly unverified.
- Cursor token totals and cost remain visibly unknown because the local Cursor records do not expose authoritative billing totals.
- Cursor GUI cards expose data only. Their cmux actions require exact terminal identity and never use cwd-only fallback.
- Injected agent instructions and transport envelopes are excluded from task names. Primary labels use the real assignment; source session IDs remain in card details.
- A source cwd of `~` stays visible as source truth. Presentation grouping may use configured task hints or an exact cmux surface, but never changes control routing.
- OMP is not an Ant Hill launch dependency. Its collector is archived, read-only compatibility for historical session records and can never appear as active runtime work.
- The fleet glance is context, not raw tokens: peak and median `contextPct` across live sessions, reported together because a peak alone hides whether one agent or the whole fleet is loaded. `contextPct` is omitted rather than guessed when the window or token scope cannot support it. `totals.tokenMedian` (median latest request) is still in the payload; per-session cumulative totals stay in details and never inflate current-request usage.
- Cost comes from OpenBurnBar and reads `unavailable` when the source has nothing for a window — never `$0`. An empty window and a broken query must not look alike.
- The health verdict answers three things or it does not earn its place: whether anything is wrong, how bad, and what to do. If it claims something is wrong it names a next step; only a clear board is allowed to be silent. Faults that impair operation now live in `controlHealth.errors`; leftovers nobody needs to act on — a cmux pane whose sessions have all ended — go to `controlHealth.debris` with their own remedy, so tidying never reads as an outage.

## Summary message contract

`AgentSnapshot.lastHumanMessage` is `string | null`. Collectors choose the latest provider-shaped assistant or user prose after removing tool calls, diffs, structured envelopes, citations, commands, paths, and injected instructions; they then fall back to task text and a concise status reason. `null` is preserved as absence. The row helper `formatLastHumanMessage` bounds the display text and renders `No readable message yet` for null; `transcriptTail` is never row summary text, but it is no longer inspector-only: it is the primary input to the attention detectors.

Two different reads of the same message, deliberately. A row preview keeps the **first** 240 characters (`readableHumanMessage`) because that is where a message announces its subject. Attention detection keeps the **last** 240 (`readableClosing`) because an agent asks its question in the closing sentence, after the explanation — reading from the front discarded every one of them before the snapshot existed.

## Verification

`bun run check` runs strict TypeScript plus the collector, identity, routing, notification, archive, snapshot/SSE, control, lifecycle, web-client, and HTTP-boundary tests.

The exact 2026-07-22 commands, point-in-time results, browser checks, disposable cmux control proof, and review verdicts are preserved in [VERIFICATION-2026-07-22.md](./docs/history/VERIFICATION-2026-07-22.md). It is a
point-in-time record, not the current verification standard — the live gate is `bun run check`.

Usage and cost analytics are served from OpenBurnBar via `/api/usage/*` (see `src/server/burnbar.ts`). The superseded 2026-07-22 plan for a local analytics store is archived at [TOKEN-ANALYTICS-PLAN.md](./docs/history/TOKEN-ANALYTICS-PLAN.md); it describes an architecture the code did not take.

The direct, coordinated, and investigation flow—including explicit read-only Luna launch and persisted run states—is in [TRIAGE-WORKFLOW.md](./TRIAGE-WORKFLOW.md).

The live v2 launch agent, port 4700, and files under `~/mountain` remain unchanged.

Ant Hill itself runs on 4701 as a launchd agent (`ai.imaginethat.anthill`, `KeepAlive`), deployed by `scripts/anthill-deploy.sh` — see `DEPLOY.md`.
