# Evidence column exhibits — design spec

**Date:** 2026-08-12
**Status:** Ready for implementation. Visual contract approved in the Evidence mockup.
**Implementation plan:** `docs/superpowers/plans/2026-08-12-evidence-column-exhibits-grok46.md`
**Implementation model:** Cursor Grok 4.6 Extra Extra High Fast
**Authoritative visual:** `docs/rhs-shots/evidence-dossier/mockup.html` + `mockup-delta.css` + `marks/`
**Visual chrome spec:** `docs/superpowers/specs/2026-08-12-evidence-column-instrument-plates-design.md` (instrument plates, flat desk, copy law). That spec wins on chrome. This spec wins on exhibit set, omit-empty, and copy.
**Adversarial review:** `docs/rhs-shots/evidence-dossier/REPORT.md` (field inventory). This spec wins where they disagree.
**Not the target:** specimen-sheet files (`desktop.html`, `state-*.html`, `dossier.css`). Those are the earlier parallel look.

## Goal

Rebuild the open-drawer Evidence column (`renderEvidence` + desk chrome) so it matches the implementation mock: omit-empty exhibits, 16px inline product marks, 14.5px UI titles, no fake Verify, no Output exhibit, no stroke icons in section heads.

Conversation stays the messenger. Header keeps Status / Run / Context / Session. Dock keeps Ready · linked, Focus, Interrupt, Archive. Lineage stays the spine under Evidence. Evidence does not repeat any of those.

## Icon law

Two jobs, two families. Never mixed in one control.

| Job | Family | Size | Where |
|---|---|---|---|
| Nouns | Official or filled product SVG (`<img>`) | 16px inline, no tile, no rail, no border | Exhibit heads, harness/agent marks (already shipped) |
| Verbs | Live stroke `ICON_PATHS` via `icon()` | ~14px, `currentColor` | Focus, Interrupt, Archive, copy, close, more, Route ↗, Lineage `git-merge` |

Section heads must not use `data-ico` / `icon()`. Dock buttons must not use filled product marks.

Marks to ship under `src/web/icons/` (served as `/icons/…`, same as harness logos). Copy from `docs/rhs-shots/evidence-dossier/marks/`:

| File | Exhibit |
|---|---|
| `git.svg` | Git (official Git SCM, fill `#F05032`) |
| `github.svg` | Pull request (official GitHub, fill `#181717`) |
| `folder.svg` | Workspace |
| `route.svg` | Route |
| `history.svg` | History |

Do not add `verify.svg` or `clip.svg`. Dirty Git is the same `git.svg` plus an 8px amber pip (`::after` on the 16px wrap). Git has no official dirty logo.

## Exhibit set

Order, top to bottom. Omit any exhibit with zero rows. Empty desk: one `inspector-note`, “No evidence fields reported for this session.”

```text
Workspace
  cwd (and repo / launch / shell only when they add information)
  in-tree files (non-transcript artifacts, path relative to cwd, copy)
  CWD-COPY-1 note when cwdRelation === "different"
  specialty, succeededBy, supersedes when present
Git                         omit when git.branch and git.head are both absent
Pull request                omit when pullRequestUrls is empty
Route                       see visibility rules
History                     retained / operator-archive / exceptional endEvidence only
Lineage spine               unchanged owner, not an exhibit
```

`data-evidence-section` values (what `evidenceInventory` reads back): `workspace` | `git` | `pr` | `route` | `history`.

### Workspace

- Title “Workspace” + `folder.svg`.
- Always show `cwd` as `<code>` when non-empty.
- When `cwd === repo.worktreePath`, do **not** print a second Repository row and do **not** print a `folder = repo` badge.
- Repository row only when the repo label exists and the paths differ. Labels locked by CWD-COPY-1: “Workspace”, “Repository”, “Launch folder”, “Terminal shell folder”.
- Launch folder only when `launchCwd` is present and `!== cwd`.
- Terminal shell folder only when `target.surfaceCwd` is present and `!== cwd`.
- CWD-COPY-1 sentence, verbatim, only when `target.cwdRelation === "different"`:

  > Claude’s tool session and the terminal shell maintain separate working directories. This does not change the exact cmux link.

  Never “mismatch”, never “≠”, never “Linked for Focus and Send.”
- In-tree files: `artifacts[]` where `kind !== "transcript"` and the path is not the Conversation foot transcript path. Label + path relative to cwd (strip `cwd + "/"` when the path is under cwd; never reprint the absolute workspace prefix) + stroke copy button. Omit the list when nothing remains. Transcript stays in `.chat-feed-foot`.
- `specialty`, `succeededBy`, `supersedes`: omit-empty rows here when present. Do not invent a Verify exhibit for them.

### Git

- Title “Git” + official `git.svg`.
- Body: branch `<code>` + `@` + first 7 of `head` when present.
- Omit the whole exhibit when there is no `git` object or both `branch` and `head` are empty. Never “— no git”. Never ⚪/🟡/🟢. Never `git-none`.
- Dirty: class `git-dirty` on the 16px wrap, amber pip, `title="Uncommitted changes"`. Clean: `title="Clean working tree"`. No “● uncommitted” / “● clean” text.

### Pull request

- Title “Pull request” + official `github.svg`.
- One card per `agent.pullRequestUrls[]` entry: short label (PR title if we have one; otherwise the URL tail) + `<a class="artifact-path">` + stroke copy. Omit the exhibit when the array is empty. Never “0 PRs”.
- Roster group PRs on the left board stay. This exhibit is the session array.

