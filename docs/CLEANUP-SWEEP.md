# Cleanup sweep — propose contract for the board

> **THE BOARD NEVER DELETES.** The header chip's Clean up action runs `propose`
> only. Deletion is a terminal paste of `confirmCommand`. No destructive server endpoint.
> Do not wire `confirm` to a route or a click handler.

Owned by harden-notify (`scripts/anthill-cleanup-sweep.ts`). fe-notify builds the
chip button, spinner, and the notification-center **dataflow** item against this
page — not against the TypeScript source.

## Board endpoint

The Clean up button makes one exact-same-origin request:

```http
POST /api/cleanup/propose
```

The server runs enumeration in a worker, outside the snapshot loop. Calls that
overlap share one in-flight run, so a double-click produces one plan. A complete
response wraps the notification view documented below:

```json
{
  "ok": true,
  "complete": true,
  "plan": {
    "removable": [],
    "refused": { "worktrees": [], "branches": [] },
    "confirmCommand": "bun scripts/anthill-cleanup-sweep.ts confirm /absolute/path/to/cleanup-plan.json"
  }
}
```

If the process table, any recognized agent cwd, Git enumeration, or plan write
cannot be completed, the endpoint returns HTTP 503 with `ok:false`,
`complete:false`, an error code/message, and **no `plan` field**. A partial plan
never reaches the client wearing a complete response.

There is no cleanup-confirm endpoint. `confirmCommand` is text for the client to
render and the operator to paste into a terminal; the board never executes it.

## Terminal propose equivalent

```bash
bun scripts/anthill-cleanup-sweep.ts propose \
  --repo <repoRoot> \
  --out <abs/path/to/cleanup-plan.json> \
  --json
```

| Flag | Default | Notes |
|---|---|---|
| `--repo` | `cwd` | Git common checkout to scan |
| `--out` | `<repo>/.anthill/cleanup-plan.json` | Plan file path (also embedded in the JSON) |
| `--main` | `main` | Merge-base tip |
| `--json` | off | Print the **notification view** on stdout (what the dataflow item needs) |

`propose` only enumerates git state and the process table, then writes the plan
artifact. It is safe while agents are live, and safe to invoke twice: writers
take a lock on `<out>.lock` and replace the plan file atomically. Each run
supersedes the previous plan; nothing is deleted.

## Notification view (`--json` stdout)

This is the shape fe-notify should parse. It is also recoverable from the written
plan via `notificationViewFromPlan(plan, planPath)`.

```json
{
  "version": 1,
  "createdAt": "2026-08-05T21:00:00.000Z",
  "repoRoot": "/absolute/path/to/repo",
  "mainRef": "main",
  "mainTipSha": "<40-char sha>",
  "fingerprint": "<sha256 of propose facts>",
  "planPath": "/absolute/path/to/cleanup-plan.json",
  "confirmCommand": "bun scripts/anthill-cleanup-sweep.ts confirm /absolute/path/to/cleanup-plan.json",
  "removable": [
    {
      "kind": "worktree",
      "target": "/absolute/path/to/worktree",
      "rollbackSha": "<40-char sha>",
      "branch": "feat/example"
    },
    {
      "kind": "branch",
      "target": "feat/example",
      "rollbackSha": "<40-char sha>"
    }
  ],
  "refused": {
    "worktrees": [
      {
        "path": "/absolute/path/to/occupied-wt",
        "branch": "feat/busy",
        "reasons": [
          "live agent process cwd'd inside this worktree — hard stop"
        ]
      }
    ],
    "branches": [
      {
        "name": "feat/unmerged",
        "reasons": [
          "branch is not merged into main — git branch -d would refuse; never -D"
        ]
      }
    ]
  }
}
```

### Fields the dataflow item must surface

| Field | Role on the item |
|---|---|
| `removable[]` | What is removable — each `kind`, `target`, and `rollbackSha` |
| `refused.worktrees[]` / `refused.branches[]` | What was refused and why (`reasons[]`) |
| `confirmCommand` | Exact string to paste; evidence/impact should quote it |
| `planPath` | Where the full plan lives (occupancy detail, fingerprint) |
| `fingerprint` / `mainTipSha` | Provenance; confirm will refuse if the world moved |

### Mapping onto `NotificationItem` (§4.2)

| NotificationItem field | Source |
|---|---|
| `kind` | `"dataflow"` |
| `severity` | `"warning"` (tidy-up, not a person-blocker — never ember) |
| `evidence` | Sentence naming `removable.length` + first few targets; include `confirmCommand` |
| `impact` | What happens if ignored (abandoned worktrees keep degrading readings) |
| `route` | Existing advisory/intervention drawer for the health/debris finding, or a documented history route — fe-notify chooses; must be a `DRAWER_RENDERERS` key |
| `source.collector` | `"cleanup-sweep"` |

## Confirm (terminal only — not for the board)

```bash
bun scripts/anthill-cleanup-sweep.ts confirm /absolute/path/to/cleanup-plan.json
```

Re-enumerates, demands the same `fingerprint` and `mainTipSha`, then runs
`git worktree remove` and `git branch -d`. Never `-D`. Never `--force`. A live or
unverifiable agent cwd'd in a worktree is a hard stop even if the operator
approves.

## Full plan file

The file at `planPath` is the confirm input. It includes every worktree/branch
row with occupancy evidence. fe-notify does not need those fields to render the
item; they are for the human reading the plan before pasting `confirmCommand`.
