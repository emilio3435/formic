# The Ant Hill — Architecture

How a provider transcript on disk becomes a controllable agent row in the dashboard. The pipeline is: **collectors → refresh loop → identity enrichment → target resolution → controls**. Every stage is fail-closed: when evidence is ambiguous the agent stays visible but its controls stay disabled, with the reason attached.

## Collectors

`src/server/collectors.ts` harvests provider sessions from their on-disk layouts — OMP (`~/.omp/agent/sessions/…`), Codex (`~/.codex/sessions/…rollout-…`), Claude (`~/.claude/projects/…`), Cursor via `src/server/cursor.ts`, and Factory via `src/server/factory.ts` (`~/.factory/sessions/<cwd-slug>/<uuid>.jsonl`, whose model and token usage live in a sibling `<uuid>.settings.json`) — inside the configured scan window (`data/settings.json`, default 36h). Each transcript parses into a `CollectedAgent` (`src/server/types.ts`): source session ID, cwd, status, tokens, transcript tail. Once per collection cycle, `src/server/cmux-hook-sessions.ts` also reads Claude/Codex/OMP records from `~/.cmuxterm/*-hook-sessions.json`; a valid record contributes its stable surface ID, cwd fallback, PID plus process-start check, direct hook lifecycle (`running`, `idle`, `needsInput`, `ended`, or `unknown`), and the hook's Unix timestamp normalized as `hookLifecycleAt`. The same cycle asks `process-lineage.ts` for one `ps -axo pid,ppid,lstart,command` table, validates hook PIDs against their start times, and walks exact parent PIDs to the nearest known agent ancestor. An `ended` hook becomes session-exit evidence; a negative process check paired with a cwd that no longer exists becomes `worktree-deleted` evidence, so deleted-worktree zombies reach the normal Finished state without weakening the rule that a negative process result alone proves nothing. In parallel, `src/server/cmux.ts` discovers live cmux terminal surfaces (`CmuxSurface`: surfaceId/workspaceId/paneId, cwd, tty, git state) and unread notifications over the cmux RPC socket (`src/server/cmux-auth.ts` handles auth outside a cmux shell). On the same cmux discovery tick it reads `extension.sidebar.snapshot` once for live workspace project roots, branches, dirty state, and pull-request links. It also reads each bound workspace's cached environment, retaining only `ANTHILL_RUN`, `ANTHILL_LANE`, `ANTHILL_ROLE`, and `ANTHILL_PARENT`; either auxiliary channel can fail without discarding a successful terminal scan.

## Refresh loop

`src/server/state.ts` (`HubState`) owns the cycle. `src/server/index.ts` ticks it every 4 s; every 5th tick (and every control/settings/recollect action) also refreshes cmux. After the initial full refresh, `src/server/cmux-events.ts` supervises `cmux events --cursor-file ~/.anthill/events.cursor --reconnect --category agent --category workspace` as a latency accelerator: an agent event requests a source refresh, while a workspace event, replay gap, or changed `boot_id` requests a full cmux snapshot. The child restarts after an unexpected exit and stops with the server. The 4 s polling loop remains the correctness reconciler, so a missing or malformed event can delay a view but cannot become its source of truth. A refresh collects sessions, optionally re-discovers cmux surfaces, reads run declarations through `src/server/run-manifests.ts`, runs identity enrichment, updates the sticky binding store, bridges binding-backed agents, then hands everything to `src/server/snapshot.ts` (`buildSnapshot`), which attaches targets and delegates the verdicts: per-agent fields to `snapshot-agent.ts`, program grouping to `snapshot-programs.ts`, issue construction to `snapshot-operator-issues.ts`, issue lifecycle to `snapshot-issues.ts`, and "why does this want a human" to `attention-signal.ts`. For current requests carrying a `[from … run …]` envelope, the refresh reads at most the final 1 MiB of the claimed sender's transcript and records whether that window covered the whole file. `sender-verification.ts` publishes `senderVerified: true` when the stable message head is present; a wire-truncated head may prove `true` from at least 100 matching characters after its U+2026 ellipsis is removed, but it can never prove `false`. A miss publishes `false` only after a stable whole-file read. Missing, unreadable, changing, and partial-miss evidence publishes no verdict — inability to check never becomes an accusation. `state.ts` then attaches `attentionClass` with `withAttentionClasses` and wraps the result with `withPulse` (`pulse.ts`) before publishing — the snapshot a subscriber sees is not what `buildSnapshot` returned.

