# Pulse and health — one verified, one unverifiable here, four that need the frontend lane

Continuing the ledger by consequence. **Keys enumerated before any claim of absence**, per the
correction we both earned this afternoon.

---

## `fbdf2c0` — stop counting pauses as completions — **VERIFIED BY DRIVING THE RUNNING API**

```json
"pulse": { "momentum": {
  "working": 4,
  "completionsLastHour": null,
  "completionsProvenance": "not-observable",
  "observedWindowMs": 1200000,
  "stalled": 6
}}
```

**`completionsLastHour` is now `null`, with `completionsProvenance: "not-observable"` beside it.**

This is the item I ranked **worst** in the magnitude audit — a counter with no bound, no epoch, and
a label naming a wall-clock hour it never measured. The fix does not bound it; it **stops emitting
it** when the value cannot be observed, and says why in a sibling field.

That is the strongest available answer and better than what I asked for. I proposed bounding the
number; refusing to publish an unobservable one removes the class rather than constraining it. It
is also the same shape as `costKnown` beside `estimatedCostUsd` and `tokensMissing` beside the
token sum — **a third instance of this codebase converging on "carry the gap beside the value"**,
now applied by omission rather than qualification.

## `42d842e` — never-installed is absent, not degraded — **NOT VERIFIABLE ON THIS MACHINE**

```
verdict: "healthy"    staleSources: []    cmuxReachable: true    controlErrors: []
```

**This tells me nothing about the fix.** Every provider this fleet uses is installed here, so there
is no never-installed provider to classify. `staleSources: []` is exactly what I would see whether
the fix works or whether it is broken — **check 4: the observation is identical under both
hypotheses**, so it is not a check.

Verifying it needs a machine missing a provider, or a fixture that reports one. **Left openly
unverified.** I could have written "health reads clean, looks right" and moved the ledger; that
would be the confident entry you told me is worth less than an honest gap.

## Four that need a rendered read — **LEFT OPEN, per your constraint**

These are render-layer fixes. Their diffs touch `src/web/` only:

| Fix | Files |
|---|---|
| `8b31c96` BURN card reports the hour it measured, as a floor | `src/web/app.js` |
| `f13a730` a board that cannot take commands does not read as clear | `src/web/presentation.js`, `index.html` |
| `52df8c9` one collection, one number, two honest words | `src/web/styles.css` |
| `58daea6` burn rate names its window | rendered text (from last round) |

**I am not substituting a payload read for a rendered one.** I can see that the *data* these fixes
render is present and well-shaped — `attentionCoverage` carries
`{agents: 553, readable: 17, notReadable: 0, ended: 536}` with an explicit `preconditions` block,
`contextReporting: 16` sits beside `contextEligible: 17`, and `controlHealth` reports
`debris: {kind: "abandoned-cmux-panes", count: 2}` rather than staying silent. **That is evidence
the server half is sound and no evidence at all about what the operator sees**, which is the
entire subject of these four commits.

They stay unverified until the frontend lane is unblocked.

---

## Ledger movement

| | Was | Now |
|---|---|---|
| Verified | 9 of 23 | **10 of 23** |
| Unverified — needs a rendered read | — | **4** (`8b31c96`, `f13a730`, `52df8c9`, `58daea6`) |
| Unverified — condition absent here | — | **1** (`42d842e`) |
| Unverified — not yet attempted | — | **8** |

**The unverified column is now honest rather than uniform.** Four are blocked on a lane, one is
blocked on the world, eight are simply not done. Previously all thirteen read the same way, which
hid that most of the remainder needs someone other than me.

## Already correct, said and moved past

`fbdf2c0` did more than its subject claims and I went looking for nothing further in it. The
attention, context and debris fields above are all in good shape on the server side.

## One thing I checked because it could have been mine

`controlHealth.debris` reports **2 abandoned cmux panes** — `8E5C6309…` and `F04D51EE…`. I have
created and closed probe workspaces repeatedly today, so I checked: neither ID matches any probe
surface I recorded, and I confirmed **0 probe surfaces remaining** after each cleanup. They are not
mine. Raising it because a probe that leaked would show up exactly here, and "not mine" is worth
more when someone actually looked.
