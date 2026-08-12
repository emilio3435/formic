# Evidence column instrument plates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the open Evidence column match the approved mock: instrument plates (nameplate + inset readout) on a flat desk, always-visible copy chips, relative display / absolute copy for in-tree files.

**Architecture:** Keep the omit-empty exhibit renderer from `0ad112f`. Add `exhibitShell` so every exhibit is `.exhibit-head` + `.exhibit-body`. Put primary values in `.exhibit-readout`. Port `mockup-delta.css` into `src/web/styles.css` with UI 600 / mono 500 and **no** desk gradient or desk shadow.

**Tech Stack:** Vanilla `src/web/app.js` + `src/web/styles.css`, Bun tests in `tests/web-client.test.ts` and `tests/formic-typography-weights.test.ts`.

## Global Constraints

- Parent product spec: `docs/superpowers/specs/2026-08-12-evidence-column-exhibits.md` (exhibit set, omit-empty, icon law, CWD-COPY-1, Route hydration). Do not reopen those.
- Visual spec: `docs/superpowers/specs/2026-08-12-evidence-column-instrument-plates-design.md`
- Visual SoT: `docs/rhs-shots/evidence-dossier/mockup.html` + `mockup-delta.css` + `marks/`
- Implementation worktree: `/private/tmp/formic-evidence-column-exhibits` on `feat/evidence-column-exhibits`, based on `0ad112f` (`feat(web): rebuild Evidence as omit-empty exhibits`). Do not create a new worktree from `origin/main`.
- Design worktree `/private/tmp/formic-evidence-ux` is the mock source. Copy mockup files from there if the implementation tree is behind.
- Shared checkout `/Users/emilionunezgarcia/Developer/the-mountain-main` is dirty context only. Do not edit it.
- Do not restart production `:4701`.
- Product CSS: UI weights 400/500/600, mono 400/500. Remap mock `font: 700` → UI 600 / mono 500.
- CWD-COPY-1 aria-label for cwd copy stays `Copy Workspace path`. File copy is `Copy full path`.
- Publication: local commit only. No push, PR, merge, or deploy.
- Subagents use `model: inherit`. Do not route to Opus, Sonnet, Fable, Sol, or Luna.

---

## File structure

| File | Responsibility |
|---|---|
| `tests/web-client.test.ts` | Visual-contract assertions (plates, copy, desk CSS, git-rev) |
| `src/web/app.js` | `exhibitShell`, `absoluteArtifactPath`, readout classes, copy labels |
| `src/web/styles.css` | Evidence delta: flat desk, plates, readouts, always-on copy |
| `docs/rhs-shots/evidence-dossier/mockup-delta.css` | Same delta as product, weights already remapped |
| `docs/rhs-shots/evidence-dossier/mockup.html` | Static SoT; keep in sync with product DOM classes |

No new modules. No backend files. No `src/server/` edits.

---

### Task 1: Red tests for the approved chrome

**Files:**
- Modify: `tests/web-client.test.ts` (inside `describe("Evidence column exhibits")`)
- Test: `tests/web-client.test.ts`
- Test: `tests/formic-typography-weights.test.ts` (run only; do not weaken)

**Interfaces:**
- Consumes: `M.renderEvidence`, existing `agent()`, `withDom()`, `byEvidenceSection()`, `byClass()`, `allByClass()`, `textOf()`, `findAll()`, `styles` from `beforeAll`
- Produces: failing assertions against `0ad112f` (no `exhibit-body`, no `exhibit-readout`, no `git-rev`, no `dataset.fullPath`, desk may still be unplated)

- [ ] **Step 1: Write the failing tests**

In `describe("Evidence column exhibits")`, keep the existing omit-empty / relative-path tests. Add the lone-cwd test **before** `in-tree files under cwd render the relative suffix only`. Extend that in-tree test with the copy assertions. Then add the chrome tests.

```ts
  test("a lone cwd is the Workspace value, not a second Workspace label", () => {
    const evidence = withDom(() => M.renderEvidence(agent({ cwd: "/repos/session" })));
    const workspace = byEvidenceSection(evidence, "workspace");
    expect(byClass(workspace, "detail-grid")).toBeNull();
    expect(byClass(workspace, "evidence-value")).not.toBeNull();
    expect(byClass(workspace, "exhibit-body")).not.toBeNull();
    expect(byClass(workspace, "exhibit-readout")).not.toBeNull();
    expect(textOf(workspace)).toContain("/repos/session");
    expect(findAll(workspace, (node: any) => node.tagName === "dt")).toHaveLength(0);
    const copy = allByClass(workspace, "artifact-copy")[0];
    expect(copy.attributes["aria-label"]).toBe("Copy Workspace path");
    expect(copy.dataset.fullPath).toBe("/repos/session");
  });
```

