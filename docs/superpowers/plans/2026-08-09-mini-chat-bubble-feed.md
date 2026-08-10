# Mini-Chat Bubble Feed Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The drawer's chat box interior becomes the transcript itself — auto-loaded on drawer open, rendered as message bubbles filling the whole feed — with every piece of information appearing exactly once.

**Architecture:** The `.drawer-chat-scroll` feed renders ONE body: transcript bubbles when `state.transcript` holds lines for this agent, or the existing `renderChat` preview as fallback (loading / errored / absent). The transcript panel's section-title + head chrome collapse into one quiet footer strip (`renderTranscriptFoot`, in transcript.js) between the feed and the composer. `selectEntity` (the unified drawer entry — the spec's "openInspector") fires the same fetch the Load button fires today. Bubbles live in app.js (`chatBubbleNode` + `renderChatFeedBody`) because they need the sender-header helpers; transcript.js keeps fetch/normalize/window/controls ownership.

**Tech Stack:** Vanilla JS DOM via `el()`/`icon()` (dom-primitives), bun test with the repo's fake-DOM harness (`withDom`/`withState`/`withRequests`), plain CSS under strict CSP (`style-src 'self'` — classes only, never `style` attributes), /browse for screenshots.

## Global Constraints

- Meta line per bubble: **12px mono**, role + relative time (`agoText`).
- Agent bubbles left-aligned on `--raise`; operator bubbles right-aligned, visually distinct; tool/system turns as quiet single-line rows reusing `.tr-line`'s `data-role` color accents (assistant `--moss`, user `--slate`, tool `--line-strong`/`--clay`, system `--amber`).
- Untrusted transcript text reaches the DOM ONLY via `el({ text })` (textContent) — never innerHTML, never attributes.
- No inline `style` attributes anywhere (CSP drops them wholesale) — classes only.
- `renderChat`/`renderChatTurn` bodies stay byte-identical; test `(2b) the task never prints as both the objective and a Thread turn` (tests/web-client.test.ts:6919) must pass untouched.
- `_chatScrollMemo` repaint behavior and the composer (dock) placement stay exactly as today (app.js:9432-9463).
- Every new CSS class is emitted by client code; every emitter this change deletes has its CSS deleted in the same program (test `(8) every class in styles.css is emitted by the client` is baseline-failing — its orphan list must not grow).
- Gate: `bunx tsc --noEmit` exit 0; `bun test tests/web-client.test.ts tests/cwd-adversarial.test.ts` fails ONLY the baseline set below (spec said "14 pre-existing failures"; measured 13 on 2026-08-09 in these two suites — re-measure in Task 0 and treat the measured *named set* as the invariant).
- Screenshots before AND after at **1440px and 860px** viewport widths.
- Shared-worktree git rules: `git rev-parse --abbrev-ref HEAD` before every commit (expect `chore/docker-local-ci`); commit ONLY named paths via `git commit -m "…" -- <paths>` (never a bare `git add`+`git commit` — the index is shared); forward-only, never amend.

**Baseline failing tests (measured 2026-08-09, tsc exit 0):**
1. `provider-aware row summaries > keeps the raw transcript tail in Chat/Evidence, not Operate`
2. `agent rows: instrument cluster + de-noise (C1) > (h2) the role chip left the row; the model-policy chip left the product`
3. `agent drawer — Thread · Evidence > bookshelf shelf replaces tabs: Thread open, Evidence behind the caterpillar rail`
4. `agent drawer — Thread · Evidence > Names rename UI stays collapsed under a disclosure`
5. `agent drawer — Thread · Evidence > Evidence carries neutral directory provenance and token-scope tooltips`
6. `verdict head — act from the top (B2) > drawer order: verdict head → banner → vitals mount → shelf → lineage → dock`
7. `vitals instrument band (B3) > (b) the band never invents a denominator, and the deleted tiles stay deleted`
8. `vitals instrument band (B3) > (d) renderAgentDrawer fills the .inspector-vitals mount with the band, before the shelf`
9. `FE-B: harness-backed client behavior > (8) every class in styles.css is emitted by the client`
10. `FE-B: harness-backed client behavior > (FE2-D5) the sentence renders only the lenses that are on, and reconciles the numbers`
11. `FE-B: harness-backed client behavior > (FE4-D4) the sentence sits between the lenses and the working-set control`
12. `FE-B: harness-backed client behavior > (5) the agent drawer builds one Thread pane + the Evidence rail, and no swarm section`
13. `FE-C: the transcript is readable inside the drawer > (2) the panel lives in Evidence, and a landed fetch actually repaints it`

Note on #13: it calls `M.renderTranscriptPanel`, which Task 3 deletes. It will keep failing under the same name (TypeError instead of assertion). That satisfies "unchanged set". Do not edit it.

**Known edge (documented, out of scope):** a transcript whose kickoff user turn is verbatim `agent.task` would show that prose in both the Task card and the first bubble. The spec keeps the Task card and makes the feed the verbatim record; the preview-bubble/`drawerObjective` dedup machinery is fallback-only by design. The 200-turn default window makes the kickoff turn practically always scrolled out. Do not add transcript-vs-task dedup.

## File Map

