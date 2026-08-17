# Formic

**One local screen that tells you which of your AI coding agents needs you.**

```bash
git clone https://github.com/emilio3435/formic.git
cd formic
bash scripts/install-formic.sh
```

Or from a checkout you already have: `bun start`. Open http://127.0.0.1:4701.
Start Claude, Codex, Cursor, or Copilot CLI in any folder — a row appears in a few seconds.

[cmux](https://github.com/manaflow-ai/cmux) is optional. Without it the board still watches. Focus, Send, and Interrupt stay off: Formic will not type into a terminal it cannot identify.

If `src/cli/formic.ts` exists: `bun run formic`.

It binds `127.0.0.1` only. It does not open your source code. Nothing leaves the machine.

Cost only when Formic has a real source. No source reads `unavailable`, never `$0`. A context window it cannot size stays blank.

## License

MIT. See [LICENSE](./LICENSE).

Field-level source coverage: [docs/PARITY.md](docs/PARITY.md).
