# Formic project instructions

Goal: Keep development work isolated while production on port 4701 always serves a verified, clean `main` checkout.

Success means:
- GitHub changes land through a pull request with green CI.
- Production deploys run only from `~/Developer/formic` on `main`.
- The deployed commit exactly matches `origin/main`.
- Launchd points its working directory and server entry at the production worktree.
- UI releases are verified in a browser at `http://127.0.0.1:4701` with screenshot evidence.

**CI green is not a deploy.** Merging a PR updates GitHub `main` only. `:4701` keeps serving whatever bun process is already running in `~/Developer/formic` until `cd ~/Developer/formic && bash scripts/anthill-deploy.sh` fast-forwards that worktree and restarts launchd. Proof the live board moved: `curl -sS http://127.0.0.1:4701/` shows the new `?v=ah-tXX`, and `git -C ~/Developer/formic log -1 --oneline` matches `origin/main`.

Stop when: The requested change is merged, the separately authorized deploy is healthy on port 4701, and the live UI has been verified; otherwise report the exact remaining gate.

## Deploy configuration

- Platform: local macOS launchd
- Production URL: http://127.0.0.1:4701
- Service label: `ai.imaginethat.anthill`
- Base branch: `main`
- Production worktree: `~/Developer/formic`
- Origin: public `emilio3435/formic` (https or ssh). `the-ant-hill` is refused.
- Deploy command (run from that worktree): `cd ~/Developer/formic && bash scripts/anthill-deploy.sh`
- Quiet-fleet override (OpenBurnBar canary only): `ANTHILL_DEPLOY_QUIET_FLEET=1 bash scripts/anthill-deploy.sh`
- Canonical runbook: [`DEPLOY.md`](./DEPLOY.md)

## Production flow

1. Land the approved pull request on GitHub and wait for required checks to finish.
2. Ask before deploying. Then, from the production worktree only:
   `cd ~/Developer/formic && bash scripts/anthill-deploy.sh`
   The script fetches, fast-forwards when behind and clean, installs the lockfile, runs gates, restarts launchd, and waits ~45s for `/api/health`.
3. Hard-refresh http://127.0.0.1:4701, verify the intended live behavior (cache-bust token + the actual UI), and capture screenshots for UI changes.

Do not edit `~/Developer/formic` as a feature worktree. Do not treat a green GitHub check as evidence that 4701 restarted.

## Safety boundaries

- Treat merge and deploy as separate outward-facing actions with separate authorization. Running `anthill-deploy.sh` is the deploy authorization; it will take current `origin/main` live.
- Keep `~/Developer/the-mountain-main` and lane worktrees for development; never deploy production from them.
- Preserve unrelated dirty changes and do not repoint launchd to a development checkout. The script refuses a dirty or diverged production tree.
- When the target guard reports drift, repair the service with the exact `ANTHILL_REPO=... scripts/anthill-hygiene.sh` command it prints, then rerun the deploy.
- Keep versioned release directories plus a `current` symlink as a future zero-drift option; the current canonical flow is the dedicated production worktree.
