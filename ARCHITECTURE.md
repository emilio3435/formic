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

**Publishing.** `GET /api/publish` (`src/server/publish-state.ts`) answers what is finished but unpublished: the trunk's own backlog against `origin/<trunk>`, then each branch's commits that are not in the trunk. Measured separately on purpose — every branch descends from an unpublished trunk, so counting each against the remote reports the same commits a dozen times. Merged branches are counted, never listed; branches untouched for a fortnight are counted as stale so they cannot nag. Read-only, loopback-served, `no-store`, cached briefly, and there is no POST: the surface reports and never publishes.

**Debugging.** `GET /api/debug/identity` (`src/server/debug-identity.ts`, registered in `src/server/app.ts`) summarizes every agent's resolution/tier/conflict flags; `GET /api/debug/identity?agent=<id>` (query param because IDs like `claude:<uuid>` contain a colon) returns the full per-agent trace plus the raw evidence of every related surface. Read-only, loopback-served, `no-store`.

`GET /api/debug/session-calls?agent=<id>` (`src/server/session-calls.ts`) publishes one session's per-call processed sizes in transcript order, plus their prefix sums, re-derived from the raw transcript with the same parser that produced the agent. It exists to adjudicate a cross-source disagreement mechanically rather than by assumption: when a foreign total equals a **prefix** of this series the other side is simply behind, whereas one falling between call boundaries or exceeding the whole series is a real accounting difference. It publishes evidence and deliberately does not claim which side is right. The series is stripped when a `CollectedAgent` becomes an `AgentSnapshot`, so this re-reads on demand and whoever asks pays for it. Read-only, loopback-served, `no-store`.

## Controls

`src/server/snapshot-agent.ts` derives per-agent capabilities (`controlsFor`, called from `buildSnapshot`): focus/instruct/interrupt are enabled only for a routed (`exact`/`unique-cwd`), non-archived target; archive is always available once. `src/server/http.ts` guards `POST /api/control` (same-origin loopback Origin, JSON-only, size-capped, structured action set) and `src/server/control.ts` executes via cmux RPC (`surface.focus`, `surface.send_text` + `surface.send_key`, interrupt), propagating real exit codes and stderr. `src/server/broadcast.ts` fans an instruction out to many routed agents, behind the same 30-second snapshot-freshness gate as the single-control route. Archive persists through `src/server/archive.ts` so archived sessions survive the scan window.

## What the board decides to say

The pipeline above produces evidence. Turning it into the few things an operator
should read is a separate stage, and most of it does not live in `snapshot.ts`:

| Module | Decides |
|---|---|
| `lifecycle.ts` | The one place a session's lifecycle is decided (`classifyLifecycle`): Working, Waiting, Unverified, or Finished, plus the provenance saying why. Its governing rule is that absence of evidence is not evidence of an ending — a quiet session with no process to check is `unverified`, never finished. The rules live outside the code, in `tests/fixtures/lifecycle-truth-table.json`, so every implementation of them can be executed against the same table |
| `snapshot-agent.ts` | Per-agent view: capabilities (`controlsFor`), activity, outcome, `contextPct` |
| `snapshot-issues.ts`, `snapshot-operator-issues.ts` | What counts as a finding, and how identity conflicts split into live faults vs debris |
| `snapshot-programs.ts` | Grouping agents into programs and their rollups |
| `attention-signal.ts` | Whether an agent needs a human, and the sentence saying why. Ships as `attentionSignal` on the agent, carrying a kind and the evidence behind it, so a row quotes the agent rather than paraphrasing. A situation the detectors do not recognise stays `unknown` with no next action rather than emitting filler. The row's own summary line is `lastHumanMessage`, which is `string \| null` — `null` is preserved as absence, never rendered as an empty string. |
| `publish-state.ts` | What work is committed but unpublished. Read-only by construction: only `remote`, `rev-parse`, `rev-list` and `for-each-ref` are ever run, and publishing stays the operator's manual decision |
| `pulse.ts` | Momentum, burn rate, and the activity window behind the summary strip |
| `human-message.ts` | Readable prose out of a raw transcript. `readableHumanMessage` keeps a message's **first** 240 characters, because that is where it announces its subject and a row wants one line of it. `readableClosing` keeps the **last** 240, because an agent asks its question in the closing sentence — reading from the front discarded every one of them before the snapshot existed. Two reads of the same message, deliberately. |
| `triage.ts` | The investigation queue and the read-only Luna runs — see `TRIAGE-WORKFLOW.md` |
| `burnbar.ts`, `burnbar-query.ts` | Cost, read from an external encrypted OpenBurnBar database in an isolated subprocess |
| `model-config.ts` | Model families, context windows, and Cursor-native policy from `config/models.json` |
| `naming.ts` | What an agent is called. One ordered chain, first match wins: an operator alias outranks a name the launcher authored, which outranks the directory the session **began** in, which outranks its task line. Names freeze at origin because a transcript records cwd per entry — reading the latest let a name follow the shell, so one session renamed itself four times in four minutes and was published under a neighbouring lane's name. Uniqueness is a property of the fleet rather than of any session, so `disambiguate` is handed every agent at once and is the only thing permitted to append a session tag |
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