Replace the in-tree file test body so the visible path stays relative and the copy button holds the absolute path:

```ts
  test("in-tree files under cwd render the relative suffix only", () => {
    const evidence = withDom(() => M.renderEvidence(agent({
      cwd: "/repos/session",
      artifacts: [{ kind: "file", label: "Report", path: "/repos/session/docs/REPORT.md" }],
    })));
    const text = textOf(evidence);
    expect(text).toContain("docs/REPORT.md");
    expect(text).not.toContain("/repos/session/docs/REPORT.md");
    expect(byClass(evidence, "artifact-label") && textOf(byClass(evidence, "artifact-label"))).toBe("Report");
    const copy = allByClass(evidence, "artifact-copy").find((node: any) =>
      String(node.attributes?.["aria-label"] || "").includes("full path"));
    expect(copy).toBeTruthy();
    expect(copy.attributes["aria-label"]).toBe("Copy full path");
    expect(copy.dataset.fullPath).toBe("/repos/session/docs/REPORT.md");
    expect(copy.dataset.fkey).toContain("/repos/session/docs/REPORT.md");
  });
```

Add these new tests in the same describe:

```ts
  test("Git paints the short hash as git-rev inside a readout", () => {
    const evidence = withDom(() => M.renderEvidence(agent({
      cwd: "/repos/session",
      git: { branch: "feat/x", head: "abcdef123456", dirty: false },
    })));
    const git = byEvidenceSection(evidence, "git");
    expect(byClass(git, "exhibit-body")).not.toBeNull();
    expect(byClass(git, "exhibit-readout")).not.toBeNull();
    const rev = byClass(git, "git-rev");
    expect(rev).not.toBeNull();
    expect(textOf(rev)).toBe("@abcdef1");
  });

  test("desk CSS stays flat and plates lift", () => {
    const deskBlocks = [...styles.matchAll(/\.drawer-desk\s*\{([^}]*)\}/g)].map((m) => m[1]);
    expect(deskBlocks.join("\n")).not.toMatch(/linear-gradient/);
    for (const body of deskBlocks) {
      const shadows = [...body.matchAll(/box-shadow\s*:\s*([^;]+)/g)].map((m) => m[1].trim());
      for (const shadow of shadows) {
        expect(shadow === "none" || shadow.startsWith("none")).toBe(true);
      }
    }
    expect(styles).toMatch(/\.drawer-desk\s+\.exhibit\s*\{[^}]*box-shadow/);
    expect(styles).toMatch(/\.exhibit-readout\s*\{[^}]*inset/);
    expect(styles).not.toMatch(/\.artifact-copy\s*\{[^}]*opacity\s*:\s*0/);
    expect(styles).not.toMatch(/\.artifact-copy\s*\{[^}]*visibility\s*:\s*hidden/);
  });

  test("exhibit chrome classes are emitted by the client", () => {
    expect(source).toContain('class: "exhibit-body"');
    expect(source).toContain("exhibit-readout");
    expect(source).toContain('class: "git-rev"');
    expect(source).toContain("is-copied");
  });
```

- [ ] **Step 2: Run the new tests against current `app.js` and confirm they fail on `0ad112f`**

If the working tree already has uncommitted plate work, stash or compare against `0ad112f` first:

```bash
cd /private/tmp/formic-evidence-column-exhibits
git rev-parse --short HEAD
# expected: 0ad112f (or a later local commit — do not reset)

bun test tests/web-client.test.ts -t "lone cwd|relative suffix|git-rev|desk CSS stays flat|exhibit chrome classes"
```

Expected on a clean `0ad112f` tree: FAIL — `exhibit-body` / `exhibit-readout` / `git-rev` missing, `dataset.fullPath` undefined, copy aria-label still `Copy path`.

If those tests already PASS because the plate work is in the working tree, do not delete the tests. Continue; Task 2–3 become “make CSS/JS match the spec,” not a from-scratch rewrite.

- [ ] **Step 3: Commit the tests if they are red on HEAD**

Only if `git status` shows the test file dirty and HEAD is still `0ad112f` without the assertions:

```bash
git add tests/web-client.test.ts
git commit -m "$(cat <<'EOF'
test(web): lock Evidence plates, flat desk, and full-path copy

EOF
)"
```

