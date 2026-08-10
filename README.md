# Formic

**One local screen that tells you which of your AI coding agents needs you.**

If you run Claude Code, Codex, and Cursor at once, it is easy to lose track of
which session is working, which finished, and which has been waiting for an
answer. Formic reads the log files those tools already write and puts the
sessions on one attention-first board.

The public product name is Formic. The repository still contains internal
`The Ant Hill` identifiers, launch labels, and historical records; those names
are compatibility surfaces and remain unchanged.

It runs entirely on `127.0.0.1`. It never opens your source code, and nothing
leaves the machine.

## What it does

- **One board, three useful levels.** Repositories contain worktrees, and
  worktrees contain runs. Board, History, and Usage keep the live view, archive,
  and measured consumption distinct.
- **Opens on what needs you.** The live view foregrounds waiting or blocked work;
  when nothing is waiting, it says so instead of inventing an alert.
- **Acts only on identified sessions.** Focus, Send, and Interrupt need
  [cmux](https://github.com/manaflow-ai/cmux). Without it the board still watches
  everything, while acting controls stay off because Formic will not touch a
  terminal it cannot prove it has identified.
- **Reports cost when it has a source.** Values are scoped to the window you
  choose; that window is not the same thing as everything recorded on disk.

## It refuses to invent numbers

This is the part worth knowing before you trust it with anything.

When Formic cannot measure something, it says so rather than showing a plausible
figure. Cost with no source reads `unavailable`, never `$0`. A context window it
cannot size is blank, not a guess. A session whose process it never observed
reads *no process evidence* rather than *dead*.

The harder half is numbers that are arithmetically correct and still misleading:
a total that counts cached tokens once per turn, or a span that calls dormant
time working time. Those get found by audit rather than by luck, and the fixes
and the audits that found them live in [`docs/`](./docs/). A figure being
reworked is labelled as such rather than quietly left standing.

## Run it

```bash
bun start
```

Binds **4701** and reuses an instance that is already up. That is also the port
the background service uses, so `bun run dev` and `bun run start:server` will
exit with `EADDRINUSE` rather than fight it — use
`bash scripts/anthill-preview.sh` for a throwaway copy on 4710–4719.

From a development or agent worktree, always use that 471x preview command.
Reserve `bun start` on 4701 for the installed service or first-run setup.

No runtime dependencies. `bun install` only fetches TypeScript types.

## Where to go next

| Document | For |
|---|---|
| [TODAY.md](./TODAY.md) | **What changed on 2 August**, and which of it you can lean on. Two minutes. |
| [ANT-GUIDE.md](./ANT-GUIDE.md) | **Using the board.** Written for someone who has never seen it. |
| [QUICKSTART.md](./QUICKSTART.md) | Installing on a fresh Mac, about ten minutes |
| [ARCHITECTURE.md](./ARCHITECTURE.md) | How a transcript on disk becomes a controllable row |
| [DESIGN-LANGUAGE.md](./DESIGN-LANGUAGE.md) | The implemented Formic visual and token rules |
| [SECURITY.md](./SECURITY.md) | The trust boundary, and what it deliberately does not defend |
| [DEPLOY.md](./DEPLOY.md) | Ports, deploying, previewing safely |
| [docs/RUNNING-THE-FLEET.md](./docs/RUNNING-THE-FLEET.md) | What running five agents at once taught this project |

`bun run check` is the gate: strict TypeScript, then the whole suite. It is what
`scripts/anthill-deploy.sh` runs before it will put anything live.

GitHub merge and local production deploy are separate steps. Port 4701 serves
the dedicated clean worktree at `~/Developer/the-mountain-production`; follow
[`DEPLOY.md`](./DEPLOY.md) to fast-forward, deploy, and verify it.