- Modify: `src/web/app.js` — new `chatBubbleNode`, `renderChatFeedBody`, `shouldAutoLoadTranscript`; drawer wiring at ~9410-9430; auto-load in `selectEntity` (~8329); imports (~line 26-28) and the `M` export block (~1477-1483).
- Modify: `src/web/transcript.js` — `renderTranscriptFoot` added; `renderTranscriptPanel`, `anchorLog`, `logScroll` deleted (Task 3).
- Modify: `src/web/styles.css` — new `.chat-msg*` / `.chat-feed*` rules in the integration layer (~4291+); dead `.drawer-transcript*` / `.transcript-view` / `.transcript-head` / `.transcript-log` rules deleted.
- Modify: `tests/web-client.test.ts` — rewrite the four `renderTranscriptPanel` behavior tests + the live-route test to the body/foot surface; add exactly-once, bubble-semantics, and auto-load tests.
- Create: `docs/rhs-shots/mini-chat-feed/{before,after}-{1440,860}.png`.

---

### Task 0: Baseline + before screenshots

**Files:**
- Create: `docs/rhs-shots/mini-chat-feed/before-1440.png`, `docs/rhs-shots/mini-chat-feed/before-860.png`

- [ ] **Step 1: Re-measure the failing-test baseline**

Run:
```bash
cd /Users/emilionunezgarcia/Developer/the-mountain-main
bunx tsc --noEmit && echo TSC-OK
bun test tests/web-client.test.ts tests/cwd-adversarial.test.ts 2>&1 | grep -E "^\(fail\)" | sort > /tmp/feed-baseline-failures.txt
wc -l /tmp/feed-baseline-failures.txt
```
Expected: `TSC-OK`; the file lists the 13 names above (or whatever today measures — that list is now the invariant). Keep `/tmp/feed-baseline-failures.txt` for the final gate diff.

- [ ] **Step 2: Serve THIS worktree**

The live board on :4701 may be served from the sibling `the-mountain` checkout. Run a dedicated instance from this worktree so before/after shots show this branch:
```bash
grep -n "MOUNTAIN_PORT\|PORT" src/server/index.ts scripts/anthill-start.sh | head
MOUNTAIN_PORT=4799 bun src/server/index.ts &   # adjust env/flag to what the grep shows
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:4799/
```
Expected: `200`. (If the port env is named differently, use what index.ts actually reads.)

- [ ] **Step 3: Before screenshots via /browse (never claude-in-chrome)**

Invoke the `/browse` skill: open `http://localhost:4799`, click a live agent row to open its drawer, capture at viewport widths 1440 and 860, save as `docs/rhs-shots/mini-chat-feed/before-1440.png` and `before-860.png`. The shot must show the current AGENT/YOU preview bubbles + "Transcript — last 3 turns" shell (after pressing "Read the transcript" so the old loaded state is on record).

- [ ] **Step 4: Commit**

```bash
git rev-parse --abbrev-ref HEAD   # expect chore/docker-local-ci
git commit -m "docs(drawer): before shots for mini-chat bubble feed [drawer-overhaul]" -- docs/rhs-shots/mini-chat-feed
```

---

### Task 1: Bubble renderers in app.js

**Files:**
- Modify: `src/web/app.js` (new functions immediately after `renderChat`, ~line 10480; import + export edits)
- Test: `tests/web-client.test.ts`

**Interfaces:**
- Consumes: `transcriptLineNode(line)`, `transcriptWindow(lines)`, `TRANSCRIPT_ROLE_LABELS` (exports of `src/web/transcript.js`); `senderView(text, ui)` (app.js:10344), `withoutSenderHeader`, `senderClaimText` (presentation.js, already imported); `agoText` (already imported); `el`, `icon`.
- Produces: `chatBubbleNode(line, agent, ui) -> Element` and `renderChatFeedBody(agent, ui = state, opts = {}) -> Element` — feed body is `.chat-feed` of `.chat-msg` bubbles + `.tr-line` rows when transcript lines are held for this agent, otherwise exactly `renderChat(agent, ui, opts)`. Both added to the `M` export block for tests.

- [ ] **Step 1: Write the failing tests**

Add to `tests/web-client.test.ts` inside the `FE-C: the transcript is readable inside the drawer` describe (near line 10138), reusing that block's `agent`, `transcriptUi`, `withDom`, `byClass`, `allByClass`, `textOf` helpers:

