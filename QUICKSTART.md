# Quickstart

Formic shows every AI coding session running on your Mac in one window —
which one is working, which one is stuck waiting on you. It reads the log files
Claude Code, Codex, and Cursor already write. Nothing leaves `127.0.0.1`, and it
never opens your source code.

The public product name is Formic. Startup banners, scripts, and launchd labels may
still say `The Ant Hill` / `anthill` — those are ops compatibility surfaces.

**You need:** a Mac, and at least one of Claude Code / Codex CLI / Cursor already
in use. Setup is about 10 minutes.

## 1. Install Bun

```bash
curl -fsSL https://bun.sh/install | bash
touch ~/.zshrc && grep -q '.bun/bin' ~/.zshrc || echo 'export PATH="$HOME/.bun/bin:$PATH"' >> ~/.zshrc
export PATH="$HOME/.bun/bin:$PATH"
bun --version
```

The middle two lines matter: Bun's installer only edits `~/.zshrc` when that file
already exists, so on a fresh account `bun` can stay unfindable without them.

## 2. Get the code

```bash
gh repo clone emilio3435/the-ant-hill ~/anthill
```

The `~/anthill` path is the historical checkout name — it is fine to keep; it is
an ops compatibility surface.

The repo is private, so `gh` must be authenticated first (`gh auth login` →
GitHub.com → HTTPS → yes to "Authenticate Git"). A plain `git clone` over HTTPS
will either prompt for a password GitHub no longer accepts, or fail with
`Repository not found` — GitHub hides private repos rather than saying "no
access".

There is no install step. The app has **no runtime dependencies**; `bun install`
only fetches the TypeScript types needed for `bun run check`.

## 3. Start it

```bash
cd ~/anthill && bun start
```

