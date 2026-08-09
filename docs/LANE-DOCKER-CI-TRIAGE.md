# Lane kickoff — docker-ci-triage (Grok 4.5 High Fast)

**Mission.** Twelve test suites fail when the repo's hermetic tier runs on Linux in Docker, and nobody has decided *why*. Classify every one of them into exactly one of three buckets — macOS-only, portability bug, or genuine defect — and act on the classification.

**Repo:** `/Users/emilionunezgarcia/Developer/the-mountain-main` · **Branch:** `chore/docker-local-ci` (already pushed, PR #23 open) · **Shared worktree — other agents are writing to it.**

---

## Write your report FIRST

Before you touch anything, create `LANE-REPORT-docker-ci-triage.md` with these five headings, each marked `PENDING`, and fill them in as you go:

1. what the lane was
2. which claims went red first, named
3. what shipped, file and fence
4. **the floor results, pasted not paraphrased**
5. anything unverified, including what the sandbox refused

This is load-bearing, not tidiness. Lanes die mid-flight to quota limits, and "report at the end" produces nothing when they do. A lane is not done until section 4 holds real output.

---

## The gate you are triaging

```bash
docker build -f Dockerfile.ci -t anthill-ci .
docker run --rm anthill-ci
```

**2,571 pass · 71 skip · 53 fail · 4.6 seconds.** Read `Dockerfile.ci` and `scripts/docker-ci.sh` first — both explain themselves, and the second prints the work you are doing.

**This is NOT a replacement for CI.** `.github/workflows/check.yml` runs on `macos-latest` on purpose: the server shells out to `/usr/sbin/lsof`, reads stores under `~/Library/Application Support`, and deploys under launchd. Linux cannot speak for any of that. Your job is to make the Linux gate's coverage claim *honest*, not to make it total.

---

## The twelve suites, measured 2026-08-06

Run individually inside the container. Counts are failing tests, not files.

| Fails | Suite | My guess — **verify, do not inherit** |
|---:|---|---|
| 18 | `tests/cursor.test.ts` | `~/Library/Application Support/Cursor` paths |
| 7 | `tests/anthill-manifest-register.test.ts` | bash shim, spawns real processes |
| 5 | `tests/hook-store-shims.test.ts` | tty / job control (`[[ -t 0 ]]`, `fg %1`) |
| 4 | `tests/anthill-scripts.test.ts` | shell scripts, macOS assumptions |
| 3 | `tests/run-manifests.test.ts` | manifest writer, shim-adjacent |
| 3 | `tests/known-defects.test.ts` | **unknown — look here first, see below** |
| 3 | `tests/cmux-hook-store-compact.test.ts` | cmux store layout |
| 3 | `tests/check-nul-files.test.ts` | spawns `scripts/check-nul-files.ts` |
| 3 | `tests/atlas-hardening-sweep.test.ts` | unknown |
| 2 | `tests/snapshot-programs.test.ts` | git worktree layout of *this* machine |
| 1 | `tests/cursor-gui-admission.test.ts` | Cursor paths |
| 1 | `tests/anthill-deploy.test.ts` | asserts against a launchd deployment |

Four more fail in that container but are **already excluded** from both gates — `cross-source-token-agreement`, `physical-bounds`, `published-identities`, `reference-docs`. Not yours.

**Start with `known-defects.test.ts`.** A suite named for defects the repo already knows about, failing for a reason nobody has looked at, is the most likely place a *real* bug is hiding. The three biggest suites are probably boring path problems; this one is not obviously anything.

---

## The three buckets, and the rule for each

**1 · macOS-only.** Linux genuinely cannot judge it — it asserts on `lsof` output shape, `~/Library` paths, launchd, or tty/job-control behaviour. Add to `PLATFORM_ONLY` in `scripts/docker-ci.sh` **with a one-line reason naming what specifically Linux cannot see.**

**2 · Portability bug in the test.** The thing under test is platform-neutral; the *test* hard-codes something. Fix the test. These are the valuable ones — each is a suite that will keep working when this product ships to someone else's machine, which is the stated direction (cmux companion).

**3 · A genuine defect the container caught.** Best possible outcome. Fix the code, and say so loudly in your report.

### The rule that matters most

**Do NOT bulk-add suites to `PLATFORM_ONLY` to get the run green.** An exclusion nobody can justify line by line is how a gate stops meaning anything. This repo has already been bitten by exactly that shape twice, and both are worth knowing before you start:

- A regression guard for a shipped visual defect asserted that a CSS **string** existed. A mutation audit proved it fired on a harmless change and was blind to the real defect arriving by another route. `docs/a11y-geometry-gate/README.md` has the measurements.
- The first version of `scripts/docker-ci.sh` used `bun test <dir> --ignore <path>`, which **does not exclude the file** — it runs anyway. The report said suites were being skipped while they ran. That is worse than no exclusion, because the report claimed it worked.

A green run you cannot defend is worth less than a red run you understand.

---

## Non-negotiables

- **`bun test <dir> --ignore <path>` does not work.** The script builds an explicit file list. Do not reintroduce `--ignore`.
- **The container runs as non-root on purpose.** Several suites assert an unreadable directory is reported as a collection error, and root can read anything, so as root they pass for the wrong reason. Do not add `USER root` to make something pass.
- **Absence must not read as zero.** This codebase's whole discipline is that an unreadable source is *unknown*, never *empty*. If a test fails because a store is missing on Linux, the right question is whether the code reports it as unknown — not how to make the file exist.
- **Shared worktree.** Commit with `git commit -F - -- <paths>` and check `git diff --cached --stat` first. Plain `git commit` takes the **whole index**, including hunks another lane staged. That has already buried 835 insertions under someone else's commit message once tonight. **Never amend or rebase** — a co-tenant can land on your tip within seconds.
- **Your fences:** `scripts/docker-ci.sh`, `Dockerfile.ci`, `.dockerignore`, and any test file you are fixing. **Not** `src/web/**` (another program is live there). If a fix belongs in `src/server/**`, say so and stop — that is another lane's territory.

---

## Definition of done

- Every one of the twelve suites is in exactly one bucket, with a reason a reviewer can check.
- `scripts/docker-ci.sh` runs green, or its remaining failures are named with why they are not yet classified.
- `docs/DOCKER-CI-TRIAGE.md` records the classification table: suite, bucket, the evidence, and what you changed.
- **Both floors, pasted into your report:**
  ```
  bunx tsc --noEmit          # exit 0
  bun run test:ci            # 0 fail — the macOS floor must not regress
  docker run --rm anthill-ci # your gate
  ```
  A fix that greens Docker and reddens macOS is not a fix.
- If any suite defeats you, mark it `[incomplete]` with: reason · proof · what you attempted · impact · the next decision needed. That is a legitimate outcome. Silence is not.
