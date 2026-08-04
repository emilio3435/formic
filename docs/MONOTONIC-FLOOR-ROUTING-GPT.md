# Routed: the monotonic floor check — and the premise needs a guard

The second correspondence check on this board, and the first that needs nothing external.
**Independence across time rather than across sources:** an earlier reading of the same artifact is
independent evidence about a later one, for any quantity that can only grow.

**I tested the premise before routing it, and it is only conditionally true.** That changes the
spec, so it leads.

---

## What I verified

**Comparability — sound.** Archive and live carry the *same ten token keys*:

```
input · output · cachedInput · total · sessionTotal
sessionCachedInput · sessionProcessed · contextWindow · scope · provenance
```

No `sessionTotal`-versus-`total` trap. The floor is directly comparable to the live value.

**Non-vacuity — sound.** `data/archive.json` holds **638 records carrying totals**, and archive and
live populations overlap today, so the check discriminates from the first run rather than passing
at zero.

## What I found by running it, and why it changes the spec

The check **fires right now**, on 2 of 5 sampled overlapping sessions:

```
13b1622c   archived 6,578,092 → live 6,576,897    −1,195   (0.018%)
d2eb460e   archived    41,383 → live    39,836    −1,547   (3.7%)
```

**These are almost certainly not truncation.** `sessionTotal` sums over `uniqueUsage`
(`collectors.ts:689`) — *deduplicated* records — and the dedup logic changed tonight. Tiny relative
deltas, appearing on the day `collectors.ts` moved, are the signature of a **better sum**, not a
lost one.

**So a bare `live >= archived` assertion is wrong**, and wrong in the worst way: it would go red
tonight for a correct reason, red again on the next collector improvement, and be switched off
within days. **That is the health-card failure the Pilot design already warns about** — a signal
that fires every time it is looked at stops being looked at.

## The spec

```ts
// Fires only when a decrease cannot be explained by the collector changing underneath it.
floorViolation(session) =
     live.sessionTotal < archived.sessionTotal
  && archived.collectorVersion === CURRENT_COLLECTOR_VERSION   // same derivation
  && (archived.sessionTotal - live.sessionTotal) / archived.sessionTotal > THRESHOLD
```

**Three requirements, each earned by a measurement above:**

1. **A collector-version stamp on archived records.** Without it the check cannot distinguish *the
   file lost data* from *we learned to count better*. This is the piece that does not exist yet and
   it is the real work — everything else is arithmetic.
2. **A relative threshold, not absolute.** 0.018% is noise from a dedup pass; a truncated file
   loses a *tail*, which on tonight's evidence means tens of percent. Start high — I would suggest
   **10%** — and lower it once the version stamp makes small deltas interpretable.
3. **Report the pair, never a verdict.** *"session X: floor 6,578,092, now 6,576,897, collector
   version differs"* is honest. *"transcript truncated"* is the attribution error I made about
   burnbar six hours ago, and the check cannot distinguish those causes on its own.

## Where it sits, and what it does not do

**It closes the *after-first-read* half of the regress and only that half.** A transcript truncated
before we ever saw it writes a wrong floor, and monotonicity against a wrong floor holds forever.
That case remains undetectable with anything on this machine — stated at the top of
`docs/TRANSCRIPT-ARBITER-REGRESS-GPT.md` rather than left as a remainder.

**What it does give:** the only check on this board where **both sides are fully inspectable.**
The archive is plain JSON we write; the live value recomputes from readable transcripts. When it
fires, we can actually adjudicate — which is more than the cross-source check can say, and the
reason it is worth building even though its coverage is narrower.

## Acceptance criteria

1. **Fires on a real decrease** past threshold with matching collector versions.
2. **Does not fire** on tonight's two sessions once the version stamp is in place — they are the
   natural regression fixture, and they are already in the archive.
3. **Reports the pair and the version state**, never a cause.
4. **Non-vacuity counted** — the check must report how many sessions it actually compared, since a
   run where archive and live do not overlap passes while testing nothing. That is the counter
   already routed, and this is its first real consumer.

## Limits

- **Five sampled sessions.** I did not sweep all 638 archived records against live.
- **I did not test it against a genuine truncation**, only against the dedup-induced decreases —
  so the threshold suggestion is reasoned from what truncation *would* look like, not measured.
- **`collectorVersion` does not exist**; I am proposing it, not describing it.