If the tests were added in the same uncommitted plate diff, skip this commit and land tests + implementation together in Task 5.

---

### Task 2: Port plate CSS — flat desk, lifting plates

**Files:**
- Modify: `src/web/styles.css` (Evidence delta at end of file, after the Formic dashboard semantic pass)
- Modify: `docs/rhs-shots/evidence-dossier/mockup-delta.css`
- Test: `tests/formic-typography-weights.test.ts`
- Test: `tests/web-client.test.ts` (`desk CSS stays flat`)

**Interfaces:**
- Consumes: existing `.drawer-desk` layout rules (sand/slate 4% fill, `box-shadow: none` in the container query)
- Produces: nameplate / readout / copy / git-rev / dashed empty well; desk delta is **only** the 2px ink rail

- [ ] **Step 1: Replace the Evidence delta in `mockup-delta.css`**

The whole file is the delta. Desk rule must be exactly:

```css
.drawer-desk {
  border-left: 2px solid var(--ink);
}
```

No `linear-gradient`. No `box-shadow` on that rule.

Remap weights in this file so the mock matches product:

- `.drawer-desk .exhibit-head .section-title` → `font: 600 14.5px/1.15 var(--font-ui);`
- `.artifact-label` → `font: 600 13.5px/1.25 var(--font-ui);`
- `.route-chip` → `font: 500 10px/1 var(--font-mono);`
- `.route-bind-kicker` → `font: 500 10.5px/1.2 var(--font-mono);`

Keep the plate, readout, copy, git-rev, dashed empty, and juice rules from the approved mock. Canonical block (this is what ships):

```css
.drawer-desk {
  border-left: 2px solid var(--ink);
}
.drawer-desk:not(:has(.drawer-evidence-body)) {
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 0.7rem;
}
.drawer-desk .drawer-evidence-body {
  display: flex;
  flex-direction: column;
  gap: 0.7rem;
  padding: 12px;
}

.drawer-desk .exhibit {
  display: flex;
  flex-direction: column;
  padding: 0;
  overflow: hidden;
  border: 1px solid color-mix(in srgb, var(--slate) 22%, var(--line));
  border-radius: 8px;
  background: var(--raise);
  box-shadow:
    inset 0 1px 0 color-mix(in srgb, white 72%, transparent),
    0 10px 22px color-mix(in srgb, var(--ink) 8%, transparent);
}
.drawer-desk .exhibit-head {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  margin: 0;
  padding: 9px 12px;
  min-width: 0;
  background: color-mix(in srgb, var(--slate) 7%, var(--raise));
  border-bottom: 1px solid var(--line);
}
.drawer-desk .exhibit-body {
  display: flex;
  flex-direction: column;
  gap: 0.55rem;
  padding: 10px 12px 12px;
}
.drawer-desk .exhibit-readout {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  min-width: 0;
  padding: 0.55rem 0.5rem 0.55rem 0.7rem;
  border-radius: 6px;
  background: color-mix(in srgb, var(--slate) 8%, var(--sand));
  box-shadow: inset 0 1px 2px color-mix(in srgb, var(--ink) 12%, transparent);
}
.drawer-desk .exhibit-readout.detail-grid {
  display: grid;
  padding: 0.55rem 0.7rem;
}
.drawer-desk .exhibit-head .section-title {
  margin: 0;
  flex: 1;
  min-width: 0;
  font: 600 14.5px/1.15 var(--font-ui);
  letter-spacing: -0.02em;
  text-transform: none;
  color: var(--ink);
  border: 0;
  padding: 0;
  gap: 0;
}
.drawer-desk .git-line .git-rev {
  color: var(--faint-strong);
  font-size: 11.5px;
}
.drawer-desk .inspector-note {
  margin: 0;
  padding: 1rem 0.85rem;
  border: 1px dashed var(--line-strong);
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--muted);
  font-size: 13px;
}
.drawer-desk .artifact-copy {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
  grid-column: 2;
  grid-row: 1 / span 2;
  width: 28px;
  min-width: 28px;
  min-height: 28px;
  padding: 0;
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  background: var(--raise);
  color: var(--muted);
  cursor: pointer;
}
```

Do not add `opacity: 0` on `.artifact-copy`. Copy is always visible.

Preserve the rest of the approved delta (marks, dirty pip, artifact cards, route chip/bind, directory-relation-note slate rail, `is-copied`, reduced-motion). If the current file still has the cool desk gradient, delete those two declarations (`background: linear-gradient(...)` and the desk `box-shadow`).

