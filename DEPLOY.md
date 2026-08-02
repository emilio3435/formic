# The Ant Hill — deploy & ports rulebook

The safety net that keeps a hand-fumbled deploy from taking down the live dashboard.
When in doubt, use the scripts — they encode every rule below.

## Ports (reserved)

| Port | What | Owner |
|------|------|-------|
| **4701** | **PRODUCTION** dashboard | launchd `ai.imaginethat.anthill`, serves branch `main` from worktree `the-mountain-main` |
| 4700 | The Mountain (separate app) | — |
| **4710–4719** | **Previews** (throwaway) | `scripts/anthill-preview.sh`, auto-assigned |

Rule: **never** launch anything on 4701 by hand. Previews always go through
`anthill-preview.sh`, which picks a free 471x port and refuses 4701.

## Deploy = land into `main`, then run the deploy script

`:4701` serves the **local files** of the `the-mountain-main` worktree.
A fix is live only when it is committed there and the service is restarted.

The launchd job pins `WorkingDirectory` to that worktree, so **:4701 serves
whichever branch the worktree is currently on** — not `main` by definition. On a
shared checkout that is often some lane's branch. `anthill-deploy.sh` refuses to
run unless the worktree is on `main`, which is the guard, but nothing stops the
branch moving afterwards. Confirm before trusting what :4701 is showing:

```bash
git -C ~/Developer/the-mountain-main branch --show-current
```

```bash
# 1. Land your change onto main (cherry-pick from a lane, or merge). Example:
git -C ~/Developer/the-mountain-main cherry-pick <sha>...

# 2. Verify + go live (blocks on red tsc/tests, restarts, health-checks):
bash ~/Developer/the-mountain-main/scripts/anthill-deploy.sh
```

Rules the deploy script enforces so you don't have to remember them:
- Deploy worktree must be on `main`.
- **Red `tsc` or `bun test` aborts the deploy** — broken code never reaches :4701.
- Restart via `launchctl kickstart -k gui/$UID/ai.imaginethat.anthill`, then health-check.
- On an unhealthy restart it prints the exact rollback command.

## Do NOT deploy a lane over `main`

`main` is the integration target; other agents land multiple lanes into it. The
canonical FE lane (`ant-hill/luna-ops-canvas-reconciled-20260722`) and BE lane
(`feat/vitals-collectors-be`) are *sources*, not deploy targets — pointing :4701
at a lane can regress work that was landed into `main` from elsewhere. Always
land INTO `main`.

## Preview a change safely (no risk to :4701)

```bash
bash ~/Developer/the-mountain-main/scripts/anthill-preview.sh   # prints a 471x URL
```
Foreground, self-cleaning (Ctrl-C kills it — no orphans). To see what's running:
```bash
bash ~/Developer/the-mountain-main/scripts/anthill-ps.sh
```

## Every npm script, and which ones bind a port

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

Two will surprise you. **`start:external` does not bind externally** — it means
"run in this shell instead of a cmux workspace", and the server is hardcoded to
`127.0.0.1` with no override, so nothing here can serve the network. And
`dev` / `start:server` take 4701 without checking, so with the service up they
exit immediately with `EADDRINUSE` rather than fighting it. That is the safe
outcome; for an instance you can run alongside production use
`anthill-preview.sh` or `MOUNTAIN_PORT=4710 bun run dev`.

## The other two scripts

```bash
bash ~/Developer/the-mountain-main/scripts/anthill-start.sh   # what `bun start` runs
bash ~/Developer/the-mountain-main/scripts/anthill-hygiene.sh # repairs the service
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

## Shared-checkout hazard

These worktrees get concurrent commits from other agents mid-session. Before any
fast-forward / cherry-pick, re-check `git status` and the branch tip; prefer
cherry-pick (which rides a moving tip) over fast-forward (which fails when the
target advanced).
