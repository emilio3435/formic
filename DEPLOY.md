# Formic — deploy & ports rulebook

The public product name is Formic. LaunchAgent labels, script names, and log paths
below still use `anthill` / Ant Hill as ops compatibility identifiers.

The safety net that keeps a hand-fumbled deploy from taking down the live dashboard.
When in doubt, use the scripts — they encode every rule below.

## Ports (reserved)

| Port | What | Owner |
|------|------|-------|
| **4701** | **PRODUCTION** dashboard | launchd `ai.imaginethat.anthill`, serves clean `main` from `the-mountain-production` |
| 4700 | The Mountain (separate app) | — |
| **4710–4719** | **Previews** (throwaway) | `scripts/anthill-preview.sh`, auto-assigned |

Rule: **never** launch anything on 4701 by hand. Previews always go through
`anthill-preview.sh`, which picks a free 471x port and refuses 4701.

## Deploy = merge on GitHub, then fast-forward production

`:4701` serves the **local files** of the dedicated
`~/Developer/the-mountain-production` worktree. Merging a pull request changes
GitHub's `main`; it does not update that local worktree or restart launchd.

Keep the production worktree clean and permanently on `main`. Development stays
in `~/Developer/the-mountain-main` or a lane worktree. The safe release sequence
is:

```bash
# 1. Inspect before changing the production checkout.
git -C ~/Developer/the-mountain-production status --short --branch
git -C ~/Developer/the-mountain-production branch --show-current

# 2. Fetch and fast-forward to the exact GitHub main commit.
git -C ~/Developer/the-mountain-production \
  fetch origin main:refs/remotes/origin/main
git -C ~/Developer/the-mountain-production merge --ff-only origin/main
test "$(git -C ~/Developer/the-mountain-production rev-parse HEAD)" = \
  "$(git -C ~/Developer/the-mountain-production rev-parse origin/main)"

# 3. Install the lockfile state, verify, restart, and health-check.
cd ~/Developer/the-mountain-production
bun install --frozen-lockfile
bash scripts/anthill-deploy.sh
```

After a UI deploy, open <http://127.0.0.1:4701>, confirm the intended change is
visible, and capture screenshot evidence. A green health endpoint proves the
server answered; it does not prove the reskin or other visual change rendered.

Rules the deploy script enforces so you don't have to remember them:
- Deploys must run from `~/Developer/the-mountain-production`.
- Deploy worktree must be on `main`.
- The worktree must be clean and its `HEAD` must match a freshly fetched `origin/main`.
- The LaunchAgent `WorkingDirectory` and server entry must point back at that exact worktree.
- **Red `tsc` or `bun test` aborts the deploy** — broken code never reaches :4701.
- Restart via `launchctl kickstart -k gui/$UID/ai.imaginethat.anthill`, then health-check.
- On an unhealthy restart it fails loudly and points to revert-through-main recovery.

If the target guard finds a missing or stale LaunchAgent, it exits before tests
or restart and prints the exact repair command. For the canonical worktree that
command is:

```bash
ANTHILL_REPO="$HOME/Developer/the-mountain-production" \
  bash "$HOME/Developer/the-mountain-production/scripts/anthill-hygiene.sh"
```

`anthill-hygiene.sh` is disruptive: it rewrites the plist, restarts production,
and can kill the process holding 4701. Use it only to repair confirmed drift.
`scripts/anthill-deploy-target.sh` implements the read-only target check and is
called by the deploy script; operators normally do not run it directly.

If the health check fails after restart, inspect the service log and revert the
unhealthy change through a new GitHub `main` commit. Then fast-forward the
production worktree and deploy again. Do not move the production checkout behind
`origin/main` as an improvised rollback.

## Do NOT deploy a lane over `main`

`main` is the integration target; other agents land multiple lanes into it. The
canonical FE lane (`ant-hill/luna-ops-canvas-reconciled-20260722`) and BE lane
(`feat/vitals-collectors-be`) are *sources*, not deploy targets — pointing :4701
at a lane can regress work that was landed into `main` from elsewhere. Always
land INTO `main`.

## Preview a change safely (no risk to :4701)

```bash
bash scripts/anthill-preview.sh   # run from the lane; prints a 471x URL
```
Foreground, self-cleaning (Ctrl-C kills it — no orphans). To see what's running:
```bash
bash scripts/anthill-ps.sh
```

## Every npm script, and which ones bind a port

`scripts/anthill-self-register.sh` is not a deploy script: lanes source it at
boot to bind their own sessionId into the run manifest (`status: active`) and
mark `done` on clean exit. It never touches the server or its port.