Subscribers (the SSE stream in `src/server/app.ts`) get a full snapshot on connect and a **delta** thereafter (`snapshotDelta`), pushed only when the sha256 digest of `snapshotFingerprint` changes (`compactSnapshotFingerprint`). `generatedAt`, `controlHealth.lastCheckedAt`, and `elapsedMs` are excluded from that fingerprint so a quiet fleet does not churn the stream. `identityTrace` is not excluded so much as unreachable: it is a non-enumerable lazy getter, so ordinary serialization never constructs debug evidence at all.

**Repository and run grouping.** `src/server/repo-identity.ts` resolves a session cwd with cached `git rev-parse` and `git remote get-url origin` reads. The FNV key of the normalized origin host/path is shared by independent HTTPS and SSH clones as well as worktrees; a missing or unusable origin falls back to the previous FNV of the real git common directory. The real working-tree root and branch remain checkout facts, and disposable Codex/Claude/temp worktrees are marked rather than collapsed into unrelated projects. A live cmux sidebar project root and branch outrank the spawned-git reading for a bound workspace unless a manifest targets a different `repoRoot`; the declared target then supplies repository identity and unrelated live checkout branch, dirty, head, and PR facts are withheld. `run-manifests.ts` reads `~/.anthill/runs/*.json` and declared repositories' `.agent/runs` directories; a manifest binding outranks workspace `ANTHILL_*` variables, and either declaration outranks transcript parentage and role heuristics. `snapshot-programs.ts` still gives operator-authored `ProgramHint.match` rules first refusal. Otherwise git-backed agents use a repo section and a worktree leaf; every undeclared ephemeral worktree of one repo shares the `ephemeral` leaf labelled “disposable checkouts,” while a declared run replaces either kind of leaf with `run:<runId>`. Undeclared non-git sessions keep the previous cwd/program fallback, while a declared session whose process cwd is outside its target repository groups its run under that target repository.

**Session succession.** The manifest schema stays unchanged. Beside a global run manifest, the registration tool appends binding facts to `~/.anthill/runs/<runId>.history.jsonl`; `run-manifests.ts` reads each valid line independently and derives a lane's ordered session cycles from that log plus the manifest's current binding. Each predecessor/successor pair publishes `succeededBy`/`supersedes`. A predecessor receives `endEvidence: "superseded"` and therefore reaches Finished even if its process still answers; process state remains separate and can continue to say `running`. Missing history produces no succession claim, and a malformed line cannot erase other valid entries.

**Kernel lineage.** A snapshot publishes exact ancestry separately as `lineage.observedParentAgentId`, with `lineageAgreement` equal to `corroborated`, `contradicted`, or `unobserved`. Manifest/env and provider-native parent chains remain authoritative: matching kernel evidence corroborates them, conflicting evidence is exposed without re-parenting, and a failed or absent process observation stays unobserved. Only a session with no claimed chain adopts an observed parent; that adopted child evidence can give the parent the existing observed-orchestrator role.

**Role taxonomy.** `snapshot-agent.ts` publishes a role together with its source: `declared` from a manifest or workspace environment, `observed` from child evidence, or `inferred` from title/task prose. The session-role vocabulary is human, orchestrator, worker, verifier, tester, monitor, automation, and the unknown fallback agent. Frontend/backend are specialties on a worker rather than roles. A declared orchestrator needs no visible child; observed parentage also makes a session an orchestrator; title regexes are the lowest-confidence fallback. Human and monitor are declaration-only. Service is reserved for a cmux surface with no bound session, so such terminals are never synthesized into agent rows or counted as agents needing attention.

