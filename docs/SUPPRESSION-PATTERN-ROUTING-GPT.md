# Routing note: the suppression pattern, and what is still unexamined

---

## The pattern, in one paragraph

**The rule:** an aggregate over several sources is nulled entirely when any one source is
unmeasured, instead of reporting the measured subtotal alongside a count of what is missing.
**Where it lives:** `src/server/burnbar.ts`, in cost, as a three-level cascade — `:556` computes
a model's cost only when `costMissing === 0`; `:588` nulls a whole provider with
`costUsd: unknown ? null : sum` where `unknown = group.some(row => row.costUsd == null)`; and
`:600` nulls the fleet total with `anyCostMissing = byProvider.some(row => row.costUsd == null)`.
So one unpriced model nulls its provider, and one null provider nulls everything — which is how
45 unpriced Cursor invocations out of 2,980 suppress **$11,939.94** of measured spend.
**The evidence that it is a pattern and not just a bug:** the *same function* handles tokens
correctly at all three of those levels — `SUM(totalTokens)` skips NULLs with the comment *"the
sum of what was actually measured; tokensMissing carries the rest"*, providers sum unconditionally,
and `tokensKnown` is emitted as a **qualifier beside the value** rather than a gate on it. Cost and
tokens sit in the same query, ten lines apart, doing opposite things with the same problem.
**What I have evidence for versus what I am inferring:** I read all six of those lines and
measured the live consequence, so the cost cascade and the tokens contrast are **evidence**; that
the shape *recurs on other surfaces* is what I would have inferred, and when I went looking I
found the opposite — `app.ts:775` emits `complete` as a qualifier beside `staleSources` and
`controlErrors` without suppressing anything, and `burnbar.ts:962` emits
`spikeCoverage: { complete, skipped }`, carrying both flag and count exactly as `tokensMissing`
does, with a comment at `:295` reasoning explicitly that *"a single `available` cannot describe
both"*. **So: one confirmed instance with a three-level cascade, and the two nearest candidates
do it right.** The generalisable rule worth enforcing is therefore narrow and cheap —
*completeness flags qualify values, they never replace them* — and the grep that finds violations
is any aggregate whose value expression is gated on a `some(... == null)` or `=== 0` completeness
test rather than carrying that test as a sibling field.

---

## What remains genuinely unexamined

Surfaces are now covered: summary band, rows, rollups, program headers, tabs, drawer (twice),
Usage, health, the attention layer, and the quiet board at n=0/1/3. I am not going to manufacture
a surface that is left.

But there is one whole **dimension** I have never touched, and it is large enough that I should
name it plainly rather than call the audit complete:

**Every audit I have run was read-only. I have audited what the cockpit *says*, never what it
*does*.**

Untouched: Focus, Send, Interrupt, Archive, Acknowledge, Dismiss, Snooze, the rename flow, the
triage queue, and the action log. Not one control has been exercised. That matters because the
north star gives every pixel three permitted jobs — say something is wrong, say what is
happening, or **let the operator act** — and I have only ever audited the first two. A control
that renders correctly, is enabled correctly, and then fails, no-ops, or acts on the wrong agent
would have passed every audit I have written.

Three specific unknowns inside that dimension:

1. **Does the action reach the agent it names?** Identity resolution is the most defect-dense
   area of this codebase — quarantine, cwd mismatch, surface collisions — and the drawer's own
   controls route through it. An instruction delivered to the wrong pane is the worst possible
   failure here and nothing has tested it.
2. **What does the board do when an action fails?** The dock renders control feedback, and I have
   read that code but never seen it fire.
3. **Does the board's state survive an action?** Every measurement was a static read. Optimistic
   updates, stale-after-write, and the SSE reconciliation path are unexamined.

Smaller and honestly lower value: layout and CSS at n=1/n=3 (my renderers were called in
isolation, not painted), viewports other than 1440 for anything except the drawer, and the full
accessibility surface beyond the ARIA staleness already reported.

**My recommendation, which is yours to accept or not:** the write path is the next audit, and it
needs a scratch agent or a disposable session rather than the live swarm — exercising Interrupt
or Archive against a real lane mid-work is not something I should do to another agent's session.
That is a genuine blocker on method, not on willingness, and it is why I have not simply started.
