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
<http://127.0.0.1:4702>) and opens your browser there. Leave that terminal
running — closing it stops the server.

Without cmux installed you'll see:

```
cmux not detected — starting in this shell (monitoring only; Focus/Send stay disabled).
```

That is the expected message, not an error.

## 4. See something

In another terminal, `cd` into any project and run `claude` (or Codex, or open
Cursor). A row appears within about five seconds — no refresh needed.

**Working correctly when:** the badge top-right reads **Live**, and a new session
shows up on its own.

## Expected on a monitoring-only install

- **A red "CMUX control is degraded" verdict in the header.** Correct behavior:
  without cmux, the dashboard can't prove which terminal owns which session, so
  it refuses to type into one. Focus and Send stay disabled by design.
- **Blank cost figures.** Dollar amounts come from OpenBurnBar; without it, cost
  reads unavailable rather than `$0`.
- **An empty list** reading `The ant hill is still — no tracked agents.` — nothing
  has run yet, and only sessions from roughly the last day and a half are scanned.

## Optional: enable Focus and Send

Requires cmux installed. Once, then restart:

```bash
bun run setup:cmux
```

Skip it if you only want to watch. Running it without cmux installed exits with
a message asking you to open cmux first.

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
