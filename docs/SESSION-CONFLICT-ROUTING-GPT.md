# Routed: two claims about one pane must resolve ambiguous

**The defect.** A cmux surface whose `sourceSessionIds` names **more than one distinct session**
resolves **`exact`** for *every* agent named in it, onto that single pane. A pane hosts one
interactive session, so at least one of those resolutions is wrong — and since `547679e`, `exact`
is the sole authority for typing into a terminal, so every one of them is authorised to write.

**Proven** by driving the production `resolveAgentTarget` with one surface carrying two session
IDs:

```
ALPHA  -> resolution=exact  surface=SURFACE-SHARED
          reason: Matched source session ID recorded by cmux.
BRAVO  -> resolution=exact  surface=SURFACE-SHARED
          reason: Matched source session ID recorded by cmux.
```

**Why no guard catches it.** `targets.ts:124-147` filters surfaces by
`surface.sourceSessionIds.includes(agent.sourceSessionId)` and then asks whether **the matched
list** has length 1. From ALPHA's side exactly one surface matches; from BRAVO's side exactly one
surface matches — the same one. Nothing anywhere asks whether **the surface** names more than one
session. `quarantined()` (`targets.ts:47`) trips only on `surface.identityConflict`, a flag the
collector must *set*; it is never *derived* from the surface's own contents.

Note the asymmetry that makes this easy to miss: the code is careful about *one agent matching
many surfaces* (`matches.length > 1` → ambiguous, twice) and blind to *one surface claiming many
agents*.

**Reachability today is zero** — 0 of 22 live surfaces carry more than one session ID — so this is
a latent defect, not a live exposure. It is worth fixing now precisely because the write gate was
just narrowed onto `exact`: the tier is load-bearing in a way it was not last week.

## The fix

In `targets.ts`, treat a surface naming several distinct sessions as an identity conflict and
resolve `ambiguous`. The cleanest place is `quarantined()`, so it covers the recorded tier, the
session tier and the cwd tier at once:

```js
function quarantined(matches) {
  const conflict = matches.find((s) => s.identityConflict);
  if (conflict) return { resolution: "ambiguous", reason: `…${conflict.identityConflict}` };
  const contested = matches.find((s) => new Set(s.sourceSessionIds).size > 1);
  if (contested) {
    return {
      resolution: "ambiguous",
      reason: `cmux surface ${contested.surfaceId} names ${new Set(contested.sourceSessionIds).size}`
        + ` different sessions; one pane holds one session, so ownership cannot be proven`
        + ` and controls are disabled.`,
    };
  }
  return undefined;
}
```

Use a `Set`, not `.length` — `cmux.ts:247` already dedupes, but a duplicate of the *same* ID
across two provider fields is agreement, not contradiction, and must not quarantine.

## Acceptance criteria, in a form the tests lane can pin

1. **The defect, inverted.** One surface, `sourceSessionIds: ["a", "b"]`, two agents with those
   session IDs → **both** resolve `ambiguous`, not `exact`. This is the exact fixture above and it
   must go red against today's code.
2. **No over-reach.** One surface, `sourceSessionIds: ["a", "a"]` (same session via two provider
   fields) → still resolves `exact`. Agreement is not conflict.
3. **The write gate follows.** With the contested surface, `executeControl` for `instruct` and
   `interrupt` returns `409` and the snapshot reports those controls disabled — i.e. the fix must
   be visible at the `controls` layer, not only in `resolution`.
4. **The refusal explains itself.** The reason names the surface, the number of claimants, and why
   that is unprovable — matching the standard `547679e` set for its own refusal string.
5. **Mutation check.** Reverting the `Set` to `.length > 1` must still pass; reverting the whole
   clause must fail (1); quarantining on duplicate-identical IDs must fail (2).

**Still-wrong-but-differently to watch for:** resolving `missing` instead of `ambiguous`. Both
disable controls, but `missing` reads as *"no pane found"* when the truth is *"too many claims on
one pane"* — an operator debugging a contested surface would be sent looking for an absent
terminal. The distinction is the whole point of having both words.

**Not a fix:** picking a winner among the claimants by recency or by cwd match. That reintroduces
inference at exactly the tier the write gate now trusts.
