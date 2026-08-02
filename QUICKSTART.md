# Quickstart

The Ant Hill shows every AI coding session running on your Mac in one window —
which one is working, which one is stuck waiting on you. It reads the log files
Claude Code, Codex, and Cursor already write. Nothing leaves `127.0.0.1`, and it
never opens your source code.

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

Without cmux installed you'll see all three of these, in this order:

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
scanned. If it looks empty, widen the lookback (1h / 6h / 24h / 36h) before
concluding nothing was collected.

## Expected on a monitoring-only install

- **An empty board** reading `Watching. No sessions running yet.`, with a line
  beneath it counting **healthy** collectors — `4 of 4 collectors healthy` on a
  machine that has just been set up. Nothing has run yet, and only sessions from
  roughly the last day and a half are scanned. That count is the proof the board
  is working: a stalled client cannot manufacture a ticking snapshot age. If a
  collector really is degraded it says so there instead, because an empty board
  with a blind collector is an *unknown* fleet rather than an empty one.
- **A `Blocked` health card**, offering one next step: `Start cmux, then Refresh
  — Focus and Send come back on their own.` Its detail line counts what it found
  — on a machine with no cmux it typically reads `2 control-plane problems may
  limit focus, instruction, or interrupt actions.`, one for terminal discovery
  and one for notifications. The number is a count, so expect it to differ.
  Correct behavior: without cmux the dashboard cannot prove which terminal owns
  which session, so it refuses to type into one. With cmux running and nothing
  wrong, the same card reads `All clear`.
- **Blank cost figures.** Dollar amounts come from OpenBurnBar; without it, cost
  reads unavailable rather than `$0`.

### Why it still says 4 of 4 when you have none of them

The count is of collectors that can **see**, not of tools you have installed.
There are four, and they read what each tool already writes to disk:

| Collector | Reads | You have it if |
|---|---|---|
| **Claude** | `~/.claude/projects/` | you use Claude Code |
| **Codex** | `~/.codex/sessions/` | you use Codex CLI |
| **Cursor** | Cursor's own session store | you use Cursor |
| **OMP** | `~/.omp/agent/sessions/` | almost certainly not — it is a legacy source kept for old history |

**Expect most of these to be absent, and expect all four to still read healthy.**
A directory that does not exist is a complete answer — *this tool never ran
here* — and no session can be hiding behind it. Most people will run one or two
of these tools and never see anything but `4 of 4`. Watch for `degraded`
instead, which means something *stopped* a collector reading — a permissions or
I/O failure — and is the only case where sessions could exist that the board
cannot show you.

**cmux is not one of the four.** It does not collect sessions; it resolves which
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
works**, with a reason that says the pane was matched by its working directory
rather than attested by cmux. That is deliberate, and it is worth knowing before
you meet it, because the row otherwise looks completely healthy.

The Ant Hill will type into a terminal only when cmux names the session on that
pane — evidenced by the session's transcript file being held open there, or the
session ID appearing in the command that started it. Matching a pane by the
folder it happens to be sitting in is a guess, and a guess is enough to move the
board's view but not enough to authorise input: two panes in the same project,
one `cd`ing away as another `cd`s in, will silently re-point the row at the wrong
terminal. Focus stays on in that state on purpose — looking costs nothing, and
going to the pane is how you recover.

So: **start agents inside cmux panes and leave them there**, and the write
controls stay on. There is no setting for this and nothing to restart; the
buttons re-enable within a few seconds of cmux naming the session.

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
