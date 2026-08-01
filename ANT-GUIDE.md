# The Ant Guide

**You have several AI coding assistants running at once. This is the one screen
that tells you which one needs you.**

![The Ant Hill dashboard](docs/guide-shots/before-full.png)

Open it at **http://127.0.0.1:4701** and leave it open. It updates itself.

This guide is about *using* a dashboard that is already running. To install one
on a new machine, see [QUICKSTART.md](./QUICKSTART.md).

> **The one rule worth learning first.** When the Ant Hill does not know
> something, it says so instead of showing a plausible number. A blank is
> usually honest, not broken.

---

## The 60-second version

Four steps. Do these in order and you have used the tool correctly.

### 1. Check `Needs you`

![The summary band](docs/guide-shots/shot-1-summary.png)

Five cards across the top. **Only the first one is a to-do list.** If `Needs you`
is zero, nothing is waiting on you and you can close the tab.

The rest are context, not tasks: how much is shipping, what it is costing, how
full the fullest context window is, and whether the system itself is healthy.

### 2. The board opens on `Needs you`

![The tabs and the board](docs/guide-shots/shot-2-board.png)

`Needs you` is the default and is deliberately the shortlist — only sessions
actually waiting on a human. If it is empty, everything is either working or
done, and that empty screen is the answer. `Now` is the whole board: everything
working *or* asking for you.

### 3. Read the row

![One row](docs/guide-shots/shot-5-row.png)

Every row is **one AI session**. Left to right:

| Part | What it is |
|---|---|
| Name | Who it is, and the folder it is working in |
| Message | The last thing it said |
| Status | `Working`, `Idle`, `Alert`, `Done` |
| Model · ctx | Which model, and how full its context window is |
| Tokens | How much it has used |
| Elapsed | How long since it last moved |

A row indented under another with `↳` is a **subagent** — something the row above
it launched.

### 4. Click it, deal with it, press `Escape`

![The drawer](docs/guide-shots/shot-4-drawer.png)

The drawer holds everything about that one session: what it last said, whether
its process is still alive, and the four buttons that act on it.

| Button | Does |
|---|---|
| **Focus** | Jumps you to that session's terminal window |
| **Send** | Types an instruction into it |
| **Interrupt** | Stops what it is doing |
| **Archive** | Removes a finished session from the board |

The first three need cmux (see the glossary). Without it they grey out with a
reason, and the board still watches everything perfectly well.

**That is the whole loop:** `Needs you` → click the row → deal with it →
`Escape`.

---

## Reference

<details>
<summary><b>The six tabs</b></summary>

| Tab | Shows |
|---|---|
| **Now** | Anything working *or* asking for you. The default, and the one to keep open. |
| **Needs you** | Only sessions waiting on a human. Your to-do list, and the tab the board opens on. |
| **Working** | Currently producing output. |
| **Idle** | Alive but not doing anything right now. |
| **History** | Finished sessions. Collapsed by default — there are usually a lot. |
| **Usage** | Token and cost charts over time, rather than a list. |

`Idle` and `History` also apply a *lookback* window (6 hours by default) that you
can widen from the filter bar.

</details>

<details>
<summary><b>The five summary cards</b></summary>

| Card | What it tells you |
|---|---|
| **Needs you** | How many findings want a human. The only number that is a to-do list. |
| **Momentum** | How many are shipping, and how many have gone quiet for 15+ minutes. |
| **Burn** | Tokens per minute, and dollars per hour if cost data is available. |
| **Context peak** | How full the fullest session's context window is, plus the median. A high peak means someone is about to run out of room. |
| **Health** | One verdict for the whole system. |

Hide, show, and reorder these with **Customize summary**.

</details>

<details>
<summary><b>Keyboard</b></summary>

| Key | Does |
|---|---|
| `↑` / `↓` | Move between rows |
| `Home` / `End` | Jump to the first / last row |
| `Enter` | Open the drawer for the highlighted row |
| `Escape` | Close the drawer |
| `Tab` | Move between buttons and controls |

Arrow keys stop at the top and bottom rather than wrapping, so you cannot
accidentally teleport to the other end of a long board.

</details>

<details>
<summary><b>Glossary</b></summary>

Terms marked *(on screen)* are things you can point at. The rest only come up in
conversation, so you do not go hunting for a button that does not exist.

**Agent** *(on screen)*
: One AI coding session — one `claude` or `codex` command in one terminal, or one
Cursor agent. Every row is one agent. Not a person, not a project: a single
running conversation.

**Program** *(on screen)*
: A group of agents, usually meaning one project folder. The grey bars splitting
the board into sections are programs. Click one to collapse it. Without
configured project names, sessions group by working directory.

**Drawer** *(on screen)*
: The panel that slides in when you click a row. Everything about one agent: last
message, process state, which terminal it is attached to, the action buttons, and
the **Evidence** and **Transcript** sections for raw detail.

**Swarm** *(on screen)*
: When one agent launches others, they form a tree. The board shows this with
indentation and `↳`. Agents can carry roles like *orchestrator*, *frontend*,
*backend*, *verifier*, or *tester*.

**Swarm control** *(on screen, as `Select`)*
: Acting on several agents at once. Click **Select**, tick the agents you want,
and a bar appears letting you send one instruction to all of them (a
**broadcast**). Agents that cannot be safely reached are not selectable, on
purpose.

