# Tier 3 detects. It does not attribute. — and the four fields, routed

The cross-source check disagreed, **the collector was right, OpenBurnBar's record stops at call 3**,
and my hypothesis named our side as high. That is a limitation of the idea, not of the instance,
and it belongs in the tier-3 material before anyone builds another one.

---

# Part 1 — Routed: the four components

Expose on `/api/usage/invocations`, per row:

```ts
inputTokens · outputTokens · cacheReadTokens · cacheCreationTokens
```

Already selected in the query for fallback pricing (`burnbar.ts:203-206`); this is a projection,
not a new read.

**Still worth doing even though the 161% is now explained**, and the reason has changed: it is no
longer a diagnosis, it is a *detector for the defect just found*. If OpenBurnBar's record can stop
mid-session, the per-component split is how you see it happen again — a truncated record is low on
**every** component proportionally, which is a different signature from a unit mismatch on one.

It also still unblocks **B5** (*components sum to total*), which I marked unevaluable by
construction, and the **cache-share question** the 1.6B defect turned on. Three uses, one
projection.

---

# Part 2 — What this instance teaches about tier 3

## 1. An independent source can be incomplete. External is not authoritative.

I built the check treating burnbar as the reference and the board as the thing under test. **The
external source was the wrong one.** OpenBurnBar stopped recording at call 3; the board had it
right the whole time.

**"Independent" and "correct" are different properties, and only one of them was ever established.**

## 2. A disagreement is a detection, not an attribution

Tier 3 answers *"do these two agree?"* — and nothing more. **It cannot answer *"which is right?"*,
because both answers produce the identical observation.**

My own routing document proves this against me. Its table has two rows that yield the same reading:

> **Row 1** — *"Board runs high by the creation share"* → **ranked first, our fault, wrong**
> **Row 3** — *"The join is picking up rows burnbar does not have for that session"* → **ranked
> third, closest to the truth, and I labelled it a *population* problem on our side rather than a
> truncated record on theirs**

**Same observation, opposite attributions, and I ordered them by which felt like our problem.** The
correct shape was in my own table, third, wearing the wrong name.

## 3. Attribution needs a third thing, and it is not a third derivation

**It is the substrate.** What settled this was **hand-recomputation from the raw `jsonl`** — not a
third view of either store, but the ground under one of them. Plus a structural tell: burnbar's
figure landed **exactly on a call boundary** rather than off by a cache ratio, which is the
signature of truncation and not of arithmetic.

So the ladder needs a distinction it did not have:

```
UNWATCHED            nothing notices
PINNED BUT UNPROVEN  a change is noticed; wrongness is not
ATTESTED             a disagreement is DETECTED
ARBITRATED           a disagreement can be RESOLVED — requires substrate, not a third opinion
```

**A tier-3 check without a named arbiter is a smoke alarm with no way to find the fire.** Before
building one, write down: *when these disagree, what do I recompute by hand, and from what raw
source?* If there is no answer, the check will still be useful — it detects — but it must not be
read as pointing.

## 4. The bias worth naming, because I exhibited it in writing

**I treated as authoritative the one source I had already documented I cannot inspect.**

In `JULY30-MECHANISM-GPT.md` I wrote that burnbar is *"an SQLCipher-encrypted database"* in *"a
separate application"* and that *"no code path in this project can produce or alter those rows."*
In `TIER-3-CORRESPONDENCE-GPT.md` I called it *"a separate application, into an encrypted SQLite
store this repo only reads."*

**I recorded that I cannot audit it, and then leaned on it.** The instinct — *the external source
is independent, therefore it is the reference* — is exactly backwards for a third-party product
whose completeness you have no way to check. **Inspectability should raise your trust in a source,
not lower it**, and by that measure the collector — whose code I have read all day and whose output
I can recompute from raw transcripts — was always the better-established side.

## 5. The check succeeded. My reading of it failed.

Worth separating, because the conclusion should not be *"tier 3 is unreliable."*

**The mechanism did exactly its job on its first run:** it found a real defect in a source that had
no sibling until tonight, and that defect is a **truncated record in the system that produces the
cost figures Emilio acts on.** That is a more valuable finding than the one I was looking for.

**Everything wrong here was in the interpretation layer** — my ranking, my hypothesis, my
assumption about which side was authoritative. The check reported *"these differ"*, which was true.

## What I would tell whoever builds the next one

1. **Name the arbiter before you build the check.** What raw source resolves a disagreement, and
   can you actually read it?
2. **Do not rank hypotheses by which side you own.** I put our-fault first and truth third; a
   coin-flip would have done better.
3. **Report a disagreement as a disagreement.** *"Board 293,235, burnbar 112,258, unresolved"* is
   the honest output. Naming a culprit in the same breath is a separate claim needing separate
   evidence — which is what the publication form has been saying all day, applied to a number
   instead of a sentence.
4. **Rank sources by inspectability, not by independence.**

## Limits

- **I have not seen the hand-recomputation** or the call-boundary evidence; I am taking your verdict
  and reasoning about the method from it.
- **One instance.** The claim that tier 3 detects-but-cannot-attribute is structural reasoning
  supported by one case, and the case is one where I was wrong — which makes it vivid rather than
  statistically strong.