`scripts/docker-ci.sh` builds and runs the Linux CI image. It does not bind a
host port or restart the production service.

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
| `bun run test:ci` | `scripts/ci-tests.sh` — everything except the four local-only files | — |

**`test:ci` is not the gate; `check` is.** It exists because four test files
assert against evidence that only exists on a working machine — the developer's
live session history, and the board answering on 4701 — and they are written to
fail rather than skip when that evidence is absent, which is correct locally and
impossible in CI. `scripts/ci-tests.sh` names those four with a reason each and
runs every other file, so a new test is covered without anyone remembering to
add it. Before deploying, run `bun run check`, which still runs all of them.

Two will surprise you. **`start:external` does not bind externally** — it means
"run in this shell instead of a cmux workspace", and the server is hardcoded to
`127.0.0.1` with no override, so nothing here can serve the network. And
`dev` / `start:server` take 4701 without checking, so with the service up they
exit immediately with `EADDRINUSE` rather than fighting it. That is the safe
outcome; for an instance you can run alongside production use
`anthill-preview.sh` or `MOUNTAIN_PORT=4710 bun run dev`.

## The other two scripts

```bash
bash scripts/anthill-start.sh   # what `bun start` runs
bash scripts/anthill-hygiene.sh # repairs the service; read the warning below
bash scripts/ci-tests.sh        # what CI runs; no ports, no service
```

`anthill-start.sh` binds **4701** — the production port — and reuses a running
instance rather than starting a second one. It is the ordinary onboarding
command, so the "never launch anything on 4701 by hand" rule is reachable
through it; that is deliberate, and reusing beats colliding.

`anthill-hygiene.sh` **restarts production and can kill processes.** It rewrites
the LaunchAgent plist if it points somewhere stale, then `launchctl bootout`s the
service, `kill -9`s whatever is still holding :4701, and bootstraps it back. The
kill is scoped to PIDs that `lsof` reports listening on that port — but anything
else holding 4701 dies too. It repairs the worktree the script itself lives in
(`ANTHILL_REPO` overrides), so run it from the worktree you mean to fix.

## The one script that touches no ports and no service

```bash
zsh scripts/constant-collapse.sh --plan   # say what it would do
zsh scripts/constant-collapse.sh --yes    # actually do it
```

**Note the `zsh`.** Every other script here runs under `bash`; this one uses zsh
parameter expansion and fails immediately under bash with `line 78: A: unbound
variable`. Not a broken script — the wrong interpreter.

**What it answers.** Ordinary mutation testing asks whether an assertion *can*
fail. This asks whether, given what the product now emits, it still *can* — the
two come apart when a fix collapses a field to a constant and every assertion
naming it quietly becomes unfalsifiable while the suite stays green. It
collapses each field in a spec and reports which collapses nothing notices.

**Reads:** `src/`, `tests/`, `config/`, `package.json`, `tsconfig.json` and
`bunfig.toml`, copied into a scratch directory; `node_modules`, symlinked; a
spec file if `--spec` is given, otherwise a built-in one. Some of the tests it
runs read the OpenBurnBar sqlite database — a read; `--no-live` skips them.

**Writes:** one `mktemp -d` directory, removed on exit. **Nothing in this
repository** — not `src/`, not `tests/`, not `data/`, not git state, not a
plist. Verified rather than taken on trust: `git status` is byte-identical
before and after a `--plan` run, and no lab directory is left behind.

**Safe against a live board — yes.** It runs `bun test` and nothing else. It
starts no server, contacts no server, binds no port, and touches neither :4701
nor launchd. The deploy and launchd test suites are excluded by default
precisely so a live machine does not have its LaunchAgent paths exercised
repeatedly; `--include-deploy` overrides that, and you should read those tests
before using it.

**Safe under the shared checkout — yes, deliberately.** It copies the tree
before mutating anything, so the five lanes may commit freely while it runs. An
earlier version mutated `src/` in place and reverted afterwards, which is unsafe
here: another lane running tests during that window sees a broken tree, and a
lane committing during it can commit the mutation.

**Guards, each one exercised rather than read:** it refuses to run without
`--yes` (exit 1); `--plan` prints the plan and stops; an unrecognised argument
is rejected. It also aborts if the baseline suite is not stable across two runs,
because a flaky suite makes every result meaningless. Expect roughly one full
test run per collapse.

**Reading the output:** `killed` is good — an assertion depends on that field.
`SURVIVED` means nothing in the suite can fail because of it. `NO-MATCH` means
the spec is stale, which is not a pass.

## Shared-checkout hazard

These worktrees get concurrent commits from other agents mid-session. Before any
fast-forward / cherry-pick, re-check `git status` and the branch tip; prefer
cherry-pick (which rides a moving tip) over fast-forward (which fails when the
target advanced).
