# VERIFY — TINT-F (adversarial, read-only)

Scope: `git diff 06d385c..HEAD` (4 commits, HEAD `6d18675`). Original tree not mutated. Throwaway copy used only to poke tests. `bunx tsc --noEmit` → 0. `bun test tests/repo-color.test.ts tests/repo-tint-render.test.ts` → 64 pass / 0 fail (206 expects). Known `tests/cross-source-token-agreement.test.ts` red not reported.

## BLOCK

### 1. The board never receives a hex — `repoNames` is a key table, the client treats it as colors

`GET /api/repo-colors` builds `repoNames` as **lowercased printed name → canonical repoKey**:

```584:585:src/server/settings.ts
    const name = subject.repoName?.trim().toLowerCase();
    if (name) names[name] = key;
```

```624:628:src/server/settings.ts
    /* Additive to the contract's `{ settings, workspaces }`: the BOARD joins on
       the repository name it already prints, because a browser cannot run
       `git rev-parse` to derive the canonical key for itself. Flagged to the
       master in LANE-REPORT-tint-f §5. */
    repoNames: discovery.names,
```

The client then feeds that object to a function whose values must be `#rrggbb`:

```7085:7090:src/web/app.js
function setRepoColors(entries) {
  repoColors.clear();
  for (const [name, hex] of Object.entries(entries || {})) {
    const normalized = normalizeRepoHex(hex);
    if (normalized) repoColors.set(String(name).toLowerCase(), normalized);
```

```12342:12343:src/web/app.js
    setRepoColors(body.repoNames);
    state.repoColorSettings = body.settings;
```

Same write after PUT/DELETE at `src/web/app.js:3952`.

`normalizeRepoHex("the-mountain")` is `null`. The live payload shape for this worktree is even worse than name===key: origin is `https://github.com/emilio3435/the-ant-hill.git`, so `RepoIdentity.repoName` is `the-ant-hill` (`src/server/repo-identity.ts:118`) while TINT-F's `repoKeyForCwd` is `the-mountain` (`src/shared/repo-color.ts:78-80`; live `git rev-parse --git-common-dir` → `/Users/…/the-mountain/.git`). The join table exists exactly for that split, then is discarded as a non-hex.

Probe (this checkout): `setRepoColors({ "the-ant-hill": "the-mountain" })` stores **zero** entries. Whisper, Signal ticks, and strip pills all read `repoTintFor` → empty. Settings still looks correct because `renderRepoColorSettings` reads `body.settings.assignments` (`src/web/app.js:3888-3900`), not the broken map.

The 64 tests do not catch this. Server tests pin `repoNames` as name→key (`tests/repo-color.test.ts:457`, `:567`). Client tests call `setRepoColors({ "the-mountain": "#2E66A8" })` (`tests/repo-tint-render.test.ts:188`). Nothing loads `fetchRepoColors`. In a throwaway copy, rewriting `fetchRepoColors` to actually join `name → assignments[key].hex` left **64/64 green**.

## High

### 2. Shared printed basename: last writer wins, order-dependent

Even after a correct hex join, `names[name] = key` overwrites (`src/server/settings.ts:585`). Two folders of repos whose origin basename is the same word (`the-ant-hill`, `the-mountain`, …) share one printed name and different TINT keys. Probe:

- forward: `{ "the-ant-hill": "the-mountain-fork" }`
- reversed: `{ "the-ant-hill": "the-mountain" }`

The client joins on the name the band/row already prints (`src/web/app.js:7383`, `7130`, `7992`). One of the two repos gets the other's colour, and which one depends on collector order. No test.

### 3. Signal ticks are applied only on the Needs-you strip, then CSS evicts them; interleaved ALL view never gets them

Goal-F / master plan: Whisper when grouped by repo; Signal under interleaving sorts; attention replaces the tick.

What shipped: `stripRowOpts` is the **only** caller that sets `repoTint` (`src/web/app.js:8034-8038`). `agentRowPlan` for flat/interleaved programs does not (`src/web/app.js:8578-8593`). Then every Signal row rule excludes attention:

```5733:5735:src/web/styles.css
.agent-row.has-repo-tick:not(.is-needs-you):not(.is-blocked):not(.is-failed):not(.is-alerting):not(.is-selected) {
  background: color-mix(in srgb, var(--repo-tint) 4%, var(--surface));
  box-shadow: inset 3px 0 color-mix(in srgb, var(--repo-tint) 55%, transparent);
```

`needsYouStrip` only admits `alerting()` agents (`src/web/app.js:7541-7542`). Typical strip rows carry `is-needs-you` / `is-blocked` / `is-failed` from outcome (`src/web/app.js:9401`), so the 3px tick never paints. The heading pill remains.

The render test that claims “a strip row carries the tick” uses `status: "running"` (`tests/repo-tint-render.test.ts:123-147`) — `deriveOutcome` → `healthy`, so **not a strip member**. Hollow.