### Route

Information, not a status chip alone. Banner owns the lock sentence and must not contain raw cmux/tty/session IDs. Evidence owns the trail.

**Visibility**

- Mount when `target.resolution` is `exact`, `unique-cwd`, or `ambiguous`, or when a control banner is showing for this session, or when a hydrated trace has any non-skipped step / reason / bridge.
- Omit when resolution is `missing` and there is no banner and no hydrated trail (honest empty).
- Never return null for a quarantined session just because `identityTrace` is missing from the SSE payload (V11).

**Head:** `route.svg` + “Route” + chip + stroke ↗ (`identity-expand`, same load as today’s identity button).

Chip:

| `target.resolution` | Chip text | Chip class |
|---|---|---|
| `exact` | Exact | `route-chip--exact` |
| `unique-cwd` | Unique folder | default (not moss — Send is unproven) |
| `ambiguous` | Quarantined | `route-chip--lock` |

Do not print “Bound by … · exact match” / “Not bound · ambiguous” as a paragraph. The chip replaces that.

**Bind rows** (`.route-bind`): one card per identity tier whose outcome is **not** `skipped`. Omit skipped cwd when session ID already matched. Working folder is a routing key, not the Workspace path — only show it when that tier decided something (`unique-cwd`, `ambiguous`, `quarantined`, `no-match`, `rejected`).

Kickers: “Session ID”, “Working folder”, “Recorded target” using `IDENTITY_TIER_LABELS` mapped to those short kickers. Detail text stays the resolver’s `step.detail`.

Remembered binding note stays when `bindingBridge` is present. Do not paint remembered attestation as moss “linked”.

**Hydration (required):** `identityTrace` is a non-enumerable lazy getter. `JSON.stringify` omits it. SSE never hydrates it. `renderIdentityBlock` today reads a missing field and returns null.

- Do **not** enumerate the getter onto the snapshot fingerprint.
- When `state.identity.agentId === agent.id` and `state.identity.data.agent.trace` exists, use that trace.
- ↗ still calls `loadIdentityEvidence` (`GET /api/debug/identity?agent=`). After load, paint tty collision lines and `commandHints` (currently fetched, never painted).
- Error copy stays: “Terminal evidence unavailable: {error}” + Retry. Never “no conflicts found” on failure.
- Empty after load: “No cmux terminal reports evidence for this session.”

Banner “See routing evidence →” scrolls to `.identity-block` / `[data-evidence-section="route"]` and expands ↗.

### History

- Title “History” + `history.svg`.
- Only when `scope==="retained"` or `provenance` in `{process-died, operator-archive}` or `endEvidence` in `{worktree-deleted, superseded, turn-complete}`.
- One sentence from existing `historyProvenance`. Omit on live rows. Do not print `recency` on every session.

### Verify — cut

`AgentSnapshot.tests` is typed and never assigned in `src/server/`. Do not paint a Verify exhibit. Do not paint “Tests not reported.” Do not paint a green pass. Do not read `agent.tests`.

## Section headers

Kill the sticky desk title “Evidence” (`drawer-section-head` in `renderAgentDrawer`). The first exhibit head is the start of the column.

Each exhibit is a plate: nameplate head, then readout body. Head chrome:

```text
[16px img] [h3 14.5px UI face, sentence case, no hairline] [optional chip] [optional ↗]
```

Do not restyle roster `.section-title`. Scope type overrides to `.drawer-desk .exhibit-head .section-title`.

CSS lives in `src/web/styles.css`, ported from `docs/rhs-shots/evidence-dossier/mockup-delta.css`. No new `:root` tokens. No 28px tiles, no inset color rails on marks. Desk fill stays flat (no gradient, no desk shadow). Plate chrome, copy law, and readout wells are specified in the visual chrome spec.

## Ownership — do not repeat

| Fact | Owner |
|---|---|
| Context %, session tokens, model short, “Terminal: {title}” | Header `drawer-session-facts` |
| Ready · linked, Focus, Interrupt, Archive | Command dock |
| Message prose, transcript path | Conversation + `.chat-feed-foot` |
| Parent / child | Lineage spine |
| Lock sentence, no raw IDs | Control banner |
| cwd / git / in-tree files / session PRs / routing trail | Evidence |

## Settled product calls

Do not re-open these.

1. **Tests collector** — cut. No Verify exhibit until a collector assigns `AgentSnapshot.tests`.
2. **identityTrace transport** — hydrate from `/api/debug/identity` only. Do not put the getter on the SSE fingerprint.
3. **Succession** — omit-empty rows under Workspace when `succeededBy` / `supersedes` are present. Do not extend Lineage.
4. **Sticky Evidence head** — delete it. If `--drawer-vitals-h` is only used to offset that head, delete the token and `.drawer-section-head { top: var(--drawer-vitals-h) }`.
5. **Desk chrome** — flat sand/slate well + 2px ink rail. No cool gradient. No shadow on `.drawer-desk`. Plates may lift; the desk may not.
6. **Copy** — in-tree files display relative to cwd and copy the absolute filesystem path. Workspace / Repository / Launch / Shell aria-labels stay CWD-COPY-1 (`Copy {label} path`).

## Out of scope

- Header facts, Conversation bubbles, command dock tools, Lineage spine visuals.
- Backend collectors, publishing `tests`, enumerating `identityTrace` on SSE.
- Specimen-sheet restyle (`desktop.html` / `dossier.css`).
- Push, PR, merge, deploy.
