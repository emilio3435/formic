# What could detect a truncated transcript — and where the regress bottoms out

You framed it correctly: transcripts are the arbiter, nothing audits the arbiter, and a truncated
transcript would produce **a correlated failure dressed as independent confirmation** — the
collector and the hand-recomputation reading the same wrong file and agreeing perfectly.

**Three detectors exist. One I tested and it does not work. Two do, partially. And there is a case
nothing available can catch, which I will name rather than paper over.**

---

## Detector 1 — the transcript's own integrity pointer. **Tested. Does not work.**

The format looked promising. Claude transcripts carry `last-prompt` records with a `leafUuid`
pointing at the expected final record:

```
252 last-prompt records in one session file
latest leafUuid 38508324… → resolves to exactly 1 uuid in the file ✓
```

**So I truncated a copy and ran it**, rather than routing it on the strength of the idea:

```
INTACT                 lines 4344   leaf 38508324   resolves TRUE
TRUNCATED -40 records  lines 4304   leaf e48598d5   resolves TRUE   ← still consistent
TRUNCATED -1 record    lines 4343   leaf 38508324   resolves TRUE   ← still consistent
```

**It does not fire.** The pointer is rewritten 252 times through the session, so lopping the tail
simply falls back to an *earlier* `last-prompt` whose leaf is still present. **A truncated
transcript is internally self-consistent** — which is precisely the property that makes truncation
invisible from inside the file.

*Only mid-line truncation is caught this way, by the last line failing to parse. That is the easy
case and not the one that worries us.*

**I was one step from routing this as the fix.** Testing it cost two minutes and saved a bad
dispatch — the same lesson as everything else tonight, applied to my own proposal.

## Detector 2 — our own history as a monotonic floor. **Works, with a boundary.**

`data/archive.json` holds **638 records carrying token totals**:

```
claude:04437b43… { input 2, output 320, cachedInput 774254,
                   total 775358, sessionTotal 4570664, sessionCachedInput 712057 }
```

**That is a record of what the transcript said at an earlier moment**, stored in a file we write
and can read. Cumulative session totals only grow. **So if recomputing a session today yields less
than what we recorded yesterday, the transcript lost data.**

This is the answer to the regress, and it generalises past this instance:

> **Independence does not have to be across sources. It can be across time.**
> An earlier reading of the same source is independent evidence about a later reading, for any
> quantity that can only increase.

Nothing currently performs this check. It needs no external source, no new dependency, and it uses
the most inspectable store we have.

**Its boundary:** it detects truncation that happens **after** we first observed the session. It
cannot see truncation that happened **before**.

## Detector 3 — burnbar, which is exactly the check that fired tonight

The cross-source comparison **is** a truncated-transcript detector. It simply cannot attribute —
as established in `cdad8a9`.

**But the direction is informative**, and that is worth stating because tonight demonstrated one
half of it:

| Observation | Consistent with |
|---|---|
| board **>** burnbar | **their** record truncated ← tonight, and correct |
| board **<** burnbar | **our** transcript truncated, or our collector dropping records |

So the machinery to detect a truncated transcript already exists and already runs. **It would fire
in the opposite direction and, on tonight's evidence, we would investigate rather than assume.**
That is a real answer, and weaker than it sounds only because attribution still needs the
substrate — which in that direction is the thing under suspicion.

## Where the regress bottoms out, plainly

**A transcript that was already truncated the first time we read it is undetectable with anything
available here.**

- Detector 1 cannot see it — the file is self-consistent.
- Detector 2 cannot see it — our floor was recorded *from* the truncated file, so the floor is
  already wrong and monotonicity holds.
- Detector 3 would show board < burnbar — **but burnbar is unreadable and demonstrably
  incomplete**, so a disagreement in that direction cannot be resolved without the very transcript
  under suspicion.

**The only thing that would settle it is a source that counts the same events independently and
that we can inspect. On this machine, that does not exist.** The provider's own account-level usage
record would be one; nothing in this codebase reaches it, and I am not going to describe a
capability we do not have as a mitigation.

**So: the regress bottoms out at the first read.** Everything after it is auditable by time;
nothing before it is auditable at all.

## What I would route

1. **The monotonic floor check.** Per session, assert that cumulative totals never decrease across
   collections — against `data/archive.json` for ended sessions and across successive snapshots for
   live ones. **Fully inspectable both sides, no new dependency, non-vacuous on day one** (638
   records already carry the floor). It is the second correspondence check on this board and the
   first that needs nothing external.
2. **Record the direction convention for the cross-source check**, so the next person who sees it
   fire reads *board < burnbar* as *suspect our side* rather than repeating my error in reverse.
3. **Write the bottom of the regress into the material** rather than leaving it implied. A reader
   who knows the arbiter is unaudited will treat its verdicts correctly; one who assumes it is
   solid will not.

## Limits

- **Detector 1's negative result is from one file and two truncation depths.** A format that wrote
  `last-prompt` once at the end would behave differently; this one writes it 252 times, which is
  what defeats the check.
- **I have not verified that archived token totals are directly comparable** to a fresh
  recomputation — the `sessionTotal` versus `total` distinction bit me once already tonight, and
  the floor check must reconcile units before it can fire.
- **I did not test detector 2 against a real truncation**, only established that the floor data
  exists.