Worse for authority rule 5: a hook-`needsInput` agent is `alerting()` with a healthy outcome (`src/web/agent-model.js:371-372`). `stripRowOpts` does not set `opts.alerting`, so the row gets **no** ember class and **does** match the tick selector — identity wash on an attention row.

## Medium (tests, not the production funnel)

### 4. Four of five `repoKeyForCwd` tests are hollow against the worktree trap

Implementation is correct on this worktree: live `--git-common-dir` is `/Users/…/the-mountain/.git`; `repoKeyForCwd(import.meta.dir) === "the-mountain"`. `fakeGit` never inspects argv past `command[2]` (`tests/repo-color.test.ts:39-46`). In a throwaway copy, switching the body to `--show-toplevel` left the four fake tests green; only the live call failed (received `tmp` / would be `the-mountain.worktrees` in this worktree). The live test is the real pin; the fakes do not prove common-dir vs toplevel.

### 5. DELETE does not fan out the restored palette hex

PUT fans out (`src/server/settings.ts:687-691`). DELETE returns the reassigned settings and stops (`src/server/settings.ts:667-670`). The client does not GET afterwards (`src/web/app.js:3941-3955`). cmux keeps the operator colour until some later GET. TINT-S may paper over this at integration; F does not.

## Claims that survived refutation

| Claim | Verdict |
|---|---|
| `setWorkspaceColor` shells `workspace-action set-color` | Holds. `src/server/cmux-color.ts:112-114`. Only call site in this lane: `src/server/app.ts:452`. No other `set-color` / `workspace.group.set_color` in `src/`. |
| `setGroupColor` params pinned to `{group_id, hex}` via issued argv + `Object.keys()` | Holds and is **not** hollow. Copy: rename `hex`→`color` → test at `tests/repo-color.test.ts:293-307` failed. |
| Strict group read-back: null / no stdout / wrong colour = failure | Holds. `src/server/cmux-color.ts:155-164`; tests `313-324`. Loud false-negative by design, as the lane report says. |
| `lastWrittenHex` only on verified-clean **workspace** writes | Holds. Copy: record-before-ok → `tests/repo-color.test.ts:258` received `#2e66a8`. Groups never record (`:310`). Residual: workspace path does not echo-check `custom_color` (unlike groups); not a proven silent no-op. |
| Fan-out enumerates only `agent.target.workspaceId` | Holds. `src/server/app.ts:418-436`. Group anchors are excluded by construction, not by an anchor filter. |
| Additive `repoNames` key | Holds as a key table. The *consumption* of it is finding 1. |
| `repoKeyForCwd` uses git common dir | Holds in production (live git + live test). See finding 4 for the fakes. |
| Assignment order-independence; 7th → clay `#64707C` | Holds. Fresh keys sorted (`src/shared/repo-color.ts:154`). Seven-key batch overflows `the-mountain` (lex last), same both directions (`tests/repo-color.test.ts:145-161`). Stored lowercase `#64707c`. |
| Whisper attention replace via `:not()`, not blend | Holds for grouped band rows (`src/web/styles.css:5723-5727`). Selector extraction test is real. Strip/Signal is finding 3. |
| Text never wears `--repo-tint` | Holds. `color: var(--muted)` on the pill (`src/web/styles.css:5750`); rule-6 walk in tests. |
| Tint via `style.setProperty`, not `el({style:…})` | Holds, same CSSOM path as `--inspector-visible-top`. CSP is `style-src 'self'` (`src/server/app.ts:64`). Fake-DOM `attributes.style` check is weak; source regex against `style:` props is the real guard (`tests/repo-tint-render.test.ts:229`). |
| `PUT /api/repo-colors/:repoKey` same-origin/local gate | Holds. Loopback on every method (`src/server/settings.ts:640-642`), Origin must equal `url.origin` on PUT/DELETE (`:658-661`). Same shape as `handleSettingsRequest` (`:306-323`). Test refuses `http://evil.example` (`tests/repo-color.test.ts:485-492`). Dispatcher does not double-check (unlike `/api/attention`); the handler does. **Not missing.** |

## Hollow-test spot-check (throwaway copy only)

1. **Wiring of `fetchRepoColors`** — fixing the name→key→hex join: 64 still pass. Hollow.
2. **`fakeGit` worktree collapse** — `--show-toplevel` in the body: 4/5 `repoKeyForCwd` tests still pass. Hollow. Live test is not.
3. Contrast (solid): group `Object.keys` pin, and `lastWrittenHex` on failure, both went red when the production claim was inverted.

## Not a merge blocker on their own

- `ARCHITECTURE.md` edited outside the fence (lane report §5.2); forced by `tests/reference-docs.test.ts`.
- Fan-out cadence is GET-driven; client fetches once at boot (`src/web/app.js:12330-12340`, `:13240`). New workspaces after boot wait for a later GET or TINT-S.
- `setGroupColor` success path never live-written (lane report §5.3). Failure path live-probed. Strict read-back is the right bias.

VERDICT: BLOCK The board never tints: `setRepoColors(body.repoNames)` treats canonical repo keys as hexes, so Whisper/Signal stay colourless while 64 tests stay green.