**Declared task state.** A manifest lane may pair `status: active | parked | done` with an ISO `statusAt`; either both fields parse or neither is believed. The snapshot publishes that evidence as `taskState`, `taskStateSource: "manifest"`, and `taskStateAt`, beside the hook's `hookLifecycleAt`. `src/server/task-state.ts` owns the attention-only precedence: undeclared and `active` lanes keep the existing `needsInput` behavior, while `parked` or `done` suppresses a hook recorded at or before the declaration; only a strictly newer `needsInput` re-alerts. `src/web/task-state.js` is the dependency-free mirror executed against the same truth table. This rule never enters `lifecycle.ts`, so declaring work parked or done does not claim that its process or session ended. Separately, `attention-signal.ts` emits `stalled-active` when a manifest still declares `active` and its hook has remained `idle` for strictly more than 30 minutes (overridable as `stalledActiveMinutes` in `data/settings.json`). A missing hook record or invalid/missing `hookLifecycleAt` makes no staleness claim; `running`, `needsInput`, `parked`, and `done` never qualify.

## Identity enrichment

`src/server/identity.ts` (`enrichCmuxIdentity`) links surfaces to sessions with live process evidence:

1. `ps -axo pid=,tty=,command=` maps each surface tty to its processes.
2. For recognized agent processes, `/usr/sbin/lsof -a -p <pids> -Fn` lists open files; paths matching a provider session layout (`identityFromSessionPath`) are exact identity evidence. Parent/child rollouts reduce to the root identity.
3. Failing that, command-line hints (`codex resume <uuid>`, `--resume`, cmux resume scripts) resolve via `identitiesFromCommand`.

Exactly one surviving identity sets `surface.sourceSessionIds`. Conflicting evidence on one tty sets `surface.identityConflict` and clears the session IDs — the fail-closed guard that quarantined 30 agents in the 2026-07 incident (`…/the-mountain-main/data/investigations/1784703451068-system-cmux-identity-conflicts.md`), by design.

**Evidence trace.** Every scan now records what it saw per surface in `surface.identityTrace` (`SurfaceIdentityTrace`, `src/shared/types.ts`): tty, per-pid commands and whether each was recognized, which open file paths matched which provider pattern, which command hints fired and how prefixes resolved, and the outcome (`open-file-match`, `command-hint-conflict`, `no-evidence`, …).

## Target resolution

`src/server/targets.ts` (`resolveAgentTargetWithTrace`; `resolveAgentTarget` is its target-only wrapper) resolves each agent to at most one cmux surface, strictest tier first:

1. **hook-store** — cmux's hook-session record names a stable surface ID that is present in the current ready-surface scan.
2. **recorded** — `agent.recordedTarget` IDs (today: archive copies and sticky-binding bridges) match exactly one ready surface.
3. **session** — the agent's source session ID appears on exactly one surface's `sourceSessionIds`.
4. **unique-cwd** — fallback, only when this is the *only* active source with that cwd and there is exactly one unclaimed surface with that exact cwd.

Anything else is `ambiguous` (controls disabled, reason shown) or `missing` (view-only). Any `identityConflict` on a candidate surface quarantines the agent at whichever tier observed it — bindings never override that. Each resolution also emits an `IdentityTrace` (attached as `agent.identityTrace`): one step per tier with the concrete reason it matched, passed, or failed, plus binding-bridge details.

