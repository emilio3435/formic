import { beforeAll, describe, expect, test } from "bun:test";
import { buildOperatorIssues } from "../src/server/snapshot-operator-issues";
import { buildSnapshot } from "../src/server/snapshot";
import type { OperatorIssue } from "../src/shared/types";
import type { ArchiveStore, CollectedAgent } from "../src/server/types";

/* Guards for two overhauls landing in parallel: the agent drawer, and the
   reclassification of health severity.

   The Ant Hill is a cockpit. Every pixel must say something is wrong, say what
   is happening, or let the operator act; anything else is noise. Both overhauls
   move toward that, and both have an obvious way to be quietly undone:

   - Health is being made quieter so the board stops permanently claiming a
     fault. The failure mode is over-correction — going quiet about a control
     plane that is genuinely gone. These tests pin the loud half so the quiet
     half cannot be bought with it.
   - The drawer is being condensed. The failure mode is re-expansion: raw detail
     creeping back open by default, or a second token number arriving without a
     label that distinguishes it from the first.

   The drawer assertions walk the rendered tree and reason about roles and
   labels rather than matching markup, so a legitimate redesign passes and only
   a regression in the property fails. */

const archiveStore: ArchiveStore = { has: () => false, archive: async () => {} };
const NOW = new Date("2026-07-21T23:00:30.000Z");

function collected(overrides: Partial<CollectedAgent> = {}): CollectedAgent {
  return {
    id: "codex:live",
    provider: "codex",
    sourceSessionId: "live",
    displayName: "Live worker",
    cwd: "/Users/me/proj",
    status: "running",
    statusReason: "Source activity within 3 minutes.",
    startedAt: "2026-07-21T20:00:00.000Z",
    updatedAt: "2026-07-21T23:00:00.000Z",
    tokens: { total: 42, provenance: "observed" },
    artifacts: [],
    gates: [],
    ...overrides,
  };
}

const snapshotWith = (input: Record<string, unknown>) =>
  buildSnapshot({ agents: [collected()], surfaces: [], archiveStore, now: NOW, ...input } as never);

const issueById = (issues: readonly OperatorIssue[] | undefined, id: string) =>
  issues?.find((issue) => issue.id === id);

/* A cmux pane whose open session files disagree. `sessionIds` decides which
   side of the reclassification it lands on: name a live agent's session and the
   pane is holding controls hostage; name only ghosts and it is leftovers. */
const conflictSurface = (surfaceId: string, sessionIds: readonly string[]) => ({
  workspaceId: "W",
  surfaceId,
  paneId: `PANE-${surfaceId}`,
  cwd: "/Users/me/finished-wave",
  sourceSessionIds: [],
  identityTrace: {
    surfaceId,
    outcome: "open-file-conflict",
    openFileMatches: sessionIds.map((sessionId) => ({ provider: "codex", sessionId })),
    sourceSessionIds: [],
  },
});

const conflictError = (surfaceId: string, tty: string) =>
  `cmux ${surfaceId} has conflicting open agent session files on ${tty}`;

