# Agent Atlas Implementation Plan — repo → worktree/task → role

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the Ant Hill dashboard's information architecture so every agent session carries durable identity, declared lineage, and a real role, grouped **repo/project → worktree/task → role-ordered agents** — replacing today's `basename(cwd)`-hash smorgasbord.

**Architecture:** Declared facts beat inferred facts. A producer-side **spawn contract** (env injection + run manifest) declares lineage at birth; the server grows three new fact sources (cmux hook-session store, sidebar snapshot RPC, manifests) that outrank today's title-regex and cwd heuristics; the board regroups on the new spine. Heuristics remain as fallback for ad-hoc sessions, tagged low-confidence.

**Tech Stack:** Bun ≥1.3.14, TypeScript, no framework (hand-rolled DOM via `src/web/dom-primitives.js`, keyed reconciliation via paint signatures). cmux v0.64.22 CLI/RPC. Tests: `bun test` (~2,100), `bunx tsc --noEmit`, `bun run check`.

**Lane assignments (Emilio's):**
| Lane | Model | Territory |
|---|---|---|
| BE | GPT 5.6 SOL MAX | `src/server/**`, `src/shared/types.ts` |
| FE | Opus 5 xhigh | `src/web/**`, ANT-GUIDE/ARCHITECTURE parity |
| HARDEN | Grok 4.5 High Fast via cursor-agent CLI | `tests/**`, fixtures, sweep scripts — **no `src/web/app.js`** |
| PRODUCER | (orchestrator session / Claude) | HD-repo kickoff templates + spawn helper |

## Global Constraints

- Verify per task: `bunx tsc --noEmit` then `bun test` (or focused file) — real exit codes; full `bun run check` before each lane's final commit.
- `src/server/naming.ts` contains 2 deliberate NUL bytes (lines 268, 276) — **grep-invisible**. Always use the Read tool on it; never trust a grep-negative that includes it. Never add NUL bytes to any other file.
- `tests/reference-docs.test.ts` + `tests/ant-guide.test.ts` assert prose docs match code — any enum/union change must update `ANT-GUIDE.md` / `ARCHITECTURE.md` in the same commit.
- `tests/lifecycle-parity.test.ts` / `tests/naming-parity.test.ts` assert server↔client agreement — change both sides together.
- `tests/overhaul-guards.test.ts` and the CSS orphan check read `app.js` **as text**: CSS class names must appear as whole string literals, never assembled at runtime.
- `tests/web-client.test.ts` is the shared conflict file — **single-writer at a time**, noted in each task.
- `programId` keys the paint/reconciliation caches (`app.js:3853-3855`); any new grouping axis must ship its own stable paint keys or rows rebuild every 4s and destroy focus.
- Server changes need a server restart (`bun run dev` for watch); web changes need the `?v=` cache-buster bumped in `index.html`.
- **Never key anything on a cmux workspace UUID** (re-minted on every app restore) or on `identity.name` (disambiguator churns). Durable keys: `agent.id` (`provider:sourceSessionId`), cmux **surface** UUID, cwd, env-injected ANTHILL_* vars.
- cmux todo checklists and status pins are **user-owned** (upstream policy #8566): Ant Hill and lanes read them, never write them.
- Names cap at 80 chars (`MAX_NAME_LENGTH`); role labels lower-case kebab.
- Commit style observed in repo: `fix(scope): …` / `feat(scope): …`, one logical change per commit.

## Landing order (hard gates)

1. **`ah-dock-20260804`** lands first (disjoint from everything, 1 commit, suite green).
2. **`ah-board-20260804`** lands second — it owns `agentRowPlan` / `syncProgramList` / paint sigs / `renderTabs`, the exact machinery FE builds on. Its 8 failing tests must be fixed by its owner before merge.
3. **`ah-findings-20260805`** (the active Hormiga agent) continues landing its slices; it owns `<timestamp>`/identity sanitation (its P2) and the model-policy deletion (its P1, commit f6062a6). **This plan must not duplicate its P2**; HARDEN rebases on it.
4. Then this program: **BE → FE → HARDEN** (BE tasks B1–B3 can start immediately on a worktree off main — they're `src/server/**` and collide with nobody except findings' `snapshot-agent.ts` edits; B4 waits for findings' snapshot-agent slice to land).
5. PRODUCER tasks run in parallel anytime (different repo).

Seam with the findings program: findings = *correctness of findings/advisories/triage surfaces*; this plan = *information architecture (identity, lineage, grouping, naming, links)*. Where both touch `snapshot-agent.ts` or `web-client.test.ts`, findings has right-of-way; this program rebases.

---

## Phase 1 — BE spine (GPT 5.6 SOL MAX)

### Task B1: cmux hook-session collector (deterministic session↔surface↔workspace binding)

**Files:**
- Create: `src/server/cmux-hook-sessions.ts`
- Create: `tests/cmux-hook-sessions.test.ts`
- Create: `tests/fixtures/cmux-hook-sessions/claude-hook-sessions.json` (fixture)
- Modify: `src/server/targets.ts` (new resolution tier 0)
- Modify: `src/server/collectors.ts` (attach hook facts by sessionId)
- Modify: `src/shared/types.ts` (extend `CmuxTarget` + snapshot fields)

**Interfaces:**
- Produces:
```ts
export interface HookSessionRecord {
  provider: "claude" | "codex" | "omp"
  sessionId: string
  surfaceId: string           // cmux surface UUID — restart-stable
  workspaceId: string         // runtime-only; never persist across restarts
  cwd: string
  pid: number
  pidStartSeconds?: number
  transcriptPath?: string
  agentLifecycle: "idle" | "running" | "needsInput" | "unknown"
  lastPermissionMode?: string // e.g. "auto"
  launchCommand?: { executablePath: string; arguments: string[]; workingDirectory: string }
  updatedAt: number
}
export function readHookSessionStores(root?: string): HookSessionRecord[]
export function hookRecordFor(provider: string, sessionId: string): HookSessionRecord | undefined
```
- Consumes: `~/.cmuxterm/claude-hook-sessions.json`, `codex-hook-sessions.json`, `omp-hook-sessions.json` — shape: `sessions.<id>` records plus `activeSessionsBySurface{surfaceUUID→{sessionId,updatedAt}}`.

**Steps:**
- [x] **Step 1: Fixture + failing tests.** Copy a redacted real store into the fixture (2 sessions, one `running` one `idle`, one with `lastPermissionMode:"auto"`). Tests:
```ts
test("readHookSessionStores parses claude store and normalizes provider", …)
test("hookRecordFor returns undefined for unknown session", …)
test("malformed store file yields [] and does not throw", …)
test("record with missing surfaceId is dropped", …)
```
- [x] **Step 2: Run tests — expect FAIL (module not found).**
- [x] **Step 3: Implement `cmux-hook-sessions.ts`.** Pure read + validate, `root` param for tests (defaults `~/.cmuxterm`), tolerate absent files. No caching beyond one read per collect cycle (call it from `collectSessions`).
- [x] **Step 4: Tests green.**
- [x] **Step 5: Wire tier 0 into `targets.ts`.** Before the existing 3-tier resolver: if `hookRecordFor(provider, sourceSessionId)` yields a surface that exists in the live cmux terminal parse, return `resolution: "exact"`, `attestation: "hook-store"`. Extend the `attestation` union in `src/shared/types.ts` accordingly; update `tests/naming-wire.test.ts` if it pins the union. Existing tiers remain as fallback.
- [x] **Step 6: Attach facts in `collectors.ts`.** For Claude/Codex/OMP sessions with a hook record: populate `processAlive` (pid + pidStartSeconds check), prefer hook `cwd` when session record lacks one, and carry `agentLifecycle` into a new optional `CollectedAgent.hookLifecycle` (typed in `src/server/types.ts`) for the classifier.
- [x] **Step 7: `bunx tsc --noEmit && bun test` green; commit** `feat(server): bind sessions to cmux surfaces via the hook-session store`.

### Task B2: repo + worktree as first-class entities

**Files:**
- Create: `src/server/repo-identity.ts`
- Create: `tests/repo-identity.test.ts`
- Modify: `src/server/cmux.ts` (ingest `extension.sidebar.snapshot`)
- Modify: `src/server/snapshot.ts`, `src/server/snapshot-programs.ts`, `src/shared/types.ts`
- Test: extend `tests/web-client.test.ts` fixtures ONLY after FE lane's F1 (single-writer rule) — server-side tests live in `tests/snapshot-programs.test.ts`.

**Interfaces:**
- Produces:
```ts
export interface RepoIdentity {
  repoKey: string      // FNV hash of realpath(git common dir) — stable across worktrees
  repoName: string     // basename of the main checkout (common-dir parent)
  worktreePath: string // realpath of the working tree root
  branch?: string
  ephemeral: boolean   // matches ~/.codex/worktrees, .claude/worktrees, /tmp, .worktrees
}
export function resolveRepoIdentity(cwd: string): RepoIdentity | null  // cached, 60s TTL
```
- On the wire: `AgentSnapshot.repo?: RepoIdentity` and `ProgramSnapshot.groupPath?: [repoKey: string, worktreeKey: string]`.
- Consumes: `git -C <cwd> rev-parse --git-common-dir --show-toplevel --abbrev-ref HEAD` (one spawn, parsed together); `cmux rpc extension.sidebar.snapshot` fields `project_root_path`, `git_branches[{branch,dirty}]`, `pull_request_urls` — snapshot wins over spawned git when both exist (it's cheaper and live).

**Steps:**
- [ ] **Step 1: Failing tests** — temp-dir git repo with two worktrees: same `repoKey`, different `worktreePath`; non-git cwd → `null`; `~/.codex/worktrees/x/Repo` → `ephemeral: true`; cache hit does not respawn git (spy on the exec seam).
- [ ] **Step 2: FAIL.**
- [ ] **Step 3: Implement** with an injectable exec function (repo pattern: collectors take roots as params for tests).
- [ ] **Step 4: PASS.**
- [ ] **Step 5: Ingest sidebar snapshot in `cmux.ts`** alongside `parseCmuxTerminals`: one `extension.sidebar.snapshot` RPC per cmux discovery tick (every 5th collect); map workspace → `{project_root_path, branch, dirty, pull_request_urls}`; expose to `snapshot.ts` so sessions bound via B1 get `repo`/`git` even when spawned-git would be too slow. Keep the existing per-surface `git:{branch,dirty,head}`.
- [ ] **Step 6: Grouping.** In `snapshot-programs.ts`: when `repo` resolves, `programId = "repo:" + repoKey` and section identity becomes the repo; `groupPath[1] = worktreeKey` = FNV of `worktreePath` (or the run's `runId` once B3 lands — runId wins). Sessions without repo keep today's `programFor` behavior unchanged (fallback path already exists at `snapshot-programs.ts:115-141`). Preserve `ProgramHint.match` operator overrides — hints outrank derivation.
- [ ] **Step 7: Update `ARCHITECTURE.md` grouping paragraph (reference-docs test). `bun run check` green; commit** `feat(server): first-class repo and worktree identity for grouping`.

### Task B3: run manifests + ANTHILL_* env lineage

**Files:**
- Create: `src/server/run-manifests.ts`
- Create: `tests/run-manifests.test.ts` + `tests/fixtures/runs/inbox-ux-overhaul-2026-08-05.json`
- Modify: `src/server/cmux.ts` (read `cmux workspace env <ws> --json`, cached per workspace)
- Modify: `src/server/snapshot.ts` (precedence wiring), `src/server/naming.ts` (**Read tool only** — new `manifest` name source), `src/shared/types.ts`

**Interfaces:**
- Produces:
```ts
export interface RunManifestLane {
  laneId: string                // "fe1-geometry"
  role: AgentRole               // the B4 union — B3 imports it from src/shared/types.ts
  provider?: string
  sessionId?: string            // binds lane→agent when known
  worktree?: string
  branch?: string
  model?: string
  brief?: string                // path to the lane brief
}
export interface RunManifest {
  runId: string                 // "inbox-ux-overhaul-2026-08-05"
  createdAt: string
  repoRoot: string
  orchestrator: { provider: string; sessionId: string }
  lanes: RunManifestLane[]
}
export function readRunManifests(roots?: string[]): RunManifest[]
// roots default: ["~/.anthill/runs", <each known repoRoot>/.agent/runs — manifest.json one level deep]
export function manifestFactsFor(agentId: string): { runId; laneId; role; parentAgentId } | undefined
```
- Env channel (same facts, per-workspace): `ANTHILL_RUN`, `ANTHILL_LANE`, `ANTHILL_ROLE`, `ANTHILL_PARENT` (= `provider:sessionId` of the orchestrator) read via `cmux workspace env --json`, joined to sessions through the B1 workspace binding. Manifest wins over env on conflict; both win over every heuristic.

**Steps:**
- [ ] **Step 1: Failing tests** — valid manifest parses; lane with `sessionId` yields `manifestFactsFor("claude:<sid>")` with `parentAgentId = "claude:<orch-sid>"`; malformed JSON skipped without throw; duplicate runId → newest `createdAt` wins; env-only lane (no manifest) still yields facts via the env reader (fixture the env map).
- [ ] **Step 2: FAIL. Step 3: Implement. Step 4: PASS.**
- [ ] **Step 5: Wire precedence in `snapshot.ts`:** `parentAgentId` = manifest/env > existing thread_spawn/Cursor (`snapshot.ts:376-378`); `programId`/`groupPath[1]` = `run:<runId>` when declared (outranks worktreeKey from B2).
- [ ] **Step 6: Naming.** In `naming.ts` (Read tool!), insert source `manifest` between `operator-alias` and `authored` in `resolveAgentName`: base name = `laneId` (or `runId` for the orchestrator). Update `tests/naming.test.ts` + `tests/fixtures/naming-truth-table.json` + `tests/naming-parity.test.ts` client mirror. Sticky note: `AUTHORED_BY` union gains `"manifest"`.
- [ ] **Step 7: `bun run check`; update ANT-GUIDE naming precedence list; commit** `feat(server): declared lineage via run manifests and ANTHILL_ env vars`.

### Task B4: role taxonomy v2 (what an orchestrator IS)

**Files:**
- Modify: `src/server/snapshot-agent.ts` (`roleFor` → `roleFor2` with source), `src/shared/types.ts`, `src/web/presentation.js` + `src/web/client-catalogs.js` (labels — coordinate with FE; this is the one BE→FE shared commit), `ANT-GUIDE.md`
- Test: `tests/snapshot-agent.test.ts`, `tests/lifecycle-parity.test.ts` alignment

**Interfaces:**
```ts
export type AgentRole =
  | "human" | "orchestrator" | "worker" | "verifier" | "tester"
  | "monitor" | "automation" | "service" | "agent"          // "agent" = unknown fallback
export type RoleSource = "declared" | "observed" | "inferred"
// on the wire: role?: AgentRole; roleSource?: RoleSource
// "frontend"/"backend" leave the role union and become specialty?: "frontend"|"backend" (chip only)
```
**Definition (the canonical answer):** a session is an **orchestrator** iff (a) a run manifest names it `orchestrator` / it owns a manifest, or (b) `ANTHILL_ROLE=orchestrator`, or (c) it has ≥1 observed child (`childCounts` — now fed by manifests AND thread_spawn AND `agent.hook.SubagentStop` parentage). Title regex (`orchestrat|coordinat|deploy swarm|swarm owner`) survives only as `roleSource:"inferred"`. **monitor** = declared watcher (manifest/env only — never inferred). **service** = a cmux terminal surface with no agent session bound to it (dev servers, tails) — excluded from agent counts and "Needs you". **human** = declared via env `ANTHILL_ROLE=human` or operator alias flag; never inferred.

**Steps:**
- [ ] **Step 1: Failing tests** — manifest-declared orchestrator without children ⇒ `("orchestrator","declared")`; Claude session with SubagentStop-observed child ⇒ `("orchestrator","observed")`; title "coordinate the swarm" alone ⇒ `("orchestrator","inferred")`; surface with no agent session ⇒ `("service", "observed")`; old "frontend" title ⇒ `role:"worker"` + `specialty:"frontend"`.
- [ ] **Step 2: FAIL. Step 3: Implement. Step 4: PASS.**
- [ ] **Step 5:** Update `ROLE_LABELS`/`ROLE_ALIASES`/`roleView` + `ROSTER_ROLE_ORDER` minimally (human, orchestrator, monitor, verifier, worker, tester, automation, service, agent); ANT-GUIDE role section; parity + reference-docs tests green.
- [ ] **Step 6: Commit** `feat(server): declared role taxonomy with confidence source`.
  *(Sequencing: rebase on the findings lane's `snapshot-agent.ts` slice — modelPolicy deletion — before starting.)*

### Task B5: sticky disambiguator

**Files:** Modify `src/server/naming.ts` (Read tool!), `src/server/snapshot.ts:188-192`, the identity-bindings store (`data/identity-bindings.json` writer), `tests/naming.test.ts`, `tests/fixtures/naming-truth-table.json`.

**Behavior:** first tag assigned to an `agent.id` persists (store `{agentId → tag}`); `disambiguate` consults the store before computing; fleet-relative escalation (the NUL composite path) only for never-seen collisions, and the escalated result is then persisted too. Result: a session's `#hex` never changes once shown.

**Steps:**
- [ ] **Step 1: Failing test** — same fleet minus one unrelated session ⇒ tags unchanged for survivors (this exact case flakes today).
- [ ] **Step 2–4: FAIL → implement → PASS.** Truth-table update. **Step 5: Commit** `fix(names): disambiguator tags are sticky per session`.

### Task B6: durable agent links + zombie retirement

**Files:** Create `src/server/agent-links.ts` + route in `src/server/index.ts` (`GET /agent/:id/focus` → resolve via B1 tier-0 then `targets.ts`; live ⇒ respond `{cmuxTarget}` and trigger focus via existing cmux action path; dead ⇒ `{transcriptPath}` fallback). Retirement: in the classifier, hook `agentLifecycle:"ended"` OR (`processAlive === false` AND cwd no longer exists) ⇒ `lifecycle` flows to the existing terminal states so rows leave live views (reuse `endEvidence`, add `"worktree-deleted"` to its union). Tests: `tests/agent-links.test.ts`, retirement cases in `tests/lifecycle-parity.test.ts` (both sides).
- [ ] TDD steps as above; **commit** `feat(server): durable agent links and dead-worktree retirement`.

### Task B7 (stretch): events tail

`cmux events --cursor-file ~/.anthill/events.cursor --reconnect --category agent --category workspace` as a supervised child; `boot_id` change ⇒ full re-snapshot; feed lifecycle deltas between 4s polls. **Only after B1–B6 are green and merged.** Polling remains the reconciler — this is latency polish, not correctness.

---

## Phase 2 — FE regroup (Opus 5 xhigh) — starts after `ah-board` lands and B2–B4 are on main

### Task F1: three-level board

**Files:** Modify `src/web/app.js` (`syncProgramList`, `agentRowPlan`, paint sigs — board-lane versions), `src/web/client-state.js` (facets), `src/web/index.html` (`?v=` bump), `tests/web-client.test.ts` (single writer: FE owns it during Phase 2).

**Structure:** Repo section header (repoName + branch/PR chips from `repo`/`pull_request_urls`) → worktree/run subsection (runId when declared, else branch@worktree basename) → rows ordered `ROSTER_ROLE_ORDER` then `agentSortRank`. Paint keys: `repoKey`, `repoKey\u001fworktreeKey`, `repoKey\u001fworktreeKey\u001frowKey` — extend the board lane's cache maps, don't fork them. Sessions with no repo render under today's program sections unchanged (fallback must be pixel-identical to pre-change for those rows — that's the regression gate).
- [ ] Failing web-client tests for: two worktrees of one repo render under one repo section; declared run replaces worktree label; no-repo session unchanged; collapse state persists per repoKey (reuse `programOverrides` pattern, new localStorage key `mtn3-repos`).
- [ ] Implement → green → **commit** `feat(board): group by repo, then worktree/run, then role`.

### Task F2: lineage + provenance chips

Parent chain already renders via `buildClusters`/lineage spine — now populated for Claude swarms by B3; add `roleSource` styling (declared = solid chip, observed = outline, inferred = dashed + tooltip "inferred from title") and a sender chip on `lastHumanMessage` when it parses the producer header `[from <agent.id> run <runId>]` (parser in `src/web/presentation.js`, pure + tested).
- [ ] TDD in web-client.test.ts; **commit** `feat(board): lineage confidence and message provenance chips`.

### Task F3: liveness truth + finished shelf

Map `hookLifecycle` (B1) into row activity (a `needsInput` agent shows "waiting on you" even when hibernated-dark); retired/ended rows collapse into a per-worktree "Finished" shelf (collapsed by default, count in header) instead of interleaving with live rows.
- [ ] TDD; **commit** `feat(board): hook-store liveness and finished shelf`.

### Task F4: docs parity + polish

ANT-GUIDE.md + ARCHITECTURE.md updated for the new hierarchy/roles/links; `?v=` bump verified; keyboard focus survives a 4s repaint under the new keys (manual check + existing focus tests).
- [ ] **Commit** `docs(guide): agent-atlas hierarchy, roles, and links`.

---

## Phase 3 — HARDEN lane (Grok 4.5 High Fast via cursor-agent CLI) — after Phase 1 merges; rebases on findings P2

Fenced to `tests/**`, `scripts/**`, fixtures. **No `src/web/app.js`. No `src/server/naming.ts` edits** (NUL file — Grok's tooling may mangle it; if a naming test needs changing, hand it to BE).

- **G1:** Extend both truth tables (`naming-truth-table.json`, `lifecycle-truth-table.json`) for: manifest names, sticky tags, new roles, retirement states. Parity tests green on both sides.
- **G2:** Golden-file fixtures for the three new collectors (hook store, manifests, sidebar snapshot) including hostile inputs: `<timestamp>` markup in titles (assert the findings-lane stripper is applied at ALL FOUR ingress points — regression-guards Hormiga's P2, does not reimplement it), 81-char names, NUL-free guarantee.
- **G3:** `scripts/check-nul-files.ts` + test: exactly one NUL-carrying source file allowed (`src/server/naming.ts`); anything else fails CI.
- **G4:** Zombie/service sweeps: fixture a cmux tree with a deleted-cwd workspace and a bare `npm run dev` surface; assert `service` classification and retirement.
- [ ] Each is its own TDD commit: `test(atlas): …`.

---

## Phase 4 — PRODUCER side (HD repo `LaHormigaDormida` + global templates; owner: orchestrator sessions)

- **P1: Kickoff template** (`docs/agents/` + `.agent/` templates): every swarm spawn does — (1) write `~/.anthill/runs/<runId>.json` before the first lane; (2) create each lane workspace with `cmux workspace create --env ANTHILL_RUN=<runId> --env ANTHILL_LANE=<laneId> --env ANTHILL_ROLE=<role> --env ANTHILL_PARENT=<provider:sessionId> --focus false`; (3) name workspaces `<runId-short>/<laneId>`; (4) create a cmux **workspace group** per run (`cmux workspace-group create --from …`, name = runId, one color per program) so the cmux sidebar mirrors the dashboard hierarchy; (5) update the manifest as lane sessionIds become known; (6) `--permission-mode auto` always.
- **P2: Send helper** — orchestrator→lane messages go through a helper that prefixes `[from <agent.id> run <runId>]`, giving F2 its provenance and making rogue injections distinguishable-by-absence.
- **P3 (one-shot, optional):** backfill manifests for currently-live programs (inbox run, Cooper, Ant Hill fixes) so the new board is populated on day one.

---

## Verification matrix

| Gate | Command / evidence |
|---|---|
| Types | `bunx tsc --noEmit` exit 0, per task |
| Suite | `bun test` — no new failures vs the branch's base (name-set, not count) |
| Docs parity | `bun test tests/reference-docs.test.ts tests/ant-guide.test.ts` |
| Classifier parity | `bun test tests/lifecycle-parity.test.ts tests/naming-parity.test.ts` |
| Live smoke | restart server on :4701 → board shows ≥1 repo section with ≥2 worktree subsections during a real swarm; a hibernated lane still shows correct lifecycle (hook store, not read-screen) |
| Spawn-contract E2E | run P1 template for a 2-lane toy swarm → both lanes appear under their run with declared roles + parent chain, names = laneIds, no `#hex` churn across 3 snapshots |
| Link durability | copy an agent link, restart cmux (workspace UUIDs re-mint), link still resolves via surface/transcript |
| Rollback | every task is one revertable commit; manifests/env are additive data — absence ⇒ behavior identical to today (fallback paths are the existing code) |

## Decisions taken (veto-able)

1. Manifest home: **both** `~/.anthill/runs/` and repo-local `.agent/runs/**/manifest.json` (trivial to support; HD swarms already produce `.agent/runs/`).
2. FE waits for `ah-board` to land rather than planning against main — its rewrite owns the exact machinery F1 needs.
3. HD-repo kickoff-template work is **in scope** (Phase 4) — ties are born at spawn time; a dashboard-only fix would leave Claude lanes parentless forever.
4. `frontend`/`backend` demoted from roles to specialty chips — they described territory, not authority.
5. B7 events-tail marked stretch — polling is correct today; latency is polish.
6. Timestamp sanitation stays with the Hormiga findings program (its P2); we only regression-guard it (G2).