```ts
test("(2) bubbles: roles, meta, quiet rows, TL;DR and sender marks keep their semantics", () => {
  // Mirror the fixture style of the sender-verdict test (~:12290): the claimed
  // text must equal senderClaimText(agent) — check presentation.js:710 for the
  // field it reads (lastUserMessage carries the claim today) and match it.
  const claimed = "[from codex:a2 run 0runX] board is green";
  const a = agent({ senderVerified: false, lastUserMessage: claimed });
  const lines = [
    { at: "2026-08-09T12:00:00.000Z", role: "user", text: claimed },
    { at: null, role: "assistant", text: "[TL;DR] heartbeat OK" },
    { at: null, role: "tool", text: "ran bun test" },
    { at: null, role: "system", text: "compact boundary" },
  ];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const body: any = withDom(() => M.renderChatFeedBody(a, transcriptUi({
    agentId: a.id, data: { source: "/tmp/t.jsonl", truncated: false, lines },
  })));
  const bubbles = allByClass(body, "chat-msg");
  expect(bubbles).toHaveLength(2); // user + assistant bubble; tool/system are rows
  const user = bubbles[0];
  expect(user.dataset.role).toBe("user");
  // Sender envelope: stripped from the prose, resolved into the meta line,
  // and the server's non-verdict carried as the mark — today's semantics.
  expect(textOf(byClass(user, "chat-msg-body"))).toBe("board is green");
  expect(textOf(byClass(user, "chat-msg-meta"))).toContain("0runX");
  expect(byClass(user, "sender-unconfirmed")).not.toBeNull();
  // Relative time renders for a stamped line, absent otherwise.
  expect(byClass(user, "chat-msg-at")).not.toBeNull();
  expect(byClass(bubbles[1], "chat-msg-at")).toBeNull();
  // The [TL;DR] heartbeat is an assistant bubble like any other turn.
  expect(bubbles[1].dataset.role).toBe("assistant");
  expect(textOf(bubbles[1])).toContain("[TL;DR]");
  // Tool/system: quiet single-line rows with the .tr-line role accents.
  expect(allByClass(body, "tr-line").map((n: any) => n.dataset.role)).toEqual(["tool", "system"]);
  // The verdict belongs to ONE turn — the assistant bubble is unmarked.
  expect(byClass(bubbles[1], "sender-unconfirmed")).toBeNull();
});

test("(2) bubble text is text, never markup; the fallback body is renderChat", () => {
  const hostile = "<img src=x onerror=alert(1)> & <script>steal()</script>";
  const a = agent();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const loaded: any = withDom(() => M.renderChatFeedBody(a, transcriptUi({
    agentId: a.id, data: { source: "/tmp/t.jsonl", truncated: false, lines: [{ at: null, role: "assistant", text: hostile }] },
  })));
  const body = byClass(loaded, "chat-msg-body");
  expect(body.textContent).toBe(hostile);
  expect(body.children).toHaveLength(0);
  // No transcript held for this agent -> the body IS the preview thread.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fallback: any = withDom(() => M.renderChatFeedBody(agent({ lastAgentMessage: "done" }), transcriptUi({})));
  expect(allByClass(fallback, "chat-msg")).toHaveLength(0);
  expect(allByClass(fallback, "chat-turn-body")).toHaveLength(1);
});

test("(2) another agent's transcript never bleeds into this feed", () => {
  const a = agent();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const body: any = withDom(() => M.renderChatFeedBody(a, transcriptUi({
    agentId: "claude:someone-else",
    data: { source: "/tmp/other.jsonl", truncated: false, lines: [{ at: null, role: "assistant", text: "NOT MINE" }] },
  })));
  expect(textOf(body)).not.toContain("NOT MINE");
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `bun test tests/web-client.test.ts -t "bubbles: roles"` etc.
Expected: FAIL — `M.renderChatFeedBody is not a function`.

- [ ] **Step 3: Implement**

In `src/web/app.js`, extend the transcript import (line ~26-28) to also bring in `transcriptLineNode`, `transcriptWindow` (if not already imported there — `transcriptWindow` is re-exported at ~1481, so it is; add `transcriptLineNode`, `TRANSCRIPT_ROLE_LABELS`). Then add after `renderChat` (~line 10480):

```js
/* One transcript line as a chat bubble. The meta line is the 12px mono strip:
   who spoke (the resolved sender when the line carries a producer envelope,
   the role label otherwise) and when, relative. The sender-verdict semantics
   are renderChatTurn's, unchanged: the mark states the server's finding on the
   ONE text it actually checked, and an absent verdict marks nothing. */
function chatBubbleNode(line, agent, ui = state) {
  const sender = senderView(line.text, ui);
  const unconfirmed = sender && agent.senderVerified === false && line.text === senderClaimText(agent);
  return el("div", { class: "chat-msg", dataset: { role: line.role } },
    el("div", { class: "chat-msg-meta" },
      el("span", { class: "chat-msg-role", text: sender ? sender.name : (TRANSCRIPT_ROLE_LABELS[line.role] || line.role) }),
      sender ? el("span", { class: "chat-msg-run", text: "run " + sender.runId }) : null,
      line.at ? el("span", { class: "chat-msg-at", title: line.at, text: agoText(line.at) }) : null),
    unconfirmed
      ? el("div", {
        class: "sender-unconfirmed",
        title: "The claimed sender's own transcript does not contain this message. Treat the attribution as unproven and check the sender before acting on it.",
      }, icon("warning"), el("span", { text: "Sender unconfirmed" }))
      : null,
    // UNTRUSTED. textContent via el({ text }) — never innerHTML.
    el("p", { class: "chat-msg-body", tabindex: "0", text: sender ? withoutSenderHeader(line.text) : line.text }));
}

/* The feed's one body. The transcript, when it is held for THIS agent, rendered
   as bubbles — user/assistant speak, tool/system stay quiet .tr-line rows.
   Otherwise the preview thread (renderChat) stands in: loading, errored, or a
   session with no record yet. renderChat survives ONLY as this fallback. */