- [ ] **Step 2: Mirror that delta into `src/web/styles.css`**

Replace the existing Evidence delta at the bottom of `src/web/styles.css` (the block that begins around `.inspector-panel > .identity-block` / `/* Desk is the instrument well`) with the same rules. Do not duplicate `.drawer-desk` layout (overflow, grid column, sand/slate 4% fill). Those stay in the earlier drawer-grid rules.

Grep after the edit:

```bash
rg -n "linear-gradient" src/web/styles.css docs/rhs-shots/evidence-dossier/mockup-delta.css
rg -n "font: 700" src/web/styles.css docs/rhs-shots/evidence-dossier/mockup-delta.css
```

Expected: no `linear-gradient` under `.drawer-desk`. No `font: 700` in the Evidence delta. (Unrelated display-face 700/800 elsewhere in `styles.css` may remain.)

- [ ] **Step 3: Run typography + desk CSS tests**

```bash
bun test tests/formic-typography-weights.test.ts tests/web-client.test.ts -t "desk CSS stays flat|shipped font"
```

Expected: PASS on weights and desk flatness. `exhibit chrome classes` / `git-rev` may still fail until Task 3.

---

### Task 3: Emit plate DOM and full-path copy

**Files:**
- Modify: `src/web/app.js` (`exhibitHead` through `renderEvidence`)
- Test: `tests/web-client.test.ts`

**Interfaces:**
- Consumes: `exhibitHead({ mark, title, section, extra, markClass, markTitle })` already on `0ad112f`
- Produces: `exhibitShell(...)` → `{ wrap, body }`; `absoluteArtifactPath(cwd, path, shown)`; values live in `.exhibit-body` with `.exhibit-readout` where the spec requires it

- [ ] **Step 1: Add `exhibitShell` and `absoluteArtifactPath` immediately after `exhibitHead`**

```js
function exhibitShell({ mark, title, section, extra, markClass, markTitle, wrapClass }) {
  const wrap = el("div", { class: wrapClass || "exhibit" });
  wrap.dataset.evidenceSection = section;
  wrap.append(exhibitHead({ mark, title, section, extra, markClass, markTitle }));
  const body = el("div", { class: "exhibit-body" });
  wrap.append(body);
  return { wrap, body };
}

function absoluteArtifactPath(cwd, path, shown) {
  const raw = typeof path === "string" ? path.trim() : "";
  if (/^https?:\/\//i.test(raw)) return raw;
  if (raw.startsWith("/")) return raw;
  const root = typeof cwd === "string" ? cwd.replace(/\/+$/, "") : "";
  const rel = String(shown || raw).replace(/^\/+/, "");
  if (root && rel) return root + "/" + rel;
  return raw || shown || "";
}
```

- [ ] **Step 2: Rebuild Workspace around path-as-value**

Replace the `0ad112f` pattern (always `dtdd(grid, "Workspace", ...)`) with:

```js
  const { wrap, body } = exhibitShell({ mark: EXHIBIT_MARK.workspace, title: "Workspace", section: "workspace" });

  const extras = [];
  if (showRepo) extras.push(["Repository", pathValue(agent, repoName || repoPath, "Repository")]);
  if (showLaunch) extras.push(["Launch folder", pathValue(agent, launchCwd, "Launch folder")]);
  if (showShell) extras.push(["Terminal shell folder", pathValue(agent, surfaceCwd, "Terminal shell folder")]);
  if (specialty) extras.push(["specialty", specialty]);
  if (succeededBy) extras.push(["succeeded by", succeededBy]);
  if (supersedes) extras.push(["supersedes", supersedes]);

  if (extras.length) {
    const grid = el("dl", { class: "detail-grid exhibit-readout" });
    if (cwd) dtdd(grid, "Workspace", pathValue(agent, cwd, "Workspace"));
    for (const [label, value] of extras) dtdd(grid, label, value);
    body.append(grid);
  } else if (cwd) {
    body.append(el("p", { class: "evidence-value exhibit-readout" },
      el("code", { title: cwd, text: cwd }),
      el("button", {
        type: "button",
        class: "artifact-copy evidence-path-copy",
        title: "Copy full path",
        "aria-label": "Copy Workspace path",
        dataset: { fkey: `copy-path:${agent.id}:Workspace`, fullPath: cwd },
        onclick: () => copyText(cwd),
      }, icon("copy"))));
  }

  if (cwdNote) {
    body.append(el("p", {
      class: "directory-relation-note",
      text: "Claude’s tool session and the terminal shell maintain separate working directories. This does not change the exact cmux link.",
    }));
  }

  if (files.length) {
    body.append(el("ul", { class: "artifact-list" },
      files.map((item) => {
        const shown = relativeArtifactPath(cwd, item.path, item.label);
        const copyValue = absoluteArtifactPath(cwd, item.path, shown);
        return el("li", {},
          el("span", { class: "artifact-label", text: item.label || shown }),
          el("span", { class: "artifact-path", title: copyValue, text: shown }),
          el("button", {
            type: "button",
            class: "artifact-copy",
            title: "Copy full path",
            "aria-label": "Copy full path",
            dataset: { fkey: `copy:${agent.id}:${copyValue}`, fullPath: copyValue },
            onclick: () => copyText(copyValue),
          }, icon("copy")));
      })));
  }
  return wrap;
```

