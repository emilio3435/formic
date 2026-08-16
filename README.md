# Formic

One local board for the AI coding sessions already running on your Mac.

If you run Claude Code, Codex, and Cursor at once, it is easy to lose track of which session is working, which finished, and which is waiting on you. Formic reads the log files those tools already write and puts them on one screen.

It binds `127.0.0.1` only. It does not open your source code. Nothing leaves the machine.

## Run it

You need a Mac, [Bun](https://bun.sh) 1.3.14+, and at least one of Claude Code, Codex CLI, or Cursor already in use.

```bash
curl -fsSL https://bun.sh/install | bash
export PATH="$HOME/.bun/bin:$PATH"

git clone https://github.com/emilio3435/formic.git ~/formic
cd ~/formic
bun start
```

Open [http://127.0.0.1:4701](http://127.0.0.1:4701). Leave that terminal open. Start a Claude / Codex / Cursor session in another project; a row should show up in a few seconds without refresh.

`bun start` reuses an instance that is already on 4701 instead of fighting it.

## What you get

- A live board that foregrounds waiting or blocked work
- History and usage as separate views
- Cost only when Formic has a real source. No source reads `unavailable`, never `$0`. A context window it cannot size stays blank.

Focus, Send, and Interrupt need [cmux](https://github.com/manaflow-ai/cmux). Without it the board still watches. Those controls stay off on purpose: Formic will not type into a terminal it cannot identify.

`cmux binary not found` on first run is expected if you have not installed cmux. The board still comes up.

## Not this repo

This is the public snapshot. Day-to-day development and the production LaunchAgent on the author’s machine live elsewhere. You do not need those docs to run Formic.

## License

MIT. See [LICENSE](./LICENSE).
