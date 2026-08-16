# Agent-home discovery + confirm-to-import

Repo: Formic. Branch from `main` in a fresh worktree. Not `the-mountain-production`.

GitHub: #67

**Goal:** Formic scans this Mac for any filesystem that belongs to an AI agent, lists what it found, and the operator picks what to import. No hardcoded wrapper paths. No new Provider per extra copy.

**Success means:** Settings → Collectors shows every agent home a bounded scan can prove — default Formic collectors, extra instances of those, and unknown-but-agent-shaped trees. Nothing extra starts collecting until the operator confirms Import. Onboarded extras that Formic already knows how to read become rows. Unknown shapes stay inventoried with a reason.

**Stop when:** Scan + persist + confirm-to-import UX are green in tests, a preview board shows the inventory (including at least one extra Cursor GUI root and one unknown-shaped fixture), and `PROVIDERS` is unchanged. Do not deploy. Do not write new parsers in this spec (Grok Bot blobs, extra Grok CLI collection, and unknown shapes wait for follow-ups).

---

## Why this is not “Cursor 2 / Grok 2 only”

#66 taught Formic the `grok` TUI and Hermes. Both still read one default home. Extra wrappers on this machine (Cursor 2, Grok Bot 2) were the *reason* the work started. They are fixtures, not the product.

The product is: **find any agent filesystem, inventory it, import only what you confirm.**

```
#1  scan every known + likely agent home → Settings inventory → confirm import
#2  extra Grok CLI homes (collect onboarded grok-cli roots)
#3  Grok Bot blob parser (collect onboarded grok-bot roots)
```

#2 and #3 consume the store this spec persists. They do not own the scan.

---

## Locked decisions

| Decision | Call |
|---|---|
| Instance ≠ Provider | Extra Cursor stays `"cursor"`. Extra Grok CLI stays `"grok"`. A second Claude home stays `"claude"`. |
| No hardcoded wrapper path | Do not special-case `~/Applications/Grok Bot 2.app`. Scan shapes. |
| Scan is bounded | Fixed roots, depth caps below. Never walk all of `$HOME`. Time-boxed ≤2s. |
| Confirm to import | Scan never starts collecting a newly found extra root. |
| Defaults stay implicit | Today's built-in homes keep collecting with an empty store. |
| Persist is a separate store | `data/collector-instances.json`. Not keys on `HubSettings` — `/api/settings` rejects unknown keys (`src/server/settings.ts:343`). |
| Unknown shapes are first-class | A tree that *looks* like an agent home but has no parser is still listed. Reason: `needs-parser`. Import records it; it does not invent rows. |
| Parsers this PR | Only extra **Cursor GUI** roots (`state.vscdb`) actually collect. Everything else is inventory + persist. |

---

## Verified current state (2026-08-16)

Formic already reads these *default* homes and ignores every extra copy:

