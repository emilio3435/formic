# Fleet debt ledger — 2026-08-15

Board watches six CLIs. Grok Build and Hermes are invisible. Health says 6 of 6.

**This program:** allow-list, then Grok + Hermes in parallel. Spec: `docs/superpowers/specs/2026-08-15-missing-clis.md`.

| Pri | Item | What it does | Status |
|---|---|---|---|
| A | Allow-list uses shared `PROVIDERS` | Factory/Prime bindings can crash `:4701` on restart | **This program** |
| A | Stub `grok` + `hermes` in the union | Both lanes can ship without fighting the type | **This program** |
| B | Grok Build CLI | `grok` runs here. No row, no process, no badge | **Parallel with C** |
| C | Hermes | Billed cron + dormant sessions. No collector | **Parallel with B** |
| P1 | Hook liveness missing `livePids` | Live process can show dead | Next |
| P1 | Cursor hooks unused | Stale Cursor pane can still get Send | Next |
| P1 | Cost card hides `priorSpend` | Server has it. UI doesn't print it | Next |
| P1 | Provider cost goes blank | One unpriced model hides that provider's $ | Next |
| P1 | Multi-day spend on day one | Long sessions dump all cost on start date | Next |
| P1 | Composer is fake multi-line | Paste collapses. Shift+Enter does nothing | Next |
| P1 | Reply doesn't send | Notification Reply just opens the drawer | Next |
| P1 | Names UI never mounted | Room-label editor exists, nowhere on the board | Next |
| P1 | Can't filter program from Filters | Hidden behind hover-only Details | Next |
| P2 | Factory always "running" | Quiet Factory still looks live | Later |
| P2 | Prime skips normal agent path | No status, no transcript reread | Later |
| P2 | Health endpoint is weak | 200 = snapshot < 60s. Collectors can be dead | Later |
| P2 | Empty snapshot says 4 of 4 | Board has six collectors | **In A** |
| P2 | Attention has no freshness gate | Ack/snooze can hit stale routing | Later |
| P2 | cmux IDs miss Factory/Prime/Grok | Focus/Send can't bind those panes by id | Grok lane covers Grok |
| P2 | Snooze is one hour only | No 15m / morning / custom | Later |
| P2 | Usage table silently truncates | 40 rows, 10 providers, no "and N more" | Later |
| P2 | Search promises extra fields | Label, tooltip, and search disagree | Later |
| P2 | Keyboard guide is wrong | Says six tabs. There are three | Later |
| P2 | `grok-4.6` missing from models | Only 4.5. Cursor already runs 4.6 | Grok lane |
| Later | The Pilot | Spec exists. No code | Parked |
| Later | Cloud Cursor occupancy | Local done. Cloud (`bc-`) not started | Parked |
| Later | Write-path live probe | Suite exists. Never proven on a real tty | Parked |
| Skip | Repo sigils, group icons, infra cost card | Parked on purpose | — |
| Skip | TINT / SYNC / mini-chat / occupancy Spec A | Already shipped | — |
