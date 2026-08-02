# Retention interactions: the archive forgets on a clock that started before you archived

Pulling the history thread on your three targets. **Two real findings, one honest gap.**

Ranked by consequence-if-real; defence quality stated separately.

---

## 1. HIGH — archive retention runs from the agent's last activity, not from the archive

`archiveCopy` (`archive.ts:201-214`) stores the source agent's own timestamp:

```js
updatedAt: agent.updatedAt,        // the agent's last activity — NOT the archive time
```

and freshness is measured from exactly that (`archive.ts:249-252`):

```js
function isFresh(agent, nowMs) {
  const updatedAtMs = Date.parse(agent.updatedAt);
  return Number.isFinite(updatedAtMs) && nowMs - updatedAtMs <= ARCHIVE_RETENTION_MS;
}
```

**So delivered retention = 30 days − however stale the agent already was when archived.** The
clock was already running before the operator acted.

Consequences, in increasing severity:

- An agent last active 20 days ago, archived today, is kept **10 days**, not 30.
- An agent last active **31+ days ago is pruned on the very next commit** — the operator archives
  it, gets `ok: true`, and it is gone before they look again.
- Meanwhile `app.ts:597` publishes **`retentionDays: 30`** to the UI. That is a **constant, not a
  measurement**, so it will keep reporting 30 no matter what is actually delivered.

Measured against the live store (539 records):

```
mean retention remaining : 28.1 days of the 30 advertised
oldest records           : 18.6 days left, at 11.4 days since last activity
records storing archivedAt: 0 of 539
```

**Nothing records when an agent was archived.** So the discrepancy is not merely undetected, it is
**undiagnosable after the fact** — you cannot reconstruct what retention any record was actually
given, because the input to that calculation was never stored.

This is squarely the time class: today's gap is mild (28.1 of 30) because the fleet is young and
churns fast (median record age 1.2 days). It widens automatically as more agents are archived
after sitting idle, and the archive's own honesty endpoint will never notice.

**Named fix:** store `archivedAt` and measure retention from it, keeping `updatedAt` for display.
If retention from last-activity is deliberate — a defensible policy, "we keep 30 days of *recent*
work" — then the endpoint must stop advertising a flat 30 and report the actual distribution.
Either is fine; advertising one and delivering the other is not.

**Defence quality:** none for the mismatch. The prune logic itself is careful (atomic
temp-file + rename, in-memory state published only after commit), which is what makes the timestamp
choice look deliberate rather than accidental — worth asking the author before assuming it is a bug.

## 2. MEDIUM — operator intent and automatic history share one cap, and history wins

`#commit` (`archive.ts:146-163`):

```js
const retainedAgents = [...].filter(isFresh).sort(byUpdatedAtDesc).slice(0, MAX_ARCHIVE_RECORDS);
const remaining = MAX_ARCHIVE_RECORDS - retainedAgents.length;
const plainIds = [...agentIds].filter(id => !agents.has(id)).sort().slice(0, remaining);
```

Full records are taken **first**, sorted by recency. Bare archived IDs — operator archive
decisions with no accompanying record — get only `remaining`, and are chosen by **`.sort()`,
lexical order of the agent ID**. Not recency, not importance. Alphabetical.

So when the store fills: `remaining` reaches 0 and **every bare operator archive is silently
dropped**, while automatically-retained history keeps its 5,000 slots. A deliberate human decision
is evicted by accumulated machine bookkeeping, and the ordering that decides who survives is an
artifact of how UUIDs happen to sort.

Live: **6 operator-archived vs 533 history records**, 10.8% of cap. Not reachable soon — which is
why this is MEDIUM — but the 99:1 ratio shows exactly which side fills the store.

**Named fix:** reserve a floor for operator-archived entries, or evict them by recency like
everything else. Lexical order should not decide what an operator's action was worth.

## 3. MEDIUM — the archive (30d) and the burnbar (90d) never meet

Confirmed by search in both directions: **no join exists.** `archive.ts` never reads cost or
usage; `burnbar*.ts` never reads the archive.

They answer overlapping questions on different clocks:

| | Retention | Holds |
|---|---|---|
| Archive | 30 days (less, per §1) | who the agents were |
| BurnBar | 90 days (API cap) | what was spent |

So for **60 of the 90 days of recorded spend there is no agent record to attribute it to**, and
"what did agent X cost?" becomes unanswerable at 30 days while the money remains visible for
another 60. This is not corruption — nothing joins, so nothing breaks — it is an
**unreconcilable gap that widens with age**, and it compounds the finding in
`TIME-DIMENSION-AUDIT-GPT.md`: the widest cost view already shows only 32.6% of the record, and
even within that window attribution expires at day 30.

**Defence quality: adequate by accident.** Because no join exists, no incorrect attribution can be
produced. The failure mode is silence, not error — which is why it has survived unnoticed.

---

## The honest gap: I did not find a third distinct instance for your target 2

You asked whether anything computed over a window silently changes meaning as the window slides
past the retention horizon. I found **two** instances and both are already reported — the 30-day
cost view now covering a third of the record (`d903d20`), and §1 above, where the archive's
effective window is shorter than its advertised one.

**I did not find a third, and I am not going to manufacture one.** I checked the action log
(7-day retention, matches its own query surface), the attention store (7 days, never queried over
a longer window), triage (7 days, same), and identity bindings (7-day TTL, with an explicit
comment showing the author reasoned about expiry). Those four are internally consistent: each is
queried over a window no larger than its own retention.

**On target 1 — counters differing across a restart —** I have nothing new beyond
`d903d20`'s epoch-mixing finding, which stands. The one addition worth recording is that
**no epoch marker is persisted anywhere**, so a reader cannot tell which figures reset and which
did not. That is the same shape as §1's missing `archivedAt`: in both cases the system discards
the timestamp that would let anyone audit its own time behaviour.

## Where this leaves the time dimension

Findable from history, and now found: the shrinking cost window, the archive's short-changed
retention, the shared-cap eviction, the cross-store attribution gap, and epoch mixing.

**Genuinely requiring waiting**, unchanged from my last report and still a short list: the first
prune's integration behaviour, long-run accumulation at 10× fleet, and SSE reconnection over many
cycles.

If you want the thread pulled further, the highest-value remaining item is **day- and
month-boundary rollovers in the usage buckets** — 90 days of real history would settle it against
known dates, and I flagged it last round as *not done rather than not findable*. It is still that.
