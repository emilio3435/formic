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

- **A `Blocked` health card.** It reads `cmux unreachable — terminal titles and
  Focus/Send stay offline.` and offers one next step: `Start cmux, then Refresh
  — Focus and Send come back on their own.` Correct behavior: without cmux, the
  dashboard can't prove which terminal owns which session, so it refuses to type
  into one. Focus and Send stay disabled by design. With cmux running and nothing
  wrong, the same card reads `All clear`.
- **Blank cost figures.** Dollar amounts come from OpenBurnBar; without it, cost
  reads unavailable rather than `$0`.
- **An empty board** reading `Watching. No sessions running yet.` with a line
  beneath it counting healthy collectors — nothing has run yet, and only sessions
  from roughly the last day and a half are scanned. That collector count is the
  proof the board is working; if any collector is degraded it says so there
  instead, because an empty board with a blind collector is an unknown one rather
  than an empty one.

## Optional: enable Focus and Send

Requires cmux installed. Once, then restart:

```bash
bun run setup:cmux
```

Skip it if you only want to watch. Running it before cmux has ever started exits
with `Open cmux once so it creates the template, then re-run.` — cmux writes its
config file on first launch, and there is nothing to edit until it has.

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
