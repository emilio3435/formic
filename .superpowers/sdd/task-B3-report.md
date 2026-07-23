# Task B3 completion report — vitals instrument band promotion

## Commit

- Worktree: `/Users/emilionunezgarcia/Developer/the-mountain-lanes/luna-inspector-totem`
- Branch: `ant-hill/luna-inspector-totem-20260722`
- Commit: `8783946 feat(inspector): vitals promoted to an instrument band under the verdict head` (on top of B2's `c07d0f9`)
- Not pushed. Worktree clean after commit.

## Implementation summary

An extraction-and-rehome, not a redesign. The three vitals tiles moved verbatim out of the collapsed Evidence shelf into a new `renderVitalsBand(agent)` that fills B2's empty `.inspector-vitals` mount, directly under the verdict head (after `.next-action`, before the drawer-shelf).

- **`renderVitals` → `renderVitalsBand`.** The tile-building function (context ring / token-summary fallback, session-tokens + cache-hit meter, uptime / last-update) was renamed and exported on `globalThis.TheAntHill` (following B2's export pattern for `verdictGate`/`headPrimaryAction`). Its body is unchanged — the same `vitalTile()` markup, the same `vital-big mono` value convention, the same `svgRing`/`svgMeter` SVG-attribute meters, the same honest fallbacks. It still returns the `.vitals` band node when there are tiles, else `null` (omit-empty).
- **`renderAgentDrawer` fills the mount.** The bare `pane.append(el("div", { class: "inspector-vitals" }))` from B2 became: build the mount, `const vitalsBand = renderVitalsBand(agent); if (vitalsBand) vitalsMount.append(vitalsBand)`, then append the mount. The mount always holds its DOM position (B2's contract); `renderVitalsBand` omit-empties and `.inspector-vitals:empty { display: none; }` collapses the blank mount so no flex gap is spent.
- **`renderEvidenceShelf` de-vitaled.** The `const vitals = renderVitals(agent); if (vitals) body.prepend(vitals);` block and its comment were removed. Evidence now builds only `renderEvidence(agent)` — paths (session cwd, artifacts), routing (control link), and the transcript tail. The collapsed caterpillar rail and cog header are untouched.
- **Two stale comments updated** (cleaning up my own mess, not adjacent refactoring): `renderOperateMeta` and `renderOperate` each carried a comment asserting vitals live "behind the Evidence disclosure" / "lead the Operate tab" — my change made both false, so they now say the band leads the drawer under the verdict head. No code in those functions changed.
- **CSS** (`/* ---------- vitals band ---------- */` section): the section doc comment updated to describe the new position (a compact row directly under the verdict head, leading the drawer instead of hiding in Evidence), plus one functional rule — `.inspector-vitals { min-width: 0; }` — so the mount behaves as a well-formed flex item of the `.pane-inspector` column (its wrapping `.vitals` row shrinks correctly at the 375px full-surface width rather than leaning on the pane's `overflow-x: hidden` clip). The existing `.vitals { display: flex; flex-wrap: wrap; gap: 0.5rem; }` and `.vital { flex: 1 1 8.5rem; }` already produce the compact horizontal row at desktop width and wrap gracefully below 1024px; no restyling of the tiles was needed, and none was invented.

## Cost-tile decision — OMITTED (evidence, not preference)

**Finding: `AgentSnapshot.cost` exists in the type but is never populated. Real cost is program/pulse-level only. The cost tile is omitted.**

Types evidence (`src/shared/types.ts`):
- Line 103: `AgentSnapshot` declares `cost?: CostUsage | null` — a genuine per-agent field on the type.
- Lines 29–34: `CostUsage { amount; currency: "USD"; provenance; note? }`.
- Lines 219–227: `PulseBurn.costLastHourUsd: number | null` — cost lives at program/pulse level.

But the type field is vestigial — no collector ever populates a non-null per-agent cost. Every assignment to an agent's `cost` in the entire codebase is null or a null passthrough:
- `src/server/cursor.ts:195,268` → `cost: null`
- `src/server/archive.ts:127` → `cost: agent.cost ? { ...agent.cost } : agent.cost` (passthrough of a value that is always null/undefined)
- `src/server/{codex,omp,claude}` collectors / `snapshot.ts` / `collectors.ts` — never set `cost` at all
- Tests only ever set `cost: null` (`tests/archive.test.ts`, `tests/cursor.test.ts`)

The only cost data that actually renders anywhere is program/pulse-level: `PulseBurn.costLastHourUsd` in the pulse band (`app.js:922`) and the usage-tab BurnBar aggregates (`app.js:4683+`). Both are aggregate, not per-agent.

Consequences honored:
1. The existing `renderVitals` never had a cost tile to extract, so extraction adds none.
2. Adding one would render nothing in every real case (omit-empty on the always-null field) — speculative dead code — or would force program-level cost into an agent's band, which the brief explicitly forbids ("do not render program-level cost inside an agent's band").

The decision is recorded in the `renderVitalsBand` doc comment so a future reader doesn't re-litigate it.

## TDD evidence — RED → GREEN

**RED** — 4 new tests in `tests/web-client.test.ts` (`describe("vitals instrument band (B3)")`), written first, a mix of B2's executable-fixture idiom (`withDom` + a minimal fake document, walking the built node tree) and the source-regex idiom:

```
bun test tests/web-client.test.ts -t "vitals instrument band"
✗ (a) renderVitalsBand is exported …   typeof M.renderVitalsBand === "undefined"
✗ (b) missing vitals honest fallbacks  TypeError: M.renderVitalsBand is not a function
✗ (c) renderEvidenceShelf no longer …  contains "body.prepend(vitals)"
✗ (d) renderAgentDrawer fills the mount contains the bare empty append
 0 pass / 4 fail
```

Each fails for the intended reason: (a)/(b) the function isn't exported/renamed yet; (c) the vitals prepend is still in Evidence; (d) the mount is still appended empty (the discriminator `not.toContain('pane.append(el("div", { class: "inspector-vitals" }))')` — chosen because B2's comment already mentioned `renderVitalsBand(agent)`, so a bare substring check would have passed prematurely).

- (a) executes `renderVitalsBand` against a live fixture (model + observed context + elapsed): asserts a `.vitals` node whose values carry the `vital-big` + `mono` classes, a real `vital-ring`, and the observed total (`40k`) + uptime (`2m`).
- (b) honest fallbacks: a Claude-style fixture (observed total, **no** context window) renders the absolute count and **no** fabricated ring / no `%` (no invented denominator); a fully-unreported fixture yields `null` (omit-empty, never a fake `$0`/`0`); and `tokenSummary({provenance:"unknown"}).text === "not reported"` pins the honest string byte-identical.
- (c) `renderEvidenceShelf` source contains neither `body.prepend(vitals)` nor a `renderVitals(agent)`/`renderVitalsBand(agent)` call.
- (d) `renderAgentDrawer` contains `renderVitalsBand(agent)`, no longer the bare empty mount append, and the mount sits before the shelf.

**GREEN** — after implementation:

```
bun run check   →  bunx tsc --noEmit ✓
 254 pass / 0 fail / 1011 expect() calls — Ran 254 tests across 20 files
```

250 pre-existing (B2's tally) + 4 new; none skipped or filtered.

**One pre-existing assertion modernized** (parallel to B2's precedent). The `Take A agent drawer` test pinned the old contract `expect(evidenceShelf).toContain("renderVitals(agent)")` ("vitals render inside the Evidence shelf"). B3 reverses that by design, so it now asserts the opposite — `not.toContain("renderVitals(agent)")` and `not.toContain("renderVitalsBand(agent)")` — with an updated comment. The sibling `expect(operate).not.toContain("renderVitals(")` was already correct and stays.

(A test-only wrinkle surfaced and was fixed in the test harness, not the implementation: the first `textOf` walker only read child text-nodes and missed every value set via `el`'s `text:` attribute, i.e. `node.textContent` on a childless leaf — the uptime "2m" and the "40k tokens" string. Corrected to also sum `node.textContent`. The implementation renders those values correctly; in a real browser `text:` is `textContent`.)

## Files changed

- `/Users/emilionunezgarcia/Developer/the-mountain-lanes/luna-inspector-totem/src/web/app.js` — export add; mount fill in `renderAgentDrawer`; vitals block removed from `renderEvidenceShelf`; `renderVitals`→`renderVitalsBand` rename + doc comment (records the cost decision); two stale comments corrected.
- `/Users/emilionunezgarcia/Developer/the-mountain-lanes/luna-inspector-totem/src/web/styles.css` — vitals-band section doc comment; `.inspector-vitals { min-width: 0; }`.
- `/Users/emilionunezgarcia/Developer/the-mountain-lanes/luna-inspector-totem/tests/web-client.test.ts` — new B3 describe block (4 tests); 1 stale assertion modernized.

## Visual QA (browse skill, preview :4711, killed after)

- `/Users/emilionunezgarcia/Developer/the-mountain-lanes/qa-baseline-20260722/b3-after-1440-inspector.png` — 1440×900, Codex · LaHormigaDormida drawer open. Order: verdict head (top 221–302) → control banner → `Next` (375–394) → **filled vitals band** (410–504: CONTEXT ring 31% `81k /258k`, SESSION TOKENS `828k` + 97% cache-hit meter, UPTIME `4m`) → drawer-shelf (520–744) → lineage → dock. Head, next-action, and the filled band are all visible inside the 900px window without scrolling. Zero console errors.
- `/Users/emilionunezgarcia/Developer/the-mountain-lanes/qa-baseline-20260722/b3-after-375-inspector.png` — 375×812 full-surface sheet. Band wraps gracefully to two rows (Context + Session tokens, then Uptime), `documentElement.scrollWidth === clientWidth` (375/375, no horizontal scroll).
- Evidence shelf opened live: `.shelf-evidence` contains **0** `.vitals`/`.vital` tiles, and holds `session cwd`, `control link` (routing), `Artifacts`, `Transcript tail` — paths/routing/transcript intact, WITHOUT the vitals band. (`latest call` / `session total` remain as Evidence's own Learn-style detail-grid rows — separate from the moved instrument tiles.)
- No console errors after interaction; preview process on :4711 killed (prod :4701 and other worktrees' previews untouched).

## Self-review

- **Mount filled:** `.inspector-vitals` holds the `.vitals` band under the head (verified in the live DOM and both screenshots).
- **Evidence de-vitaled:** `renderEvidenceShelf` builds no vitals; live DOM confirms 0 tiles in the opened shelf.
- **Fallbacks byte-identical:** the `renderVitals` body is unchanged, so `"not reported"`, the observed-token absolute fallback, and the estimated/observed marks are exactly as before; a test pins `"not reported"`. Never renders an invented number.
- **`vital-big mono` convention preserved:** unchanged tile markup; test (a) asserts a value node carrying both classes.
- **No head/banner/dock disturbance:** `git diff` touches none of `renderControlBanner`, `renderStatusLine`, the verdict head, `renderCommandDock`, `workStateBanner`, or `impactBlock`. B2's order test (`head → banner → next → vitals mount → shelf → lineage → dock`) stays green.
- **CSP / motion:** the context meter stays an SVG-attribute ring (no inline style, tone by class); no animation was added or moved, so the existing `prefers-reduced-motion` guard's coverage is unchanged.
- **No feature flags; tests green, none skipped.** Every changed line traces to the brief; diff reviewed hunk-by-hunk; `git diff --check` clean; no secrets.

## Concerns

- **`.inspector-vitals { min-width: 0; }`** is the one CSS rule beyond the doc comment. It is a defensive, position-driven guard (well-behaved flex item so the wrapping tile row shrinks rather than forcing overflow), not a visual change — the band renders identically with or without it. Flagged for transparency; harmless to keep or drop.
- The band's honest treatment of fully-unreported vitals is **omit-empty (null)**, not a visible `"not reported"` string — that string is `tokenSummary`'s output for row/detail surfaces and is gated out of the band by the existing `if (tok.known)`. This matches the pre-existing code exactly; the band never fabricates a number.
