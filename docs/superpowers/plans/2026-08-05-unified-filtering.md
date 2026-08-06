# Unified Provider-Neutral Filtering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One filter surface that owns time, session kind, provider, program, status, and query; a server-owned `sessionKind` classification that replaces the client regex; and a producer-side path to fewer, cheaper review sessions — without ever hiding an alert or falsifying a count.

**Architecture:** The collector captures launch evidence (`entrypoint`/`promptSource`) from provider transcripts; snapshot assembly derives `sessionKind` with provenance in one place (beside `roleFor2`); the client prefers the published kind and keeps its regex only as a transition fallback; the existing `#filter-bar` becomes the single Filters surface while the tab strip stays pure navigation and the scan window becomes read-only collection status.

**Tech Stack:** Bun + TypeScript server, framework-free ES-module client (`src/web/*.js`), `bun test` with the hand-rolled DOM harness in `tests/web-client.test.ts`.

## Global Constraints

- Provider behavior stays symmetric: the `sessionKind` contract is provider-neutral; only the *evidence* each collector contributes differs, and absence of evidence yields `unknown`, never a guess.
- Exact counts and alert visibility are preserved: an alerting session is never hidden by any filter; History and Usage populations never shrink by default; every hidden population is disclosed where it is hidden.
- Tab counts are population counts: they ignore `query` and facets today and continue to (a search changes what renders, never what the tab claims exists). This is pre-existing, deliberate, and now pinned by test.
- No hardcoded home paths in tests (`homedir()` only — `tests/collectors.test.ts:28-32`); new test files enter CI automatically via `scripts/ci-tests.sh`.
- Every new CSS class must appear literally in some `src/web/*.js` or `index.html` (`tests/web-client.test.ts:5649` census).
- Every filter-bar control carries a stable `data-fkey` (the bar is torn down each paint; focus restore keys on it). The `session-kind:*` fkey namespace is established at `app.js:4085`.
- Shared-worktree discipline: lanes share this worktree. Commit with `git commit -- <paths>` (never a bare `git add`-sweep), and note that `app.js`/`styles.css` currently carry **two** lanes' hunks (this filtering slice and the notification dead-time slice) — see Phase 0 landing note.
- The frozen-clock convention: client tests freeze `updatedAt` fixtures; collector tests pass `{ nowMs }`.

---

## 1. Findings and evidence

All measurements taken 2026-08-05 ~21:20 CDT (2026-08-06 UTC) against the live board at `127.0.0.1:4701` (healthy, snapshot age < 2s) and the working tree at branch `fix/cmux-control-health-lifecycle`.

**The wire.** `/api/snapshot` carries 1,259 tracked agents (claude 584, codex 583, cursor 86, factory 3, omp 3); totals: 27 live, 883 retained, `byLifecycle {working 7, waiting 20, unverified 0, finished 349}`, `scanWindowHours: 36`.

**The repeated rows.** 469 sessions carry the *identical* task text `"Review this change for security vulnerabilities.\n\nChanged files (you may Read these and any other file in the repo): …"` — 37% of everything tracked. All are provider `claude`; 467/469 ran `claude-opus-4-7` (1 `<synthetic>`); 460 finished, 9 waiting; **0 have a `parentAgentId`**. Daily counts: 07-28: 4, 07-29: 2, 07-30: 15, 07-31: 31, 08-01: 54, **08-02: 221**, 08-03: 18, 08-04: 39, 08-05: 69, 08-06 (partial): 16. By cwd: 373 from `the-mountain-main` itself, the rest from lane worktrees and `cooper-scheduler.worktrees/*`. In the default 6h Board lookback, **19 of the 59 recently-updated sessions are these reviews** — roughly a third of the default Board.

**Token cost.** Summed over the 469: `tokens.sessionTotal` (consumption — each token once) = **33,146,259**; `tokens.sessionProcessed` (BurnBar-comparable) = **144,701,384**. Per-session `cost` is absent on all rows (only BurnBar prices invocations); a dollar figure requires the BurnBar join by `sourceSessionId` and was not computed.

**The launcher — found, not inferred.** The exact prompt lives in `~/.claude/plugins/cache/claude-plugins-official/security-guidance/2.0.6/hooks/review_api.py`. That plugin's `hooks.json` registers `security_reminder_hook.py` on **Stop** (async rewake), on **PostToolUse `Bash(git commit:*)`**, **`git push`**, and the `gt` equivalents. The LLM review path (`llm.py:341-412`, `_call_claude_via_sdk`) launches a **Claude Agent SDK** session: `ClaudeAgentOptions(system_prompt=CLAUDE_CODE_SYSTEM_PROMPT, allowed_tools=[], max_turns=2, model=chosen_model)`, `SECURITY_REVIEW_MODEL = env override or "claude-opus-4-7"` (`llm.py:131`). Each such call writes a fresh transcript into `~/.claude/projects/<cwd-key>/<uuid>.jsonl`, which the Ant Hill claude collector harvests as a top-level session. `~/.claude/settings.json` contains no such hook — it is entirely plugin-provided, so it fires for **every Claude lane on the machine**, and the fleet's liberal-commit policy multiplies it.

**A deterministic marker exists.** Review transcripts record `entrypoint: "sdk-py"` and `promptSource: "sdk"` on their user/attachment rows; interactive sessions record `entrypoint: "cli"`. Census of this repo's project dir: **398 transcripts; 384 are `sdk-py`, and all 384 of those carry the review prompt; the other 14 are `cli`.** The server currently reads none of these fields — `createClaudeParser` (`collectors.ts:741-897`) never looks at `entrypoint`, `promptSource`, `isSidechain`, or `parentUuid`, which is also why the reviews have no parent link.

**The plugin already deduplicates.** `diffstate.py` keeps an append-only `sg-reviewed-shas` file per repo root recording every reviewed commit **with a `vulns_found` count** (`_append_reviewed_shas(repo_root, shas, vulns_found=0)`), and the push-sweep advances past the contiguous reviewed prefix. Volume is therefore not re-review of the same diff; it is one review per Stop/commit across many lanes.

**A live false positive for the client regex.** The local slice's third pattern `/\bsecurity\s+review\b/i` and second pattern `/\bsecurity\s+vulnerabilit(y|ies)\s+review\b/i` match *this very planning session* (its task text quotes "Security vulnerability review" rows). The slice as written would hide an operator's interactive planning session from the Board. Regex over prose cannot distinguish a reviewer from a session *about* reviewers; launch evidence can.

**The local slice itself** (unstaged: `agent-model.js`, `app.js`, `client-state.js`, `tests/web-client.test.ts`) is verified working — 476/476 pass in `web-client.test.ts`. Its shape is right: provider-neutral predicate, Board-only hiding, alerting and search escapes, count-bearing disclosure chip (`fkey: session-kind:review`), empty-state disclosure, `programsPaintSig` threading (`app.js:4702`). Verified gaps (from the harness map):

1. `shelfFilter`'s identical `passesReviewVisibility` clause (`app.js:3875-3880`) has no test — an uncovered twin, the exact pattern `tests/README.md:88-90` warns about.
2. The new empty-state copy at `app.js:4968-4980` is unreachable by the harness (`renderPrograms` is not on the seam; tests reach the list via `syncProgramList`, below the empty-state branch).
3. `renderTabs` calls `passesReviewVisibility` in 3-arg form (no search escape), so with an active query matching a hidden review worker the row renders while the tab count excludes it. This is *consistent* with counts ignoring `query` entirely (pre-existing semantics) — but nothing pins that reading, so it looks like a bug to the next reader.
4. `state.showReviewWorkers` is not persisted; every reload silently reverts to hidden.
5. The harness cannot fire the chip (`setShowReviewWorkers` calls the real `render()`, which needs the `withRequests`-grade document), and `fakeDocument.querySelectorAll` returns `[]`, so tab-marking behavior is only source-text-asserted.

