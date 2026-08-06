# The geometry gate — written, validated, and NOT RUNNING

`notification-center-geometry.test.ts` beside this file measures the notification
panel's real layout box in a headless browser. **It is parked here on purpose. It
is not in `tests/`, it does not run in CI, and it does not run locally unless
someone runs it by hand.** Treat check 6 of `../A11Y-SWEEP-NOTIFICATION-CENTER.md`
as guarded by a CSS-text assertion only.

## Why it exists

A11Y-1 shipped to main and reached a user: at 420px the panel hung 24px off the
**left** edge of the viewport, and because `body { overflow: hidden }` the clipped
strip was unreachable — `WAITING ON YOU` read `AITING ON YOU`, and the ember rails
that mean a person is the blocker were partly off-screen.

The guard that landed with the fix greps `styles.css` for `align-self: stretch`.
Three mutations, each measured on a real board at 420px:

| Mutation | Panel box | Clipped? | CSS-text guard |
|---|---|---|---|
| today (fixed) | `32 → 388` | no | green |
| **A** anchor reverted to `align-self: center` | `48 → 372` | **no** | **RED** — false positive |
| **B** centred anchor + viewport-measured width — *what shipped* | **`-24 → 372`** | **yes** | RED |
| **C** anchor stretched, width clamp put back | **`-8 → 388`** | **yes** | **GREEN** — blind |

The guard is wrong in both directions. It fires on A, which is merely a narrower
panel and harms nobody. It is blind to C, which is the same defect arriving by a
different route. **The defect was never "the file lacks a declaration" — it was
"the panel's box leaves the window," which is a number.**

## What the parked test does

Opens the panel at 360 / 420 / 768 / 1280 against a board it starts itself on an
ephemeral port, and asserts `panel.left >= 0` and `panel.right <= innerWidth`,
plus that no content inside the panel is clipped and that the open panel adds no
horizontal document scroll. It carries a guard on itself — `panelWidth > 200`,
`right > left` — because every other assertion would pass against a 0×0 rect if
the click silently failed.

Verified by running it against copies of the tree with the CSS reverted **in the
copy**, never in `src/web/`:

```
today      13 pass
route B     2 fail   panelLeft -24, ledeLeft -8   (the shipped defect)
route C     2 fail   panelLeft  -8 at 360 and 420 (the route text cannot see)
```

## Why it is parked instead of landed

It needs a real CSS layout engine. Nothing in this package has one: `devDependencies`
is `@types/bun` and `typescript`, no test shells out to a browser, and a DOM shim is
not a route — **jsdom and happy-dom do not implement layout at all**, so
`getBoundingClientRect()` returns zeros. It drives the gstack `browse` Chromium from
`~/.claude/skills/`, which CI does not have.

`scripts/ci-tests.sh` globs `find tests -name '*.test.ts'` and runs everything not
named in `LOCAL_ONLY`. So in `tests/` it would red-light CI at `beforeAll`. It needs
a `LOCAL_ONLY` entry:

```bash
  # Measures the notification panel's real layout box in a headless browser;
  # needs a Chromium from ~/.claude/skills and a board it starts itself.
  tests/notification-center-geometry.test.ts
```

`scripts/**` belongs to another lane, so that line is not this one's to write.

**A filename that dodges the glob was considered and rejected.** Calling it
`…geometry.test.local.ts` would slip past `find -name '*.test.ts'` and let it land
with CI untouched. `ci-tests.sh` says exclusions are *"spelled out here rather than
expressed as a skip inside each file so the exclusion is visible in one place and
shows up in review."* A filename that quietly opts out defeats exactly that.

## To un-park it

1. Add the `LOCAL_ONLY` entry above to `scripts/ci-tests.sh`.
2. `git mv docs/a11y-geometry-gate/notification-center-geometry.test.ts tests/`
3. **Re-run `bunx tsc --noEmit`.** `tsconfig.json` includes only `src/**/*.ts` and
   `tests/**/*.ts`, so while parked here this file is **outside the typechecker**.
   It typechecked clean at the commit that parked it, and it will drift.
4. `bun test ./tests/notification-center-geometry.test.ts` → expect 13 pass.

⚠ `browse` is one shared daemon per machine. Running this navigates it and changes
its viewport; do not run it while another agent is driving the browser.

## Even un-parked, this is a local gate

CI still never executes it. The only thing that makes panel geometry
CI-enforceable is a headless browser in `devDependencies` — a browser download in
a package that advertises zero runtime dependencies. That is a call for Emilio,
not for a lane, and it is worth making only if this class of defect recurs.
