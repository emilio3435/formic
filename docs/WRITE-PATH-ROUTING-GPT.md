# Routed: the exact-tier test, and the broadcast finding

Two items you asked me to hand over rather than act on.

---

## 1. The exact-tier test — the highest-value thing I could not do

**What is unproven.** `docs/WRITE-PATH-AUDIT-GPT.md` shows `unique-cwd` misroutes. It does **not**
show that `exact` is safe. My claim that `exact` is evidence-based is a source reading
(`cmux.ts:247-274`) plus a live observation (all 9 routable agents matched by session ID), **not
an attempted break**. Since the dispatched fix makes `exact` the *only* permitted tier for
transmitting actions, the whole write path will rest on an assumption nobody has tried to falsify.

**The assumption, stated so it can be attacked:** *when cmux reports `session_id` S on surface X,
the process holding session S is the one attached to X, and remains so until the next collection.*

**Four ways it could be false — the test plan:**

1. **Stale attestation.** cmux reports what it last observed. If an agent exits and its pane is
   reused by a new process within a collection interval, does `debug.terminals` still report the
   dead session's ID on that surface? *Test:* start a probe agent in a probe pane, confirm
   `exact`, kill the agent process without closing the pane, start a second probe agent in the
   same pane, then send to the **first** agent's row and read the receiving tty. If the old
   session ID lingers, a send reaches the replacement.
2. **Surface ID reuse.** Do cmux surface IDs get recycled after a workspace closes? *Test:*
   record a probe surface ID, close the workspace, open a new one repeatedly, and check for a
   collision. If IDs recycle, a snapshot taken before the close can route into an unrelated pane
   after it.
3. **Multiple attestation keys disagreeing.** `cmux.ts:247` merges seven fields
   (`session_id`, `agent_session_id`, `source_session_id`, `codex_session_id`,
   `claude_session_id`, `omp_session_id`, `cursor_session_id`) into one `sourceSessionIds` array
   with **no conflict detection** — it is a `filter` then a `Set`, so a surface reporting two
   *different* live sessions matches *both* agents at the `session` tier. Each would then see
   `matches.length === 1` from its own side and resolve `exact`. *Test:* find or construct a
   surface reporting two distinct session keys and check whether both agents resolve `exact` to
   it. **This is the one I would run first** — it needs no timing and it is a pure logic gap, and
   note it would produce `exact`, not `ambiguous`, so no existing guard catches it.
4. **The 2 live `cwdMismatch` agents.** Two of nine routable agents already have cmux's session
   evidence disagreeing with the pane's folder. They are the only live population where the two
   signals are known to diverge. Whoever runs this should read those two first — they are free
   evidence about which signal drifts.

**Method that worked and should be reused:** make the instruction self-report its tty
(`tty > /tmp/<probe>/delivery.txt`), and establish the tty→pane mapping by asking each pane
directly through `cmux`, never through the board. The board's claim of success and the evidence
of delivery must come from different channels or you are just asking the system whether it
agrees with itself.

---

## 2. Broadcast — it inherits the defect and adds one of its own

Source-read only (`broadcast.ts`); not fired, because every eligible recipient was a working lane.

**Inherited.** `:106-112` resolves each recipient from the same snapshot and calls the **same**
`executeControl`, which permits `unique-cwd`. So every routing defect on the single-control path
exists here, **multiplied by up to 50 recipients in one request**. Restricting `control.ts:100`
to `exact` fixes broadcast too — they share the function. Worth confirming the dispatched fix is
made in `executeControl` and not at the `/api/control` handler, or broadcast keeps the hole.

**Its own defect: staleness is checked once, for a loop that runs long.** `:84-101` validates
snapshot age **before** the loop. `:105-113` then runs recipients **sequentially**, and each
`instruct` costs a `send_text` plus a `send_key`, plus a second `send_key` on retry
(`control.ts:127-135`) — so 50 recipients is 100–150 `cmux rpc` subprocess round-trips, executed
in series with no re-check.

The freshness guarantee therefore holds for **recipient 1 and no one else**. By the last
recipient the routing evidence can be far older than `MAX_CONTROL_SNAPSHOT_AGE_MS` (30s), and the
request will still deliver, because the guard already passed. A `STALE_SNAPSHOT` rejection is
impossible mid-loop by construction.

*Magnitude is inference, not measurement:* I did not time 50 recipients, because the only
available recipients were working lanes. The subprocess count is read from source and is exact;
the wall-clock is not.

**Named fixes:**
- Re-check snapshot age **inside** the loop, or better, re-resolve each recipient's target at its
  own moment of execution and abort that recipient if the surface changed.
- Return per-recipient routing provenance in `results[]` — the delivered `surfaceId` and
  `resolution` — so a 50-way broadcast is auditable afterwards. Today `results[]` carries
  `{agentId, ok, error}` and the action log carries no surface at all, so a fan-out misroute is
  undiagnosable at scale.
- Consider capping fan-out to `exact`-tier recipients *even if* single-control policy ever
  loosens; a misroute repeated 50 times is a different severity class from one.

**What holds up in broadcast, for calibration:** recipients are explicit IDs, 1–50, deduplicated,
with no server-side selector — there is no "send to all working agents" that could silently widen.
Origin, content-type, body-size and newline-injection gates match the control path. Partial
failure is reported honestly as `207` with `partial: true` and a per-recipient result array rather
than a single misleading `ok`.