**Adjacent dead machinery (do not confuse it with the plan's scope):** `state.facetProgram` / `state.facetProvider` are read in five places (`currentFilter`, `shelfFilter`, scope note, empty state, paint sig) and **written nowhere** — a wired filter model with no UI. `viewMatches` already supports named lenses (`now`, `working`, `idle`, `needs-you`) that no tab exposes. `renderUsagePanel`'s session link calls `setView("now")`, which no-ops because `"now"` is not in `VIEWS` (`app.js:9472` → `:9111`) — a latent bug worth one line in Phase 3.

## 2. Root cause and confidence levels

| Claim | Level | Evidence |
|---|---|---|
| The repeated Board rows are spawned by the `security-guidance` plugin v2.0.6 on Stop / commit / push hooks | **Confirmed** | Verbatim prompt in `review_api.py`; `hooks.json` events; 384/384 `sdk-py` transcripts in this repo's project dir carry the prompt |
| They are full headless Claude Agent SDK sessions, not subagents, and cost real tokens | **Confirmed** | `llm.py:341-412`; transcripts are top-level session files; 33.1M consumption tokens summed on the wire |
| They appear across repos/worktrees because the plugin is user-scope and every lane triggers it | **Confirmed** for this machine | cwd distribution (373 here + lanes + cooper-scheduler); no repo-level hook config |
| Burst days correlate with fleet commit activity (e.g. 221 on 08-02) | **Inferred** (high) | Timestamps cluster in minutes-apart bursts matching commit cadence; no direct join to `git log` was performed |
| `entrypoint: "sdk-py"` + review-prompt prefix identifies these sessions with no false positives on this machine | **Confirmed** for this repo dir; **Inferred** fleet-wide | 384/384 here; other project dirs not censused |
| Dollar cost of the review fleet | **Unknown** | Requires BurnBar join by `sourceSessionId`; `sessionProcessed` (144.7M) is the comparable unit |
| Whether non-review `sdk-py` automations exist that a kind filter would also catch | **Unknown** | Zero in this repo dir; other dirs not censused |
| The client regex over-matches operator sessions | **Confirmed** | This planning session's task matches patterns 2 and 3 |

Root cause, one sentence: **a per-lane, per-Stop/commit security-review automation multiplied by a many-lane fleet produces hundreds of legitimate, useful, but operationally uninteresting sessions, and the board currently has no session-kind axis to file them under — so they land as peers of the operator's work.**

### Evidence addendum — 2026-08-05 22:10, lane EV-1 (full report: `docs/LANE-EV1-REPORT.md`)

- **Codex launch markers (Task 1.2b): confirmed deterministic.** Every rollout opens with a `session_meta` row; `payload.originator`/`payload.source` are `codex_exec`/`exec` for headless `codex exec` vs `codex-tui`/`cli` for the interactive TUI (censused across 4,248 rollouts). Subagent rollouts carry `source: { subagent: … }` (an object — the string-typeof guard skips it). Wired verbatim into `CollectedAgent.launch`.
- **Cursor launch markers: confirmed absent.** `~/.cursor/chats/**` meta and agent transcripts record no launch-mode field; kind stays pattern/`unknown` for cursor.
- **Cross-dir census (Task 2.0, D1 gate): 823 transcripts, 651 sdk-py, 649 review-prompt.** The 2 non-review sdk-py rows are the same plugin's *follow-up* sessions (`"You previously flagged these candidate vulnerabilities:"`) — no third-party automation exists on this machine. D1 needs no re-ruling; the follow-up prompt joins the producer registry so 651/651 classify `review`.
- **Yield ledger (Task 4.3): 2 of 1,352 retained reviews found vulns (0.15%).** `sg-reviewed-shas` lives at `<git-common-dir>/sg-reviewed-shas`, capped at 500 entries; the-mountain's 500 retained entries carry **zero** findings. Lifetime yield beyond the caps: unknown. Dollar figure: unknown (BurnBar join unreachable from files).
- **Duplicate-SHA across worktrees (D3): 0 by construction.** Linked worktrees share the common git dir's ledger; the D3 re-review concern applies only to separate clones (none observed).
- **Stop-trim switch (Task 4.4): exists and is supported.** `ENABLE_STOP_REVIEW=0` disables only the Stop-hook diff review, keeping commit/push reviews (`security_reminder_hook.py:160-162`, gate at `:1910`); the README recommends it for exactly this multi-lane shared-worktree setup.

## 3. Unified filter information architecture

**Navigation (tab strip, `#views`):** Board / History / Usage. Tabs carry population counts only (no window suffix — already removed in the slice). Nothing else ever becomes a tab.

**One Filters surface (`#filter-bar`):** owns, in this order (order is a11y/focus contract — see fkey list):

1. **Session kind** — the review-worker chip (`session-kind:review`), count-bearing, Board only, shown only when it would hide something. Future kinds extend the same namespace (`session-kind:automation`), gated by the same rule: only rendered when the kind exists in the current window.
2. **Time window (lookback)** — the existing preset group (`lookback:1|6|24|36|all|custom`). Client-side, per-browser, persisted (`mtn3-lookbackHours`).
3. **Provider** — activates the dead `facetProvider`: one chip per provider present in the snapshot, `provider:<name>` fkeys, only rendered when ≥2 providers are present. Toggle to clear.
4. **Program** — `facetProgram` stays a filter-model slot; it is *set* from the program drawer ("Only this program") and *cleared* from the Filters bar (`program:clear` chip visible only while active). No always-on program chip list — programs are unbounded.
5. **Status (lifecycle lens)** — All / Working / Waiting / Unverified chips (`status:working|waiting|unverified`), Board only, mapping to `lifecycleSection`. Reuses the named-lens semantics that already exist in `viewMatches`.
6. **Query** — stays the toolbar `#search` input (own Tab stop, `/` shortcut) but is part of the same filter conjunction (`currentFilter`). Search admits kind-hidden rows that match (explicit request beats default hiding).

**Collection status (read-only):** the scan-window chip stops being an editor. The bar shows a non-interactive status span — "Collectors read the last 36h" — whose `title` states the semantics: *server-side collection bound; sessions with no activity inside this window leave the wire entirely, for every browser; change it in Settings.* Editing moves to the existing settings panel (`renderSettingsPanel`, `state.settingsPanelOpen`), keeping `postScanWindow` and the unverified/`settingsError` treatment. Rationale: it is the one control in the bar that changes *what exists* rather than *what you see* — the confusion the current `filter-note` ("· your view only") already apologizes for.

**Disclosure invariants (all views):** any active narrowing is stated where its effect is felt — the count-bearing kind chip, the empty-state sentence naming every active constraint, and the `#scope-note` live region (extend it to name kind-hiding and facets). A hidden population is always one visible control away from shown.

**Accessibility requirements:** chips keep `aria-pressed` (except non-toggle controls, per `filterChip:4024`); each chip group gets `role="group"` with an `aria-label` naming the axis ("Session kinds", "How far back to show sessions", "Provider", "Status"); the read-only collection status is a `<span>`, not a button, so it leaves the focus order; `#scope-note` remains `aria-live="polite"` and gains the kind/facet words; all new controls carry `data-fkey` so focus survives repaints; tab-strip roving tabindex is untouched.

## 4. Behavior matrix by view, session kind, provider, and operator action

Kind is provider-neutral by construction; "provider" appears in this matrix only as the facet. "Routine review" = `sessionKind: review` and not alerting. "Alerting" = `alerting(agent)` (`agent-model.js:313`).

| Surface | Work session | Routine review | Alerting review | Automation (non-review) | Retained record |
|---|---|---|---|---|---|
| **Board, defaults** | shown | **hidden**, counted on the kind chip | **shown + pinned strip** (alerting escape) | shown (Phase 4 decision D1 may hide) | not admitted (`viewMatches`) unless alerting rescue |
| **Board, "Show review workers" on** | shown | shown, chip flips to "Hide review workers" | shown + pinned | shown | as above |
| **Board, query matches row** | shown | **shown** (search escape), tab count unchanged (counts ignore query — pinned by test) | shown | shown | as above |
| **Board, provider/program/status facet** | shown iff facet matches | still hidden unless toggled/alerting/searched; facets AND with kind gate | always shown (alert escape survives every facet — enforced in `currentFilter` ordering) | facet applies | as above |
| **Board shelf (finished)** | admitted by `shelfFilter` | hidden by same gate, same escapes | n/a (alerting ⇒ not terminal in practice; if both, shown) | admitted | n/a |
| **Pinned strip (Needs you)** | pinned iff alerting | never (routine = not alerting by definition) | pinned | pinned iff alerting | pinned iff alerting |
| **History** | shown | **shown — History is complete, kind gate never applies** (`passesReviewVisibility` first clause) | shown | shown | shown with provenance chip |
| **Usage** | counted exactly | **counted exactly — no kind filtering of totals, ever** | counted | counted | out of range only |
| **Notifications panel / badge** | per `attentionClassOf` | unaffected by all presentation filters (panel reads `state.snap` directly, not `currentFilter` — keep it that way) | listed | per class | per `hasCurrentImpact` |
| **Tab counts** | in count | excluded while hidden (count = what the view would render with no query) | in count | in count | not counted on Board |
| **Empty state** | — | "N review workers are hidden from the Board. Show them from Filters." when sole constraint; named among `parts` otherwise | — | — | — |
| **Loading (no snapshot)** | counts `null`, chip absent (`reviewWorkerCount` requires `snap`), bar renders lookback from defaults | — | — | — | — |

Operator actions: toggling the kind chip repaints (paint-sig threaded) and **persists as a server setting shared across browsers** (D7, Task 1.5; session-scoped until Phase 1 deploys); changing lookback persists per-browser (existing); facets do not persist (session-scoped lenses); search never persists; scan-window edits go through Settings → server → snapshot refresh, and the read-only status re-renders from `snap.scanWindowHours` (server-confirmed value wins over the local default, unverified state marked — existing `:4125-4127` logic).

## 5. Data and API contract

New shared types (`src/shared/types.ts`, beside `AgentRole`):

```ts
/* What kind of session this is, as an axis ORTHOGONAL to role: role says what
   authority the agent has; kind says why the session exists. Provider-neutral:
   collectors contribute evidence, one derivation decides. */
export type SessionKind = "work" | "review" | "automation" | "system" | "unknown";
export const SESSION_KINDS = ["work", "review", "automation", "system", "unknown"] as const satisfies readonly SessionKind[];
type SessionKindsAreExhaustive = Exclude<SessionKind, (typeof SESSION_KINDS)[number]> extends never ? true : never;
const _sessionKindsAreExhaustive: SessionKindsAreExhaustive = true;
void _sessionKindsAreExhaustive;

/* Where the kind came from. "launch-evidence" is observed (a provider-recorded
   launch marker); "task-pattern" is inferred (prose matched a known producer's
   prompt); "declared" is a manifest/env claim; "none" accompanies "unknown". */
export type SessionKindSource = "launch-evidence" | "task-pattern" | "declared" | "none";
```

On `AgentSnapshot` (optional — additive, no client breaks; `client-consumes-server-snapshot.test.ts` uses `arrayContaining`):

```ts
  /** Why this session exists — work, review, automation, system — with provenance. */
  sessionKind?: SessionKind;
  sessionKindSource?: SessionKindSource;
```

On `CollectedAgent` (`src/server/types.ts`):

```ts
  /** Provider-recorded launch markers, when the transcript carries them.
      Claude: entrypoint ("cli" | "sdk-py" | …) and promptSource ("sdk" | …).
      Absent for providers that record nothing — absence is evidence of nothing. */
  launch?: { entrypoint?: string; promptSource?: string };
```

Derivation — one site, `src/server/snapshot-agent.ts`, beside `roleFor2`:

```ts
/* Producer registry: prompts we have OBSERVED a specific automation emit.
   Anchored to the start of the task because the task IS the prompt for a
   headless session. security-guidance plugin v2.x, verified 2026-08-05. */
const REVIEW_TASK_PATTERNS = [
  /^review this change for security vulnerabilit/i,
  /^review the (?:pushed|staged) (?:commits?|changes?) for security/i,
];

export function sessionKindFor(input: {
  launch?: { entrypoint?: string; promptSource?: string };
  task?: string;
  declaredKind?: SessionKind;
}): { sessionKind: SessionKind; sessionKindSource: SessionKindSource } {
  if (input.declaredKind) return { sessionKind: input.declaredKind, sessionKindSource: "declared" };
  const entrypoint = input.launch?.entrypoint ?? "";
  const sdkLaunched = input.launch?.promptSource === "sdk" || entrypoint.startsWith("sdk");
  const reviewTask = REVIEW_TASK_PATTERNS.some((p) => p.test((input.task ?? "").trim()));
  if (sdkLaunched) return { sessionKind: reviewTask ? "review" : "automation", sessionKindSource: "launch-evidence" };
  if (entrypoint === "cli") return { sessionKind: "work", sessionKindSource: "launch-evidence" };
  if (reviewTask) return { sessionKind: "review", sessionKindSource: "task-pattern" };
  return { sessionKind: "unknown", sessionKindSource: "none" };
}
```

Key properties: an interactive (`cli`) session is classified `work` **before** any prose matching — the false-positive class dies here; a provider with no launch evidence can still reach `review` via the narrow anchored producer patterns (Codex/Cursor symmetry), and everything else is honestly `unknown`. The broad `\bsecurity review\b` pattern from the client slice is deliberately **not** ported.

Threading (the 11-step list from the pipeline map, applied): type → claude parser capture → `makeAgent` passthrough (cursor.ts/factory.ts contribute nothing yet, so no edits there beyond nothing-breaks verification) → **archive allow-list** (`archive.ts` `archiveCopy` must carry `sessionKind`/`sessionKindSource` so History keeps them) → snapshot literal (explicit lines beside the `...role` spread at `snapshot.ts:503`) → fingerprint: fields are per-session-stable, so they participate (correct — a kind change should push) and cannot churn; pinned by the clock-only test `snapshot.test.ts:172`.

**No new `totals.*` field in Phases 1-3** (avoids the `published-fields-can-vary` registry); the client computes chip counts from rows, as the slice already does. `totals.byKind` is deferred to decision D5.

**One settings-contract addition (D7):** `HubSettings.showReviewWorkers: boolean` (default `false`), returned by GET and accepted by POST with a boolean type check — full spec in Task 1.5. No other endpoint changes; the scan-window UI change is client-only.

**Migration:** field is optional; old snapshots (and retained archive rows written before Phase 1) lack it — client treats absent/`unknown` as "fall back to regex" during Phase 2, and as plain `unknown` (visible) after Phase 4 removes the fallback. Retained rows will not be re-classified (collector never re-reads them) — acceptable: History never hides by kind anyway.

## 6. Producer-side noise/cost reduction

Presentation filtering (above) hides rows; none of it saves a token. The actual spend levers, in order of leverage:

1. **Model choice for the reviewer.** `SECURITY_REVIEW_MODEL` env var (`llm.py:131`) overrides the pinned `claude-opus-4-7`. Exporting it machine-wide (launchd/`~/.zshenv`, so hooks inherit it) to a cheaper model is a one-line change with a review-quality tradeoff that is Emilio's call — decision D2. Evidence to gather first: the yield ledger below.
2. **Measure yield before cutting coverage.** The plugin already records `vulns_found` per reviewed SHA in each repo's `sg-reviewed-shas` file. A ten-line ops script summing reviews vs. non-zero findings across repo roots turns "469 sessions" into "N reviews caught M real findings" — the number that decides whether Stop-hook reviews (per-turn) earn their cost on top of commit/push reviews (per-publication). Owner: Emilio; this plan does not modify the plugin.
3. **Dedup scope.** Reviewed-SHA state is per repo root. Shared-worktree lanes already share it; N separate worktrees of one repo re-review the same commits up to N times. `SECURITY_WARNINGS_STATE_DIR` (`_base.py:33`) exists as an override — pointing all clones of a repo at one state dir is a candidate experiment, flagged upstream rather than patched locally (the plugin is upstream-owned; local edits die on the next plugin update).
4. **Parent/child linkage** cannot be manufactured board-side with confidence: the SDK session records no parent, and cwd+timestamp correlation would be `inferred` guesswork the identity system's own history warns against. The right fix is upstream: the plugin (which knows its parent session id — its state files are keyed by it) could stamp the child. File an issue; until then the board's honest answer is `sessionKind: review`, not a fabricated lineage — decision D4.
5. **Board-side collection cost** (small but free): `nameSessions` currently spends Ollama calls titling these sessions ("Security Vulnerabilities Review #…"). Once `sessionKind` lands, skip out-of-band naming for `review`/`automation` kinds — their task prefix already names them; the collector's derived name is sufficient. One filter in `HubState.#nameNewSessions` candidates (`state.ts:370-386`). Phase 4 task.
6. **What not to do:** do not batch or debounce collection of these sessions, do not drop them from the wire, do not cap History. The board's contract is that it reports what happened; reduction happens at the producer, presentation happens at the client, and the two must never blur (this is the "separate presentation filtering from producer-side reduction" line the goal statement draws).

## 7. Phased implementation plan

### Phase 0 — Land and harden the local slice (client-only, shippable now)

**Landing note:** `app.js` and `styles.css` contain hunks from *two* lanes (this slice and the notification dead-time slice). Landing must either coordinate a joint commit with the notify lane or stage hunk-level (`git add -p`) so each commit tells one story. Path-scoped commits (`git commit -- <paths>`) as always.

### Task 0.1: Pin the shelfFilter twin and the count semantics

**Files:**
- Modify: `tests/web-client.test.ts` (inside `describe("views split Now from History")`, after the review-worker test at ~line 1477)

**Interfaces:**
- Consumes: `M.shelfFilter`, `M.currentFilter`, `M.renderTabs`, `withState`, `withDom`, `agent()`, `snapshot()`, `domById` — all existing seam members.
- Produces: nothing new — coverage only.

- [ ] **Step 1: Write the failing-if-absent tests**

```ts
test("the shelf hides routine review workers under the same gate as the board", async () => {
  const review = agent({
    id: "claude:done-review", provider: "claude", status: "archived",
    task: "Review this change for security vulnerabilities.",
    updatedAt: new Date().toISOString(),
  });
  const work = agent({
    id: "codex:done-work", status: "archived",
    task: "Implement the lifecycle change.", updatedAt: new Date().toISOString(),
  });
  const program = { id: "p", name: "P", agents: [review, work] };
  await withState({
    view: "board", query: "", facetProgram: "", facetProvider: "",
    lookbackHours: 6, showReviewWorkers: false,
  }, () => {
    expect(M.shelfFilter()(review, program)).toBe(false);
    expect(M.shelfFilter()(work, program)).toBe(true);
  });
  await withState({
    view: "board", query: "", facetProgram: "", facetProvider: "",
    lookbackHours: 6, showReviewWorkers: true,
  }, () => {
    expect(M.shelfFilter()(review, program)).toBe(true);
  });
  // A search is an explicit request: it admits the hidden review to the shelf too.
  await withState({
    view: "board", query: "security", facetProgram: "", facetProvider: "",
    lookbackHours: 6, showReviewWorkers: false,
  }, () => {
    expect(M.shelfFilter()(review, program)).toBe(true);
  });
});

test("tab counts are population counts: a search never changes them", async () => {
  const updatedAt = new Date().toISOString();
  const review = agent({
    id: "claude:r1", provider: "claude", updatedAt,
    task: "Review this change for security vulnerabilities.",
  });
  const work = agent({ id: "codex:w1", updatedAt, task: "Implement the lifecycle change." });
  const snap = snapshot({ programs: [{ id: "p", name: "P", agents: [review, work] }] });
  // The row renders under the search escape while the count stays the no-query
  // population — counts ignore query BY DESIGN; this pins that reading.
  await withState({ snap, view: "board", query: "security", lookbackHours: 6, showReviewWorkers: false },
    () => withDom(() => {
      M.renderTabs();
      expect(domById.get("count-board")!.textContent).toBe("1");
      expect(M.currentFilter()(review, snap.programs[0])).toBe(true);
    }));
});
```

- [ ] **Step 2: Run them**

Run: `bun test tests/web-client.test.ts -t "shelf hides routine review"` and `-t "population counts"`
Expected: PASS (the behavior exists; the coverage did not). If either fails, the slice has a real bug — fix before proceeding.

- [ ] **Step 3: Commit**

```bash
git commit -m "test(web): pin shelf review gate and count-vs-search semantics" -- tests/web-client.test.ts
```

### Task 0.2: Extract and test the empty-state sentence

**Files:**
- Modify: `src/web/app.js:4964-4980` (inside `renderPrograms`), export seam at `app.js:1310`
- Test: `tests/web-client.test.ts`

**Interfaces:**
- Produces: `emptyListMessage(ui) -> string | null` — pure; returns the constrained-empty sentence, or `null` when the empty state is unconstrained (caller falls through to the existing all-clear branch). Signature consumed by Task 3.4's facet additions.

- [ ] **Step 1: Extract the pure helper**

In `app.js`, directly above `renderPrograms`, move the branch logic:

```js
/* The constrained-empty sentence, pure so the harness can reach it: renderPrograms
   is below the seam and its copy was unreachable by test. Returns null when no
   constraint is active (the all-clear composite renders instead). */
function emptyListMessage(ui = state) {
  const lookbackHiding = lookbackApplies(ui.view) && ui.lookbackHours != null;
  const reviewsHidden = !ui.showReviewWorkers ? reviewWorkerCount(ui) : 0;
  if (!ui.query && !ui.facetProgram && !ui.facetProvider && !lookbackHiding && !reviewsHidden) return null;
  const parts = [];
  if (ui.query || ui.facetProgram || ui.facetProvider) parts.push("search and filters");
  if (lookbackHiding) parts.push("lookback (" + lookbackLabel(ui.lookbackHours) + ")");
  if (reviewsHidden) parts.push(reviewsHidden + " review workers hidden");
  return reviewsHidden && parts.length === 1
    ? reviewsHidden + " review workers are hidden from the Board. Show them from Filters."
    : "Nothing matches the current " + parts.join(" and ") + " in this view.";
}
```

Replace the inline branch in `renderPrograms` with:

```js
  const constrained = emptyListMessage(state);
  if (constrained) {
    root.append(el("p", { class: "no-match", text: constrained }));
  } else {
```

Add `emptyListMessage` to the seam line at `app.js:1310`.

- [ ] **Step 2: Write the test**

```ts
test("the empty board names every constraint that produced it", async () => {
  const review = agent({
    id: "claude:r1", provider: "claude", updatedAt: new Date().toISOString(),
    task: "Review this change for security vulnerabilities.",
  });
  const snap = snapshot({ programs: [{ id: "p", name: "P", agents: [review] }] });
  await withState({ snap, view: "board", query: "", facetProgram: "", facetProvider: "",
    lookbackHours: 6, showReviewWorkers: false }, () => {
    expect(M.emptyListMessage(M.state))
      .toBe("1 review workers are hidden from the Board. Show them from Filters.");
  });
  await withState({ snap, view: "board", query: "zzz", facetProgram: "", facetProvider: "",
    lookbackHours: 6, showReviewWorkers: false }, () => {
    expect(M.emptyListMessage(M.state))
      .toBe("Nothing matches the current search and filters and lookback (6h) and 1 review workers hidden in this view.");
  });
  await withState({ snap, view: "board", query: "", facetProgram: "", facetProvider: "",
    lookbackHours: null, showReviewWorkers: true }, () => {
    expect(M.emptyListMessage(M.state)).toBeNull();
  });
});
```

(If the singular/plural "1 review workers" grates, fix the copy in the helper — `reviewsHidden + " review worker" + (reviewsHidden === 1 ? "" : "s")` — and assert the corrected string; do it in this task, not later.)

- [ ] **Step 3: Run the file**

Run: `bun test tests/web-client.test.ts`
Expected: all pass (476 + the new ones). The CSS census and source-hygiene suites guard the refactor.

- [ ] **Step 4: Commit**

```bash
git commit -m "refactor(web): extract emptyListMessage so the empty-state copy is testable" -- src/web/app.js tests/web-client.test.ts
```

### Task 0.3: ~~Persist the toggle in localStorage~~ — SUPERSEDED by D7

D7 ruled the toggle a **server setting** shared across browsers, not a per-browser lens. No localStorage key, no `client-catalogs.js` change. Persistence lands as Task 1.5 (server side + client adoption). Until Phase 1 deploys, `showReviewWorkers` is session-scoped — it reverts to hidden on reload, which is acceptable for the interim because the chip discloses the hidden count on every paint.

### Task 0.4: Land the slice

- [ ] **Step 1:** `bunx tsc --noEmit && bun test` — full local gate (`bun run check`), green.
- [ ] **Step 2:** Coordinate with the notification lane on `app.js`/`styles.css` co-tenancy; commit this slice's remaining hunks (`agent-model.js`, `client-state.js`, the filter/tab/empty-state hunks of `app.js`, the two existing tests) with a message per file-group; never sweep the notify hunks.
- [ ] **Step 3:** Reload the board (static serve — no restart needed for client files), verify: Board shows the chip "Show review workers (N)", History count unchanged, pinned strip unchanged.

### Phase 1 — Server-owned `sessionKind` (evidence + derivation + publication)

### Task 1.1: Shared types

**Files:**
- Modify: `src/shared/types.ts` (add `SessionKind`, `SESSION_KINDS`, `SessionKindSource` from §5 verbatim; add the two optional fields to `AgentSnapshot` beside `role`/`roleSource` at `:392-394`)
- Modify: `src/server/types.ts` (add `launch?` to `CollectedAgent` from §5 verbatim)

**Interfaces:**
- Produces: `SessionKind`, `SessionKindSource`, `SESSION_KINDS`, `AgentSnapshot.sessionKind?`, `AgentSnapshot.sessionKindSource?`, `CollectedAgent.launch?` — exact shapes in §5.

- [ ] **Step 1:** Apply the §5 type blocks. Run `bunx tsc --noEmit` → clean.
- [ ] **Step 2:** Commit: `git commit -m "feat(types): session-kind axis with provenance" -- src/shared/types.ts src/server/types.ts`

### Task 1.2: Claude parser captures launch evidence

**Files:**
- Modify: `src/server/collectors.ts` — `createClaudeParser` (`:741-897`) and `makeAgent` (`:344-464`)
- Test: `tests/collectors.test.ts`

**Interfaces:**
- Consumes: transcript rows' `entrypoint` / `promptSource` string fields (present on `user` and `attachment` records; verified live).
- Produces: `CollectedAgent.launch` populated for claude sessions; `makeAgent(input)` accepts `launch` in its input object and passes it through unchanged.

- [ ] **Step 1: Write the failing test** (inline-rows pattern per `collectors.test.ts:510-536`; mirror the canonical call shape at `:480-508`):

```ts
test("claude parser records launch evidence from the transcript envelope", () => {
  const row = (extra: Record<string, unknown>) => JSON.stringify({
    sessionId: "sdk-1", cwd: "/tmp/anthill-launch", timestamp: "2026-07-21T23:30:00.000Z",
    uuid: "u1", isSidechain: false, userType: "external", version: "2.0.0", ...extra,
  });
  const sdk = parseClaudeJsonl([
    row({ type: "user", entrypoint: "sdk-py", promptSource: "sdk",
      message: { role: "user", content: "Review this change for security vulnerabilities.\n\nChanged files: x" } }),
  ].join("\n"), { nowMs });
  expect(sdk[0].launch).toEqual({ entrypoint: "sdk-py", promptSource: "sdk" });

  const cli = parseClaudeJsonl([
    row({ type: "user", entrypoint: "cli",
      message: { role: "user", content: "Fix the flaky lifecycle test." } }),
  ].join("\n"), { nowMs });
  expect(cli[0].launch).toEqual({ entrypoint: "cli" });
});
```

(Adjust the destructuring to the file's actual return shape — the canonical assertion at `collectors.test.ts:480-508` is the template; if `parseClaudeJsonl` returns a single agent, drop the `[0]`.)

- [ ] **Step 2: Run** → FAIL (`launch` undefined).
- [ ] **Step 3: Implement.** In `createClaudeParser`'s per-row loop (beside the `originCwd ??= row.cwd` first-seen capture at `:780-783`):

```ts
      if (launch?.entrypoint == null && typeof row.entrypoint === "string" && row.entrypoint) {
        launch = { ...launch, entrypoint: row.entrypoint };
      }
      if (launch?.promptSource == null && typeof row.promptSource === "string" && row.promptSource) {
        launch = { ...launch, promptSource: row.promptSource };
      }
```

with `let launch: CollectedAgent["launch"];` in the parser's closure state, first-seen-wins (same rationale as `originCwd`: the launch is a fact about the session's birth). Pass `launch` into the `makeAgent` input and spread it onto the produced agent in `makeAgent` (one line: `launch: input.launch,`). Incremental re-parses keep the closure, so the evidence survives appends; no `retainProcessEvidence` change (that helper carries hook-attached facts, not parser facts).

- [ ] **Step 4: Run** → PASS. Also run `bun test tests/collectors.test.ts tests/atlas-collectors-golden.test.ts` — the golden fixtures must not shift (they carry no `entrypoint` field, so `launch` stays absent — assert nothing broke).
- [ ] **Step 5: Commit:** `git commit -m "feat(collectors): capture claude launch evidence (entrypoint, promptSource)" -- src/server/collectors.ts tests/collectors.test.ts`

### Task 1.2b: Catalogue Codex/Cursor launch markers (D6 — parallel BE lane)

**Files:**
- Investigate: `~/.codex/sessions/**` (one real `codex exec` rollout vs one interactive TUI session), `~/.cursor/chats/**` (one background-composer transcript vs one interactive)
- Modify (conditional): `src/server/collectors.ts` (`parseCodexJsonl` session_meta handling near `:675-686`), `src/server/cursor.ts` (`:249-334` / the transcript walker)
- Test: `tests/collectors.test.ts`, `tests/cursor.test.ts`

**Interfaces:**
- Produces: `CollectedAgent.launch` populated for codex/cursor **iff** a deterministic recorded marker exists (candidates: codex `session_meta.originator` / `source` fields; cursor composer-mode metadata). Same `{ entrypoint?, promptSource? }` shape — map provider-specific values into it verbatim (e.g. `entrypoint: "codex-exec"`), never invent a value the file does not record.

- [ ] **Step 1:** Generate/locate one sample of each launch mode per provider; diff the session-file headers field-by-field. Record findings (field name, values, which modes distinguishable) in this plan under §2 as an evidence addendum.
- [ ] **Step 2:** If a marker exists: wire it exactly per Task 1.2's pattern (first-seen capture, inline-row test asserting both modes, golden suites unmoved). If not: record "no recorded marker; kind stays pattern/`unknown` for this provider" — that sentence is the deliverable, and `sessionKindFor` needs no change either way.
- [ ] **Step 3:** `bun test tests/collectors.test.ts tests/cursor.test.ts tests/atlas-collectors-golden.test.ts` → green. Commit path-scoped.

### Task 1.3: Derive and publish `sessionKind`

**Files:**
- Modify: `src/server/snapshot-agent.ts` (add `sessionKindFor` beside `roleFor2` at `:240`), `src/server/snapshot.ts` (call + publish beside the role spread at `:447-450` / `:503`), `src/server/archive.ts` (`archiveCopy` allow-list)
- Test: `tests/snapshot.test.ts`

**Interfaces:**
- Consumes: `CollectedAgent.launch`, `agent.task`, (future) manifest `declaredKind` — pass `undefined` for now.
- Produces: `sessionKindFor(input) -> { sessionKind, sessionKindSource }` (§5 verbatim, exported); `AgentSnapshot.sessionKind`/`sessionKindSource` on every published row; both fields surviving `archiveCopy`.

- [ ] **Step 1: Write the failing tests** (in `snapshot.test.ts`, new describe after the lifecycle block at `:1915-2146`, using the `collected()` builder at `:36-53`):

```ts
describe("session kind is published with provenance, and evidence beats prose", () => {
  test("an sdk-launched review prompt is a review worker, observed", async () => {
    const snap = await buildFrom(collected({
      id: "claude:sdk-r", provider: "claude",
      launch: { entrypoint: "sdk-py", promptSource: "sdk" },
      task: "Review this change for security vulnerabilities.\n\nChanged files: x",
    }));
    const agent = snap.programs.flatMap((p) => p.agents).find((a) => a.id === "claude:sdk-r")!;
    expect(agent.sessionKind).toBe("review");
    expect(agent.sessionKindSource).toBe("launch-evidence");
  });
  test("a cli session that merely talks about security review is work", async () => {
    const snap = await buildFrom(collected({
      id: "claude:cli-w", provider: "claude", launch: { entrypoint: "cli" },
      task: "Plan a fix for the repeated Security vulnerability review rows.",
    }));
    const agent = snap.programs.flatMap((p) => p.agents).find((a) => a.id === "claude:cli-w")!;
    expect(agent.sessionKind).toBe("work");
    expect(agent.sessionKindSource).toBe("launch-evidence");
  });
  test("no evidence and no known prompt is unknown, never a guess", async () => {
    const snap = await buildFrom(collected({ id: "codex:mystery", task: "Ship the thing." }));
    const agent = snap.programs.flatMap((p) => p.agents).find((a) => a.id === "codex:mystery")!;
    expect(agent.sessionKind).toBe("unknown");
    expect(agent.sessionKindSource).toBe("none");
  });
  test("an sdk launch with an unrecognized prompt is automation, not review", async () => {
    const snap = await buildFrom(collected({
      id: "claude:sdk-a", provider: "claude",
      launch: { entrypoint: "sdk-py", promptSource: "sdk" }, task: "Summarize the changelog.",
    }));
    const agent = snap.programs.flatMap((p) => p.agents).find((a) => a.id === "claude:sdk-a")!;
    expect(agent.sessionKind).toBe("automation");
  });
});
```

(`buildFrom` = whatever one-agent `buildSnapshot` invocation the surrounding describes already use — copy the adjacent lifecycle describe's setup verbatim rather than inventing one.)

- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.** `sessionKindFor` in `snapshot-agent.ts` exactly as §5. In `snapshot.ts`, beside the `roleFor2` call:

```ts
    const kind = sessionKindFor({ launch: agent.launch, task: agent.task });
```

and in the published object literal (near `:503`): `sessionKind: kind.sessionKind, sessionKindSource: kind.sessionKindSource,`. In `archive.ts`, add both field names to the `archiveCopy` allow-list so History retains the verdict.

- [ ] **Step 4: Fingerprint discipline.** Run `bun test tests/snapshot.test.ts -t "clock-only"` (the `:172` guard) — must stay green (the fields are pass-stable). Add one positive control in the new describe:

```ts
  test("a kind change moves the fingerprint", async () => {
    const base = collected({ id: "claude:fp", provider: "claude", launch: { entrypoint: "cli" }, task: "Fix it." });
    const a = snapshotFingerprint(await buildFrom(base));
    const b = snapshotFingerprint(await buildFrom({ ...base, launch: { entrypoint: "sdk-py", promptSource: "sdk" } }));
    expect(a).not.toBe(b);
  });
```

- [ ] **Step 5: Run the neighborhood:** `bun test tests/snapshot.test.ts tests/snapshot-agent.test.ts tests/snapshot-edges.test.ts tests/client-consumes-server-snapshot.test.ts tests/published-fields-can-vary.test.ts` → all green (agent-level additions are invisible to the census walkers; that is by design).
- [ ] **Step 6: Commit:** `git commit -m "feat(snapshot): publish sessionKind with provenance" -- src/server/snapshot-agent.ts src/server/snapshot.ts src/server/archive.ts tests/snapshot.test.ts`

### Task 1.4: Deploy and verify against the live fleet

- [ ] **Step 1:** `bun run check` → green. Restart the production server per DEPLOY.md (`anthill-start.sh`, port 4701, launchd-managed — restart the service, don't orphan it).
- [ ] **Step 2:** Verify on live data:

```bash
curl -s http://127.0.0.1:4701/api/health | jq .ok   # true
curl -s http://127.0.0.1:4701/api/snapshot | jq '
  [.programs[].agents[] | select(.provider=="claude")] |
  group_by(.sessionKind) | map({(.[0].sessionKind // "absent"): length}) | add'
```

Acceptance: the ~469 review sessions report `sessionKind: "review"` with `sessionKindSource: "launch-evidence"`; interactive sessions report `work`; **this plan's own session reports `work`, not `review`** (the false-positive control, live). Expect `unknown` for retained rows archived before this deploy — correct, not a bug.

### Task 1.5: `showReviewWorkers` becomes a server setting (D7)

**Files:**
- Modify: `src/server/settings.ts` (`HubSettings` at `:53-54`, defaults, `SETTING_KEYS`, the POST validation in `handleSettingsRequest` `:262-347`, `normalizeSettings` `:136-157`), `src/web/app.js` (`fetchSettings` `:1379-1406`, `setShowReviewWorkers` `:3827`), `src/web/client-state.js` (comment only — the field's source of truth changes)
- Test: the settings contract suite (locate by grepping tests for `"Unknown settings"`), `tests/web-client.test.ts`

**Interfaces:**
- Produces: `HubSettings.showReviewWorkers: boolean` (default `false`); `/api/settings` GET returns it, POST accepts it with a type check (booleans bypass `clampSetting` — model the validation branch on `defaultView`'s enum handling at `settings.ts:20-22`/`:28-43`, not on the numeric table); `normalizeSettings` fills the default so old `data/settings.json` files load clean (no `SETTINGS_VERSION` bump — additive with default).
- Consumes: the existing `postSettings(patch)` client plumbing (`app.js:1420-1458`) — error toast, pending state, snapshot refetch all come free.

- [ ] **Step 1: Server test first** — in the settings contract suite: GET includes `showReviewWorkers: false` by default; `POST {"showReviewWorkers": true}` round-trips; `POST {"showReviewWorkers": "yes"}` → 400 `INVALID_SETTINGS` with a message naming the key; unknown-key rejection unchanged.
- [ ] **Step 2: Implement server** — field + default + validation branch + normalize. Run the suite → green.
- [ ] **Step 3: Client adoption** — in `fetchSettings`, after the `scanWindowHours` adoption: `if (typeof body.settings?.showReviewWorkers === "boolean" && !state.settingsPending) state.showReviewWorkers = body.settings.showReviewWorkers;`. Rewrite `setShowReviewWorkers`:

```js
function setShowReviewWorkers(show) {
  const next = Boolean(show);
  if (next === state.showReviewWorkers) return;
  state.showReviewWorkers = next;      // optimistic — the chip flips now
  render();
  void postSettings({ showReviewWorkers: next });  // shared default; errors toast + refetch restores truth
}
```

- [ ] **Step 4: Client test** — source-level: the setter slice contains `postSettings({ showReviewWorkers` (use `requiredSlice`); plus a `fetchSettings` adoption assertion. Run `bun test tests/web-client.test.ts` → green.
- [ ] **Step 5:** `bun run check` → green; deploy rides the Phase 1 restart. Commit path-scoped.

### Phase 2 — Client cutover to the server verdict

**Precondition (D1 — Task 2.0):** run the cross-project-dir census before cutover: for every `~/.claude/projects/*/`, count `sdk-py` transcripts and how many carry a known review prompt (the Task 4.3 script, promoted here). If material non-review automation volume appears, bring the numbers back to Emilio to re-rule D1 (hide `automation` too vs review-only) **before** Task 2.1's gate wording ships. Review-only hiding proceeds regardless; the census only decides whether the gate widens.

### Task 2.1: `sessionKindOf` with transition fallback

**Files:**
- Modify: `src/web/agent-model.js` (beside `isReviewWorker` at `:96-101`), `src/web/app.js` (`passesReviewVisibility` `:3808`, `reviewWorkerCount` `:3816`, seam `:1255`/`:1310`)
- Test: `tests/web-client.test.ts`

**Interfaces:**
- Produces: `sessionKindOf(agent) -> "work"|"review"|"automation"|"system"|"unknown"` — server field when present and not `"unknown"`; else regex fallback mapping to `"review"`/`"unknown"`. `passesReviewVisibility`/`reviewWorkerCount` consume `sessionKindOf(agent) === "review"` in place of bare `isReviewWorker(agent)`.

- [ ] **Step 1: Write the failing tests**

```ts
test("the server's sessionKind outranks the client regex in both directions", () => {
  // Server says work: the regex match is overruled — the false-positive fix.
  const chatty = agent({
    sessionKind: "work", sessionKindSource: "launch-evidence",
    task: "Investigate the repeated Security vulnerability review rows.",
    updatedAt: new Date().toISOString(),
  });
  expect(M.sessionKindOf(chatty)).toBe("work");
  expect(M.passesReviewVisibility(chatty, "board", false)).toBe(true);
  // Server says review: no prose needed.
  const quietName = agent({ sessionKind: "review", sessionKindSource: "launch-evidence",
    task: "…", updatedAt: new Date().toISOString() });
  expect(M.sessionKindOf(quietName)).toBe("review");
  expect(M.passesReviewVisibility(quietName, "board", false)).toBe(false);
  // No server verdict: the regex still catches the known producer (transition).
  const legacy = agent({ task: "Review this change for security vulnerabilities.",
    updatedAt: new Date().toISOString() });
  expect(M.sessionKindOf(legacy)).toBe("review");
});
```

- [ ] **Step 2: Run** → FAIL (`sessionKindOf` undefined).
- [ ] **Step 3: Implement** in `agent-model.js`:

```js
/* The server's verdict when it has one; the regex only bridges snapshots that
   predate sessionKind. "unknown" falls through to the fallback on purpose —
   the server saying "no evidence" is not the server saying "not a review". */
export function sessionKindOf(agent) {
  const kind = agent?.sessionKind;
  if (kind && kind !== "unknown") return kind;
  return isReviewWorker(agent) ? "review" : "unknown";
}
```

Swap `!isReviewWorker(agent)` → `sessionKindOf(agent) !== "review"` in `passesReviewVisibility`, and `isReviewWorker(agent)` → `sessionKindOf(agent) === "review"` in `reviewWorkerCount` and in `currentFilter`/`shelfFilter`'s `searchMatches` computation. Export `sessionKindOf` on the seam (both lines).

- [ ] **Step 4: Run the file** → all green (the Phase 0 tests keep passing because the fallback preserves regex behavior for kind-less fixtures).
- [ ] **Step 5: Commit:** `git commit -m "feat(web): board review gate prefers the server sessionKind" -- src/web/agent-model.js src/web/app.js tests/web-client.test.ts`

### Phase 3 — One Filters surface

### Task 3.1: Provider facet chips (activate the dead `facetProvider`)

**Files:**
- Modify: `src/web/app.js` (`renderFilterBar` board/history branch after the kind chip at `:4091`; a `setFacetProvider` beside `setShowReviewWorkers`), `tests/web-client.test.ts` (**update the pinned fkey-order test at `:6639-6668`**)

**Interfaces:**
- Produces: `setFacetProvider(provider)` (toggle-to-clear semantics); chips `provider:<name>` rendered only when ≥2 distinct providers are on the wire. `programsPaintSig` already reads `ui.facetProvider` — no sig change.

- [ ] **Step 1: Implement**

```js
function setFacetProvider(provider) {
  const next = state.facetProvider === provider ? "" : provider;
  if (next === state.facetProvider) return;
  state.facetProvider = next;
  render();
}
```

In `renderFilterBar` (board/history branch, after the kind chip):

```js
  const providers = ui.snap
    ? [...new Set(snapshotAgents(ui.snap).map(({ agent }) => agent.provider))].sort()
    : [];
  if (providers.length > 1) {
    const providerGroup = el("div", { class: "filter-group", role: "group", "aria-label": "Provider" });
    for (const p of providers) {
      providerGroup.append(filterChip(p, ui.facetProvider === p, () => setFacetProvider(p), {
        fkey: "provider:" + p,
        title: ui.facetProvider === p ? "Show every provider" : "Show only " + p + " sessions",
      }));
    }
    bar.append(providerGroup);
  }
```

- [ ] **Step 2: Update the fkey-order pin.** The test at `:6649` asserts the exact array `["lookback:1",…,"scan-window"]`; it renders with a `listUi` that has no snap, so provider chips are absent and it may pass unchanged — extend it instead with a second assertion that renders with a two-provider snapshot and pins the full order including `provider:*` chips. The order contract is part of the plan: `session-kind:* → provider:* → lookback:* → status:* → program:clear → scan status`.
- [ ] **Step 3: Behavior test:**

```ts
test("a provider facet narrows the board and discloses itself", async () => {
  const updatedAt = new Date().toISOString();
  const claude = agent({ id: "claude:1", provider: "claude", updatedAt, task: "A" });
  const codex = agent({ id: "codex:1", provider: "codex", updatedAt, task: "B" });
  const program = { id: "p", name: "P", agents: [claude, codex] };
  const snap = snapshot({ programs: [program] });
  await withState({ snap, view: "board", query: "", facetProgram: "", facetProvider: "codex",
    lookbackHours: 6, showReviewWorkers: true }, () => {
    expect(M.currentFilter()(codex, program)).toBe(true);
    expect(M.currentFilter()(claude, program)).toBe(false);
  });
});
```

- [ ] **Step 4: Run + commit:** `bun test tests/web-client.test.ts` → green. `git commit -m "feat(web): provider facet chips in the one Filters bar" -- src/web/app.js tests/web-client.test.ts`

### Task 3.2: Status lens chips and the program clear-chip

**Files:**
- Modify: `src/web/client-state.js` (add `facetStatus: ""`), `src/web/app.js` (`currentFilter`, `shelfFilter`, `renderFilterBar`, `programsPaintSig` — add `ui.facetStatus`; `renderProgramDrawer` `:6804` gains "Only this program"), `tests/web-client.test.ts` (`listUi` gains `facetStatus: ""`)

**Interfaces:**
- Produces: `state.facetStatus ∈ "" | "working" | "waiting" | "unverified"`; clause in `currentFilter`: `(!state.facetStatus || lifecycleSection(agent) === (state.facetStatus === "working" ? "active" : state.facetStatus))`; `shelfFilter` returns `false` for any row while `facetStatus` is set (a lifecycle lens and a finished shelf cannot both be true); chips `status:working|waiting|unverified` (Board only); `program:clear` chip rendered only while `facetProgram` is set, labeled with the program's name; drawer button `fkey: "facet-program:<id>"` calling `setFacetProgram(program.id)`.
- Consumes: `lifecycleSection` (`agent-model.js:407`), `emptyListMessage` (Task 0.2 — extend its `parts` to name the status lens and provider by word, e.g. `parts.push("status (waiting)")`).

- [ ] **Step 1:** Implement setters (`setFacetStatus`, `setFacetProgram` — toggle-to-clear, mirror Task 3.1), chips, paint-sig line, drawer button, `emptyListMessage` extension, `renderScopeNote` words.
- [ ] **Step 2:** Tests: one `currentFilter` matrix test over the three lenses (fixture per lifecycle via `listUi`/`agent` status mapping — `status:"running"`→active, `"waiting"`→waiting; unverified via the `LIFECYCLE_FOR_STATUS` translation in the fixture builder); one shelf-suppression test (`facetStatus: "waiting"` ⇒ `M.shelfFilter()(finishedAgent, program) === false`); one `emptyListMessage` string assertion naming the lens.
- [ ] **Step 3:** `bun test tests/web-client.test.ts` → green. Commit path-scoped.

### Task 3.3: Scan window becomes read-only collection status

**Files:**
- Modify: `src/web/app.js` (`renderFilterBar:4120-4153` chip → status span; `renderSettingsPanel` gains the editor), `src/web/styles.css` (`.filter-status` — remember the CSS census), `tests/web-client.test.ts` (the scan-chip test at `:6606-6638` and the fkey-order pin)

**Interfaces:**
- Produces: `<span class="filter-status" title="…">Collecting last 36h</span>` (or `Collecting: unverified` under `settingsError`, keeping the `:4125-4127` confirmed-vs-local logic verbatim); a numeric field + Apply button in the settings panel wired to the existing `postScanWindow(hours)` (`app.js:1408`), carrying `data-fkey="scan-window"` so muscle-memory focus restore still lands.
- Consumes: `postScanWindow`, `state.settingsPending/settingsError/settingsSavedAt` — all existing.

- [ ] **Step 1:** Implement. Title text, exactly: `"Server-side collection bound: sessions with no activity in this window leave the wire entirely, for every browser. Change it in Settings."`
- [ ] **Step 2:** Update the `:6606-6638` test to assert the span (not a button), the unverified branch, and that `buttonsOf(bar)` no longer contains a `scan-window` fkey; add a settings-panel test asserting the editor exists with the fkey and calls through (source-level assertion on `postScanWindow` is acceptable — the panel renders under `withDom`).
- [ ] **Step 3:** `bun test tests/web-client.test.ts` → green (CSS census: `.filter-status` appears literally in `app.js`). Commit path-scoped, including the one-line `setView("now")` → `setView("board")` fix at `app.js:9472` (`fix(web): usage session link lands on the board`, its own commit).

### Phase 4 — Producer-side reduction and cleanup

### Task 4.1: Skip out-of-band naming for non-work kinds

**Files:**
- Modify: `src/server/state.ts` (`#nameNewSessions` candidate filter at `:370-386`)
- Test: `tests/snapshot.test.ts` or the session-names test file if one exists (check `tests/` for `session-names`; place beside existing coverage)

**Interfaces:**
- Consumes: the same `sessionKindFor` evidence (call it on the collected agent pre-snapshot, or filter on `launch` directly — prefer `launch?.promptSource === "sdk"` at this layer since kind derivation lives downstream).
- Produces: automation/review sessions keep their collector-derived name; Ollama is not consulted for them.

- [ ] **Step 1:** Test first: a candidate with `launch: { promptSource: "sdk" }` is not offered to the namer; a `cli` candidate still is.
- [ ] **Step 2:** Implement the one-line filter with a comment stating the why (their task prefix already names them; the namer is for humans' untitled work sessions).
- [ ] **Step 3:** `bun run check` → green. Commit.

### Task 4.2: Remove the client regex fallback

Preconditions: Phase 1 deployed ≥ one full `historyRetentionDays` cycle **or** Emilio accepts that pre-deploy retained rows read `unknown` (they are only in History, which never hides — no visible change). Then: delete `REVIEW_WORKER_PATTERNS`/`isReviewWorker` from `agent-model.js`, collapse `sessionKindOf` to the server field, update the two Phase-0-era tests that feed kind-less fixtures (give them explicit `sessionKind`), remove the seam export. One commit. This closes the loop on the false-positive class permanently.

### Task 4.3: Ops evidence ledger (no repo changes)

- [ ] Mine `sg-reviewed-shas` across repo roots: reviews run vs `vulns_found > 0`, per repo, per hook type if distinguishable — a scratch script, results into the decision doc. This is the baseline the D2 trim is judged against (before/after finding-yield must not collapse).
- [ ] BurnBar join: `sessionProcessed` vs BurnBar per-session totals for the 469 (join on `sourceSessionId`) → the dollar figure for the D2 record.
- [ ] Duplicate-SHA count across worktree roots of one repo (cooper-scheduler is the natural sample) → closes the D3 record.
- [ ] (The cross-dir census moved to Task 2.0 per D1.)

### Task 4.4: Trim the Stop-hook review path (D2 ruling)

Commit/push reviews stay (publication gates); the per-turn Stop review is the volume driver to remove.

- [ ] **Step 1: Find the supported switch.** Read `security-guidance/2.0.6/hooks/extensibility.py` and the plugin README for a config/env that scopes the LLM review to commit/push only (the pattern-warning path on edits is cheap and stays). Do **not** hand-edit `hooks.json` in the plugin cache — it is overwritten on plugin update, and a silently-reverted trim is worse than none.
- [ ] **Step 2a (switch exists):** set it machine-wide (launchd env / `~/.zshenv`, so every lane inherits), then verify: next Stop on a lane spawns no `sdk-py` review session (watch `~/.claude/projects/<dir>/` or the Board's new `sessionKind` counts), while a `git commit` still does.
- [ ] **Step 2b (no switch):** fold the ask into the Task 4.5 upstream issue ("configurable trigger scope: stop | commit | push"), and leave triggers unchanged locally.
- [ ] **Step 3: After one normal working day**, re-run the Task 4.3 yield ledger; record review-count delta and finding-yield delta next to the D2 ruling in §9.

### Task 4.5: File the upstream issue (D4 ruling)

- [ ] One issue on the security-guidance plugin repo (anthropics/claude-plugins-official), from §1's evidence: (a) **stamp child sessions with the parent session id** (the hook knows it — its state files are keyed by it) so fleet dashboards can group reviews under the lane that triggered them; (b) if Task 4.4 found no switch, **configurable trigger scope**; (c) optionally note the cross-worktree dedup gap (D3) as a minor. Link the census numbers (469 sessions / 33M tokens on one machine) as motivation. Publication gate: Emilio approves the issue text before it is posted (external action).

## 8. Test and rollout strategy

**Per-phase gates (all phases):** `bunx tsc --noEmit` → `bun test` (full local, includes the four CI-excluded suites) → `scripts/ci-tests.sh` (hermetic parity) → path-scoped commits. Server phases additionally: restart via `anthill-start.sh`, `/api/health` 200, and the live-fleet jq verification of Task 1.4. Client phases: hard-reload the board, walk the acceptance list below.

**Test placement:** client behavior in `tests/web-client.test.ts` inside the existing describes named in Phase tasks; collector evidence in `tests/collectors.test.ts` (inline rows, never mutate `claude-session.jsonl` — it is shared with `snapshot.test.ts` and the golden suite); publication contract in `tests/snapshot.test.ts` with a fingerprint control; no home paths (`homedir()` rule); new files auto-enter CI.

**Contract-test landmines, named:** `snapshot.test.ts:172` (clock-only fingerprint stability — new fields must be pass-stable), `published-fields-can-vary` (only if a `totals.*` field is ever added — D5), `web-client.test.ts:5649` (CSS census — `.filter-status`), `web-client.test.ts:6649` (exact fkey order — updated deliberately in 3.1/3.3, never incidentally), `reference-docs.test.ts` (runs only under `bun run check`; touches nothing here unless ARCHITECTURE.md starts documenting `sessionKind` — recommended one sentence in the snapshot section, added in Task 1.3's commit).

**Acceptance criteria (the plan is done when):**
1. Board default shows zero routine review rows; the Filters chip reads "Show review workers (N)" with N > 0 on this fleet; toggling shows them; reload preserves the choice.
2. An alerting review session is pinned and visible under every filter combination (test-pinned; verified once live by the next real permission-block).
3. This planning session's own row is on the Board (`sessionKind: "work"`, launch-evidence) while the 469 reviewers are hidden — the live false-positive control.
4. History and Usage populations are byte-identical before/after (History count, Usage totals — compare `/api/snapshot` totals pre/post client deploy).
5. Tab counts, scope note, and empty states each disclose exactly the active constraints; no tab label carries a time window.
6. `/api/snapshot` classifies ≥95% of the review-prompt sessions as `review`/`launch-evidence` (measured: expect 100% of the 384-style sdk-py population).
7. The one Filters bar owns kind, time, provider, program, status; the scan window renders as read-only status; `bun run check` green throughout.

**Rollback:** every phase is independently revertible (client phases are static files — `git revert` + reload; server phases — revert + restart). `sessionKind` is optional on the wire, so a server rollback strands no client (fallback regex remains until Task 4.2, which is why 4.2 is last).

## 9. Decisions — RESOLVED by Emilio, 2026-08-05

| # | Decision | Ruling | Follow-through in this plan |
|---|---|---|---|
| D1 | Hide `automation` kind on Board by default too? | **Census first, then decide** | **CLOSED 2026-08-05 22:10 (EV-1 census):** 2/651 non-review sdk-py, both the plugin's own follow-ups — no material automation volume; review-only hiding stands and the follow-up prompt joins the producer registry. |
| D2 | Reviewer spend | **Trim Stop-hook reviews** (keep commit/push reviews) | **Switch found (EV-1):** `ENABLE_STOP_REVIEW=0`, supported and documented for multi-lane setups. Yield baseline recorded: 2/1,352 retained reviews with findings. Application is operator-gated (classifier blocks agent edits to shell init); Step 3 re-ledger after one working day. |
| D3 | Shared `SECURITY_WARNINGS_STATE_DIR` across worktrees? | **No change** | **CLOSED (EV-1):** duplicate-SHA across linked worktrees = 0 by construction (shared common-git-dir ledger); ruling validated, no experiment needed. |
| D4 | Upstream parent-lineage request | **File the issue** | Task 4.5: issue text from §1 evidence; fold in the D2 Stop-toggle ask if Task 4.4 finds no supported switch. |
| D5 | `totals.byKind` fleet telemetry? | **Client-computed only** | No server totals field; `published-fields-can-vary` untouched. Stands as planned. |
| D6 | Codex/Cursor launch-evidence markers | **Spawn the BE lane now** | Task 1.2b added: catalogue markers from real `codex exec` / Cursor composer transcripts and wire them in the same pass as Claude's. |
| D7 | Toggle persistence scope | **Server setting** | Task 0.3 (localStorage) is superseded — struck below. Task 1.5 adds `HubSettings.showReviewWorkers` with GET/POST plumbing; every browser shares the default. Until Phase 1 lands, the toggle is session-scoped. |

---

**Execution options** (per superpowers): **(1) Subagent-driven** — dispatch a fresh subagent per task with review between tasks (recommended; tasks are sized for it), or **(2) Inline** — `superpowers:executing-plans` batch execution with checkpoints. Phase 0 can start immediately; Phase 1 needs a server restart window.