**Durable links.** `GET /agent/<encoded-agent-id>/focus` (`src/server/agent-links.ts`, registered in `src/server/index.ts`) looks up the exact full agent ID and runs this resolver again, including the hook-store tier. A live, addressable result invokes the existing `surface.focus` control path and returns `{cmuxTarget}`. A terminal result never focuses its leftover pane; it returns `{transcriptPath}` from the hook record or collected transcript artifact instead.

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
| `lifecycle.ts` | The one place a session's lifecycle is decided (`classifyLifecycle`): Working, Waiting, Unverified, or Finished, plus the provenance saying why. Its governing rule is that absence of evidence is not evidence of an ending — a quiet session with no process to check is `unverified`, never finished. An ended hook, a manifest successor, or the paired facts “process gone” and “cwd deleted” are affirmative retirement evidence. The rules live outside the code, in `tests/fixtures/lifecycle-truth-table.json`, so every implementation of them can be executed against the same table |
| `process-witness.ts` | What the board has witnessed about a session's process, persisted to `data/process-witness.json` so a restart stops erasing it. Process ids are only observable while a process is running, and they used to live in memory alone — so every kickstart destroyed the evidence that made a session's ending provable, and the board read 36 hours of transcripts having been up for minutes. Records carry the boot they were observed in, which is also what makes them safe: pids from an earlier boot cannot be live, so a witness from a previous boot *proves* the process is gone rather than merely dating it |
| `process-lineage.ts` | One injectable, per-collection process-table read for PID start validation and exact hook-session ancestor walking; ambiguous or unavailable evidence produces no parent claim |
| `process-liveness.ts` | The one place a PID becomes a claim about a session (`livenessOf`): `alive`, `gone`, or `unverifiable`. A pid is a number the kernel reuses, not an identity, and four call sites once answered “does a process with this number exist” and published it as “this session is running” — 25 board rows claimed live when 10 were, with sessions riding `siriknowledged` and `sysextd` for up to 33 hours. It takes a `ProcessHandle` rather than a number, so the provenance that makes a pid checkable cannot be dropped at the call site. `gone` is reachable only from evidence about that process (the number is unused, or a recorded start time disagrees) and never from failing to recognise a command, which is what turned a `codex` → `codex-next` rename into a wave of false deaths. The rules live in `tests/fixtures/process-liveness-truth-table.json`, and `tests/no-raw-pid-liveness.test.ts` fails the build if a call site starts hand-rolling the check again |
| `snapshot-agent.ts` | Per-agent view: capabilities (`controlsFor`), activity, outcome, role plus `roleSource`/specialty, and `contextPct` |
| `snapshot-issues.ts`, `snapshot-operator-issues.ts` | What counts as a finding, and how identity conflicts split into live faults vs debris |
| `repo-identity.ts`, `snapshot-programs.ts` | Stable repository/worktree identity, grouping agents into program leaves, and their rollups |
| `run-manifests.ts` | Declared run/lane identity from manifests and the four `ANTHILL_*` workspace variables, plus additive lane succession derived from per-run history JSONL; manifest facts win conflicts, and malformed files or history lines are skipped rather than partly believed |
| `task-state.ts` | Whether a hook's `needsInput` is current after a declared lane state; its browser mirror is `src/web/task-state.js`, and both execute `tests/fixtures/task-state-attention-truth-table.json` |
| `attention-signal.ts` | Whether an agent needs a human, and the sentence saying why. Ships `attentionSignal` plus the wire union `attentionClass?: "blocking" \| "noticed"`: permission/input requests, unresolved forks, stated handoffs, pending questions, and stated assumptions are blocking; `stalled-active` is noticed; silent kinds carry no class. Parked/done declarations suppress older asks, while a strictly newer `needsInput` re-alerts. The row's own summary line is `lastHumanMessage`, which is `string \| null` — `null` is preserved as absence, never rendered as an empty string. |
| `publish-state.ts` | What work is committed but unpublished. Read-only by construction: only `remote`, `rev-parse`, `rev-list` and `for-each-ref` are ever run, and publishing stays the operator's manual decision |
| `pulse.ts` | The live person-blocker count (`pulse.blocked`), momentum, burn rate, and the activity window behind the summary strip. No dead-time field is published without a defensible blocked-entry clock. |
| `human-message.ts` | Readable prose out of a raw transcript. `readableHumanMessage` keeps a message's **first** 240 characters, because that is where it announces its subject and a row wants one line of it. `readableClosing` keeps the **last** 240, because an agent asks its question in the closing sentence — reading from the front discarded every one of them before the snapshot existed. Two reads of the same message, deliberately. |
| `sender-verification.ts` | Whether a leading agent-sender claim is corroborated by that sender's own bounded transcript tail. The current user request outranks the original task; a present unheaded request is direct operator input, not an excuse to inherit a stale sender. Readable contrary evidence is `false`, and unavailable evidence stays absent. |
| `triage.ts` | The investigation queue and the read-only Luna runs — see `TRIAGE-WORKFLOW.md` |
| `burnbar.ts`, `burnbar-query.ts` | Cost, read from an external encrypted OpenBurnBar database in an isolated subprocess |
| `model-config.ts` | Model families, context windows, and Cursor-native policy from `config/models.json` |
| `session-names.ts` | The tier ABOVE everything `naming.ts` can derive: a title somebody authored. Derived names came out unique and unreadable — 93 lanes under one worktree tree are 93 sessions named after the same folder, and a folder does not say what an agent is doing — so this reads a session's opening messages and asks a local model for a short title. Three properties make a model safe to put here: names are written **once** and never revised, so they cannot drift; naming runs **out of band** and is awaited by no refresh, so a slow or dead model costs latency nowhere; and it **degrades** model → heuristic → the derived name that was already there. The model is treated as untrusted input, because a small local model asked for a label will sometimes answer with a refusal or a paragraph |
| `naming.ts` | What an agent is called. One ordered chain, first match wins: an operator alias outranks a declared manifest/env lane (the run id for its orchestrator), which outranks a name the launcher authored, which outranks the directory the session **began** in, which outranks its task line. Names freeze at origin because a transcript records cwd per entry — reading the latest let a name follow the shell, so one session renamed itself four times in four minutes and was published under a neighbouring lane's name. Uniqueness is a property of the fleet rather than of any session, so `disambiguate` is handed every agent at once and is the only thing permitted to append a session tag |
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

