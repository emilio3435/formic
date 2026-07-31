# The Ant Guide

A field guide to reading and using the Ant Hill dashboard.

**This guide assumes you have never seen this thing before.** It does not assume
you write code. If you want to *install* the Ant Hill on a new machine, that is
[QUICKSTART.md](./QUICKSTART.md) — this guide is about *using* one that is
already running.

---

## What this thing is

Several AI coding assistants (Claude Code, Codex, Cursor) can be working on your
machine at the same time, each in its own terminal window. That is great until
you have six of them and no idea which one finished, which one crashed, and
which one has been sitting there for twenty minutes waiting for you to answer a
question.

The Ant Hill is one screen that answers that. It reads the log files those tools
already write and shows you every session in one list.

It is **read-only by default** and entirely local. Nothing leaves `127.0.0.1`,
and it never opens or sends your source code.

---

## 1. Quick start

### Open it

```
http://127.0.0.1:4701
```

That is the always-on dashboard. If the page does not load at all, jump to
[“Nothing loads”](#nothing-loads-at-all) at the bottom.

> Two ports exist and it confuses everyone once: **4701** is the permanent one
> that runs in the background. **4702** is what you get if you start a copy by
> hand with `bun start`. Use 4701 unless you were told otherwise.

### What you are looking at

The screen has four bands, top to bottom:

1. **The header** — the name, and a badge on the right that should say **Live**.
2. **Summary** — five cards giving you the whole fleet at a glance.
3. **The board** — the actual list of sessions, grouped by project.
4. **The drawer** — slides in on the right when you click a row.

### What to click first

1. **Look at the badge in the top right.** If it says `Live`, the page is
   receiving updates in real time and you never need to refresh it. Leave it open
   on a second monitor and it stays current on its own.
2. **Look at the `Needs you` card** in the Summary row. That number is the only
   one that means "stop reading and go do something." Zero means nothing is
   waiting on you.
3. **Click the `Alerts` tab.** This is the shortlist: only sessions that are
   actually asking for a human. If it is empty, everything is either working or
   done.
4. **Click any row.** The drawer opens on the right with the full story for that
   one session — what it last said, which terminal it lives in, and the buttons
   to act on it.
5. **Press `Escape`** to close the drawer again.

That is the whole loop: *Needs you → Alerts tab → click the row → deal with it.*

---

## 2. The layout

```
┌────────────────────────────────────────────────────────────────────────────┐
│  The Ant Hill                              [Alerts off]  ● Live            │  ← header
│  Live multi-agent control room                                             │
├────────────────────────────────────────────────────────────────────────────┤
│  Summary                                            [Customize summary]    │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌────────────┐ ┌────────────────┐  │
│  │ NEEDS    │ │ MOMENTUM │ │ BURN     │ │ CONTEXT    │ │ HEALTH         │  │  ← summary
│  │ YOU      │ │          │ │          │ │ PEAK       │ │                │  │
│  │ 2        │ │ 3        │ │ 41k /min │ │ 14%        │ │ Operational    │  │
│  │ findings │ │ shipping │ │          │ │ peak window│ │                │  │
│  │ Codex ·  │ │ ↑2 done  │ │ $2.10    │ │ Peak 14% · │ │ 4/4 sources    │  │
│  │ migration│ │ this hour│ │ last hour│ │ Median 9%  │ │ healthy        │  │
│  └──────────┘ └──────────┘ └──────────┘ └────────────┘ └────────────────┘  │
│    ↑ big number, then the small print under it explains where it came from  │
├──────────────────────────────────────────────┬─────────────────────────────┤
│ [Now] [Alerts] [Working] [Idle] [History]    │                             │
│ [Usage]                          ← tabs      │      THE DRAWER             │
│                                              │                             │
│ [search………………]  [Select]  [Action log]      │  Opens when you click a     │
│ 12 shown · 6 live · 157 tracked  ← scope     │  row. Holds everything      │
│                                              │  about ONE session:         │
│ ▼ my-project              3 agents 1 alert   │                             │
│ ┌──────────────────────────────────────────┐ │   · what it last said       │
│ │ Claude · api-refactor    Working  14% ▮  │ │   · Process live / Died     │
│ │   "Running the test suite…"   12k   4m   │ │   · which terminal it is in │
│ ├──────────────────────────────────────────┤ │   · Focus / Send /          │
│ │ Codex · migration       ▌ALERT   22% ▮▮  │ │     Interrupt / Archive     │
│ │   "Needs your permission"      8k   1m   │ │   · Evidence · Transcript   │
│ ├──────────────────────────────────────────┤ │                             │
│ │  ↳ Cursor · subagent     Idle     4% ▮   │ │  Escape closes it.          │
│ └──────────────────────────────────────────┘ │                             │
│ ▶ another-project         8 agents           │                             │
│                                              │                             │
│        ↑ the board                           │                             │
└──────────────────────────────────────────────┴─────────────────────────────┘
```

Each row reads left to right: **who it is** (provider + name), **what it last
said**, then a right-hand instrument cluster — **status**, **model and context
%**, **tokens**, **time since it last moved**.

A row indented under another with a `↳` is a **subagent**: something the row
above it launched.

### The tabs

| Tab | Shows |
|---|---|
| **Now** | Anything working *or* asking for you. The default, and the one to keep open. |
| **Alerts** | Only sessions waiting on a human. Your to-do list. |
| **Working** | Currently producing output. |
| **Idle** | Alive but not doing anything right now. |
| **History** | Finished sessions. Collapsed by default — there are usually a lot. |
| **Usage** | Token and cost charts over time, rather than a list. |

### The Summary cards

| Card | What it tells you |
|---|---|
| **Needs you** | How many findings want a human. **The only number that is a to-do list.** |
| **Momentum** | How many are shipping, and how many have gone quiet for 15+ minutes. |
| **Burn** | Tokens per minute and dollars per hour, if cost data is available. |
| **Context peak** | How full the fullest session's context window is, plus the median. High peak = someone is about to run out of room. |
| **Health** | One verdict for the whole system: `Operational`, `Degraded`, or `Offline`. |

You can hide, show and reorder these with **Customize summary**.

### Keyboard

| Key | Does |
|---|---|
| `↑` / `↓` | Move between rows |
| `Home` / `End` | Jump to the first / last row |
| `Enter` | Open the drawer for the highlighted row |
| `Escape` | Close the drawer |
| `Tab` | Move between buttons and controls |

Arrow keys stop at the top and bottom rather than wrapping around, so you cannot
accidentally teleport to the other end of a long board.

---

## 3. Glossary

Terms you will hear around this project. Some are on the screen; some are only
in conversation and in the code. That distinction is marked, so you do not go
hunting for a button that does not exist.

**Agent** *(on screen)*
: One AI coding session. One `claude` or `codex` command in one terminal, or one
Cursor agent. Every row on the board is one agent. It is not a person and not a
project — it is a single running conversation.

**Program** *(on screen)*
: A group of agents, usually meaning "one project folder." The grey bars that
split the board into sections are programs. Click one to collapse or expand it.
If you have not configured project names, sessions are grouped by working
directory instead.

**Drawer** *(on screen)*
: The panel that slides in from the right when you click a row. Everything about
one agent lives there: its last message, its process state, which terminal it is
attached to, the action buttons, and the **Evidence** and **Transcript**
sections if you want the raw detail. `Escape` closes it.

**Swarm** *(on screen)*
: When one agent launches other agents to work for it, they form a tree — a
parent with children. The board shows this with indentation and a `↳`. Agents can
carry roles like *orchestrator*, *frontend*, *backend*, *verifier*, or *tester*.

**Swarm control** *(on screen, as `Select`)*
: Acting on several agents at once instead of one at a time. Click **Select** in
the toolbar, tick the agents you want, and a bar appears at the bottom letting
you send one instruction to all of them (a **broadcast**). Agents that cannot be
safely reached are not selectable, on purpose.

**Lane** *(conversation only — not on the dashboard)*
: One workstream, worked by one agent, on its own git branch. "The backend lane"
means the agent and branch handling backend work. Several lanes run at once and
each lands its finished work into `main`. See [DEPLOY.md](./DEPLOY.md).

**Wave** *(conversation only — not on the dashboard)*
: A batch of work done across several lanes at roughly the same time, then merged
together. "Wave 6" is a round of changes, not a place.

**Collector**
: The part of the Ant Hill that reads each tool's log files. There is one per
provider (Claude, Codex, Cursor). When a collector cannot read its files, that
provider's data goes stale and Health reports it.

**Snapshot**
: One complete picture of every agent, rebuilt by the server every few seconds
and pushed to your browser. When people say "the board is stale," they mean the
snapshot stopped updating.

**cmux**
: A separate terminal manager. If it is installed and set up, the Ant Hill can
tell which terminal window each session lives in — which is what makes **Focus**
and **Send** possible. Without it, the dashboard still watches everything
perfectly well; it just refuses to type into a terminal it cannot positively
identify.

**Focus / Send / Interrupt / Archive** *(on screen, in the drawer)*
: The four actions. **Focus** jumps you to that session's terminal window.
**Send** types an instruction into it. **Interrupt** stops what it is doing.
**Archive** removes a finished session from the board. The first three need cmux;
they appear greyed out with a reason when they cannot be routed.

---

## 4. Troubleshooting

### What does “Degraded” mean?

It means *something* is not fully healthy — but on its own it does not tell you
whether you are blocked. So the dashboard also states which of three kinds it is:

| Severity | Meaning | What to do |
|---|---|---|
| **Blocking** | The control plane is unreachable. **Focus and Send do not work.** | Waiting will not fix it. Usually cmux is not running or not set up. |
| **Stale** | The numbers on screen may no longer be true — the live feed or the last refresh failed. | Hit the **Refresh** affordance on the Health card. |
| **Advisory** | The board is fully usable; some evidence needs tidying (e.g. identity conflicts). | Nothing urgent. Someone can clean it up later. |

**The most common one by far is a cmux-related `Blocking` on a machine where
cmux was never set up.** That is expected, not a fault: the Ant Hill deliberately
refuses to type into a terminal it cannot prove it has identified correctly. It
will keep watching everything correctly. If you only want to *watch*, you can
ignore it forever. If you want Focus and Send, install cmux and run
`bun run setup:cmux` once.

`Health: Offline` is different — that means your browser has lost the server
entirely. See “Nothing loads,” below.

### Why does an agent say “Awaiting first check”?

That is the **process liveness** chip in the drawer. It answers a question the
status alone cannot: *is this session's process actually still alive?* A crashed
agent and a cleanly finished one both just stop, and they look identical
otherwise.

| Chip | Meaning |
|---|---|
| **Process live** (green) | The process is still running. |
| **Exited cleanly** (grey) | It finished properly. This one is done. |
| **Died** (red) | The process is gone and nothing ended cleanly. It stopped without finishing — this is the one worth looking at. |
| **Awaiting first check** (grey, dashed) | The Ant Hill has not managed to check this session's process yet. Ordinary and temporary. |
| **No process evidence** (grey, dashed) | The session already ended and no process evidence was ever captured, so whether it finished or crashed can no longer be recovered. |

If there is **no chip at all**, the session predates process checking entirely.
That is deliberate: absence of evidence is never displayed as evidence of death.

Most finished sessions on a busy board read **No process evidence**. That is
normal and is not a fault to chase.

### How do I restart it?

The dashboard on **:4701** runs in the background as a system service. Restart
it with:

```bash
launchctl kickstart -k gui/$UID/ai.imaginethat.anthill
```

Give it a few seconds, then reload the page. To see what is actually running:

```bash
bash ~/Developer/the-mountain-main/scripts/anthill-ps.sh
```

> **Do not start anything on port 4701 by hand.** That port belongs to the
> background service, and a hand-started copy will collide with it. To try out a
> change safely, use `bash scripts/anthill-preview.sh`, which picks a free
> throwaway port and refuses to touch 4701.

### Nothing loads at all

The page not loading means the server is not running — this is different from
`Degraded`, which means the server is running and reporting a problem.

1. Restart it with the `launchctl` command above.
2. Check it came back: `curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:4701/`
   should print `200`.
3. If that fails, run `bash ~/Developer/the-mountain-main/scripts/anthill-ps.sh`
   to see what is actually up.

### The board is empty

If it says **“The ant hill is still — no tracked agents,”** the server is healthy
and genuinely sees nothing. Either nothing has run recently, or everything that
ran has aged out — only sessions from roughly the last day and a half are
scanned by default.

Start a session (`claude` or `codex` in any project folder) and a row should
appear within about five seconds, with no refresh needed.

Also check you are not filtering yourself into an empty room: clear the **search
box**, and note that the **Idle** and **History** tabs additionally apply a
*lookback* window (6 hours by default) which you can widen from the filter bar.

### A grey shimmering placeholder sits there

That is the loading skeleton, shown while the first data is still being fetched.
It should be replaced within a second or two. If it persists, the page is waiting
on a server that is not answering — restart it.

### Costs show blank, or “cost unavailable”

Dollar figures come from a separate tool (OpenBurnBar). Without it, the Ant Hill
shows cost as unavailable rather than inventing a `$0`. Token counts still work.

### A session shows “not reported” for context or tokens

Not every provider reports the same numbers. Claude transcripts, for instance,
report tokens used but not always the size of the context window — and without
both, a truthful "% full" cannot be calculated, so the dashboard shows the raw
token count instead of guessing a percentage.

This is a theme worth internalising: **when the Ant Hill does not know something,
it says so rather than showing a plausible number.** A blank is usually honest,
not broken.

---

## 5. Where to go next

| Document | Covers |
|---|---|
| [QUICKSTART.md](./QUICKSTART.md) | Installing it on a fresh machine |
| [DEPLOY.md](./DEPLOY.md) | Ports, deploying, previewing changes safely |
| [README.md](./README.md) | The technical overview and data-truth rules |
| [TRIAGE-WORKFLOW.md](./TRIAGE-WORKFLOW.md) | The investigation and triage flow |
| [ARCHITECTURE.md](./ARCHITECTURE.md) | How the pieces fit together |