It prints the address it bound (`bun start` defaults to
<http://127.0.0.1:4701>) and opens your browser there. Leave that terminal
running — closing it stops the server.

4701 is also the port the production instance uses. If one is already
running, `bun start` detects it and just opens the browser instead of
starting a second server.

Without cmux installed you'll see all three of these, in this order
(the third line is the compatibility banner string the server prints today):

```
cmux binary not found.
cmux not detected — starting in this shell (monitoring only; Focus/Send stay disabled).
The Ant Hill: http://127.0.0.1:4701 · no cmux auth (titles/controls may stay offline)
```

**All three are expected, including the first.** `cmux binary not found.` is
printed to standard error, so your terminal may colour it red — it is the
dashboard reporting that it looked for cmux and did not find one, which is
exactly right on a machine without it. The board comes up regardless. Focus and
Send are the only things you lose, and [§ Optional](#optional-enable-focus-and-send)
turns them on later if you want them.

## 4. See something

In another terminal, `cd` into any project and run `claude` (or Codex, or open
Cursor). A row appears within about five seconds — no refresh needed.

**Working correctly when:** the badge top-right reads **Live**, and a new session
shows up on its own.

The board opens on a **6-hour** window even though the last **36 hours** are
scanned. If it looks empty, widen the lookback before concluding nothing was
collected: the **Time** menu at the right end of the filter bar offers hours
(1h / 6h / 12h / 24h), days (2d / 7d / 14d / 30d) and Everything. The two
windows are different things and the menu says so — your lookback is what the
board shows you, the scan window is how far back the collectors reached, and
asking for 7 days cannot reach past what was scanned. Both numbers are yours to
change — the gear in
the masthead opens Settings, where the lookback lives beside the scan window and
the two thresholds that decide what every session is called.

One thing you will see that no other board shows: an **Unverified** section at
the bottom of each program group. Those are sessions that have gone quiet with no
process left to check, which is not the same as finished. Formic says so rather
than filing them as ended, and that group deliberately ignores the lookback —
it is a disclosure of what cannot be accounted for, not a list of recent things.

## Expected on a monitoring-only install

- **An empty board** reading `Watching. No sessions running yet.`, with a line
  beneath it describing your collectors. What it says depends on what you have:

  | You have | The line reads |
  |---|---|
  | none of the eight yet | `No collectors installed yet — Claude Code, Codex, Cursor or Grok Build will appear here` |
  | one of them | `1 of 1 collectors healthy · 7 not installed` |
  | all eight | `8 of 8 collectors healthy` |

  That line is the proof the board is working: a stalled client cannot
  manufacture a ticking snapshot age. **It counts collectors that can SEE, not
  tools you have installed** — a tool you do not use is *absent*, which is a
  complete answer ("this never ran here") rather than a gap, so it is named
  separately and never counted as a fault. If a collector really is *degraded*
  the line says that instead, because an empty board with a blind collector is
  an *unknown* fleet rather than an empty one.
- **A `Readings healthy` health chip.** Not having cmux is not a fault: it
  collects no sessions, so its absence cannot hide a row. You lose Focus and Send
  and nothing else, and [§ Optional](#optional-enable-focus-and-send) turns them
  on later. A row you cannot act on says so on the row itself, with the reason.

  The chip judges the **instruments**, not the fleet — whether the numbers beside
  it can be trusted — which is why it says "Readings", not "All clear".

  You will see **`Readings degraded`** instead if cmux is *installed but not
  running* — a control plane that should answer and does not. The next step is
  in the **Notifications** panel, which is where anything you can act on lives:
  `Start cmux, then Refresh — Focus and Send come back on their own.`
  Its detail line counts what it found — typically `2 control-plane problems may
  limit focus, instruction, or interrupt actions.`, one for terminal discovery
  and one for notifications. The number is a count, so expect it to differ.
  That is a real fault; a missing cmux is not.
- **Blank cost figures.** Dollar amounts come from OpenBurnBar; without it, cost
  reads unavailable rather than `$0`.

### What the eight collectors are

The count is of collectors that can **see**, not of tools you have installed.
There are eight, and they read what each tool already writes to disk:

| Collector | Reads | You have it if |
|---|---|---|
| **Claude** | `~/.claude/projects/` | you use Claude Code |
| **Codex** | `~/.codex/sessions/` | you use Codex CLI |
| **Cursor** | Cursor's own session store | you use Cursor |
| **Factory** | `~/.factory/sessions/` | you use Factory (droid) |
| **OMP** | `~/.omp/agent/sessions/` | almost certainly not — it is a legacy source kept for old history |
| **Prime** | `~/.prime/agent/sessions/` | you use Prime Agent |
| **Grok** | `~/.grok/sessions/<encoded-cwd>/<session-id>/` or `$GROK_HOME/sessions/…` | you use Grok Build |
| **Hermes** | `~/.hermes/` | you use Hermes |

**Expect most of these to be absent, and expect that to be fine.** A directory
that does not exist is a complete answer — *this tool never ran here* — and no
session can be hiding behind it, so an absent collector is named separately and
never counted as a fault. Most people run one or two of these and see a line
like `1 of 1 collectors healthy · 7 not installed`. Watch for `degraded`
instead, which means something *stopped* a collector reading — a permissions or
I/O failure — and is the only case where sessions could exist that the board
cannot show you.

**cmux is not one of the eight.** It does not collect sessions; it resolves which
terminal a session is sitting in, which is what Focus and Send need. Not having
it costs you those buttons and nothing else — it cannot hide a row, so it must
never move the collector count. If you ever see a degraded collector *caused by*
a missing cmux, that is a bug, not your setup.

## Optional: enable Focus and Send

Requires cmux installed. Once, then restart:

```bash
bun run setup:cmux
```

Skip it if you only want to watch. Running it before cmux has ever started exits
with `Open cmux once so it creates the template, then re-run.` — cmux writes its
config file on first launch, and there is nothing to edit until it has.

**cmux installed is not the same as cmux naming your session.** With cmux
running you may still find **Send and Interrupt greyed out on a row where Focus
works**. That is deliberate, and it is worth knowing before you meet it, because
the row otherwise looks completely healthy.

### What Formic promises never to do

This is the part to read before you let anything type into your terminals. Each
of these is a guarantee, not a missing feature:

- **It will never type into a terminal it cannot name.** cmux has to attest that
  *this session is on this pane* — evidenced by the session's transcript file
  being held open there, or the session ID in the command that started it. A pane
  merely sitting in the right folder is a guess, and a guess may move your view
  but never your keystrokes. Two panes in one project, one `cd`ing away as
  another `cd`s in, is enough to re-point a row at the wrong terminal while it
  still reads healthy. Hovering such a button says so: *matched by its working
  directory, not attested by cmux, so the session on it cannot be proven.*
- **It will never type into a session that has already exited.** The pane
  outlives the agent and usually belongs to your shell by then, so an
  instruction to a dead agent would land in whatever is sitting there now. Once
  the board has checked and found the process gone, the Send is refused and says
  the pane may now belong to someone else.
- **It will never act on a stale picture.** Which terminal an agent is on has a
  short shelf life. If the board's evidence is too old to trust, the write is
  refused rather than sent to where the agent used to be.

And one it promises always to do: **tell you when a view cannot show you
everything.** A cost window reports what falls outside it rather than presenting
its own horizon as the whole record — the server returns that figure today, and
the card is being taught to print it.

**Focus is exempt from all of it, on purpose.** Looking costs nothing and going
to the pane is how you recover, so there is always a way in. The board is never
the reason you cannot reach an agent — it is the reason you do not reach the
wrong one.

So: **start agents inside cmux panes, leave them there, and keep them running**,
and the write controls stay on. There is no setting for any of this and nothing
to restart; the buttons re-enable within a few seconds of the board being able to
prove the answer again.

## Group sessions by project (optional)

```bash
cp config/programs.example.json config/programs.json
```

Then edit it. `config/programs.json` is gitignored, so your project names stay on
your machine. Without it, sessions are listed ungrouped.

## Updating

```bash
cd ~/anthill && git pull && bun start
```

## Turning it off

`Ctrl-C` in the terminal running it. To remove it entirely: `rm -rf ~/anthill` —
nothing else was installed.
