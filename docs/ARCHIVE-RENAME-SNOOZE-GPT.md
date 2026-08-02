# Archive, rename, snooze — the success paths

Closing the three I had only refused, not exercised. Probes only: a synthetic codex parent and a
deliberately **unnamed child** (`PROBE-RENAME`, `/tmp/ANTHILL-PROBE-rename-20260802`), created and
removed. No working lane touched.

**Result: all three are clean.** No fourth instance of the pattern. Two of them are genuinely
id-keyed — which is what I wrongly claimed about attention — and one is a store write that needs
no pane at all.

---

## 1. Rename — success path exercised, and it is genuinely id-keyed

The eligibility rule is `parentAgentId && !nickname` (`program-aliases.ts:152`), so I built a
probe child with a `thread_spawn.parent_thread_id` and no `agent_nickname`.

```
rename the eligible child   → ok:true, labels: {"agent:codex:…probechild001":"PROBE-RENAMED-OK"}
rename the parent           → 400 AGENT_NOT_ELIGIBLE  ("not an unnamed child")
reset with an empty label   → ok:true, reset:true, labels:{}
```

**The stored key is `agent:<agentId>`** — not a surface. Rename resolves nothing, routes nowhere,
and therefore has no misroute class. This is what "id-keyed" actually looks like, and it is the
contrast that shows why my attention claim was wrong: there I read the same word in the request
body and assumed the same thing about the storage key, which turned out to be `surfaceId`.

**One observation, not a defect.** The label does **not** appear on the agent in `/api/snapshot`
(`nickname` stays null); the client merges labels separately via `fetchLabels`. That is a
legitimate design, but it means the snapshot — and anything reading it, including the action log
and any second client — has no knowledge of operator renames. Worth knowing before someone
assumes the snapshot is the whole truth about an agent's name.

## 2. Archive — success, and a genuinely good refusal

```
archive          → ok:true
archive again    → 409 CONTROL_DISABLED  "Agent is already archived."
```

**Not silently idempotent, and not a crash.** It names the state rather than pretending the second
call did something. That is the behaviour I would want and it is worth recording as a positive,
because much of this week's findings have been about responses that claimed success they had not
earned.

Archive writes to the archive store keyed by `agent.id` and never reads `target.surfaceId`
(`control.ts:85-97`), which is why it is correctly exempt from the staleness gate and correctly
outside `mayTransmit`'s scope. **Confirmed against the source this time rather than inferred from
the request shape** — check 6.

**Small consistency note:** renaming an **archived** child still returns `ok:true`. Archive
disables every entry in `controls`, but rename is a different endpoint that never consults them.
Defensible — labelling history is a real use — but the two surfaces disagree about what "archived"
forecloses, and nobody has decided which is right.

## 3. Snooze — still not exercised, and I could not

Refusals proven earlier (`ATTENTION_NOT_FOUND`, `INVALID_SNOOZE_UNTIL`, `AGENT_NOT_FOUND`). The
**success** path requires a real unread cmux notification on a probe pane, and I have not found a
way to raise one — notifications originate from cmux observing an agent, not from anything I can
post.

So the sharpest question about snooze remains open, and it is not a small one: **snooze writes
`apply(agent.target.surfaceId, …)`, so a misrouted snooze silences another agent's signal for up
to seven days, invisibly.** I can prove the gate is passed (`ATTENTION_NOT_FOUND` rather than
`UNSAFE_TARGET`); I have not watched the write land on the wrong surface.

**What it would take:** a probe pane running a real agent that produces a cmux notification, then
a directory rotation of the kind that proved the Send misroute. That is a bigger probe than
anything I have run — a real agent, not a synthetic transcript — and it is the right shape for
whoever picks this up after `mayTransmit` lands, because it would also serve as that fix's
end-to-end regression test.

---

## Where the write path now stands

| Surface | Exercised | Verdict |
|---|---|---|
| `instruct` (single) | ✅ delivery **and** misroute proven | fixed by `547679e`, re-verified |
| `broadcast` | ✅ fan-out misroute proven, refusal re-verified | fixed transitively |
| `focus` / `interrupt` | ❌ never fired | interrupt now gated; focus deliberately open |
| `archive` | ✅ success + double-archive refusal | clean, correctly outside the gate |
| `rename` | ✅ success + refusal + reset | clean, genuinely id-keyed |
| `acknowledge` / `dismiss` | ⚠️ refusals only | **gate passes on unproven targets** — awaiting `mayTransmit` |
| `snooze` | ⚠️ refusals only | same, plus a 7-day blast radius |
| `triage` | ✅ origin-gated, no pane routing | clean; defect class absent |
| `/api/settings`, `/api/publish` | ❌ never audited | the last untouched surfaces |

**Probe disposal:** both codex session files deleted, date directory and probe cwd removed, **0**
probe session files remain, **0** probe labels remain in the alias store (reset removed the one I
created), both probe rows inert with every control disabled.
