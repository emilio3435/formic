# Formic project instructions

Goal: Keep development work isolated while production on port 4701 always serves a verified, clean `main` checkout.

Success means:
- GitHub changes land through a pull request with green CI.
- Production deploys run only from `~/Developer/the-mountain-production` on `main`.
- The deployed commit exactly matches `origin/main`.
- Launchd points its working directory and server entry at the production worktree.
- UI releases are verified in a browser at `http://127.0.0.1:4701` with screenshot evidence.

Stop when: The requested change is merged, the separately authorized deploy is healthy on port 4701, and the live UI has been verified; otherwise report the exact remaining gate.

## Deploy configuration

- Platform: local macOS launchd
- Production URL: http://127.0.0.1:4701
- Service label: `ai.imaginethat.anthill`
- Base branch: `main`
- Production worktree: `~/Developer/the-mountain-production`
- Deploy command: `bash scripts/anthill-deploy.sh`
- Canonical runbook: [`DEPLOY.md`](./DEPLOY.md)

## Production flow

1. Land the approved pull request on GitHub and wait for required checks to finish.
2. Confirm the production worktree is clean and on `main`.
3. Fetch `origin/main` and fast-forward the production worktree with `git merge --ff-only origin/main`.
4. Confirm local `HEAD` equals `origin/main`, then install the locked dependencies.
5. Run `bash scripts/anthill-deploy.sh`; its target guard must pass before tests or restart.
6. Open port 4701, verify the intended live behavior, and capture screenshots for UI changes.

## Safety boundaries

- Treat merge and deploy as separate outward-facing actions with separate authorization.
- Keep `~/Developer/the-mountain-main` and lane worktrees for development; never deploy production from them.
- Preserve unrelated dirty changes and do not repoint launchd to a development checkout.
- When the target guard reports drift, repair the service with the exact `ANTHILL_REPO=... scripts/anthill-hygiene.sh` command it prints, then rerun the deploy.
- Keep versioned release directories plus a `current` symlink as a future zero-drift option; the current canonical flow is the dedicated production worktree.
