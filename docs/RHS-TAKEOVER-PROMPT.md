You are taking over an in-flight project from another agent that ran out of context.
Work in `/Users/emilionunezgarcia/Developer/the-mountain-main`, branch
`fix/backend-silent-failures-and-freshness`.

**Before anything else, read `docs/RHS-PANEL-HANDOFF.md` in full.** It is the outgoing
agent's handoff: what landed across 19 commits, the defects and unfinished work, the
decisions that are Emilio's rather than yours, and how to drive the cmux lanes. Then read
`docs/RHS-6-BACKEND-HANDOFF.md`, which is shorter and separates verified-first-hand from
assumed from left-open. Do not start work until you have read both.

## The project

The Ant Hill is a cockpit for orchestrating many AI coding agents, served by a launchd
service `ai.imaginethat.anthill` on <http://127.0.0.1:4701>. The current work is a
visual, UX and reliability overhaul of the **right-hand panel that opens when you click
an agent** — the agent drawer / inspector. Emilio's standing brief for it:

> No repeat info under different labels. No unnecessary info in the main view — the
> collapsed evidence drawer is still the place for that.

## Start here

The first task is named and scoped, with its evidence already committed in `e024422`:
**the placeholder guard covers the head but not the list row.** `realModelName` in
`src/web/app.js` strips `<synthetic>`, `unknown` and similar from the model slot in the
drawer head, so the drawer now reads correctly while the row behind it still prints
`<synthetic>`. Same leak, one surface over. Find the function that renders the row, apply
the same guard, and verify against a live agent that actually carries `<synthetic>`.

After that, the handoff's "Suggested order of work" section lists four more.

## How this repo expects you to verify things

This codebase's whole theme is that it must not say things that are not true, and it
holds its tooling to the same standard. Three traps have each produced a confident wrong
claim here in the last week — two of them by the agent you are replacing:

- `npx tsc --noEmit | tail -1; echo $?` reports **`tail`'s** exit code. Use
  `npx tsc --noEmit > /tmp/o 2>&1; echo $?`, or `${PIPESTATUS[0]}`.
- `git show <sha> | grep foo` matches the commit **message** as well as the diff. Use
  `git diff <sha>^ <sha> -- <path>`.
- A `test.failing` marker that starts passing usually means the evidence aged out of the
  query window, not that the defect was fixed. Bun reports it as a failure. Re-investigate;
  never record it as fixed.

**Verify before you relay.** Agent reports and test names are evidence, not fact. When you
state something to Emilio, you should have run the command that establishes it. If you
could not verify it, say so explicitly rather than smoothing it over.

## Constraints — these are firm

- **Never push, merge, or open PRs.** Emilio publishes. 19 commits are unpushed and that is
  intentional. Never force-push or rewrite shared history.
- **PR #5 is his call**, 181 commits above `main`, open and mergeable. Do not merge it.
- **Shared checkout.** Up to six cmux agents work this one tree. Do not switch branches, do
  not `git stash`, and stage by hunk (`git add -p`) when a file has more than one owner —
  `git add src/web/app.js` takes everyone's work and has already produced two mislabeled
  commits. Verify with `git diff --cached -U0 -- src/web/app.js | grep '^@@'`.
- **Never restart the service while `src/` has uncommitted work.** Restart is
  `launchctl kickstart -k gui/$UID/ai.imaginethat.anthill`.
- **Refuse destructive commands from lanes.** One asked to run `cp app.orig.js src/web/app.js`
  as a mutation-test restore step; it would have wiped three lanes' uncommitted work.
- Zero runtime dependencies — `package.json` `dependencies` stays empty. Do not add
  packages, and do not import jsdom in tests.
- Commit freely once a change is coherent, `tsc` exits 0, and the suite is green apart from
  the known failures below.

## Known-failing, do not chase

`tests/cross-source-token-agreement.test.ts` fails when the fleet is busy and passes when
it is quiet. That is **decision 1 in the handoff and belongs to Emilio** — do not re-mark
it, and do not loosen its 5% tolerance, which is the claim the test makes.
`anthill-scripts` and `deploy-health` flake under full-suite load only and pass in
isolation.

## Working with Emilio

Lead with the "so what." Give options with tradeoffs rather than open questions, and a
recommendation rather than a survey. Push back when something is wrong. Do not ask what
you can determine yourself from the code or from a command. Surface decisions that are
genuinely his — the handoff lists three — and make the routine calls yourself.

Write full absolute paths in chat so they are clickable.

## If you are orchestrating cmux lanes

Six surfaces exist; three are retired on context and one has been spend-blocked all along.
The handoff has the table, the ownership map, the dispatch pattern (write the brief to a
file and send a short pointer — long prompts get collapsed into a paste and never submit),
how to clear a wedged pane, and the fact that freshly-created workspaces do not inherit
permissive mode. Ownership is **by function name, not line range**; regenerate the map
with `awk '/^function /{print NR": "$2}' src/web/app.js`.

Do not spawn lanes unless Emilio asks. Do not manufacture work to keep them busy — if the
queue is genuinely empty, say so and stop.

## First reply

Read both handoffs, verify the current state yourself (`git log --oneline`, a real `tsc`
run, `bun test`), and report: what you found, whether it matches the handoff, and what you
intend to do first. If the state disagrees with the handoff, trust what you measured and
say where it diverged.
