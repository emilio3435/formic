# The Ant Hill

**One screen that tells you which of your AI coding agents needs you.**

If you run Claude Code, Codex and Cursor at once, you lose track of which session
is working, which finished, and which has been sitting waiting for an answer for
twenty minutes. The Ant Hill reads the log files those tools already write and
puts every session on one board, attention first.

It runs entirely on `127.0.0.1`. It never opens your source code, and nothing
leaves the machine.

![The board](docs/guide-shots/before-full.png)

## What it does

- **Every session, one board.** Claude Code, Codex, Cursor — live, idle and
  finished, grouped by project.
- **Opens on what needs you.** Not on everything. If nothing is waiting, it says
  so and you close the tab.
- **Acts on a session.** Jump to its terminal, type an instruction, interrupt it.
  Needs [cmux](https://github.com/manaflow-ai/cmux); without it the board still
  watches everything and the acting controls stay off, because it will not touch
  a terminal it cannot prove it has identified.
- **Says what it costs**, when a cost source is available — inside a window you
  pick, which is not the same as everything it has recorded.

## It refuses to invent numbers

This is the part worth knowing before you trust it with anything.

When the Ant Hill cannot measure something, it says so rather than showing a
plausible figure. Cost with no source reads `unavailable`, never `$0`. A context
window it cannot size is blank, not a guess. A session whose process it never
observed reads *no process evidence* rather than *dead*.

The harder half is numbers that are arithmetically correct and still misleading —
a total that counts cached tokens once per turn, a span that calls dormant time
working time. Those get found by audit rather than by luck, and the fixes and the
audits that found them live in [`docs/`](./docs/). A figure being reworked is
labelled as such rather than quietly left standing.

## Run it

```bash
bun start
```

Binds **4701** and reuses an instance that is already up. That is also the port
the background service uses, so `bun run dev` and `bun run start:server` will
exit with `EADDRINUSE` rather than fight it — use
`bash scripts/anthill-preview.sh` for a throwaway copy on 4710–4719.

No runtime dependencies. `bun install` only fetches TypeScript types.

## Where to go next

| Document | For |
|---|---|
| [ANT-GUIDE.md](./ANT-GUIDE.md) | **Using the board.** Written for someone who has never seen it. |
| [QUICKSTART.md](./QUICKSTART.md) | Installing on a fresh Mac, about ten minutes |
| [ARCHITECTURE.md](./ARCHITECTURE.md) | How a transcript on disk becomes a controllable row |
| [SECURITY.md](./SECURITY.md) | The trust boundary, and what it deliberately does not defend |
| [DEPLOY.md](./DEPLOY.md) | Ports, deploying, previewing safely |
| [docs/RUNNING-THE-FLEET.md](./docs/RUNNING-THE-FLEET.md) | What running five agents at once taught this project |

`bun run check` is the gate: strict TypeScript, then the whole suite. It is what
`scripts/anthill-deploy.sh` runs before it will put anything live.