The board's five ops views are `needs-you`, `now`, `waiting`, `history` and
`usage` (`client-catalogs.js`). Membership is decided by `viewMatches` from the
lifecycle and scope the server publishes, never from a provider status word.
`waiting` also carries the collapsed Unverified group, which is deliberately
exempt from the display lookback — the lookback is a recency filter, and a
coverage disclosure that hides most of the gap is worse than none.

`app.js` holds the render tree and the board's own state machine. Around it:
`presentation.js` (pure derivations from a snapshot — the layer tests exercise
directly), `agent-model.js`, `client-state.js`, `dom-primitives.js` (`el`, icons,
SVG meters), `text-formatters.js`, `api-client.js` (fetch + envelope handling),
`client-catalogs.js`, `repaint.js`, `feed-freshness.js`, `transcript.js`,
`notifications.js`, and `action-log.js`.

`lifecycle.js` is the client's mirror of `src/server/lifecycle.ts`, and it is
the one module here that is deliberately a copy. The server publishes
`lifecycle` on every agent, but a snapshot can arrive without it, and when that
happens this client has to answer the same question — it used to answer it
differently, mapping a quiet session straight to "ended" with none of the
server's rescue for a process that is demonstrably alive. The duplication is not
the hazard; two *unverified* implementations were. Both are executed against
`tests/fixtures/lifecycle-truth-table.json` by `tests/lifecycle.test.ts` and
`tests/lifecycle-parity.test.ts`, so a rule that lands in one and not the other
fails immediately, by name.

`naming.js` is the same arrangement for a different question: a mirror of
`src/server/naming.ts`, not a second opinion. The server publishes each agent's
resolved identity, so on a current snapshot this file decides nothing — it
exists for archived rows written before that field did. Naming had already been
forked this way once and the fork was invisible: the server built a name from
the working directory while the client rebuilt a different one behind a
"contains · and is under 56 characters" heuristic, and an agent deliberately
named "Lifecycle Mapper" lost to the derived "Claude · the-mountain-main". So
the rules live in `tests/fixtures/naming-truth-table.json` and
`tests/naming-parity.test.ts` executes both copies against it.

`repaint.js` is small and load-bearing: it holds an indirection to `render()`
(`setRepaint` / `repaint`) so modules can ask for a repaint without importing
the render tree. `render()` was the dependency hub that made this client
impossible to split — every candidate module pulled the whole thing in until
that edge was cut.

All DOM wiring sits behind a `typeof document` check and the pure helpers are
exposed on `globalThis.TheAntHill`, so the whole client imports safely under Bun
— which is how `tests/web-client.test.ts` drives it without a browser.