function renderChatFeedBody(agent, ui = state, opts = {}) {
  const view = (ui && ui.transcript) || {};
  const lines = view.agentId === agent.id && view.data && view.data.lines.length
    ? transcriptWindow(view.data.lines).shown
    : null;
  if (!lines) return renderChat(agent, ui, opts);
  const body = el("div", { class: "chat-feed" });
  for (const line of lines) {
    body.append(line.role === "user" || line.role === "assistant"
      ? chatBubbleNode(line, agent, ui)
      : transcriptLineNode(line));
  }
  return body;
}
```

Add `chatBubbleNode, renderChatFeedBody,` to the `M` export block (app.js ~1481, next to `renderTranscriptPanel`).

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/web-client.test.ts 2>&1 | grep -E "^\(fail\)" | sort | diff /tmp/feed-baseline-failures.txt -`
Expected: no diff (baseline only; note cwd-adversarial isn't in this run — the baseline file mixes both, so run both suites for the diff as in Task 0 Step 1).

- [ ] **Step 5: Commit**

```bash
git rev-parse --abbrev-ref HEAD
git commit -m "feat(drawer): transcript lines render as chat bubbles (renderChatFeedBody) [drawer-overhaul]" -- src/web/app.js tests/web-client.test.ts
```

---

### Task 2: The quiet footer (transcript.js)

**Files:**
- Modify: `src/web/transcript.js`
- Test: `tests/web-client.test.ts`

**Interfaces:**
- Consumes: `loadTranscript`, `transcriptWindow`, `nextTranscriptLimit`, `el` (all already in transcript.js scope).
- Produces: `export function renderTranscriptFoot(agent, ui = state) -> Element` — one `.chat-feed-foot` line carrying, per state: unloaded → `transcript-load:<id>` button; loading → status text; error → text + `transcript-retry:<id>`; empty → the honest empty sentence; loaded → count + truncation note + `code.transcript-source-path` + `transcript-refresh:<id>` (+ `transcript-more:<id>` below the limit ceiling). Same fkeys and copy as today's `transcript-head`. Exported through the `M` block. `renderTranscriptPanel` stays alive until Task 3.

- [ ] **Step 1: Write the failing test**

Replace the body of test `(2) the drawer covers all four states: unloaded, empty, loaded, failed` (tests/web-client.test.ts:10154-10196) — the intent (four honest states, keyed controls, bounded nodes) now lives on the body/foot pair:

```ts
test("(2) the feed covers all four states: unloaded, empty, loaded, failed", () => {
  const a = agent();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const foot = (over: Record<string, unknown>): any =>
    withDom(() => M.renderTranscriptFoot(a, transcriptUi(over)));

  // Unloaded: the manual path survives as the foot's one control.
  const idle = foot({});
  expect(textOf(idle)).toContain("Read the transcript");
  expect(buttonsOf(idle)[0].dataset.fkey).toBe("transcript-load:codex:a1");

  // Loading: a stated status; loadTranscript always settles.
  expect(textOf(foot({ agentId: a.id, loading: true }))).toContain("Reading the transcript");

  // Failed: the reason, plus a way out.
  const failed = foot({ agentId: a.id, error: "Transcript view is not available in this build." });
  expect(textOf(failed)).toContain("not available in this build");
  expect(buttonsOf(failed).map((b: { dataset: { fkey: string } }) => b.dataset.fkey)).toEqual(["transcript-retry:codex:a1"]);

  // Empty: honest about which kind of empty; the body falls back, never invents a turn.
  const noFile = foot({ agentId: a.id, data: { source: null, truncated: false, lines: [] } });
  expect(textOf(noFile)).toContain("No transcript file is recorded");
  expect(textOf(foot({ agentId: a.id, data: { source: "/tmp/t.jsonl", truncated: false, lines: [] } }))).toContain("no readable turns");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const emptyBody: any = withDom(() => M.renderChatFeedBody(a, transcriptUi({ agentId: a.id, data: { source: null, truncated: false, lines: [] } })));
  expect(allByClass(emptyBody, "chat-msg")).toHaveLength(0);

  // Loaded: bubbles capped at the render window; count, source, keyed controls.
  const lines = Array.from({ length: 400 }, (_, i) => ({ at: null, role: "assistant", text: "turn " + i }));
  const over = { agentId: a.id, limit: 500, data: { source: "/tmp/t.jsonl", truncated: true, lines } };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const body: any = withDom(() => M.renderChatFeedBody(a, transcriptUi(over)));
  expect(allByClass(body, "chat-msg")).toHaveLength(300);
  const loaded = foot(over);
  expect(textOf(loaded)).toContain("Last 300 of 400");
  expect(textOf(loaded)).toContain("older turns exist above this window");
  expect(textOf(loaded)).toContain("/tmp/t.jsonl");
  expect(buttonsOf(loaded).map((b: { dataset: { fkey: string } }) => b.dataset.fkey))
    .toEqual(["transcript-refresh:codex:a1", "transcript-more:codex:a1"]);
  // At the ceiling there is no "load more" to offer.
  const maxed = foot({ ...over, limit: 1000 });
  expect(buttonsOf(maxed).map((b: { dataset: { fkey: string } }) => b.dataset.fkey))
    .toEqual(["transcript-refresh:codex:a1"]);
});
```

Also update `(2) another agent's transcript never bleeds…` (10198-10207): keep the Task 1 body assertion and move its second expectation to the foot: `expect(textOf(withDom(() => M.renderTranscriptFoot(a, transcriptUi({ agentId: "claude:someone-else", … }))))).toContain("Read the transcript")`.

- [ ] **Step 2: Run to verify failure**

Run: `bun test tests/web-client.test.ts -t "the feed covers all four states"`
Expected: FAIL — `M.renderTranscriptFoot is not a function`.

- [ ] **Step 3: Implement in transcript.js**

Add below `renderTranscriptPanel` (leave the panel untouched for now):

```js
/* The panel's chrome, folded into one quiet line for the chat box's foot: what
   is loaded, where it came from, and the controls that change that. The feed
   above stays bubbles edge to edge; this line is the only place the raw
   source path and the Load/Refresh ladder survive. Same fkeys as before, so
   focus restoration across repaints keeps working unchanged. */
export function renderTranscriptFoot(agent, ui = state) {
  const view = (ui && ui.transcript) || {};
  const foot = el("div", { class: "chat-feed-foot" });
  if (view.agentId !== agent.id) {
    foot.append(el("button", {
      type: "button", class: "btn sm transcript-load",
      dataset: { fkey: "transcript-load:" + agent.id },
      onclick: () => void loadTranscript(agent.id),
    }, "Read the transcript"));
    return foot;
  }
  if (view.loading) {
    foot.append(el("span", { class: "transcript-source", role: "status", text: "Reading the transcript…" }));
    return foot;
  }
  if (view.error) {
    foot.append(
      el("span", { class: "transcript-source err", role: "status", text: view.error }),
      el("button", {
        type: "button", class: "btn sm transcript-load",
        dataset: { fkey: "transcript-retry:" + agent.id },
        onclick: () => void loadTranscript(agent.id, view.limit),
      }, "Try again"));
    return foot;
  }
  const data = view.data || { lines: [], source: null, truncated: false };
  if (!data.lines.length) {
    foot.append(el("span", {
      class: "transcript-source",
      text: data.source
        ? "The transcript file is present but has no readable turns."
        : "No transcript file is recorded for this session.",
    }));
  } else {
    const win = transcriptWindow(data.lines);
    foot.append(el("span", {
      class: "transcript-source",
      text: win.hidden
        ? "Last " + win.shown.length + " of " + win.total + " loaded turns"
        : win.total + (win.total === 1 ? " turn" : " turns"),
    }));
    if (data.truncated) foot.append(el("span", { class: "transcript-more", text: "· older turns exist above this window" }));
  }
  if (data.source) foot.append(el("code", { class: "transcript-source-path", text: data.source }));
  foot.append(el("button", {
    type: "button", class: "btn sm transcript-load",
    dataset: { fkey: "transcript-refresh:" + agent.id },
    onclick: () => void loadTranscript(agent.id, view.limit),
  }, "Refresh"));
  const more = nextTranscriptLimit(view.limit);
  if (more && data.truncated) {
    foot.append(el("button", {
      type: "button", class: "btn sm transcript-load",
      dataset: { fkey: "transcript-more:" + agent.id },
      onclick: () => void loadTranscript(agent.id, more),
    }, "Load " + more));
  }
  return foot;
}
```

In app.js: import `renderTranscriptFoot` next to `renderTranscriptPanel` (~line 28) and add it to the `M` export block (~1481).

- [ ] **Step 4: Run and verify green vs baseline**

Run both suites, diff `(fail)` list against `/tmp/feed-baseline-failures.txt`. Expected: no diff.

- [ ] **Step 5: Commit**

```bash
git rev-parse --abbrev-ref HEAD
git commit -m "feat(drawer): transcript chrome folds into one chat-feed-foot line [drawer-overhaul]" -- src/web/transcript.js src/web/app.js tests/web-client.test.ts
```

---

### Task 3: Rewire the drawer — one feed, exactly once

**Files:**
- Modify: `src/web/app.js:9410-9430` (drawer builder), imports (~26-28), export block (~1481)
- Modify: `src/web/transcript.js` (delete `renderTranscriptPanel`, `anchorLog`, `logScroll`)
- Test: `tests/web-client.test.ts`

**Interfaces:**
- Consumes: `renderChatFeedBody(agent, state, { taskCarried })` (Task 1), `renderTranscriptFoot(agent)` (Task 2).
- Produces: `.drawer-chat` = `[.drawer-chat-scroll[.chat-feed | renderChat fallback], .chat-feed-foot, .drawer-controls-strip]`. `renderTranscriptPanel` no longer exists anywhere; `transcriptLineNode`, `transcriptWindow`, `normalizeTranscript`, `loadTranscript`, `renderTranscriptFoot` remain transcript.js's exports.

- [ ] **Step 1: Write the failing tests**

Add near the drawer test at tests/web-client.test.ts:2698 (same describe, same `withDom`/`newNode` idiom — read that test first and reuse its `program`/state scaffolding; if it needs `M.state.transcript`, set and restore it exactly the way `withState` does elsewhere in the file):

```ts
test("the feed is the transcript, once — no preview bubbles or shell beside it", () => {
  const msg = "F2 is UNLOCKED — B4 landed.";
  const selected = agent({ id: "codex:a1", lastAgentMessage: msg, lastUserMessage: "go", task: "Ship the thing" });
  const program = { id: "p", name: "P", agents: [selected] };
  const prev = M.state.transcript;
  M.state.transcript = {
    agentId: selected.id, loading: false, error: "", limit: 200,
    data: { source: "/tmp/t.jsonl", truncated: false, lines: [
      { at: null, role: "user", text: "go" },
      { at: null, role: "assistant", text: msg },
    ] },
  };
  try {
    const drawer = withDom(() => {
      const pane = newNode("div");
      M.renderAgentDrawer(pane, { kind: "agent", agent: selected, program });
      return pane;
    });
    // The details shell and its summary are gone from the drawer.
    expect(byClass(drawer, "drawer-transcript")).toBeNull();
    expect(byClass(drawer, "transcript-view")).toBeNull();
    // With the record present, the preview thread does not render beside it…
    expect(allByClass(drawer, "chat-turn-body")).toHaveLength(0);
    // …so the message text appears exactly once in the entire drawer.
    expect(textOf(drawer).split(msg).length - 1).toBe(1);
    // The foot is there, the composer after it.
    expect(byClass(drawer, "chat-feed-foot")).not.toBeNull();
  } finally {
    M.state.transcript = prev;
  }
});
```

Update the live-route test `(3) the live transcript route loads and renders through the real client path` (11087-11111): replace the `renderTranscriptPanel` assertions with:

```ts
const body = withDom(() => M.renderChatFeedBody(who, M.state));
const foot = withDom(() => M.renderTranscriptFoot(who, M.state));
expect(byClass(foot, "err")).toBeNull();
// unknown + tool stay quiet rows; user + assistant become bubbles — 4 turns, once each.
expect(allByClass(body, "tr-line")).toHaveLength(2);
expect(allByClass(body, "chat-msg")).toHaveLength(2);
expect(textOf(byClass(foot, "transcript-source-path"))).toBe(LIVE_TRANSCRIPT.source);
expect(textOf(byClass(foot, "transcript-source"))).toBe("4 turns");
expect(textOf(body)).toContain("WAVE 5 / W5-C — the suite has a time bomb");
```

Rewrite the XSS panel test (10138-10152) to target the bubble body if Task 1's version doesn't already fully replace it (one XSS test on `chat-msg-body` must exist; delete the `tr-text`-based duplicate).

- [ ] **Step 2: Run to verify the new drawer test fails**

Run: `bun test tests/web-client.test.ts -t "the feed is the transcript, once"`
Expected: FAIL — `drawer-transcript` still present / `chat-turn-body` still rendered.

- [ ] **Step 3: Rewire the drawer builder**

In app.js replace lines 9410-9424 (`chatBody` … `chatScroll` construction) with:

```js
  const chatBody = renderChatFeedBody(agent, state, { taskCarried: Boolean(fullTask) });
  /* Mini chat window. The feed IS the transcript — bubbles edge to edge,
     auto-loaded on open (selectEntity fires the same fetch the foot's buttons
     fire) — with renderChat's preview standing in only while the record is
     loading, errored, or absent. The one quiet line of chrome (count, source
     path, Refresh/Load) sits at the box's foot, above the composer. */
  const chatScroll = el("div", { class: "drawer-chat-scroll", role: "log", tabindex: "0", "aria-label": "Conversation" },
    chatBody);
  const chatBox = el("div", { class: "drawer-chat" }, chatScroll);
```

Delete the `transcriptPanel` and `transcriptWrap` declarations (old 9411-9414) and the comment block they carried. Then, where the dock is appended (9436-9438), put the foot between feed and composer:

```js
  const dock = renderCommandDock(agent, control);
  dock.classList.add("drawer-controls-strip");
  chatBox.append(renderTranscriptFoot(agent), dock);
```

Leave `_chatKey`, `chatScroll.onscroll`, and the pin-to-newest block (9439-9463) byte-identical.

- [ ] **Step 4: Delete the dead transcript panel**

In `src/web/transcript.js`: delete `renderTranscriptPanel`, `anchorLog`, `logScroll`, and the `logScroll` comment block (lines ~60-99 and 110-189). The feed's `_chatScrollMemo` is now the only scroll memory — the inner `transcript-log` scroller no longer exists. Delete the now-unused `icon` import if nothing else uses it, and `agoText` if only `transcriptLineNode` uses it — check first (`transcriptLineNode` DOES use `agoText`; keep it). In app.js remove `renderTranscriptPanel` from the import (~28) and from the `M` export block (~1481).

- [ ] **Step 5: Run gate vs baseline**

Run tsc + both suites; diff `(fail)` names against `/tmp/feed-baseline-failures.txt`.
Expected: identical set. (`(2) the panel lives in Evidence…` — baseline #13 — now fails as a TypeError under the same name; that is the expected shape. `(2b)` at :6919 must still pass: `bun test tests/web-client.test.ts -t "(2b)"`.)

- [ ] **Step 6: Commit**

```bash
git rev-parse --abbrev-ref HEAD
git commit -m "feat(drawer): the feed IS the transcript — preview bubbles and details shell removed [drawer-overhaul]" -- src/web/app.js src/web/transcript.js tests/web-client.test.ts
```

---

### Task 4: Auto-load on drawer open

**Files:**
- Modify: `src/web/app.js:8329-8357` (`selectEntity`), export block
- Test: `tests/web-client.test.ts`

**Interfaces:**
- Consumes: `loadTranscript(agentId)` (transcript.js — already imported at app.js:26).
- Produces: `shouldAutoLoadTranscript(sel, transcript) -> boolean`, exported for tests; `selectEntity` fires `void loadTranscript(sel.id)` when it returns true.

- [ ] **Step 1: Write the failing test**

Near the FE-C describe:

```ts
test("(2) opening an agent drawer auto-loads its transcript, without re-fetch churn", () => {
  // An agent not yet held -> fetch. The SAME agent already held (loaded,
  // loading, or errored — agentId matches in all three) -> no fetch, so a
  // background reopen never hammers the route and a failed load retries only
  // through the foot's own Try again.
  expect(M.shouldAutoLoadTranscript({ kind: "agent", id: "codex:a1" }, {})).toBe(true);
  expect(M.shouldAutoLoadTranscript({ kind: "agent", id: "codex:a1" }, { agentId: "codex:a2" })).toBe(true);
  expect(M.shouldAutoLoadTranscript({ kind: "agent", id: "codex:a1" }, { agentId: "codex:a1", loading: true })).toBe(false);
  expect(M.shouldAutoLoadTranscript({ kind: "agent", id: "codex:a1" }, { agentId: "codex:a1", error: "x" })).toBe(false);
  // Non-agent drawers have no transcript to load.
  expect(M.shouldAutoLoadTranscript({ kind: "program", id: "p" }, {})).toBe(false);
  expect(M.shouldAutoLoadTranscript(null, {})).toBe(false);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test tests/web-client.test.ts -t "auto-loads its transcript"`
Expected: FAIL — `M.shouldAutoLoadTranscript is not a function`.

- [ ] **Step 3: Implement**

In app.js above `selectEntity`:

```js
/* The drawer's feed is the transcript, so opening an agent fetches it — the
   same fetch the foot's buttons fire. Only when it is not already held for
   this agent: a matching agentId (loaded, loading, OR errored) stands, so a
   background reopen costs nothing and a failed load retries only through the
   operator's own Try again. */
function shouldAutoLoadTranscript(sel, transcript) {
  return Boolean(sel && sel.kind === "agent" && (!transcript || transcript.agentId !== sel.id));
}
```

Inside `selectEntity`, after `state.evidenceOpen = false;` (line ~8349) and before `_chatScrollMemo.key = "";`:

```js
  if (shouldAutoLoadTranscript(sel, state.transcript)) void loadTranscript(sel.id);
```

(`loadTranscript` sets the loading state synchronously, so the `render()` two lines later paints "Reading the transcript…" in the foot; its own settle repaints the bubbles, and the cleared `_chatScrollMemo` pins that paint to newest. The `state.transcript.agentId !== agentId` guard inside `loadTranscript` already handles rapid agent-switching.)

Add `shouldAutoLoadTranscript,` to the `M` export block.

- [ ] **Step 4: Run gate vs baseline**

tsc + both suites; `(fail)` diff empty.

- [ ] **Step 5: Commit**

```bash
git rev-parse --abbrev-ref HEAD
git commit -m "feat(drawer): agent drawer open auto-loads the transcript [drawer-overhaul]" -- src/web/app.js tests/web-client.test.ts
```

---

### Task 5: CSS — bubbles, meta, foot; dead chrome removed

**Files:**
- Modify: `src/web/styles.css` (integration layer ~4291+; deletions at 2273-2277, 3150-3175 region, 4287-4289, 4340)

- [ ] **Step 1: Add the bubble + foot rules**

Append inside the "mini chat window" block (after line 4358), classes only:

```css
/* ---------- bubble feed ----------
   The feed is the transcript. Agent speech sits left on --raise with the
   .tr-line moss accent; the operator's sits right, distinct ground, slate
   accent — same role palette, new shape. Tool/system stay .tr-line rows. */
.chat-feed { display: flex; flex-direction: column; gap: 10px; }
.chat-msg {
  max-width: 82%;
  align-self: flex-start;
  border: 1px solid var(--line);
  border-left: 2px solid var(--moss);
  border-radius: var(--radius-sm);
  background: var(--raise);
  padding: 8px 10px;
  display: flex; flex-direction: column; gap: 4px;
}
.chat-msg[data-role="user"] {
  align-self: flex-end;
  border-left-color: var(--line);
  border-right: 2px solid var(--slate);
  background: var(--surface);
}
.chat-msg-meta { display: flex; flex-wrap: wrap; gap: 8px; align-items: baseline; font: 600 12px/1.2 var(--font-mono); color: var(--muted); }
.chat-msg[data-role="assistant"] .chat-msg-role { color: var(--moss); }
.chat-msg[data-role="user"] .chat-msg-role { color: var(--slate); }
.chat-msg-at, .chat-msg-run { color: var(--faint-strong); font-weight: 500; }
.chat-msg-body { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; }
.chat-msg .sender-unconfirmed { align-self: flex-start; }
/* Quiet rows read as machinery between the speech. */
.chat-feed .tr-line { opacity: 0.85; }
/* The one line of chrome, at the box's foot above the composer. */
.chat-feed-foot {
  display: flex; flex-wrap: wrap; align-items: center; gap: 8px;
  padding: 6px 12px;
  border-top: 1px solid var(--line);
  background: var(--surface);
  font: 500 11px/1.4 var(--font-mono);
  color: var(--muted);
}
.chat-feed-foot .transcript-source-path { overflow-wrap: anywhere; }
```

(Verify every token var used — `--moss --slate --raise --surface --line --muted --faint-strong --radius-sm --font-mono` — exists in `:root`; all appear in the current file.)

- [ ] **Step 2: Delete the dead chrome**

Emitters gone in Task 3 → their CSS goes now, so the class-emission orphan list does not grow:
- `.drawer-transcript`, `.drawer-transcript-summary` rules at 2273-2277 and the `.drawer-transcript[open]` / `summary` rules at 4287-4289.
- `.transcript-view` (3155), `.transcript-head` (3156-3160), `.transcript-log` (3168-3175).
- The `.drawer-chat-scroll .transcript-log` override at 4338-4340 (and its comment).

KEEP: `.transcript-source`, `.transcript-more`, `.transcript-source-path` (reused by the foot), the whole `.tr-line`/`.tr-meta`/`.tr-role`/`.tr-at`/`.tr-text` block (3176-3196), `.chat-turn*` rules (fallback still renders them; test :12372 asserts `.chat-turn-sender` exists in styles). Do NOT touch the pre-existing `.transcript` rule at 3148 unless you verify it already has no emitter — pre-existing orphans are not this change's mess.

- [ ] **Step 3: Verify orphan parity**

Run: `bun test tests/web-client.test.ts -t "every class in styles.css"` — it stays failing (baseline #9), but read its failure output: the `orphans` array must contain no `chat-*`, `drawer-transcript*`, or `transcript-*` names introduced or stranded by this change (compare against what it printed in Task 0 if in doubt). Then full gate: tsc + both suites, `(fail)` diff vs baseline empty.

- [ ] **Step 4: Commit**

```bash
git rev-parse --abbrev-ref HEAD
git commit -m "style(drawer): bubble feed + chat-feed-foot; dead transcript chrome CSS removed [drawer-overhaul]" -- src/web/styles.css
```

---

### Task 6: Full gate, live QA, after screenshots

**Files:**
- Create: `docs/rhs-shots/mini-chat-feed/after-1440.png`, `docs/rhs-shots/mini-chat-feed/after-860.png`

- [ ] **Step 1: Full verification gate**

```bash
bunx tsc --noEmit && echo TSC-OK
bun test tests/web-client.test.ts tests/cwd-adversarial.test.ts 2>&1 | grep -E "^\(fail\)" | sort | diff /tmp/feed-baseline-failures.txt - && echo BASELINE-UNCHANGED
bun test tests/web-client.test.ts -t "(2b)"   # the task-floor test, untouched and green
```
Expected: `TSC-OK`, `BASELINE-UNCHANGED`, (2b) pass. If the diff shows ANY new name, stop and fix before screenshots.

- [ ] **Step 2: Restart the worktree server and QA live**

Restart the Task 0 dev instance (kill the PID you started, never the port), then via /browse on `http://localhost:4799`, open a LIVE agent drawer and confirm each spec line by looking:
1. The feed auto-fills with bubbles on open — no Load click; opening lands pinned to the newest turn at the bottom.
2. Agent turns left on `--raise`, operator turns right and visually distinct; each bubble has the 12px mono meta (role + relative time); tool/system are quiet single-line rows.
3. No AGENT/YOU preview bubbles, no "Transcript — last 3 turns" summary anywhere; pick one visible message text and confirm it appears exactly once in the whole drawer.
4. One quiet foot line: count, source path, Refresh (and Load N when truncated); Refresh still works; composer fixed below it.
5. Scroll up mid-feed, wait for an SSE repaint: your place holds (memo); close and reopen: pinned to newest again.
6. An agent with no transcript file shows the renderChat preview + the honest foot sentence.
7. If a lane with a [TL;DR] heartbeat or a producer-envelope message is live: the TL;DR renders as an assistant bubble; the envelope turn shows sender name + run in the meta (and the unconfirmed mark only if the server said so).

- [ ] **Step 3: After screenshots**

Same drawer, widths 1440 and 860 → `docs/rhs-shots/mini-chat-feed/after-1440.png`, `after-860.png`. At 860 the stacked sheet's chat box (68vh) must show feed → foot → composer with no double scrollbar.

- [ ] **Step 4: Commit and stop**

```bash
git rev-parse --abbrev-ref HEAD
git commit -m "docs(drawer): after shots — bubble feed at 1440/860 [drawer-overhaul]" -- docs/rhs-shots/mini-chat-feed
```
Stop. No push, no PR — publication is Emilio's call.