| Provider / source | Default path today | Extra copies missed |
|---|---|---|
| Codex | `~/.codex/sessions` | `~/.codex-*` |
| Claude | `~/.claude/projects` | `~/.claude-*`, Claude.app Application Support |
| Cursor GUI | `~/Library/Application Support/Cursor/…/state.vscdb` | `…/Cursor-2/…` |
| Cursor CLI | `~/.cursor/chats`, `~/.cursor/projects` | other `~/.cursor-*` that hold chats |
| Factory | `~/.factory/sessions` | `~/.factory-*` |
| Prime | `~/.prime/agent/sessions` | `~/.prime-*` |
| OMP | `~/.omp/agent/sessions` | `~/.omp-*` |
| Grok Build | `$GROK_HOME` xor `~/.grok` | extra `~/.grok-*` (#2) |
| Hermes | `~/.hermes/sessions` + `~/.hermes/cron` | extra `~/.hermes-*` |
| Grok Bot.app | none | `…/Grok Bot/sand-client-persistence` (#3) |
| OpenBurnBar | `…/OpenBurnBar` | extra copies |
| cmux hooks | `~/.cmuxterm` | — |

This machine, as fixtures (do not hardcode these paths in source):

- `/Applications/Cursor.app` + `~/Applications/Cursor 2.app` → `--user-data-dir=…/Cursor-2`
- `/Applications/Grok Bot.app` + `~/Applications/Grok Bot 2.app` → `--user-data-dir=…/Grok Bot 2`
- `~/.grok` only (no `~/.grok-2`)

---

## Scan

Pure function. Read-only. ≤2s. Returns candidates. Never writes.

### Roots (fixed list)

1. `/Applications` and `$HOME/Applications` — depth 1, `*.app` only.
2. `$HOME/Library/Application Support` — depth 1 directories.
3. `$HOME` — depth 1, names matching `^\.[A-Za-z0-9._-]+$` (dotdirs only).
4. Live processes for this uid — argv only (`--user-data-dir=`, `--home=`, known binaries).

Do not recurse into `node_modules`, `Library/Caches`, `Library/Logs`, iCloud containers, or `/`.

### Classify — known shapes

A candidate matches **one** row. First match wins.

| `kind` | Evidence | `provider` | Collects in this spec? |
|---|---|---|---|
| `cursor-gui` | `User/globalStorage/state.vscdb` under an Application Support dir whose name starts with `Cursor` | `cursor` | Yes, if imported |
| `cursor-cli` | `chats/` or `projects/` under a `~/.cursor*` that is not extensions-only | `cursor` | No (inventory) |
| `codex` | `sessions/` with `rollout-` JSONL under `~/.codex*` | `codex` | No (inventory) |
| `claude` | `projects/` under `~/.claude*` | `claude` | No (inventory) |
| `factory` | `sessions/` with `*.jsonl` + `*.settings.json` under `~/.factory*` | `factory` | No (inventory) |
| `prime` | `agent/sessions/` under `~/.prime*` | `prime` | No (inventory) |
| `omp` | `agent/sessions/` under `~/.omp*` | `omp` | No (inventory) |
| `grok-cli` | `sessions/<encoded-cwd>/<uuid>/{summary.json,updates.jsonl}` under `~/.grok*` | `grok` | No — #2 |
| `hermes` | `sessions/` or `cron/` under `~/.hermes*` | `hermes` | No (inventory) |
| `grok-bot` | `sand-client-persistence/` under an Application Support dir whose name starts with `Grok Bot` | `null` | No — #3 |
| `burnbar` | Application Support dir named `OpenBurnBar` | `null` (spend) | No |
| `cmux-hooks` | `~/.cmuxterm` | `null` | No |

### Classify — unknown but agent-shaped

If no known row matches, still emit `kind: "unknown"` when **two or more** of these hold:

- Directory name matches `/^(claude|codex|cursor|grok|hermes|factory|prime|omp|droid|aider|continue|opencode|gemini|windsurf|copilot|crush|amp)/i` (or `~/.` + that token).
- Contains `sessions/`, `projects/`, `chats/`, `conversations/`, or `*.jsonl` session files at depth ≤3.
- A live process whose argv points `--user-data-dir` or a home flag at this dir.
- An app bundle Info.plist whose name/identifier mentions an agent (Cursor, Claude, Grok, Codex, Windsurf, Factory, …).

`provider` is `null`. `reason` is `needs-parser`. Import records it. No Board rows.

### Wrappers (no path literals)

1. Depth-1 `*.app` Info.plist `CFBundleName` / `CFBundleIdentifier`.
2. If `Contents/MacOS/*` is a script ≤8 KiB, extract `--user-data-dir=` / `--extensions-dir=`.
3. Else default Application Support name from the bundle name.
4. Live `ps`: `--user-data-dir=` under Application Support or `$HOME`.

Dedup by resolved data-dir. Built-in defaults are `default: true` and cannot be turned off.

### Do not

- Follow aliases outside `$HOME`, `/Applications`, `/tmp`.
- Open `state.vscdb` or blobs during scan — existence + mtime + size only.
- Treat `~/.cursor-2` as chats when it only has `extensions/`.
- Invent a new Provider for an extra copy or an unknown tree.
- Auto-import extras.

---

## Persist

`data/collector-instances.json`, same atomic write as `JsonSettingsStore`.

```ts
interface CollectorInstanceRecord {
  version: 1;
  instances: CollectorInstance[];
}

interface CollectorInstance {
  id: string;                 // stable slug: "cursor:cursor-2", "unknown:dot-crush"
  kind: string;               // table above, or "unknown"
  provider: Provider | null;
  label: string;              // operator-editable, default from dir basename
  dataDir: string;            // resolved absolute path
  onboarded: boolean;         // extras default false
  ignored: boolean;
  discoveredAt: string;
  lastSeenAt: string;
  reason?: "needs-parser" | "needs-home-list";
}
```

Zod at the HTTP boundary. Reject `dataDir` that is not absolute, not under `$HOME` or `/Applications`, or that fails classify-or-unknown on write.

### API

| Method | Path | Job |
|---|---|---|
| `GET` | `/api/collector-instances` | Scan now + merge with store. Loopback only. |
| `POST` | `/api/collector-instances` | Body `{ ids?: string[], id?: string, onboarded?, ignored?, label? }`. Same-origin loopback + JSON. |

`POST` with `ids` + `onboarded: true` is **Import selected**. Scan on GET only.

---

## Collect (this spec: extra Cursor GUI only)

`collectCursorSessions` takes onboarded `cursor-gui` roots plus the default.

- Agent id stays `cursor:<composer-or-session-id>`. Same chat in two DBs is one row (first root wins; log the skip).
- Publish `instanceId` + `instanceLabel` on the row.
- Extra-root open failures are named errors on that instance, not a dead default Cursor collector.

Every other onboarded kind is stored, not collected. `#2` and `#3` and later parsers read the same store.

---

## Settings UX — inventory, then confirm

Add a **Collectors** block to `renderSettingsPanel` (`src/web/app.js:3813`) below the time fields.

1. On open, `GET /api/collector-instances`.
2. Group: **On now** (defaults + imported) / **Found, not imported** / **Needs a parser** / **Ignored**.
3. Each row: kind, label, short data-dir, last seen.
4. Found rows have a checkbox. Primary button: **Import selected**. Per-row: Ignore.
5. Defaults have no Off control.
6. Preview: “N homes on. M found, waiting on you.”

Do not rebuild the form every snapshot. Include the instance signature in the existing paint guard.

This is the confirmation step. Scan is not permission.

---

## Files

| File | Change |
|---|---|
| `src/server/collector-instances.ts` | Scan, classify (known + unknown), store, Zod |
| `src/server/app.ts` | `/api/collector-instances` |
| `src/server/cursor.ts` | Iterate onboarded GUI roots |
| `src/server/collectors.ts` | Pass those roots into `collectCursorSessions` |
| snapshot row | Optional `instanceId`, `instanceLabel` |
| `src/web/app.js` `renderSettingsPanel` | Inventory + Import selected |
| `src/web/styles.css` | Match existing settings rows |
| `ANT-GUIDE.md` / `QUICKSTART.md` | Extra homes are Settings, not new providers |
| `tests/collector-instances.test.ts` | Known extras, unknown shape, path reject, no auto-import |
| `tests/cursor-extra-root.test.ts` | Second `state.vscdb` → rows |
| `tests/settings.test.ts` | `/api/settings` still rejects instance keys |

---

## Acceptance

1. Fixture `Application Support/Cursor-2/…/state.vscdb` is `cursor-gui`, not imported. Import → `provider: "cursor"` rows with an instance label.
2. Fixture `Application Support/Grok Bot 2/sand-client-persistence/*.blob` is `grok-bot` / `needs-parser`. Import does **not** create Board rows.
3. Fixture `~/.grok-2/sessions/…` is `grok-cli` / `needs-home-list`. Import does **not** collect it.
4. Fixture `~/.crush/sessions/*.jsonl` (or any unknown agent-shaped tree) appears under **Needs a parser**. Import records it. No rows. No new Provider.
5. Fixture `~/.codex-2/sessions/rollout-…` is `codex`, listed, not collected in this spec.
6. Scan never mentions a literal `Grok Bot 2.app` path. A wrapper whose script points `--user-data-dir` at a classifiable dir is found.
7. `POST` with `dataDir: "/etc/passwd"` or `~/Downloads` is `400`.
8. Empty store: default collectors unchanged.
9. `PROVIDERS` still has 8 names.
10. `bunx tsc --noEmit` clean. New tests green.

---

## Testing plan

| Layer | What | Count |
|---|---|---|
| Unit | classify known + unknown + dedup + path allowlist | +8 |
| Integration | Cursor-2 DB → rows; Grok Bot / unknown do not | +3 |
| HTTP | GET merge, POST import-selected / ignore, reject escape | +4 |
| UI | Inventory lists fixtures; Import selected persists | +1 (preview) |

---

## Rollback

Revert the PR. Delete `data/collector-instances.json`. Default collectors keep working.

---

## Effort

Scan + store + API ~4h. Cursor multi-root ~3h. Settings inventory UX ~3h. Tests + docs ~2h.

---

## Out of scope

- #2 extra Grok CLI collection
- #3 Grok Bot blob parser
- New parsers for unknown kinds (Crush, Aider, Continue, Windsurf, …)
- New Provider keys
- Cloud Cursor (`bc-`)
- Walking the whole disk
- Auto-import

## Related

- #67 — this spec
- #66 — Grok Build + Hermes collectors (shipped)
- `docs/2026-08-15-FLEET-DEBT-LEDGER.md` — tonight #2 and #3