**Collector**
: The part that reads each tool's log files — one per provider. When a collector
cannot read its files, that provider's data goes stale and Health reports it.

**Snapshot**
: One complete picture of every agent, rebuilt every few seconds and pushed to
your browser. "The board is stale" means the snapshot stopped updating.

**cmux**
: A separate terminal manager. With it, the Ant Hill knows which terminal window
each session lives in, which is what makes **Focus** and **Send** possible.
Without it the dashboard still watches everything; it just refuses to type into a
terminal it cannot positively identify.

**Lane** *(conversation only)*
: One workstream, worked by one agent, on its own git branch. Several run at once
and each lands into `main`. See [DEPLOY.md](./DEPLOY.md).

**Wave** *(conversation only)*
: A batch of work done across several lanes at roughly the same time, then merged
together. "Wave 6" is a round of changes, not a place.

</details>

---

## When something looks wrong

<details>
<summary><b>Health says "Degraded"</b></summary>

`Degraded` means something is not fully healthy, but on its own it does not tell
you whether *you* are blocked. The card also states which of three kinds it is:

| Severity | Meaning | What to do |
|---|---|---|
| **Blocking** | The control plane is unreachable. **Focus and Send do not work.** | Waiting will not fix it. Usually cmux is not running or not set up. |
| **Stale** | The numbers may no longer be true — the live feed or last refresh failed. | Hit **Refresh** on the Health card. |
| **Advisory** | The board is fully usable; some evidence needs tidying. | Nothing urgent. Clean it up later. |

**By far the most common is a cmux-related `Blocking` on a machine where cmux was
never set up.** That is expected, not a fault — the Ant Hill deliberately refuses
to type into a terminal it cannot prove it has identified. If you only want to
watch, ignore it forever. If you want Focus and Send, install cmux and run
`bun run setup:cmux` once.

`Health: Offline` is different: your browser has lost the server entirely. See
"Nothing loads."

</details>

<details>
<summary><b>An agent says "Awaiting first check"</b></summary>

That is the **process liveness** chip in the drawer. It answers what status alone
cannot: *is this session's process actually still alive?* A crashed agent and a
cleanly finished one both just stop, and otherwise look identical.

| Chip | Meaning |
|---|---|
| **Process live** (green) | Still running. |
| **Exited cleanly** (grey) | Finished properly. Done. |
| **Died** (red) | The process is gone and nothing ended cleanly. **This is the one worth looking at.** |
| **Awaiting first check** (grey, dashed) | Not checked yet. Ordinary and temporary. |
| **No process evidence** (grey, dashed) | The session ended and no evidence was captured, so whether it finished or crashed can no longer be recovered. |

No chip at all means the session predates process checking. Absence of evidence
is never displayed as evidence of death, and most finished sessions on a busy
board read **No process evidence**. That is normal.

</details>

<details>
<summary><b>Nothing loads at all</b></summary>

The page not loading means the server is not running — different from
`Degraded`, which means the server *is* running and reporting a problem.

Restart it:

```bash
launchctl kickstart -k gui/$UID/ai.imaginethat.anthill
```

Check it came back — this should print `200`:

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:4701/
```

If that fails, see what is actually up:

```bash
bash ~/Developer/the-mountain-main/scripts/anthill-ps.sh
```

> **Do not start anything on port 4701 by hand.** That port belongs to the
> background service and a hand-started copy will collide with it. To try a
> change safely, run `bash scripts/anthill-preview.sh`, which picks a free
> throwaway port and refuses to touch 4701.
>
> Two ports exist and it confuses everyone once: **4701** is the permanent
> background one. **4702** is what you get from `bun start` by hand.

</details>

<details>
<summary><b>The board is empty</b></summary>

If it says **"The ant hill is still — no tracked agents,"** the server is healthy
and genuinely sees nothing. Either nothing has run recently, or everything has
aged out — only about the last day and a half is scanned by default.

Start a session (`claude` or `codex` in any project folder) and a row should
appear within about five seconds, no refresh needed.

Also check you have not filtered yourself into an empty room: clear the **search
box**, and remember `Idle` and `History` apply their own lookback window.

</details>

<details>
<summary><b>A grey shimmering placeholder sits there</b></summary>

That is the loading skeleton, shown while the first data is fetched. It should be
replaced within a second or two. If it persists, the page is waiting on a server
that is not answering — restart it.

</details>

<details>
<summary><b>Costs are blank, or say "cost unavailable"</b></summary>

Dollar figures come from a separate tool (OpenBurnBar). Without it, the Ant Hill
shows cost as unavailable rather than inventing a `$0`. Token counts still work.

</details>

<details>
<summary><b>A session shows "not reported" for context or tokens</b></summary>

Not every provider reports the same numbers. Claude transcripts report tokens
used but not always the size of the context window, and without both, a truthful
"% full" cannot be calculated — so the dashboard shows the raw token count
instead of guessing a percentage.

</details>

---

## Where to go next

| Document | Covers |
|---|---|
| [QUICKSTART.md](./QUICKSTART.md) | Installing it on a fresh machine |
| [DEPLOY.md](./DEPLOY.md) | Ports, deploying, previewing changes safely |
| [README.md](./README.md) | Technical overview and the data-truth rules |
| [TRIAGE-WORKFLOW.md](./TRIAGE-WORKFLOW.md) | The investigation and triage flow |
| [ARCHITECTURE.md](./ARCHITECTURE.md) | How the pieces fit together |