describe("health severity: the quiet half must not be bought with the loud half", () => {
  test("a clean fleet raises nothing at all", () => {
    /* The north star in one assertion: with nothing wrong, the board says
       nothing. Every quieting change should keep this true, and it is the
       baseline that gives the loudness tests below their meaning. */
    const snapshot = snapshotWith({ cmuxReachable: true });

    expect(snapshot.issues ?? []).toEqual([]);
    expect(snapshot.totals.sourceHealth).toEqual({ healthy: 4, degraded: 0, total: 4 });
  });

  test("an unreachable control plane still reports loudly", () => {
    // Focus and Send cannot route at all in this state, and waiting does not
    // help. If the reclassification ever softens this, the cockpit has gone
    // quiet about the one fault that blocks every action.
    const snapshot = snapshotWith({
      cmuxErrors: ["cmux socket refused the connection"],
      cmuxReachable: false,
    });
    const control = issueById(snapshot.issues, "system:cmux-control");

    expect(control).toBeDefined();
    expect(control?.severity).toBe("error");
    expect(snapshot.controlHealth?.cmuxReachable).toBe(false);
    expect(snapshot.totals.sourceHealth?.degraded ?? 0).toBeGreaterThan(0);
  });

  test("a control-plane fault names the agents it actually blocks", () => {
    /* An error affecting nobody is indistinguishable from debris. Naming the
       implicated agents is what lets the board scope the alarm instead of
       blaming the whole fleet — and it is the discriminator any debris
       reclassification will need to lean on. */
    const control = issueById(
      snapshotWith({ cmuxErrors: ["cmux socket refused the connection"], cmuxReachable: false }).issues,
      "system:cmux-control",
    );

    expect(control?.affectedAgentIds.length).toBeGreaterThan(0);
    expect(control?.technicalDetails).toContain("cmux socket refused the connection");
  });

  test("a degraded collector blames only its own provider's agents", () => {
    /* Scope is what keeps a warning readable: a Claude scan that failed says
       nothing about the Codex sessions on the same board. The fixture carries
       one agent of each provider on purpose — asserting an empty list against a
       Codex-only fleet would have passed no matter how the code attributed
       blame, which is the mistake this test used to make. */
    const snapshot = buildSnapshot({
      agents: [
        collected(),
        collected({ id: "claude:c1", provider: "claude", sourceSessionId: "c1", displayName: "Claude worker" }),
      ],
      surfaces: [],
      archiveStore,
      now: NOW,
      sourceErrors: { claude: ["EACCES scanning ~/.claude"] },
    } as never);
    const collector = issueById(snapshot.issues, "system:claude-collector");

    expect(collector?.severity).toBe("warning");
    expect(collector?.affectedAgentIds).toEqual(["claude:c1"]);
    expect(collector?.affectedAgentIds).not.toContain("codex:live");
  });

  test("the two severity tiers stay distinct on a board that has both", () => {
    /* Not "severity is one of two strings" — the type already says that, and a
       build where every warning had been promoted to error would satisfy it
       while being exactly the permanently-red board this overhaul exists to
       end. The assertion is that both tiers are actually reachable: a dead
       control plane and a degraded collector must not arrive at equal weight. */
    const snapshot = buildSnapshot({
      agents: [collected()],
      surfaces: [],
      archiveStore,
      now: NOW,
      cmuxErrors: ["cmux socket refused the connection"],
      sourceErrors: { claude: ["EACCES scanning ~/.claude"] },
    } as never);
    const severities = (snapshot.issues ?? []).map((issue) => issue.severity);

    expect(severities).toContain("error");
    expect(severities).toContain("warning");
    expect(issueById(snapshot.issues, "system:cmux-control")?.severity).toBe("error");
    expect(issueById(snapshot.issues, "system:claude-collector")?.severity).toBe("warning");
  });

  test("a machine holding only abandoned-pane debris reports healthy", () => {
    /* The reason the reclassification exists. A cmux pane outlives the wave
       that opened it and keeps its transcript handles, so identity scanning
       reports a conflict for it forever. Counting that as a fault made
       "all clear" unreachable on any machine that had ever run a swarm — which
       is every machine this ships to — and a board that is permanently red is a
       board the operator stops reading. */
    const snapshot = snapshotWith({
      surfaces: [
        conflictSurface("SURF-DEAD-1", ["ghost-a", "ghost-b"]),
        conflictSurface("SURF-DEAD-2", ["ghost-c", "ghost-d"]),
      ],
      cmuxErrors: [conflictError("SURF-DEAD-1", "ttys009"), conflictError("SURF-DEAD-2", "ttys010")],
      cmuxReachable: true,
    });

    expect(snapshot.issues ?? []).toEqual([]);
    expect(snapshot.totals.sourceHealth).toEqual({ healthy: 4, degraded: 0, total: 4 });
    // Debris must not leak back into the list that drives the Degraded verdict.
    expect(snapshot.controlHealth?.errors).toEqual([]);
  });

  test("debris stays discoverable instead of being deleted to buy the silence", () => {
    /* Quiet is not the same as hidden. The panes are still real, and an
       operator who wants to tidy them needs to know which ones and how many. */
    const debris = snapshotWith({
      surfaces: [conflictSurface("SURF-DEAD-1", ["ghost-a", "ghost-b"])],
      cmuxErrors: [conflictError("SURF-DEAD-1", "ttys009")],
      cmuxReachable: true,
    }).controlHealth?.debris;

    expect(debris?.kind).toBe("abandoned-cmux-panes");
    expect(debris?.count).toBe(1);
    expect(debris?.surfaceIds).toEqual(["SURF-DEAD-1"]);
    // The raw scanner strings survive, but as detail rather than the headline.
    expect(debris?.detail).toEqual([conflictError("SURF-DEAD-1", "ttys009")]);
  });

  test("debris ships a remedy the UI can render, distinct from its raw detail", () => {
    /* The property that makes quieting safe: anything the board still mentions
       arrives with words naming what the operator would DO. A remedy that were
       just the scanner string again would leave them exactly as stuck as the
       permanent red banner did. */
    const debris = snapshotWith({
      surfaces: [conflictSurface("SURF-DEAD-1", ["ghost-a", "ghost-b"])],
      cmuxErrors: [conflictError("SURF-DEAD-1", "ttys009")],
      cmuxReachable: true,
    }).controlHealth?.debris;

    expect(debris?.remedy).toBeTruthy();
    expect(debris?.remedy.trim().length).toBeGreaterThan(0);
    // Renderable prose, not a rehash of the technical detail.
    expect(debris?.detail).not.toContain(debris?.remedy);
    for (const line of debris?.detail ?? []) expect(debris?.remedy).not.toBe(line);
  });

  test("a conflict holding a live session hostage is still a loud error", () => {
    /* The other half of the split, and the one the quieting could swallow. Here
       a live agent's own session is one of the conflicting files, so its
       controls really are quarantined: silence would strand it. */
    const snapshot = snapshotWith({
      surfaces: [conflictSurface("SURF-LIVE", ["live", "ghost-x"])],
      cmuxErrors: [conflictError("SURF-LIVE", "ttys005")],
      cmuxReachable: true,
    });
    const conflict = issueById(snapshot.issues, "system:cmux-identity-conflicts");

    expect(conflict?.severity).toBe("error");
    expect(conflict?.affectedAgentIds).toContain("codex:live");
    expect(snapshot.totals.sourceHealth?.degraded).toBeGreaterThan(0);
    // A live conflict is a fault, not tidying, so it must not be filed as debris.
    expect(snapshot.controlHealth?.debris).toBeUndefined();
  });

  test("an identity error naming no known surface stays a fault", () => {
    /* Unexplained evidence is not evidence of nothing. Debris is only ever the
       conflicts we can positively attribute to a pane whose sessions have all
       ended; anything the split cannot place has to keep its weight, or the
       quieting becomes a catch-all. */
    const snapshot = snapshotWith({
      surfaces: [],
      cmuxErrors: [conflictError("SURF-UNKNOWN", "ttys077")],
      cmuxReachable: true,
    });

    expect(snapshot.controlHealth?.debris).toBeUndefined();
    expect(issueById(snapshot.issues, "system:cmux-identity-conflicts")?.severity).toBe("error");
  });

  test("every raised issue carries the text the card needs to render it", () => {
    /* Whatever the board claims is wrong has to arrive with something an
       operator can read. This pins title+summary, which is the renderable
       contract that exists today; see the lane report for the separate
       `remedy` field this property really wants. */
    const snapshot = buildSnapshot({
      agents: [collected({ gates: ["tests failed"] })],
      surfaces: [],
      archiveStore,
      now: NOW,
      cmuxErrors: ["cmux socket refused the connection"],
      sourceErrors: { claude: ["EACCES scanning ~/.claude"] },
    } as never);

    expect(snapshot.issues?.length).toBeGreaterThan(0);
    for (const issue of snapshot.issues ?? []) {
      expect(issue.title.trim().length).toBeGreaterThan(0);
      expect(issue.summary.trim().length).toBeGreaterThan(0);
      expect(issue.id).toMatch(/^(system|agent):/);
    }
  });

  test("the builder's silence is earned, not the result of it never speaking", () => {
    /* Replaces a guard that asserted buildOperatorIssues([], [], undefined, [])
       returns []. Mutation testing killed it: a stubbed `() => []` passed it,
       so it could not distinguish a working builder from no builder at all and
       was manufacturing confidence.

       Silence is only meaningful against a builder that demonstrably speaks, so
       the same call is made twice — once with nothing wrong, once with a real
       fault — and the difference between them is the assertion. */
    const quiet = buildOperatorIssues([], [], undefined, []);
    const loud = buildOperatorIssues([], [], undefined, ["cmux socket refused the connection"]);

    expect(quiet).toEqual([]);
    expect(loud.length).toBeGreaterThan(0);
    expect(loud.map((issue) => issue.id)).toContain("system:cmux-control");
  });
});