**The board's three levels.** `repoGroups` (`app.js`) turns the server's flat
program list into sections: a program carrying `groupPath: [repoKey,
worktreeKey]` joins a repository band, and everything without one keeps the
older flat program section, drawn by the same renderer through the same caches.
`worktreeLabel` names each leaf by precedence — a declared `run:<runId>` first,
then the collapsed `ephemeral` leaf's server-given name, then
`branch@checkout`, reaching one directory up when the checkout folder merely
repeats the repository name. Every rule there exists because a leaf that spans
checkouts must not wear one checkout's name. Inside a leaf, roots sort by
`ROSTER_ROLE_ORDER` within their lifecycle section — a stable sort by role
alone, so ties keep the `agentSortRank` order the server already applied. The
flat fallback keeps that server order untouched, which is what makes it a
regression gate rather than a second implementation.

Each level ships its own **paint key** into the two existing cache maps —
`repo<US><repoKey>`, `+<US><worktreeKey>`, `+<US><rowKey>`, where `<US>` is
`\u001f`. This matters more than it reads: `programId` used to key every cache,
so a new grouping axis without its own key serves one repository's rows out of
another's entry and rebuilds every row on the 4 s tick, taking the operator's
text selection, hover and keyboard focus with it. Two repositories routinely
hold a worktree of the same name, which is why the row key carries both.

Four collapse controls persist independently, each on the `programOverrides`
pattern with its own storage key: programs (`mtn3-programs`), repository bands
(`mtn3-repos`), swarms (`mtn3-swarms`) and Finished shelves (`mtn3-shelves`).
All four are carried in `programsPaintSig`, because each is a control that
mutates nothing else — a paint signature that does not watch them renders a
dead caret.

`shelfFilter` decides the Finished shelf: sessions the *view* excluded for being
terminal, still subject to every other filter the board is wearing. The lookback
clause is the governor — one live worktree holds 448 sessions, whose shelf reads
15 at the default 24 h and 446 with the lookback off — and History is exempt
entirely, because there finished is the population and a shelf holding every row
is a collapsed view.