Keep `pathValue` for extra directory rows. Its aria-label stays `Copy {label} path`.

- [ ] **Step 3: Route Git, PR, History, and Route through `exhibitShell`**

Git:

```js
  const { wrap, body } = exhibitShell({
    mark: EXHIBIT_MARK.git,
    title: "Git",
    section: "git",
    markClass: dirty ? "git-dirty" : "",
    markTitle: dirty ? "Uncommitted changes" : "Clean working tree",
  });
  body.append(el("span", { class: "git-line exhibit-readout" },
    git.branch ? el("code", { text: git.branch }) : null,
    git.head ? el("code", { class: "git-rev", text: "@" + String(git.head).slice(0, 7) }) : null));
```

Pull request: `exhibitShell` then `body.append(el("ul", { class: "artifact-list" }, ...))`. Add `dataset.fullPath: url` on the copy button. Label stays `Copy URL`.

History:

```js
  const { wrap, body } = exhibitShell({ mark: EXHIBIT_MARK.history, title: "History", section: "history" });
  body.append(el("p", { class: "evidence-value exhibit-readout", text: sentence }));
```

Route: `exhibitShell({ ..., extra: [chip, expand], wrapClass: "identity-block exhibit" })`. Append bind rows, bridge note, and surfaces to `body`, not `wrap`.

`renderEvidence` panel class stays `inspector-panel` (drop `evidence-inspector-panel` if it is still there — that class is not in the mock).

Add a button-local copied mark so `.artifact-copy.is-copied` is emitted by the client (required by the class-emission test). Do not put this inside `copyText` — that helper has no element.

```js
function markCopied(btn) {
  if (!btn || !btn.classList) return;
  btn.classList.add("is-copied");
  setTimeout(() => btn.classList.remove("is-copied"), 900);
}
```

On each exhibit copy `onclick`:

```js
onclick: (event) => {
  void copyText(copyValue);
  markCopied(event && event.currentTarget);
}
```

Use the same wrapper for Workspace cwd, extra `pathValue` rows, files, and PR URLs. `pathValue` currently calls `copyText(value)` only — update it too.

- [ ] **Step 4: Run the Evidence exhibit tests**

```bash
bun test tests/web-client.test.ts -t "Evidence column exhibits|CWD-COPY-1"
```

Expected: PASS. CWD-COPY-1 still contains the verbatim sentence and `Copy Workspace path`. Lone cwd has no `dt`. File copy `dataset.fullPath` is `/repos/session/docs/REPORT.md`.

---

### Task 4: Defeat-check

**Files:**
- Modify: `src/web/app.js` and `src/web/styles.css` only as temporary saboteurs, then restore

**Interfaces:**
- Consumes: the tests from Task 1
- Produces: proof the new assertions fail on the old mistakes

- [ ] **Step 1: Prove the desk-gradient test is live**

Temporarily add to the delta `.drawer-desk` rule:

```css
background: linear-gradient(180deg, red, blue);
```

Run:

```bash
bun test tests/web-client.test.ts -t "desk CSS stays flat"
```

Expected: FAIL on `linear-gradient`. Revert the sabotage.

- [ ] **Step 2: Prove path-as-value is live**

Temporarily always wrap cwd in `dtdd(grid, "Workspace", ...)`. Run:

```bash
bun test tests/web-client.test.ts -t "lone cwd"
```

Expected: FAIL (`detail-grid` not null / `dt` length > 0). Restore `exhibitShell` path-as-value.

- [ ] **Step 3: Prove full-path copy is live**

Temporarily set file copy `dataset.fullPath` to `shown` (relative). Run:

```bash
bun test tests/web-client.test.ts -t "relative suffix"
```

