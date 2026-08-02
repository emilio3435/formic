# Sources ranked by inspectability — which disagreements we can adjudicate

**Independence only implies non-correlation. It says nothing about reliability.** A source you
cannot inspect can be silently truncated — as burnbar was, at call 3 — and you will read its
silence as agreement or its shortfall as your own error. I did the second one tonight.

So: inspectability as a graded property, **measured rather than asserted**, and the rule it
predicts.

---

## The ranking

| Source | Data readable? | Producer inspectable? | Can arbitrate? |
|---|---|---|---|
| **This repo's code** | yes | **yes — we write it** | **YES** |
| **Our own stores** — `data/archive.json`, attention, bindings, triage | yes, plain JSON | **yes** | **YES** |
| **OS process table** — `lsof` | yes | n/a — *it is the ground* | **YES** |
| **Raw transcripts** — `~/.claude/projects`, `~/.codex/sessions` | **yes** — 6,967 lines, 3,032 usage records readable in one file | no (the agent CLI) | **yes, in practice** |
| **BurnBar store** — `openburnbar.sqlite` | **no — encrypted** | no | **no** |
| **`provider_quotas.json`** | yes | no (provider APIs) | **no** |
| **cmux terminal reports** | **no store at all** — live RPC | no | **no** |

**Verified, not assumed:**

- **BurnBar is genuinely encrypted.** First bytes read `ca91ee12…`; SQLite's magic is
  `53514c69746520666f726d6174`. The file exists on disk and is unreadable without the Keychain
  key — and even with it, nothing reveals what the *writer* did or did not record.
- **cmux has no store to diff.** `~/.config/cmux/` holds `cmux.json` and `settings.json` — config,
  not observations. `rpc debug.terminals` is a live question with a live answer and no artifact.
- **Transcripts are fully recomputable by hand.** One session file: 6,967 lines, 3,032 records
  carrying `cache_read_input_tokens`. This is the arbiter that settled tonight's dispute.
- **`lsof` is available to me** at `/usr/sbin/lsof` — **the same tool `enrichCmuxIdentity` uses.**

## The rule it predicts

> **A disagreement is adjudicable if at least one side is arbitrable.
> If neither is, you can only observe.**

Tested against tonight and against the day:

| Disagreement | Arbitrable side | Outcome |
|---|---|---|
| board vs burnbar tokens | **board** — recompute from jsonl | **adjudicated.** Exactly what happened: hand-recomputation from raw jsonl settled it against burnbar |
| cmux surface vs actual session | **lsof** | **adjudicable** — and the architecture already does it |
| `quotaPressure.usedPercent` | **neither** — no second source, opaque producer | **not even observable** |
| two cmux readings | neither | observable only |

## The surprise: cmux is the least inspectable source and the board already handles it correctly

`enrichCmuxIdentity` takes cmux's terminal report — **the only source on this list with neither
readable data nor an inspectable producer** — and arbitrates it against the **OS process table**,
which sits at the top. cmux says *"here is a terminal"*; `lsof` says *"here is what actually holds
that transcript open."*

**That is the correct architecture for the least trustworthy input, and it is the one place on the
board where a genuinely independent arbiter is already wired in.** It is why the write path ended
up the most trustworthy surface today, and it was not arrived at by this reasoning — it predates
it.

**The design principle it demonstrates:** *the less inspectable a source, the more it needs an
arbitrable one beside it.* Which is the opposite of how I built the cost check — burnbar is the
second-least inspectable source on the list, and I made it the reference.

## The uncomfortable part: our arbiter is itself unaudited

**Transcripts are arbitrable in practice and not in principle.** I can recompute any session's
totals from the jsonl, and I did. But **nothing verifies that the agent CLI wrote those records
honestly.** If Claude Code under-reported its own usage, every layer above it — the collector, the
board, tonight's hand-recomputation — would agree perfectly and all be wrong together.

**The ground we stand on is unverified ground.** It is the best available: readable, self-describing,
recomputable, and internally consistent. It is not attested by anything.

Worth stating plainly because it bounds the whole exercise. **Inspectability ranks sources against
each other; it does not make any of them true.** Tonight's verdict is *"the collector matches the
transcripts and burnbar does not"* — which is the right call on the evidence, and is not the same
sentence as *"the collector is correct."*

## What to do with the ranking

1. **Build tier-3 checks with at least one arbitrable side.** A check between two opaque sources
   detects and can never resolve — a smoke alarm with no way to find the fire.
2. **When a check fires, look to the arbitrable side first**, not to your own. I did the reverse
   and named our side as high.
3. **Sources with no arbitrable partner need a different treatment entirely** — `usedPercent` and
   the cmux-only figures cannot be checked, so they should carry their origin and their units where
   a reader can see them, since a human is the only arbiter they will ever get.
4. **If a source becomes inspectable, its rank changes.** If OpenBurnBar's ingestion were ever
   readable, the cost check would move from *detect* to *adjudicate*, and tonight's investigation
   would have taken minutes.

## Limits

- **I did not attempt to decrypt the burnbar store**, only established that it is encrypted from
  its magic bytes. Whether the Keychain key would let me read rows directly is untested — and it
  would still not expose the writer.
- **The transcript-recomputability claim is from one file.** I confirmed the records are present
  and parseable; I did not recompute a full session total by hand tonight — that was your
  verification, not mine.
- **`provider_quotas.json` I have read once**, tonight.
