import { beforeAll, describe, expect, test } from "bun:test";
import { attentionFieldsFor } from "../src/server/attention-signal";

/* The wiring contract between the two halves of the day's flagship capability.

   The server decides which agents are waiting on a human and why and ships it
   on AgentSnapshot.attentionSignal. For one day the client read none of it —
   `grep -rn attentionSignal src/web` returned nothing — so the reason was
   computed correctly, serialised correctly, and discarded at the last step.
   This file was written against that gap, as `test.failing`, and the marker
   came off when agent-model's wantsHuman() landed and fed alerting().

   The property pinned is not a string or a layout. It is that an agent the
   server marked as wanting a human is REACHABLE — that some operator-facing
   surface leads to it. Which surface stays the frontend lane's choice: the
   Alerts view, the outcome, the row summary and the drawer each satisfy it,
   and the contract is only that at least one does.

   Confirmed to pass for the right reason rather than because the assertion was
   loosened — the reachability assertion and its route list are byte-identical
   to the version that failed. Four mutations of the landed implementation, each
   caught:

     wantsHuman() forced false ................ contract test
     alerting() stops calling wantsHuman ...... contract test
     signal ignored, every live agent alerts .. no-signal control
     the !== "ended" guard dropped ............ archived control

   The last two matter as much as the first. Refilling Alerts with every idle
   agent would satisfy a naive reachability check while rebuilding the noise the
   attention work exists to end, and admitting archived agents would trade one
   false negative for the six false positives the board is carrying today.

   Fixture note: every agent on the live board carrying a signal is archived —
   a handed-back decision is the note a session leaves as it finishes — and the
   backend lane is now stopping the detector firing on dead sessions. Both facts
   are reasons this file builds its own LIVE agents rather than asserting on
   whatever the board holds: it must not start passing because archived signals
   went away, and it must not have passed because they were there. */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let M: any;

const domById = new Map<string, unknown>();

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeNode(tag: string): any {
  const classes = new Set<string>();
  const node = {
    nodeType: 1, tagName: tag, textContent: "", dataset: {} as Record<string, string>,
    attributes: {} as Record<string, string>, children: [] as unknown[], parent: null as unknown,
    get className() { return [...classes].join(" "); },
    set className(v: string) { classes.clear(); for (const c of String(v).split(/\s+/)) if (c) classes.add(c); },
    classList: {
      add: (...c: string[]) => { for (const x of c) if (x) classes.add(x); },
      remove: (...c: string[]) => { for (const x of c) classes.delete(x); },
      toggle: (c: string, on?: boolean) => { if (on === undefined ? classes.has(c) : !on) classes.delete(c); else classes.add(c); },
      contains: (c: string) => classes.has(c),
    },
    get childNodes() { return node.children; },
    get childElementCount() { return node.children.length; },
    get firstChild() { return node.children[0] || null; },
    get nextSibling() { return null; },
    setAttribute(k: string, v: unknown) { node.attributes[k] = String(v); },
    getAttribute(k: string) { return node.attributes[k] ?? null; },
    removeAttribute(k: string) { delete node.attributes[k]; },
    hasAttribute(k: string) { return k in node.attributes; },
    listeners: {} as Record<string, unknown[]>,
    addEventListener(t: string, fn: unknown) { (node.listeners[t] ??= []).push(fn); },
    append(...kids: unknown[]) {
      for (const kid of kids) {
        if (kid == null) continue;
        const child = (typeof kid === "string" ? { nodeType: 3, textContent: kid } : kid) as { parent?: unknown };
        child.parent = node;
        node.children.push(child);
      }
    },
    appendChild(k: unknown) { node.append(k); return k; },
    remove() {}, replaceChildren(...kids: unknown[]) { node.children = []; node.append(...kids); },
    closest: () => null, focus() {}, select() {}, scrollIntoView() {},
    querySelectorAll: () => [] as unknown[], querySelector: () => null,
  };
  return node;
}

beforeAll(async () => {
  domById.clear();
  (globalThis as unknown as { document: unknown }).document = {
    createElement: (tag: string) => makeNode(tag),
    createElementNS: (_ns: string, tag: string) => makeNode(tag),
    createTextNode: (text: string) => ({ nodeType: 3, textContent: String(text) }),
    getElementById: (id: string) => {
      if (!domById.has(id)) domById.set(id, makeNode("div"));
      return domById.get(id);
    },
    querySelectorAll: () => [] as unknown[], querySelector: () => null,
  };
  // @ts-expect-error The dependency-free browser client has no declaration file.
  await import("../src/web/app.js");
  M = (globalThis as unknown as { TheAntHill: unknown }).TheAntHill;
});

