# The Ant Hill — Architecture

How a provider transcript on disk becomes a controllable agent row in the dashboard. The pipeline is: **collectors → refresh loop → identity enrichment → target resolution → controls**. Every stage is fail-closed: when evidence is ambiguous the agent stays visible but its controls stay disabled, with the reason attached.

## Collectors

`src/server/collectors.ts` harvests provider sessions from their on-disk layouts — OMP (`~/.omp/agent/sessions/…`), Codex (`~/.codex/sessions/…rollout-…`), Claude (`~/.claude/projects/…`), and Cursor via `src/server/cursor.ts` — inside the configured scan window (`data/settings.json`, default 36h). Each transcript parses into a `CollectedAgent` (`src/server/types.ts`): source session ID, cwd, status, tokens, transcript tail. In parallel, `src/server/cmux.ts` discovers live cmux terminal surfaces (`CmuxSurface`: surfaceId/workspaceId/paneId, cwd, tty, git state) and unread notifications over the cmux RPC socket (`src/server/cmux-auth.ts` handles auth outside a cmux shell).

## Refresh loop

`src/server/state.ts` (`HubState`) owns the cycle. `src/server/index.ts` ticks it every 4 s; every 5th tick (and every control/settings/recollect action) also refreshes cmux. A refresh collects sessions, optionally re-discovers cmux surfaces, runs identity enrichment, updates the sticky binding store, bridges binding-backed agents, then hands everything to `src/server/snapshot.ts` (`buildSnapshot`), which attaches targets and delegates the verdicts: per-agent fields to `snapshot-agent.ts`, program grouping to `snapshot-programs.ts`, issue construction to `snapshot-operator-issues.ts`, issue lifecycle to `snapshot-issues.ts`, and "why does this want a human" to `attention-signal.ts`. `state.ts` then wraps the result with `withPulse` (`pulse.ts`) before publishing — the snapshot a subscriber sees is not what `buildSnapshot` returned.

Subscribers (the SSE stream in `src/server/app.ts`) get a full snapshot on connect and a **delta** thereafter (`snapshotDelta`), pushed only when the sha256 digest of `snapshotFingerprint` changes (`compactSnapshotFingerprint`). `generatedAt`, `controlHealth.lastCheckedAt`, and `elapsedMs` are excluded from that fingerprint so a quiet fleet does not churn the stream. `identityTrace` is not excluded so much as unreachable: it is a non-enumerable lazy getter, so ordinary serialization never constructs debug evidence at all.

## Identity enrichment

`src/server/identity.ts` (`enrichCmuxIdentity`) links surfaces to sessions with live process evidence:

1. `ps -axo pid=,tty=,command=` maps each surface tty to its processes.
2. For recognized agent processes, `/usr/sbin/lsof -a -p <pids> -Fn` lists open files; paths matching a provider session layout (`identityFromSessionPath`) are exact identity evidence. Parent/child rollouts reduce to the root identity.
3. Failing that, command-line hints (`codex resume <uuid>`, `--resume`, cmux resume scripts) resolve via `identitiesFromCommand`.

Exactly one surviving identity sets `surface.sourceSessionIds`. Conflicting evidence on one tty sets `surface.identityConflict` and clears the session IDs — the fail-closed guard that quarantined 30 agents in the 2026-07 incident (`…/the-mountain-main/data/investigations/1784703451068-system-cmux-identity-conflicts.md`), by design.

**Evidence trace.** Every scan now records what it saw per surface in `surface.identityTrace` (`SurfaceIdentityTrace`, `src/shared/types.ts`): tty, per-pid commands and whether each was recognized, which open file paths matched which provider pattern, which command hints fired and how prefixes resolved, and the outcome (`open-file-match`, `command-hint-conflict`, `no-evidence`, …).

## Target resolution

`src/server/targets.ts` (`resolveAgentTargetWithTrace`; `resolveAgentTarget` is its target-only wrapper) resolves each agent to at most one cmux surface, strictest tier first:

1. **recorded** — `agent.recordedTarget` IDs (today: archive copies and sticky-binding bridges) match exactly one ready surface.
2. **session** — the agent's source session ID appears on exactly one surface's `sourceSessionIds`.
3. **unique-cwd** — fallback, only when this is the *only* active source with that cwd and there is exactly one unclaimed surface with that exact cwd.

Anything else is `ambiguous` (controls disabled, reason shown) or `missing` (view-only). Any `identityConflict` on a candidate surface quarantines the agent at whichever tier observed it — bindings never override that. Each resolution also emits an `IdentityTrace` (attached as `agent.identityTrace`): one step per tier with the concrete reason it matched, passed, or failed, plus binding-bridge details.