Expected: FAIL (`fullPath` !== `/repos/session/docs/REPORT.md`). Restore `absoluteArtifactPath`.

Keep only the real implementation in the final diff.

---

### Task 5: Verify, review, local commit

**Files:**
- All files in the fence above, plus the spec/plan docs if they are not on the branch yet

- [ ] **Step 1: Run the verification matrix**

```bash
cd /private/tmp/formic-evidence-column-exhibits
bun run typecheck
bun test tests/web-client.test.ts tests/cwd-adversarial-browser.test.ts tests/formic-reskin.test.ts tests/formic-typography-weights.test.ts tests/overhaul-guards.test.ts
bun test
git diff --check
git status --short
```

Expected: typecheck clean, focused suites green, full `bun test` green, no new skips.

- [ ] **Step 2: Diff review against the visual spec**

Confirm the diff:

- does not add `linear-gradient` or a desk `box-shadow`
- does not use UI/mono `font: 700` in the Evidence delta
- does not edit `src/server/`, dock, Lineage, or header
- does not restart or mention `:4701` as a required step
- copy chips have no `opacity: 0`
- `mockup.html` Evidence review copy `data-full-path` is the absolute REPORT.md path; visible text stays `docs/rhs-shots/evidence-dossier/REPORT.md`

- [ ] **Step 3: Commit locally**

```bash
git add \
  src/web/app.js \
  src/web/styles.css \
  tests/web-client.test.ts \
  docs/rhs-shots/evidence-dossier/mockup.html \
  docs/rhs-shots/evidence-dossier/mockup-delta.css \
  docs/superpowers/specs/2026-08-12-evidence-column-exhibits.md \
  docs/superpowers/specs/2026-08-12-evidence-column-instrument-plates-design.md \
  docs/superpowers/plans/2026-08-12-evidence-column-instrument-plates-grok46.md
git commit -m "$(cat <<'EOF'
feat(web): plate Evidence on a flat desk

Nameplates and inset readouts lift; the desk stays a sand well with an ink rail.
In-tree files still show cwd-relative paths and now copy the absolute path.
EOF
)"
```

Do not `git push`. Do not open a PR.

- [ ] **Step 4: Report**

Stop and report:

- branch and commit SHA
- changed files
- focused and full-suite counts
- `READY_FOR_PUBLICATION_REVIEW` or a concrete blocker

---

## Testing matrix

| Layer | Test | Required proof |
|---|---|---|
| Path-as-value | `lone cwd is the Workspace value` | no `dt`, `.exhibit-readout` present, `Copy Workspace path` |
| Relative display / absolute copy | `in-tree files under cwd render the relative suffix only` | visible `docs/REPORT.md`; `dataset.fullPath` absolute |
| Git | `Git paints the short hash as git-rev` | `.git-rev` text `@` + 7 |
| Desk | `desk CSS stays flat and plates lift` | no desk gradient; no desk shadow; plate `box-shadow`; copy not hidden |
| Class emission | `exhibit chrome classes are emitted` + existing “(8) every class…” | `exhibit-body`, `exhibit-readout`, `git-rev` in JS |
| CWD-COPY-1 | existing verbatim test | sentence + locked labels unchanged |
| Typography | `tests/formic-typography-weights.test.ts` | no UI 700 / mono 700 in exhibit rules |
| Regression | `bun test` | full suite green, no new skips |

## Preserved behavior

- Omit-empty Workspace / Git / PR / Route / History order
- Sticky Evidence head stays gone
- Route hydration from debug `agent.trace`
- Header, chat, dock, Lineage
- Desktop 65/35 grid and ≤860px stacked sheet
- Production `:4701` left running

## Out of scope

- Verify / `agent.tests`
- Enumerating `identityTrace` on SSE
- Specimen sheets
- Push / PR / merge / deploy

## Rollback

Revert the instrument-plates commit. Evidence returns to the `0ad112f` exhibits (cards without nameplate/readout split, copy-path labels, no `git-rev`). No migration.

## Handoff checklist

- [ ] Read both specs. Open `mockup.html` before editing `app.js`.
- [ ] Stay in `/private/tmp/formic-evidence-column-exhibits`. Do not touch `:4701`.
- [ ] Red tests first (or keep them if already present).
- [ ] Desk = ink rail only. Plates lift. Copy always visible.
- [ ] Display relative, copy absolute. Workspace aria-label unchanged.
- [ ] Typography remap 700 → 600/500.
- [ ] Full `bun test` green. One local commit. No push.
