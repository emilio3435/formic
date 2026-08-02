# Product-driven candidate generation: also empty. Stopping.

Measured on branch `fix/backend-silent-failures-and-freshness`, HEAD `7a64020`, board at
`127.0.0.1:4701` via the browse tool.

**You said to say so if this came up empty. It did.**

---

## What I did

Drove the board rather than recalling what surprised me, and took the first thing on screen I could
not interpret without leaving it.

**That worked as a method** — it found a candidate in one pass, and a better-shaped one than any of
my six recalled guesses:

```
Idle 12 · 6h          title: null    aria-label: null
History 198 · 6h      title: null    aria-label: null
```

The `· 6h` suffix appears on two tabs, carries no hover text, and I genuinely could not tell
whether it meant the same thing in both — *idle for up to 6h*, *idle within the last 6h*, *198
ended in 6h*. To settle it I had to open `app.js:3114`, which is exactly the disqualifying test:
**anything I need the code for is undocumented for someone who has neither the code nor my week.**

**And the magnitude is real.** `History 198 · 6h` sits against `totals.history: 567`. The suffix is
disclosing a 369-agent narrowing.

## Why it is still a null

`ANT-GUIDE.md:239` — *"`Idle` and `History` also apply a **lookback** window (6 hours by default)…"*
`ANT-GUIDE.md:599` — *"…remember `Idle` and `History` apply their own lookback window."*
`QUICKSTART.md:76` — *"If it looks empty, widen the lookback (1h / 6h / 24h / 36h)…"*

**Documented three times across two files, including the default and the available values.**

And the notation exists *because of* an earlier finding of mine. `app.js:3114` says so:

> *"The GPT lane's §8 asked for the scope line to fall silent when no filter is active and I
> implemented it; that was right about the restated counts and wrong about the lookback… The
> disclosure belongs on the count it qualifies."*

So the one thing I could not read off the screen was a disclosure added in response to my own
report, and then documented. **That is the system working, not a gap.**

## The honest assessment of both methods

| Method | Candidates | Hits |
|---|---|---|
| Recall — what surprised me today | 6 | 2 |
| Product-driven — what I cannot read off the screen | 1 | 0 |

**One sample is not a verdict on the second method**, and I want to be clear I am not condemning
it — it produced a sharper candidate than recall did, on the first try, and the null came from the
docs being good rather than the method being bad. If someone continues, this is the approach to
continue with.

**But I am stopping rather than taking a second sample**, for the reason you gave me: I have spent
the day inside this system, and the remaining things I cannot read off the screen are getting
harder to distinguish from things I have simply forgotten I once looked up. The next candidate I
generate will be weaker evidence than this one, not stronger.

## What I would hand the next lane

Not my candidates — none of them survived. **The method:** open the board, take the first glyph,
number or suffix you cannot explain without leaving the page, and check the three documents. It
took one pass to produce a real candidate and the docs happened to be ahead of it. **They will not
always be**, and the operator-facing surface has more notation than three documents can cover
forever.
