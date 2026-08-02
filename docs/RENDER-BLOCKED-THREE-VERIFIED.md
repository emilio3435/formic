# The last three render-blocked entries, measured in a browser

**Branch measured: `fix/backend-silent-failures-and-freshness` at `878dd25`.**
The served client was confirmed byte-identical to the working tree (`md5` of
`GET /app.js` against `src/web/app.js`) and no `src/web` commit had landed since
the server booted at 18:41, so the browser was running that code and not an
older build. Measured 21:33–21:50 CEST on 2026-08-02 at `http://127.0.0.1:4701`.

Nine of the twelve render-blocked entries had already been converted to headless
assertions in `tests/headless-render-verification.test.ts`. These three could
not be, and they are the ones below.

---

## `58daea6` — the burn rate names a window it can be held to — **CLOSED**

Rendered, and the window **tracks the query**, which is the part a payload read
cannot show:

| Range selected | Scope note | Burn-rate label |
|---|---|---|
| `24h` | `Usage range 24h · source BurnBar` | **`24.0h average, not a current rate`** |
| `7d` | `Usage range 168h · source BurnBar` | **`7d average, not a current rate`** |

The label is not a fixed string that happens to read plausibly at the default —
it follows the range, and it disclaims being a current rate rather than leaving
the reader to assume it.

*Method note worth keeping:* my first attempt appeared to show the label frozen
at `24.0h` after switching to `7d`. It was not a finding. `@e` refs shift when
the board live-updates between a snapshot and the click that follows it, so I
had clicked `24h` while believing I clicked `7d`. Clicking by a stable attribute
(`[data-fkey="usage-range:7d"]`) gave the result above. **A ref captured from one
snapshot and used after another is a different element.**

---

## `8edf115` — the stage ends where its content ends — **CLOSED**

The only one of the three that is genuinely geometry, and it measures clean:

```
flex: 0 1 auto        max-height: 100%        parent align-items: flex-start
stage height 420px    content height 419px    trailing empty space 1px
scrollHeight 418 == clientHeight 418          (sized to content, not stretched)
```

The defect this replaced was **151px of rows inside a 635px bordered box** — 484px
of empty frame, which the commit rightly calls the strongest "this failed to
load" signal an interface can send. It is now one pixel, which is the border.

Control case, because sizing to content must not break a full fleet: at a 420px
viewport the stage measured 232px — capped at the viewport, no horizontal
overflow. Both readings the fix claims are correct.

---

## `8b31c96` — the BURN card reports the hour it measured, as a floor — **PARTLY CLOSED**

**The primary claim is verified rendered.** The card reports the window it
actually measured rather than asserting an hour:

> **BURN** · `356k` /min · **`10m average · $1.34 last hour`**

against a payload carrying `windowMs: 600000` — ten minutes — and
`tokensPerMin: 356258`. The rate names its ten minutes; the cost names its hour;
the two windows are different and the card says so rather than collapsing them.

**Two branches of that commit did not render while I watched, and I am not
counting them as verified.**

*The `≥` floor marker.* `costIsFloor` is emitted only when true, so its absence
means the hour's cost is complete and `$1.34` — with no marker — is the correct
render. The marker's own branch was never exercised. It needs an hour containing
unpriced invocations, which I cannot manufacture on a live board.

*The health sublabel's unaddressable branch.* `unaddressableCount` was 0 for most
of the session, so the sublabel read `4/4 sources healthy · controls reachable`.
The string the commit introduced (`N sessions cannot take commands`,
`app.js:829`) survives intact but did not render.

**One near-miss worth recording rather than rounding up.** A screenshot caught
the board with `2 live sessions can't take commands` on the Findings card, and
it would have been easy to call that the branch rendering. It is a *different
string in a different surface* — `app.js:669`, `can't` rather than `cannot` —
so it proves the unaddressable signal reaches the UI, and proves nothing about
the sublabel this commit changed. The count had returned to 0 by the time I
re-read it.

---

## Ledger movement

| | Before | After |
|---|---|---|
| Blocked — needs a rendered read | 3 | **0** |
| Closed by browser measurement | — | 2 (`58daea6`, `8edf115`) |
| Partly closed, branches named | — | 1 (`8b31c96`) |

The blocked column is empty. One entry carries two unexercised branches with the
exact condition each needs, which is a different and more useful state than
"unverified".