const EVIDENCE = "Should I drop the legacy column or migrate it first?";
const NEXT_ACTION = "Answer the question it stopped on.";

/* A live agent — waiting, not ended, not archived — that the server has marked
   as wanting a human. Everything structural about it is healthy: the only thing
   saying a human is needed is the attention signal itself, which is exactly the
   case the client is dropping. */
const waitingAgent = (overrides: Record<string, unknown> = {}) => ({
  id: "codex:waiting",
  provider: "codex",
  sourceSessionId: "waiting",
  displayName: "Waiting worker",
  programId: "p1",
  status: "waiting",
  activity: "idle",
  outcome: "healthy",
  controlState: "linked",
  statusReason: "No source activity in the last 3 minutes.",
  updatedAt: "2026-08-02T10:00:00.000Z",
  tokens: { provenance: "unknown" },
  artifacts: [],
  gates: [],
  controls: [{ action: "focus", enabled: true }, { action: "instruct", enabled: true }],
  target: { surfaceId: "S1", resolution: "exact" },
  nextAction: NEXT_ACTION,
  attentionSignal: { kind: "question-pending", evidence: EVIDENCE },
  ...overrides,
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const drawerText = (agent: any): string => {
  const pane = makeNode("aside");
  M.renderAgentDrawer(pane, { kind: "agent", agent, program: { id: "p1", name: "P", agents: [agent] } });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const walk = (n: any): string =>
    n.nodeType === 3 ? String(n.textContent ?? "") : (n.children ?? []).map(walk).join(" ");
  return walk(pane).replace(/\s+/g, " ");
};

/* Every operator-facing route to an agent. The contract is satisfied by ANY of
   them, so the frontend lane keeps full freedom over how it surfaces the
   signal — a badge, a view, a row line, or the drawer. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function reachableRoutes(agent: any): string[] {
  const routes: string[] = [];
  if (M.viewMatches("needs-you", agent)) routes.push("alerts-view");
  if (M.alerting(agent)) routes.push("alerting-flag");
  if (M.deriveOutcome(agent) === "needs-you") routes.push("outcome");
  const summary = String(M.rowSummary(agent) ?? "");
  if (summary.includes(EVIDENCE) || summary.includes(NEXT_ACTION)) routes.push("row-summary");
  const drawer = drawerText(agent);
  if (drawer.includes(EVIDENCE) || drawer.includes(NEXT_ACTION)) routes.push("drawer");
  return routes;
}

describe("a signal the server computes must survive to an operator", () => {
  test("the server does mark this agent, so the data exists to be dropped", () => {
    /* Localises the defect. The reachability failure below is a CLIENT gap, not
       a server one — this proves the fields are populated for exactly this
       input before the client ever sees them. */
    const fields = attentionFieldsFor(
      {
        transcriptTail: `Looked at the schema.\n${EVIDENCE}`,
        lastAgentMessage: `Looked at the schema.\n${EVIDENCE}`,
        activity: "idle",
        processState: "running",
      },
      "healthy",
      "linked",
    );

    expect(fields.attentionSignal).toBeDefined();
    expect(fields.nextAction).toBeTruthy();
  });

  test("a live agent carrying an attention signal is reachable somewhere", () => {
    /* WIRED. `.failing` removed once the client began consuming the field:
       wantsHuman() feeds alerting(), which the Needs-you view, the title badge,
       the notifier, the program rollup and the findings list all read. This is
       now a permanent guard against the wiring being dropped again — if a future
       change re-derives "needs a human" from outcome alone, this goes red. */
    expect(reachableRoutes(waitingAgent())).not.toEqual([]);
  });

  test("an identical agent WITHOUT a signal is legitimately unreachable", () => {
    /* The control that stops the contract from being satisfied by accident. If
       a future client marked every idle agent as needing attention, the test
       above would pass for the wrong reason and the Alerts view would refill
       with noise — the failure the attention work exists to end. */
    const ordinary = waitingAgent({ nextAction: undefined, attentionSignal: undefined });

    expect(reachableRoutes(ordinary)).toEqual([]);
    expect(M.viewMatches("needs-you", ordinary)).toBe(false);
  });

  test("an archived agent carrying a signal stays off the live surfaces", () => {
    /* The measured caveat: all seven agents on the live board carrying a signal
       are archived. An archived session wants nothing from anyone, so its
       absence is correct — and asserting reachability against the board as it
       stands would have "passed" on exactly the rows that prove nothing. */
    const archived = waitingAgent({ status: "archived", activity: "ended" });

    expect(M.viewMatches("needs-you", archived)).toBe(false);
    expect(M.viewMatches("history", archived)).toBe(true);
  });
});