/* --------------------------------------------------------------------------
   Drawer guards.

   A minimal DOM stand-in, local to this file so the two overhaul lanes can
   reshape their own harnesses without breaking these. The client guards its DOM
   wiring behind `typeof document`, so importing it here is safe. */

interface FakeNode {
  nodeType: number;
  tagName: string;
  textContent: string;
  attributes: Record<string, string>;
  children: FakeNode[];
  parent: FakeNode | null;
  className: string;
  listeners: Record<string, Array<(event: unknown) => unknown>>;
  [key: string]: unknown;
}

function makeNode(tag: string): FakeNode {
  const classes = new Set<string>();
  const node = {
    nodeType: 1,
    tagName: tag,
    textContent: "",
    dataset: {} as Record<string, string>,
    attributes: {} as Record<string, string>,
    children: [] as FakeNode[],
    parent: null as FakeNode | null,
    get className() { return [...classes].join(" "); },
    set className(value: string) {
      classes.clear();
      for (const name of String(value).split(/\s+/)) if (name) classes.add(name);
    },
    classList: {
      add: (...names: string[]) => { for (const name of names) if (name) classes.add(name); },
      remove: (...names: string[]) => { for (const name of names) classes.delete(name); },
      toggle: (name: string, on?: boolean) => {
        if (on === undefined ? classes.has(name) : !on) classes.delete(name); else classes.add(name);
      },
      contains: (name: string) => classes.has(name),
    },
    get childNodes() { return node.children; },
    get childElementCount() { return node.children.length; },
    get firstChild() { return node.children[0] || null; },
    get nextSibling() {
      if (!node.parent) return null;
      const index = node.parent.children.indexOf(node as unknown as FakeNode);
      return (index >= 0 && node.parent.children[index + 1]) || null;
    },
    setAttribute(key: string, value: unknown) { node.attributes[key] = String(value); },
    getAttribute(key: string) { return node.attributes[key] ?? null; },
    removeAttribute(key: string) { delete node.attributes[key]; },
    hasAttribute(key: string) { return key in node.attributes; },
    listeners: {} as Record<string, Array<(event: unknown) => unknown>>,
    addEventListener(type: string, fn: (event: unknown) => unknown) { (node.listeners[type] ??= []).push(fn); },
    append(...kids: unknown[]) {
      for (const kid of kids) {
        if (kid == null) continue;
        const child = (typeof kid === "string"
          ? { nodeType: 3, textContent: kid }
          : kid) as FakeNode;
        child.parent = node as unknown as FakeNode;
        node.children.push(child);
      }
    },
    appendChild(kid: unknown) { node.append(kid); return kid; },
    remove() {
      if (node.parent) node.parent.children = node.parent.children.filter((c) => c !== (node as unknown as FakeNode));
    },
    replaceChildren(...kids: unknown[]) { node.children = []; node.append(...kids); },
    closest: () => null,
    focus() {}, select() {}, scrollIntoView() {},
    querySelectorAll: () => [] as unknown[],
    querySelector: () => null,
  };
  return node as unknown as FakeNode;
}