**Sticky bindings.** `src/server/identity-bindings.ts` persists every lsof-confirmed session↔surface link to `data/identity-bindings.json` (same atomic write-temp-rename + serialized write queue as `src/server/archive.ts`). When a later scan yields no evidence for a known session (single-sample lsof race), the binding bridges the gap through `agent.recordedTarget` (`reason: "Recorded binding, live evidence absent this scan."`), keeping resolution exact instead of degrading to cwd fallback. Bindings only fill gaps: live evidence outranks them; a session confirmed on a different surface demotes the old binding only after 2 consecutive scans agree; a bound surface reclaimed by another session is never bridged; a conflicted surface still quarantines; entries unconfirmed for 7 days prune on load/save.

**Debugging.** `GET /api/debug/identity` (`src/server/debug-identity.ts`, registered in `src/server/app.ts`) summarizes every agent's resolution/tier/conflict flags; `GET /api/debug/identity?agent=<id>` (query param because IDs like `claude:<uuid>` contain a colon) returns the full per-agent trace plus the raw evidence of every related surface. Read-only, loopback-served, `no-store`.

## Controls

`src/server/snapshot-agent.ts` derives per-agent capabilities (`controlsFor`, called from `buildSnapshot`): focus/instruct/interrupt are enabled only for a routed (`exact`/`unique-cwd`), non-archived target; archive is always available once. `src/server/http.ts` guards `POST /api/control` (same-origin loopback Origin, JSON-only, size-capped, structured action set) and `src/server/control.ts` executes via cmux RPC (`surface.focus`, `surface.send_text` + `surface.send_key`, interrupt), propagating real exit codes and stderr. `src/server/broadcast.ts` fans an instruction out to many routed agents, behind the same 30-second snapshot-freshness gate as the single-control route. Archive persists through `src/server/archive.ts` so archived sessions survive the scan window.

## What the board decides to say

The pipeline above produces evidence. Turning it into the few things an operator
should read is a separate stage, and most of it does not live in `snapshot.ts`:

| Module | Decides |
|---|---|
| `snapshot-agent.ts` | Per-agent view: capabilities (`controlsFor`), activity, outcome, `contextPct` |
| `snapshot-issues.ts`, `snapshot-operator-issues.ts` | What counts as a finding, and how identity conflicts split into live faults vs debris |
| `snapshot-programs.ts` | Grouping agents into programs and their rollups |
| `attention-signal.ts` | Whether an agent needs a human, and the sentence saying why |
| `pulse.ts` | Momentum, burn rate, and the activity window behind the summary strip |
| `human-message.ts` | Readable prose out of a raw transcript — the row preview reads a message's first 240 characters, attention detection reads its last 240 |
| `triage.ts` | The investigation queue and the read-only Luna runs — see `TRIAGE-WORKFLOW.md` |
| `burnbar.ts`, `burnbar-query.ts` | Cost, read from an external encrypted OpenBurnBar database in an isolated subprocess |
| `model-config.ts` | Model families, context windows, and Cursor-native policy from `config/models.json` |
| `program-aliases.ts`, `settings.ts` | Operator-set names and the scan window, persisted under `data/` |
| `command.ts` | The child-process runner every shell probe goes through; its timeout always settles |

**Faults versus debris.** `controlHealth.errors` holds only what impairs
operation *now*; anything the operator cannot act on, or that costs nothing
until they do, goes to `controlHealth.debris` instead. The distinction matters
because a non-empty `errors` forces a Degraded verdict — so a permanent entry
there is a permanently red board and an operator trained to ignore it. A cmux
pane whose sessions have all ended holds its transcript handles open forever;
that is debris, and it carries its own `remedy` string rather than an alarm.

`classifyIdentityConflicts` (`snapshot-operator-issues.ts`) draws that line on
live impact, not age: a conflicted surface with a live session on it is a fault,
one where every session has ended is debris. No threshold to tune, and it
self-heals — reopen work in that pane and the next scan calls it a fault again.

**Health endpoint.** `GET /api/health` reports the server's own verdict on
itself — snapshot age, collector state — on a slower clock than the board's.
`scripts/anthill-deploy.sh` gates every deploy on it.

## Client

`src/web/` is a dependency-free ES-module browser client; `index.html` loads
`app.js`, which imports the rest. There is no build step — the server serves the
files as they are on disk.

`app.js` holds the render tree and the board's own state machine. Around it:
`presentation.js` (pure derivations from a snapshot — the layer tests exercise
directly), `agent-model.js`, `client-state.js`, `dom-primitives.js` (`el`, icons,
SVG meters), `text-formatters.js`, `api-client.js` (fetch + envelope handling),
`client-catalogs.js`, `repaint.js`, `feed-freshness.js`, `transcript.js`,
`notifications.js`, and `action-log.js`.

`repaint.js` is small and load-bearing: it holds an indirection to `render()`
(`setRepaint` / `repaint`) so modules can ask for a repaint without importing
the render tree. `render()` was the dependency hub that made this client
impossible to split — every candidate module pulled the whole thing in until
that edge was cut.

All DOM wiring sits behind a `typeof document` check and the pure helpers are
exposed on `globalThis.TheAntHill`, so the whole client imports safely under Bun
— which is how `tests/web-client.test.ts` drives it without a browser.