`parseSenderHeader` (`presentation.js`) reads the producer envelope
`[from <agent.id> run <runId>]` off a message, anchored at the start so an agent
quoting an instruction back is never attributed to whoever it quoted. It feeds
two things: the drawer attributes an agent-sent instruction to its real sender
instead of labelling it "You", and row prose is printed without the envelope.
`roleSourceView` styles `declared`/`observed`/`inferred` as border style rather
than color, since color on that chip already means *which* role.

`app.js` holds the render tree and the board's own state machine. Around it:
`presentation.js` (pure derivations from a snapshot — the layer tests exercise
directly), `agent-model.js`, `client-state.js`, `dom-primitives.js` (`el`, icons,
SVG meters), `text-formatters.js`, `api-client.js` (fetch + envelope handling),
`client-catalogs.js`, `repaint.js`, `feed-freshness.js`, `transcript.js`,
`notifications.js`, and `action-log.js`.

`notification-center.js` is the attention surface's pure derivation, kept out of
`app.js` on purpose. The header is confidence — continuous measured quantities,
each with its own provenance — and this is attention: discrete items carrying
kind, severity, source, lifecycle, evidence, impact and a route to a drawer. The
seam is one line: the header never links, and the center never aggregates. It
imports leaf modules only, so the two resolvers that live in `app.js`
(`programName`, `issueImpactLine`) are injected rather than re-derived.

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

Which of the server's name fields a surface PRINTS is the client's own decision,
and one decision shared by all of them. `rowDisplayName` returns the words —
an operator's label, else `identity.base` — and `visibleSessionTag` returns the
`#` tag beside them, only while another session currently on the board is
printing those same words. The split exists because the server's tag is durable
on purpose: a session keeps it once assigned, so a name cannot churn when the
twin that earned it ends. That makes `identity.name` — the two already joined —
the right unique string for search, aria and logs, and the wrong thing to print;
live, `fe-regroup #8da7e056` was the only session carrying that base anywhere in
an 1186-agent snapshot. The row, the Needs-you strip, the drawer head, the swarm
anchor, the program roster and the lineage spine all read the split through
those two functions, so one session cannot read one way on a row and another way
in the drawer that row opens.

**Declared task state on the board.** `src/web/task-state.js` is the mirror the
server executes against the same truth table, and `wantsHuman` consumes it
directly. The board adds one thing the mirror deliberately does not decide: the
hook is not the only route into the Needs-you strip. `alerting` also admits any
row whose `outcome` is not healthy, and that outcome is derived from an
`attentionSignal` read off prose — prose written before a stand-down does not
stop existing afterwards. Measured live: be-live declared `parked` at 16:52:04
with its last hook `idle` at 16:51:21 sat in the strip with `wantsHuman` already
correctly false. `declaredQuiet` closes that second door, and `declaredDone`
takes finished WORK out of the live views into the Finished shelf
(`shelfFilter`) without touching `lifecycle.ts` — a done lane still at its
prompt is still `waiting`, still controllable, and still able to re-alert. Both
predicates share the mirror's one escape: a `needsInput` hook strictly newer
than the declaration.

The same pair refuses a cmux-authored title as a name. `surfaceTitle` is
routinely a sentence cmux distilled from a session's opening prompt and
`workspaceTitle` is the workspace path, so `declaredIdentity` (presentation.js)
marks a `source: "manifest"` identity and `operatorName` suppresses both titles
against it — a label the operator typed in Ant Hill still outranks everything.
The title is not lost: `quietSourceLine` keeps it as the drawer's `Terminal:`
line, which is how an operator finds the pane.

`repaint.js` is small and load-bearing: it holds an indirection to `render()`
(`setRepaint` / `repaint`) so modules can ask for a repaint without importing
the render tree. `render()` was the dependency hub that made this client
impossible to split — every candidate module pulled the whole thing in until
that edge was cut.

All DOM wiring sits behind a `typeof document` check and the pure helpers are
exposed on `globalThis.TheAntHill`, so the whole client imports safely under Bun
— which is how `tests/web-client.test.ts` drives it without a browser.