const byId = new Map<string, FakeNode>();

function installDom(): void {
  byId.clear();
  (globalThis as unknown as { document: unknown }).document = {
    createElement: (tag: string) => makeNode(tag),
    createElementNS: (_ns: string, tag: string) => makeNode(tag),
    createTextNode: (text: string) => ({ nodeType: 3, textContent: String(text) }),
    getElementById: (id: string) => {
      if (!byId.has(id)) byId.set(id, makeNode("div"));
      return byId.get(id) as FakeNode;
    },
    querySelectorAll: () => [] as unknown[],
    querySelector: () => null,
  };
}

const walk = (node: FakeNode, out: FakeNode[] = []): FakeNode[] => {
  if (!node) return out;
  out.push(node);
  for (const child of node.children ?? []) walk(child, out);
  return out;
};

const textOf = (node: FakeNode): string =>
  node.nodeType === 3
    ? String(node.textContent ?? "")
    : ((node.children ?? []).map(textOf).join(" ").trim() || String(node.textContent ?? ""));

const label = (node: FakeNode): string =>
  (textOf(node) || node.attributes["aria-label"] || node.attributes.title || "")
    .replace(/\s+/g, " ")
    .trim();

const AGENT = {
  id: "codex:a1",
  provider: "codex",
  sourceSessionId: "a1b2c3d4",
  displayName: "Ridge worker",
  programId: "p1",
  status: "running",
  activity: "working",
  outcome: "healthy",
  controlState: "linked",
  statusReason: "Streaming output.",
  updatedAt: "2026-07-22T03:00:00.000Z",
  startedAt: "2026-07-22T02:00:00.000Z",
  cwd: "/Users/me/proj",
  model: "claude-opus-4-8",
  role: "worker",
  tokens: { scope: "latest-turn", provenance: "observed", total: 120_000, sessionTotal: 480_000, contextWindow: 1_000_000 },
  artifacts: [],
  gates: [],
  controls: [{ action: "focus", enabled: true }, { action: "instruct", enabled: true }],
  target: { surfaceId: "S1", resolution: "exact" },
  nextAction: "Review the streaming output.",
};

describe("agent drawer: condensed by default, and honest about its numbers", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let M: any;
  let nodes: FakeNode[];

  beforeAll(async () => {
    installDom();
    // @ts-expect-error The dependency-free browser client has no declaration file.
    await import("../src/web/app.js");
    M = (globalThis as unknown as { TheAntHill: unknown }).TheAntHill;
    const pane = makeNode("aside");
    M.renderAgentDrawer(pane, {
      kind: "agent",
      agent: AGENT,
      program: { id: "p1", name: "P", agents: [AGENT] },
    });
    nodes = walk(pane);
  });

  test("the drawer paints the agent it was handed", () => {
    /* Guards the guards: if renderAgentDrawer is renamed or starts returning an
       empty pane, every property below would pass vacuously.

       Identity comes from agentName rather than displayName on purpose — a
       Codex session is named by its working directory, and hard-coding the raw
       displayName here would assert a naming rule this file does not own. */
    expect(nodes.length).toBeGreaterThan(20);
    expect(textOf(nodes[0]!)).toContain(M.agentName(AGENT));
    /* Was `toMatch(/working/i)`. The drawer no longer prints the activity word:
       the row that opened it already says "Working", and restating it was one of
       the duplications this overhaul was commissioned to remove — so requiring it
       here would pin the defect in place. The guard's stated intent is only to
       prove the pane is not empty and belongs to THIS agent, which the reason it
       reports proves at least as well, and which the row does not carry. */
    /* The model is the stable per-agent fact the head always carries. An earlier
       revision asserted statusReason here, but the drawer now suppresses it on a
       working agent — it read "Source activity within 3 minutes." directly beside
       "11s ago", the same observation at coarser precision. */
    expect(textOf(nodes[0]!)).toMatch(/opus 4\.8/i);
  });

  test("raw detail ships collapsed, so the drawer opens as a summary", () => {
    /* The drawer's job is to condense. Evidence — vitals, paths, routing,
       transcript — is the raw material behind the summary and must be opt-in;
       shipping it open turns the cockpit back into a data dump.

       Read through the disclosure contract rather than a class name: anything
       that declares aria-expanded, and any <details>, must start closed. */
    const disclosures = nodes.filter(
      (node) => node.nodeType === 1 && ("aria-expanded" in node.attributes || node.tagName === "details"),
    );

    expect(disclosures.length).toBeGreaterThan(0);
    for (const disclosure of disclosures) {
      if (disclosure.tagName === "details") {
        expect("open" in disclosure.attributes).toBe(false);
      } else {
        expect(disclosure.attributes["aria-expanded"]).toBe("false");
      }
    }
  });

  test("a collapsed disclosure still says what it hides", () => {
    // Collapsed must not mean unlabelled: a control with no name is a pixel
    // that neither reports, explains, nor enables action.
    const collapsed = nodes.filter(
      (node) => node.nodeType === 1 && node.attributes["aria-expanded"] === "false",
    );

    expect(collapsed.length).toBeGreaterThan(0);
    for (const disclosure of collapsed) {
      expect(label(disclosure).length).toBeGreaterThan(0);
      expect(disclosure.attributes["aria-controls"]).toBeTruthy();
    }
  });

  test("the two token magnitudes it reports are labelled apart", () => {
    /* The drawer shows latest-turn context usage and a cumulative session
       total. They are different measurements of the same session and differ by
       4x in this fixture; printed under labels that do not distinguish them,
       the operator reads one as the other and mis-sizes the agent.

       Asserted as a property over rendered text: both magnitudes appear, and
       each is reachable under wording that separates turn from session. */
    const rendered = textOf(nodes[0]!).replace(/\s+/g, " ");

    expect(rendered).toMatch(/context/i);
    expect(rendered).toMatch(/session/i);

    /* The whole inventory, not a spot check. Asserting only that 120k and 480k
       each appear once would let a third magnitude arrive unlabelled and go
       unnoticed — which is the failure this property exists to prevent. So the
       complete multiset of token-shaped numbers the drawer prints is fixed:
       the turn total, its window, and the session total. A new number, a
       repeat, or a dropped one all fail here. */
    const magnitudes = (rendered.match(/\b\d[\d.]*\s*[kM]\b/g) ?? [])
      .map((value) => value.replace(/\s+/g, ""))
      .sort();

    expect(magnitudes).toEqual(["1.0M", "120k", "480k"].sort());
  });

  test("the context figure is shown against its window, never bare", () => {
    /* 120k means nothing without the denominator — against 200k it is a warning
       and against 1M it is routine. A bare numerator is a plausible-looking
       number the operator cannot act on. */
    const rendered = textOf(nodes[0]!).replace(/\s+/g, " ");

    expect(rendered).toMatch(/120k\s*\/?\s*1\.0M|120k[^%]*1\.0M/);
    expect(rendered).toMatch(/\d+%/);
  });

  test("every actionable control carries a name the operator can read", () => {
    // An unlabelled button fails all three tests of the north star at once.
    const controls = nodes.filter(
      (node) => node.nodeType === 1 && (node.tagName === "button" || (node.listeners?.click?.length ?? 0) > 0),
    );

    expect(controls.length).toBeGreaterThan(0);
    for (const control of controls) expect(label(control).length).toBeGreaterThan(0);
  });
});
