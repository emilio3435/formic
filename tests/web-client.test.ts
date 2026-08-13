import { beforeAll, describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/* app.js guards all DOM wiring behind a `typeof document` check and exposes its
   pure helpers on globalThis.TheAntHill, so importing it under Bun is safe. */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let M: any;
let source = "";
let html = "";
let styles = "";

beforeAll(async () => {
  // @ts-expect-error The dependency-free browser client intentionally has no declaration file.
  await import("../src/web/app.js");
  M = (globalThis as unknown as { TheAntHill: unknown }).TheAntHill;
  const webDir = join(import.meta.dir, "../src/web");
  source = readdirSync(webDir)
    .filter((name) => name.endsWith(".js"))
    .sort()
    .map((name) => readFileSync(join(webDir, name), "utf8"))
    .join("\n");
  html = readFileSync(join(import.meta.dir, "../src/web/index.html"), "utf8");
  styles = readFileSync(join(import.meta.dir, "../src/web/styles.css"), "utf8");
});

test("CWD-COPY-1 linked controls stay exact while directory provenance is neutral and explicit", () => {
  const linked = agent({
    cwd: "/Users/example",
    launchCwd: "/repos/cooper-scheduler",
    repo: {
      repoKey: "cooper",
      repoName: "cooper-scheduler",
      worktreePath: "/repos/cooper-scheduler",
      ephemeral: false,
    },
    target: {
      resolution: "exact",
      attestation: "hook-store",
      surfaceId: "SURFACE-CWD-COPY",
      workspaceId: "WORKSPACE-CWD-COPY",
      workspaceTitle: "Cooper terminal",
      surfaceCwd: "/repos/cooper-terminal",
      cwdRelation: "different",
    },
  });
  const rendered = withDom(() => M.renderEvidence(linked));
  const text = textOf(rendered);
  const row = withDom(() => M.renderAgentRow(linked, { id: "cooper", name: "Cooper", agents: [linked] }));

  expect(text).toContain("Workspace");
  expect(text).toContain("Launch folder");
  expect(text).toContain("Terminal shell folder");
  expect(text).toContain("Repository");
  expect(text).not.toContain("Linked for Focus and Send.");
  expect(text).toContain("Claude’s tool session and the terminal shell maintain separate working directories. This does not change the exact cmux link.");
  expect(text).not.toContain("mismatch");
  expect(text).not.toContain("≠");
  expect(findAll(row, (node) => node.attributes?.role === "img")).toHaveLength(0);
});

describe("Evidence column exhibits", () => {
  function extractFn(signature: string): string {
    const start = source.indexOf(signature);
    if (start === -1) return "";
    const braceStart = source.indexOf("{", start);
    if (braceStart === -1) return "";
    let depth = 0;
    for (let i = braceStart; i < source.length; i++) {
      const ch = source[i];
      if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) return source.slice(start, i + 1);
      }
    }
    return "";
  }

  const TRACE = {
    resolution: "ambiguous" as const,
    reason: "cmux 6952219A-6C2F-4A61-9C0E-1F0B2D3E4A55 has conflicting open agent session files on ttys082.",
    surfaceId: "SURFACE-82",
    steps: [
      { tier: "recorded", outcome: "skipped", detail: "No recorded cmux target IDs on this source." },
      { tier: "session", outcome: "quarantined", detail: "ttys082 has open session files for two providers." },
      { tier: "cwd", outcome: "no-match", detail: "Two terminals report the same working folder." },
    ],
  };

  test("omits Git when the object is absent and never paints emoji lights", () => {
    const evidence = withDom(() => M.renderEvidence(agent({ cwd: "/repos/session" })));
    expect(byEvidenceSection(evidence, "git")).toBeNull();
    const text = textOf(evidence);
    expect(text).not.toContain("— no git");
    expect(text).not.toContain("⚪");
    expect(text).not.toContain("🟡");
    expect(text).not.toContain("🟢");
  });

  test("omits a transcript artifact the conversation foot already owns", () => {
    const selected = agent({
      cwd: "/repos/session",
      artifacts: [
        { kind: "transcript", label: "CODEX transcript", path: "/tmp/session.jsonl" },
        { kind: "file", label: "Notes", path: "/repos/session/notes.md" },
      ],
    });
    const evidence = withDom(() => M.renderEvidence(selected));
    const text = textOf(evidence);
    expect(text).not.toContain("/tmp/session.jsonl");
    expect(text).toContain("notes.md");
    expect(text).not.toContain("/repos/session/notes.md");
  });

  test("a lone cwd is the Workspace value, not a second Workspace label", () => {
    const evidence = withDom(() => M.renderEvidence(agent({ cwd: "/repos/session" })));
    const workspace = byEvidenceSection(evidence, "workspace");
    expect(byClass(workspace, "detail-grid")).toBeNull();
    expect(byClass(workspace, "evidence-value")).not.toBeNull();
    expect(byClass(workspace, "exhibit-body")).not.toBeNull();
    expect(byClass(workspace, "exhibit-readout")).not.toBeNull();
    expect(textOf(workspace)).toContain("/repos/session");
    expect(findAll(workspace, (node: any) => node.tagName === "dt")).toHaveLength(0);
    const copy = allByClass(workspace, "artifact-copy")[0];
    expect(copy.attributes["aria-label"]).toBe("Copy Workspace path");
    expect(copy.dataset.fullPath).toBe("/repos/session");
  });

  test("in-tree files under cwd render the relative suffix only", () => {
    const evidence = withDom(() => M.renderEvidence(agent({
      cwd: "/repos/session",
      artifacts: [{ kind: "file", label: "Report", path: "/repos/session/docs/REPORT.md" }],
    })));
    const text = textOf(evidence);
    expect(text).toContain("docs/REPORT.md");
    expect(text).not.toContain("/repos/session/docs/REPORT.md");
    expect(byClass(evidence, "artifact-label") && textOf(byClass(evidence, "artifact-label"))).toBe("Report");
    const copy = allByClass(evidence, "artifact-copy").find((node: any) =>
      String(node.attributes?.["aria-label"] || "").includes("full path"));
    expect(copy).toBeTruthy();
    expect(copy.attributes["aria-label"]).toBe("Copy full path");
    expect(copy.dataset.fullPath).toBe("/repos/session/docs/REPORT.md");
    expect(copy.dataset.fkey).toContain("/repos/session/docs/REPORT.md");
  });

  test("Git paints the short hash as git-rev inside a readout", () => {
    const evidence = withDom(() => M.renderEvidence(agent({
      cwd: "/repos/session",
      git: { branch: "feat/x", head: "abcdef123456", dirty: false },
    })));
    const git = byEvidenceSection(evidence, "git");
    expect(byClass(git, "exhibit-body")).not.toBeNull();
    expect(byClass(git, "exhibit-readout")).not.toBeNull();
    const rev = byClass(git, "git-rev");
    expect(rev).not.toBeNull();
    expect(textOf(rev)).toBe("@abcdef1");
  });

  test("desk CSS stays flat and plates lift", () => {
    const deskBlocks = [...styles.matchAll(/\.drawer-desk\s*\{([^}]*)\}/g)].map((m) => m[1]);
    expect(deskBlocks.join("\n")).not.toMatch(/linear-gradient/);
    for (const body of deskBlocks) {
      const shadows = [...body.matchAll(/box-shadow\s*:\s*([^;]+)/g)].map((m) => m[1].trim());
      for (const shadow of shadows) {
        expect(shadow === "none" || shadow.startsWith("none")).toBe(true);
      }
    }
    expect(styles).toMatch(/\.drawer-desk\s+\.exhibit\s*\{[^}]*box-shadow/);
    expect(styles).toMatch(/\.exhibit-readout\s*\{[^}]*inset/);
    expect(styles).not.toMatch(/\.artifact-copy\s*\{[^}]*opacity\s*:\s*0/);
    expect(styles).not.toMatch(/\.artifact-copy\s*\{[^}]*visibility\s*:\s*hidden/);
    const twoColDesk = styles.match(
      /@container agent-drawer \(min-width: 46rem\) \{[\s\S]*?\.drawer-grid \.drawer-desk \{([^}]*)\}/,
    )?.[1];
    expect(twoColDesk).toBeTruthy();
    expect(twoColDesk).not.toMatch(/\bborder\s*:/);
    const sandDesk = styles.match(
      /\n\.drawer-desk \{([^}]*overflow-y:\s*auto[^}]*--sand[^}]*)\}/,
    )?.[1];
    expect(sandDesk).toBeTruthy();
    expect(sandDesk).not.toMatch(/\bborder\s*:/);
    expect(styles).toMatch(/\.drawer-desk\s*\{[^}]*border-left:\s*2px\s+solid\s+var\(--ink\)/);
  });

  test("exhibit chrome classes are emitted by the client", () => {
    expect(source).toContain('class: "exhibit-body"');
    expect(source).toContain("exhibit-readout");
    expect(source).toContain('class: "git-rev"');
    expect(source).toContain("is-copied");
  });

  test("Pull request is its own omit-empty exhibit", () => {
    const withPr = withDom(() => M.renderEvidence(agent({
      cwd: "/repos/session",
      pullRequestUrls: ["https://github.com/example/the-mountain/pull/42"],
    })));
    expect(byEvidenceSection(withPr, "pr")).not.toBeNull();
    expect(textOf(withPr)).toContain("Pull request");
    expect(textOf(withPr)).toContain("the-mountain/pull/42");
    const empty = withDom(() => M.renderEvidence(agent({ cwd: "/repos/session", pullRequestUrls: [] })));
    expect(byEvidenceSection(empty, "pr")).toBeNull();
  });

  test("quarantined sessions still land a Route exhibit without identityTrace", () => {
    const quarantined = agent({
      controlState: "quarantined",
      target: { resolution: "ambiguous", surfaceId: "SURFACE-82" },
    });
    const evidence = withDom(() => M.renderEvidence(quarantined));
    expect(byEvidenceSection(evidence, "route")).not.toBeNull();
    expect(byClass(evidence, "identity-block")).not.toBeNull();
  });

  test("hydrated debug agent.trace paints bind rows the SSE payload omitted", () => {
    const bare = agent({
      controlState: "quarantined",
      target: { resolution: "ambiguous", surfaceId: "SURFACE-82" },
    });
    const ui = identityUi({
      identity: {
        agentId: "codex:a1",
        loading: false,
        error: "",
        data: { ok: true, agent: { trace: TRACE } },
      },
    });
    const evidence = withDom(() => M.renderEvidence(bare, ui));
    const text = textOf(evidence);
    expect(text).toContain("Session ID");
    expect(text).toContain("ttys082 has open session files for two providers.");
    expect(text).toContain("Working folder");
    expect(text).toContain("Two terminals report the same working folder.");
  });

  test("debug commandHints reach the Route surfaces after load", () => {
    const locked = agent({
      identityTrace: TRACE,
      target: { resolution: "ambiguous", surfaceId: "SURFACE-82" },
      controlState: "quarantined",
    });
    const ui = identityUi({
      identity: {
        agentId: "codex:a1",
        loading: false,
        error: "",
        data: {
          ok: true,
          agent: { trace: TRACE },
          relatedSurfaces: [{
            surfaceId: "SURFACE-82",
            tty: "ttys082",
            identityTrace: {
              commandHints: ["open files: ~/.cmux/sessions/codex-8f3a.jsonl", "hint: lsof -p 41211"],
            },
          }],
        },
      },
    });
    const evidence = withDom(() => M.renderEvidence(locked, ui));
    expect(textOf(evidence)).toContain("open files: ~/.cmux/sessions/codex-8f3a.jsonl");
    expect(textOf(evidence)).toContain("hint: lsof -p 41211");
  });

  /* The Route expander wears every mark of a two-way control — aria-expanded,
     an arrow the stylesheet rotates 90deg when open — but it was wired to a
     one-way loader: onclick always called loadIdentityEvidence, and nothing in
     the client ever set state.identity.agentId back to null. So the first click
     opened the terminal evidence and no click, ever, closed it again; the panel
     even reopened expanded when the same agent was re-selected.

     Asserted through the REAL handler rather than by reading the source, and
     twice over: the label has to say what the next activation does (every other
     toggle in this drawer does — evidence shelf, repo fold, program fold), and
     the surfaces have to be GONE from the next paint. Reading only
     aria-expanded would pass on a control that flips its own attribute while
     the evidence stays on screen. */
  test("the Route expander collapses again — a toggle, not a one-way load", async () => {
    const bare = agent({
      controlState: "quarantined",
      target: { resolution: "ambiguous", surfaceId: "SURFACE-82" },
    });
    const loaded = {
      agentId: "codex:a1",
      loading: false,
      error: "",
      data: { ok: true, agent: { trace: TRACE } },
    };
    await withState({ identity: loaded }, () => withRequests([], () => withDomAsync(async () => {
      const open = M.renderEvidence(bare, M.state);
      const expand = byClass(open, "identity-expand");
      expect(expand.attributes["aria-expanded"]).toBe("true");
      expect(byClass(open, "identity-surfaces")).not.toBeNull();
      /* It is open, so the control's job now is to CLOSE. A label frozen at
         "Show…" is the bug telling on itself. */
      expect(String(expand.attributes["aria-label"])).toMatch(/hide|collapse/i);

      await fire(expand);

      expect(M.state.identity.agentId).toBeNull();
      const shut = M.renderEvidence(bare, M.state);
      expect(byClass(shut, "identity-surfaces")).toBeNull();
      expect(byClass(shut, "identity-expand").attributes["aria-expanded"]).toBe("false");
      expect(String(byClass(shut, "identity-expand").attributes["aria-label"])).toMatch(/show/i);
    })));
  });

  test("Exact sessions omit skipped Working folder rows", () => {
    const exact = agent({
      target: { resolution: "exact" },
      identityTrace: {
        resolution: "exact",
        matchedTier: "session",
        steps: [
          { tier: "session", outcome: "matched", detail: "One cmux pane reports this session on ttys082." },
          { tier: "cwd", outcome: "skipped", detail: "Working folder skipped because session ID already matched." },
        ],
      },
    });
    const evidence = withDom(() => M.renderEvidence(exact));
    const binds = allByClass(evidence, "route-bind");
    expect(binds.length).toBe(1);
    expect(textOf(binds[0])).toContain("Session ID");
    expect(textOf(binds[0])).toContain("ttys082");
    expect(textOf(evidence)).not.toContain("Working folder skipped");
    expect(textOf(evidence)).not.toContain("skipped");
  });

  test("Evidence never paints Verify, header vitals, or a sticky Evidence head", () => {
    const evidenceFn = extractFn("function renderEvidence(agent, ui = state) {");
    const drawerFn = extractFn("function renderAgentDrawer(pane, view) {");
    expect(evidenceFn).toBeTruthy();
    expect(evidenceFn).not.toContain("agent.tests");
    expect(evidenceFn).not.toContain('"Verify"');
    expect(evidenceFn).not.toContain("Tests not reported");
    expect(drawerFn).not.toContain('class: "drawer-section-head sticky-head drawer-evidence-head"');
    expect(drawerFn).not.toMatch(/el\("h3", \{ class: "section-title" \}, "Evidence"\)/);
    const pane = newNode("div");
    withDom(() => M.renderAgentDrawer(pane, {
      kind: "agent",
      agent: agent({ cwd: "/repos/session" }),
      program: { id: "p", name: "P", agents: [] },
    }));
    const desk = byClass(pane, "drawer-desk");
    expect(byClass(desk, "drawer-evidence-head")).toBeNull();
    expect(byClass(desk, "chat-msg")).toBeNull();
    const text = textOf(withDom(() => M.renderEvidence(agent({
      cwd: "/repos/session",
      contextPct: 28,
      tokens: { provenance: "observed", total: 71_000, contextWindow: 258_000, sessionTotal: 2_200_000 },
      lastAgentMessage: "rebased, 412 tests green",
    }))));
    expect(text).not.toContain("Paths & Usage");
    expect(text).not.toContain("Linked for Focus and Send.");
    expect(text).not.toContain("Ready · linked");
    expect(text).not.toContain("rebased, 412 tests green");
    expect(text).not.toContain("28%");
    expect(text).not.toContain("2.2M");
  });

  test("Git dirty uses the official mark plus a pip, never uncommitted prose", () => {
    const evidence = withDom(() => M.renderEvidence(agent({
      cwd: "/repos/session",
      git: { branch: "feat/x", head: "abcdef123456", dirty: true },
    })));
    expect(byEvidenceSection(evidence, "git")).not.toBeNull();
    expect(byClass(evidence, "git-dirty")).not.toBeNull();
    expect(textOf(evidence)).toContain("feat/x");
    expect(textOf(evidence)).toContain("@abcdef1");
    expect(textOf(evidence)).not.toContain("uncommitted");
    expect(textOf(evidence)).not.toContain("● clean");
  });
});

test("CWD-SEM-2 an explicit surface rename still wins when known directories differ", async () => {
  const linked = agent({
    surfaceTitle: "Operator pane name",
    target: {
      resolution: "exact",
      surfaceId: "SURFACE-RENAMED",
      workspaceId: "WORKSPACE-RENAMED",
      workspaceTitle: "Workspace-generated title",
      cwdRelation: "different",
    },
  });

  await withState({ aliases: new Map() }, () => {
    expect(M.agentName(linked)).toBe("Operator pane name");
  });
});

/* The legacy status word a fixture asks for, translated into the lifecycle the
   server would actually publish beside it. Fixtures here are hand-written wire
   payloads, and the server puts `lifecycle` on every agent now — one without it
   is a snapshot from an older server, which is a real case but not the one most
   of these tests are about. Overriding `lifecycle` explicitly still works, and
   omitting BOTH is how the legacy-fallback tests exercise the fallback. */
const LIFECYCLE_FOR_STATUS: Record<string, string> = {
  running: "working",
  waiting: "waiting",
  // The old activityFor mapped `waiting|attention -> idle`, and idle is Waiting.
  attention: "waiting",
  stale: "unverified",
  archived: "finished",
};

/* Some fixtures state the older ACTIVITY word instead. Same translation, other
   vocabulary — and it is the vocabulary the server derives from the lifecycle
   now, so reading it back the other way is exactly right. */
const LIFECYCLE_FOR_ACTIVITY: Record<string, string> = {
  working: "working",
  idle: "waiting",
  unknown: "unverified",
  ended: "finished",
};

function agent(overrides: Record<string, unknown> = {}) {
  const status = typeof overrides.status === "string" ? overrides.status : "running";
  const activity = typeof overrides.activity === "string" ? overrides.activity : undefined;
  return {
    id: "codex:a1",
    provider: "codex",
    sourceSessionId: "a1",
    displayName: "Ridge worker",
    programId: "p1",
    status: "running",
    statusReason: "Streaming output.",
    updatedAt: "2026-07-22T03:00:00.000Z",
    lifecycle: (activity ? LIFECYCLE_FOR_ACTIVITY[activity] : LIFECYCLE_FOR_STATUS[status]) ?? "working",
    scope: "observed",
    tokens: { provenance: "observed", total: 1200 },
    artifacts: [],
    gates: [],
    target: { resolution: "exact", surfaceId: "s1", workspaceId: "w1" },
    controls: [],
    ...overrides,
  };
}

function snapshot(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    generatedAt: "2026-07-22T03:00:00.000Z",
    controlHealth: { cmuxReachable: true, lastCheckedAt: "", errors: [], staleSources: [] },
    totals: {
      live: 1, tracked: 1, attention: 0, working: 1, idle: 0, history: 0,
      byLifecycle: { working: 1, waiting: 0, unverified: 0, finished: 0 },
      retained: 0,
      sourceHealth: { healthy: 2, degraded: 0, absent: 0, total: 2 },
    },
    programs: [{ id: "p", name: "P", agents: [agent()] }],
    ...overrides,
  };
}

/* ---------------------------------------------------------------------------
   FE-B shared render harness.

   The client guards all DOM wiring behind `typeof document`, so a minimal fake
   document lets its real render functions build real nodes through el()/icon().
   Tests can then assert on what a surface RENDERS instead of on the source text
   that builds it. The node is a linked list (firstChild/nextSibling/insertBefore/
   remove) because the keyed row reconciler manipulates siblings directly.
   ------------------------------------------------------------------------- */
export interface FakeNode {
  nodeType: number;
  tagName: string;
  className: string;
  textContent: string;
  hidden?: boolean;
  id?: string;
  dataset: Record<string, string>;
  attributes: Record<string, string>;
  classList: { add(...c: string[]): void; remove(...c: string[]): void; toggle(c: string, on?: boolean): void; contains(c: string): boolean };
  children: FakeNode[];
  parent: FakeNode | null;
  value?: unknown;
  readonly firstChild: FakeNode | null;
  readonly nextSibling: FakeNode | null;
  setAttribute(k: string, v: unknown): void;
  hasAttribute(k: string): boolean;
  // el() wires every handler through addEventListener, so the harness has to
  // record them or no test can click anything the client builds.
  listeners: Record<string, Array<(event: unknown) => unknown>>;
  addEventListener(type: string, fn: (event: unknown) => unknown): void;
  append(...kids: unknown[]): void;
  insertBefore(node: FakeNode, ref: FakeNode | null): void;
  remove(): void;
}

function makeNode(tag: string): FakeNode {
  const classes = new Set<string>();
  let text = "";
  const node = {
    nodeType: 1,
    tagName: tag,
    /* An accessor, because `textContent = ""` is how every render function in
       this client empties the surface it is about to rebuild — and a plain
       property let those children survive the wipe. Tests worked around it by
       rendering once per withDom; that workaround is what made "click the
       control, then look at what the repaint produced" untestable, because the
       second paint stacked onto the first and byFkey found the stale node.
       The real DOM drops children here, so this is the harness getting less
       wrong, not a new fiction. */
    get textContent() { return text; },
    set textContent(v: string) { text = String(v ?? ""); node.children.length = 0; },
    dataset: {} as Record<string, string>,
    attributes: {} as Record<string, string>,
    children: [] as FakeNode[],
    parent: null as FakeNode | null,
    get className() { return [...classes].join(" "); },
    set className(v: string) {
      classes.clear();
      for (const c of String(v).split(/\s+/)) if (c) classes.add(c);
    },
    classList: {
      add(...c: string[]) { for (const x of c) if (x) classes.add(x); },
      remove(...c: string[]) { for (const x of c) classes.delete(x); },
      toggle(c: string, on?: boolean) { if (on === undefined ? classes.has(c) : !on) classes.delete(c); else classes.add(c); },
      contains(c: string) { return classes.has(c); },
    },
    // Render code asks for childNodes/childElementCount to decide whether a
    // panel is empty; both are the same array in this DOM-less stand-in.
    get childNodes(): FakeNode[] { return node.children; },
    get childElementCount(): number { return node.children.length; },
    get firstChild(): FakeNode | null { return node.children[0] || null; },
    get nextSibling(): FakeNode | null {
      if (!node.parent) return null;
      const i = node.parent.children.indexOf(node as unknown as FakeNode);
      return (i >= 0 && node.parent.children[i + 1]) || null;
    },
    setAttribute(k: string, v: unknown) { node.attributes[k] = String(v); },
    /* Same "present but finds nothing" contract fakeDocument already offers.
       Selector matching is not implemented here on purpose — tests reach nodes
       through byFkey/byClass, which walk the real tree. These exist so a paint
       path that merely LOOKS for an optional node (focus restore, drawer lead
       focus) takes its not-found branch instead of dying on a TypeError. */
    querySelector: () => null,
    querySelectorAll: () => [] as unknown[],
    /* The real DOM has it and the client uses it — the notify control removes
       aria-pressed and disabled rather than writing a falsey value, because an
       element carrying `aria-pressed="false"` is a toggle that happens to be
       off, not a disclosure. A stub that silently lacked it made that a
       TypeError only the paint path could find. */
    removeAttribute(k: string) { delete node.attributes[k]; },
    hasAttribute(k: string) { return k in node.attributes; },
    listeners: {} as Record<string, Array<(event: unknown) => unknown>>,
    addEventListener(type: string, fn: (event: unknown) => unknown) {
      (node.listeners[type] ??= []).push(fn);
    },
    append(...kids: unknown[]) {
      for (const kid of kids) {
        if (kid == null) continue;
        node.children.push(kid as FakeNode);
        if (typeof kid === "object" && kid !== null && "parent" in (kid as FakeNode)) (kid as FakeNode).parent = node as unknown as FakeNode;
      }
    },
    insertBefore(child: FakeNode, ref: FakeNode | null) {
      if (child.parent) {
        const at = child.parent.children.indexOf(child);
        if (at >= 0) child.parent.children.splice(at, 1);
      }
      child.parent = node as unknown as FakeNode;
      const i = ref ? node.children.indexOf(ref) : -1;
      if (i === -1) node.children.push(child);
      else node.children.splice(i, 0, child);
    },
    remove() {
      if (!node.parent) return;
      const at = node.parent.children.indexOf(node as unknown as FakeNode);
      if (at >= 0) node.parent.children.splice(at, 1);
      node.parent = null;
    },
  };
  return node as unknown as FakeNode;
}

const domById = new Map<string, FakeNode>();
function fakeDocument() {
  domById.clear();
  return {
    createElement: (t: string) => makeNode(t),
    createElementNS: (_ns: string, t: string) => makeNode(t),
    createTextNode: (s: string) => ({ nodeType: 3, textContent: String(s) }),
    getElementById: (id: string) => {
      if (!domById.has(id)) domById.set(id, makeNode("div"));
      return domById.get(id) as FakeNode;
    },
    /* A real document has one, and renderInspector reaches for its classList.
       Without it any test that drives a handler through the full render() dies
       on plumbing rather than on the behaviour it is asking about. */
    body: makeNode("body"),
    querySelectorAll: () => [] as unknown[],
    querySelector: () => null,
  };
}

function withDom<T>(fn: () => T): T {
  (globalThis as unknown as { document: unknown }).document = fakeDocument();
  try { return fn(); } finally {
    delete (globalThis as unknown as { document?: unknown }).document;
  }
}

/* withDom's sibling for handlers that must be AWAITED. The sync version deletes
   the document in its finally, which runs the moment fn returns a promise —
   long before an async click handler gets to call render(). Any test that fires
   a real handler and then inspects the repaint needs this one. */
async function withDomAsync<T>(fn: () => Promise<T> | T): Promise<T> {
  (globalThis as unknown as { document: unknown }).document = fakeDocument();
  try { return await fn(); } finally {
    delete (globalThis as unknown as { document?: unknown }).document;
  }
}

function newNode(tag = "div"): FakeNode {
  return makeNode(tag);
}

/* ---------------------------------------------------------------------------
   W4-B request harness.

   The client's request and confirmation logic was private, so the tests that
   covered it asserted that substrings appear in the raw text of app.js. Those
   tests gate the deploy and cannot fail when the behaviour breaks: sendControl
   could stop requiring confirmation, or start treating HTTP 200 as success, and
   every one of them would still pass.

   app.js now exports the request functions and the module state they mutate.
   This drives them for real against a fake `fetch` and the fake document, so
   the assertions are about what the client SENDS and what it then BELIEVES.
   ------------------------------------------------------------------------- */
export interface FakeCall { url: string; method: string; body: any }
type FakeReply = { status?: number; json?: unknown; headers?: Record<string, string> } | Error;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const G = globalThis as any;

async function withRequests<T>(replies: FakeReply[], fn: (calls: FakeCall[]) => Promise<T> | T): Promise<T> {
  const calls: FakeCall[] = [];
  const realFetch = G.fetch;
  const realDoc = G.document;
  const realCss = G.CSS;
  const document = fakeDocument() as Record<string, unknown>;
  // render() toggles a class on document.body and restores focus through
  // CSS.escape; neither exists in Bun, and both are on the real paint path.
  document.body = makeNode("body");
  G.document = document;
  G.CSS = realCss ?? { escape: (s: string) => s };
  let index = 0;
  G.fetch = async (url: string, init: Record<string, any> = {}) => {
    const reply = replies[Math.min(index, replies.length - 1)] ?? { status: 200, json: { ok: true } };
    index += 1;
    calls.push({
      url: String(url),
      method: String(init.method || "GET").toUpperCase(),
      body: typeof init.body === "string" ? JSON.parse(init.body) : null,
    });
    if (reply instanceof Error) throw reply;
    const status = reply.status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: {
        get: (name: string) => reply.headers?.[name.toLowerCase()] ?? null,
      },
      json: async () => {
        if (!("json" in reply)) throw new Error("response is not JSON");
        return reply.json;
      },
    };
  };
  try {
    return await fn(calls);
  } finally {
    G.fetch = realFetch;
    if (realDoc === undefined) delete G.document; else G.document = realDoc;
    if (realCss === undefined) delete G.CSS; else G.CSS = realCss;
  }
}

describe("client request deadlines", () => {
  test("a request that never settles rejects before it can leave the dashboard waiting", async () => {
    const realFetch = G.fetch;
    G.fetch = (_url: string, init: Record<string, any>) => new Promise((_resolve, reject) => {
      init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true });
    });
    try {
      const recovered = await Promise.race([
        M.apiFetch("/api/snapshot", {}, 5).then(() => null, (error: Error) => error),
        Bun.sleep(100).then(() => null),
      ]);
      expect(recovered).toBeInstanceOf(Error);
    } finally {
      G.fetch = realFetch;
    }
  });

  test("timeouts name their endpoint and differ from network failures", async () => {
    const realFetch = G.fetch;
    try {
      G.fetch = (_url: string, init: Record<string, any>) => new Promise((_resolve, reject) => {
        init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true });
      });
      const timeout = await M.apiFetch("/api/snapshot", {}, 5).catch((error: Error) => error);
      G.fetch = async () => { throw new Error("connection refused"); };
      const network = await M.apiFetch("/api/snapshot", {}, 5).catch((error: Error) => error);

      expect(timeout.message).toBe("/api/snapshot timed out after 0.005s");
      expect(network.message).toBe("/api/snapshot request failed: connection refused");
      expect(network.message).not.toBe(timeout.message);
    } finally {
      G.fetch = realFetch;
    }
  });

  test("a snapshot request failure still marks the feed as failed", async () => {
    await withState({ snap: null, conn: "live", fetchFailed: false }, async () => {
      await withRequests([new Error("connection refused")], async () => {
        await M.fetchSnapshot();
        expect(M.state.fetchFailed).toBe(true);
        expect(M.state.conn).toBe("offline");
      });
    });
  });

  test("only apiFetch calls fetch directly", () => {
    expect(source.match(/\bfetch\(/g)).toHaveLength(1);
  });
});

/* The seam exports the REAL module state, so every test that writes it puts
   back exactly what it found. Paint signatures are reset too: the guards early-
   return on an unchanged signature, so a leftover one would silently skip the
   very paint under test. */
async function withState<T>(patch: Record<string, unknown>, fn: () => Promise<T> | T): Promise<T> {
  const full = {
    paintSig: { programs: "", inspector: "", widgets: "", alarm: null, actions: null },
    ...patch,
  };
  const keys = Object.keys(full);
  const saved = Object.fromEntries(keys.map((key) => [key, M.state[key]]));
  Object.assign(M.state, full);
  try {
    return await fn();
  } finally {
    Object.assign(M.state, saved);
  }
}

function requiredSlice(haystack: string, pattern: RegExp, label: string): string {
  const match = haystack.match(pattern)?.[0];
  if (!match) throw new Error(`Required ${label} source slice no longer matches`);
  return match;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function textOf(node: any): string {
  if (!node || typeof node !== "object") return "";
  if (node.nodeType === 3) return String(node.textContent || "");
  let s = typeof node.textContent === "string" ? node.textContent : "";
  for (const kid of node.children || []) s += textOf(kid);
  return s;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function findAll(node: any, pred: (n: any) => boolean, out: any[] = []): any[] {
  if (!node || typeof node !== "object") return out;
  if (pred(node)) out.push(node);
  for (const kid of node.children || []) findAll(kid, pred, out);
  return out;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const buttonsOf = (node: any) => findAll(node, (n) => n.tagName === "button");

/* Fire a recorded handler. Returns whatever the handler returns, so an async
   click can be awaited — the request functions are all async. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fire(node: any, type = "click", event: Record<string, unknown> = {}): Promise<void> {
  // Native disabled controls do not dispatch click, submit-from-control, or
  // keyboard events in a browser. Keep the fake DOM honest about that safety
  // boundary so a disabled-looking control cannot pass by invoking its handler.
  if (node?.hasAttribute?.("disabled")) return;
  const handlers = (node && node.listeners && node.listeners[type]) || [];
  if (!handlers.length) throw new Error(`no ${type} handler on <${node && node.tagName}>`);
  for (const handler of handlers) await handler({ preventDefault() {}, stopPropagation() {}, ...event });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const byFkey = (node: any, key: string) =>
  findAll(node, (n) => n.dataset && n.dataset.fkey === key)[0] || null;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const allByClass = (node: any, token: string) =>
  findAll(node, (n) => typeof n.className === "string" && n.className.split(/\s+/).includes(token));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const byClass = (node: any, token: string) => allByClass(node, token)[0] || null;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const byEvidenceSection = (node: any, name: string) =>
  findAll(node, (n) => n.dataset && n.dataset.evidenceSection === name)[0] || null;

/* A stand-in for the module's `state`, for helpers that take it as an argument. */
function identityUi(overrides: Record<string, unknown> = {}) {
  return {
    snap: null,
    queueItems: [] as unknown[],
    triage: new Map(),
    triagePending: new Set<string>(),
    evidenceOpen: false,
    pending: new Set<string>(),
    feedback: new Map(),
    drafts: new Map(),
    confirming: null,
    renaming: null,
    renameDraft: "",
    renamePending: false,
    renameError: "",
    labelsLoading: false,
    labelLoadError: "",
    labels: new Map<string, string>(),
    identity: { agentId: null, loading: false, error: "", data: null },
    ...overrides,
  };
}

/* A `state` stand-in for renderTriage. */
function triageUi(overrides: Record<string, unknown> = {}) {
  return {
    queueItems: [] as unknown[],
    triage: new Map(),
    triagePending: new Set<string>(),
    triageErrors: new Map(),
    ...overrides,
  };
}

/* A `state` stand-in for the list helpers (row/shell signatures, row plans). */
function listUi(overrides: Record<string, unknown> = {}) {
  return {
    snap: null,
    view: "now",
    query: "",
    facetProgram: "",
    // The lenses are SETS now (FE-2 / amendment 1): empty = lens off.
    facetClasses: [] as string[],
    facetProviders: [] as string[],
    facetStatuses: [] as string[],
    facetModels: [] as string[],
    facetSpans: [] as string[],
    facetContexts: [] as string[],
    openFilterMenu: "",
    showReviewWorkers: false,
    lookbackHours: 24,
    contextDisplay: "percent",
    selected: null,
    selectedId: null,
    programOverrides: new Map<string, string>(),
    // Repo bands default to OPEN when they hold a session the view admits, so
    // an empty override map is a board with nothing folded up — which is what a
    // first load actually looks like.
    repoOverrides: new Map<string, string>(),
    // Absent means collapsed, so the default fixture is a board whose swarms
    // are all folded — which is what a first load actually looks like.
    swarmOverrides: new Map<string, string>(),
    // Same default as swarms: collapsed unless the operator opened it.
    shelfOverrides: new Map<string, string>(),
    labels: new Map<string, string>(),
    renaming: null,
    renameDraft: "",
    renamePending: false,
    renameError: "",
    ...overrides,
  };
}

/* The drawer's two content surfaces, rendered and flattened to text. `operate`
   is gone; the Document and Desk columns stay visible together. */
function panelTexts(a: Record<string, unknown>) {
  return withDom(() => ({
    chat: textOf(M.renderChat(a)),
    evidence: textOf(M.renderEvidence(a)),
  }));
}

describe("summary status and widgets", () => {
  test("maps live connection, source, and control evidence to one system verdict", () => {
    const healthy = snapshot();
    expect(M.systemStatus(healthy, "live").label).toBe("Operational");
    expect(M.systemStatus(snapshot({ totals: { ...healthy.totals, sourceHealth: { healthy: 1, degraded: 1, absent: 0, total: 2 } } }), "live").label).toBe("Degraded");
    expect(M.systemStatus(snapshot({ controlHealth: { ...healthy.controlHealth, cmuxReachable: false } }), "live").label).toBe("Degraded");
    expect(M.systemStatus(healthy, "stale").label).toBe("Degraded");
    expect(M.systemStatus(null, "offline").label).toBe("Offline");
  });

  /* F3: "Degraded" said something is wrong and never the question an operator
     actually has — am I blocked, or is this cosmetic? cmux unreachable (Focus
     and Send dead) and 15 tidy-up warnings both rendered the same word. */
  test("a Degraded verdict says whether the operator is blocked or merely informed", () => {
    const healthy = snapshot();
    expect(M.degradedSeverity(healthy, "live", false)).toBeNull(); // Operational is untouched

    // Blocking: the control plane is gone, so no operator action can route.
    const noCmux = snapshot({ controlHealth: { ...healthy.controlHealth, cmuxReachable: false } });
    expect(M.degradedSeverity(noCmux, "live", false)).toMatchObject({ key: "blocking", label: "Blocking" });
    expect(M.degradedSeverity(noCmux, "live", false).detail).toContain("Focus and Send");
    expect(M.degradedSeverity(null, "offline", false)).toMatchObject({ key: "blocking" });

    // Stale: controls work, but the numbers may have moved on. Distinct from
    // blocking, because the fix is a refresh rather than repairing the plane.
    expect(M.degradedSeverity(healthy, "stale", false)).toMatchObject({ key: "stale" });
    expect(M.degradedSeverity(healthy, "live", true)).toMatchObject({ key: "stale" });
    expect(M.degradedSeverity(healthy, "live", true).detail).toContain("previous good snapshot");

    // Advisory: the live case — cmux reachable, everything usable, evidence
    // just needs tidying. This must NOT read as blocking.
    const noisy = snapshot({ controlHealth: { ...healthy.controlHealth, errors: ["conflicting session files"] } });
    const advisory = M.degradedSeverity(noisy, "live", false);
    expect(advisory).toMatchObject({ key: "advisory", label: "Advisory" });
    expect(advisory.detail).toContain("usable");

    // Severity outranks reason: a blocked board says so even when the loudest
    // finding is a mere warning, which is the case that misled operators.
    const blockedAndNoisy = snapshot({
      controlHealth: { ...healthy.controlHealth, cmuxReachable: false, errors: ["conflicting session files"] },
    });
    expect(M.degradedSeverity(blockedAndNoisy, "live", false).key).toBe("blocking");
  });

  /* The empty state froze at first paint. programsPaintSig is built from the
     VISIBLE ROWS, so when a view has none the signature is constant and the
     whole block below it — the all-clear verdict, its vitals, the open-findings
     line — was skipped forever after the first render. Measured in the browser:
     the client's collection said BETA while the DOM still named a finding from
     minutes earlier, and the resting board's "37 live · 7 working" vitals were
     frozen with it. Those numbers exist so an operator can tell "nothing is
     wrong" from "nothing is loading", which a stale number cannot do.

     Pre-existing, and invisible while the block held only static prose. */
  test("the empty state repaints when what it renders changes", () => {
    const calm = agent({ id: "a", outcome: "healthy", activity: "working" });
    const sig = (issues: unknown[], live: number) => M.programsPaintSig([], {
      ...M.state,
      view: "needs-you",
      snap: snapshot({
        programs: [{ id: "p", name: "P", agents: [calm] }],
        issues,
        totals: { live, tracked: live, working: live, idle: 0, history: 0, attention: 0 },
      }),
    });
    const fault = (title: string) => [{
      id: "system:z", kind: "system", severity: "warning", title,
      summary: "s", affectedAgentIds: [],
    }];

    // Nothing open vs something open must differ, or the all-clear can survive
    // a finding arriving.
    expect(sig([], 3)).not.toBe(sig(fault("ALPHA"), 3));

    /* Same id, different wording. Keying the signature on finding ids alone
       repainted once and then froze again — this is the assertion that caught
       it, after the browser did. */
    expect(sig(fault("ALPHA"), 3)).not.toBe(sig(fault("BETA"), 3));

    // The vitals are rendered too, so a changed fleet must repaint them.
    expect(sig([], 3)).not.toBe(sig([], 4));

    // And an unchanged empty state must still be stable, or every snapshot
    // repaints the board for nothing.
    expect(sig(fault("ALPHA"), 3)).toBe(sig(fault("ALPHA"), 3));
  });

  /* The calm line's bullet is punctuation, and punctuation does not outlive its
     sentence.

     Suppressing "0 shipping" at zero tracked (day-one review, 70ed00b) left the
     mark rendering alone. Measured in the browser on a rebuilt n=0 fixture at
     aba5551: mark "●", copy "", chip "All clear" — an orphaned dot before the
     verdict, on the one screen whose whole job is to look deliberate rather than
     broken. */
  test("the calm line drops its bullet when it has nothing to say", () => {
    /* A shape assertion over the renderer's source, and deliberately not a
       behavioural one: renderPulseCalm is not exported, and exporting a renderer
       purely to test it would widen this patch past the defect it fixes. The
       trade is stated so the next reader knows what this does and does not
       prove — it binds to the GATE, not to the pixels, and a rename of `copy`
       will fail it even though behaviour is intact.

       Mutation-checked: reverting the two spans to their unconditional form
       fails this test, so it cannot pass over the bug it was written for. */
    const src = readFileSync(join(import.meta.dir, "../src/web/app.js"), "utf8");
    const fn = src.slice(src.indexOf("function renderPulseCalm"));
    const body = fn.slice(0, fn.indexOf("\n}\n"));

    // BOTH spans gate on the copy. A mark surviving an empty copy is the bug.
    expect(body).toMatch(/copy \? el\("span", \{ class: "pulse-calm-mark"/);
    expect(body).toMatch(/copy \? el\("span", \{ class: "pulse-calm-copy"/);
    expect(body).not.toMatch(/\n\s*el\("span", \{ class: "pulse-calm-mark"/);
  });

  /* Seen whole rather than one change at a time.

     A cmux pane title is a LIVE terminal title, so it carries whatever frame the
     agent inside was drawing when the scan ran. Measured on main's board:
     agentName() returned "⠐ Swarm audit backend investigation with codex" — one
     frame of Claude Code's braille spinner, frozen into the session's NAME and
     rendered everywhere that name goes: roster row, the finding title in the
     summary band, the drawer head, the notification. displayName was clean
     throughout, which is why no single surface looked broken. */
  test("a spinner frame in a pane title never becomes the session's name", () => {
    for (const [raw, want] of [
      ["⠐ Swarm audit backend investigation", "Swarm audit backend investigation"],
      ["⠂ Deploy backend fixes via Codex", "Deploy backend fixes via Codex"],
      ["✻ Working on it", "Working on it"],
      ["✽ ✻ Two frames", "Two frames"],
    ]) {
      expect(M.stripSpinnerFrame(raw)).toBe(want);
    }

    /* Only leading spinners, and only spinner families. Names legitimately
       carry emoji and punctuation, and a rule broad enough to eat those would
       trade a cosmetic bug for a naming one. */
    expect(M.stripSpinnerFrame("🚀 ship it")).toBe("🚀 ship it");
    expect(M.stripSpinnerFrame("the-mountain ⠐ main")).toBe("the-mountain ⠐ main");
    expect(M.stripSpinnerFrame("Claude · the-mountain-main")).toBe("Claude · the-mountain-main");
    expect(M.stripSpinnerFrame("")).toBe("");
  });

  /* Two fixes, each correct, composing into a crossed sentence. The rate's
     window was appended AFTER the cost clause, so with the cost restored the
     cell read "36k/min · $4.20 last hour · 10m average" — the rate's qualifier
     separated from the rate by a differently-windowed number, and therefore
     reading as the cost's. It was unambiguous only while the cost was null. */
  test("each burn figure keeps its own window beside it", () => {
    const data = M.summaryWidgetData("burn", snapshot({
      pulse: { burn: { tokensPerMin: 35_519, windowMs: 600_000, costLastHourUsd: 4.2 } },
    }), "live", "percent", [], false);

    expect(data.sublabel).toBe("10m average · $4.20 last hour");
    // The window is adjacent to the rate it describes, not trailing the cost.
    expect(data.sublabel.indexOf("10m average")).toBeLessThan(data.sublabel.indexOf("last hour"));
  });

  /* Three refusals, three answers to "can I do anything about this?"

     They all end in the same disabled button, and archived and dead both
     collapse to the control state "observed-only", so before this they shared
     one sentence about cmux routing. That sentence is wrong for both — most
     wrong for archive, where nothing failed and the operator chose it. */
  test("the three refusals are distinct, and each says whether it is recoverable", () => {
    const routed = { surfaceId: "s1", resolution: "exact", workspaceTitle: "cmux: alpha" };
    const brief = (a: Record<string, unknown>) => M.quarantineBrief(a, M.deriveControlState(a));

    const pane = brief(agent({
      activity: "working", status: "running",
      target: { surfaceId: "s1", resolution: "unique-cwd", workspaceTitle: "cmux: alpha" },
    }));
    const dead = brief(agent({
      activity: "ended", lifecycle: "finished", provenance: "process-died",
      processState: "died", processAlive: false, processIds: [123], target: routed,
    }));
    const archived = brief(agent({
      activity: "ended", lifecycle: "finished", provenance: "operator-archive", target: routed,
    }));

    // Three different sentences, not one message wearing three hats.
    const titles = [pane.title, dead.title, archived.title];
    expect(new Set(titles).size).toBe(3);
    expect(archived.cause).toBe("archived");
    expect(dead.cause).toBe("died");

    /* The recoverable one offers the recovery. */
    expect(pane.nextStep).toMatch(/Focus still works/);

    /* The unrecoverable one refuses to invent one. Every other refusal on this
       board ends with the thing that would fix it, and inventing a step here
       would send an operator to retry what cannot work. */
    expect(dead.nextStep).toMatch(/Nothing will bring it back/);
    expect(dead.why).toMatch(/may since have been taken/);
    expect(dead.nextStep).not.toMatch(/cmux|Focus|attest/i);

    /* The chosen one must not read as a fault, and must not offer a repair for
       a decision. */
    expect(archived.summary).toMatch(/not because anything failed/);
    expect(archived.nextStep).toMatch(/Nothing to do/);
    expect(archived.nextStep).not.toMatch(/cmux|pane|repair/i);
    expect(archived.why).not.toMatch(/cmux/i);

    /* Archived beats dead beats routing: an archived session's controls are off
       because it is archived, whatever its pane says. Naming a terminal-binding
       problem for a session that has ENDED sends the operator to fix something
       that no longer matters. */
    const both = brief(agent({
      activity: "ended", lifecycle: "finished", provenance: "operator-archive",
      processState: "died", processAlive: false, processIds: [1], target: { resolution: "ambiguous" },
    }));
    expect(both.cause).toBe("archived");

    // And the short form the dock's accessible text uses splits the same way.
    expect(M.controlUnavailableText("observed-only", agent({
      activity: "ended", lifecycle: "finished", provenance: "operator-archive",
    }))).toMatch(/you archived/i);
    expect(M.controlUnavailableText("observed-only", agent({
      activity: "ended", lifecycle: "finished", provenance: "process-died",
      processState: "died", processAlive: false, processIds: [1],
    }))).toMatch(/process is gone/);
    /* The ending a human did NOT make now says so. It used to read "this
       session is archived" for a provider exit, which credits the operator with
       a decision they never took. */
    expect(M.controlUnavailableText("observed-only", agent({
      activity: "ended", lifecycle: "finished", provenance: "provider-exit",
    }))).toMatch(/session exit/i);
    // With no agent it still answers, rather than throwing on the old signature.
    expect(M.controlUnavailableText("quarantined")).toMatch(/ambiguous/);
  });

  /* A cwd string is not an identity, and the UI must not call it one.

     Proven against probe agents: a Send addressed to ALPHA executed on BRAVO's
     tty and returned ok: true. control.ts authorised writes on `exact` OR
     `unique-cwd`, and unique-cwd picks among panes whose identity evidence is
     EMPTY, by elimination on a directory string. The trigger is mundane — one
     pane cds away, another cds in.

     The server now refuses the write. This pins the half an operator sees: a
     greyed button with no explanation reads as a bug and gets retried, which is
     the exact behaviour that makes a safety gate useless. */
  test("a pane matched only by directory is its own state, not Linked", () => {
    const attested = agent({ target: { surfaceId: "s1", resolution: "exact" } });
    const guessed = agent({ target: { surfaceId: "s1", resolution: "unique-cwd" } });

    expect(M.deriveControlState(attested)).toBe("linked");
    expect(M.deriveControlState(guessed)).toBe("unproven");
    // The word the operator reads must not claim a link the server will refuse.
    expect(M.CONTROL_LABELS.unproven).not.toMatch(/linked/i);

    /* The refusal has to carry all three, or it reads as a fault: what is off,
       why, and what turns it back on. */
    /* The three facts must all be present, but they are split across the brief's
       three fields rather than repeated in each — measured at real drawer width,
       saying all three in every field ran to three paragraphs that restated one
       another, and a long refusal gets skipped. */
    const b = M.quarantineBrief(guessed, "unproven");
    expect(M.controlUnavailableText("unproven")).toMatch(/are off/i);          // off, not broken
    expect(M.controlUnavailableText("unproven")).toMatch(/cannot confirm/i);   // the cause
    expect(b.why).toMatch(/wrong agent/i);                                     // the risk
    expect(b.nextStep).toMatch(/Focus still works/i);                          // what still works

    /* Focus names its destination on exactly these rows. Adversarial
       verification found a rotated row keeps focus:true while its target has
       moved, so Focus can walk an operator to a stranger's terminal. "Go and
       look" is only safe advice if they can tell, before clicking, whether they
       arrived where they expected. */
    const named = M.quarantineBrief(
      agent({ target: { surfaceId: "s1", resolution: "unique-cwd", workspaceTitle: "cmux: alpha" } }),
      "unproven",
    );
    expect(named.nextStep).toContain("cmux: alpha");
    expect(named.nextStep).toMatch(/check that is the session you meant/i);
    // No pane name is no claim about one, rather than an empty "take you to ".
    expect(b.nextStep).not.toMatch(/take you to\s*[—.]/);
    expect(b.nextStep).toMatch(/once cmux names the session/i);                // the way back

    /* And no field may repeat another's job — that is what made it long. */
    expect(M.controlUnavailableText("unproven")).not.toMatch(/Focus/);
    expect(b.why).not.toMatch(/Focus/);

    /* Without a brief the banner throws: it renders whenever a write control is
       disabled, and this is a routable pane with Send off — a combination that
       could not previously exist, so quarantineBrief returned null and the
       caller read .title off it. */
    expect(b).not.toBeNull();
    expect(b.title).toMatch(/off/i);
    // Nothing to repair — saying so is what stops the retry.
    expect(b.nextStep).toMatch(/needs repairing/i);

    /* The row's accessible name must not tell a screen-reader operator the row
       is Ready when it accepts no input. */
    expect(M.CONTROL_STATE_TEXT.unproven).toBe("Look only — session not proven");
    expect(M.CONTROL_STATE_TEXT.unproven).not.toBe("Ready");

    // The gate is a gate, not a wall: an attested row keeps everything.
    const on = agent({
      target: { surfaceId: "s1", resolution: "exact" },
      controls: [{ action: "instruct", enabled: true }],
    });
    expect(M.quarantineBrief(on, "linked")).toBeNull();
  });

  /* Day one. Every measurement this project ever took was at 380-441 agents, so
     the board had never been seen with nothing on it — which is exactly the
     state a new operator meets on first run. It read "The ant hill is still — no
     tracked agents" beside a mound, with no evidence a collector had ever run.

     An empty cockpit is ambiguous between WATCHING AND FOUND NOTHING and NOT
     WATCHING. Those could not be more different, and passive prose picks
     neither. */
  test("an empty board asserts health and proves it, or admits it cannot see", () => {
    const at = "2026-08-02T11:45:51.447Z";
    const healthy = M.emptyBoardVerdict({
      generatedAt: at, totals: { sourceHealth: { healthy: 4, degraded: 0, absent: 0, total: 4 } },
    });
    expect(healthy.degraded).toBe(false);
    expect(healthy.message).toBe("Watching. No sessions running yet.");
    /* The proof is the point: a count of collectors and a timestamp are evidence
       a stalled client cannot manufacture, which is what distinguishes this from
       a board that simply never loaded. */
    /* The denominator is load-bearing, per QUICKSTART: the count is of
       collectors that can SEE, not tools installed, and an absent directory is
       a complete answer rather than a gap. "4 of 4" is the reassurance. */
    expect(healthy.sources).toBe("4 of 4 collectors healthy");
    expect(healthy.checkedAt).toBe(at);
    // No passive "still", which described absence and asserted nothing.
    expect(healthy.message).not.toContain("still");

    /* A blind collector makes an empty board an UNKNOWN one, not an empty one.
       Claiming health here would be the false all-clear again, on the day it
       matters most. */
    const blind = M.emptyBoardVerdict({
      generatedAt: at, totals: { sourceHealth: { healthy: 2, degraded: 2, absent: 0, total: 4 } },
    });
    expect(blind.degraded).toBe(true);
    expect(blind.sources).toBe("2 of 4 collectors degraded");

    /* The docs lane's finding: a fresh install with no Cursor showed "not every
       collector can see · 1 of 4 collectors degraded" as the FIRST screen a
       newcomer meets. A provider that has never been healthy has nothing to
       read yet; only one that WAS healthy and is not now has actually failed. */
    const fresh = M.emptyBoardVerdict({
      generatedAt: at,
      totals: { sourceHealth: { healthy: 3, degraded: 1, total: 4, byProvider: {
        claude: { healthy: true, lastHealthyAt: at },
        codex: { healthy: true, lastHealthyAt: at },
        omp: { healthy: true, lastHealthyAt: at },
        cursor: { healthy: false },
      } } },
    });
    expect(fresh.degraded).toBe(false);
    expect(fresh.message).toBe("Watching. No sessions running yet.");
    expect(fresh.sources).toBe("3 of 4 collectors healthy");
    expect(fresh.sources).not.toMatch(/degraded/);

    /* A source that worked and then stopped IS a fault, and must not be
       downgraded to calm by the same rule. */
    const failed = M.emptyBoardVerdict({
      generatedAt: at,
      totals: { sourceHealth: { healthy: 3, degraded: 1, total: 4, byProvider: {
        claude: { healthy: true, lastHealthyAt: at },
        codex: { healthy: true, lastHealthyAt: at },
        omp: { healthy: true, lastHealthyAt: at },
        cursor: { healthy: false, lastHealthyAt: at },
      } } },
    });
    expect(failed.degraded).toBe(true);
    expect(failed.sources).toBe("1 of 4 collectors degraded");

    /* The real fresh-machine payload, taken from the server's own buildSnapshot
       with codex, cursor and cmux absent and no sessions: healthy 1, degraded 0,
       absent 3, total 1. The backend's 42d842e makes `total` count collectors
       that EXIST, so the honest sentence is "1 of 1 collectors healthy" — calm
       and true — rather than "1 of 4", which reads as three failures to someone
       who simply has not installed those tools.

       This is the shape that matters and the one that cannot be seen on a
       machine where everything is installed, which is why it is pinned rather
       than left to a live read: on this developer's box absent is always 0. */
    const freshMachine = M.emptyBoardVerdict({
      generatedAt: at,
      totals: { tracked: 0, sourceHealth: { healthy: 1, degraded: 0, absent: 3, total: 1 } },
    });
    expect(freshMachine.degraded).toBe(false);
    expect(freshMachine.message).toBe("Watching. No sessions running yet.");
    /* The absences are now NAMED rather than merely excluded from the
       denominator. Excluding them alone left a machine with none of the four
       showing no line at all — silence at the one moment a newcomer needs a
       signal — so the count says what is watched and what simply is not there. */
    expect(freshMachine.sources).toBe("1 of 1 collectors healthy · 3 not installed");
    expect(freshMachine.sources).not.toMatch(/degraded|of 4/);

    /* No byProvider on the wire means the old counting stands, so a real
       degradation is never silently downgraded to calm by a missing field. */
    const noDetail = M.emptyBoardVerdict({
      generatedAt: at, totals: { sourceHealth: { healthy: 3, degraded: 1, absent: 0, total: 4 } },
    });
    expect(noDetail.degraded).toBe(true);
    expect(blind.message).not.toContain("Watching");
    expect(blind.hint).toContain("incomplete rather than empty");

    // No source data is no claim about sources — never an invented "0 of 0".
    const bare = M.emptyBoardVerdict({ generatedAt: at, totals: {} });
    expect(bare.sources).toBeNull();
    expect(bare.checkedAt).toBe(at);
    expect(M.emptyBoardVerdict(null).checkedAt).toBeNull();
  });

  /* Usage tab, day one: BurnBar is optional and a new operator will not have it.
     "not reported" for a window with no activity said the wrong thing about why. */
  test("an empty usage window says nothing happened, not that pricing failed", () => {
    const quiet = M.usageCostReading({
      costKnown: false, estimatedCostUsd: null, invocations: 0, byProvider: [],
    });
    expect(quiet.value).toBe("not reported");
    expect(quiet.sub).toBe("no activity in this range");

    // Activity that could not be priced is still a different sentence.
    const unpriceable = M.usageCostReading({
      costKnown: false, estimatedCostUsd: null, invocations: 45,
      byProvider: [{ provider: "Cursor", costUsd: null, tokens: 1, invocations: 45 }],
    });
    expect(unpriceable.sub).toBe("no priced rows in this range");
  });

  /* Usage audit §1. The cost headline read "not reported" while the same payload
     carried $11,939.92 of measured, provenance-tagged spend. burnbar.ts:33 sets
     costKnown false as soon as ANY invocation lacks a price, so Cursor at 45 of
     2,980 calls suppressed the figure for the other four providers. The string
     "cost missing on some rows" was literally true; the belief it created was
     false. costKnown may gate a qualifier, never the value. */
  test("a partly-priced window shows the floor and its gap in one glance", () => {
    /* The live wire, measured: estimatedCostUsd null while measuredCostUsd
       carries $11,934.61 and 42 of 2,973 calls cannot be priced. estimatedCostUsd
       is deliberately strict — null unless EVERY invocation is priced — so a
       card that reads it alone reports "not reported" over real money. The
       qualifier belongs beside the value, never as a gate on it, which is the
       shape processedTokens/tokensMissing has had on the wire all along. */
    const partial = M.usageCostReading({
      costKnown: false, estimatedCostUsd: null,
      measuredCostUsd: 11_934.61, costMissingInvocations: 42, invocations: 2973,
    });
    expect(partial.value).toBe("≥$11,934.61");
    expect(partial.sub).toBe("measured floor · 42 of 2973 calls unpriced");

    /* Grouped above four figures, on the integer part only. A first attempt
       used one non-global lookahead and rendered "$1,234567.89" — a separator
       that fires once and gives up is worse than none, because it looks like it
       worked. */
    expect(M.usageCostReading({ costKnown: true, estimatedCostUsd: 1_234_567.89 }).value)
      .toBe("$1,234,567.89");
    expect(M.usageCostReading({ costKnown: true, estimatedCostUsd: 999.5 }).value).toBe("$999.50");
    // The failure this replaces: real money rendered as an absence.
    expect(partial.value).not.toBe("not reported");

    /* The ≥ must travel WITH the number. A skimmed, clipped or read-aloud
       sublabel is exactly how a floor gets banked as a total, which is the
       misreading the server's own contract comment warns about. */
    expect(partial.value.startsWith("≥")).toBe(true);

    // A complete total is not a floor and carries no qualifier.
    expect(M.usageCostReading({ costKnown: true, estimatedCostUsd: 28.37 }))
      .toEqual({ value: "$28.37", sub: "from BurnBar cost" });

    // Fully priced via measuredCostUsd with nothing missing: no floor mark.
    const whole = M.usageCostReading({
      costKnown: false, estimatedCostUsd: null,
      measuredCostUsd: 12.5, costMissingInvocations: 0, invocations: 10,
    });
    expect(whole).toEqual({ value: "$12.50", sub: "measured" });

    /* No denominator means no share is claimed — the gap is still named in
       absolute terms, because that much is true. */
    const noTotal = M.usageCostReading({
      costKnown: false, estimatedCostUsd: null,
      measuredCostUsd: 5, costMissingInvocations: 1, invocations: null,
    });
    expect(noTotal.sub).toBe("measured floor · 1 call unpriced");

    /* "not reported" survives only where it is the whole truth: nothing priced
       at all. Never a fabricated $0.00. */
    const none = M.usageCostReading({
      costKnown: false, estimatedCostUsd: null, measuredCostUsd: null, invocations: 45,
    });
    expect(none.value).toBe("not reported");
    expect(none.sub).toBe("no priced rows in this range");
  });

  /* Usage audit §3. Same label, four answers: 45.1M/h at 1h, 5.7M/h at 24h,
     16.0M/h at 7d, 36.4M/h at 30d on one unchanged fleet. An 8x swing between
     adjacent selector positions reads as burn exploding. */
  test("the burn rate names the window it averaged", () => {
    expect(M.usageRateWindowText({ from: "2026-08-02T00:00:00Z", to: "2026-08-03T00:00:00Z" }))
      .toBe("24.0h average, not a current rate");
    expect(M.usageRateWindowText({ from: "2026-07-03T00:00:00Z", to: "2026-08-02T00:00:00Z" }))
      .toContain("30.0d average");
    // No window on the wire means no window claim, not an invented one.
    expect(M.usageRateWindowText({})).toBe("tokens per hour");
    expect(M.usageRateWindowText({ from: "x", to: "y" })).toBe("tokens per hour");
  });

  /* Usage audit §2. OpenBurnBar emits UTC text with no zone marker, Date.parse
     reads it as local, and every row aged by exactly the offset — a 24-minute-old
     row rendering "2.2h ago" makes the freshest data look stale. */
  test("zone-less BurnBar timestamps are read as UTC, and ISO is left alone", () => {
    expect(M.burnbarInstant("2026-08-02 11:15:48.670")).toBe("2026-08-02T11:15:48.670Z");
    expect(M.burnbarInstant("2026-08-02 11:15:48")).toBe("2026-08-02T11:15:48Z");

    /* Idempotent with the server-side fix the audit routes: anything already
       carrying a zone is untouched, so this cannot double-correct once the
       boundary emits proper ISO. */
    for (const iso of ["2026-08-02T11:15:48.670Z", "2026-08-02T11:15:48+02:00", "2026-08-02T11:15:48Z"]) {
      expect(M.burnbarInstant(iso)).toBe(iso);
    }

    // The bug it fixes, stated as arithmetic rather than as a string.
    const at = Date.parse("2026-08-02T11:39:32Z");
    const ageMs = at - Date.parse(M.burnbarInstant("2026-08-02 11:15:48.670"));
    expect(Math.round(ageMs / 60_000)).toBe(24);
  });

  /* Render-first audit §1, the composition itself. The three surfaces were each
     individually correct and each individually tested, which is exactly why this
     shipped: no test asked what they say TOGETHER. Reproduced on the board in
     one capture — rail "Needs you 1 finding", tab "Needs you 0", headline
     "Nothing needs you" — a false all-clear on the one question this cockpit
     exists to answer.

     This asserts the invariant that composition must hold, not the three strings
     separately: the all-clear may only be claimed over an empty collection, and
     the word "needs you" may only be spent on the agent population. */
  test("no all-clear may render while any finding is open", () => {
    const fault = {
      id: "system:collector-errors", kind: "system", severity: "warning",
      title: "Collection problems", summary: "1 collector problem", affectedAgentIds: [],
    };
    // The exact board state that composed the false all-clear: a system finding,
    // and not one agent waiting on a human.
    const calm = agent({ id: "a", outcome: "healthy", activity: "working" });
    const snap = snapshot({ programs: [{ id: "p", name: "P", agents: [calm] }], issues: [fault] });

    const findings = M.issuesOf(snap);
    const waiting = [calm].filter((a) => M.alerting(a));
    expect(findings.length).toBe(1);
    expect(waiting.length).toBe(0);

    /* The rail used to count findings under the label "Findings", chosen so it
       would not spend the tab's phrase on a different population. S2-T1 settles
       that argument by removing the count: the header carries no card for this
       at all, and the finding is an item in the notification center with its own
       evidence and route. */
    expect(M.WIDGET_CATALOG.find((w: { id: string }) => w.id === "needs-you")).toBeUndefined();
    const items = M.notificationFeed(snap, [], Date.now(), M.NOTIFY_DEPS);
    expect(items.map((i: { id: string }) => i.id)).toEqual(["system:collector-errors"]);
    expect(items[0].kind).toBe("dataflow");

    /* And the all-clear is gated on the COLLECTION, not on the row list. With a
       finding open it must not render, however empty the Alerts view is. */
    expect(findings.length === 0 && waiting.length === 0).toBe(false);

    // With nothing open at all, the all-clear is true and may render.
    const quiet = snapshot({ programs: [{ id: "p", name: "P", agents: [calm] }], issues: [] });
    expect(M.issuesOf(quiet).length).toBe(0);
  });

  /* Magnitude audit §5. The activity sparkline's accessible name claimed "last
     hour" while the tracker held 12.7 minutes of buckets — a 4.7x window
     overstatement, invisible to sighted readers, which is why it survived every
     visual review. The window is a function of bucket count and must be read
     from it. */
  test("sparkline names the window it actually holds, not an assumed hour", () => {
    // 12 five-minute buckets is the hour the label used to assert unconditionally.
    expect(M.sparklineLabel(new Array(12).fill(0))).toContain("last 60m");
    // The state that was lying: a freshly restarted tracker with two buckets.
    expect(M.sparklineLabel([1, 2])).toContain("last 10m");
    expect(M.sparklineLabel([1, 2])).not.toContain("hour");
    // No buckets is no window — not a zero-length hour.
    expect(M.sparklineLabel([])).toContain("no window observed yet");
  });

  /* Magnitude audit §6. "230 agents" was 33 live and 197 ended: 5.8x the
     operational population under one word, the needsYou defect in a different
     cell. Both cohorts are named — but only when they account for the whole
     roster, or the fix would silently drop "unknown" the way the bug dropped
     "ended". */
  test("program rollup names live and ended separately, and only when they add up", () => {
    const labels = (cells: Array<{ value: string; label: string }>) =>
      cells.map((c) => c.value + " " + c.label);

    const mixed = [
      agent({ id: "a", activity: "working" }),
      agent({ id: "b", activity: "idle" }),
      agent({ id: "c", activity: "ended" }),
      agent({ id: "d", activity: "ended" }),
    ];
    expect(labels(M.programRollupCells(mixed))).toEqual(
      expect.arrayContaining(["2 live", "2 ended"]),
    );
    expect(labels(M.programRollupCells(mixed)).join(" ")).not.toContain("4 agents");

    // Nothing ended yet: one population, so one word is honest.
    const allLive = [agent({ id: "a", activity: "working" }), agent({ id: "b", activity: "idle" })];
    expect(labels(M.programRollupCells(allLive))).toContain("2 agents");

    /* An unaccounted-for cohort means the split cannot be trusted to sum, so the
       total is the only true claim. This is the guard, not an edge case: naming
       two of three populations is the original bug. */
    const withUnknown = [...mixed, agent({ id: "e", activity: "unknown", lastActivityAt: null })];
    const unknownCells = labels(M.programRollupCells(withUnknown));
    expect(unknownCells).toContain("5 agents");
    expect(unknownCells.join(" ")).not.toContain("live");
  });

  /* Magnitude audit §3. Two figures that could not both be true — 5,089,747
     tok/min beside $4.41, an implied 1.5c per million against a real floor about
     35x higher. The backend fixed the maths. What was left on this side was the
     rate being shown as a bare "/min" while the payload carried windowMs=300000,
     so a five-minute average read as an instantaneous rate, and a coverage suffix
     counting eligible LIVE agents against a rate summed over every reporter
     including ended ones. A rate whose window is unstated is a rate the operator
     will divide against an hourly cost, which is exactly how this was found. */
  test("BURN states the averaging window and does not attach live-only coverage to it", () => {
    const snap = snapshot({
      pulse: {
        burn: {
          tokensPerMin: 10_546,
          windowMs: 300_000,
          costLastHourUsd: null,
          coverage: { reporting: 8, eligible: 33, unknown: 3 },
        },
      },
    });
    const data = M.summaryWidgetData("burn", snap, "live", "percent", [], false);

    expect(data.sublabel).toContain("5m average");
    /* The ratio described a different population than the rate: verified in
       src/server/pulse.ts, where the delta loop walks every agent while
       coverage.reporting/eligible count live ones only. */
    expect(data.sublabel).not.toContain("8/33");
    expect(data.sublabel).not.toMatch(/\d+\/\d+ reporting/);

    /* But an absence is safe to name where completeness was not. `unknown`
       counts live agents whose provider reports no tokens at all, so they
       contribute zero to the rate forever — a subtotal shown as a total. */
    expect(data.sublabel).toContain("3 not reporting tokens");

    const fullCoverage = M.summaryWidgetData("burn", snapshot({
      pulse: { burn: { tokensPerMin: 10_546, windowMs: 300_000, costLastHourUsd: null,
        coverage: { reporting: 33, eligible: 33, unknown: 0 } } },
    }), "live", "percent", [], false);
    expect(fullCoverage.sublabel).not.toContain("not reporting");

    // No window on the wire means no window claim — never a fabricated default.
    const noWindow = M.summaryWidgetData(
      "burn", snapshot({ pulse: { burn: { tokensPerMin: 10_546, costLastHourUsd: null } } }),
      "live", "percent", [], false,
    );
    expect(noWindow.sublabel).not.toContain("average");
    expect(noWindow.value).toBe(M.fmtTok(10_546));
  });

  /* F2: the BURN card read "cost unavailable" because the cost source returns
     null, and that is the correct render of an unknown — but nothing pinned it
     down. The failure worth guarding is not the missing number, it is a missing
     number quietly becoming $0.00: a fleet that looks free is worse than one
     that admits it does not know. */
  test("BURN shows a dollar figure when cost is reported and never invents $0.00", () => {
    const burnSnap = (burn: Record<string, unknown>) => snapshot({
      pulse: { burn: { tokensPerMin: 840, windowMs: 600_000, coverage: { reporting: 7, eligible: 7 }, ...burn } },
    });

    const priced = M.summaryWidgetData("burn", burnSnap({ costLastHourUsd: 12.5 }), "live", "percent", [], false);
    expect(priced.sublabel).toContain("$12.50 last hour");
    expect(priced.value).toBe("840");

    // Unknown cost states its ignorance and never renders as free.
    const unknown = M.summaryWidgetData("burn", burnSnap({ costLastHourUsd: null }), "live", "percent", [], false);
    expect(unknown.sublabel).toContain("cost unavailable");
    expect(unknown.sublabel).not.toContain("$");

    // A real zero is a real number and must survive as one.
    const free = M.summaryWidgetData("burn", burnSnap({ costLastHourUsd: 0 }), "live", "percent", [], false);
    expect(free.sublabel).toContain("$0.00 last hour");
    expect(free.sublabel).not.toContain("unavailable");

    // Token throughput is independent of cost: no price must not blank the rate.
    expect(unknown.value).toBe("840");
    expect(unknown.tone).toBe("neutral"); // neutral ink: a spend rate has no healthy band
  });

  /* Claude transcripts report observed totals with no context-window size, so a
     truthful percentage is impossible for them. Showing the absolute count is
     the honest answer; a fabricated denominator would misreport a 1M-context
     session by roughly 5x. 45 of 139 agents on the live board are in this state. */
  test("CTX falls back to an absolute count rather than inventing a denominator", () => {
    const noWindow = { provenance: "observed", scope: "latest-turn", total: 47_432 };
    expect(M.contextDisplayValue(noWindow, "percent")).toBe("47k tokens");
    expect(M.contextDisplayValue(noWindow, "percent")).not.toContain("%");
    expect(M.contextUsage(noWindow)).toBeNull();

    // And the moment the backend does report a window, the percentage appears
    // with no client change — this is the contract between the two lanes.
    expect(M.contextDisplayValue({ ...noWindow, contextWindow: 258_400 }, "percent")).toBe("18%");
  });

  test("the header states no count of problems: Findings is not in the catalog", () => {
    /* S2-T1. The header is confidence — continuous measured quantities, each
       with its own provenance — and a count of to-dos is not one of those. The
       Findings card is retired to the notification center, where each of those
       findings is an item with evidence, impact and a route. */
    expect(M.DEFAULT_WIDGET_IDS).toEqual(["momentum", "burn", "tokens", "context-peak", "health"]);
    expect(M.WIDGET_CATALOG.map((widget: { id: string }) => widget.id)).toEqual([
      "momentum", "burn", "tokens", "context-peak", "health",
      // Health Rail v2: opt-in cards — offered by the customizer, not in defaults.
      "mix", "spend",
    ]);
    expect(M.WIDGET_CATALOG.some((w: { id: string }) => w.id === "needs-you")).toBe(false);
    // Nothing is `required` any more; the pin existed only for Findings.
    expect(M.WIDGET_CATALOG.filter((w: { required?: boolean }) => w.required)).toEqual([]);
    expect(M.WIDGET_STORAGE_KEY).toBe("mtn3-summary-widgets");
  });

  test("a saved layout naming the retired card is migrated, not thrown away", () => {
    /* The LEGACY_VIEW_ALIASES treatment: a stored preference from an older build
       is a choice, not corruption. Resetting the whole order because ONE entry
       retired would discard an arrangement the operator deliberately made. */
    expect(M.parseWidgetPreference(JSON.stringify(["needs-you", "burn", "health"])))
      .toEqual(["burn", "health"]);
    expect(M.normalizeWidgetIds(["needs-you", "context-peak", "momentum"]))
      .toEqual(["context-peak", "momentum"]);
    // A layout that was ONLY the retired card has nothing left to honour.
    expect(M.normalizeWidgetIds(["needs-you"])).toEqual(M.DEFAULT_WIDGET_IDS);

    // Genuine corruption still resets: unknown ids, duplicates, non-strings, junk.
    expect(M.normalizeWidgetIds(["system", "attention", "context-peak"])).toEqual(M.DEFAULT_WIDGET_IDS);
    expect(M.normalizeWidgetIds(["burn", "burn"])).toEqual(M.DEFAULT_WIDGET_IDS);
    expect(M.normalizeWidgetIds([7, "burn"])).toEqual(M.DEFAULT_WIDGET_IDS);
    expect(M.parseWidgetPreference("not-json")).toEqual(M.DEFAULT_WIDGET_IDS);
  });

  test("every widget is movable now that nothing is pinned first", () => {
    /* The reorder guards used to refuse index 0 because Findings was required
       there. With the pin gone they would have silently frozen whichever widget
       happened to land first — a rule left behind by the thing it protected. */
    const defaults = M.DEFAULT_WIDGET_IDS;
    expect(M.reorderWidgetIds(defaults, "burn", -1)).toEqual([
      "burn", "momentum", "tokens", "context-peak", "health",
    ]);
    expect(M.reorderWidgetIds(defaults, "momentum", 1)).toEqual([
      "burn", "momentum", "tokens", "context-peak", "health",
    ]);
    // The ends still hold: nothing walks off either edge of the list.
    expect(M.reorderWidgetIds(defaults, "momentum", -1)).toEqual(defaults);
    expect(M.reorderWidgetIds(defaults, "health", 1)).toEqual(defaults);
  });

  test("the retired card's data branch is gone, and asking for it yields nothing", () => {
    const snap = snapshot({
      issues: [
        { id: "system:1", kind: "system", severity: "error", title: "Control failure", summary: "s", affectedAgentIds: [] },
        { id: "system:2", kind: "system", severity: "warning", title: "Stale source", summary: "s", affectedAgentIds: [] },
      ],
    });
    /* attentionSummary survives — the notification center and the calm predicate
       both still need to know whether anything is open. What is gone is the
       header CARD that turned it into a metric. */
    expect(M.attentionSummary(snap)).toEqual({ count: 2, interventions: 1, advisories: 1 });
    const data = M.summaryWidgetData("needs-you", snap);
    expect(data.value).not.toBe("2");
    expect(data.findings).toBeUndefined();
    // And both findings are reachable where they belong.
    const items = M.notificationFeed(snap, [], Date.now(), M.NOTIFY_DEPS);
    expect(items.map((i: { id: string }) => i.id).sort()).toEqual(["system:1", "system:2"]);
  });

  test("uses explicit No data values when optional pulse/context evidence is absent", () => {
    const snap = snapshot();
    for (const id of ["context-peak", "burn"]) {
      expect(M.summaryWidgetData(id, snap).value, id).toBe("No data");
      expect(M.summaryWidgetData(id, snap).sublabel, id).toBeTruthy();
    }
    expect(M.summaryWidgetData("momentum", null).value).toBe("No data");
    expect(M.summaryWidgetData("health", null, "offline").value).toBe("Readings unavailable");
  });

  test("momentum copy stays window-honest and never fabricates a zero-window readout", () => {
    const withMomentum = (momentum: Record<string, unknown>) => snapshot({ pulse: { momentum } });
    /* The shipping count opens the sub now that attention holds the headline;
       every window-honest sentence keeps its exact wording after it. */
    expect(M.summaryWidgetData("momentum", snapshot()).sublabel).toContain("shipping · No completion data yet.");
    // Under one completed 5-min bucket there is no completion window to report,
    // but stall detection (updatedAt-based) is valid immediately.
    expect(M.summaryWidgetData("momentum", withMomentum({ completionsLastHour: 0, observedWindowMs: 0, stalled: 0 })).sublabel)
      .toContain("shipping · No completion data yet.");
    expect(M.summaryWidgetData("momentum", withMomentum({ completionsLastHour: 0, observedWindowMs: 0, stalled: 2 })).sublabel)
      .toContain("shipping · 2 quiet 15m+");
    // A young tracker reports its real window, never a fabricated "this hour".
    expect(M.summaryWidgetData("momentum", withMomentum({ completionsLastHour: 3, observedWindowMs: 20 * 60_000, stalled: 1 })).sublabel)
      .toContain("shipping · ↑3 done in 20m observed · 1 quiet 15m+");
    expect(M.summaryWidgetData("momentum", withMomentum({ completionsLastHour: 3, observedWindowMs: 3_600_000, stalled: 0 })).sublabel)
      .toContain("shipping · ↑3 done this hour");
    // The headline is the attention count, ember when nonzero.
    const calm = M.summaryWidgetData("momentum", snapshot());
    expect(calm.unit).toContain("need you");
    expect(calm.tone).toBe("ok");
  });
});

describe("state derivations fall back from provider-native status", () => {
  test("legacy statuses map to the provider-neutral language", () => {
    expect(M.deriveActivity(agent({ status: "running" }))).toBe("working");
    expect(M.deriveActivity(agent({ status: "waiting" }))).toBe("idle");
    expect(M.deriveActivity(agent({ status: "attention" }))).toBe("idle");
    expect(M.deriveActivity(agent({ status: "stale" }))).toBe("ended");
    expect(M.deriveActivity(agent({ status: "archived" }))).toBe("ended");
  });

  test("a completed Cursor turn (waiting) is Idle/Healthy, not a warning", () => {
    const cursorDone = agent({ provider: "cursor", status: "waiting" });
    expect(M.deriveActivity(cursorDone)).toBe("idle");
    expect(M.deriveOutcome(cursorDone)).toBe("healthy");
  });

  test("attention maps to needs-you; ended sessions stop being outcome problems", () => {
    expect(M.deriveOutcome(agent({ status: "attention" }))).toBe("needs-you");
    expect(M.deriveOutcome(agent({ status: "archived" }))).toBe("healthy");
  });

  test("backend-provided fields always win over the fallback", () => {
    const a = agent({ status: "waiting", activity: "working", outcome: "blocked", controlState: "quarantined" });
    expect(M.deriveActivity(a)).toBe("working");
    expect(M.deriveOutcome(a)).toBe("blocked");
    expect(M.deriveControlState(a)).toBe("quarantined");
  });

  test("control state derives from routing evidence when absent", () => {
    expect(M.deriveControlState(agent())).toBe("linked");
    expect(M.deriveControlState(agent({ target: { resolution: "ambiguous" } }))).toBe("quarantined");
    expect(M.deriveControlState(agent({ target: { resolution: "missing" } }))).toBe("observed-only");
    expect(M.deriveControlState(agent({ status: "archived" }))).toBe("observed-only");
  });
});

describe("provider-aware row summaries", () => {
  test("uses the sanitized snapshot field and never falls back to technical transcript text", () => {
    const value = agent({
      lastHumanMessage: "Readable review result.",
      transcriptTail: "diff --git a/src/server/identity.ts b/src/server/identity.ts",
      statusReason: "Tool result: /Users/me/the-mountain/src/server/identity.ts",
    });

    expect(M.rowSummary(value)).toBe("Readable review result.");
    expect(M.rowSummary(value)).not.toContain("diff --git");
    expect(M.rowSummary(value)).not.toContain("identity.ts");
  });

  test("renders explicit absence instead of inventing a message from the transcript", () => {
    expect(M.formatLastHumanMessage(agent({ lastHumanMessage: null, transcriptTail: "tool output" })))
      .toBe("No readable message yet");
    expect(M.formatLastHumanMessage(agent())).toBe("No readable message yet");
  });

  /* FE-B: this used to extract the three panels by matching source text between
     landmark function names, which pinned file ordering rather than behavior.
     It now renders the panels and reads what they actually show. */
  test("keeps raw transcript machinery out of the summary surfaces", () => {
    const TAIL = "RAW-TOOL-DUMP-9f2c";
    const rich = agent({
      lastHumanMessage: "ship the fix",
      lastAgentMessage: "pushed the branch",
      transcriptTail: TAIL,
    });
    const panels = panelTexts(rich);
    // Chat shows readable You/Agent turns only. Raw provider output is neither
    // promoted into that summary nor duplicated into Evidence; the bounded
    // transcript loader is the opt-in route to the source record.
    expect(panels.chat).toContain("pushed the branch");
    expect(panels.chat).not.toContain(TAIL);
    expect(panels.evidence).not.toContain(TAIL);
    expect(withDom(() => M.renderTranscriptFeedLead(rich))).toBeNull();
  });
});

describe("views split Now from History", () => {
  test("Now is active work only; Idle and History remain explicit views", () => {
    const live = agent({ status: "running" });
    const idle = agent({ status: "waiting" });
    const done = agent({ status: "archived" });
    expect(M.viewMatches("now", live)).toBe(true);
    expect(M.viewMatches("now", idle)).toBe(false);
    expect(M.viewMatches("now", agent({ status: "waiting", outcome: "needs-you" }))).toBe(true);
    expect(M.viewMatches("now", done)).toBe(false);
    expect(M.viewMatches("history", live)).toBe(false);
    expect(M.viewMatches("history", done)).toBe(true);
  });

  /* Regression: an alert outranks the activity clock. A live snapshot carried
     two agents reading activity "ended" (transcript stopped) whose process was
     still `running` and whose status was "attention" — waiting on a human. The
     old `act !== "ended"` gate hid them from Now AND from Alerts, so a session
     needing a human appeared in no default view. Now must key off the alert. */
  test("Now keeps an alerted agent even when its activity reads ended", () => {
    const strandedButAlerting = agent({
      status: "attention",
      activity: "ended",
      outcome: "needs-you",
      processState: "running",
    });
    expect(M.viewMatches("now", strandedButAlerting)).toBe(true);

    // The guard that makes this safe: an ended agent with nothing wrong stays
    // in History, so Now cannot silt up with the 100+ finished sessions.
    const endedAndFine = agent({ status: "archived", activity: "ended", outcome: "healthy" });
    expect(M.viewMatches("now", endedAndFine)).toBe(false);
    expect(M.viewMatches("history", endedAndFine)).toBe(true);
  });

  /* alerting() is the one verdict behind Now, Alerts, the program expander and
     the notifier. It has to answer two opposite failures at once: a session that
     stopped transcribing while its process runs on IS waiting on a human, and a
     long-archived session's last verdict is NOT. Liveness evidence is what tells
     them apart — which is why this is gated on processState rather than on the
     outcome alone. */
  test("alerting() frees a live-but-silent session without resurrecting archived ones", () => {
    // The live-snapshot case: transcript stopped, process still running.
    expect(M.alerting(agent({
      status: "attention", activity: "ended", outcome: "needs-you", processState: "running",
    }))).toBe(true);

    // The guard. Same outcome, no evidence the process survives — this is a
    // stale verdict on a finished session and must stay in History.
    expect(M.alerting(agent({ status: "archived", activity: "ended", outcome: "needs-you" }))).toBe(false);
    expect(M.alerting(agent({
      status: "archived", activity: "ended", outcome: "failed", processState: "unknown",
    }))).toBe(false);
    expect(M.alerting(agent({
      status: "archived", activity: "ended", outcome: "failed", processState: "died",
    }))).toBe(false);

    // Live sessions never needed liveness evidence to alert.
    expect(M.alerting(agent({ status: "attention", outcome: "needs-you" }))).toBe(true);
    expect(M.alerting(agent({ status: "running", outcome: "healthy" }))).toBe(false);

    // And the views inherit it rather than restating it — the disagreement
    // between Now and Alerts is what let these agents hide in the first place.
    const revived = agent({ status: "attention", activity: "ended", outcome: "needs-you", processState: "running" });
    expect(M.viewMatches("now", revived)).toBe(true);
    expect(M.viewMatches("needs-you", revived)).toBe(true);
  });

  test("Needs you contains only live unhealthy sessions", () => {
    expect(M.viewMatches("needs-you", agent({ status: "attention" }))).toBe(true);
    expect(M.viewMatches("needs-you", agent({ status: "running" }))).toBe(false);
    expect(M.viewMatches("needs-you", agent({ status: "archived", outcome: "failed" }))).toBe(false);
    expect(M.viewMatches("working", agent({ status: "running" }))).toBe(true);
    expect(M.viewMatches("idle", agent({ status: "waiting" }))).toBe(true);
  });

  test("lookback filters by updatedAt age and defaults to 6h", () => {
    expect(M.DEFAULT_LOOKBACK_HOURS).toBe(6);
    expect(M.parseLookbackHours("all")).toBeNull();
    expect(M.parseLookbackHours("12")).toBe(12);
    const now = Date.parse("2026-07-22T12:00:00.000Z");
    const fresh = agent({ updatedAt: "2026-07-22T10:00:00.000Z" });
    const stale = agent({ updatedAt: "2026-07-21T12:00:00.000Z" });
    expect(M.withinLookback(fresh, 6, now)).toBe(true);
    expect(M.withinLookback(stale, 6, now)).toBe(false);
    expect(M.withinLookback(stale, null, now)).toBe(true);
    expect(M.lookbackApplies("history")).toBe(true);
    expect(M.lookbackApplies("now")).toBe(false);
  });

  test("review-worker classification is task-based and provider-neutral", async () => {
    const reviewTask = "Review this change for security vulnerabilities.";
    for (const provider of ["claude", "codex", "cursor"]) {
      expect(M.isReviewWorker(agent({ provider, task: reviewTask })), provider).toBe(true);
    }
    expect(M.isReviewWorker(agent({
      provider: "codex",
      task: "Implement the lifecycle change and add regression coverage.",
      displayName: "Lifecycle worker",
    }))).toBe(false);

    const review = agent({ task: reviewTask, updatedAt: new Date().toISOString() });
    expect(M.passesReviewVisibility(review, "board", false)).toBe(false);
    expect(M.passesReviewVisibility(review, "board", true)).toBe(true);
    expect(M.passesReviewVisibility(review, "history", false)).toBe(true);

    const program = { id: "p", name: "P", agents: [review] };
    await withState({
      view: "board", query: "", facetProgram: "", facetProviders: [],
      lookbackHours: 6, showReviewWorkers: false,
    }, () => {
      expect(M.currentFilter()(review, program)).toBe(false);
    });
    await withState({
      view: "board", query: "", facetProgram: "", facetProviders: [],
      lookbackHours: 6, showReviewWorkers: true,
    }, () => {
      expect(M.currentFilter()(review, program)).toBe(true);
    });
    await withState({
      view: "board", query: "security", facetProgram: "", facetProviders: [],
      lookbackHours: 6, showReviewWorkers: false,
    }, () => {
      expect(M.currentFilter()(review, program)).toBe(true);
    });
    const alertingReview = agent({
      task: reviewTask, status: "attention", outcome: "needs-you", updatedAt: new Date().toISOString(),
    });
    await withState({
      view: "board", query: "", facetProgram: "", facetProviders: [],
      lookbackHours: 6, showReviewWorkers: false,
    }, () => {
      expect(M.currentFilter()(alertingReview, program)).toBe(true);
    });
  });

  test("the server's sessionKind outranks the client regex in both directions", async () => {
    const updatedAt = new Date().toISOString();

    /* The false-positive class, killed. This task matches the prose patterns —
       asserted, so the test cannot pass by the regex quietly stopping to match —
       and is still `work`, because the server watched it launch from a terminal.
       A session ABOUT reviewers is not a reviewer. */
    const chatty = agent({
      id: "claude:planner", provider: "claude", updatedAt,
      sessionKind: "work", sessionKindSource: "launch-evidence",
      task: "Investigate the repeated Security vulnerability review rows.",
    });
    expect(M.isReviewWorker(chatty)).toBe(true);
    expect(M.sessionKindOf(chatty)).toBe("work");
    expect(M.passesReviewVisibility(chatty, "board", false)).toBe(true);

    // And the other direction: launch evidence needs no prose to convict.
    const quietName = agent({
      id: "claude:sdk-r", provider: "claude", updatedAt,
      sessionKind: "review", sessionKindSource: "launch-evidence",
      task: "Look over the diff.",
    });
    expect(M.isReviewWorker(quietName)).toBe(false);
    expect(M.sessionKindOf(quietName)).toBe("review");
    expect(M.passesReviewVisibility(quietName, "board", false)).toBe(false);

    /* Two transition cases. A row with no verdict at all, and a row the server
       classified `unknown` — "I have no evidence" is not "this is not a
       review", so both fall through to the regex until Task 4.2 retires it. */
    const legacy = agent({
      id: "claude:legacy", provider: "claude", updatedAt,
      task: "Review this change for security vulnerabilities.",
    });
    expect(M.sessionKindOf(legacy)).toBe("review");
    const noEvidence = agent({
      id: "claude:unknown", provider: "claude", updatedAt,
      sessionKind: "unknown", sessionKindSource: "none",
      task: "Review this change for security vulnerabilities.",
    });
    expect(M.sessionKindOf(noEvidence)).toBe("review");

    // Only `review` is gated. Other kinds are classified, not hidden.
    const automation = agent({
      id: "claude:sdk-a", provider: "claude", updatedAt,
      sessionKind: "automation", sessionKindSource: "launch-evidence",
      task: "Summarize the changelog.",
    });
    expect(M.passesReviewVisibility(automation, "board", false)).toBe(true);

    // The chip's count moves with the verdict, not with the prose.
    const snap = snapshot({ programs: [{ id: "p", name: "P", agents: [chatty, quietName, automation] }] });
    await withState({ snap, view: "board", lookbackHours: 6, showReviewWorkers: false }, () => {
      expect(M.reviewWorkerCount(M.state)).toBe(1);
    });
  });

  /* The shelf carries its own copy of the review gate, and an uncovered twin of
     a filter clause is how the two drift apart. This pins the twin to the same
     three escapes the board's copy has. */
  test("the shelf hides routine review workers under the same gate as the board", async () => {
    const review = agent({
      id: "claude:done-review", provider: "claude", status: "archived",
      task: "Review this change for security vulnerabilities.",
      updatedAt: new Date().toISOString(),
    });
    const work = agent({
      id: "codex:done-work", status: "archived",
      task: "Implement the lifecycle change.", updatedAt: new Date().toISOString(),
    });
    const program = { id: "p", name: "P", agents: [review, work] };
    await withState({
      view: "board", query: "", facetProgram: "", facetProviders: [],
      lookbackHours: 6, showReviewWorkers: false,
    }, () => {
      expect(M.shelfFilter()(review, program)).toBe(false);
      expect(M.shelfFilter()(work, program)).toBe(true);
    });
    await withState({
      view: "board", query: "", facetProgram: "", facetProviders: [],
      lookbackHours: 6, showReviewWorkers: true,
    }, () => {
      expect(M.shelfFilter()(review, program)).toBe(true);
    });
    // A search is an explicit request: it admits the hidden review to the shelf too.
    await withState({
      view: "board", query: "security", facetProgram: "", facetProviders: [],
      lookbackHours: 6, showReviewWorkers: false,
    }, () => {
      expect(M.shelfFilter()(review, program)).toBe(true);
    });
  });

  test("tab counts are population counts: a search never changes them", async () => {
    const updatedAt = new Date().toISOString();
    const review = agent({
      id: "claude:r1", provider: "claude", updatedAt,
      task: "Review this change for security vulnerabilities.",
    });
    const work = agent({ id: "codex:w1", updatedAt, task: "Implement the lifecycle change." });
    const snap = snapshot({ programs: [{ id: "p", name: "P", agents: [review, work] }] });
    /* The row renders under the search escape while the count stays the no-query
       population — counts ignore query BY DESIGN (a search changes what renders,
       never what the tab claims exists); this pins that reading so the next
       reader does not "fix" it into a bug. */
    await withState({
      snap, view: "board", query: "security", facetProgram: "", facetProviders: [],
      lookbackHours: 6, showReviewWorkers: false,
    }, () => withDom(() => {
      M.renderTabs();
      expect(domById.get("count-board")!.textContent).toBe("1");
      expect(M.currentFilter()(review, snap.programs[0])).toBe(true);
    }));
  });

  test("a provider facet narrows the board and clears by clicking itself", async () => {
    const updatedAt = new Date().toISOString();
    const claude = agent({ id: "claude:1", provider: "claude", updatedAt, task: "A" });
    const codex = agent({ id: "codex:1", provider: "codex", updatedAt, task: "B" });
    const program = { id: "p", name: "P", agents: [claude, codex] };
    const snap = snapshot({ programs: [program] });

    await withState({
      snap, view: "board", query: "", facetProgram: "", facetProviders: ["codex"],
      lookbackHours: 6, showReviewWorkers: true,
    }, () => {
      expect(M.currentFilter()(codex, program)).toBe(true);
      expect(M.currentFilter()(claude, program)).toBe(false);
      // The shelf wears the same facet — a filtered board must not grow a shelf
      // of rows that do not match it.
      const done = agent({ id: "claude:2", provider: "claude", status: "archived", updatedAt, task: "C" });
      expect(M.shelfFilter()(done, program)).toBe(false);
    });

    /* Toggle-to-clear: the way out is the way in. Driven through the real click
       (withRequests, because setFacetProvider repaints and render() needs a
       document.body) rather than by calling the setter — a control that stops
       being wired would still pass the setter-only version.

       The item now lives inside the provider MENU, so the menu is opened first —
       and it deliberately STAYS open across the toggle: the axis holds a set,
       and a menu that slammed shut after each pick would make assembling two
       values cost two trips through the trigger. */
    await withState({
      snap, view: "board", query: "", facetProgram: "", facetProviders: ["codex"],
      lookbackHours: 6, showReviewWorkers: true, openFilterMenu: "provider",
    }, () => withRequests([], async () => {
      M.renderFilterBar(M.state);
      const item = byFkey(domById.get("filter-bar"), "provider:codex");
      expect(item.attributes.role).toBe("menuitemcheckbox");
      expect(item.attributes["aria-checked"]).toBe("true");
      await fire(item);
      expect(M.state.facetProviders).toEqual([]);
      expect(M.state.openFilterMenu).toBe("provider");
    }));

    /* And the whole point of the set: two providers UNION rather than replace.
       The scalar this migrated from answered "show me claude and codex" with
       "codex", silently, and there was no way to tell it had. */
    await withState({
      snap, view: "board", query: "", facetProgram: "", facetProviders: ["codex"],
      lookbackHours: 6, showReviewWorkers: true, openFilterMenu: "provider",
    }, () => withRequests([], async () => {
      M.renderFilterBar(M.state);
      await fire(byFkey(domById.get("filter-bar"), "provider:claude"));
      expect(M.state.facetProviders).toEqual(["codex", "claude"]);
      expect(M.currentFilter()(codex, program)).toBe(true);
      expect(M.currentFilter()(claude, program)).toBe(true);
    }));

    // "All providers" clears the axis whatever is in it, and is checked exactly
    // when nothing is — the empty set and "everything ticked" are one board.
    await withState({
      snap, view: "board", query: "", facetProgram: "", facetProviders: ["codex", "claude"],
      lookbackHours: 6, showReviewWorkers: true, openFilterMenu: "provider",
    }, () => withRequests([], async () => {
      M.renderFilterBar(M.state);
      expect(byFkey(domById.get("filter-bar"), "provider:all").attributes["aria-checked"]).toBe("false");
      await fire(byFkey(domById.get("filter-bar"), "provider:all"));
      expect(M.state.facetProviders).toEqual([]);
    }));
  });

  test("the status lens narrows to one lifecycle and suppresses the finished shelf", async () => {
    const updatedAt = new Date().toISOString();
    const working = agent({ id: "codex:w", status: "running", updatedAt, task: "A" });
    const waiting = agent({ id: "codex:i", status: "waiting", updatedAt, task: "B" });
    const unverified = agent({ id: "codex:u", status: "unknown", activity: "unknown", updatedAt, task: "C" });
    const finished = agent({ id: "codex:f", status: "archived", updatedAt, task: "D" });
    const program = { id: "p", name: "P", agents: [working, waiting, unverified, finished] };

    const lens = async (facetStatuses: string[], expected: string[]) => {
      await withState({
        view: "board", query: "", facetProgram: "", facetProviders: [], facetStatuses,
        lookbackHours: 6, showReviewWorkers: true,
      }, () => {
        const shown = program.agents.filter((a) => M.currentFilter()(a, program)).map((a) => a.id);
        expect(shown, facetStatuses.join("+") || "(no lens)").toEqual(expected);
      });
    };
    await lens(["working"], ["codex:w"]);
    await lens(["waiting"], ["codex:i"]);
    await lens(["unverified"], ["codex:u"]);
    // No lens: the board's own view test decides, and the finished row is out.
    await lens([], ["codex:w", "codex:i", "codex:u"]);

    /* Amendment 1, and the reason the scalar had to go. Within one axis the
       members UNION, so "working AND waiting" is askable — it is the actual
       question an operator has ("what is not making progress"), and the scalar
       answered it by silently discarding the first pick. The union is strictly
       LARGER than either singleton, which is the property that fails if this
       ever regresses to a replace. */
    await lens(["working", "waiting"], ["codex:w", "codex:i"]);
    await lens(["working", "waiting", "unverified"], ["codex:w", "codex:i", "codex:u"]);
    // Order of ticking does not change the board: a set, not a sequence.
    await lens(["waiting", "working"], ["codex:w", "codex:i"]);

    /* A lifecycle lens and a shelf of finished rows are contradictory claims.
       The shelf goes away whole rather than being emptied row by row, which is
       what makes "Waiting" mean waiting and not "waiting, plus everything that
       already ended". */
    await withState({
      view: "board", query: "", facetProgram: "", facetProviders: [], facetStatuses: ["waiting"],
      lookbackHours: 6, showReviewWorkers: true,
    }, () => {
      expect(M.shelfFilter()(finished, program)).toBe(false);
    });
    await withState({
      view: "board", query: "", facetProgram: "", facetProviders: [], facetStatuses: [],
      lookbackHours: 6, showReviewWorkers: true,
    }, () => {
      expect(M.shelfFilter()(finished, program)).toBe(true);
    });
    /* Suppression keys on NON-EMPTY, not on "the operator touched this". Ticking
       every status and ticking none are the same board, so they must have the
       same shelf — and turning the last one back off has to bring it back, or
       the operator is left with a permanently amputated shelf and no control
       that looks responsible for it. */
    await withState({
      view: "board", query: "", facetProgram: "", facetProviders: [],
      facetStatuses: ["working", "waiting", "unverified"],
      lookbackHours: 6, showReviewWorkers: true,
    }, () => {
      expect(M.shelfFilter()(finished, program)).toBe(false);
    });
  });

  test("the empty board names every constraint that produced it", async () => {
    const reviewTask = "Review this change for security vulnerabilities.";
    const updatedAt = new Date().toISOString();
    const review = agent({ id: "claude:r1", provider: "claude", updatedAt, task: reviewTask });
    const snap = snapshot({ programs: [{ id: "p", name: "P", agents: [review] }] });

    /* lookbackHours is null here, not 6, and that is not an arbitrary fixture:
       `lookbackApplies("board")` is true, so any preset makes the lookback a
       SECOND constraint and the sole-constraint sentence below is reachable only
       on "Everything" (confirmed by execution — docs/EMPTY-BOARD-LOOKBACK-FINDING.md,
       4b4afa5). Whether that reachability should change is a separate ruling;
       this test states the behavior as it is rather than the behavior we want. */
    await withState({
      snap, view: "board", query: "", facetProgram: "", facetProviders: [],
      lookbackHours: null, showReviewWorkers: false,
    }, () => {
      expect(M.emptyListMessage(M.state))
        .toBe("1 review worker is hidden from the Board. Show them from Filters.");
    });

    /* The count is rendered INTO the sentence, so the noun and its verb have to
       move with it — "1 review workers are hidden" would read as a bug in the
       very number the sentence exists to disclose. */
    const second = agent({ id: "claude:r2", provider: "claude", updatedAt, task: reviewTask });
    const twoSnap = snapshot({ programs: [{ id: "p", name: "P", agents: [review, second] }] });
    await withState({
      snap: twoSnap, view: "board", query: "", facetProgram: "", facetProviders: [],
      lookbackHours: null, showReviewWorkers: false,
    }, () => {
      expect(M.emptyListMessage(M.state))
        .toBe("2 review workers are hidden from the Board. Show them from Filters.");
    });

    // Every active constraint gets named, in the order the operator would undo them.
    await withState({
      snap, view: "board", query: "zzz", facetProgram: "", facetProviders: [],
      lookbackHours: 6, showReviewWorkers: false,
    }, () => {
      expect(M.emptyListMessage(M.state))
        .toBe("Nothing matches the current search and filters and lookback (6h) and 1 review worker hidden in this view.");
    });

    /* The facets are named, not folded into the word "filters". An operator
       staring at an empty board needs to read WHICH lens emptied it — the control
       is one click away, but only if they know which control. */
    await withState({
      snap, view: "board", query: "", facetProgram: "", facetProviders: ["codex"],
      facetStatuses: ["waiting"], lookbackHours: null, showReviewWorkers: true,
    }, () => {
      expect(M.emptyListMessage(M.state))
        .toBe("Nothing matches the current provider (codex) and status (waiting) in this view.");
    });

    /* With sets, the MEMBERS are named too. "status (working or waiting)" is a
       far more diagnosable sentence than "status", because on an empty board the
       operator's next question is which of their picks is doing the excluding —
       and with five axes available, "some filter" is a worse answer than it has
       ever been. "or" rather than "and": within one axis the members union. */
    await withState({
      snap, view: "board", query: "", facetProgram: "", facetProviders: [],
      facetStatuses: ["working", "waiting"], lookbackHours: null, showReviewWorkers: true,
    }, () => {
      expect(M.emptyListMessage(M.state))
        .toBe("Nothing matches the current status (working or waiting) in this view.");
    });

    // Nothing narrowing the view: null hands the caller to the all-clear branch.
    await withState({
      snap, view: "board", query: "", facetProgram: "", facetProviders: [],
      lookbackHours: null, showReviewWorkers: true,
    }, () => {
      expect(M.emptyListMessage(M.state)).toBeNull();
    });
  });

  test("tabs do not repeat the lookback and the Board exposes hidden reviews", async () => {
    const updatedAt = new Date().toISOString();
    const review = agent({
      id: "claude:review",
      provider: "claude",
      task: "Review this change for security vulnerabilities.",
      displayName: "Security vulnerability review",
      updatedAt,
    });
    const work = agent({
      id: "codex:work",
      provider: "codex",
      task: "Implement the lifecycle change.",
      updatedAt,
    });
    const program = { id: "p", name: "P", agents: [review, work] };
    const snap = snapshot({ programs: [program], scanWindowHours: 36 });

    await withState({ snap, view: "board", lookbackHours: 6, showReviewWorkers: false }, () => withDom(() => {
      M.renderTabs();
      expect(domById.get("count-board")!.textContent).toBe("1");
    }));

    withDom(() => {
      M.renderFilterBar(listUi({
        view: "board",
        lookbackHours: 6,
        snap,
        showReviewWorkers: false,
        // FE-4 D3: the policy lives in the Class menu's footer now, so it is on
        // screen only while that menu is open. Closed, the disclosure rides the
        // trigger — pinned in the FE4-D3 tests.
        openFilterMenu: "class",
      }));
      const bar = domById.get("filter-bar");
      /* D4, then FE-4 D3. The disclosure survives every move; what changed each
         time is what it is DRESSED as. It said "Show review workers (1)" in chip
         clothing at the head of the filter row, which read as a narrowing THIS
         browser was applying — false twice over: it is a server setting shared by
         every browser looking at the fleet, and it is a standing policy about
         which rows the Board is for rather than a question about the sessions in
         front of you. It is now a separated action inside the Class menu, under
         the classes it governs. */
      const policy = byFkey(bar, "session-kind:review");
      expect(policy.className).toContain("filter-menu-policy");
      expect(policy.className).not.toContain("filter-chip");
      expect(textOf(policy)).toContain("1 hidden reviewer");
      // No pressed state: the label already says which way the fleet is set, and
      // a toggle's self-report on top of that would disagree with it half the time.
      expect(policy.attributes["aria-pressed"]).toBeUndefined();
      // The title has to say it is not yours alone — that is the whole disclosure.
      expect(policy.attributes.title).toContain("FLEET setting");
      expect(policy.attributes.title).toContain("your colleagues");
      expect(textOf(bar)).toContain("Last 6h");
    });

    // Showing them, the action is the way back — and it still says whose setting
    // it is, because that is the half an operator cannot see from the board.
    withDom(() => {
      M.renderFilterBar(listUi({
        view: "board", lookbackHours: 6, snap, showReviewWorkers: true, openFilterMenu: "class",
      }));
      expect(textOf(byFkey(domById.get("filter-bar"), "session-kind:review")))
        .toContain("Hide routine reviewers — fleet-wide setting");
    });
  });
});

describe("program rollups", () => {
  test("server rollup is used verbatim when present", () => {
    const rollup = { total: 9, live: 3, working: 2, idle: 1, ended: 6, needsYou: 1, blocked: 0, failed: 0, linked: 2 };
    expect(M.programRollup({ id: "p", name: "P", agents: [], rollup })).toBe(rollup);
  });

  test("fallback rollup counts derived states", () => {
    const agents = [
      agent({ id: "1", status: "running" }),
      agent({ id: "2", status: "attention", target: { resolution: "missing" } }),
      agent({ id: "3", status: "archived" }),
    ];
    const r = M.deriveRollup(agents);
    expect(r).toMatchObject({ total: 3, live: 2, working: 1, idle: 1, ended: 1, needsYou: 1, linked: 1 });
  });
});

describe("swarm clusters", () => {
  test("children group under their orchestrator; orphans stay at top level", () => {
    const parent = agent({ id: "codex:p" });
    const child = agent({ id: "codex:c", parentAgentId: "codex:p" });
    const orphan = agent({ id: "codex:o", parentAgentId: "codex:gone" });
    const { roots, children } = M.buildClusters([parent, child, orphan]);
    expect(roots.map((a: { id: string }) => a.id)).toEqual(["codex:p", "codex:o"]);
    expect(children.get("codex:p").map((a: { id: string }) => a.id)).toEqual(["codex:c"]);
  });
});

describe("snippet honesty", () => {
  test("the summary line spends its characters on words, not transport", () => {
    /* Sweep audit §15: the snippet is the line the operator reads to decide
       whether to act, and raw markdown link syntax, bare URLs and workspace
       UUIDs were consuming half its 88-character budget. */
    expect(M.conciseText("Back up and pushed — [PR #21](https://github.com/emilio3435/the-ant-hill/pull/21). Landed."))
      .toBe("Back up and pushed — PR #21. Landed.");
    expect(M.conciseText("see https://github.com/emilio3435/the-ant-hill/pull/21 now"))
      .toBe("see github.com/…/21 now");
    expect(M.conciseText("read this too: cmux://workspace/357F2CA2-696F-46B2-BBDF-DF672CE80B14"))
      .toBe("read this too: cmux://…");
    expect(M.conciseText("session 0123456789abcdef0123456789abcdef0123 retried"))
      .toBe("session … retried");
    // Ordinary prose is untouched.
    expect(M.conciseText("Lane G-1 is complete, nothing pushed.")).toBe("Lane G-1 is complete, nothing pushed.");
  });
});

describe("token honesty", () => {
  test("an all-zero reading renders as absence, not as a measurement", () => {
    /* Sweep audit §16: a spend-limit-locked session reported total 0 and the
       row printed a bold "0" styled exactly like a reading — a measurement the
       source never made. Zero everywhere is a source that has said nothing. */
    const s = M.tokenSummary({ provenance: "observed", scope: "latest-turn", total: 0 });
    expect(s.known).toBe(false);
    expect(s.text).toBe("not reported");
    // A real measurement with one zero part is untouched.
    expect(M.tokenSummary({ provenance: "observed", total: 1200, output: 0 }).known).toBe(true);
  });

  test("days keep a decimal and start at the day itself", () => {
    /* Sweep audit §9: Math.round at a 36h threshold printed "2d" for a
       36-hour span — a 33% overstatement — and could never print 1d, while
       precision fell from "22.1h" to "2d" across a one-second boundary. */
    const H = 3600 * 1000;
    expect(M.fmtElapsed(23 * H)).toBe("23.0h");
    expect(M.fmtElapsed(25 * H)).toBe("1.0d");
    expect(M.fmtElapsed(36 * H)).toBe("1.5d");
    expect(M.fmtElapsed(48 * H)).toBe("2.0d");
  });

  test("unavailable Cursor usage renders as not reported, never invented", () => {
    const s = M.tokenSummary({ provenance: "unknown" });
    expect(s.known).toBe(false);
    expect(s.text).toBe("not reported");
    expect(s.title).toContain("unknown");
  });

  test("observed and estimated totals are formatted and marked", () => {
    /* The noun is gone from the value: the column header already says Tokens,
       so repeating it under every number was the header printed 250 times. */
    expect(M.tokenSummary({ provenance: "observed", total: 1_500_000 }).text).toBe("1.5M");
    expect(M.tokenSummary({ provenance: "estimated", total: 2000 }).text).toBe("≈2k");
    // The estimate mark is what must survive — it changes what the number means.
    expect(M.tokenSummary({ provenance: "estimated", total: 2000 }).text.startsWith("≈")).toBe(true);
  });

  test("totals expose reporting coverage instead of inventing numbers", () => {
    const t = M.totalsOf({
      programs: [],
      totals: { live: 5, tracked: 10, attention: 0, tokenReporting: 3, tokenEligible: 5 },
    });
    expect(t.tokenReporting).toBe(3);
    expect(t.tokenEligible).toBe(5);
    expect(t.tokens).toBeUndefined();
  });
});

describe("latest-turn token semantics", () => {
  /* This test's own name claimed the value was "labeled as the latest call"
     while asserting the VISIBLE text read "42k tokens" — the scope lived in
     .label and .title, neither of which the row renders. That is how a row came
     to show "128k tokens" beside a program's "65.7M session tokens": ~500x
     apart, not summable, and qualified only on hover. (Render-first audit §2.) */
  test("latest-turn usage is marked, and the mark is not the words", () => {
    /* The property has not changed: a reader must be able to SEE that this
       number is qualified. What changed is the cost. Printing "latest call"
       satisfied it by spending eleven characters on every one of ~250 rows to
       state something true of nearly all of them; the mark satisfies it with
       one. What must never come back is the third option — a bare number whose
       only qualification is a title attribute nobody hovers. */
    const s = M.tokenSummary({ provenance: "observed", scope: "latest-turn", total: 42_000, input: 40_000, output: 2000 });
    expect(s.text).toBe("42k");
    expect(s.scopeMarked).toBe(true);
    expect(s.title).toContain("Latest model call");
    // The sentence has to say what it is NOT, since the confusion is with the rollup.
    expect(s.title).toContain("NOT the session total");

    /* The mark must not appear where it would be a lie. A scope the source did
       not report gets no mark, rather than an invented precision. */
    expect(M.tokenSummary({ provenance: "observed", total: 1200 }).scopeMarked).toBe(false);
    expect(M.tokenSummary({ provenance: "observed", scope: "session", total: 1200 }).scopeMarked).toBe(false);
    expect(M.tokenSummary({ provenance: "observed", scope: "session", total: 1200 }).text).toBe("1k");

    // The estimate mark is about provenance, not scope, and still leads the number.
    expect(M.tokenSummary({ provenance: "estimated", scope: "latest-turn", total: 42_000 }).text).toBe("≈42k");
  });

  test("the rendered row carries the qualification, with no visual mark left to carry it", () => {
    /* The regression this whole thread is about was a qualification that existed
       in a field nothing rendered. Asserting `scopeMarked` alone would repeat
       exactly that mistake, so this reads the DOM.

       The ⓘ is gone (operator directive, 2026-08-05) and the QUALIFICATION is
       not — which is precisely the distinction worth a test, because "remove the
       mark" is one careless edit away from removing the sentence with it and
       recreating the original defect. The aria-label and the title are its
       carriers now, so they are what this asserts. */
    const row = withDom(() => M.renderAgentRow(
      agent({ tokens: { provenance: "observed", scope: "latest-turn", total: 42_000 } }),
      { id: "p", name: "P" },
    ));
    const cell = byClass(row, "ri-tokens");
    expect(cell).not.toBeNull();
    expect(allByClass(cell, "ri-scope-mark").length).toBe(0);
    expect(styles).not.toContain(".ri-scope-mark");
    expect(String(cell.attributes?.["aria-label"])).toContain("latest model call");
    expect(String(cell.attributes?.title)).toBeTruthy();
  });

  test("legacy tokens without a scope keep the neutral label", () => {
    expect(M.tokenSummary({ provenance: "observed", total: 1200 }).label).toBe("tokens");
    expect(M.tokenSummary(undefined).label).toBe("tokens");
  });

  test("context usage reports capacity honestly and only when available", () => {
    const ctx = M.contextUsage({ provenance: "observed", scope: "latest-turn", total: 50_000, contextWindow: 200_000 });
    expect(ctx.pct).toBe(25);
    expect(ctx.text).toBe("50k of 200k (25%)");
    expect(M.contextUsage({ provenance: "observed", total: 50_000 })).toBeNull();
    expect(M.contextUsage({ provenance: "estimated", scope: "latest-turn", total: 50_000, contextWindow: 200_000 })).toBeNull();
    expect(M.contextUsage({ provenance: "observed", scope: "session", total: 50_000, contextWindow: 200_000 })).toBeNull();
    expect(M.contextUsage({ provenance: "observed", scope: "latest-turn", total: 250_000, contextWindow: 200_000 })).toEqual({ pct: 100, text: "250k of 200k (125%)" });
    expect(M.contextUsage({ provenance: "observed", contextWindow: 200_000 })).toBeNull();
    expect(M.contextUsage(undefined)).toBeNull();
  });

  test("context display switches between percentage and readable token capacity", () => {
    const tokens = { provenance: "observed", scope: "latest-turn", total: 50_000, contextWindow: 200_000 };
    expect(M.contextDisplayValue(tokens, "percent")).toBe("25%");
    expect(M.contextDisplayValue(tokens, "tokens")).toBe("50k / 200k");
    expect(M.contextDisplayValue({ provenance: "unknown" }, "percent")).toBe("not reported");
  });

  test("role aliases resolve to stable visual role categories", () => {
    expect(M.roleView("orchestration")).toEqual({ key: "orchestrator", label: "Orchestrator" });
    expect(M.roleView("designer")).toEqual({ key: "frontend", label: "Frontend / designer" });
    expect(M.roleView("implementer")).toEqual({ key: "backend", label: "Backend implementer" });
    expect(M.roleView("qa")).toEqual({ key: "tester", label: "Tester" });
    expect(M.roleView("unknown lane")).toEqual({ key: "agent", label: "Agent" });
  });
});

describe("typical request (header token truth)", () => {
  test("prefers the server-reported totals.tokenMedian", () => {
    const snap = {
      programs: [{ id: "p", name: "P", agents: [agent({ tokens: { provenance: "observed", scope: "latest-turn", total: 9_000_000 } })] }],
      totals: { tokenMedian: 12_000 },
    };
    expect(M.typicalRequestOf(snap)).toEqual({ value: 12_000, source: "reported" });
  });

  test("falls back to the median of live latest-turn totals", () => {
    const snap = {
      programs: [{
        id: "p", name: "P",
        agents: [
          agent({ id: "1", tokens: { provenance: "observed", scope: "latest-turn", total: 10_000 } }),
          agent({ id: "2", tokens: { provenance: "observed", scope: "latest-turn", total: 30_000 } }),
          agent({ id: "3", status: "archived", tokens: { provenance: "observed", scope: "latest-turn", total: 900_000 } }),
          agent({ id: "4", tokens: { provenance: "observed", total: 700_000 } }), // session-scoped: excluded
          agent({ id: "5", tokens: { provenance: "unknown" } }),
        ],
      }],
    };
    expect(M.typicalRequestOf(snap)).toEqual({ value: 20_000, source: "derived" });
  });

  test("reports nothing when no live session reports latest-turn usage", () => {
    const snap = { programs: [{ id: "p", name: "P", agents: [agent({ tokens: { provenance: "unknown" } })] }] };
    expect(M.typicalRequestOf(snap)).toBeNull();
  });
});

describe("Cursor model policy is gone, and stays gone", () => {
  /* This block used to hold five tests for the compliance badge, the fleet
     glance, and the per-session findings the client synthesized. All of it was
     removed with the policy on 2026-08-05.

     Two claims replace them, because deletion needs a guard or it grows back. */

  test("totals pass through tokenMedian and aggregate tokens, and carry no policy rollup", () => {
    const totals = {
      live: 33, tracked: 427, working: 8, idle: 25, history: 394, attention: 0,
      tokenReporting: 8, tokenEligible: 8, tokenMedian: 170_912, tokens: 1_223_880,
      cursorModelHealth: { compliant: 2, mismatch: 0, unreported: 4, total: 6 },
    };
    const t = M.totalsOf({ programs: [], totals });
    expect(t.tokenMedian).toBe(170_912);
    expect(t.tokens).toBe(1_223_880);
    // Even when a stale server sends the rollup, the client stops carrying it.
    expect(t.cursorModelHealth).toBeUndefined();
  });

  test("the client mints no finding the server has not published", () => {
    /* The real defect this guards. `policy:<agentId>` was a client-invented id,
       so it never appeared in snapshot.issues — and handleTriageRequest resolves
       triage targets out of exactly that array. Every Triage click on one of
       these rows returned 404 ISSUE_NOT_FOUND. Seven were live on the board.

       The assertion is deliberately broader than the policy that caused it: no
       synthesized finding may carry an id the server did not send. */
    const snap = {
      programs: [{
        id: "p", name: "P",
        agents: [
          agent({ id: "v", provider: "cursor", model: "claude-opus-5", modelPolicy: { state: "mismatch", expected: "grok" } }),
          agent({ id: "ok", provider: "cursor", model: "composer-2.5" }),
        ],
      }],
      issues: [],
      controlHealth: { cmuxReachable: true, lastCheckedAt: "", errors: [], staleSources: [] },
    };
    const issues = M.issuesOf(snap);

    expect(issues.filter((i: { kind: string }) => i.kind === "policy")).toHaveLength(0);
    expect(issues.some((i: { id: string }) => i.id.startsWith("policy:"))).toBe(false);
    // Nothing the client emits may name an id the server never published.
    const published = new Set(snap.issues.map((i: { id: string }) => i.id));
    const invented = issues.filter((i: { id: string }) => !published.has(i.id) && !i.id.startsWith("agent:"));
    expect(invented).toEqual([]);
  });
});

describe("modelShort — Cursor-native short forms within the 18-char bound", () => {
  test("Composer flattens to 'composer <version> <qualifier>'", () => {
    expect(M.modelShort("composer-2.5-fast")).toBe("composer 2.5 fast");
    expect(M.modelShort("composer-2.5")).toBe("composer 2.5");
    expect(M.modelShort("composer-2")).toBe("composer 2");
    // The recognizable output must stay within the row's 18-char budget.
    expect(M.modelShort("composer-2.5-fast").length).toBeLessThanOrEqual(18);
  });

  test("Grok keeps a recognizable family + dotted version, dropping qualifiers", () => {
    expect(M.modelShort("cursor-grok-4.5-high-fast")).toBe("grok 4.5");
    expect(M.modelShort("grok-4.5-fast-xhigh")).toBe("grok 4.5");
    expect(M.modelShort("grok-4.5")).toBe("grok 4.5");
    expect(M.modelShort("grok")).toBe("grok");
  });

  test("existing Anthropic, Codex, and Cursor-agent short forms are unchanged", () => {
    expect(M.modelShort("claude-opus-4-8-thinking-high")).toBe("opus 4.8");
    expect(M.modelShort("claude-fable-5-thinking-high")).toBe("fable 5");
    expect(M.modelShort("gpt-5.6-sol-xhigh")).toBe("sol 5.6");
    expect(M.modelShort("gpt-5-codex")).toBe("gpt-5-codex");
    expect(M.modelShort(null)).toBeNull();
  });

  /* A placeholder is not a model name. The collector writes `<synthetic>` when it
     manufactures a session and absence words like "unknown" when it has no model,
     and both used to pass through unchanged into a slot whose fallback reads "not
     reported" — a gap filled with something that reads like an answer, which is
     the one thing this board must not do. Null here, so every caller's own
     absence wording applies. Measured on the wire 2026-08-03: 3 agents carried
     "<synthetic>", 7 carried no model field at all. */
  test("collector placeholders are not model names", () => {
    expect(M.modelShort("<synthetic>")).toBeNull();
    expect(M.modelShort("<unknown>")).toBeNull();
    expect(M.modelShort("unknown")).toBeNull();
    expect(M.modelShort("Unknown")).toBeNull();
    expect(M.modelShort("none")).toBeNull();
    expect(M.modelShort("n/a")).toBeNull();
    expect(M.modelShort("  ")).toBeNull();
    // A real name that merely contains an absence word is still a real name.
    expect(M.modelShort("unknown-forge-2")).toBe("unknown-forge-2");
  });
});

describe("issues", () => {
  /* Render-first audit §1, the false all-clear. issuesOf used to return
     snap.issues by identity, which short-circuited the client derivation below
     it — so the rail counted the SERVER's agent rule (outcome not healthy and
     not ended) while the tab counted alerting(). Reproduced on the board: rail
     "Needs you 1 finding", tab "Needs you 0", headline "Nothing needs you", all
     in one capture, each correct for its own hidden population.

     The rule now: the server owns findings the client cannot see; the client
     owns the agent half, so it is the tab's population by construction. */
  test("server system findings survive verbatim; the agent half is re-derived", () => {
    const sys = { id: "system:x", kind: "system", severity: "error", title: "t", summary: "s", affectedAgentIds: [] };
    const passed = M.issuesOf({ programs: [], issues: [sys] });
    expect(passed).toEqual([sys]);
    expect(passed[0]).toBe(sys); // not rebuilt, not reworded

    /* A server agent finding for an agent the client does NOT consider alerting
       must not survive — that is the exact row that made the rail disagree with
       the tab. */
    const healthy = agent({ id: "calm", outcome: "healthy", activity: "working" });
    const stale = {
      id: "agent:calm", kind: "agent", severity: "warning",
      title: "calm needs review", summary: "", affectedAgentIds: ["calm"],
    };
    const merged = M.issuesOf({ programs: [{ id: "p", name: "P", agents: [healthy] }], issues: [sys, stale] });
    expect(merged.map((i: { id: string }) => i.id)).toEqual(["system:x"]);

    /* And an agent the client DOES consider alerting gets a finding even when
       the server shipped none for it — the attentionSignal case the server's
       outcome-only rule misses. */
    const waiting = agent({
      id: "waiting", outcome: "healthy", activity: "working",
      attentionSignal: { evidence: "asked a question" },
    });
    const derived = M.issuesOf({ programs: [{ id: "p", name: "P", agents: [waiting] }], issues: [sys] });
    expect(derived.map((i: { id: string }) => i.id)).toEqual(["system:x", "agent:waiting"]);

    /* The invariant the whole fix exists to hold: the collection's agent half
       and the Alerts tab's population are the same set, always. */
    const agentFindings = derived.filter((i: { kind: string }) => i.kind === "agent").length;
    expect(agentFindings).toBe([waiting].filter((a) => M.alerting(a)).length);
  });

  test("fallback surfaces collector errors as a system issue even with zero attention agents", () => {
    const snap = {
      programs: [{ id: "p", name: "P", agents: [agent()] }],
      controlHealth: { cmuxReachable: true, lastCheckedAt: "", errors: ["boom"], staleSources: [] },
    };
    const issues = M.issuesOf(snap);
    expect(issues.some((i: { kind: string }) => i.kind === "system")).toBe(true);
    expect(issues[0].technicalDetails).toEqual(["boom"]);
  });

  test("issue lifecycle labels keep verification and source-confirmed resolution distinct", () => {
    const verifying = {
      id: "system:verification",
      kind: "system",
      severity: "error",
      title: "Identity conflict",
      summary: "Source still reports the conflict.",
      affectedAgentIds: [],
      lifecycle: { state: "verifying", openedAt: "2026-07-22T05:00:00.000Z", verificationStartedAt: "2026-07-22T05:01:00.000Z" },
    };
    const resolved = {
      ...verifying,
      lifecycle: { state: "resolved", openedAt: verifying.lifecycle.openedAt, resolvedAt: "2026-07-22T05:02:00.000Z", result: "Fresh source evidence is clear." },
    };
    expect(M.issueStateLabel(verifying)).toBe("Verifying");
    expect(M.issueStateLabel(resolved)).toBe("Resolved");
    expect(M.issuesOf({ programs: [], issues: [verifying] })[0].lifecycle.state).toBe("verifying");
    expect(M.recentlyResolvedOf({ programs: [], recentlyResolved: [resolved] })).toEqual([resolved]);
  });
});

describe("search", () => {
  test("matches across name, role, provider, model, status, cwd, and transcript", () => {
    const a = agent({
      role: "verifier", model: "gpt-5.6-sol", cwd: "/Users/emilio/Developer/the-mountain",
      transcriptTail: "All checks passed on ridge-7.", nickname: "Scout",
    });
    const program = { id: "p", name: "The Mountain" };
    for (const q of ["scout", "verifier", "codex", "sol", "working", "the-mountain", "ridge-7", "mountain"]) {
      expect(M.matchesQuery(a, program, q)).toBe(true);
    }
    expect(M.matchesQuery(a, program, "zzz-nope")).toBe(false);
  });

  test("you can search for the name you can actually see", () => {
    /* Search indexed `displayName`, which after the naming contract is no
       longer what the row shows. The gap is exactly the case the contract
       exists for: an authored name beats the derived one on screen, so
       "Lifecycle Mapper" was visible on the board and unfindable in the box —
       while the string search DID match was nowhere on screen. */
    const authored = agent({
      displayName: "Claude · the-mountain-main",
      identity: { name: "Lifecycle Mapper", base: "Lifecycle Mapper", source: "authored" },
    });
    const program = { id: "p", name: "The Mountain" };

    expect(M.matchesQuery(authored, program, "lifecycle mapper")).toBe(true);
    // The old string stays findable — thirty days of archived rows still carry it.
    expect(M.matchesQuery(authored, program, "the-mountain-main")).toBe(true);
  });

  test("the search affordance advertises exactly the fields matchesQuery covers", () => {
    const input = html.match(/<input id="search"[^>]*>/)?.[0];
    expect(input).toBeDefined();
    const placeholder = input!.match(/placeholder="([^"]*)"/)?.[1] ?? "";
    const title = input!.match(/title="([^"]*)"/)?.[1] ?? "";
    /* The AFFORDANCE advertises them, not the placeholder specifically. The
       placeholder used to enumerate all seven and measured 389px inside a 333px
       input once the drawer docked, so the list was unreadable exactly when the
       box was smallest (audit §16). The enumeration moved to the title, which is
       where a field list belongs; the property being guarded — every advertised
       field is one matchesQuery actually indexes, no promise search cannot keep —
       is unchanged and still checked below. */
    const program = { id: "p", name: "Prog" };
    const probes: Array<[string, string]> = [
      ["name", "ridge-scout"], ["model", "gpt-5.6-sol"], ["cwd", "/Users/emilio/Developer/deep-ridge"],
      ["provider", "codex"], ["role", "verifier"], ["status", "running"], ["session id", "sess-ridge-9"],
    ];
    const a = agent({
      displayName: "ridge-scout", model: "gpt-5.6-sol", cwd: "/Users/emilio/Developer/deep-ridge",
      provider: "codex", role: "verifier", status: "running", sourceSessionId: "sess-ridge-9",
    });
    const label = html.match(/<label class="visually-hidden" for="search">([^<]*)</)?.[1] ?? "";
    const advertised = (title + " " + label).toLowerCase();
    for (const [field, sample] of probes) {
      expect(advertised, field).toContain(field);
      expect(M.matchesQuery(a, program, sample.toLowerCase())).toBe(true);
    }
    // The placeholder still says what the box is for, and now what focuses it.
    expect(placeholder.toLowerCase()).toContain("search agents");
  });
});

describe("stable-feed elapsed clocks", () => {
  test("live sessions get a ticking clock; ended sessions freeze", () => {
    const generatedAt = new Date(Date.now() - 5000).toISOString();
    const live = M.elapsedDataset(agent({ elapsedMs: 60_000 }), generatedAt);
    expect(live.elapsedBase).toBe("60000");
    expect(live.elapsedFrom).toBe(generatedAt);
    const done = M.elapsedDataset(agent({ status: "archived", elapsedMs: 60_000 }), generatedAt);
    expect(done).toEqual({});
    expect(M.liveElapsedText(agent({ status: "archived", elapsedMs: 60_000 }), generatedAt)).toBe("60s");
  });
});

describe("unavailable-control explanation stays plain-language", () => {
  test("messages come from control state and never carry raw routing IDs", () => {
    const quarantined = M.controlUnavailableText("quarantined");
    const observed = M.controlUnavailableText("observed-only");
    expect(quarantined).toContain("identity is ambiguous");
    expect(observed).toContain("no safe cmux target is linked");
    for (const msg of [quarantined, observed]) {
      expect(msg).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/i); // no UUID fragments
      expect(msg).not.toMatch(/ttys|workspace:|surface/); // no cmux identifiers
    }
  });

  /* W4-B: was seven source substrings over two hand-sliced function bodies —
     it could not fail if a reason were echoed through a variable, and it broke
     whenever a function moved. Now a real routing reason is planted and both
     surfaces are read: the banner explains, the dock stays silent. */
  test("command dock never echoes capability reasons in the Operate chrome", () => {
    const reason = "surface a1b2 is claimed by two sessions (lsof evidence conflicts)";
    const quarantined = agent({
      controlState: "quarantined",
      target: { resolution: "ambiguous", reason },
      controls: [
        { action: "instruct", enabled: false, reason },
        { action: "focus", enabled: false, reason },
        { action: "interrupt", enabled: false, reason },
        { action: "archive", enabled: false, reason },
      ],
    });
    const dock = withDom(() => M.renderCommandDock(quarantined, "quarantined", null, []));
    const banner = withDom(() => M.renderControlBanner(quarantined, "quarantined"));

    // The banner owns the explanation — in its own operator sentence, not by
    // pasting the resolver's evidence string at someone.
    expect(banner).not.toBeNull();
    expect(textOf(banner)).toContain(M.controlUnavailableText("quarantined"));
    expect(textOf(banner)).not.toContain(reason);

    // The dock never repeats the raw routing reason — not in text, not in a
    // title, not in an aria-label. That string is evidence, not operator copy.
    const dockText = textOf(dock);
    expect(dockText).not.toContain(reason);
    // The explanation now travels with the dock only when renderAgentDrawer
    // inserts the banner into the pane footer; the dock primitive stays silent.
    expect(dockText).not.toContain(M.controlUnavailableText("quarantined"));
    const leaked = findAll(dock, (n: any) =>
      Object.values(n.attributes || {}).some((v) => String(v).includes(reason)));
    expect(leaked).toEqual([]);
  });
});

describe("redesigned network contracts (source-level)", () => {
  test("program rename is presentation-only via GET/POST /api/program-aliases", () => {
    expect(source).toContain('apiFetch("/api/program-aliases"');
    const program = { id: "stable-source-id", name: "Source program" };
    expect(M.presentationLabelKey({ kind: "program", programId: program.id }))
      .toBe("program:stable-source-id");
    expect(M.programName(program)).toBe("Source program");
  });

  /* W4-B: was seven source substrings. They could not fail if fetchLabels
     stopped reading `body.labels`, or if submitRename posted the display name
     instead of the stable target. Both are the actual contract with the server,
     so both are now driven. */
  test("labels hydrate from the existing loopback path and submit stable target payloads", async () => {
    const target = { kind: "program", programId: "p1" };
    await withState({ labels: new Map(), aliases: new Map(), labelsLoaded: false, labelLoadError: "" }, async () => {
      await withRequests([{ status: 200, json: { ok: true, labels: { "program:p1": "Ridge" } } }], async (calls) => {
        await M.fetchLabels();
        expect(calls.map((c) => [c.method, c.url])).toEqual([["GET", "/api/program-aliases"]]);
        expect(M.state.labels.get("program:p1")).toBe("Ridge");
        expect(M.state.labelsLoaded).toBe(true);
      });
    });

    // A malformed envelope must not be adopted as "no labels" — that would
    // silently wipe every custom name on the board.
    await withState({ labels: new Map([["program:p1", "Ridge"]]), aliases: new Map(), labelsLoaded: false, labelLoadError: "" }, async () => {
      await withRequests([{ status: 200, json: { ok: true } }], async () => {
        await M.fetchLabels();
        expect(M.state.labels.get("program:p1")).toBe("Ridge");
        expect(M.state.labelLoadError).not.toBe("");
      });
    });

    // The POST carries the stable presentation target, never the rendered name.
    await withState({
      snap: snapshot(), labels: new Map(), aliases: new Map(),
      renaming: M.presentationLabelKey(target), renameDraft: "  Ridge crew  ",
      renamePending: false, renameError: "",
    }, async () => {
      await withRequests([{ status: 200, json: { ok: true } }], async (calls) => {
        await M.submitRename(target);
        expect(calls[0]!.method).toBe("POST");
        expect(calls[0]!.url).toBe("/api/program-aliases");
        expect(calls[0]!.body).toEqual({ target, label: "Ridge crew" });
        expect(M.state.aliases.get("program:p1")).toBe("Ridge crew");
        expect(M.state.renaming).toBeNull();
      });
    });

    // An empty label is a reset, and it clears the stored alias rather than
    // saving an empty string that would render as a blank name.
    await withState({
      snap: snapshot(), labels: new Map([["program:p1", "Ridge crew"]]),
      aliases: new Map([["program:p1", "Ridge crew"]]),
      renaming: M.presentationLabelKey(target), renameDraft: "   ",
      renamePending: false, renameError: "",
    }, async () => {
      await withRequests([{ status: 200, json: { ok: true } }], async (calls) => {
        await M.submitRename(target);
        expect(calls[0]!.body.label).toBe("");
        expect(M.state.aliases.has("program:p1")).toBe(false);
      });
    });
  });

  test("program labels use semantic keyboard controls with a caret that only expands", () => {
    const program = { id: "p1", name: "P", agents: [agent()] };
    const root = newNode("div");
    withDom(() => M.syncProgramList(
      root,
      [{ program, agents: program.agents }],
      listUi({ snap: { schemaVersion: 1, programs: [program] } }),
    ));
    const head = byClass(root, "program-head");
    const caret = byClass(root, "program-caret");
    const label = byClass(root, "program-label");
    expect(head).not.toBeNull();
    expect(caret?.tagName).toBe("button");
    expect(caret?.attributes.type).toBe("button");
    expect(label?.tagName).toBe("button");
    expect(label?.attributes.type).toBe("button");
    expect(label?.attributes.role).toBeUndefined();

    const form = withDom(() => M.renderLabelForm(
      { kind: "program", programId: program.id },
      {
        inputKey: "rename-input:p1",
        placeholder: "Display name",
        ariaLabel: "New display name for P",
        source: "Source program: P · id stays p1",
      },
    ));
    const input = findAll(form, (node) => node.tagName === "input")[0];
    const submit = buttonsOf(form).find((button) => button.attributes.type === "submit");
    expect(form.tagName).toBe("form");
    expect(input?.attributes.type).toBe("text");
    expect(input?.attributes["aria-label"]).toBe("New display name for P");
    expect(submit).toBeDefined();
    expect(source).toContain('onkeydown: (e) => { if (e.key === "Escape")');
  });

  test("agent names track terminal titles and stay editable in the list", () => {
    const linked = agent({
      displayName: "Codex · ridge",
      target: {
        resolution: "exact",
        workspaceId: "WORKSPACE-1",
        surfaceId: "SURFACE-1",
        workspaceTitle: "Ridge terminal",
      },
    });
    expect(M.agentLabelEligible(linked)).toBe(true);
    expect(M.agentLabelEligible(null)).toBe(false);
    expect(M.terminalSourceName(linked)).toBe("Ridge terminal");
    expect(M.preferredRenameTarget(linked)).toEqual({
      kind: "workspace",
      workspaceId: "WORKSPACE-1",
    });
    expect(M.agentName(linked)).toBe("Ridge terminal");
    expect(M.agentName({
      ...linked,
      target: { ...linked.target, cwdRelation: "different" },
    })).toBe("Codex · ridge");

    const program = { id: "p1", name: "P", agents: [linked] };
    const row = withDom(() => M.renderAgentRow(linked, program));
    expect(row.tagName).toBe("div");
    expect(row.attributes.role).toBe("button");
    expect(byClass(row, "agent-rename")?.tagName).toBe("button");
    expect(M.agentRowSig(linked, listUi({
      renaming: "workspace:WORKSPACE-1",
    }), { depth: 0, childCount: 0, fullById: new Map() }))
      .not.toBe(M.agentRowSig(linked, listUi(), {
        depth: 0,
        childCount: 0,
        fullById: new Map(),
      }));
  });

  /* The row's own pencil renames the DISPLAY name — a board derivation stored
     as a presentation label. The cmux workspace title is a different field
     entirely, living on the terminal and written through /api/sync/rename, and
     until now it was only reachable from the drawer. Two names, two stores, two
     write paths; the row now shows both and labels which is which.

     The signature assertion at the end is the load-bearing one: the workspace
     title arrives from cmux on the event stream, so nothing else on the row
     moves when somebody renames the terminal from the other side. Without the
     title in agentRowSig the row keeps its cached node and the rename simply
     never appears. */
  test("a routed row carries the cmux workspace line, distinct from the display-name rename", () => {
    const routed = agent({
      id: "codex:ws1",
      target: { resolution: "exact", workspaceId: "WORKSPACE-9", workspaceTitle: "CAND · F-measured · opus5h" },
    });
    const program = { id: "p1", name: "P", agents: [routed] };
    const row = withDom(() => M.renderAgentRow(routed, program));

    const line = byClass(row, "row-workspace");
    expect(line).not.toBeNull();
    expect(textOf(line)).toContain("CAND · F-measured · opus5h");
    expect(textOf(line)).toMatch(/workspace/i);

    /* Both pencils present, and distinguishable. Sharing an fkey would make the
       focus restore in render() pick whichever the walker reached first. */
    const nameBtn = byClass(row, "agent-rename");
    const wsBtn = byClass(row, "row-workspace-rename");
    expect(nameBtn).not.toBeNull();
    expect(wsBtn).not.toBeNull();
    expect(wsBtn.dataset.fkey).not.toBe(nameBtn.dataset.fkey);
    expect(String(wsBtn.attributes["aria-label"])).toMatch(/workspace/i);

    /* No resolved workspace, no line — the board never guesses which terminal a
       rename would land on. */
    const unrouted = agent({ id: "codex:none", target: { resolution: "ambiguous" } });
    expect(byClass(withDom(() => M.renderAgentRow(unrouted, program)), "row-workspace")).toBeNull();

    const base = { depth: 0, childCount: 0, fullById: new Map() };
    const renamed = { ...routed, target: { ...routed.target, workspaceTitle: "CAND · renamed elsewhere" } };
    expect(M.agentRowSig(renamed, listUi(), base)).not.toBe(M.agentRowSig(routed, listUi(), base));
  });

});

describe("calm program and agent list rendering", () => {
  test("the message lane is additive and falls back to the existing summary", () => {
    const message = "Review the responsive control room layout across desktop and mobile widths.";
    expect(M.rowSummary(agent({ lastHumanMessage: message }))).toContain("Review the responsive control room layout");
    expect(M.rowSummary(agent({ lastHumanMessage: "   " }))).toBe("Streaming output.");
  });

  test("program lists share the five primary columns and keep secondary details out of the row grid", () => {
    expect(source).toContain("function renderAgentColumnHeader()");
    /* FE-B: the row list is now a keyed PLAN reconciled into the program body
       rather than an array appended wholesale, so this asserts on the plan the
       list actually produces — the column header still leads it. */
    const program = { id: "p1", name: "P", agents: [agent({ id: "codex:a1" }), agent({ id: "codex:a2" })] };
    const plan = M.agentRowPlan(program, program.agents, listUi({ snap: { schemaVersion: 1, programs: [program] } }));
    /* Two working roots and nothing else: the sole populated section earns no
       divider — a heading over the only population divides nothing — so the
       header leads straight into the rows. */
    expect(plan.map((item: { key: string }) => item.key))
      .toEqual(["columns", "row:codex:a1", "row:codex:a2"]);
    // C1: the header names the identity column plus the promoted instrument
    // cluster (status word, model+ctx%, tokens, elapsed) — "Context"/"Access" text
    // tags left the row grid (Access folds into the aria-label; ctx% rides Model).
    const header = withDom(() => plan[0].build());
    expect(header.className).toContain("agent-column-header");
    // The default (Board) lens labels the fifth column QUIET — time since the
    // last update, the question a live lens is actually asked. Span stays on
    // History, where a total duration is the point.
    for (const label of ["Agent/message", "Status", "Harness", "Model", "Ctx", "Tokens", "Quiet"]) {
      expect(textOf(header)).toContain(label);
    }
    expect(source).not.toContain('rowFact("Effort"');
    expect(source).not.toContain("class: \"fact-age\"");
    expect(styles).toContain(".agent-column-header");
    expect(styles).toContain("-webkit-line-clamp: 3");
  });

  test("the status column speaks only what the active tab does not already guarantee", () => {
    /* Audit §7: with Now active, all six in-viewport rows printed "Working". A
       column where every cell carries the same word is not a signal, and it was
       spending the roster's scarcest space restating the tab the operator had
       just chosen. viewMatches pins working/idle/history to one activity, so
       there the tab IS the answer. */
    expect(M.rowStateWords("working", "healthy", "now")).toEqual([]);      // the dominant case
    expect(M.rowStateWords("working", "healthy", "working")).toEqual([]);  // pinned by the tab
    expect(M.rowStateWords("idle", "healthy", "waiting")).toEqual([]);     // pinned by the tab
    expect(M.rowStateWords("ended", "healthy", "history")).toEqual([]);    // pinned by the tab

    // An exceptional outcome is never silent, in any view.
    expect(M.rowStateWords("working", "needs-you", "now")).toEqual(["Alert"]);
    expect(M.rowStateWords("working", "failed", "working")).toEqual(["Failed"]);
    // A mixed view still distinguishes a non-dominant activity.
    // "Idle" is spelled Waiting now: idle blamed the agent for a silence that is
    // usually the operator's move.
    expect(M.rowStateWords("idle", "needs-you", "now")).toEqual(["Waiting", "Alert"]);

    const row = source.match(/function renderAgentRow\(agent, program, opts = \{\}\) \{[\s\S]*?\n\}/)?.[0];
    expect(row).toBeDefined();
    // Full state still lives in the tooltip + row aria-label, so nothing is lost
    // to a reader who asks — it just stops being printed on every row.
    expect(row).toContain('title: stateText');
    expect(row).not.toContain("act-glyph act-");
    expect(row).toContain('"row-state-alert"');
    expect(styles).toContain(".row-state-alert { color: var(--needs); }");
  });

  test("an alerting row says Alert even when Waiting got there first", () => {
    /* Sweep audit §2: the group head said "6 alerts" while most of its rows
       printed only "Waiting" — a hook-shaped alert has a HEALTHY outcome, so
       the attention word was gated behind !words.length and lost on exactly
       the rows where it was the only signal. It appends now; it never depends
       on being the only word. */
    const hooked = agent({ status: "waiting", lifecycle: "waiting", hookLifecycle: "needsInput" });
    expect(M.rowStateWords("idle", "healthy", "now", hooked)).toEqual(["Waiting", "Alert"]);
    expect(M.rowStateWords("working", "healthy", "now", hooked)).toEqual(["Alert"]);
    // Never doubled when the outcome already carries the word.
    expect(M.rowStateWords("idle", "needs-you", "now", hooked)).toEqual(["Waiting", "Alert"]);

    /* And the ink follows the words: outcome-picked ink painted "Alert" in
       the healthy activity green — the safe color — on those same rows. */
    const program = { id: "p1", name: "P", agents: [hooked] };
    const rendered = withDom(() => M.renderAgentRow(hooked, program));
    const word = byClass(rendered, "row-state-alert");
    expect(word).not.toBe(null);
    expect(textOf(word)).toContain("Alert");
  });

  test("selected rows retain an accessible full-text inspector path", () => {
    const message = "Review the full terminal transcript before dispatch.";
    const selected = agent({ lastUserMessage: message, lastAgentMessage: "Evidence checked." });
    const program = { id: "p1", name: "P", agents: [selected] };
    const row = withDom(() => M.renderAgentRow(selected, program));
    expect(row.attributes["aria-label"]).toContain(
      "Select to open the full message and session details in the inspector.",
    );

    const drawer = withDom(() => {
      const pane = newNode("div");
      M.renderAgentDrawer(pane, { kind: "agent", agent: selected, program });
      return pane;
    });
    /* The drawer used to print the message a second time under "Last human
       message". That panel is gone; the message now lives exactly once, as a
       Thread turn, which is what this test should be guarding. */
    expect(byClass(drawer, "last-human-message")).toBeNull();
    /* Asserted as PRESENCE among the turns, not as the first one. The check read
       `byClass(...)[0]` and so quietly also asserted reading order, which the
       comment above says was never the point — and it failed the moment the
       agent's reply was promoted to lead the thread. Exactly once, still. */
    const bodies = allByClass(drawer, "chat-turn-body").map((node: any) => textOf(node));
    expect(bodies.filter((body: string) => body === message)).toHaveLength(1);
    expect(textOf(drawer)).toContain("Evidence checked.");
    expect(styles).toContain("white-space: pre-wrap");
    expect(styles).toContain("min-height: 44px");
  });
});

describe("agent rows: instrument cluster + de-noise (C1)", () => {
  /* Same DOM-less execution trick B2/B3/B4 used: a minimal fake document lets
     renderAgentRow build real nodes via el()/icon(), so these assert on what the
     row actually renders — not merely on source substrings. */
  function fakeDom() {
    const make = (tag: string) => ({
      nodeType: 1,
      tagName: tag,
      className: "",
      textContent: "",
      dataset: {} as Record<string, string>,
      attributes: {} as Record<string, string>,
      children: [] as unknown[],
      classList: { add() {} },
      get childNodes() { return this.children; },
      get childElementCount() { return this.children.length; },
      setAttribute(k: string, v: unknown) { this.attributes[k] = String(v); },
      addEventListener() {},
      append(...kids: unknown[]) { this.children.push(...kids); },
    });
    return {
      createElement: (t: string) => make(t),
      createElementNS: (_ns: string, t: string) => make(t),
      createTextNode: (s: string) => ({ nodeType: 3, textContent: String(s) }),
    };
  }
  function withDom<T>(fn: () => T): T {
    (globalThis as unknown as { document: unknown }).document = fakeDom();
    try { return fn(); } finally {
      delete (globalThis as unknown as { document?: unknown }).document;
    }
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function classesOf(node: any, out: string[] = []): string[] {
    if (!node || typeof node !== "object") return out;
    if (typeof node.className === "string" && node.className) out.push(node.className);
    for (const kid of node.children || []) classesOf(kid, out);
    return out;
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function textOf(node: any): string {
    if (!node || typeof node !== "object") return "";
    if (node.nodeType === 3) return String(node.textContent || "");
    let s = typeof node.textContent === "string" ? node.textContent : "";
    for (const kid of node.children || []) s += textOf(kid);
    return s;
  }
  // First node whose className carries the given token (whitespace-separated).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function findByClass(node: any, token: string): any {
    if (!node || typeof node !== "object") return null;
    if (typeof node.className === "string" && node.className.split(/\s+/).includes(token)) return node;
    for (const kid of node.children || []) {
      const hit = findByClass(kid, token);
      if (hit) return hit;
    }
    return null;
  }

  const program = { id: "p1", name: "Prog" };

  test("(a) the executed row renders a .row-instruments cluster with mono model/ctx%/tokens/elapsed", () => {
    expect(typeof M.renderAgentRow).toBe("function");
    const live = agent({
      model: "gpt-5-codex",
      tokens: { provenance: "observed", scope: "latest-turn", total: 40000, contextWindow: 200000 },
      elapsedMs: 125000,
      updatedAt: new Date().toISOString(),
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const row: any = withDom(() => M.renderAgentRow(live, program));
    const instruments = findByClass(row, "row-instruments");
    expect(instruments).not.toBeNull();
    const text = textOf(instruments);
    expect(text).toContain("gpt-5-codex"); // model short id, reused from modelShort
    expect(text).toContain("20%");         // ctx% (40k/200k) — DESIGN "model + ctx%"
    expect(text).toContain("40k");         // observed tokens, reused from tokenSummary
    /* On the Board lens the fifth cell is QUIET, and a fresh row draws no
       cell at all — blank IS the signal. A row three hours quiet says so. */
    expect(findByClass(row, "is-quiet")).toBeNull();
    const stale = agent({ model: "gpt-5-codex", updatedAt: new Date(Date.now() - 3 * 3600e3).toISOString() });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const staleRow: any = withDom(() => M.renderAgentRow(stale, program));
    expect(textOf(findByClass(staleRow, "is-quiet"))).toContain("3.0h");
    // Values ride the canonical "<size> mono" convention (DESIGN rule 2 —
    // mono for values), like vital-big mono; status word is the one non-value.
    const monoVals = classesOf(instruments)
      .filter((c) => /\bri-value\b/.test(c) && /\bmono\b/.test(c));
    expect(monoVals.length).toBeGreaterThanOrEqual(2); // model, tokens
  });

  test("(b) unknown tokens/context omit cells honestly — no fabricated numbers", () => {
    const bare = agent({
      provider: "claude",
      model: "claude-opus-4-8",
      tokens: { provenance: "unknown" },
      elapsedMs: undefined,
      updatedAt: undefined,
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const row: any = withDom(() => M.renderAgentRow(bare, program));
    const instruments = findByClass(row, "row-instruments");
    expect(instruments).not.toBeNull();
    // Model still shows its honest short id, but no invented context percentage.
    const modelCell = findByClass(instruments, "ri-model");
    expect(modelCell).not.toBeNull();
    expect(textOf(modelCell)).toContain("opus 4.8");
    // Honest omission (vitals-band precedent): no tokens cell, no elapsed cell.
    expect(findByClass(instruments, "ri-tokens")).toBeNull();
    expect(findByClass(instruments, "ri-elapsed")).toBeNull();
    const text = textOf(instruments);
    expect(text).not.toContain("%");            // no invented percentage
    expect(text).not.toContain("not reported"); // cell omitted, never faked as text
  });

  /* The head guard (0f9c643) covered one surface out of two: the drawer omitted
     the model for an agent carrying "<synthetic>" while the row behind it printed
     the placeholder in the very slot a model name goes (evidence: e024422, two
     screenshots of one archived Claude session). The row's own precedent for an
     absent model is the words "not reported"; a placeholder is absence, so it
     takes that path rather than being echoed back as a name. */
  test("(b2) a collector placeholder reads as an absent model, not as a model name", () => {
    for (const placeholder of ["<synthetic>", "unknown"]) {
      const masked = agent({
        provider: "claude",
        model: placeholder,
        tokens: { provenance: "observed", scope: "latest-turn", total: 40000, contextWindow: 200000 },
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const row: any = withDom(() => M.renderAgentRow(masked, program));
      const modelCell = findByClass(row, "ri-model");
      expect(modelCell).not.toBeNull();
      expect(textOf(modelCell)).not.toContain(placeholder);
      expect(textOf(modelCell)).toContain("not reported");
      // The measured context percentage is real and now lives in its own Ctx column.
      const ctxCell = findByClass(row, "ri-ctx");
      expect(ctxCell).not.toBeNull();
      expect(textOf(ctxCell)).toContain("20%");
    }
  });

  test("(c) naming noise leaves the row while terminal context folds to title and aria", () => {
    const rowSrc = source.match(/function renderAgentRow\(agent, program, opts = \{\}\) \{[\s\S]*?\n\}/)?.[0];
    expect(rowSrc).toBeDefined();
    // The visible "terminal: " / "source: " / "cwd differs" text tags are gone
    // from the row output path (they now live in the drawer + tooltip only).
    expect(rowSrc).not.toContain('"terminal: " + terminal');
    expect(rowSrc).not.toContain('"source: " + sourceName');
    expect(rowSrc).not.toContain('" · cwd differs"');
    // De-noised detail is reused from the drawer's helper, not re-forked.
    expect(rowSrc).toContain("fullSourceDetail(agent)");
    // Executed: different directories add no warning mark or visible naming prose.
    const separate = agent({
      target: { resolution: "exact", surfaceId: "s1", workspaceId: "w1", cwdRelation: "different", workspaceTitle: "ridge-term" },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const row: any = withDom(() => M.renderAgentRow(separate, program));
    expect(findAll(row, (node) => node.attributes?.role === "img")).toHaveLength(0);
    expect(row.attributes.title).toBe("Terminal: ridge-term");
    expect(textOf(row)).not.toContain("cwd differs");
    expect(textOf(row)).not.toContain("terminal:");
    // A same-directory session stays equally free of source marks.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const calmRow: any = withDom(() => M.renderAgentRow(agent(), program));
    expect(findAll(calmRow, (node) => node.attributes?.role === "img")).toHaveLength(0);
  });

  test("(c2) watch-only rows carry a dot instead of an Access column, and only when it informs", () => {
    // The Access column was dropped with the instrument cluster (9d79c76) and left
    // control state visible only to screen readers. These assertions pin the
    // replacement: a dot where control is genuinely unavailable, silence where a
    // dot on every row would say nothing. Each case states WHY it renders or not,
    // so weakening the suppression rule fails here instead of shipping row noise.
    const reachable = { controlHealth: { cmuxReachable: true, errors: [], staleSources: [] } };
    const unreachable = { controlHealth: { cmuxReachable: false, errors: ["cmux discovery failed"], staleSources: [] } };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const previousSnap = (M.state as any).snap;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const dotFor = (overrides: Record<string, unknown>, snap: unknown): any => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (M.state as any).snap = snap;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const row: any = withDom(() => M.renderAgentRow(agent(overrides) as any, program));
      return findByClass(row, "control-dot");
    };
    try {
      // Controllable session: nothing to warn about, so no mark.
      expect(dotFor({ controlState: "linked" }, reachable)).toBeNull();

      // Watch-only while control DOES work elsewhere — the informative case.
      const watch = dotFor({ controlState: "observed-only" }, reachable);
      expect(watch).not.toBeNull();
      expect(watch.className).toContain("is-observed");
      // The sentence must survive somewhere reachable, since the column is gone.
      expect(watch.attributes["aria-label"]).toContain("Watch only");
      expect(watch.attributes.title).toBeTruthy();

      // cmux unreachable: the header already reports controls offline fleet-wide,
      // so marking every row would restate it N times. Must stay silent.
      expect(dotFor({ controlState: "observed-only" }, unreachable)).toBeNull();

      // An ended session is uncontrollable by definition — not news.
      // "stale" and "archived" are the two statuses deriveActivity maps to ended.
      expect(dotFor({ controlState: "observed-only", status: "stale" }, reachable)).toBeNull();
      expect(dotFor({ controlState: "observed-only", status: "archived" }, reachable)).toBeNull();

      // Quarantine is a real, fixable identity conflict: always marked, and it
      // must survive cmux being unreachable, unlike plain watch-only.
      for (const snap of [reachable, unreachable]) {
        const quarantined = dotFor({ controlState: "quarantined" }, snap);
        expect(quarantined).not.toBeNull();
        expect(quarantined.className).toContain("is-quarantined");
        expect(quarantined.attributes["aria-label"]).toContain("quarantined");
      }

      // Both inks exist and differ, so the dot's meaning is carried by more than
      // position in the row.
      expect(styles).toContain(".control-dot.is-observed");
      expect(styles).toContain(".control-dot.is-quarantined");
    } finally {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (M.state as any).snap = previousSnap;
    }
  });

  test("(d) the column header names the promoted instrument columns", () => {
    expect(source).toContain("function renderAgentColumnHeader()");
    // The Access column stays dropped — the row dot above is its replacement.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const noAccess: any = withDom(() => M.renderAgentColumnHeader());
    expect(textOf(noAccess)).not.toContain("Access");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const header: any = withDom(() => M.renderAgentColumnHeader());
    const text = textOf(header);
    for (const label of ["Agent", "Status", "Model", "Tokens", "Quiet"]) {
      expect(text).toContain(label);
    }
  });

  test("(e) alert washes pair their tint with a state-colored edge rail (Rule 1 — indicator inks, not flood fills)", () => {
    // WS-C audit finding: is-needs-you / is-blocked / is-failed carried a soft tint
    // but NO colored rail. Codified open-q2 threshold: a ≤10% tint must always ride
    // WITH a status-colored edge mark. Assert each alert modifier now sets one.
    for (const mod of ["is-needs-you", "is-blocked", "is-failed"]) {
      const rail = styles.match(
        new RegExp(`\\.agent-row\\.${mod}[^\\n{]*\\{[^}]*box-shadow:[^;}]*inset[^;}]*var\\(--color-status-danger\\)`),
      );
      expect(rail).not.toBeNull();
      // And the tint it rides with is still present (paired, not replaced).
      const tint = styles.match(new RegExp(`\\.agent-row\\.${mod}\\b[^\\n{]*\\{[^}]*background:[^;}]*color-mix`));
      expect(tint).not.toBeNull();
    }
  });

  test("(f) the CSS the removed row-fact / control-access helpers owned is gone and can't return", () => {
    // rowFact / contextFact / controlFact were deleted with the instrument-cluster
    // rewrite, so no element emits their classes anymore. Guard both the emitters
    // (app.js) and the now-dead rules (styles) so neither silently comes back.
    for (const cls of ["row-fact", "control-access"]) {
      expect(source).not.toContain(cls);
    }
    for (const rule of [".row-fact {", ".row-fact-value {", ".fact-control {", ".control-access {", ".control-icon {"]) {
      expect(styles).not.toContain(rule);
    }
    // The live neighbours the cleanup must NOT touch stay put.
    expect(styles).toContain(".tm-track { fill: var(--line); }");            // SVG meter fill, shared
    expect(styles).toContain(".drawer-session-process");                    // drawer ribbon status, distinct selector
  });

  test("(g) keyboard focus survives the alert rails — each alert state combines its rail with the focus ring", () => {
    // The alert rails `.agent-row.is-needs-you:not(.is-selected)` (and -blocked /
    // -failed) sit at (0,3,0) on the SAME box-shadow property as the (0,2,0)
    // :focus-visible ring, so on exactly the alert rows the rail clobbered the ring
    // and keyboard focus went invisible. The fix is a :focus-visible variant per
    // alert state (0,4,0) that combines BOTH shadow layers — rail + inset ring.
    for (const [mod, ink] of [["is-needs-you", "--needs"], ["is-blocked", "--blocked"], ["is-failed", "--failed"]]) {
      const rule = styles.match(
        new RegExp(`\\.agent-row\\.${mod}:not\\(\\.is-selected\\):focus-visible\\s*\\{[^}]*\\}`),
      )?.[0] ?? "";
      expect(rule).not.toBe("");
      // Both components present: the semantic danger 4px rail AND the named
      // Formic focus ring. The rail remains the first shadow layer so state is
      // not erased when keyboard focus arrives.
      expect(rule).toContain("inset 4px 0 var(--color-status-danger)");
      expect(rule).toContain("var(--color-focus-ring)");
    }
  });

  /* ROW DIET. The terminal breadcrumb used to ride .row-identity-tags on every
     linked row. It is a true fact and a useful one, and it is not a control-
     safety signal — knowing which pane Focus opens does not change whether an
     instruction is safe to send. It moved into the drawer, and these assert
     BOTH halves of that move: gone from the row, present in Evidence, and still
     spoken to a screen reader. */

  /* dtdd appends a <dd>'s value as a bare string, and this block's fake `append`
     stores it verbatim rather than wrapping it in a text node — so the shared
     textOf, which only walks nodes, cannot see it. Read both. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const deepText = (node: any): string => {
    if (node == null) return "";
    if (typeof node === "string") return node;
    if (node.nodeType === 3) return String(node.textContent ?? "");
    let out = typeof node.textContent === "string" ? node.textContent : "";
    for (const kid of node.children ?? []) out += deepText(kid);
    return out;
  };
  // A session with nothing to declare: fresh, unnamed role, no policy, no pane.
  const clean = (over: Record<string, unknown> = {}) =>
    agent({ role: "agent", updatedAt: new Date().toISOString(), ...over });
  test("(h) the terminal breadcrumb is off the row and in the drawer, deduped against the name", () => {
    const linked = clean({
      displayName: "ridge-term",
      target: { resolution: "exact", surfaceId: "s1", workspaceId: "w1", workspaceTitle: "ridge-term", surfaceCwd: "/Users/emilio/Developer/deep-ridge" },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const row: any = withDom(() => M.renderAgentRow(linked, program));
    expect(findByClass(row, "row-terminal")).toBeNull();
    // Not deleted — spoken. A quieter row must not be a row that tells a screen
    // reader less than it used to.
    expect(row.attributes["aria-label"]).toContain("Terminal: deep-ridge");

    // Same value, same dedupe rule, now in the Evidence shelf.
    const facts = deepText(withDom(() => M.renderRowFacts(linked)));
    expect(facts).toContain("deep-ridge");
    expect(facts).toContain("terminal");

    // When the shown name is NOT the terminal title (here a home-cwd orch parked
    // in a project-titled pane, so agentName keeps its own identity), both the
    // workspace title and the pane folder survive as distinct destination info.
    const twoPart = clean({
      nickname: "Scout",
      cwd: "/Users/emilio",
      target: { resolution: "unique-cwd", surfaceId: "s2", workspaceId: "w2", workspaceTitle: "CODEX · platform", surfaceCwd: "/srv/app/web", cwdRelation: "different" },
    });
    expect(deepText(withDom(() => M.renderRowFacts(twoPart)))).toContain("CODEX · platform · web");

    // Ambiguous / missing targets resolve no safe destination — nothing to say,
    // so nothing is said, on the row or in the drawer.
    for (const res of ["ambiguous", "missing"]) {
      const unlinked = clean({ target: { resolution: res, workspaceTitle: "ghost", surfaceCwd: "/x/y" } });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const r: any = withDom(() => M.renderAgentRow(unlinked, program));
      expect(findByClass(r, "row-terminal")).toBeNull();
      expect(r.attributes["aria-label"]).not.toContain("Terminal:");
    }
  });

  test("(h2) the role chip left the row; the model-policy chip left the product", () => {
    const off = clean({
      role: "verifier",
      // A legacy record may still carry the field the policy deletion removed;
      // nothing on the row, in the aria-label, or in the drawer may speak it.
      modelPolicy: { state: "violation", summary: "Running opus where the policy says grok" },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const row: any = withDom(() => M.renderAgentRow(off, program));
    expect(findByClass(row, "policy-chip")).toBeNull();
    expect(findByClass(findByClass(row, "row-identity-tags"), "role-chip")).toBeNull();
    // The role still reaches a screen reader from the row itself…
    expect(row.attributes["aria-label"]).toContain("Role:");
    // …the policy verdict does not — it was removed, not relocated.
    expect(row.attributes["aria-label"]).not.toContain("Model mismatch");
    // The role belongs to the command header identity line; Evidence is reserved
    // for provenance. The policy verdict is nowhere, drawer included.
    const evidence = deepText(withDom(() => M.renderEvidence(off)));
    expect(evidence).not.toContain("Running opus where the policy says grok");
    expect(evidence).not.toContain("Role:");
    const pane = newNode("div");
    withDom(() => M.renderAgentDrawer(pane, { kind: "agent", agent: off, program }));
    expect(textOf(byClass(pane, "drawer-session-eyebrow"))).toContain("Verifier");

    // The control-safety dot stays because it changes what the operator can do.
    const risky = clean({
      controlState: "quarantined",
      target: { resolution: "ambiguous" },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const riskyRow: any = withDom(() => M.renderAgentRow(risky, program));
    expect(findByClass(riskyRow, "control-dot")).not.toBeNull();
  });

  test("(h3) a clean session's drawer gains nothing from the diet", () => {
    // Omit-empty, the same rule the rest of Evidence follows: a row with none of
    // these facts must not grow an empty block explaining that it has none.
    expect(withDom(() => M.renderRowFacts(clean()))).toBeNull();
  });

  test("(i) the Focus dock button title previews the destination (terminal + pane cwd)", () => {
    const linked = agent({
      target: { resolution: "exact", surfaceId: "s1", workspaceId: "w1", workspaceTitle: "ridge-term", surfaceCwd: "/Users/emilio/Developer/deep-ridge" },
    });
    expect(M.focusDestinationHint(linked)).toBe("Jump to ridge-term · /Users/emilio/Developer/deep-ridge");
    // No resolved destination falls back to the generic label, never a broken one.
    expect(M.focusDestinationHint(agent({ target: { resolution: "missing" } }))).toBe("Jump to terminal pane");
    // The dock tool wires the hint through for the focus action only.
    const toolSrc = source.match(/function renderDockTool\([\s\S]*?\n\}/)?.[0];
    expect(toolSrc).toContain('action === "focus" ? focusDestinationHint(agent) : label');
  });

  test("(k) the staleness fact keeps its exact threshold, and reports it from the drawer", () => {
    // Threshold is exact: 10 min. Only running/waiting (working/idle) rows qualify.
    const now = Date.parse("2026-07-22T03:00:00.000Z");
    const at = (min: number) => new Date(now - min * 60_000).toISOString();
    // Pure-function contract (nowMs injected so no wall-clock flake). Unchanged
    // by the diet: what moved is where it is printed, not when it is true.
    expect(M.rowStalenessText(agent({ status: "running", updatedAt: at(9) }), now)).toBe("");
    expect(M.rowStalenessText(agent({ status: "running", updatedAt: at(15) }), now)).toBe("updated 15m ago");
    expect(M.rowStalenessText(agent({ status: "waiting", updatedAt: at(42) }), now)).toBe("updated 42m ago");
    // Ended rows never go "stale" — they are done, not quiet.
    expect(M.rowStalenessText(agent({ status: "archived", updatedAt: at(120) }), now)).toBe("");
    // Missing timestamp is honestly silent, never a fabricated age.
    expect(M.rowStalenessText(agent({ status: "running", updatedAt: undefined }), now)).toBe("");

    const stale = agent({ status: "running", updatedAt: new Date(Date.now() - 20 * 60_000).toISOString() });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const row: any = withDom(() => M.renderAgentRow(stale, program));
    expect(findByClass(row, "row-stale")).toBeNull();
    // Still spoken, and the drawer ribbon carries the same live age;
    // Evidence no longer repeats it as a provenance fact.
    expect(row.attributes["aria-label"]).toContain("Quiet: updated");
    const pane = newNode("div");
    withDom(() => M.renderAgentDrawer(pane, { kind: "agent", agent: stale, program }));
    expect(textOf(byClass(pane, "drawer-session-age"))).toContain("ago");
    expect(byClass(pane, "drawer-session-age")?.dataset?.ago).toBe(stale.updatedAt);
    expect(deepText(withDom(() => M.renderEvidence(stale)))).not.toContain("quiet since");

    // A fresh running row says nothing anywhere — silence is still earned.
    const fresh = clean({ status: "running" });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const freshRow: any = withDom(() => M.renderAgentRow(fresh, program));
    expect(freshRow.attributes["aria-label"]).not.toContain("Quiet:");
    expect(withDom(() => M.renderRowFacts(fresh))).toBeNull();
  });

  test("(l) the four chips the diet removed leave no dead rules behind", () => {
    /* A rule with no emitter poisons grep: the next reader edits .row-terminal,
       finds something authoritative-looking, and changes nothing. The general
       orphan lint below catches this too; naming the four here says which
       removal it is about. */
    for (const gone of [".row-terminal", ".row-stale", ".policy-chip"]) {
      expect(styles.includes(gone), gone).toBe(false);
    }
    // .role-chip survives — the drawer's roster still emits it.
    expect(styles).toContain(".role-chip");
    expect(source).toContain('class: "role-chip role-"');
  });
});

describe("operations canvas layout", () => {
  test("the desktop shell shares one 1680px content frame", () => {
    expect(styles).toContain("--frame: min(1680px, calc(100vw - 64px))");
    const framed = styles.match(/max-width:\s*var\(--frame\)/g) ?? [];
    expect(framed.length).toBeGreaterThanOrEqual(5);
    expect(styles).not.toContain("--maxw");
  });

  test("workboard + inspector share app-body as sibling instruments", () => {
    expect(html).toContain('class="ops-stage"');
    const stageIdx = html.indexOf('class="ops-stage"');
    const mainIdx = html.indexOf('id="main"');
    const inspectorIdx = html.indexOf('id="inspector"');
    expect(stageIdx).toBeGreaterThan(-1);
    expect(stageIdx).toBeLessThan(mainIdx);
    expect(mainIdx).toBeLessThan(inspectorIdx);
    expect(styles).toContain(".ops-stage");
    expect(html).toMatch(/<\/main>\s*<\/div>\s*<aside id="inspector"/);
    expect(styles).toMatch(/\.app-body\s*\{[^}]*display:\s*grid/);
    expect(styles).toMatch(/body\.inspector-open \.app-body\s*\{[^}]*grid-template-columns:\s*clamp\(380px, 40%, 760px\) minmax\(0, 1fr\)/);
    expect(styles).toMatch(/\.pane-inspector\s*\{[^}]*border:\s*1px solid var\(--line-strong\)/);
    expect(styles).toMatch(/\.pane-inspector\s*\{[^}]*box-shadow:\s*var\(--shadow-soft\)/);
  });

  test("the summary strip never grows its own findings ledger or triage chrome", () => {
    expect(source).toContain("function pulseStripModel(");
    expect(source).toContain("renderTriage(issue)");
    // The strip must not grow Generate-triage chrome; the drawer keeps it.
    expect(source).not.toContain('class: "signal-primary"');
    expect(source).not.toContain('class: "signal-title-btn"');
    /* The inline findings ledger under the summary strip is GONE (2026-08-05).
       Attention routes through the masthead Notifications control and per-row
       marks on the board instead, so nothing may rebuild a row list here. */
    expect(source).not.toContain("function renderFindingRow(");
    expect(source).not.toContain("function renderPulseFindings(");
    expect(html).not.toContain('id="pulse-findings"');
    /* S2-T1 finished the job the ledger removal started. The two finding LINKS
       that replaced the ledger are gone too, and the rule is now absolute
       rather than bounded: THE HEADER NEVER LINKS. A reading that routes
       somewhere is a to-do wearing a metric's clothes, and while one existed
       the operator had two places to look for the same finding. */
    expect(source).not.toContain('class: "reading-finding-link"');
    expect(source).not.toContain('selectEntity({ kind: finding.kind, id: finding.id })');
    expect(styles).not.toContain(".reading-finding-link");
    // No summary widget routes anywhere at all — asserted over the whole rail.
    const rail = source.slice(source.indexOf("function renderSummaryWidget("));
    expect(rail.slice(0, rail.indexOf("\n}\n"))).not.toContain("selectEntity(");
  });

  test("the inspector/drawer holds a stable 480-520px desktop pane, no 42vw overshoot", () => {
    expect(styles).toContain("--inspector-w: clamp(480px, 32vw, 520px)");
    expect(styles).not.toContain("clamp(38rem, 42vw, 60rem)");
    expect(styles).not.toContain("grid-template-columns: minmax(0, 1fr) minmax(0, 1fr)");
  });

  test("below 1024px the inspector becomes a full-surface drawer and keeps the workboard wide", () => {
    expect(styles).toContain("@media (max-width: 1024px)");
    /* Health rail v2 adds a 900px compact ribbon breakpoint (mockup contract);
       the inspector full-surface drawer remains owned by the 1024px query. */
    const after = styles.slice(styles.indexOf("@media (max-width: 1024px)"));
    const block = after.slice(0, after.indexOf("@media (max-width: 900px)"));
    expect(block).toContain(".pane-inspector");
    expect(block).toContain("position: fixed");
    expect(block).toContain("inset: 0");
    expect(block).toContain("min-height: 44px");
  });

  test("the full-width strip cannot introduce horizontal overflow", () => {
    expect(styles).toMatch(/body\s*\{[\s\S]*?overflow-x:\s*hidden/);
  });

  test("a Degraded verdict names its reason and exposes the existing refresh action", () => {
    const degraded = snapshot({
      issues: [
        { id: "system:2", kind: "system", severity: "warning", title: "Stale source", summary: "s", affectedAgentIds: [] },
        { id: "system:1", kind: "system", severity: "error", title: "CMUX control is degraded", summary: "s", affectedAgentIds: [] },
      ],
    });
    expect(M.topSourceIssue(degraded)?.title).toBe("CMUX control is degraded");
    expect(M.topSourceIssue(snapshot())).toBeNull();
    /* S2-T2 moved the reason and the refresh OUT of the card and into the
       notification center's instrument block. The claim is unchanged — a
       degraded verdict must name what is wrong and expose the one control that
       can fix it — only the surface that owns it moved, because a control
       inside a confidence reading is the header doing attention's job. */
    expect(source).toContain("function renderInstrumentBlock()");
    expect(source).toContain("topSourceIssue(state.snap)");
    expect(source).toContain('dataset: { fkey: "degraded-refresh" }');
    expect(source).toContain("onclick: () => recollectSnapshot()");
    expect(styles).toContain(".notify-instrument");
    // …and it is gone from the card, where it used to live.
    const card = source.slice(source.indexOf("function renderSummaryWidget("));
    expect(card.slice(0, card.indexOf("\n}\n"))).not.toContain("recollectSnapshot()");
  });

  test("the degraded Refresh forces a fresh recollect, not a cache re-serve, and never dead-ends", async () => {
    // B1 built POST /api/recollect but the UI never consumed it: the button re-served
    // cache via fetchSnapshot. It now POSTs a fresh collection and applies the result
    // through fetchSnapshot's own apply path; a non-OK envelope (e.g. 500
    // RECOLLECT_FAILED) falls back to fetchSnapshot so Refresh is never a dead button.
    // W4-B: was six source substrings that could not fail if the button went
    // back to a GET. Driven now: the request it makes, the snapshot it adopts,
    // and the fallback that keeps it from dead-ending.
    const fresh = snapshot({ generatedAt: "2026-07-22T04:00:00.000Z" });
    await withState({ snap: null, conn: "live", fetchFailed: true }, async () => {
      await withRequests([{ status: 200, json: fresh }], async (calls) => {
        await M.recollectSnapshot();
        expect(calls.map((c) => [c.method, c.url])).toEqual([["POST", "/api/recollect"]]);
        expect(M.state.snap.generatedAt).toBe(fresh.generatedAt);
        expect(M.state.fetchFailed).toBe(false);
      });
    });

    // A refused recollect must still re-serve the cache, not leave a dead button.
    await withState({ snap: null, conn: "live", fetchFailed: false }, async () => {
      await withRequests([
        { status: 500, json: { ok: false, error: { code: "RECOLLECT_FAILED", message: "collector wedged" } } },
        { status: 200, json: fresh },
      ], async (calls) => {
        await M.recollectSnapshot();
        expect(calls.map((c) => [c.method, c.url]))
          .toEqual([["POST", "/api/recollect"], ["GET", "/api/snapshot"]]);
        expect(M.state.snap.generatedAt).toBe(fresh.generatedAt);
      });
    });
  });

  test("the degraded reason names how long since the source was last healthy, and stays silent when never healthy", () => {
    const twelveMinAgo = new Date(Date.now() - 12 * 60_000).toISOString();
    const withHistory = snapshot({
      totals: {
        live: 1, tracked: 1, attention: 0, working: 1, idle: 0, history: 0,
        sourceHealth: {
          healthy: 1, degraded: 1, total: 2,
          byProvider: {
            codex: { healthy: true, lastHealthyAt: twelveMinAgo },
            claude: { healthy: false, lastHealthyAt: twelveMinAgo },
          },
        },
      },
    });
    // A degraded source with a known last-healthy moment names it (reuses agoText).
    expect(M.degradedSinceText(withHistory)).toBe(" · last healthy 12m ago");
    // Honest omission: a source that has NEVER been healthy says nothing extra —
    // "never seen healthy" would be a lie.
    const neverHealthy = snapshot({
      totals: {
        live: 1, tracked: 1, attention: 0, working: 1, idle: 0, history: 0,
        sourceHealth: {
          healthy: 1, degraded: 1, total: 2,
          byProvider: {
            codex: { healthy: true, lastHealthyAt: twelveMinAgo },
            claude: { healthy: false, lastHealthyAt: null },
          },
        },
      },
    });
    expect(M.degradedSinceText(neverHealthy)).toBe("");
    // No per-provider source health at all → no suffix (default fixture omits it).
    expect(M.degradedSinceText(snapshot())).toBe("");
  });

  test("live re-render preserves focus via the stable fkey restore loop", () => {
    expect(source).toContain("document.activeElement.dataset");
    expect(source).toContain("node.focus({ preventScroll: true })");
    expect(source).toContain('document.getElementById("agent-" + id)');
  });
});

describe("source hygiene", () => {
  test("no literal control bytes in the client source", () => {
    // eslint-disable-next-line no-control-regex
    expect(source).not.toMatch(new RegExp("[\\u0000-\\u0008\\u000b\\u000c\\u000e-\\u001f]"));
  });

  test("meters use SVG geometry, never inline style, so the CSP holds", () => {
    // style-src 'self' forbids inline style attributes: no `style:` props at all.
    expect(source).not.toMatch(/\bstyle:\s*`/);
    expect(source).not.toContain("width:${");
    expect(source).toContain("function svgMeter(");
    expect(source).toContain("function svgSparkline(");
    expect(source).toContain("createElementNS");
    expect(source).toContain("function icon(");
  });

  test("the redesigned control surface exposes its structural anchors", () => {
    for (const id of ["health-rail", "filter-bar",
      "nest-beacon", "health-widgets", "customize-summary",
      "widget-customizer", "widget-options", "widget-reset"]) {
      expect(html).toContain(`id="${id}"`);
    }
    /* Two anchors LEFT this list, deliberately (operator directive,
       2026-08-05): the toolbar's Select-to-send and Action log buttons are gone.
       Pinned as absence rather than deleted from the test, because a button
       whose wiring calls $(id).addEventListener cannot half-exist — if the
       markup ever comes back without the wiring, or the wiring without the
       markup, boot() throws on null and takes the whole client down. */
    for (const id of ["select-toggle", "actions-toggle"]) {
      expect(html, `${id} was removed from the toolbar`).not.toContain(`id="${id}"`);
      expect(source, `${id} wiring must go with its button`).not.toContain(`$("${id}")`);
    }
    expect(html).toContain(">Board<span");
    expect(source).toContain("function renderWidgetCustomizer()");
    expect(source).toContain("onchange: (event) => setWidgetEnabled");
    expect(source).toContain('aria-label": `Move ${widget.label} up`');
    expect(html).not.toContain('class="colony"');
    expect(html).not.toContain('class="trail"');
    expect(html).not.toMatch(/class="ant /);
    expect(html).toContain('id="filter-bar" aria-label="Filters" hidden');
    expect(html).toContain('data-view="usage"');
    expect(html).toContain('id="usage-panel"');
    expect(source).toContain("function renderUsagePanel(");
    expect(source).toContain("setLookbackHours");
    expect(styles).not.toContain("@keyframes forage");
    expect(styles).not.toMatch(/\.colony\b/);
    expect(source).not.toContain('text: "Call tokens"');
    expect(source).not.toContain('+ " tok"');
  });

  test("reduced motion still disables the remaining interface transitions", () => {
    const reduced = styles.match(/@media \(prefers-reduced-motion: reduce\)\s*\{[\s\S]*?\n\}/)?.[0] ?? "";
    expect(reduced).toContain("animation: none");
    expect(reduced).toContain("transition: none");
  });

  test("base type stays readable and the parchment slop layer is gone", () => {
    expect(styles).toMatch(/body\s*\{[\s\S]*?font-size:\s*16px/);
    expect(styles).not.toContain("background-image: url");
  });

  test("the strip stacks to one cell per row on mobile; customization stays touch-sized", () => {
    const mobile = styles.match(/@media \(max-width: 720px\)\s*\{[\s\S]*?\n\}/)?.[0] ?? "";
    expect(mobile).toContain(".readings-grid .reading { border-right: 0; padding-right: 0.8rem; }");
    expect(mobile).toContain(".widget-options { grid-template-columns: 1fr; }");
    expect(mobile).toContain(".widget-option { min-height: 2.8rem; }");
    expect(mobile).toContain(".widget-move { width: 2.75rem; height: 2.75rem; }");
    expect(styles).toContain(".widget-move");
  });

  /* W4-B: was ten source substrings. They could not fail if a "Triage" click
     started a run, so the separation — the whole point of the read-only gate —
     is now asserted from the routes the buttons actually call. */
  test("interventions separate recommendation, queueing, and explicit read-only launch", async () => {
    const issue = { id: "system:x", kind: "system", severity: "error", title: "T", summary: "s", affectedAgentIds: [] };
    const plan = {
      issueId: issue.id, generatedAt: "2026-07-22T03:00:00.000Z", mode: "investigation",
      headline: "H", rationale: "R", affectedAgents: 2, affectedPrograms: 1, providers: ["codex"],
      evidence: [], steps: [{ title: "s1", detail: "d1" }], queueRecommended: true,
    };

    // Triage asks for a recommendation and NOTHING else runs.
    await withState({
      snap: snapshot({ issues: [issue] }), conn: "live",
      triage: new Map(), triagePending: new Set(), triageErrors: new Map(), queueItems: [],
    }, async () => {
      await withRequests([
        { status: 200, json: { ok: true, recommendation: { ...plan, queueRecommended: false } } },
      ], async (calls) => {
        await M.triageIssue(issue.id, "generate");
        expect(calls.map((c) => c.url)).toEqual(["/api/triage/generate"]);
        expect(calls[0]!.body).toEqual({ issueId: issue.id });
        expect(M.state.triage.get(issue.id).headline).toBe("H");
        expect(M.state.queueItems).toEqual([]);
      });
    });

    // Queueing is bounded and persistent; it still does not launch anything.
    await withState({
      snap: snapshot({ issues: [issue] }), conn: "live",
      triage: new Map([[issue.id, plan]]), triagePending: new Set(), triageErrors: new Map(), queueItems: [],
    }, async () => {
      await withRequests([
        { status: 200, json: { ok: true, item: { ...plan, id: "triage:" + issue.id, state: "queued", createdAt: plan.generatedAt } } },
        { status: 200, json: snapshot({ issues: [issue] }) },
        { status: 200, json: { ok: true, items: [{ ...plan, id: "triage:" + issue.id, state: "queued", createdAt: plan.generatedAt }] } },
      ], async (calls) => {
        await M.triageIssue(issue.id, "queue");
        expect(calls.map((c) => c.url)).toEqual(["/api/triage/queue", "/api/snapshot", "/api/triage/queue"]);
        expect(M.state.queueItems.map((i: any) => i.state)).toEqual(["queued"]);
      });
    });

    // Only the explicit Launch reaches /api/triage/run.
    await withState({
      snap: snapshot({ issues: [issue] }), conn: "live",
      triage: new Map([[issue.id, plan]]), triagePending: new Set(), triageErrors: new Map(),
      queueItems: [{ ...plan, id: "triage:" + issue.id, state: "queued", createdAt: plan.generatedAt }],
    }, async () => {
      await withRequests([
        { status: 200, json: { ok: true, item: { ...plan, id: "triage:" + issue.id, state: "running", createdAt: plan.generatedAt, runModel: "GPT-5.6 Luna · XHIGH · read-only" } } },
        { status: 200, json: snapshot({ issues: [issue] }) },
        { status: 200, json: { ok: true, items: [] } },
      ], async (calls) => {
        await M.triageIssue(issue.id, "run");
        expect(calls[0]!.url).toBe("/api/triage/run");
        expect(calls[0]!.method).toBe("POST");
      });
    });

    // No spawn/execute route was ever invented for this.
    expect(source).not.toMatch(/\/api\/triage\/(spawn|execute)/);
  });

  test("the ham-fisted Subdue/Show buttons and ticket ticker are gone", () => {
    expect(html).not.toContain("Subdue");
    expect(html).not.toContain("Show interventions");
    expect(html).not.toContain("Show advisories");
    expect(html).not.toContain('id="interventions-ticker"');
    expect(html).not.toContain('id="warnings-ticker"');
    expect(html).not.toContain('class="signal-collapse"');
    expect(source).not.toContain("function buildSignalTicker(");
    expect(source).not.toContain("SIGNAL_PANEL_STORAGE_KEY");
    expect(source).not.toContain("loadSignalPanels(");
    expect(styles).not.toContain("@keyframes signal-ticker-run");
    expect(styles).not.toContain(".signal-ticker");
    expect(styles).not.toContain(".signal-subdued");
  });

  test("resolved lifecycle beats a blocked queue row for the finding label", () => {
    const issue = {
      id: "system:cleared",
      kind: "system",
      severity: "warning",
      title: "Cleared advisory",
      summary: "Gone.",
      affectedAgentIds: [],
      lifecycle: { state: "resolved", openedAt: "2026-07-21T22:00:00.000Z", resolvedAt: "2026-07-21T23:00:00.000Z" },
    };
    const blockedQueue = [{ issueId: issue.id, state: "blocked", headline: "stale" }];
    expect(M.issueWorkState(issue, blockedQueue)).toEqual({
      key: "cleared", label: "Cleared", tone: "moss",
    });
    expect(M.issueStateLabel(issue)).toBe("Resolved");
    expect(M.issueStage(issue)).toBe(4);
  });

  test("live blocked findings still show Blocked, and a queued/running investigation moves an issue in motion", () => {
    const issue = {
      id: "system:live-blocked",
      kind: "system",
      severity: "warning",
      title: "Needs a decision",
      summary: "s",
      affectedAgentIds: [],
      lifecycle: { state: "open", openedAt: "2026-07-21T22:00:00.000Z" },
    };
    expect(M.issueWorkState(issue, [{ issueId: issue.id, state: "blocked", headline: "blocked" }])).toEqual({
      key: "blocked", label: "Blocked", tone: "error",
    });
    expect(M.issueStage("blocked")).toBe(3);
    expect(M.issueWorkState(issue, [{ issueId: issue.id, state: "running" }]).key).toBe("investigating");
    expect(M.issueWorkState(issue, [{ issueId: issue.id, state: "queued" }]).key).toBe("queued");
  });

  test("signal chrome uses techno-orchestra tokens, not hospital banner fills", () => {
    expect(styles).toContain('"Techno orchestra"');
    expect(styles).toContain("--signal-rail: 2px");
    /* The one surviving example of the rule the token exists for: severity is
       carried by an inked mark on a plain ground, never a filled banner. (It used
       to be `.glyph.act`, which left with the findings ledger.) */
    expect(styles).toMatch(/\.verdict-ok\s*\{\s*color:\s*var\(--moss\)/);
    expect(styles).not.toMatch(/#warnings-list\.signal-list\s*\{[^}]*background:\s*color-mix\(in srgb,\s*var\(--amber-soft\)/);
  });
});

describe("pulse strip — verdict-first summary", () => {
  test("the calm line carries the markup the strip depends on, and the verdict is a reading not a toggle", () => {
    /* NEEDS YOU reports a count and nothing else. It used to be the strip's one
       expansion control, opening an inline findings ledger in place; that surface
       is gone, so the number must not carry a disclosure it can no longer open. */
    expect(source).not.toContain("pulse-verdict");
    expect(source).not.toContain("state.pulseExpanded");
    /* The class now carries an is-watching modifier for the watch tier, so assert
       the contract (a live status region) rather than the literal attribute
       string, which was pinning a concatenation. */
    expect(source).toMatch(/class: "pulse-calm"[^,]*, role: "status"/);
    expect(source).toContain("function renderPulseCalm(");
    expect(source).toContain("function renderHealthRail(");
  });

  /* A dead /api/triage/queue answered with console.warn and nothing else.
     queueItems stayed [], which produces zero queue findings — indistinguishable
     from a genuinely empty queue — so the strip collapsed to CALM while triage
     work sat unseen on the server. An unreachable queue is not an empty one. */
  test("an unreachable triage queue is never mistaken for a calm board", () => {
    const clean = snapshot();
    expect(M.pulseStripModel(clean, "live", [], "percent", "").calm).toBe(true);

    const broken = M.pulseStripModel(clean, "live", [], "percent", "queue response was invalid");
    expect(broken.calm).toBe(false);         // cannot declare calm on partial evidence
    expect(broken.queueError).toBe("queue response was invalid");

    /* S2-T1 moved WHERE this is admitted, not whether. The Needs-you card
       carried it; that card is retired, and the header may not carry it now
       because the header never counts problems. The notification center does,
       because a short list is a fact about that list — and the strip refusing
       to go calm without saying why is precisely the apologising-without-a-
       reason failure this project keeps closing. */
    expect(broken.cells.some((c: { id: string }) => c.id === "needs-you")).toBe(false);
    const panel = M.notificationPanelModel(clean, [], Date.now(), {
      ...M.NOTIFY_DEPS, queueError: "queue response was invalid",
    });
    expect(panel.incomplete).toContain("Triage queue unavailable");
    expect(panel.incomplete).toContain("queue response was invalid");
    // An all-clear proof line cannot be shown over a population with a hole in it.
    expect(panel.proof).toBeNull();
    // A healthy queue says nothing extra — no permanent scold on a good board.
    expect(M.notificationPanelModel(clean, [], Date.now(), M.NOTIFY_DEPS).incomplete).toBe("");

    // A healthy queue says nothing extra — no permanent scold on a good board.
    /* A healthy queue on a clean board says nothing at all now: the cell is
       omitted rather than rendering "0 / No active findings". Absence IS the
       "no permanent scold" assertion this line was making. */
    expect(M.pulseStripModel(clean, "live", [], "percent", "").cells
      .find((c: { id: string }) => c.id === "needs-you")).toBeUndefined();
  });

  test("fetchTriageQueue records the failure instead of only warning", async () => {
    await withState({ queueItems: [], queueError: "" }, () =>
      withRequests([{ status: 500, json: { ok: false } }], async () => {
        await M.fetchTriageQueue();
        expect(M.state.queueError).not.toBe("");
      }));
    // A recovered fetch must clear it, or one blip scolds forever.
    await withState({ queueItems: [], queueError: "stale complaint" }, () =>
      withRequests([{ status: 200, json: { ok: true, items: [] } }], async () => {
        await M.fetchTriageQueue();
        expect(M.state.queueError).toBe("");
      }));
  });

  test("pulseStripModel collapses to calm only when nothing needs the operator", () => {
    expect(M.pulseStripModel(snapshot(), "live", []).calm).toBe(true);

    const withIssue = snapshot({
      issues: [{ id: "e", kind: "system", severity: "error", title: "t", summary: "s", affectedAgentIds: [] }],
    });
    expect(M.pulseStripModel(withIssue, "live", []).calm).toBe(false);

    const degradedControl = snapshot({ controlHealth: { cmuxReachable: false, lastCheckedAt: "", errors: [], staleSources: [] } });
    expect(M.pulseStripModel(degradedControl, "live", []).calm).toBe(false);

    const hotContext = snapshot({
      programs: [{
        id: "p", name: "P",
        agents: [agent({ tokens: { provenance: "observed", scope: "latest-turn", total: 190_000, contextWindow: 200_000 } })],
      }],
    });
    expect(M.pulseStripModel(hotContext, "live", []).calm).toBe(false); // 95% peak context is hot

    expect(M.pulseStripModel(null, "live", []).calm).toBe(false);
  });

  test("ordered findings put true interventions and advisories ahead of in-motion work", () => {
    const verifyingError = {
      id: "e-verifying", kind: "system", severity: "error", title: "Verifying error", summary: "s",
      affectedAgentIds: [],
      lifecycle: { state: "verifying", openedAt: "2026-07-22T05:00:00.000Z", verificationStartedAt: "2026-07-22T05:01:00.000Z" },
    };
    const openError = { id: "e-open", kind: "system", severity: "error", title: "Open error", summary: "s", affectedAgentIds: [] };
    const advisory = { id: "w-open", kind: "system", severity: "warning", title: "Open advisory", summary: "s", affectedAgentIds: [] };
    const snap = snapshot({ issues: [verifyingError, openError, advisory] });

    const model = M.pulseStripModel(snap, "live", []);
    expect(model.findings.map((f: { id: string }) => f.id)).toEqual(["e-open", "w-open", "e-verifying"]);
    expect(model.findings.map((f: { work: { key: string } }) => f.work.key)).toEqual(["needs", "watching", "verifying"]);

    /* S2-T1 moved where this claim is enforced. It used to be the needs-you
       top-2 sublabel: an in-motion error must never surface there, because that
       would contradict the strip's own "in motion" classification. The card is
       retired, and the notification center makes the same claim in a stronger
       form — a verifying finding with no live affected agent is not merely
       ranked below the open ones, it is demoted off the live surface entirely,
       with a stated reason. */
    const { live, demoted } = M.notificationCandidates(snap, [], Date.now(), M.NOTIFY_DEPS);
    expect(live.map((i: { id: string }) => i.id)).toEqual(["e-open", "w-open"]);
    expect(demoted.map((d: { id: string; reason: string }) => [d.id, d.reason]))
      .toEqual([["e-verifying", "verifying with no live affected agent"]]);
    // The header says nothing about any of them.
    expect(M.summaryWidgetData("needs-you", snap).findings).toBeUndefined();
  });

  test("orphan queue items referencing a resolved issue are excluded; live orphans are included", () => {
    const snap = snapshot({
      issues: [],
      recentlyResolved: [
        {
          id: "system:gone", kind: "system", severity: "error", title: "Gone", summary: "s",
          affectedAgentIds: [],
          lifecycle: { state: "resolved", openedAt: "2026-07-21T22:00:00.000Z", resolvedAt: "2026-07-21T23:00:00.000Z" },
        },
      ],
    });
    const model = M.pulseStripModel(snap, "live", [
      { issueId: "system:gone", state: "blocked", headline: "stale" },
      { issueId: "queue:orphan", state: "blocked", headline: "orphan investigation" },
    ]);
    expect(model.findings.map((f: { id: string }) => f.id)).toEqual(["queue:orphan"]);
  });

  test("the strip renders widgets with no board-level triage CTAs — triage stays drawer-only", () => {
    const summaryWidget = source.match(/function renderSummaryWidget\([\s\S]*?\n\}\n/)?.[0] ?? "";
    const pulseCalm = source.match(/function renderPulseCalm\([\s\S]*?\n\}\n/)?.[0] ?? "";
    expect(summaryWidget).toBeTruthy();
    expect(pulseCalm).toBeTruthy();
    for (const chunk of [summaryWidget, pulseCalm]) {
      expect(chunk).not.toContain("triageIssue(");
      expect(chunk).not.toContain('"Triage this finding"');
      expect(chunk).not.toContain('"Queue investigation"');
      expect(chunk).not.toContain("renderTriage(");
    }
  });

  test("strip CSS binds to the DOM app.js actually builds", () => {
    // The findings ledger is gone; its styling must not outlive it, or the next
    // reader takes 100 lines of dead row chrome for a live surface.
    expect(styles).not.toMatch(/#pulse-findings\s*\{/);
    expect(styles).not.toMatch(/\.finding\s*\{/);
    expect(styles).not.toMatch(/\.pulse-more\s*\{/);
    // app.js drops the one-shot pulse-cleared class on the rail, so the moss
    // wash must reach the calm line through the rail, not expect the class
    // on the (rebuilt-each-paint) calm line itself.
    expect(source).toContain('rail.classList.add("pulse-cleared")');
    expect(styles).toMatch(/\.health-rail\.pulse-cleared \.pulse-calm/);
    // svgSparkline emits only a viewBox (CSP: no inline styles); without a CSS
    // size the SVG falls back to the 300×150 default and breaks the calm line.
    expect(styles).toMatch(/\.pulse-spark\s*\{[^}]*width/);
  });
});

describe("state cards — two-line ledger rows, instrument brief, verdict result (mockups A2/B1/C1)", () => {
  test("strip findings carry the ledger row data: summary, evidence tokens, and an honest since", () => {
    const life = { state: "verifying", openedAt: "2026-07-23T03:00:00.000Z", verificationStartedAt: "2026-07-23T04:15:00.000Z" };
    const snap = snapshot({
      issues: [{
        id: "sys:1", kind: "system", severity: "warning", title: "Routing mismatch",
        summary: "4 ended Cursor sessions used a different model than expected.",
        affectedAgentIds: ["codex:a1"], lifecycle: life,
      }],
    });
    const model = M.pulseStripModel(snap, "live", []);
    const finding = model.findings[0];
    expect(finding.summary).toBe("4 ended Cursor sessions used a different model than expected.");
    // Evidence = program rollup tokens, derived from real affected agents.
    expect(finding.evidence).toEqual(["P · 1"]);
    // Verification start outranks openedAt; no timestamp means no fabricated age.
    expect(finding.since).toBe("2026-07-23T04:15:00.000Z");
    const bare = snapshot({ issues: [{ id: "sys:2", kind: "system", severity: "warning", title: "T", summary: "s", affectedAgentIds: [] }] });
    expect(M.pulseStripModel(bare, "live", []).findings[0].since).toBeNull();
  });

  test("routeFromBullet extracts evidence routing and refuses prose", () => {
    expect(M.routeFromBullet("`542577F9…` → `ttys003`")).toEqual({ from: "542577F9…", to: "ttys003" });
    expect(M.routeFromBullet("8C3BB027… -> ttys005")).toEqual({ from: "8C3BB027…", to: "ttys005" });
    // Prose containing an arrow mid-sentence, chained arrows, and empty sides stay bullets.
    expect(M.routeFromBullet("The launcher moved a → b and then failed on c")).toBeNull();
    expect(M.routeFromBullet("a → b → c")).toBeNull();
    expect(M.routeFromBullet("→ ttys003")).toBeNull();
    expect(M.routeFromBullet("x".repeat(130) + " → y")).toBeNull();
  });

  test("the plan renders as an always-visible spine — the details disclosure is gone", () => {
    const triage = source.match(/function renderTriage\([\s\S]*?\n\}\n/)?.[0] ?? "";
    expect(triage).toContain('"tri-spine"');
    expect(triage).toContain('"tri-band"');
    expect(triage).not.toContain("-step plan");
    // The band never invents instruments: model/effort/access appear only
    // when the launcher reported runModel.
    expect(triage).toContain("queueItem.runModel");
    /* FE-B: a reload mid-investigation must not regress to the Triage button —
       the queue item itself hydrates the recommendation. Asserted by rendering
       with an empty local triage map and only a queue row, as a reload leaves it. */
    const issue = { id: "system:1", kind: "system", severity: "error", title: "t", summary: "s", affectedAgentIds: [] };
    const queueItem = {
      issueId: "system:1", state: "running", headline: "Re-bind the quarantined sessions",
      mode: "investigate", rationale: "Two sessions share a terminal.",
      steps: [{ title: "Read", detail: "Inspect the trace." }],
      queueRecommended: true, runModel: "luna 5.6 · high", createdAt: "2026-07-28T01:00:00.000Z",
      startedAt: "2026-07-28T01:01:00.000Z",
    };
    const rendered = withDom(() => M.renderTriage(issue, triageUi({ queueItems: [queueItem] })));
    const text = textOf(rendered);
    expect(text).not.toContain("Triage this finding");
    expect(text).toContain("Re-bind the quarantined sessions");
    expect(byClass(rendered, "tri-spine")).not.toBeNull();
    // Both queue-row controls carry a data-fkey so focus survives a repaint.
    const keys = buttonsOf(rendered).map((b) => b.dataset.fkey);
    expect(keys).toContain("triage-queue:system:1");
    expect(keys.every(Boolean)).toBe(true);
  });

  test("state-card CSS binds to the DOM app.js builds, and the replaced chrome is gone", () => {
    for (const selector of [".tri-band", ".tri-spine", ".tri-dot", ".brf-head", ".brf-glyph",
      ".brf-routes", ".brf-route", ".brf-times"]) {
      expect(styles).toContain(selector);
    }
    for (const dead of [".triage-plan-head", ".triage-mode", ".triage-details", ".triage-steps",
      ".triage-briefing-kicker ",
      // The A2 ledger row and its indicator vocabulary left with the strip's
      // findings panel (2026-08-05); the drawer never used either.
      ".finding .lede", ".finding .meta", ".glyph.act", ".stage-rail"]) {
      expect(styles).not.toContain(dead);
    }
  });
});

describe("single lock narrative in the agent drawer", () => {
  test("the banner owns the lock reason; the dock meta never repeats it", () => {
    const dockStart = source.indexOf("function renderCommandDock(");
    const dockEnd = source.indexOf("\nfunction renderDockTool(", dockStart);
    const dock = source.slice(dockStart, dockEnd);
    expect(dock).not.toContain("Send disabled");
    expect(dock).not.toContain("Ready · linked");
    expect(dock).not.toContain("Enter to send");
    expect(dock).toContain("command-dock--linked");
    // Control feedback lives inside the dock, above the composer.
    expect(dock).toContain("control-feedback");
    expect(dock).not.toContain("command-dock-more");
    expect(styles).toContain(".command-dock--linked");
  });
});

describe("the command dock is grouped by what each control is for", () => {
  /* The dock used to be one undifferentiated row, so the only way to tell the
     destructive control from the safe ones was hue and position. It now reads as
     four named categories. Everything asserted here is about PRESENTATION: the
     capability list, the fkeys, the confirm gate and the enable/disable verdicts
     are the server's and are checked to be untouched by the regrouping. */
  const CAPS = [
    { action: "focus", enabled: true },
    { action: "instruct", enabled: true },
    { action: "interrupt", enabled: true },
    { action: "archive", enabled: true },
  ];
  /* SYNC-CF: `overrides` exists so a case can ask for a session with no close
     affordance. Close is not a ControlCapability — it is gated on the target
     resolution and on the board still watching the session — so a live agent
     with an exact target now carries a cluster tile no `controls` list mentions,
     and the cases below that are ABOUT the capability list say so explicitly. */
  const ENDED = { lifecycle: "finished", status: "archived" };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const dockFor = (controls: unknown[], control = "linked", overrides: Record<string, unknown> = {}): any =>
    withDom(() => M.renderCommandDock(agent({ controls, ...overrides }), control, null, []));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const groups = (dock: any) => allByClass(dock, "dock-group");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const labelsOf = (dock: any) => groups(dock).map((g: any) => textOf(byClass(g, "dock-group-label")));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const groupNamed = (dock: any, name: string) =>
    groups(dock).find((g: any) => g.attributes["aria-label"] === name) || null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fkeysOf = (node: any) =>
    findAll(node, (n: any) => n.dataset && n.dataset.fkey).map((n: any) => n.dataset.fkey);

  /* Composer modernization keeps Focus / Interrupt / Archive in ONE compact
     cluster, but demotes it below the primary message field as a secondary
     toolbar. Communicate keeps its named group; the Navigate/Operate/File
     kickers remain gone. Capabilities, fkeys, the confirm gate and the
     destructive-isolation disclosure are unchanged — only hierarchy moves. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const clusterOf = (dock: any) => byClass(dock, "command-dock-cluster");

  test("the composer keeps its group; the actions ride one secondary toolbar", () => {
    const dock = dockFor([...CAPS, { action: "unarchive", enabled: true }]);
    expect(labelsOf(dock)).toEqual(["Communicate"]);
    expect(fkeysOf(groupNamed(dock, "Communicate"))).toEqual(["draft:codex:a1", "act:codex:a1:instruct"]);
    expect(fkeysOf(clusterOf(dock))).toEqual([
      // SYNC-CF's close tile sits after Archive: the furthest-reaching verb last.
      "act:codex:a1:focus", "act:codex:a1:interrupt", "act:codex:a1:archive",
      "sync-close:codex:a1", "act:codex:a1:unarchive",
    ]);
    const toolbar = byClass(dock, "command-dock-secondary");
    expect(toolbar?.attributes.role).toBe("group");
    expect(toolbar?.attributes["aria-label"]).toBe("Secondary session actions");
    expect(clusterOf(dock)?.parent).toBe(toolbar);
  });

  test("the cluster is heard, not merely seen", () => {
    // Visual proximity is not a grouping a screen reader can report, so the
    // corner cluster carries role=group + aria-label, and the one remaining
    // labelled group keeps its announced-once discipline.
    const dock = dockFor([...CAPS]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cluster: any = clusterOf(dock);
    expect(cluster.attributes.role).toBe("group");
    expect(cluster.attributes["aria-label"]).toBe("Session actions");
    for (const group of groups(dock)) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const label: any = byClass(group, "dock-group-label");
      expect(group.attributes.role).toBe("group");
      expect(group.attributes["aria-label"]).toBe(textOf(label));
      expect(label.attributes["aria-hidden"]).toBe("true");
    }
  });

  test("clustering added no control and renamed no fkey; the composer leads paint order", () => {
    /* render() restores focus by data-fkey after every SSE repaint, so a key
       that is RENAMED is a drawer that silently drops focus — names are pinned.
       The paint order changed deliberately: the primary composer precedes the
       quiet secondary toolbar in tab order. */
    const dock = dockFor([...CAPS, { action: "unarchive", enabled: true }]);
    expect(fkeysOf(dock)).toEqual([
      "draft:codex:a1",
      "act:codex:a1:instruct",
      "act:codex:a1:focus",
      "act:codex:a1:interrupt",
      "act:codex:a1:archive",
      // SYNC-CF. The clustering claim above is unchanged — regrouping still adds
      // no control — and this key is a NEW capability arriving with its own
      // route, not a rename of one of the four the server advertises.
      "sync-close:codex:a1",
      "act:codex:a1:unarchive",
    ]);
    // Focus, Interrupt, Archive, Close terminal, Un-archive, Send — the labels are labels.
    expect(buttonsOf(dock).length).toBe(6);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(allByClass(dock, "dock-group-label").some((n: any) => n.dataset.fkey)).toBe(false);
  });

  test("an empty secondary row renders no cluster; an empty dock stays the hidden span", () => {
    // ENDED throughout: a finished session has no live terminal to close, so
    // these cases still measure the CAPABILITY list and nothing else.
    expect(labelsOf(dockFor([{ action: "instruct", enabled: true }], "linked", ENDED))).toEqual(["Communicate"]);
    expect(clusterOf(dockFor([{ action: "instruct", enabled: true }], "linked", ENDED))).toBeNull();
    // Focus alone: a cluster, no Communicate group.
    const focusOnly = dockFor([{ action: "focus", enabled: true }], "linked", ENDED);
    expect(labelsOf(focusOnly)).toEqual([]);
    expect(fkeysOf(clusterOf(focusOnly))).toEqual(["act:codex:a1:focus"]);
    // An un-archive the server refuses is not rendered anywhere.
    expect(fkeysOf(clusterOf(dockFor([{ action: "focus", enabled: true }, { action: "unarchive", enabled: false }], "linked", ENDED))))
      .toEqual(["act:codex:a1:focus"]);
    // And an agent the server offers nothing for is still the hidden span.
    const none = dockFor([]);
    expect(none.hasAttribute("hidden")).toBe(true);
    expect(groups(none).length).toBe(0);
  });

  test("Archive is a peer tile of Focus and Interrupt, linked or locked", () => {
    /* A one-item overflow menu is not a hierarchy — it is a click trap.
       Archive stays a 44px tile; the confirm strip still isolates the
       destructive step. */
    const dock = dockFor([
      { action: "focus", enabled: false },
      { action: "instruct", enabled: false },
      { action: "interrupt", enabled: false },
      { action: "archive", enabled: true },
    ], "observed-only");

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cluster: any = clusterOf(dock);
    expect(byClass(cluster, "command-dock-more")).toBeNull();
    expect(byFkey(cluster, "act:codex:a1:archive")?.attributes?.["aria-label"]).toBe("Archive");

    const archiveKey = "act:codex:a1:archive";
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const isArchive = (n: any) => n.dataset && n.dataset.fkey === archiveKey;
    expect(findAll(dock, isArchive).length).toBe(1);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const focus: any = byFkey(cluster, "act:codex:a1:focus");
    expect(focus.hasAttribute("disabled")).toBe(true);

    const open = dockFor([...CAPS]);
    expect(byClass(clusterOf(open), "command-dock-more")).toBeNull();
    expect(byFkey(clusterOf(open), archiveKey)).not.toBeNull();
  });

  test("Interrupt still arms its confirm strip, inside the cluster", async () => {
    await withState({ confirming: "act:codex:a1:interrupt" }, () => {
      const dock = dockFor([...CAPS]);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const strip: any = byClass(clusterOf(dock), "command-confirm");
      expect(strip).not.toBeNull();
      expect(textOf(strip)).toContain("Interrupt?");
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect(buttonsOf(strip).map((b: any) => textOf(b))).toEqual(["Confirm", "Cancel"]);
      // Arming Interrupt does not disturb the composer group.
      expect(labelsOf(dock)).toEqual(["Communicate"]);
    });
  });

  test("the cluster CSS binds to what the dock builds, and the old spacer is gone", () => {
    for (const selector of [".command-dock-cluster", ".command-dock-secondary", ".dock-group-label"]) {
      expect(styles).toContain(selector);
    }
    expect(styles).not.toContain(".command-dock-corner");
    // The retired category row went with its emitters — a dead rule here is a
    // rule someone will later read as authoritative.
    for (const gone of [".command-dock-actions", ".dock-group--file", ".command-dock-tools"]) {
      expect(styles).not.toContain(gone);
    }
    /* The flex spacer that used to hold Archive away from Focus and Interrupt.
       That separation now belongs to the File cluster, so neither the element
       nor its rule may linger — a dead rule here is a rule someone will later
       read as authoritative. */
    expect(source).not.toContain("command-dock-spacer");
    expect(styles).not.toContain(".command-dock-spacer");
  });

  test("the dock stays two visual rows with mobile-safe controls", () => {
    expect(styles).toMatch(/\.command-dock > \.dock-group > \.dock-group-label\s*\{[^}]*position:\s*absolute/);
    expect(styles).toMatch(/\.command-composer\s*\{[^}]*border-radius:\s*var\(--radius-md\)/);
    expect(styles).toMatch(/\.command-send\s*\{[^}]*width:\s*44px/);
    expect(styles).toMatch(/\.command-dock-cluster \.dock-tool\s*\{[^}]*min-height:\s*44px/);
    expect(styles).not.toContain(".command-dock-more");
    expect(styles).toMatch(/\.drawer-chat > \.drawer-controls-strip\s*\{[^}]*env\(safe-area-inset-bottom\)/);
    expect(styles).not.toContain(".command-dock-hint");
    expect(styles).not.toContain(".command-dock-ready");
  });
});

describe("investigation briefings lead with one wired action", () => {
  /* W4-B: was six source substrings that could not fail if the CTA stopped
     being rendered. Driven now through renderTriage, which is how a finished
     investigation actually reaches the drawer. */
  test("blocked and verifying results expose a primary button, not prose only", () => {
    const issue = { id: "system:x", kind: "system", severity: "error", title: "T", summary: "s", affectedAgentIds: [] };
    const item = (state: string, result: string) => ({
      issueId: issue.id, id: "triage:system:x", generatedAt: "2026-07-22T03:00:00.000Z",
      mode: "investigation", headline: "H", rationale: "R", affectedAgents: 1, affectedPrograms: 1,
      providers: ["codex"], evidence: [], steps: [{ title: "s1", detail: "d1" }],
      queueRecommended: true, createdAt: "2026-07-22T03:00:00.000Z",
      startedAt: "2026-07-22T03:01:00.000Z", completedAt: "2026-07-22T03:09:00.000Z",
      state, result,
    });
    const render = (state: string, result: string) => withDom(() => M.renderTriage(
      issue, triageUi({ queueItems: [item(state, result)], triage: new Map([[issue.id, item(state, result)]]) })));

    // Blocked: the operator gets a lever, not a paragraph to read and abandon.
    const blocked = render("blocked", "Blocker: the cmux socket password is missing, so nothing could be probed.");
    expect(buttonsOf(blocked).map((b: any) => textOf(b))).toContain("Retriage from evidence");
    // Completed: the next act is confirming the finding actually cleared.
    const done = render("completed", "Root cause: two sessions shared one TTY. Repair applied.");
    expect(buttonsOf(done).map((b: any) => textOf(b))).toContain("Check source now");

    // The briefing is capped — a wall of bullets is prose again. Ten bullets in,
    // at most three reach the body, and the count is stated rather than dropped.
    const raw = ["Findings:", ...Array.from({ length: 10 }, (_, index) => `- bullet ${index}`)].join("\n");
    const many = render("completed", raw);
    const shown = allByClass(many, "triage-briefing-list")
      .flatMap((list: any) => list.children)
      .filter((item: any) => textOf(item).startsWith("bullet ")).length;
    expect(shown).toBeLessThanOrEqual(3);
    expect(shown).toBeGreaterThan(0);
    // Capping the body must never DROP evidence: the full text is still there.
    expect(textOf(many)).toContain(raw);
  });
});

describe("fail-loud control invariants (source-level)", () => {
  /* W4-B: was `expect(source).toContain('const NEEDS_CONFIRM = ...')`, which
     could not fail if the gate were removed from the click handler. Now the
     real dock tool is clicked and the real sendControl is watched. */
  test("interrupt and archive require explicit confirmation", async () => {
    const target = agent({ controls: [{ action: "interrupt", enabled: true }, { action: "focus", enabled: true }] });
    const snap = snapshot({ programs: [{ id: "p", name: "P", agents: [target] }] });

    await withState({ snap, conn: "live", confirming: null, pending: new Set(), feedback: new Map() }, async () => {
      await withRequests([{ status: 200, json: { ok: true } }], async (calls) => {
        const tool = M.renderDockTool(target, { action: "interrupt", enabled: true }, "interrupt", { held: false });
        // The first click must arm a confirmation, not send anything.
        await fire(tool);
        expect(calls).toHaveLength(0);
        expect(M.state.confirming).toBe("act:" + target.id + ":interrupt");

        // The armed strip is what actually sends.
        const strip = M.renderDockTool(target, { action: "interrupt", enabled: true }, "interrupt", { held: false });
        const confirm = buttonsOf(strip).find((b: any) => textOf(b) === "Confirm");
        expect(confirm).toBeDefined();
        await fire(confirm);
        expect(calls.map((c) => [c.method, c.url])).toEqual([["POST", "/api/control"]]);
        expect(calls[0]!.body).toMatchObject({ action: "interrupt", agentId: target.id });
      });
    });

    // Focus is NOT gated — a confirmation on every button is a confirmation on none.
    await withState({ snap, conn: "live", confirming: null, pending: new Set(), feedback: new Map() }, async () => {
      await withRequests([{ status: 200, json: { ok: true } }], async (calls) => {
        const tool = M.renderDockTool(target, { action: "focus", enabled: true }, "focus", { held: false });
        await fire(tool);
        expect(M.state.confirming).toBeNull();
        expect(calls.map((c) => c.body.action)).toEqual(["focus"]);
      });
    });
  });

  /* W4-B: was two source substrings. A server that answers `200 {}` (or HTML,
     or `200 {ok:false}`) must never be recorded as a success — that is the
     whole invariant, and it is now asserted from the feedback the drawer
     actually renders. */
  test("HTTP completion alone is never treated as control success", async () => {
    const target = agent();
    const snap = snapshot({ programs: [{ id: "p", name: "P", agents: [target] }] });
    const outcomes: Array<[FakeReply, boolean, string]> = [
      [{ status: 200, json: { ok: true } }, true, "succeeded"],
      [{ status: 200, json: {} }, false, "unexpected response"],
      [{ status: 200, json: { ok: false, error: { code: "CMUX_FAILED", message: "no pane" } } }, false, "CMUX_FAILED"],
      [{ status: 200 }, false, "unexpected response"], // 200 with a non-JSON body
    ];
    for (const [reply, ok, fragment] of outcomes) {
      await withState({ snap, conn: "live", pending: new Set(), feedback: new Map(), drafts: new Map([[target.id, "go"]]) }, async () => {
        await withRequests([reply], async () => {
          await M.sendControl(target, "instruct", "go");
          const recorded = M.state.feedback.get(target.id);
          expect(recorded.ok, JSON.stringify(reply)).toBe(ok);
          expect(recorded.message).toContain(fragment);
          expect(M.state.drafts.get(target.id), JSON.stringify(reply)).toBe(ok ? undefined : "go");
        });
      });
    }
  });

  test("no dynamic content flows through innerHTML", () => {
    const payload = '<img src=x onerror="globalThis.pwned=true">';
    const node = withDom(() => M.el("p", { text: payload }));
    expect(textOf(node)).toBe(payload);
    expect(node.children).toHaveLength(0);
    expect(source).not.toMatch(/\.innerHTML\s*=/);
  });

  test("drawer omits empty fields instead of filler absences", () => {
    expect(source).toContain("if (value == null || value === \"\") return;");
    expect(source).not.toContain('absent: "not reported"');
    expect(source).not.toContain('absent: "not evaluated"');
    expect(source).not.toContain('absent: "none"');
    // FE-B: cost/tests/gates are never filler rows in the drawer body — asserted
    // by rendering the panels with all three present and reading the output,
    // rather than by matching source text between landmark function names.
    const loaded = agent({
      cost: { totalUsd: 12.3456, provenance: "observed" },
      tests: { passing: 7, failing: 1 },
      gates: ["needs-review"],
      lastHumanMessage: "ship the fix",
      lastAgentMessage: "pushed",
      transcriptTail: "tail",
    });
    const panels = panelTexts(loaded);
    for (const [where, text] of Object.entries(panels)) {
      expect(text, where + " must not render a cost row").not.toContain("12.34");
      expect(text, where + " must not render a $ figure").not.toContain("$");
    }
    expect(panels.chat).not.toContain("needs-review");
    expect(panels.chat).not.toContain("passing");
  });
});

describe("agent drawer — Document · Desk", () => {
  test("wide drawers show both surfaces while narrow drawers expose a real mode switch", () => {
    expect(source).not.toContain("inspectorTabButton(");
    expect(source).toContain('class: "drawer-grid"');
    expect(source).toContain('class: "drawer-doc"');
    expect(source).toContain('class: "drawer-desk"');
    expect(source).toContain('"aria-label": "Conversation"');
    expect(source).toContain('"aria-label": "Evidence and lineage"');
    expect(source).toContain('class: "drawer-mode-switch"');
    expect(styles).toContain("grid-template-columns: minmax(0, 1fr) clamp(280px, 35%, 320px)");
    expect(styles).toContain("@media (max-width: 860px)");
  });

  test("Evidence reads as a separate inspector while preserving its responsive contract", () => {
    const selected = agent({
      cwd: "/repos/session",
      target: { resolution: "exact", surfaceCwd: "/repos/session" },
      artifacts: [{ kind: "transcript", path: "/tmp/session.jsonl" }],
    });
    const drawer = withDom(() => {
      const pane = newNode("div");
      M.renderAgentDrawer(pane, { kind: "agent", agent: selected, program: { id: "p", name: "P", agents: [selected] } });
      return pane;
    });
    const desk = byClass(drawer, "drawer-desk");
    expect(byClass(desk, "drawer-evidence-head")).toBeNull();
    expect(byClass(desk, "drawer-evidence-title")).toBeNull();
    expect(byEvidenceSection(desk, "workspace")).not.toBeNull();
    expect(byEvidenceSection(desk, "route")).not.toBeNull();
    expect(styles).toContain("grid-template-columns: minmax(0, 1fr) clamp(280px, 35%, 320px)");
    expect(styles).toContain(".drawer-desk {\n  min-height: 0;\n  overflow-y: auto;");
    expect(styles).toContain(".evidence-section");
  });

  test("Names rename UI remains an opt-in disclosure outside the main drawer", () => {
    expect(source).toContain("function renderNamesDisclosure(");
    expect(source).toContain('el("summary", {}, icon("shield", { label: "" }), " Names")');
    expect(source).toContain('class: "names-disclosure"');
    expect(source).not.toContain('text: "Presentation labels"');
    expect(styles).toContain(".names-disclosure");
    // Naming is configuration, not evidence, so the always-visible Desk does
    // not spend space on it. The standalone disclosure remains closed by
    // default for the settings/rename path.
    const named = agent({ cwd: "/repos/x" });
    const program = { id: "p", name: "P", agents: [named] };
    const drawer = withDom(() => {
      const pane = newNode("div");
      M.renderAgentDrawer(pane, { kind: "agent", agent: named, program });
      return pane;
    });
    expect(byClass(drawer, "names-disclosure")).toBeNull();
    const evidence = withDom(() => M.renderEvidence(named));
    expect(byClass(evidence, "names-disclosure")).toBeNull();
    const disclosure = withDom(() => M.renderNamesDisclosure(named));
    expect(disclosure).not.toBeNull();
    expect(disclosure.attributes.open).toBeUndefined();
  });

  test("the rename list offers the agent first, ahead of the terminal it shares", () => {
    /* Order is priority here — the first row is the one an operator reaches for.
       The agent target was last purely because it was the last `if` written, so
       the default reach was the WORKSPACE label, which names a cmux pane.
       Sibling panes share a workspace, so that rename silently renamed every
       sibling at once — the opposite of "give this agent a name". */
    const linked = agent({
      cwd: "/repos/x",
      target: { workspaceId: "WS-1", surfaceId: "SF-1", workspaceTitle: "wave6", resolution: "exact" },
    });
    const kinds = withDom(() =>
      allByClass(M.renderNamesDisclosure(linked), "label-action")
        .map((button: any) => String(button.attributes?.["aria-label"] ?? "")),
    );

    expect(kinds[0]).toContain("agent");
    /* Proof the row order is what is being asserted, not merely that an agent
       row exists somewhere: all three targets must be present for "first" to
       mean anything. */
    expect(kinds).toHaveLength(3);
    expect(kinds.join(" ")).toContain("workspace");
    expect(kinds.join(" ")).toContain("room");
  });

  test("Evidence carries compact directory provenance without duplicating header vitals", () => {
    const evidence = withDom(() => M.renderEvidence(agent({
      cwd: "/repos/session",
      launchCwd: "/repos/launch",
      repo: { repoKey: "repo", repoName: "repo", worktreePath: "/repos/target", ephemeral: false },
      target: {
        resolution: "exact",
        workspaceId: "WORKSPACE-1",
        surfaceId: "SURFACE-1",
        paneId: "PANE-1",
        workspaceTitle: "Ridge",
        surfaceCwd: "/repos/pane",
        cwdRelation: "different",
      },
      tokens: {
        provenance: "observed",
        scope: "latest-turn",
        input: 100,
        output: 25,
        total: 125,
        sessionTotal: 2_000,
      },
    })));
    const text = textOf(evidence);
    expect(text).toContain("Workspace");
    expect(text).toContain("/repos/session");
    expect(text).toContain("Repository");
    expect(text).toContain("repo");
    expect(text).toContain("Launch folder");
    expect(text).toContain("/repos/launch");
    expect(text).toContain("Terminal shell folder");
    expect(text).toContain("/repos/pane");
    expect(text).toContain("Claude’s tool session and the terminal shell maintain separate working directories.");
    expect(text).not.toContain("latest call");
    expect(text).not.toContain("session total");
  });

  test("provider task text remains a conversation floor, never a header widget", () => {
    const selected = agent({
      lastHumanMessage: "rebuild the collector",
      lastUserMessage: "",
      lastAgentMessage: "",
      task: "Port the SEM forecast rate limiter",
      model: "claude-opus-4-8",
    });
    const pane = newNode("div");
    withDom(() => M.renderAgentDrawer(pane, {
      kind: "agent",
      agent: selected,
      program: { id: "p", name: "P", agents: [selected] },
    }));
    expect(byClass(pane, "drawer-task-summary")).toBeNull();
    expect(textOf(byClass(pane, "drawer-session-header"))).not.toContain("Port the SEM forecast");
    expect(textOf(byClass(pane, "drawer-chat-scroll"))).toContain("Port the SEM forecast");
    expect(M.drawerObjective).toBeUndefined();
    expect(M.taskMeaningfullyDifferent).toBeUndefined();
    expect(source).not.toContain('class: "operate-meta"');
  });
});

describe("RHSP command header consolidation", () => {
  const renderDrawer = (overrides: Record<string, unknown> = {}) => withDom(() => {
    const selected = agent(overrides);
    const pane = newNode("div");
    M.renderAgentDrawer(pane, {
      kind: "agent",
      agent: selected,
      program: { id: "p", name: "Home", agents: [selected] },
    });
    return pane;
  });

  test("one command header owns identity, state, and operational facts", () => {
    const drawer = renderDrawer({
      task: "Replace the redundant drawer header",
      role: "orchestrator",
      identity: { base: "Admin Hub UX Updates V3 - Highlight Row" },
      model: "sol 5.6",
      processLiveness: "running",
      updatedAt: "2026-08-12T04:00:00.000Z",
      status: "waiting",
      lifecycle: "waiting",
      statusReason: "Quiet 12m · process live.",
      cwd: "/Users/example",
      target: { resolution: "exact", surfaceCwd: "/Users/example" },
      contextPct: 28,
      tokens: { provenance: "observed", total: 71_000, contextWindow: 258_000, sessionTotal: 2_200_000 },
    });

    const header = byClass(drawer, "drawer-session-header");
    expect(header).not.toBeNull();
    expect(byClass(header, "drawer-task-summary")).toBeNull();
    expect(byClass(drawer, "drawer-header-vitals")).toBeNull();
    expect(byClass(drawer, "drawer-chat-task")).toBeNull();

    const headerText = textOf(header).replace(/\s+/g, " ");
    expect(headerText).toContain("Orchestrator · Home");
    expect(headerText).not.toContain("Task");
    expect(headerText).not.toContain("Replace the redundant drawer header");
    expect(textOf(byClass(header, "drawer-session-run"))).toBe("Codex / sol 5.6");
    expect(byClass(header, "drawer-session-state")).toBeNull();
    expect(byClass(header, "status-line")).toBeNull();
    const statusFact = byClass(header, "drawer-session-status");
    const liveDot = byClass(statusFact, "drawer-process-dot");
    expect(liveDot).not.toBeNull();
    expect(liveDot?.attributes?.["aria-label"]).toBe("Process live");
    expect(byClass(statusFact, "drawer-session-age")?.dataset?.ago).toBe("2026-08-12T04:00:00.000Z");
    expect(textOf(byClass(statusFact, "drawer-session-activity"))).toBe("Waiting");
    expect(statusFact?.children?.[1]?.attributes?.["aria-label"]).toContain("Waiting");
    expect(textOf(byClass(header, "drawer-session-context"))).toContain("Context28%");
    expect(headerText).toContain("71k / 258k");
    const gauge = findAll(header, (node) => node.attributes?.role === "progressbar")[0];
    expect(gauge?.attributes?.class).toBe("drawer-context-gauge");
    expect(gauge?.attributes?.role).toBe("progressbar");
    expect(gauge?.attributes?.["aria-valuenow"]).toBe("28");
    expect(gauge?.attributes?.["aria-label"]).toBe("Context used: 28%");
    expect(textOf(byClass(header, "drawer-session-usage"))).toBe("Session2.2M");
    const facts = byClass(header, "drawer-session-facts");
    expect(byClass(header, "drawer-session-details")).toBeNull();
    expect(facts?.parent).toBe(header);

    const doc = byClass(drawer, "drawer-doc");
    expect(doc?.attributes?.["aria-label"]).toBe("Conversation");
    expect(byClass(doc, "drawer-chat")).not.toBeNull();
  });

  test("a working nonhealthy session keeps its concrete reason visible", () => {
    const drawer = renderDrawer({
      activity: "working",
      lifecycle: "working",
      outcome: "blocked",
      statusReason: "Blocked by CI gate on main.",
      processLiveness: "running",
    });
    const statusFact = byClass(drawer, "drawer-session-status");
    expect(textOf(byClass(statusFact, "drawer-session-activity"))).toBe("Working");
    expect(textOf(byClass(statusFact, "drawer-session-reason"))).toBe("Blocked by CI gate on main.");
  });

  test("Evidence keeps provenance and removes facts the command header already owns", () => {
    const drawer = renderDrawer({
      role: "orchestrator",
      cwd: "/Users/example",
      target: { resolution: "exact", surfaceCwd: "/Users/example" },
      updatedAt: new Date(Date.now() - 20 * 60_000).toISOString(),
      artifacts: [{ kind: "transcript", label: "CODEX transcript", path: "/tmp/session.jsonl" }],
    });
    const evidence = byClass(drawer, "drawer-desk");
    const evidenceText = textOf(evidence).replace(/\s+/g, " ");

    expect(byClass(evidence, "evidence-role")).toBeNull();
    expect(evidenceText).not.toContain("quiet since");
    expect(evidenceText.match(/\/Users\/example/g)).toHaveLength(1);
    expect(evidenceText).not.toContain("Workspace and terminal report the same folder");
    expect(evidenceText).not.toContain("does not authorize controls");
    const copy = findAll(evidence, (node: any) => node.attributes?.["aria-label"] === "Copy transcript path")[0];
    expect(copy).toBeUndefined();
    const pathCopies = allByClass(evidence, "evidence-path-copy");
    expect(pathCopies.length).toBeGreaterThan(0);
    expect(pathCopies[0].attributes["aria-label"]).toContain("Copy Workspace path");
  });

  test("Close is icon-only and Archive sits as a peer tile in the dock", () => {
    const drawer = renderDrawer({
      controls: [
        { action: "focus", enabled: true },
        { action: "instruct", enabled: true },
        { action: "interrupt", enabled: true },
        { action: "archive", enabled: true },
      ],
    });
    const close = byClass(drawer, "inspector-close");
    expect(close?.attributes?.["aria-label"]).toBe("Close inspector");
    expect(textOf(close)).toBe("");

    const cluster = byClass(drawer, "command-dock-cluster");
    const directTools = (cluster?.children || []).filter((child: any) =>
      String(child.className || "").split(/\s+/).includes("dock-tool"));
    // SYNC-CF's close tile joins them on the same terms: icon-only, and named
    // by aria-label rather than by a glyph nobody can hear.
    expect(directTools.map((tool: any) => textOf(tool))).toEqual(["", "", "", ""]);
    expect(directTools.map((tool: any) => tool.attributes?.["aria-label"]))
      .toEqual(["Focus", "Interrupt", "Archive", "Close terminal"]);
    expect(byClass(cluster, "command-dock-more")).toBeNull();
    const archive = byFkey(cluster, "act:codex:a1:archive");
    expect(archive?.attributes?.["aria-label"]).toBe("Archive");
    expect(textOf(archive)).toBe("");
  });
});

describe("verdict head — act from the top (B2)", () => {
  /* Brace-counted extraction, not a landmark regex: it walks from the
     signature's opening `{` to its true matching `}` by depth, so it can
     never stop early at a column-0 `}` that belongs to nested content, and
     it never depends on whatever function/comment happens to follow —
     inserting a new top-level helper anywhere else in the file cannot
     truncate or widen the body it returns. */
  function extractFunctionBody(signature: string): string {
    const start = source.indexOf(signature);
    if (start === -1) return "";
    const braceStart = source.indexOf("{", start);
    if (braceStart === -1) return "";
    let depth = 0;
    for (let i = braceStart; i < source.length; i++) {
      const ch = source[i];
      if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) return source.slice(start, i + 1);
      }
    }
    return "";
  }
  const agentDrawer = () => extractFunctionBody("function renderAgentDrawer(pane, view) {");

  test("drawer order: shell head → bounded grid containing chat-owned controls", () => {
    const drawer = agentDrawer();
    expect(drawer).toBeTruthy();
    const headAt = drawer.indexOf("inspector-head inspector-verdict");
    const bannerAt = drawer.indexOf("renderControlBanner(agent, control)");
    const gridAt = drawer.indexOf('class: "drawer-grid"');
    const lineageAt = drawer.indexOf("renderLineageSpine(agent)");
    const dockAt = drawer.indexOf("renderCommandDock(agent, control)");
    for (const at of [headAt, bannerAt, gridAt, lineageAt, dockAt]) {
      expect(at).toBeGreaterThan(-1);
    }
    expect(drawer).toContain('class: "drawer-shell-head"');
    /* next-action is gone: across 243 live agents it held three distinct strings
       and 214 read "Review this session in history." — a restatement of
       activity === "ended" dressed as per-agent advice. */
    expect(drawer).not.toContain('class: "next-action"');
    expect(drawer).not.toContain('class: "drawer-header-vitals"');
    expect(drawer).not.toContain('class: "drawer-chat-task"');
    // The dock is built once, receives the banner, and joins the chat before
    // the chat and Evidence columns are assembled into the bounded grid.
    expect(dockAt).toBeGreaterThan(headAt);
    expect(bannerAt).toBeGreaterThan(dockAt);
    expect(lineageAt).toBeGreaterThan(bannerAt);
    expect(gridAt).toBeGreaterThan(lineageAt);
    expect(drawer).toContain("chatBox.append(dock)");
    expect(drawer).toContain("pane.append(grid)");
  });

  test("the ribbon carries hazards and exactly one Focus button exists", () => {
    const drawer = agentDrawer();
    const head = drawer.slice(0, drawer.indexOf("renderControlBanner(agent, control)"));
    expect(head).toContain("verdictGate(");
    /* The head's primary action is deleted. It rendered a literal copy of a dock
       tool while the dock is the persistent footer of the same chat, so one
       Focus button was on screen twice. */
    expect(head).not.toContain("headPrimaryAction(");
    expect(source).not.toContain("function headPrimaryAction(");
    expect(styles).toMatch(/\.command-dock\s*\{[^}]*position:\s*static/);
    // The hazard is an ember exclamation inside the facts ribbon.
    const gateCss = styles.match(/\.drawer-session-hazard\s*\{[^}]*\}/)?.[0] ?? "";
    expect(gateCss).toContain("border: 1px solid currentColor");
    expect(gateCss).toContain("color: var(--ember)");
    // Touch sweep: the head action clears 44px below 1024px.
    const after = styles.slice(styles.indexOf("@media (max-width: 1024px)"));
    const block = after.slice(0, after.indexOf("@media (max-width: 720px)"));
    expect(block).toContain(".verdict-action .dock-tool");
  });

  test("head de-noising: one quiet source line in the identity eyebrow", () => {
    const drawer = agentDrawer();
    expect((drawer.match(/drawer-session-eyebrow/g) || []).length).toBe(1);
    expect(drawer).toContain("quietSourceLine(agent)");
    expect(drawer).toContain('class: "drawer-session-eyebrow"');
    expect(drawer).not.toContain("fullSourceDetail(agent)");
  });

  test("quietSourceLine keeps useful terminal context for separate directories without warning language", () => {
    // Terminal title IS the display name → no source line at all.
    const matching = agent({ target: { resolution: "exact", surfaceId: "s1", workspaceId: "w1", workspaceTitle: "ridge-pane" } });
    expect(M.quietSourceLine(matching)).toBeNull();

    // Separate directories keep the terminal name as neutral destination context.
    const separate = agent({
      cwd: "/Users/op",
      target: { resolution: "exact", surfaceId: "s1", workspaceId: "w1", workspaceTitle: "ridge-pane", cwdRelation: "different" },
    });
    expect(M.quietSourceLine(separate)).toBe("Terminal: ridge-pane");

    // No terminal title, no custom name → still quiet.
    expect(M.quietSourceLine(agent())).toBeNull();
  });
});

describe("B2 review fixes — instance-scoped head keys + executable head logic", () => {
  /* app.js is imported without a document (DOM wiring stays un-booted), but
     headPrimaryAction/verdictGate build real nodes via el()/icon(). A minimal
     fake document, installed only around each call, lets the tests execute the
     actual helpers and assert on the returned nodes. */
  function fakeDom() {
    const make = (tag: string) => ({
      nodeType: 1,
      tagName: tag,
      className: "",
      textContent: "",
      dataset: {} as Record<string, string>,
      attributes: {} as Record<string, string>,
      children: [] as unknown[],
      classList: { add() {} },
      setAttribute(k: string, v: unknown) { this.attributes[k] = String(v); },
      addEventListener() {},
      append(...kids: unknown[]) { this.children.push(...kids); },
    });
    return {
      createElement: (t: string) => make(t),
      createElementNS: (_ns: string, t: string) => make(t),
      createTextNode: (s: string) => ({ nodeType: 3, textContent: String(s) }),
    };
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function withDom<T>(fn: () => T): T {
    (globalThis as unknown as { document: unknown }).document = fakeDom();
    try { return fn(); } finally {
      delete (globalThis as unknown as { document?: unknown }).document;
    }
  }


  test("verdictGate: concrete hazards collapse to one accessible exclamation", () => {
    const gated = agent({ gates: ["needs-review"], statusReason: "" });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const chip: any = withDom(() => M.verdictGate(gated, "blocked"));
    expect(chip).not.toBeNull();
    expect(chip.className).toBe("drawer-session-hazard");
    expect(chip.textContent).toBe("!");
    expect(chip.attributes.title).toBe("needs-review");
    expect(chip.attributes["aria-label"]).toBe("Hazard: needs-review");

    // An exceptional outcome still gets a warning even when no gate string exists.
    const reason = agent({ statusReason: "Blocked by CI gate on main." });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const chip2: any = withDom(() => M.verdictGate(reason, "blocked"));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(chip2.textContent).toBe("!");
    expect(chip2.attributes.title).toBe("Blocked");

    expect(withDom(() => M.verdictGate(agent(), "healthy"))).toBeNull();
  });

  test("separate directories retain terminal context even when the shown name equals the terminal title", () => {
    const aliasLike = agent({
      nickname: "Ridge pane",
      target: { resolution: "exact", surfaceId: "s1", workspaceId: "w1", workspaceTitle: "Ridge pane", cwdRelation: "different" },
    });
    expect(M.quietSourceLine(aliasLike)).toBe("Terminal: Ridge pane");
    // Without separate directories the same identity stays quiet.
    const calm = agent({
      nickname: "Ridge pane",
      target: { resolution: "exact", surfaceId: "s1", workspaceId: "w1", workspaceTitle: "Ridge pane" },
    });
    expect(M.quietSourceLine(calm)).toBeNull();
  });

  /* The head no longer renders a primary action, so the instance-scoping that
     existed only to keep two copies of one Focus button from stealing each
     other's confirm strip is gone with it. The dock's own scoping is still
     load-bearing and is asserted here. */
  test("the dock still scopes its confirm strip to the instance that opened it", () => {
    const dockToolFn = requiredSlice(source, /function renderDockTool\([\s\S]*?\n\}\n/, "renderDockTool");
    expect(dockToolFn).toContain("state.confirming === fkey");
    expect(dockToolFn).toContain("state.confirming = fkey");
    // Escape restores focus to the exact instance fkey stored in state.confirming.
    expect(source).toContain('document.querySelector(`[data-fkey="${CSS.escape(key)}"]`)');
    // And there is exactly one Focus button in the drawer now: the dock's.
    expect(source).not.toContain('fkeyPrefix: "head:"');
  });
});

describe("command header session facts (B3)", () => {
  /* A minimal fake document drives the real drawer so this contract asserts
     the rendered header, not a second metrics component. */
  function fakeDom() {
    const make = (tag: string) => ({
      nodeType: 1,
      tagName: tag,
      className: "",
      textContent: "",
      dataset: {} as Record<string, string>,
      attributes: {} as Record<string, string>,
      children: [] as unknown[],
      classList: { add() {} },
      get childNodes() { return this.children; },
      get childElementCount() { return this.children.length; },
      setAttribute(k: string, v: unknown) { this.attributes[k] = String(v); },
      addEventListener() {},
      append(...kids: unknown[]) { this.children.push(...kids); },
    });
    return {
      createElement: (t: string) => make(t),
      createElementNS: (_ns: string, t: string) => make(t),
      createTextNode: (s: string) => ({ nodeType: 3, textContent: String(s) }),
    };
  }
  function withDom<T>(fn: () => T): T {
    (globalThis as unknown as { document: unknown }).document = fakeDom();
    try { return fn(); } finally {
      delete (globalThis as unknown as { document?: unknown }).document;
    }
  }
  // el() writes leaf text via the `text:` attr (node.textContent) and multi-child
  // text via createTextNode kids; a node uses one or the other, so summing both
  // never double-counts.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function textOf(node: any): string {
    if (!node || typeof node !== "object") return "";
    if (node.nodeType === 3) return String(node.textContent || "");
    let s = typeof node.textContent === "string" ? node.textContent : "";
    for (const kid of node.children || []) s += textOf(kid);
    return s;
  }

  test("(a) one compact header carries context and session magnitudes once", () => {
    const live = agent({
      tokens: { provenance: "observed", scope: "latest-turn", total: 120000, contextWindow: 1000000, sessionTotal: 480000 },
      elapsedMs: 125000,
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pane: any = withDom(() => {
      const root = newNode("div");
      M.renderAgentDrawer(root, { kind: "agent", agent: live, program: { id: "p", name: "P", agents: [live] } });
      return root;
    });
    const header = byClass(pane, "drawer-session-header");
    expect(header).not.toBeNull();
    const text = textOf(header).replace(/\s+/g, " ");
    const count = (needle: string) => text.split(needle).length - 1;
    expect(count("120k")).toBe(1);
    expect(count("480k")).toBe(1);
    expect(count("12%")).toBe(1);
    expect(text).toContain("120k / 1.0M");
    expect(byClass(pane, "drawer-header-vitals")).toBeNull();
  });

  test("(b) the header never invents a denominator or resurrects deleted metrics", () => {
    const noWindow = agent({
      provider: "claude",
      tokens: { provenance: "observed", total: 40000 },
      elapsedMs: undefined,
      updatedAt: undefined,
    });
    const renderHeader = (value: unknown) => withDom(() => {
      const root = newNode("div");
      M.renderAgentDrawer(root, { kind: "agent", agent: value, program: { id: "p", name: "P", agents: [value] } });
      return byClass(root, "drawer-session-header");
    });
    const noWindowText = textOf(renderHeader(noWindow));
    expect(noWindowText).toContain("40k tokens");
    expect(noWindowText).not.toContain("%");
    expect(byClass(renderHeader(agent({ tokens: { provenance: "unknown" } })), "drawer-session-context")).toBeNull();
    expect(M.tokenSummary({ provenance: "unknown" }).text).toBe("not reported");

    /* The three deleted tiles, each for its own reason:
       - A separate Session tokens tile duplicated the cumulative figure that
         now shares the compact header vitals with its context denominator.
       - cache hit used cachedInput/input, but `input` is the UNCACHED remainder,
         so the true rate is cachedInput/(cachedInput+input). The wrong
         denominator can exceed 1 (hence the old Math.min clamp) and printed a
         constant "100%" on nearly every active agent.
       - Uptime timed since START, not since movement: 200h for an agent that had
         been silent for an hour. */
    const rich = agent({
      tokens: { provenance: "observed", scope: "latest-turn", total: 180000, contextWindow: 200000, sessionTotal: 27000000, cachedInput: 90000, input: 10000 },
      elapsedMs: 125000,
    });
    const text = textOf(renderHeader(rich));
    expect(text).not.toContain("Session tokens");
    expect(text).not.toContain("cache hit");
    expect(text).not.toContain("Uptime");
    expect(text).toContain("Session27.0M");
  });

  test("(c) Evidence no longer builds a competing vitals block", () => {
    const evidence = source.match(/function renderEvidence\(agent, ui = state\) \{[\s\S]*?\n\}\n/)?.[0] ?? "";
    expect(evidence).toBeTruthy();
    expect(evidence).not.toContain("renderVitals(agent)");
    expect(evidence).not.toContain("renderVitalsBand(agent)");
  });

  test("(d) renderAgentDrawer puts honest compact facts inside the command header", () => {
    const drawer = source.match(/function renderAgentDrawer\(pane, view\) \{[\s\S]*?\n\}\n/)?.[0] ?? "";
    expect(drawer).toContain('class: "drawer-session-facts"');
    expect(drawer).toContain("drawer-session-context");
    expect(drawer).toContain("drawer-session-usage");
    expect(drawer).toContain("drawer-session-status");
    expect(drawer).toContain("drawer-context-gauge");
    expect(drawer).not.toContain("drawer-session-state");
    expect(drawer).not.toContain("renderStatusLine(");
    expect(drawer).not.toContain('class: "drawer-header-vitals"');
    const factsAt = drawer.indexOf('class: "drawer-session-facts"');
    const gridAt = drawer.indexOf('class: "drawer-grid"');
    expect(factsAt).toBeGreaterThan(-1);
    expect(factsAt).toBeLessThan(gridAt);
  });
});

describe("per-type drawers lead with verdict + action (B4)", () => {
  /* Same DOM-less execution trick B2/B3 used, so the program-rollup test asserts
     on the real built tree — not merely on source substrings. */
  function fakeDom() {
    const make = (tag: string) => ({
      nodeType: 1,
      tagName: tag,
      className: "",
      textContent: "",
      dataset: {} as Record<string, string>,
      attributes: {} as Record<string, string>,
      children: [] as unknown[],
      setAttribute(k: string, v: unknown) { this.attributes[k] = String(v); },
      addEventListener() {},
      append(...kids: unknown[]) { this.children.push(...kids); },
    });
    return {
      createElement: (t: string) => make(t),
      createElementNS: (_ns: string, t: string) => make(t),
      createTextNode: (s: string) => ({ nodeType: 3, textContent: String(s) }),
    };
  }
  function withDom<T>(fn: () => T): T {
    (globalThis as unknown as { document: unknown }).document = fakeDom();
    try { return fn(); } finally {
      delete (globalThis as unknown as { document?: unknown }).document;
    }
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function classesOf(node: any, out: string[] = []): string[] {
    if (!node || typeof node !== "object") return out;
    if (typeof node.className === "string" && node.className) out.push(node.className);
    for (const kid of node.children || []) classesOf(kid, out);
    return out;
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function textOf(node: any): string {
    if (!node || typeof node !== "object") return "";
    if (node.nodeType === 3) return String(node.textContent || "");
    let s = typeof node.textContent === "string" ? node.textContent : "";
    for (const kid of node.children || []) s += textOf(kid);
    return s;
  }
  const bodyOf = (name: string) =>
    source.match(new RegExp("function " + name + "\\(pane, view\\) \\{[\\s\\S]*?\\n\\}\\n"))?.[0] ?? "";

  test("(a) every entity drawer opens with a shared verdict-head block before its detail", () => {
    // The shared head is verdict-shaped: the totem chassis + a right-side stack
    // that carries Close and the one promoted action.
    const helper = source.match(/function drawerVerdictHead\([\s\S]*?\n\}\n/)?.[0] ?? "";
    expect(helper).toBeTruthy();
    expect(helper).toContain("inspector-head inspector-verdict");
    expect(helper).toContain('class: "verdict-side"');
    expect(helper).toContain('class: "verdict-action"');

    // Intervention: head → workStateBanner → impactBlock (guards stay below).
    const iv = bodyOf("renderInterventionDrawer");
    const ivHead = iv.indexOf("drawerVerdictHead(");
    expect(ivHead).toBeGreaterThan(-1);
    expect(ivHead).toBeLessThan(iv.indexOf("workStateBanner(issue)"));
    expect(iv.indexOf("workStateBanner(issue)")).toBeLessThan(iv.indexOf("impactBlock(issue)"));

    // Advisory: head → workStateBanner → impactBlock.
    const av = bodyOf("renderAdvisoryDrawer");
    const avHead = av.indexOf("drawerVerdictHead(");
    expect(avHead).toBeGreaterThan(-1);
    expect(avHead).toBeLessThan(av.indexOf("workStateBanner(issue)"));
    expect(av.indexOf("workStateBanner(issue)")).toBeLessThan(av.indexOf("impactBlock(issue)"));

    // Investigation: head → status line → steps.
    const inv = bodyOf("renderInvestigationDrawer");
    const invHead = inv.indexOf("drawerVerdictHead(");
    expect(invHead).toBeGreaterThan(-1);
    expect(invHead).toBeLessThan(inv.indexOf('class: "dw-status"'));

    // Resolved: head → cleared lead → before/after grid. No invented action.
    const rv = bodyOf("renderResolvedDrawer");
    const rvHead = rv.indexOf("drawerVerdictHead(");
    expect(rvHead).toBeGreaterThan(-1);
    expect(rvHead).toBeLessThan(rv.indexOf("dw-lead--past"));
    expect(rv.indexOf("dw-lead--past")).toBeLessThan(rv.indexOf('class: "detail-grid"'));
    expect(rv).not.toContain("issueHeadAction"); // no action invented for a past-tense drawer
    expect(rv).not.toContain("action:");

    // Program: head (with the rollup line) → roster.
    const pr = bodyOf("renderProgramDrawer");
    const prHead = pr.indexOf("drawerVerdictHead(");
    expect(prHead).toBeGreaterThan(-1);
    expect(pr).toContain("programRollupLine(program)");
    expect(prHead).toBeLessThan(pr.indexOf('class: "dw-roster"'));
    // The scoping lever stays a body control (not promoted into the head).
    expect(pr).toContain("facet-program:");
  });

  test("(b) regression guard: workStateBanner + impactBlock still render, logic byte-untouched", () => {
    const iv = bodyOf("renderInterventionDrawer");
    const av = bodyOf("renderAdvisoryDrawer");
    expect(iv).toContain("pane.append(workStateBanner(issue));");
    expect(iv).toContain("pane.append(impactBlock(issue));");
    expect(av).toContain("pane.append(workStateBanner(issue));");
    expect(av).toContain("pane.append(impactBlock(issue));");
    // The two guarded functions are untouched — quote their load-bearing lines.
    const wsb = source.match(/function workStateBanner\(issue\) \{[\s\S]*?\n\}\n/)?.[0] ?? "";
    const imp = source.match(/function impactBlock\(issue\) \{[\s\S]*?\n\}\n/)?.[0] ?? "";
    expect(wsb).toContain('el("div", { class: "dw-work work-" + work.key, role: "status" }');
    expect(imp).toContain('el("h3", { class: "section-title", text: "Impact" })');
  });

  test("(c) program head carries the rollup vitals with mono values, aggregated over the swarm", () => {
    expect(typeof M.renderProgramDrawer).toBe("function");
    const mk = (over: Record<string, unknown>) => agent({
      tokens: { provenance: "observed", sessionTotal: 10000 }, ...over,
    });
    const program = {
      id: "p1", name: "Ridge program",
      agents: [
        mk({ id: "codex:w1", status: "running" }),
        mk({ id: "codex:w2", status: "running" }),
        mk({ id: "codex:n1", status: "attention" }),
      ],
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pane: any = withDom(() => {
      const p = (globalThis as unknown as { document: { createElement(t: string): unknown } })
        .document.createElement("div");
      M.renderProgramDrawer(p, { program });
      return p;
    });
    const classes = classesOf(pane);
    // Verdict-shaped head + a rollup line whose VALUES ride the mono convention.
    expect(classes.some((c) => c.includes("inspector-head") && c.includes("inspector-verdict"))).toBe(true);
    expect(classes.some((c) => c.includes("dw-rollup"))).toBe(true);
    expect(classes.some((c) => c.includes("dw-rollup-value") && c.includes("mono"))).toBe(true);
    const text = textOf(pane);
    // 3 agents · 2 working · 1 alert · aggregate session tokens (10k×3 = 30k).
    expect(text).toContain("3agents");
    expect(text).toContain("2working");
    expect(text).toContain("1alert");
    expect(text).toContain("30k");
    expect(text).toContain("tokens");
  });

  test("(c2) the token cell is omitted honestly when no agent reports session usage", () => {
    const program = {
      id: "p2", name: "Quiet program",
      agents: [
        agent({ id: "codex:a", status: "running", tokens: { provenance: "observed", total: 500 } }),
        agent({ id: "codex:b", status: "running", tokens: { provenance: "unknown" } }),
      ],
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pane: any = withDom(() => {
      const p = (globalThis as unknown as { document: { createElement(t: string): unknown } })
        .document.createElement("div");
      M.renderProgramDrawer(p, { program });
      return p;
    });
    const text = textOf(pane);
    expect(text).toContain("2agents");   // counts are always derivable
    expect(text).not.toContain("tokens"); // an un-derivable aggregate is never faked
  });

  test("(d1) audit closed: dead .state-pill / .inspector-state CSS (and its #fff-on-fill) removed", () => {
    expect(styles).not.toContain(".state-pill");
    expect(styles).not.toContain(".inspector-state");
    // The dead policy-mismatch pill was the only #fff literal in the inspector
    // per-type section — scope the check there (the live .policy-chip #fff lives
    // in agent-rows, WS-C's territory, and is out of scope for this task).
    const perType = styles.slice(
      styles.indexOf("/* ---------- inspector: per-type drawer states"),
      styles.indexOf("/* ---------- controls ----------"),
    );
    expect(perType).toBeTruthy();
    expect(styles).toContain("/* ---------- controls ----------"); // the landmark exists
    expect(perType).not.toContain("#fff");
    // Dead-class safety: with the CSS gone, nothing in the JS/HTML may still emit
    // those class strings, or it would render as an unstyled element. Back the
    // grep claim with the suite (source = app.js text, html = index.html text).
    expect(source).not.toContain("state-pill");
    expect(source).not.toContain("inspector-state");
    expect(html).not.toContain("state-pill");
    expect(html).not.toContain("inspector-state");
  });

  test("(e) orphan cleanup: drawerHead is gone; every drawer head is drawerVerdictHead", () => {
    // The migration moved all five entity heads to drawerVerdictHead, orphaning
    // drawerHead — the change created the orphan, so the change removes it.
    expect(source).not.toContain("function drawerHead(");
    expect(source).not.toContain("drawerHead(");
    // The agent drawer builds its head inline; missingDrawer uses a bare
    // .inspector-head — so the base class stays live, only the helper is gone.
    expect(source).toContain('el("div", { class: "inspector-head inspector-verdict" }'); // drawerVerdictHead
    for (const fn of ["renderInterventionDrawer", "renderAdvisoryDrawer",
      "renderInvestigationDrawer", "renderResolvedDrawer", "renderProgramDrawer"]) {
      expect(bodyOf(fn)).toContain("drawerVerdictHead(");
    }
  });

  test("(f) confirm parity: head triage/launch fire triageIssue directly, exactly like their body twins", () => {
    // Controller ruling: a head action must have IDENTICAL confirm semantics to
    // its body twin. The confirm mechanism (state.confirming) is scoped to
    // renderDockTool and gated on NEEDS_CONFIRM = {interrupt, archive} only —
    // triage/queue/run never enter it. So the parity-correct head is a direct
    // triageIssue() call, mirroring the body. This test pins that both sides
    // fire directly and neither reaches for the confirm gate.
    expect(source).toContain('const NEEDS_CONFIRM = new Set(["interrupt", "archive"]);');
    const head1 = source.match(/function issueHeadAction\([\s\S]*?\n\}\n/)?.[0] ?? "";
    const head2 = source.match(/function investigationHeadAction\([\s\S]*?\n\}\n/)?.[0] ?? "";
    const bodyTriage = source.match(/function renderTriage\([\s\S]*?\n\}\n/)?.[0] ?? "";
    const bodyInvestigation = bodyOf("renderInvestigationDrawer");
    for (const chunk of [head1, head2, bodyTriage, bodyInvestigation]) {
      expect(chunk).toBeTruthy();
      expect(chunk).toContain("triageIssue(");        // direct fire on both sides
      expect(chunk).not.toContain("state.confirming"); // no confirm gate on either
      expect(chunk).not.toContain("NEEDS_CONFIRM");
    }
    // The head's onclick calls the SAME triageIssue actions the body does.
    expect(head1).toContain('triageIssue(id, "run")');
    expect(head1).toContain('triageIssue(id, "generate")');
    expect(bodyTriage).toContain('triageIssue(issue.id, "generate")');
    expect(bodyTriage).toContain('triageIssue(issue.id, "run")');
    expect(head2).toContain('triageIssue(item.issueId, "run")');
    expect(bodyInvestigation).toContain('triageIssue(item.issueId, "run")');
  });

  test("(d2) audit closed: control-banner conforms to --failed ink + --ember-soft tint (settled ruling)", () => {
    const banner = styles.match(/\.control-banner\s*\{[^}]*\}/)?.[0] ?? "";
    const bannerIco = styles.match(/\.control-banner \.ico\s*\{[^}]*\}/)?.[0] ?? "";
    const bannerLink = styles.match(/\.control-banner-link\s*\{[^}]*\}/)?.[0] ?? "";
    // Sanctioned pattern: --failed ink (border + icon + link) over the one --ember-soft tint.
    expect(banner).toContain("var(--ember-soft)");       // the sole sanctioned soft tint
    expect(banner).toContain("var(--failed)");           // border ink from the failed family
    expect(bannerIco).toContain("color: var(--failed)"); // icon ink
    // The link previously reached for the OTHER red (--ember); unify it to --failed so
    // the banner never mixes two red inks (only --failed ink + --ember-soft tint).
    expect(bannerLink).toContain("color: var(--failed)");
    expect(bannerLink).not.toContain("var(--ember)");
  });
});

describe("program-header at-a-glance rollups (C2)", () => {
  /* DOM-less execution, same idiom the drawer rollup tests (B4) use: build the
     real .program-rollup tree in a fake document and assert on the built nodes,
     not on source substrings. */
  function fakeDom() {
    const make = (tag: string) => ({
      nodeType: 1, tagName: tag, className: "", textContent: "",
      dataset: {} as Record<string, string>,
      attributes: {} as Record<string, string>,
      children: [] as unknown[],
      setAttribute(k: string, v: unknown) { this.attributes[k] = String(v); },
      addEventListener() {},
      append(...kids: unknown[]) { this.children.push(...kids); },
    });
    return {
      createElement: (t: string) => make(t),
      createElementNS: (_ns: string, t: string) => make(t),
      createTextNode: (s: string) => ({ nodeType: 3, textContent: String(s) }),
    };
  }
  function withDom<T>(fn: () => T): T {
    (globalThis as unknown as { document: unknown }).document = fakeDom();
    try { return fn(); } finally {
      delete (globalThis as unknown as { document?: unknown }).document;
    }
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function classesOf(node: any, out: string[] = []): string[] {
    if (!node || typeof node !== "object") return out;
    if (typeof node.className === "string" && node.className) out.push(node.className);
    for (const kid of node.children || []) classesOf(kid, out);
    return out;
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function textOf(node: any): string {
    if (!node || typeof node !== "object") return "";
    if (node.nodeType === 3) return String(node.textContent || "");
    let s = typeof node.textContent === "string" ? node.textContent : "";
    for (const kid of node.children || []) s += textOf(kid);
    return s;
  }
  // Every node whose className carries the given token (whitespace-separated).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function allByClass(node: any, token: string, out: any[] = []): any[] {
    if (!node || typeof node !== "object") return out;
    if (typeof node.className === "string" && node.className.split(/\s+/).includes(token)) out.push(node);
    for (const kid of node.children || []) allByClass(kid, token, out);
    return out;
  }
  const mk = (over: Record<string, unknown>) => agent({
    tokens: { provenance: "observed", sessionTotal: 10000 }, ...over,
  });

  test("(a) header rollup renders all four cells — mono values, ember class on the alert cell", () => {
    expect(typeof M.programHeadRollup).toBe("function");
    // 3 agents: 2 running (working), 1 attention (alert); each reports 10k session tokens.
    const agents = [
      mk({ id: "codex:w1", status: "running" }),
      mk({ id: "codex:w2", status: "running" }),
      mk({ id: "codex:n1", status: "attention" }),
    ];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rollup: any = withDom(() => M.programHeadRollup(agents));
    // Four cells: agents · working · alert · tokens.
    expect(allByClass(rollup, "program-rollup-cell").length).toBe(4);
    // Values ride the mono convention (Rule 2 — mono for values), like the drawer.
    const monoVals = classesOf(rollup).filter((c) =>
      /\bprogram-rollup-value\b/.test(c) && /\bmono\b/.test(c));
    expect(monoVals.length).toBe(4);
    const text = textOf(rollup);
    expect(text).toContain("3agents");
    expect(text).toContain("2working");
    expect(text).toContain("1alert");
    expect(text).toContain("30k");   // 10k × 3 aggregate session tokens
    expect(text).toContain("tokens");
    // Alert ink is class-gated (is-alerting → --ember), never inline (strict CSP),
    // and rides on the alert cell only.
    const alerting = allByClass(rollup, "is-alerting");
    expect(alerting.length).toBe(1);
    expect(textOf(alerting[0])).toContain("1alert");
  });

  test("(b) calm earns no cell at all: zero alerts renders nothing", () => {
    const agents = [
      mk({ id: "codex:w1", status: "running" }),
      mk({ id: "codex:w2", status: "running" }),
      mk({ id: "codex:w3", status: "running" }),
    ];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rollup: any = withDom(() => M.programHeadRollup(agents));
    const text = textOf(rollup);
    /* Was: the cell renders at 0 but takes no ember ink. Audit §11 goes further —
       "0 alerts" on every program is one of three widgets asserting that nothing
       needs you, and a counter that always reads 0 stops being read. Absence is
       the stronger version of "earns no color". */
    expect(text).not.toContain("alert");
    expect(allByClass(rollup, "is-alerting").length).toBe(0);
  });

  test("(c) honest omission: an un-derivable token aggregate drops the token cell", () => {
    const agents = [
      agent({ id: "codex:a", status: "running", tokens: { provenance: "observed", total: 500 } }),
      agent({ id: "codex:b", status: "running", tokens: { provenance: "unknown" } }),
    ];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rollup: any = withDom(() => M.programHeadRollup(agents));
    const text = textOf(rollup);
    expect(text).toContain("2agents");                              // counts are always derivable
    expect(text).not.toContain("tokens");                          // no session total → no faked aggregate
    /* agents · working only. These two are healthy, so there is no alerts cell
       either — audit §11. The subject of this test is the TOKEN cell's honest
       omission, which still holds. */
    expect(allByClass(rollup, "program-rollup-cell").length).toBe(2);
  });

  test("(d) header and drawer rollups share ONE aggregation source — no duplicated arithmetic", () => {
    // The aggregation core is defined exactly once.
    expect((source.match(/function programRollupCells\(/g) ?? []).length).toBe(1);
    // BOTH DOM builders feed off it rather than re-deriving counts/tokens.
    /* Signature-agnostic: both builders now take the server's rollup alongside
       the agents so the token aggregate can defer to the wire. What this test
       guards is that they share ONE core, not what arguments it takes. */
    const drawer = source.match(/function programRollupLine\([^)]*\) \{[\s\S]*?\n\}\n/)?.[0] ?? "";
    const header = source.match(/function programHeadRollup\([^)]*\) \{[\s\S]*?\n\}\n/)?.[0] ?? "";
    expect(drawer).toContain("programRollupCells(");
    expect(header).toContain("programRollupCells(");
    // The token reduce — the one bit of arithmetic that could drift — lives ONLY in
    // the shared core: it appears exactly once in the whole file.
    expect((source.match(/sum \+ a\.tokens\.sessionTotal/g) ?? []).length).toBe(1);
    // renderProgram delegates its header rollup to the shared builder and keeps no
    // parallel arithmetic; the old rollupParts text summary is gone.
    // Signature-tolerant: F1a gave renderProgram an opts bag (worktree label +
    // paint key) without changing where its rollup comes from.
    const rp = source.match(/function renderProgram\(program, agents[^)]*\) \{[\s\S]*?\n\}\n/)?.[0] ?? "";
    // Delegation is the contract; WHICH list it rolls up is asserted behaviorally
    // in "a filtered view leaves the program header counting the whole program".
    expect(rp).toContain("programHeadRollup(");
    expect(rp).not.toContain("deriveRollup(agents)");
    expect(source).not.toContain("rollupParts");
  });


  test("(e) rollup data rides the header's accessible text (extends the drawer aria pattern)", () => {
    const agents = [
      mk({ id: "codex:w1", status: "running" }),
      mk({ id: "codex:w2", status: "running" }),
      mk({ id: "codex:n1", status: "attention" }),
    ];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rollup: any = withDom(() => M.programHeadRollup(agents));
    const label = rollup.attributes["aria-label"] ?? "";
    expect(label).toContain("Program rollup"); // extends the drawer's group name…
    expect(label).toContain("3 agents");        // …and carries the data itself
    expect(label).toContain("2 working");
    expect(label).toContain("1 alert");
    /* "session tokens", because this cell sums sessionTotal across the whole
       program while a ROW's token cell is that agent's latest turn — two
       quantities that must not share one word. */
    expect(label).toContain("30k session tokens");
  });
});

describe("agent-row density pass at ≥1440px (C3)", () => {
  // The compact rule is a single min-width:1440px media block holding one
  // .agent-row override with the inner rule on one line, so it closes on the
  // first `\n}` after the query opens — that boundary is the whole block.
  function compactBlock() {
    const idx = styles.indexOf("@media (min-width: 1440px)");
    if (idx < 0) return "";
    const end = styles.indexOf("\n}", idx);
    return end < 0 ? styles.slice(idx) : styles.slice(idx, end + 2);
  }
  // The base .agent-row rule (top of the `agent rows` section) — the comfortable
  // default that must survive untouched below the 1440px breakpoint.
  function baseAgentRow() {
    return styles.match(/\.agent-row\s*\{[^}]*\}/)?.[0] ?? "";
  }

  // (a) A ≥1440px media rule tightens .agent-row vertical padding. The compact
  //     0.35rem is one step down the `agent rows` section's own spacing scale —
  //     it is exactly the .agent-column-header's bottom padding (0.45rem 0.85rem
  //     0.35rem 0.8rem), so the row's dense vertical rhythm at width matches the
  //     header it sits under. Not an invented pixel.
  test("(a) a ≥1440px rule tightens .agent-row vertical padding to the section's 0.35rem step", () => {
    expect(styles).toContain("@media (min-width: 1440px)");
    const block = compactBlock();
    expect(block).toContain(".agent-row");
    // Compact vertical padding, both edges, matched to the header's 0.35rem step.
    expect(block).toContain("padding-top: 0.35rem");
    expect(block).toContain("padding-bottom: 0.35rem");
    // The header whose bottom padding we borrow really is 0.35rem — locks the
    // derivation so a future scale change can't silently orphan the compact value.
    expect(baseAgentRow()).not.toBe("");
    expect(styles).toContain("padding: 0.45rem 0.85rem 0.35rem 0.8rem"); // .agent-column-header
  });

  // (c) The compact override lives ONLY inside min-width:1440px, so it cannot
  //     reach tablet/mobile: the base row keeps its comfortable 0.45rem, and the
  //     compact 0.35rem padding-top appears exactly once — inside that query.
  test("(c) the compact rule is fenced inside min-width:1440px and never leaks below it", () => {
    // The base .agent-row rule is unchanged: comfortable 0.45rem all around.
    expect(baseAgentRow()).toContain("padding: 0.45rem 0.85rem 0.45rem 0.8rem");
    // The compact override exists exactly once, and it is the 1440px block's.
    const overrides = styles.match(/padding-top: 0\.35rem/g) ?? [];
    expect(overrides.length).toBe(1);
    expect(compactBlock()).toContain("padding-top: 0.35rem");
    // It is a min-width query — it cannot match below tablet. No max-width block
    // (the <1024px sheet sweep or the <720px stack) carries the compact row.
    const sweep1024 = styles.slice(styles.indexOf("@media (max-width: 1024px)"), styles.indexOf("@media (max-width: 720px)"));
    expect(sweep1024).not.toContain("padding-top: 0.35rem");
    const stack720 = styles.slice(styles.indexOf("@media (max-width: 720px)"), styles.indexOf("@media (prefers-reduced-motion"));
    expect(stack720).not.toContain("padding-top: 0.35rem");
  });

  // (b) Honest regression guard (not a fresh RED — this passes before the density
  //     rule is written): the <1024px 44px touch sweep must keep its full selector
  //     list, including the one agent-row-scoped control in it (.agent-rename).
  //     The density pass is ≥1440px only; it must not disturb the touch sweep that
  //     wins below 1024px. Binding constraint: 44px touch targets below 1024px.
  test("(b) the <1024px 44px touch sweep keeps its full list incl. the row's rename control", () => {
    const after = styles.slice(styles.indexOf("@media (max-width: 1024px)"));
    const block = after.slice(0, after.indexOf("@media (max-width: 720px)"));
    const sweep = block.match(/[^{}]*\{\s*min-height:\s*44px;\s*\}/)?.[0] ?? "";
    // The row treatment in the sweep: the agent-row rename button.
    expect(sweep).toContain(".agent-rename");
    // The full current list is intact — quote its anchors end-to-end so an
    // accidental drop during the density pass fails here.
    // FE-B: .inspector-tab, .swarm-link, .signal-* and .instruct-form left this
    // list because nothing in the client emits those classes any more — the
    // constraint is unchanged for every control that actually exists.
    expect(sweep).toContain(".view-tab, .btn, #search, .inspector-close, .swarm-anchor");
    expect(sweep).toContain(".program-rename, .agent-rename");
    expect(sweep).toContain(".command-composer textarea, .rename-form input");
    expect(sweep).toContain("min-height: 44px");
  });
});

describe("toolbar on the instrument-rail language (A3)", () => {
  // Interface contract (later WS-C tasks reuse `is-current` unchanged):
  // Interface contract (later WS-C tasks reuse `is-current` unchanged):
  // the active view-tab is ink text + a 2px --signal-rail bottom rail driven
  // by the class `is-current`, never a filled/boxed tab.
  test("active view-tab is an is-current ink signal rail, not a filled tab (Rule 1)", () => {
    const currentRule = styles.match(/\.view-tab\.is-current\s*\{[^}]*\}/)?.[0] ?? "";
    expect(currentRule).toContain("color: var(--ink)");
    expect(currentRule).toContain("var(--signal-rail)");
    // Rule 1 — indicator inks, not flood fills: no --surface fill / boxed tab.
    expect(currentRule).not.toContain("var(--surface)");
    // renderTabs drives the active marker by class, not by aria-pressed styling.
    expect(source).toContain('classList.toggle("is-current"');
  });

  test("the old filled-surface active-tab rule is gone (Rule 1)", () => {
    // Quote the current offending pattern from source and assert it is gone.
    expect(styles).not.toContain(
      '.view-tab[aria-pressed="true"] { color: var(--ink); background: var(--surface)',
    );
    // The active state no longer keys off aria-pressed at all in CSS.
    expect(styles).not.toContain('.view-tab[aria-pressed="true"]');
  });

  test("view-tab count badges render in mono (Rule 2: mono for values)", () => {
    const countRule = styles.match(/\.view-tab \.count\s*\{[^}]*\}/)?.[0] ?? "";
    expect(countRule).toContain("font-family: var(--font-mono)");
  });

  test("the Board tab count takes ember ink from the alerting population, not from its own number", () => {
    /* The modifier is the same one the program rollup's alert cell uses, driven
       by class and never inline (strict CSP). What changed with the single
       board is what it keys on: the Needs-you tab's count WAS the alert count,
       so `count > 0` was the right test there — Board counts the whole live
       fleet, and reusing that test would glow ember for a board with one
       perfectly happy working session on it. */
    const fn = source.match(/function renderTabs\(\) \{[\s\S]*?\n\}/)?.[0] ?? "";
    expect(fn).toContain('view === "board"');
    expect(fn).toContain('classList.toggle("is-alerting", agents.some((a) => alerting(a)))');
    expect(fn).not.toContain('classList.toggle("is-alerting", count > 0)');
    // CSS gives that class ember ink only — no fill (Rule 1: indicator ink, not flood).
    const rule = styles.match(/\.view-tab \.count\.is-alerting\s*\{[^}]*\}/)?.[0] ?? "";
    expect(rule).toContain("color: var(--ember)");
    expect(rule).not.toContain("background");
  });

  /* This pinned the Select button's pressed ink. The button is gone (operator
     directive, 2026-08-05) and its rules went with it — not as tidying, but
     because the CSS census forbids a declared class the client never emits, so
     leaving them would have failed the build. What survives is the rule the
     original test was really defending, applied to the controls that remain:
     a pressed state is an outline plus a tint, never a flood fill. */
  test("no styles survive for the toolbar buttons that were removed", () => {
    expect(styles).not.toContain(".select-toggle");
    expect(styles).not.toContain(".actions-toggle");
  });

  test("index.html seeds is-current on the default tab, and that tab is the board", () => {
    /* renderTabs re-derives the active marker on every render, but the first
       paint before JS runs must already present a current tab.

       The seeded tab is Board, and attention-first survives the merge: the
       Needs-you strip is pinned to the top of Board, so landing here is still
       "what needs a human, with the fleet underneath it" rather than the
       "show me all routine work" landing this seeding was moved off. */
    expect(html).toContain('class="view-tab is-current" data-view="board" aria-pressed="true"');
    // …and the markup order matches the model, so the first tab is the seeded one.
    expect(html.indexOf('data-view="board"')).toBeLessThan(html.indexOf('data-view="history"'));
    expect(M.OPS_VIEWS[0]).toBe("board");
    expect(M.state.view).toBe("board");
    // The three tabs the merge replaced are gone from the markup entirely, so a
    // stale destination cannot be clicked into a view that no longer filters.
    for (const gone of ["needs-you", "now", "waiting"]) {
      expect(html).not.toContain(`data-view="${gone}"`);
    }
  });

  test("a landing view saved under the old vocabulary still lands somewhere", () => {
    // The server stores defaultView and still speaks the pre-Board words. An
    // operator's saved choice must not be silently dropped because the tab it
    // named was absorbed.
    expect(M.landingView("needs-you")).toBe("board");
    expect(M.landingView("now")).toBe("board");
    expect(M.landingView("waiting")).toBe("board");
    expect(M.landingView("history")).toBe("history");
    expect(M.landingView("usage")).toBe("usage");
    // A word neither vocabulary knows resolves to nothing rather than guessing.
    expect(M.landingView("nonsense")).toBeNull();
    expect(M.landingView(undefined)).toBeNull();
  });
});

describe("masthead + program headers share the frame + quiet header language (A4)", () => {
  // Rule 3 — shared frame: the masthead full-width band caps its content at
  // --frame, the same alignment contract the pulse strip and toolbar follow.
  test("masthead aligns its content to the shared --frame (Rule 3)", () => {
    const innerRule = styles.match(/\.masthead-inner\s*\{[^}]*\}/)?.[0] ?? "";
    expect(innerRule).toContain("max-width: var(--frame)");
    expect(innerRule).toContain("margin: 0 auto");
  });

  // The programs band aligns to --frame through its container: #programs lives
  // inside .app-body, the one centered canvas the masthead, summary, and
  // toolbar all share — not its own full-width strip.
  test("the programs band aligns to --frame through its .app-body container (Rule 3)", () => {
    const bodyRule = styles.match(/\.app-body\s*\{[^}]*\}/)?.[0] ?? "";
    expect(bodyRule).toContain("max-width: var(--frame)");
    expect(bodyRule).toContain("margin: 0 auto");
    expect(html).toContain('<section id="programs" class="programs"');
  });

  // Rule 2 — mono for values: the program-header rollup renders counts (data),
  // so they carry --font-mono, like the view-tab count badges (A3). C2 decomposed
  // the single .program-rollup text span into value/label cells (mirroring the
  // drawer's .dw-rollup-value mono), so the mono now lives on .program-rollup-value.
  test("program-header rollup counts render in mono (Rule 2: mono for values)", () => {
    const valueRule = styles.match(/\.program-rollup-value\s*\{[^}]*\}/)?.[0] ?? "";
    expect(valueRule).toContain("font-family: var(--font-mono)");
  });

  // A4 audit finding: .program-alias-tag is a 9px uppercase tracked micro-label
  // exactly like .eyebrow / .agent-column-label / .vital-label — the ratified
  // mono micro-label idiom — but was the one outlier missing --font-mono.
  test("program-alias-tag joins the mono micro-label idiom (Rule 2, A4 finding)", () => {
    const tagRule = styles.match(/\.program-alias-tag\s*\{[^}]*\}/)?.[0] ?? "";
    // Replacement rule: the alias tag now carries mono like every other label.
    expect(tagRule).toContain("font-family: var(--font-mono)");
    // Absence: the old rule that opened straight into font-size, with no
    // font-family, is gone.
    expect(styles).not.toContain(".program-alias-tag { font-size: 9px");
    // It keeps its micro-label furniture (uppercase, tracked, faint ink).
    expect(tagRule).toContain("text-transform: uppercase");
    expect(tagRule).toContain("color: var(--faint)");
  });
});

describe("motion + responsive conformance for the restyled body (A6)", () => {
  // The single 44px touch-sweep rule inside the <1024px block: the selector list
  // that terminates in `{ min-height: 44px; }`. This is the rule the audit says
  // must grow to close the touch-target gaps.
  function touchSweep1024() {
    const after = styles.slice(styles.indexOf("@media (max-width: 1024px)"));
    const block = after.slice(0, after.indexOf("@media (max-width: 720px)"));
    return block.match(/[^{}]*\{\s*min-height:\s*44px;\s*\}/)?.[0] ?? "";
  }

  // A6 finding 1: .filter-chip (toolbar, 30px min-height) was never swept to 44px
  // at any breakpoint — absent from both the 1024px and 720px sweep lists.
  // Binding constraint: 44px touch targets below 1024px.
  test("the <1024px touch sweep now covers the filter chip (A6 finding)", () => {
    expect(touchSweep1024()).toContain(".filter-chip");
  });

  // A6 finding 1: .program-details (programs, 30px) was swept only at ≤720px, so it
  // stayed 30px through the 721–1024px tablet range where the constraint already
  // requires 44px. It graduates into the <1024px sweep.
  test("program-details gets its 44px treatment at <1024px, not just <720px (A6 finding)", () => {
    // Replacement: .program-details is now in the <1024px sweep.
    expect(touchSweep1024()).toContain(".program-details");
    // Absence: the old <720px-only pattern that carried .program-details is gone;
    // the 720px list keeps only the drawer-scoped controls.
    expect(styles).not.toContain(".dw-lin-name, .program-details { min-height: 44px; }");
    // FE-B: .signal-trigger dropped out of this list with the rest of the
    // removed signal-surface board; the drawer-scoped controls are unchanged.
    expect(styles).toContain(
      ".dw-roster-row, .dw-kid, .dw-lin-name { min-height: 44px; }",
    );
  });

  // A6 finding 1: the text inputs were never swept at any breakpoint —
  // .command-composer textarea and .rename-form input — while
  // #search (a sibling input) already was. (.instruct-form input was the third;
  // FE-B removed it with the rest of the orphaned stylesheet, since no element
  // in the client has ever carried that class.)
  test("every text input clears 44px below 1024px (A6 finding)", () => {
    const sweep = touchSweep1024();
    expect(sweep).toContain(".command-composer textarea");
    expect(sweep).toContain(".rename-form input");
    expect(styles).not.toContain(".instruct-form");
  });

  // A6 finding 2 — Rule 6 (motion respects prefers-reduced-motion). Honest
  // regression guard, not a fresh RED: WS-A (b4f9d80..d516ad7) added and removed
  // no @keyframes or `animation:` declarations, so the pre-existing universal
  // guard already disables the full animation set. This locks that guarantee.
  test("reduced-motion universally disables the full WS-A animation set (A6 regression guard)", () => {
    const reduced = styles.match(/@media \(prefers-reduced-motion: reduce\)\s*\{[\s\S]*?\n\}/)?.[0] ?? "";
    // Universal selector + !important: disables ANY animation/transition regardless
    // of specificity — every current keyframe and any a later task might add.
    expect(reduced).toContain("*, *::before, *::after");
    expect(reduced).toContain("animation: none !important");
    expect(reduced).toContain("transition: none !important");
    // The full existing animation set the guard covers.
    const keyframes = [...styles.matchAll(/@keyframes\s+([\w-]+)/g)].map((m) => m[1]).sort();
    // sk-pulse is the first-paint skeleton shimmer; it is inside the universal
    // guard above like every other one, which is what this list exists to force
    // a new animation's author to confirm.
    /* cleanup-spin joined this list with S6-T3 — the sweep indicator on the
       instrument-trust chip. Confirmed covered, which is what this list exists
       to force: the universal rule above kills it like every other keyframe, and
       a second reduced-motion block gives it a STATIC marker (dashed, closed
       ring) so the chip still shows a process is underway rather than going
       blank. Live verification of that variant is impossible here — the harness
       cannot emulate prefers-reduced-motion — so it is asserted at rule level
       and recorded as unverified rather than claimed. */
    expect(keyframes).toEqual(["chat-message-enter", "chat-tool-enter", "chat-tool-reveal", "cleanup-spin", "conn-beat", "drawer-in", "dw-pulse", "sheet-up", "sk-pulse", "sun-pulse"]);
    const staticVariant = styles.slice(styles.lastIndexOf("@media (prefers-reduced-motion: reduce)"));
    expect(staticVariant).toContain(".verdict-cleanup.is-running .verdict-cleanup-mark");
    expect(staticVariant).toContain("animation: none");
    // Every live `animation:` usage keys off one of those keyframes — none escapes.
    const animated = [...styles.matchAll(/animation:\s*([\w-]+)/g)].map((m) => m[1]).filter((n) => n !== "none");
    expect(new Set(animated)).toEqual(new Set(keyframes));
    const chatMotion = styles.slice(styles.indexOf("@media (prefers-reduced-motion: no-preference)", styles.indexOf(".chat-tool-group")));
    expect(chatMotion).toContain(".chat-entry.chat-msg { animation: chat-message-enter");
    expect(chatMotion).toContain(".chat-entry.chat-tool-group { animation: chat-tool-enter");
    expect(chatMotion).toContain(".chat-tool-card[open] .chat-tool-output { animation: chat-tool-reveal");
  });
});

describe("peripheral surfaces conform to the design language (A5)", () => {
  // A5 audit finding: the .usage-table "Recent invocations" rows render Tokens,
  // Cost, and Session-ID cells — token/cost values and a literal identifier, the
  // exact subjects of Rule 2 — yet they rendered in plain --font-ui with no mono
  // treatment, unlike .row-fact-value / .swarm-chip / .artifact-path elsewhere.
  // Rule 2 — mono for values only.
  test("usage-table token/cost/session values render in mono (Rule 2, A5 finding)", () => {
    // Replacement rule: a mono modifier scoped to the invocation-table value cells.
    const valRule = styles.match(/\.usage-table td\.usage-val\s*\{[^}]*\}/)?.[0] ?? "";
    expect(valRule).toContain("font-family: var(--font-mono)");
    // The render tags the Tokens, Cost, and Session value cells with it...
    expect(source).toContain('class: "usage-val", text: row.tokens == null');
    expect(source).toContain('class: "usage-val", text: row.costUsd == null');
    expect(source).toContain('el("td", { class: "usage-val" }, sessionCell)');
    // ...and leaves the prose columns (When / Provider / Model) in --font-ui, so
    // the test fails if mono is over-applied to non-value cells.
    expect(source).not.toContain('class: "usage-val", text: row.startTime');
    expect(source).not.toContain('class: "usage-val", text: row.provider');
    expect(source).not.toContain('class: "usage-val", text: modelShort');
  });

  // A5 audit finding: .toast.err carried a hardcoded #f4c9bd text color — a magic
  // hex outside the token vocabulary (DESIGN-LANGUAGE §5 open q5, "non-token
  // hexes"). Tokenize it as a light-ember mix on --surface, the file's soft-tint
  // idiom, so the error-toast text stays inside the vocabulary.
  test("toast error text is tokenized, not a hardcoded hex (§5 non-token hexes, A5 finding)", () => {
    const errRule = styles.match(/\.toast\.err\s*\{[^}]*\}/)?.[0] ?? "";
    // Absence: the magic hex is gone from the rule and the whole sheet.
    expect(errRule).not.toContain("#f4c9bd");
    expect(styles).not.toContain("color: #f4c9bd");
    // Replacement: the text tint is built from vocabulary tokens.
    expect(errRule).toContain("color: color-mix(in srgb, var(--ember)");
    expect(errRule).toContain("var(--surface)");
    // The status border stays the --bad token.
    expect(errRule).toContain("border-color: var(--bad)");
  });
});

/* Scroll shell + sticky headers (Emilio 2026-07-23).
   Part 0 root cause: the `flex:none` .health-rail hosts an unbounded inline
   expansion (#widget-customizer); on the fragile height:100%
   body box (overflow-y computes to auto) that chrome can exceed the viewport and
   the DOCUMENT scrolls, carrying masthead + summary away. The fix is a 100dvh app
   frame with bounded expansions + contained pane scrolling; sticky program/column
   headers within the roster; a capped tree indent. Intent-test idioms only. */
describe("scroll shell: 100dvh app frame + contained pane scrolling (Part 1)", () => {
  // (a) The body is a dynamic-viewport FLOOR (scroll-ownership revision,
  //     2026-08-09): the old definite-height + clip frame divided ONE viewport
  //     between the masthead and the cockpit, so growing chrome crushed the
  //     drawer — measured at a 28px chat feed holding 1,436px of turns. The
  //     document scrolls now; min-height keeps the quiet-board footing, with
  //     the 100vh fallback line before dvh for old engines.
  test("(a) the shell floors at 100dvh and lets the document scroll", () => {
    const bodyRule = styles.match(/\nbody\s*\{[^}]*\}/)?.[0] ?? "";
    expect(bodyRule).toContain("min-height: 100vh");   // fallback line
    expect(bodyRule).toContain("min-height: 100dvh");  // dynamic viewport floor
    // The full-width strip guard stays; the vertical clip is gone from the
    // document — it survives only under the true-modal sheet (see FE-C's
    // scroll-ownership test).
    expect(bodyRule).toContain("overflow-x: hidden");
    expect(bodyRule).not.toMatch(/overflow-y\s*:/);
  });

  // (a) Both desktop scroll surfaces contain their scroll — no chaining to the
  //     page when a pane hits its end — and the inspector gains a stable gutter.
  test("(a) both panes carry overscroll-behavior: contain; inspector adds a stable gutter", () => {
    expect(styles).toMatch(/\.pane-list\s*\{[^}]*overscroll-behavior:\s*contain/);
    expect(styles).toMatch(/\.pane-inspector\s*\{[^}]*overscroll-behavior:\s*contain/);
    expect(styles).toMatch(/\.pane-inspector\s*\{[^}]*scrollbar-gutter:\s*stable/);
  });

  // (a) The summary strip's inline expansion is the Part-0 culprit: `flex:none`
  //     chrome with no height bound. It gets a max-height + internal scroll so the
  //     chrome can never push the document into scrolling. (The findings ledger was
  //     the second such expansion; it was deleted outright on 2026-08-05.)
  test("(a) the customizer expansion is height-bounded with internal scroll", () => {
    const customizer = styles.match(/\.widget-customizer\s*\{[^}]*\}/)?.[0] ?? "";
    // vh fallback line before the dvh bound, matching the body's fallback discipline.
    expect(customizer).toContain("max-height: min(50vh");
    expect(customizer).toContain("max-height: min(50dvh");
    expect(customizer).toContain("overflow-y: auto");
  });

  // (e) Regression guard: the <1024px full-sheet fixed-inspector contract is a
  //     DIFFERENT contract and must stay untouched.
  test("(e) the <1024px fixed-inspector contract is unchanged", () => {
    const after = styles.slice(styles.indexOf("@media (max-width: 1024px)"));
    const block = after.slice(0, after.indexOf("@media (max-width: 720px)"));
    // Bind the three invariants to the ONE extracted .pane-inspector rule, so the
    // guard can't pass on stray matches elsewhere in the block.
    const inspRule = block.match(/\.pane-inspector\s*\{[^}]*\}/)?.[0] ?? "";
    expect(inspRule).not.toBe("");
    expect(inspRule).toContain("position: fixed");
    expect(inspRule).toContain("inset: 0");
    // The desktop shell is not forced onto it: no dvh height leaks into the sheet.
    expect(inspRule).not.toContain("height: 100dvh");
  });
});
describe("scroll shell: sticky left-pane headers (Part 2)", () => {
  // (b) The program head pins to the top of the roster scroll with an OPAQUE
  //     surface so rows occlude under it, above the rows in z.
  test("(b) .program-head is sticky at top:0 with an opaque --surface background", () => {
    const head = styles.match(/\.program-head\s*\{[^}]*\}/)?.[0] ?? "";
    expect(head).toContain("position: sticky");
    expect(head).toContain("top: 0");
    expect(head).toContain("background: var(--surface)");
    expect(head).toMatch(/z-index:\s*\d/);
    // Prevented from wrapping so its stuck height is a stable single line.
    expect(head).toContain("flex-wrap: nowrap");
  });

  // (b) The band head is the TOP of the frozen stack: the program name used to
  //     be the first thing to scroll off screen — the tier the operator ranks
  //     by was the only one that could be absent.
  test("(b) the repo band head pins at the top of the stack, opaque", () => {
    const head = styles.match(/\.repo-head\s*\{[^}]*\}/)?.[0] ?? "";
    expect(head).toContain("position: sticky");
    expect(head).toContain("top: 0");
    expect(head).toContain("background: var(--surface)");
    expect(head).toContain("flex-wrap: nowrap");
    // The worktree rule is the stack's middle tier, under band head + columns.
    const banded = styles.match(/\.program\.is-banded \.program-head\s*\{[^}]*\}/)?.[0] ?? "";
    expect(banded).toContain("top: calc(var(--repo-head-h) + var(--column-head-h))");
    // The band card keeps the sticky escape the worktree card learned: clip.
    const band = styles.match(/\.repo-section\s*\{[^}]*\}/)?.[0] ?? "";
    expect(band).toContain("overflow: clip");
    expect(band).not.toContain("overflow: hidden");
  });

  // (b) The column header pins directly below its stuck head, keeping its
  //     opaque --sand: the flat program's copy under --program-head-h, the
  //     band's one copy under --repo-head-h.
  test("(b) .agent-column-header is sticky below its head, keeping --sand", () => {
    const col = styles.match(/^\.agent-column-header\s*\{[^}]*\}/m)?.[0] ?? "";
    expect(col).toContain("position: sticky");
    expect(col).toContain("top: var(--program-head-h)");
    expect(col).toContain("background: var(--sand)"); // already opaque, preserved
    expect(styles).toContain(".repo-section > .agent-column-header { top: var(--repo-head-h); z-index: 3; }");
    // The offset vars are defined (and re-pointed where the touch sweep grows the head).
    expect(styles).toContain("--program-head-h:");
    expect(styles).toContain("--repo-head-h:");
  });

  // (b) The `.program { overflow: hidden }` scroll-scope is what breaks sticky
  //     (probe D: head scrolls to -269 under hidden). `clip` keeps the rounded
  //     corners AND lets the head pin to the roster.
  test("(b) .program uses overflow: clip (not hidden) so sticky escapes the card scope", () => {
    const prog = styles.match(/\.program\s*\{[^}]*\}/)?.[0] ?? "";
    expect(prog).toContain("overflow: clip");
    expect(prog).not.toContain("overflow: hidden");
  });

  // (c) Keyboard parity: focused rows clear the DEEPEST frozen stack (band
  //     head + column header + worktree rule) so Tab/arrow focus never lands
  //     hidden beneath the frozen headers.
  test("(c) rows carry scroll-margin-top equal to the frozen stack", () => {
    // Both focusable roster elements — agent rows AND swarm anchors — clear the stack.
    const row = styles.match(/\.agent-row\s*\{[^}]*\}/)?.[0] ?? "";
    expect(row).toContain("scroll-margin-top:");
    expect(row).toContain("var(--repo-head-h)");
    expect(row).toContain("var(--column-head-h)");
    expect(row).toContain("var(--worktree-head-h)");
    const anchor = styles.match(/\.swarm-anchor\s*\{[^}]*\}/)?.[0] ?? "";
    expect(anchor).toContain("scroll-margin-top:");
    expect(anchor).toContain("var(--repo-head-h)");
    expect(anchor).toContain("var(--column-head-h)");
    // The offset vars are defined together on the scroll container.
    expect(styles).toMatch(/\.pane-list\s*\{[^}]*--repo-head-h:/);
    expect(styles).toMatch(/\.pane-list\s*\{[^}]*--column-head-h:/);
  });
});
describe("scroll shell: capped tree indent for deep swarms (Part 3)", () => {
  // (d) Deep nesting stops indenting past level 3 (N·step: 3·1.3rem + 0.8rem base
  //     = 4.7rem = 75px ≤ 25% of the 380px min pane); depth colour + chips carry
  //     the deeper hierarchy. The cap must bind at EVERY indenting site, not just
  //     one file-wide match — so each rule is extracted and checked on its own.
  test("(d) the cap min(var(--tree-depth), 3) binds at all four indenting sites", () => {
    // 1. desktop child row indent
    const isChild = styles.match(/\.agent-row\.is-child\s*\{[^}]*\}/)?.[0] ?? "";
    expect(isChild).toContain("min(var(--tree-depth), 3) * 1.3rem");
    // 2. connector rail (tracks the same cap so it stays aligned)
    const connector = styles.match(/\.agent-row\.is-child::before\s*\{[^}]*\}/)?.[0] ?? "";
    expect(connector).toContain("(min(var(--tree-depth), 3) - 1) * 1.3rem");
    // 3. swarm anchor indent (matches the row indent)
    const anchor = styles.match(/\.swarm-anchor\.is-child\s*\{[^}]*\}/)?.[0] ?? "";
    expect(anchor).toContain("min(var(--tree-depth), 3) * 1.3rem");
    // 4. the ≤720px mobile step rule (smaller 0.85rem step)
    const mobile = styles.slice(styles.indexOf("@media (max-width: 720px)"), styles.indexOf("@media (prefers-reduced-motion"));
    const mChild = mobile.match(/\.agent-row\.is-child\s*\{[^}]*\}/)?.[0] ?? "";
    expect(mChild).toContain("min(var(--tree-depth), 3) * 0.85rem");
    // Absence: no uncapped multiplier survives at any width (the ", 3)" between
    // the var and the operator means the capped form is not a false match here).
    expect(styles).not.toContain("var(--tree-depth) * 1.3rem");
    expect(styles).not.toContain("var(--tree-depth) * 0.85rem");
  });
});

/* Review fixes (2026-07-23): the fix's own edge cases. */
describe("scroll shell: review fixes", () => {
  // (1 Important) The findings ledger and the widget customizer were BOTH
  //   flex:none summary-strip expansions; opening both at once was 918px > 900px
  //   at 1440×900 (clipped invisibly by body overflow-y:clip). They were made
  //   mutually exclusive; deleting the ledger (2026-08-05) removes the collision
  //   at its source. The invariant that survives is the one that caused it: the
  //   summary strip hosts exactly ONE expansion, so two can never stack again.
  test("(1) the summary strip hosts exactly one expansion", () => {
    const handler = source.match(/"customize-summary"\)\.addEventListener\("click",\s*\(\)\s*=>\s*\{[\s\S]*?\}\);/)?.[0] ?? "";
    expect(handler).toContain("state.widgetCustomizerOpen = !state.widgetCustomizerOpen");
    /* One expansion inside #health-rail, and it is the customizer — counted by
       the control that opens one rather than by `hidden`. Counting hidden nodes
       was a proxy, and it held only while the customizer was the sole hidden
       thing in the rail: S2-T3 added the scan-window statement, which hides when
       the server has not confirmed a window and is a QUALIFIER on the readings,
       not a second expansion. "How many things here expand" is the claim; "how
       many are hidden" was a way of guessing at it. */
    const rail = html.match(/<section id="health-rail"[\s\S]*?<\/section>/)?.[0] ?? "";
    expect(rail).toContain('id="widget-customizer"');
    expect(rail.match(/aria-controls="/g)?.length ?? 0).toBe(1);
    expect(rail).toContain('aria-controls="widget-customizer"');
    expect(rail.match(/aria-expanded="/g)?.length ?? 0).toBe(1);
  });

  // (2 Important) The nowrap rollup sits inside a .program overflow:clip card, so
  //   at narrow widths the fixed cluster was cropped with zero indication. It must
  //   shrink HONESTLY (min-width:0 + per-cell overflow), the alerts cell must never
  //   shrink (last to go, always legible), and the least-critical tokens cell is
  //   dropped outright at ≤720px.
  test("(2) the rollup shrinks honestly and never crops the alerts cell", () => {
    const rollup = styles.match(/\.program-rollup\s*\{[^}]*\}/)?.[0] ?? "";
    expect(rollup).toContain("min-width: 0");
    expect(rollup).toContain("flex: 0 1 auto");   // shrinks after the name truncates
    /* The cells no longer shrink-and-clip individually. Docked at 1440 that
       produced "169 a…  13 wo…  1 alert  1.15B t…" — the shrink order was
       carefully tuned and the outcome was still fragments. The row wraps to a
       second line instead, so no cell is ever cropped and the alerts cell needs
       no special pinning to survive. */
    expect(rollup).toContain("flex-wrap: wrap");
    const cell = styles.match(/\.program-rollup-cell\s*\{[^}]*\}/)?.[0] ?? "";
    expect(cell).not.toContain("overflow: hidden");
    // The tokens cell (tagged by JS with a key) is dropped on narrow screens.
    expect(source).toContain('label: "session tokens", key: "tokens"');
    expect(source).toContain('" program-rollup-cell--" + c.key');
    const mobile = styles.slice(styles.indexOf("@media (max-width: 720px)"), styles.indexOf("@media (prefers-reduced-motion"));
    expect(mobile).toContain(".program-rollup-cell--tokens { display: none; }");
    // The alerts cell is never targeted for dropping.
    expect(styles).not.toContain(".program-rollup-cell.is-alerting { display: none");
  });
});

/* ---------------------------------------------------------------------------
   Wave 1 / FE-A — dead controls and the lying Live badge.

   Every test below asserts BEHAVIOR (a returned verdict, a computed signature,
   a built node), never a source substring: the bugs in this lane all survived a
   suite that only grepped app.js text. Paint-signature tests follow one shape —
   flip exactly one field and require the signature to move — because a signature
   that omits a field is precisely how a control becomes a dead click.
--------------------------------------------------------------------------- */
describe("FE-A: snapshot freshness drives the connection verdict", () => {
  const NOW = Date.parse("2026-07-28T12:00:00.000Z");
  const ago = (ms: number) => new Date(NOW - ms).toISOString();

  test("freshness is measured on the data, in three honest bands", () => {
    expect(M.snapshotFreshness(ago(4_000), NOW).state).toBe("fresh");
    expect(M.snapshotFreshness(ago(15_000), NOW).state).toBe("fresh");   // inclusive edge
    expect(M.snapshotFreshness(ago(15_001), NOW).state).toBe("lagging");
    expect(M.snapshotFreshness(ago(60_000), NOW).state).toBe("lagging"); // inclusive edge
    expect(M.snapshotFreshness(ago(60_001), NOW).state).toBe("stale");
    expect(M.snapshotFreshness(ago(91 * 3_600_000), NOW)).toEqual({ state: "stale", ageMs: 91 * 3_600_000 });
    // A clock skew that puts generatedAt in the future is not "negative age".
    expect(M.snapshotFreshness(new Date(NOW + 5_000).toISOString(), NOW)).toEqual({ state: "fresh", ageMs: 0 });
    // No verdict is claimed when there is nothing to measure.
    for (const bad of [undefined, null, "", "not-a-date"]) {
      expect(M.snapshotFreshness(bad, NOW)).toEqual({ state: "unknown", ageMs: null });
    }
  });

  /* THE regression. Production served a 91-hour-old snapshot under a green
     "Live" badge because the only staleness check read the heartbeat clock, and
     the server heartbeats every 25s under a 60s threshold — so a heartbeat that
     landed one millisecond ago (lastEventAt === now) always won. The verdict now
     takes the heartbeat clock AND the data age, and the data age must be able to
     override a perfectly healthy pipe. */
  test("a heartbeat that just landed cannot make a frozen snapshot read as Live", () => {
    expect(M.connVerdictFor({ open: true, lastEventAt: NOW, generatedAt: ago(91 * 3_600_000), now: NOW })).toBe("stale");
    expect(M.connVerdictFor({ open: true, lastEventAt: NOW, generatedAt: ago(61_000), now: NOW })).toBe("stale");
    // …and a fresh snapshot still reads Live, so the badge is not merely pessimistic.
    expect(M.connVerdictFor({ open: true, lastEventAt: NOW, generatedAt: ago(3_000), now: NOW })).toBe("live");
    // A silent socket (no event of any kind for a full stale window) is still stale
    // even when the last snapshot it delivered was fresh at the time.
    expect(M.connVerdictFor({ open: true, lastEventAt: NOW - 61_000, generatedAt: ago(3_000), now: NOW })).toBe("stale");
    // Boot: the socket is open but no snapshot has landed — no stale claim yet.
    expect(M.connVerdictFor({ open: true, lastEventAt: 0, generatedAt: null, now: NOW })).toBe("live");
    // A closed/failed socket is owned by onerror and the health poll, not here.
    expect(M.connVerdictFor({ open: false, lastEventAt: NOW, generatedAt: ago(3_000), now: NOW })).toBeNull();
  });

  test("the badge shows the actual snapshot age as soon as it stops being fresh", () => {
    expect(M.connLabelText("live", ago(3_000), NOW)).toBe("Live");
    expect(M.connLabelText("live", ago(40_000), NOW)).toBe("Live · snapshot 40s ago");
    expect(M.connLabelText("stale", ago(91 * 3_600_000), NOW)).toBe("Stale feed · snapshot 3.8d ago");
    // Nothing measurable → no fabricated age suffix.
    expect(M.connLabelText("live", null, NOW)).toBe("Live");
    expect(M.connLabelText("connecting", ago(91 * 3_600_000), NOW)).toBe("Connecting");
    expect(M.connLabelText("offline", ago(91 * 3_600_000), NOW)).toBe("Server unreachable");
  });
});

describe("FE-A: the dead SSE stream recovers instead of painting hours-old state", () => {
  const NOW = 1_000_000;

  test("a CLOSED stream is re-armed, with backoff, and OPEN resets the backoff", () => {
    // 2 = CLOSED. EventSource never retries this state on its own.
    const first = M.reconnectPlan(2, NOW, 0, 0);
    expect(first.reconnect).toBe(true);
    expect(first.attempts).toBe(1);
    expect(first.dueAt).toBe(NOW + 2_000);
    // Inside the backoff window the poll must not hammer a server that is down.
    expect(M.reconnectPlan(2, NOW + 500, first.attempts, first.dueAt)).toEqual({
      reconnect: false, attempts: 1, dueAt: first.dueAt,
    });
    // Backoff grows and then caps at 30s rather than running away.
    expect(M.reconnectPlan(2, NOW, 1, 0).dueAt).toBe(NOW + 4_000);
    expect(M.reconnectPlan(2, NOW, 9, 0).dueAt).toBe(NOW + 30_000);
    // 0 = CONNECTING: a retry is already in flight, leave it alone.
    expect(M.reconnectPlan(0, NOW, 3, 0)).toEqual({ reconnect: false, attempts: 3, dueAt: 0 });
    // 1 = OPEN: healthy again, so the next outage starts from a clean backoff.
    expect(M.reconnectPlan(1, NOW, 4, NOW + 30_000)).toEqual({ reconnect: false, attempts: 0, dueAt: 0 });
  });

  test("an unhealthy feed falls back to polling the snapshot, throttled", () => {
    expect(M.fallbackPollDue("live", NOW, NOW - 600_000, 0)).toBe(false);      // healthy: never poll
    expect(M.fallbackPollDue("stale", NOW, NOW - 61_000, 0)).toBe(true);       // wedged collector
    expect(M.fallbackPollDue("reconnecting", NOW, NOW - 61_000, 0)).toBe(true);
    expect(M.fallbackPollDue("reconnecting", NOW, NOW - 10_000, 0)).toBe(false); // give the stream a chance first
    expect(M.fallbackPollDue("offline", NOW, NOW - 61_000, NOW + 5_000)).toBe(false); // throttle window
  });
});

describe("FE-A: every snapshot transport uses the one apply path", () => {
  test("both stream envelopes resolve to a snapshot; anything else is not one", () => {
    const snap = snapshot();
    expect(M.eventSnapshot(snap)).toBe(snap);                     // bare snapshot event
    expect(M.eventSnapshot({ snapshot: snap })).toBe(snap);       // wrapped envelope
    // Unknown event kinds resolve to null, which handleEventPayload turns into a
    // refetch rather than adopting a half-understood payload.
    expect(M.eventSnapshot({ type: "heartbeat" })).toBeNull();
    expect(M.eventSnapshot({ schemaVersion: 2, programs: [] })).toBeNull();
    expect(M.eventSnapshot(null)).toBeNull();
    expect(M.eventSnapshot(undefined)).toBeNull();
  });
});

describe("FE-A: a failed snapshot refresh is visible instead of swallowed", () => {
  test("fetchFailed degrades the health verdict and names itself", () => {
    const healthy = snapshot();
    expect(M.systemStatus(healthy, "live", false).label).toBe("Operational");
    expect(M.systemStatus(healthy, "live", true)).toMatchObject({ key: "degraded", label: "Degraded", tone: "degraded" });
    // Degraded tone is what puts the existing Refresh affordance on screen.
    const failed = M.summaryWidgetData("health", healthy, "live", "percent", [], true);
    expect(failed.tone).toBe("degraded");
    // The card headlines the SEVERITY, not the generic verdict — a failed
    // refresh is the "Stale" kind, which is what the operator needs to read.
    expect(failed.value).toBe("Readings degraded");
    expect(failed.severityKey).toBe("stale");
    expect(failed.sublabel).toContain("refresh failed");
    expect(M.summaryWidgetData("health", healthy, "live", "percent", [], false).sublabel).not.toContain("refresh failed");
  });
});

/* Screenshot on the live board: the HEALTH card's headline read "Degraded" in
   amber, and directly beneath it a badge read ADVISORY over the sentence "The
   board is usable; evidence needs tidying." The card argued with itself, and an
   advisory carried the identical visual weight as an unreachable control plane.
   The headline has to be the severity it is actually reporting. */
describe("the health card's headline agrees with its own severity", () => {
  const advisory = () => snapshot({
    totals: { live: 1, tracked: 1, attention: 0, working: 1, idle: 0, history: 0,
      sourceHealth: { healthy: 1, degraded: 1, absent: 0, total: 2 } },
  });

  test("an advisory says Advisory, not Degraded", () => {
    const snap = advisory();
    // The underlying system verdict is unchanged — it is the CARD that lied.
    expect(M.systemStatus(snap, "live", false).label).toBe("Degraded");
    expect(M.degradedSeverity(snap, "live", false).key).toBe("advisory");

    const card = M.summaryWidgetData("health", snap, "live", "percent", [], false);
    expect(card.value).toBe("Readings degraded");
    expect(card.severityKey).toBe("advisory");
    expect(card.value).not.toBe("Degraded");
    expect(card.tone).toBe("advisory");
    // The consequence sentence travels with the data so the card can render it
    // without asking degradedSeverity a second question.
    expect(card.severityKey).toBe("advisory");
    expect(card.severityDetail).toContain("usable");
    expect(card.sublabel).toContain("degraded source");
  });

  test("a blocking or stale problem keeps its full weight", () => {
    const blocked = snapshot({ controlHealth: { cmuxReachable: false, lastCheckedAt: "", errors: [], staleSources: [] } });
    const blockedCard = M.summaryWidgetData("health", blocked, "live", "percent", [], false);
    expect(blockedCard.value).toBe("Readings degraded");
    expect(blockedCard.severityKey).toBe("blocking");
    expect(blockedCard.tone).toBe("degraded");

    const stale = M.summaryWidgetData("health", snapshot(), "live", "percent", [], true);
    expect(stale.value).toBe("Readings degraded");
    expect(stale.severityKey).toBe("stale");
    expect(stale.tone).toBe("degraded");
    expect(stale.sublabel).toContain("refresh failed");

    /* S2-T2: the headline is one word about the INSTRUMENTS in every state, and
       the severity that used to be that headline rides on severityKey — so the
       two still cannot disagree, which is what this test has always been for.
       (Before S2-T2 the healthy card read "All clear" rather than "Operational": the status
       KEY is still `operational`, but the card speaks the operator's word for
       it instead of the system's. Only the wording moved — this test's subject,
       that blocking and stale keep their full weight, is asserted above. */
    expect(M.summaryWidgetData("health", null, "offline").value).toBe("Readings unavailable");
    expect(M.summaryWidgetData("health", snapshot(), "live", "percent", [], false).value).toBe("Readings healthy");
  });

  test("an advisory is rendered lighter than a real degradation", () => {
    const weightOf = (snap: unknown, failed: boolean) =>
      M.pulseStripModel(snap, "live", [], "percent", "").cells.find((c: { id: string }) => c.id === "health").weight;
    /* Advisory used to shrink to micro on the reasoning that "in both cases
       there is nothing for the operator to do right now". That premise no
       longer holds: a non-clear verdict now carries a remedy and a pane list,
       and micro renders the headline alone — so shrinking it deletes the answer
       the card exists to give. An advisory keeps its cell.

       The subject of this test is unchanged and still asserted, one layer down:
       advisory is LIGHTER than a real degradation. That distinction now lives
       in tone (amber `advisory` vs `degraded`), which is where a severity
       difference belongs — not in whether the operator is shown what to do. */
    expect(weightOf(advisory(), false)).toBe("normal");
    expect(M.summaryWidgetData("health", advisory(), "live", "percent", [], false).tone).toBe("advisory");
    // A blocking problem stays full size, and reads at the heavier tone.
    const blocked = snapshot({ controlHealth: { cmuxReachable: false, lastCheckedAt: "", errors: [], staleSources: [] } });
    expect(weightOf(blocked, false)).toBe("normal");
    expect(M.summaryWidgetData("health", blocked, "live", "percent", [], false).tone).toBe("degraded");
    /* A clear board no longer rides at micro — it does not ride at all. "Nothing
       is wrong" is now said by the cell being absent rather than by a quiet chip
       asserting it, which is the convention audit §5 asked for. */
    expect(M.pulseStripModel(snapshot(), "live", [], "percent", "").cells
      .find((c: { id: string }) => c.id === "health")).toBeUndefined();
  });

  test("shrinking the advisory cell does not delete its explanation", async () => {
    // At micro weight the health cell is just a chip, so the consequence
    // sentence has nowhere to live but the title. Losing the alarm must not
    // also lose the reason.
    let chip: any;
    await withState({ snap: advisory() }, () => withDom(() => {
      chip = M.renderSummaryWidget("health", "micro",
        M.summaryWidgetData("health", advisory(), "live", "percent", [], false));
    }));
    expect(textOf(chip)).toContain("Readings degraded");
    expect(textOf(chip)).not.toContain("AdvisoryAdvisory"); // the old duplicate badge
    // The chip itself is the only node left, so read its title directly.
    expect(chip.children[0].attributes.title).toContain("usable");
  });

  test("a full-weight degradation states its severity once, not twice", async () => {
    const blocked = snapshot({ controlHealth: { cmuxReachable: false, lastCheckedAt: "", errors: [], staleSources: [] } });
    let card: any;
    await withState({ snap: blocked }, () => withDom(() => {
      card = M.renderSummaryWidget("health", "normal",
        M.summaryWidgetData("health", blocked, "live", "percent", [], false));
    }));
    const text = textOf(card);
    expect(text).toContain("Readings degraded");
    // The removed badge rendered the severity label a second time in caps.
    expect(text).not.toContain("BLOCKING");
    // The consequence sentence survives at full weight, in the body.
    expect(text).toContain("Focus and Send");
  });
});

/* Screenshot from the live board: 56 rows all reading "Claude · the-mountain-main"
   — same provider, same working directory, several on the same model — with
   nothing on the row to tell one live agent from another. The name is genuinely
   not unique; the session id is. */
describe("rows with identical names carry a disambiguator", () => {
  const twin = (id: string, session: string) => agent({
    id, sourceSessionId: session, provider: "claude", displayName: "Claude · the-mountain-main",
  });

  test("sessionTag is short, stable, and derived from the session's own identity", () => {
    expect(M.sessionTag(twin("claude:9b66776a", "9b66776a-e6c3-4a73-937e-2079b4b92084"))).toBe("2079b4b92084".slice(-8));
    // Stable across calls — a disambiguator that moves is worse than none.
    const a = twin("claude:x", "60224113-57b0-4948-94bb-6a8f10019216");
    expect(M.sessionTag(a)).toBe(M.sessionTag(a));
    // Falls back to the agent id when no session id was reported, and never
    // invents one for an agent with neither.
    expect(M.sessionTag({ id: "codex:abcdef12-3456" })).toBeTruthy();
    expect(M.sessionTag(null)).toBe("");
    expect(M.sessionTag({})).toBe("");
  });

  /* The bug the first implementation shipped with. Codex issues UUIDv7, whose
     leading segment is a TIMESTAMP: four real sessions started in the same
     minute all tagged "#019fb496" and told the operator nothing. These ids are
     verbatim from the live board. */
  test("sessions that share a UUIDv7 timestamp prefix still get distinct tags", () => {
    const realCodexIds = [
      "019fb496-eb57-7430-8c2c-dec15174ebc5",
      "019fb496-d560-7950-a3e7-71290fde77fd",
      "019fb496-e025-72b1-aba3-09500a01b2aa",
      "019fb496-f419-70b0-acba-2a371519f037",
    ];
    // Every one of these shares the first segment — that is the whole point.
    expect(new Set(realCodexIds.map((id) => id.split("-")[0])).size).toBe(1);
    const tags = realCodexIds.map((id) => M.sessionTag(twin("codex:" + id, id)));
    expect(new Set(tags).size).toBe(realCodexIds.length); // all four distinct
    expect(tags.every((t: string) => t.length === 8)).toBe(true);
  });

  test("ambiguousNames flags only the names that actually repeat", () => {
    const board = [
      twin("claude:1", "aaaaaaaa-1"), twin("claude:2", "bbbbbbbb-2"),
      agent({ id: "codex:3", displayName: "Codex · solo" }),
    ];
    const names = M.ambiguousNames(board);
    expect(names.has("Claude · the-mountain-main")).toBe(true);
    expect(names.has("Codex · solo")).toBe(false); // a unique name stays clean
    expect(M.ambiguousNames([board[2]]).size).toBe(0);
  });

  test("the row shows the tag only when its name is ambiguous", () => {
    const program = { id: "p", name: "P" };
    const dup = twin("claude:1", "9b66776a-e6c3-4a73");
    const ambiguous = M.ambiguousNames([dup, twin("claude:2", "60224113-57b0-4948")]);

    const marked = withDom(() => M.renderAgentRow(dup, program, { ambiguousNames: ambiguous }));
    expect(textOf(marked)).toContain(M.sessionTag(dup));
    // It is reachable to a screen reader as a disambiguator, not decoration.
    expect(marked.attributes["aria-label"]).toContain(M.sessionTag(dup));

    // A row whose name is unique must not be cluttered with a hash.
    const clean = withDom(() => M.renderAgentRow(dup, program, { ambiguousNames: new Set() }));
    expect(textOf(clean)).not.toContain(M.sessionTag(dup));
  });

  test("ambiguity is part of the row signature, so the tag can appear and vanish", () => {
    const dup = twin("claude:1", "9b66776a-e6c3");
    const ui = listUi();
    const withTag = M.agentRowSig(dup, ui, { ambiguousNames: new Set(["Claude · the-mountain-main"]) });
    const withoutTag = M.agentRowSig(dup, ui, { ambiguousNames: new Set() });
    // Without this the row keeps its cached node when a twin appears or leaves.
    expect(withTag).not.toBe(withoutTag);
  });
});

describe("the command dock owns an opaque shell footer", () => {
  // Declarations only — a comment explaining why transparency was removed must
  // not read as transparency still being there.
  const stripComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");
  const dockRule = () => stripComments(styles.match(/\.command-dock\s*\{[^}]*\}/)?.[0] ?? "");

  test("the static footer is opaque and reserves layout space", () => {
    const rule = dockRule();
    expect(rule).not.toBe("");
    expect(rule).toContain("position: static");
    // No transparency in the dock's own background, at any stop.
    expect(rule).not.toContain("transparent");
    expect(rule).toMatch(/background:\s*var\(--raise\)/);
  });

  test("the footer needs no overlay scrim because content ends before it", () => {
    expect(styles).not.toMatch(/\.command-dock::before\s*\{/);
  });
});

describe("FE-A: paint signatures cover the state their surfaces render", () => {
  /* A minimal document is only needed by the el() test; the signature helpers are
     pure functions of (records, ui). */
  function fakeDom() {
    const make = (tag: string) => ({
      nodeType: 1,
      tagName: tag,
      className: "",
      textContent: "",
      dataset: {} as Record<string, string>,
      attributes: {} as Record<string, string>,
      children: [] as unknown[],
      setAttribute(k: string, v: unknown) { this.attributes[k] = String(v); },
      addEventListener() {},
      append(...kids: unknown[]) { this.children.push(...kids); },
    });
    return {
      createElement: (t: string) => make(t),
      createElementNS: (_ns: string, t: string) => make(t),
      createTextNode: (s: string) => ({ nodeType: 3, textContent: String(s) }),
    };
  }
  function withDom<T>(fn: () => T): T {
    (globalThis as unknown as { document: unknown }).document = fakeDom();
    try { return fn(); } finally {
      delete (globalThis as unknown as { document?: unknown }).document;
    }
  }

  // A stand-in for the module's `state`. The signature helpers take it as an
  // argument precisely so a test can flip one field at a time.
  function ui(overrides: Record<string, unknown> = {}) {
    return {
      snap: snapshot(),
      queueItems: [] as unknown[],
      triage: new Map(),
      triagePending: new Set<string>(),
      evidenceOpen: false,
      pending: new Set<string>(),
      feedback: new Map(),
      drafts: new Map(),
      confirming: null,
      renaming: null,
      renameDraft: "",
      renamePending: false,
      renameError: "",
      labelsLoading: false,
      labelLoadError: "",
      view: "now",
      query: "",
      facetProgram: "",
      facetProviders: [],
      lookbackHours: 24,
      selected: null,
      programOverrides: new Map<string, string>(),
      swarmOverrides: new Map<string, string>(),
      // Same default as swarms: collapsed unless the operator opened it.
      shelfOverrides: new Map<string, string>(),
      labels: new Map<string, string>(),
      ...overrides,
    };
  }

  const SEL = { kind: "agent", id: "codex:a1" };
  const program = { id: "p", name: "P", agents: [agent()] };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const agentView = (over: Record<string, unknown> = {}) => ({ kind: "agent", agent: agent(over) as any, program });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const isig = (view: any, u: any) => M.inspectorPaintSig(SEL, view, u);

  /* Finding 1. For an agent selection the old signature collapsed to
     kind/id/"agent"/""/""/""/""/""/""/evidenceOpen — queueItem, triage and issue
     are all undefined for an agent — so ONLY the evidence cog could ever move it.
     render() therefore early-returned for an open agent drawer: clicking
     Interrupt or Archive set state.confirming and repainted nothing, so the
     confirm strip never existed and the button was unreachable. */
  test("(1) the agent drawer signature moves for every interaction flag its controls set", () => {
    const base = isig(agentView(), ui());
    const moves: Array<[string, Record<string, unknown>]> = [
      ["confirming (Interrupt/Archive confirm strip)", { confirming: "act:codex:a1:interrupt" }],
      ["pending (Send busy state)", { pending: new Set(["codex:a1:instruct"]) }],
      ["feedback (control result banner)", { feedback: new Map([["codex:a1", { ok: false, action: "instruct", message: "Send failed" }]]) }],
      ["renaming (Evidence rename form)", { renaming: "agent:codex:a1" }],
      ["renamePending", { renamePending: true }],
      ["renameError", { renameError: "Keep the label under 80 characters." }],
      ["labelsLoading", { labelsLoading: true }],
      ["labelLoadError", { labelLoadError: "bad label response" }],
    ];
    for (const [why, over] of moves) {
      expect(isig(agentView(), ui(over)), why).not.toBe(base);
    }
    // Narrow drawers use this flag to choose which of the two already-painted
    // columns is visible. A cached-identity "View Evidence" click changes no
    // server data, so this flag must move the paint signature by itself.
    expect(isig(agentView(), ui({ evidenceOpen: true }))).not.toBe(base);
    // The confirm strip is instance-scoped, so two different instances of the
    // same action must not share a signature.
    expect(isig(agentView(), ui({ confirming: "head:act:codex:a1:interrupt" })))
      .not.toBe(isig(agentView(), ui({ confirming: "act:codex:a1:interrupt" })));
    // Another agent's pending work must not repaint this drawer.
    expect(isig(agentView(), ui({ pending: new Set(["codex:other:instruct"]) }))).toBe(base);
  });

  test("(1) the agent drawer signature moves for every agent field the drawer paints", () => {
    const base = isig(agentView(), ui());
    const moves: Array<[string, Record<string, unknown>]> = [
      ["status", { status: "attention" }],
      ["statusReason", { statusReason: "Waiting on review." }],
      ["model", { model: "claude-opus-4-8" }],
      ["gates", { gates: ["needs-review"] }],
      ["controls enablement", { controls: [{ action: "focus", enabled: false, reason: "no route" }] }],
      ["tokens", { tokens: { provenance: "observed", total: 99_000, contextWindow: 200_000 } }],
      ["lastHumanMessage", { lastHumanMessage: "ship the fix" }],
      ["lastAgentMessage", { lastAgentMessage: "done" }],
      ["transcriptTail", { transcriptTail: "…tail" }],
      ["cwd", { cwd: "/repos/x" }],
      ["target routing", { target: { resolution: "ambiguous", surfaceId: "s1", workspaceId: "w1" } }],
      ["cwdRelation", { target: { resolution: "exact", surfaceId: "s1", workspaceId: "w1", cwdRelation: "different" } }],
      ["modelPolicy", { modelPolicy: { state: "violation", summary: "off policy" } }],
      ["nextAction", { nextAction: "Review the diff" }],
      ["artifacts", { artifacts: [{ kind: "file", label: "log", path: "/tmp/a.log" }] }],
    ];
    for (const [why, over] of moves) {
      expect(isig(agentView(over), ui()), why).not.toBe(base);
    }
  });

  /* The guard still has to earn its keep: the 4s snapshot cadence must not
     strobe the drawer just because the live clocks moved, and a text box must
     never be torn down while it is being typed into. */
  test("(1) tick-driven clocks and live inputs deliberately do NOT move the signature", () => {
    const base = isig(agentView({ elapsedMs: 60_000, updatedAt: "2026-07-22T03:00:00.000Z" }), ui());
    // tickClocks() rewrites these in place from data-elapsed-base / data-ago.
    expect(isig(agentView({ elapsedMs: 61_000, updatedAt: "2026-07-22T03:00:00.000Z" }), ui())).toBe(base);
    expect(isig(agentView({ elapsedMs: 60_000, updatedAt: "2026-07-22T03:00:04.000Z" }), ui())).toBe(base);
    // …but their PRESENCE still matters: a tile appears when the field arrives.
    expect(isig(agentView({ updatedAt: "2026-07-22T03:00:00.000Z" }), ui())).not.toBe(base);
    // The instruct composer keeps its text across snapshots.
    expect(isig(agentView({ elapsedMs: 60_000, updatedAt: "2026-07-22T03:00:00.000Z" }),
      ui({ drafts: new Map([["codex:a1", "half a sentence"]]) }))).toBe(base);
  });

  test("(1) the drawer tracks the lineage it paints, and non-agent drawers are unaffected", () => {
    const parent = agent({ id: "codex:orch", status: "running" });
    const child = agent({ id: "codex:kid", parentAgentId: "codex:a1", status: "running" });
    const withKin = snapshot({ programs: [{ id: "p", name: "P", agents: [agent({ parentAgentId: "codex:orch" }), parent, child] }] });
    const view = { kind: "agent", agent: agent({ parentAgentId: "codex:orch" }), program };
    const base = isig(view, ui({ snap: withKin }));
    const kidIdle = snapshot({ programs: [{ id: "p", name: "P", agents: [agent({ parentAgentId: "codex:orch" }), parent, agent({ id: "codex:kid", parentAgentId: "codex:a1", status: "waiting" })] }] });
    expect(isig(view, ui({ snap: kidIdle }))).not.toBe(base);

    // Non-agent drawers keep the signature they always had.
    const issue = { id: "system:1", kind: "system", severity: "error", title: "t", summary: "s", affectedAgentIds: [], workState: "open" };
    const advisorySel = { kind: "advisory", id: "system:1" };
    const advBase = M.inspectorPaintSig(advisorySel, { kind: "advisory", issue }, ui());
    expect(M.inspectorPaintSig(advisorySel, { kind: "advisory", issue: { ...issue, workState: "acting" } }, ui())).not.toBe(advBase);
    expect(M.inspectorPaintSig(advisorySel, null, ui())).not.toBe(advBase); // dropped from the snapshot
  });

  /* Finding 4. toggleProgram only writes programOverrides and both rename
     pencils only write renaming, so on a quiet fleet render() early-returned and
     the caret/rename form never appeared — and startRename's querySelector then
     always found nothing to focus. */
  test("(4) the program list signature moves for expand/collapse and rename state", () => {
    const visible = [{ program, agents: [agent()] }];
    const base = M.programsPaintSig(visible, ui());
    expect(M.programsPaintSig(visible, ui({ programOverrides: new Map([["p", "closed"]]) }))).not.toBe(base);
    expect(M.programsPaintSig(visible, ui({ programOverrides: new Map([["p", "open"]]) }))).not.toBe(base);
    // Collapsed and expanded are distinguishable from each other, not just from base.
    expect(M.programsPaintSig(visible, ui({ programOverrides: new Map([["p", "open"]]) })))
      .not.toBe(M.programsPaintSig(visible, ui({ programOverrides: new Map([["p", "closed"]]) })));
    expect(M.programsPaintSig(visible, ui({ renaming: "program:p" }))).not.toBe(base);
    expect(M.programsPaintSig(visible, ui({ renamePending: true }))).not.toBe(base);
    expect(M.programsPaintSig(visible, ui({ renameError: "Save failed" }))).not.toBe(base);
    // The rename input keeps its text across snapshots (the live-input rule);
    // every external reset of it flips renamePending.
    expect(M.programsPaintSig(visible, ui({ renameDraft: "half a name" }))).toBe(base);
    // The fields the signature already covered still work.
    expect(M.programsPaintSig(visible, ui({ query: "ridge" }))).not.toBe(base);
    expect(M.programsPaintSig([{ program, agents: [agent({ status: "attention" })] }], ui())).not.toBe(base);
  });

  /* The same finding, one surface later. toggleSwarm writes swarmOverrides and
     nothing else, and strip membership is a function of alerting() — which the
     per-agent projection in this signature does not carry. Either omission
     leaves a control that visibly does nothing on a quiet fleet. */
  test("(4b) the list signature moves for swarm collapse and for strip membership", () => {
    const visible = [{ program, agents: [agent()] }];
    const base = M.programsPaintSig(visible, ui());
    expect(M.programsPaintSig(visible, ui({ swarmOverrides: new Map([["codex:a1", "open"]]) }))).not.toBe(base);

    /* An agent that starts asking for a human moves in and out of the strip
       without its `status` word changing — an attentionSignal alone is enough,
       and that is exactly the field the projection does not have. */
    const asking = [{ program, agents: [agent({ attentionSignal: { kind: "question", quote: "which branch?" } })] }];
    expect(M.programsPaintSig(asking, ui({ view: "board" }))).not.toBe(M.programsPaintSig(visible, ui({ view: "board" })));
    expect(M.stripSig(M.needsYouStrip(asking))).toBe("codex:a1@p");
    expect(M.stripSig(M.needsYouStrip(visible))).toBe("");

    // And the lifecycle, which decides which divider a row sits under, moves it
    // too — `status` and `lifecycle` are separate fields and can disagree.
    const reclassified = [{ program, agents: [agent({ lifecycle: "unverified" })] }];
    expect(M.programsPaintSig(reclassified, ui())).not.toBe(base);
  });

  /* Finding 3. <textarea> has no `value` content attribute, so el()'s
     setAttribute fallback produced a permanently empty composer — the operator
     watched their broadcast text vanish on every 4s snapshot. */
  test("(3) el() assigns value as a property so a textarea actually shows its text", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const area: any = withDom(() => M.el("textarea", { value: "restart the collector", "aria-label": "Broadcast instruction" }));
    expect(area.tagName).toBe("textarea");
    expect(area.value).toBe("restart the collector");
    // Proof it is not the inert attribute the bug relied on.
    expect(area.attributes.value).toBeUndefined();
    expect(area.attributes["aria-label"]).toBe("Broadcast instruction"); // other attrs unchanged
    // The instruct composer is an <input> and must round-trip identically.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const input: any = withDom(() => M.el("input", { type: "text", value: "focus pane 3" }));
    expect(input.value).toBe("focus pane 3");
    expect(input.attributes.type).toBe("text");
    // A null value is still skipped entirely rather than assigned.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const empty: any = withDom(() => M.el("textarea", { value: null }));
    expect(empty.value).toBeUndefined();
  });

});

/* ---------------------------------------------------------------------------
   WAVE 2 / FE-B — client cost, dead weight, and the quarantine dead end.

   Everything below asserts on rendered DOM or on pure model functions. The
   shared harness is the same DOM-less trick the C1/B2 blocks use, extended with
   getElementById + a linked-list node so the keyed row reconciler can be driven
   for real.
   ------------------------------------------------------------------------- */
describe("FE-B: harness-backed client behavior", () => {
  /* -------- finding 11: the retry hint named a port it was not served on ---- */
  test("(11) the unreachable hint names the address the page came from, not a hardcoded 4701", () => {
    expect(M.serverUnreachableHint("127.0.0.1:4715"))
      .toBe("Check that the Formic server is running on 127.0.0.1:4715, then retry.");
    // The production default still reads correctly — this is not a regression trade.
    expect(M.serverUnreachableHint("127.0.0.1:4701")).toContain("127.0.0.1:4701");
    // No internal version jargon in the one screen a broken instance shows.
    expect(M.serverUnreachableHint("127.0.0.1:4702")).not.toContain("v3");
    // A hostless context (file://) must not claim an address it does not know.
    expect(M.serverUnreachableHint("")).toBe("Check that the Formic server is running at this address, then retry.");
  });

  /* -------- finding 10: SVG <rect> has no title ATTRIBUTE ------------------- */
  test("(10) usage bars carry a real SVG <title> child, so hovering reports the bucket", () => {
    const points = [
      { bucketStart: "2026-07-28T01:00:00.000Z", tokens: 12_000, provider: "claude" },
      { bucketStart: "2026-07-28T02:00:00.000Z", tokens: 4_000, provider: "codex" },
    ];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const chart: any = withDom(() => M.renderUsageSeriesChart({ available: true, points }));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rects = findAll(chart, (n: any) => n.tagName === "rect");
    expect(rects.length).toBe(2);
    for (const rect of rects) {
      // The bug: setAttribute("title", …) on a <rect> renders nothing at all.
      expect(rect.attributes.title).toBeUndefined();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const titles = (rect.children || []).filter((k: any) => k && k.tagName === "title");
      expect(titles.length).toBe(1);
      expect(String(titles[0].textContent)).toMatch(/tokens$/);
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const first = (rects[0].children as any[])[0];
    expect(first.textContent).toBe(M.usageBarTitle("2026-07-28T01:00:00.000Z", 12_000));
    expect(first.textContent).toContain("2026-07-28T01:00:00.000Z");
    expect(first.textContent).toContain("12k");
  });

  /* Routed from the docs lane: `.select-toggle[hidden]` did not hide.

     The UA rule `[hidden] { display: none }` loses to any AUTHOR rule that sets
     display — author origin beats user-agent regardless of specificity — so
     `.btn { display: inline-flex }` defeated the attribute on every button.
     Measured on the board before the fix: #select-toggle with hidden set still
     occupied 120x38px reading "Select to send", and #empty-retry still offered
     "Retry connection" on a board with no fault to retry.

     This asserts the GLOBAL guard, not the one selector, because the bug is a
     class: the stylesheet already carried five per-element `[hidden]` patches,
     which is the same defect fixed five times at the call site. A test pinned to
     `.select-toggle` would pass while the sixth button shipped broken. */
  test("the hidden attribute cannot be overridden by an author display rule", () => {
    const bare = styles.replace(/\/\*[\s\S]*?\*\//g, "");

    // The guard exists, is unqualified, and outranks author rules by origin.
    expect(bare).toMatch(/(^|\n)\[hidden\]\s*\{[^}]*display:\s*none\s*!important/);

    /* The condition that made it necessary: something still sets display on
       .btn. If that ever stops being true the guard is merely harmless, but
       while it holds, the guard is the only thing hiding a hidden button. */
    expect(bare).toMatch(/\.btn\s*\{[^}]*display:\s*inline-flex/);

    /* And no rule may re-show a hidden element. Every display declaration in
       every [hidden] rule has to be none — checked by reading the values rather
       than by a negative lookahead, which silently passed everything here on the
       first attempt because `\s*` backtracks to zero width. */
    const hiddenRuleDisplays = [...bare.matchAll(/\[hidden[^\]]*\][^{}]*\{([^}]*)\}/g)]
      .flatMap((m) => [...m[1].matchAll(/display:\s*([a-z-]+)/g)].map((d) => d[1]));
    expect(hiddenRuleDisplays.length).toBeGreaterThan(0);
    expect([...new Set(hiddenRuleDisplays)]).toEqual(["none"]);

    /* `until-found` would be a legitimate exception to the !important guard;
       the client does not use it, and if it ever does, this is where that
       decision gets made rather than discovered. */
    expect(html).not.toContain("until-found");
  });

  /* -------- finding 8: ~40 orphaned CSS classes still shipped --------------
     There is no build step and no CSS pruning, so every dead rule shipped on
     every load — and, more expensively, poisoned grep: a developer editing
     .advisory-title found rules that looked authoritative and had no effect,
     because the live advisory drawer uses .dw-lead / .dw-impact.

     This is a dead-asset lint over the stylesheet, not a behavior test. It is
     here because nothing else can express "this rule has no emitter", and the
     allowlist below is deliberately the COMPLETE set of class prefixes the
     client composes at runtime — a new dynamic prefix has to be added here on
     purpose, which is the point. */
  test("(8) every class in styles.css is emitted by the client", () => {
    const RUNTIME_PREFIXES = [
      "act-", "outcome-", "provider-", "conn-", "dw-accent--", "dw-eyebrow--",
      "dw-provider--", "work-", "role-", "verdict-", "st-", "tri-kind-",
      "tri-live-", "depth-", "chat-turn--", "program-rollup-cell--",
      "widget-option-", "identity-step--", "control-", "is-", "dw-d",
      // W4-B: the drawer composes "liveness-" + the normalized liveness word.
      "liveness-",
      // F3: the health card composes "health-severity-" + the severity key.
      "health-severity-",
    ];
    const declared = [...new Set(styles.match(/\.-?[_A-Za-z][-\w]*/g) ?? [])]
      .map((selector) => selector.slice(1));
    expect(declared.length).toBeGreaterThan(400); // the extraction actually ran
    const client = source + "\n" + html;
    const orphans = declared.filter((name) =>
      !client.includes(name) && !RUNTIME_PREFIXES.some((prefix) => name.startsWith(prefix)));
    expect(orphans).toEqual([]);

    // The allowlist is a prefix list, not a blanket: a fully invented name that
    // merely starts like a live one is still caught.
    expect(client.includes("signal-tech")).toBe(true); // the one signal-* survivor
    for (const gone of ["signal-intervention", "danger-zone", "tests-passing", "advisory-title", "instruct-form", "target-chip"]) {
      expect(styles.includes("." + gone), gone).toBe(false);
    }
  });

  /* -------- finding 7: the same derivation, four times a paint -------------
     affectedImpact rebuilt a Map of the WHOLE fleet once per issue, and
     renderHealthRail drove that chain roughly four times per paint. */
  test("(7) the fleet index is built once per snapshot, not once per issue", () => {
    const agents = Array.from({ length: 40 }, (_, i) => agent({ id: "codex:a" + i }));
    const issues = agents.slice(0, 12).map((a, i) => ({
      id: "agent:" + a.id, kind: "agent", severity: i % 2 ? "warning" : "error",
      title: "Issue " + i, summary: "s", affectedAgentIds: [a.id],
    }));
    const snap = snapshot({ programs: [{ id: "p", name: "P", agents }], issues });

    // The mechanism: one index object, reused for the life of the snapshot.
    const first = M.agentsById(snap);
    expect(first.size).toBe(40);
    expect(M.agentsById(snap)).toBe(first);

    // Driving the real derivation chain does not replace it either — that is
    // what made it O(issues × agents) per pass.
    M.pulseStripModel(snap, "live", []);
    for (const issue of issues) M.affectedImpact(issue, snap);
    expect(M.agentsById(snap)).toBe(first);
    // …and the answers are still right.
    expect(M.affectedImpact(issues[0], snap).total).toBe(1);
    expect(M.affectedImpact(issues[0], snap).plain).toContain("Touches 1 session");

    // A new snapshot object gets a fresh index — no manual invalidation, so a
    // stale board can never be served out of this cache.
    const next = snapshot({ programs: [{ id: "p", name: "P", agents: agents.slice(0, 3) }] });
    const nextIndex = M.agentsById(next);
    expect(nextIndex).not.toBe(first);
    expect(nextIndex.size).toBe(3);
    expect(M.agentsById(null).size).toBe(0);
  });

  test("(7) pulseStripModel derives each widget once, and the fleet reading is always a percentage", () => {
    /* S3. The card headlined ONE session's peak, so the tokens display could
       show that session's token count. It headlines the fleet's typical
       occupancy now, and there is no fleet-wide token counterpart: an "average
       token count" would be an aggregate of occupancies, the exact substitution
       types.ts:142-158 exists to prevent. Tokens stay where a single agent is
       the subject — the CTX column and the drawer. */
    const withCtx = snapshot({
      contextAverage: 25,
      contextMedian: 25,
      programs: [{ id: "p", name: "P", agents: [agent({ tokens: { provenance: "observed", scope: "latest-turn", total: 50_000, contextWindow: 200_000 } })] }],
    });
    const percentCell = M.pulseStripModel(withCtx, "live", [], "percent").cells.find((c: { id: string }) => c.id === "context-peak");
    const tokenCell = M.pulseStripModel(withCtx, "live", [], "tokens").cells.find((c: { id: string }) => c.id === "context-peak");
    expect(percentCell.data.value).toBe("25%");
    expect(tokenCell.data.value).toBe("25%");
    expect(tokenCell.data.value).not.toContain("50k");
    // Weighting is unaffected by the display — the cell the signature and the
    // renderer share is the same object either way.
    expect(percentCell.weight).toBe(tokenCell.weight);
    // The default is unchanged, so every existing caller keeps its behavior.
    expect(M.pulseStripModel(withCtx, "live", []).cells.find((c: { id: string }) => c.id === "context-peak").data.value).toBe("25%");
  });

  /* The CONTEXT PEAK card read "No data" while the server had the answer. The
     card decided whether it existed by walking per-agent tokens client-side; the
     server now reports contextPeak/contextMedian at the top level, derived from
     the same contextPct the CTX column reads. Peak alone also hides the shape of
     the fleet — one agent at 90% reads identically to every agent at 90% — so
     the median is what makes the number interpretable. */
  /* GPT day review §2 again: pulse.ts ships stallThresholdMs and the client
     hardcoded "15m+" in three places — the momentum card, the watch clause and
     the resting vitals. Change the threshold to 10 minutes and all three keep
     saying 15, confidently, about a count now measuring something else. */
  test("(2d) the stall phrase takes its threshold from the wire", () => {
    const snap = (ms: number | undefined, stalled = 18) =>
      snapshot({ pulse: { momentum: { stalled, stallThresholdMs: ms }, burn: {}, activity: { buckets: [] } } });
    expect(M.stallText(snap(900_000))).toBe("18 quiet 15m+");
    expect(M.stallText(snap(600_000))).toBe("18 quiet 10m+");
    // No threshold on the wire keeps the historical wording rather than blanking.
    expect(M.stallText(snap(undefined))).toBe("18 quiet 15m+");
    // Nothing stalled says nothing.
    expect(M.stallText(snap(900_000, 0))).toBe("");
    /* And the literal is gone from the CODE, so there is one source. Comments are
       stripped first: a comment explaining why the constant was removed must not
       read as the constant still being there. */
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
    expect((code.match(/quiet 15m\+/g) ?? []).length).toBe(0);
  });

  /* GPT day review §2: the client recomputed contextPct from tokens.total while
     the server shipped its own on 392 of 432 agents. They agreed — which is the
     dangerous kind of agreement, two derivations that happen to match. Token
     accounting is being corrected server-side and tokens.total is the input the
     client walk divides by, so a corrected server figure beside an uncorrected
     client one is the needsYou seam again, one field over. */
  test("(2c) one agent's context percentage comes from the server when it ships one", () => {
    const served = agent({ contextPct: 42, tokens: { provenance: "observed", scope: "latest-turn", total: 90_000, contextWindow: 100_000 } });
    // The walk would say 90; the wire says 42, and the wire wins.
    expect(M.contextUsage(served.tokens).pct).toBe(90);
    expect(M.agentContextPct(served)).toBe(42);

    // Falls back to the walk only when the server reported nothing.
    const walkOnly = agent({ tokens: { provenance: "observed", scope: "latest-turn", total: 90_000, contextWindow: 100_000 } });
    expect(M.agentContextPct(walkOnly)).toBe(90);

    /* The walk accepts only latest-turn scope, so it can suppress a reading the
       server considers authoritative. Session scope now survives. */
    const sessionScope = agent({ contextPct: 37, tokens: { provenance: "observed", scope: "session", total: 5, contextWindow: 100 } });
    expect(M.contextUsage(sessionScope.tokens)).toBeNull();
    expect(M.agentContextPct(sessionScope)).toBe(37);

    expect(M.agentContextPct(agent({ tokens: { provenance: "unknown" } }))).toBeNull();
  });

  /* GPT day review 3.1: the rail said "No completion data yet" while
     completionsLastHour was 2. The sentence was gated on observedWindowMs, so a
     restarted tracker reported NOTHING KNOWN rather than this-much-known. A
     principled honesty string stating something false is worse than no string. */
  test("(3.1) a known count is not reported as no data just because the window is young", () => {
    expect(M.completionWindowText({ completionsLastHour: 2, observedWindowMs: 0 }))
      .toBe("↑2 done · rate window not established");
    // Nothing known really is nothing.
    expect(M.completionWindowText({ completionsLastHour: 0, observedWindowMs: 0 })).toBe("");
    // And an established window is unchanged.
    expect(M.completionWindowText({ completionsLastHour: 2, observedWindowMs: 600_000 }))
      .toBe("↑2 done in 10m observed");
  });

  /* The tab count and the time lens used to be adjacent copies of the same
     choice. The tab remains honest about its population, while the filter bar
     is the one place that owns the active window. */
  test("(3.2) the filter bar owns time scope without changing the lookback model", () => {
    expect(M.lookbackApplies("history")).toBe(true);
    // Board inherited the lookback along with the Waiting population it filters.
    expect(M.lookbackApplies("board")).toBe(true);
    expect(M.lookbackApplies("usage")).toBe(false);
    expect(M.lookbackLabel(6)).toBe("6h");
  });

  /* The seam the needsYou mess came from: two derivations of one number. A
     session reporting 391.4M against a program reporting 1.60B is under repair
     server-side, so the client must render whatever the wire carries rather than
     holding a second opinion — while NOT deferring the counts, which have a
     client-side invariant to keep. */
  test("(agg) the rollup renders the server's token aggregate when it ships one", () => {
    const agents = [
      agent({ id: "a:1", status: "running", tokens: { provenance: "observed", sessionTotal: 1_000 } }),
      agent({ id: "a:2", status: "running", tokens: { provenance: "observed", sessionTotal: 2_000 } }),
    ];
    const tokenCell = (cells: Array<{ key?: string; value: string }>) => cells.find((c) => c.key === "tokens");

    // No server figure: the client sums, and says which quantity it summed.
    expect(tokenCell(M.programRollupCells(agents))?.value).toBe(M.fmtTok(3_000));
    expect(M.programRollupCells(agents).find((c: { key?: string }) => c.key === "tokens")?.label).toBe("session tokens");

    // Server figure present: the client renders it and does NOT sum.
    const served = M.programRollupCells(agents, { sessionTokens: 4_242_000 });
    expect(tokenCell(served)?.value).toBe(M.fmtTok(4_242_000));

    /* Counts stay client-derived even when the server ships them, because the
       alert cell must agree with the Needs-you tab, and that tab is necessarily
       client-side. Deferring here would re-open the divergence. */
    const alerting = [agent({ id: "a:3", status: "attention", activity: "idle", outcome: "needs-you" })];
    const cells = M.programRollupCells(alerting, { needsYou: 0, working: 99 });
    expect(cells.find((c: { label: string }) => c.label === "alert")).toBeDefined();
    expect(cells.find((c: { label: string }) => c.label === "working")?.value).toBe("0");
  });

  /* Cockpit audit §16 and §21: chrome that does not earn its space. The
     placeholder measured 389px inside a 333px input once the drawer docked, so
     the field list it enumerated was unreadable exactly when the box was
     smallest; and the masthead spent a row of its resting state on a tagline. */
  test("(16a) the search box states its purpose and keeps its field list reachable", () => {
    const input = html.match(/<input id="search"[^>]*>/)?.[0] ?? "";
    expect(input).toContain("Search agents");
    expect(input).not.toContain("Search name, model, cwd, provider, role, status, session id");
    // The enumeration is not deleted, it moves to where it does not compete,
    // and the new shortcut is discoverable from the control it acts on.
    expect(input).toContain("session id");
    expect(input).toContain("Press / to focus");
  });

  test("(21a) the masthead tagline stays for a screen reader and stops taking a row", () => {
    const eyebrow = html.match(/<p class="eyebrow[^"]*">/)?.[0] ?? "";
    expect(eyebrow).toContain("visually-hidden");
    expect(html).toContain("Live multi-agent control room");
  });

  /* Cockpit audit §15. Measured live: search was the 11th tab stop of 14, with
     the six view tabs each taking one of the stops ahead of it — reaching the
     board's primary filter meant tabbing past every view. A cockpit is a keyboard
     surface. */
  test("(15a) the tab strip is one stop and search has a shortcut", () => {
    // Left/Right wrap; a six-item strip is small enough that wrapping beats
    // reversing, and it is what the tablist pattern specifies.
    expect(M.nextViewIndex(0, "ArrowRight", 6)).toBe(1);
    expect(M.nextViewIndex(5, "ArrowRight", 6)).toBe(0);
    expect(M.nextViewIndex(0, "ArrowLeft", 6)).toBe(5);
    expect(M.nextViewIndex(2, "Home", 6)).toBe(0);
    expect(M.nextViewIndex(2, "End", 6)).toBe(5);
    expect(M.nextViewIndex(2, "Enter", 6)).toBe(-1);  // not a key it owns
    expect(M.nextViewIndex(0, "ArrowRight", 0)).toBe(-1);

    // A shortcut that steals a keystroke from a text field is worse than none.
    expect(M.isTypingTarget({ tagName: "INPUT" })).toBe(true);
    expect(M.isTypingTarget({ tagName: "TEXTAREA" })).toBe(true);
    expect(M.isTypingTarget({ tagName: "DIV", isContentEditable: true })).toBe(true);
    expect(M.isTypingTarget({ tagName: "BUTTON" })).toBe(false);
    expect(M.isTypingTarget(null)).toBe(false);

    // Only the current tab is reachable by Tab; the rest are arrow-reachable.
    expect(source).toContain("btn.tabIndex = isCurrent ? 0 : -1;");
  });

  /* Found while verifying §4 in the browser: the calm predicate walked per-agent
     tokens while the CONTEXT PEAK card and the watch clause read the server's
     snap.contextPeak. Two derivations of one quantity at the two ends of the calm
     cliff — the board could display 12% and refuse to go calm because the walk
     found 89%. The card was moved onto the server's number precisely because
     "two derivations of one number drift"; the predicate was left behind. */
  test("(4b) the band reasons about the same context number it displays", () => {
    const snap = snapshot({ contextPeak: 12 });
    expect(M.bandContextPct(snap)).toBe(12);
    /* S3. The BAND still reasons about the peak — one session about to run out
       of room is worth reacting to. The CARD no longer leads with it, and a
       snapshot carrying ONLY a peak has no reading that describes the fleet, so
       it withholds rather than presenting one session's extremum as one. */
    expect(M.summaryWidgetData("context-peak", snap, "live", "percent").value).toBe("No data");
    expect(M.summaryWidgetData("context-peak", snap, "live", "percent").tone).toBe("missing");
    // With a fleet reading present, the card speaks and the peak is a mark on it.
    const full = snapshot({ contextPeak: 12, contextAverage: 4, contextMedian: 3 });
    const data = M.summaryWidgetData("context-peak", full, "live", "percent");
    expect(data.value).toBe("4%");
    expect(data.gaugeMarks.map((m: { label: string }) => m.label)).toContain("Peak 12%");
    // Falls back to the client walk only when the server did not report one.
    const walked = snapshot({ programs: [{ id: "p", name: "P", agents: [agent({ tokens: { provenance: "observed", scope: "latest-turn", total: 90_000, contextWindow: 100_000 } })] }] });
    expect(M.bandContextPct(walked)).toBe(90);
    expect(M.bandContextPct(snapshot())).toBeNull();
  });

  /* Resting-state critique §4. The collapse carried the token RATE and dropped
     spend entirely, and for an orchestrator running hundreds of sessions a rate
     is not a substitute for money — recovering it meant Usage → Custom 1h. */
  test("(4a) the calm line carries spend when there is spend to carry", () => {
    const priced = { burn: { tokensPerMin: 3_400_000, costLastHourUsd: 11.76 }, momentum: { completionsLastHour: 38, observedWindowMs: 900_000 }, activity: { buckets: [] } };
    expect(M.calmSpendText(priced.burn)).toBe("$11.76 last hour");
    /* Same wording as the BURN card, deliberately: an operator moving between
       the collapsed line and the expanded card must not have to work out that
       two phrasings are one number. */
    expect(M.calmSpendText({ tokensPerMin: 1, costLastHourUsd: null })).toBe("");
    expect(M.calmSpendText(null)).toBe("");
    // Never a fabricated zero when BurnBar has nothing priced.
    expect(M.calmSpendText({ costLastHourUsd: undefined })).toBe("");
  });

  /* Resting-state critique §2.1. The resting copy asserted "every tracked
     session is working or done" while 12 of 18 live agents were stalled — a
     stalled session is the third state that sentence denies exists. The claim is
     gone; the count that replaces it must actually surface. */
  test("(2.1) the resting state names its stalled sessions instead of denying them", () => {
    expect(M.stalledCount(snapshot({ pulse: { momentum: { stalled: 12 } } }))).toBe(12);
    expect(M.stalledCount(snapshot())).toBe(0);
    expect(M.stalledCount(null)).toBe(0);
    // And the old false claim is not in the client anywhere.
    expect(source).not.toContain("Every tracked session is working or done");
  });

  /* Resting-state critique §3, and §2.3 with it. The calm/alarmed response was a
     boolean: driving pulseStripModel up an escalation ladder, a board where ALL
     live agents were stalled rendered pixel-identical to a perfectly healthy one,
     and the single graded input was a 1-point cliff (84% calm, 85% full grid).
     There was no murmur between silence and the scream.

     The watch tier is that murmur: the same one line with clauses appended, no
     layout change. Escalation to the grid still requires a finding. */
  test("(3a) signals that used to pass silently now murmur, without changing the layout", () => {
    const stalled = snapshot({ pulse: { momentum: { completionsLastHour: 3, observedWindowMs: 600_000, stalled: 12 }, burn: {}, activity: { buckets: [] } } });
    expect(M.watchClauses(stalled)).toContain("12 quiet 15m+");

    // Context peak is an EARLY warning, so it speaks below the 85% alarm.
    expect(M.watchClauses(snapshot({ contextPeak: 81 }))).toContain("peak ctx 81%");
    expect(M.watchClauses(snapshot({ contextPeak: 59 }))).toEqual([]);   // routine
    /* At and above the alarm the stressed grid takes over and CONTEXT PEAK gets
       its own cell, so the murmur stands down rather than saying it twice. */
    expect(M.watchClauses(snapshot({ contextPeak: 90 }))).toEqual([]);

    // A clean board still murmurs nothing.
    expect(M.watchClauses(snapshot())).toEqual([]);

    /* The layout does not change: watching is still calm, so the band stays one
       line. That is the whole point — a volume knob, not a switch. */
    const model = M.pulseStripModel(stalled, "live", [], "percent", "");
    expect(model.calm).toBe(true);
    expect(model.watch).toContain("12 quiet 15m+");

    /* §2.3: "All clear" is a verdict on everything computed from a predicate that
       never read stall, debris or context. It cannot stand beside a warning. */
    expect(M.calmVerdict([])).toBe("All clear");
    expect(M.calmVerdict(["12 quiet 15m+"])).toBe("Watch");
    // The glyph and tone move with the word — a green check beside "Watch" is
    // the chip contradicting itself.
    expect(source).toContain('value: calmVerdict(watch), tone: "advisory", icon: "warning"');
  });

  /* Resting-state critique §2.2. The collapsed calm line hard-coded "done this
     hour" while the tracker had observed 5 minutes — it did not merely drop the
     MOMENTUM card's qualifier, it upgraded a partial observation into a stronger
     claim than the data supports. One derivation, shared by both surfaces. */
  test("(2.2) a partial observation window is never rendered as a full hour", () => {
    expect(M.completionWindowText({ completionsLastHour: 24, observedWindowMs: 300_000 }))
      .toBe("↑24 done in 5m observed");
    expect(M.completionWindowText({ completionsLastHour: 52, observedWindowMs: 3_600_000 }))
      .toBe("↑52 done this hour");
    // Nothing observed yet says nothing at all rather than "0 done this hour".
    expect(M.completionWindowText({ completionsLastHour: 0, observedWindowMs: 0 })).toBe("");
    expect(M.completionWindowText(null)).toBe("");
    // The calm line consumes the shared helper rather than forking the wording.
    expect(source).not.toContain('" done this hour"');
  });

  /* Cockpit audit §10 and §11. Docked at 1440 the program header rendered
     "169 a…  13 wo…  1 alert  1.15B t…" — three of four cells clipped to
     fragments, and "0 al…" is not information in any language. Notably
     scrollWidth did NOT report clipping, so this is only provable from pixels;
     the guard here is the two structural causes instead. */
  test("(10a) the rollup drops a zero-alert cell and is allowed to wrap rather than clip", () => {
    const calm = [agent({ id: "a:1", status: "running", activity: "working", outcome: "healthy" })];
    const keys = M.programRollupCells(calm).map((c: { label: string }) => c.label);
    expect(keys).not.toContain("alerts");   // nothing to say at zero
    expect(keys).not.toContain("alert");

    const alerting = [agent({ id: "a:2", status: "attention", activity: "idle", outcome: "needs-you" })];
    expect(M.programRollupCells(alerting).map((c: { label: string }) => c.label)).toContain("alert");

    /* Wrapping is what stops four cells ellipsising into fragments in a
       550px-wide docked roster. nowrap was the cause. */
    const rule = styles.match(/\.program-rollup \{[^}]*\}/)?.[0] ?? "";
    expect(rule).not.toContain("flex-wrap: nowrap");
    expect(rule).toContain("flex-wrap: wrap");
  });

  /* Cockpit audit §9. Measured on the live roster: .agent-name renders the
     identical text at 15px/700/near-black while .row-session-tag — the only
     value that differs between rows — renders at 10.5px/400/muted on the
     subordinate line. Scanning the board meant reading the smallest, faintest
     element on each row while the loudest one repeated the program header
     directly above it. */
  test("(9a) the roster's distinguishing value rides the name, not the tag line", () => {
    const twin = (id: string, session: string) => agent({
      id, sourceSessionId: session, provider: "claude", displayName: "Claude · the-mountain-main", programId: "p",
    });
    const a = twin("claude:1", "aaaaaaaa-1111"), b = twin("claude:2", "bbbbbbbb-2222");
    const program = { id: "p", name: "the-mountain-main", agents: [a, b] };
    const ambiguous = M.ambiguousNames([a, b]);
    const row = withDom(() => M.renderAgentRow(a, program, { ambiguousNames: ambiguous }));

    // The tag now sits inside the name wrapper, beside the loud text.
    const wrap = byClass(row, "agent-name-wrap");
    expect(wrap).not.toBeNull();
    expect(textOf(wrap)).toContain("#" + M.sessionTag(a));

    /* The program name is stripped from the roster's copy of the name: the
       program header carries it two rows up, so repeating it spends the loudest
       text on the row on the one word every row shares. */
    expect(textOf(byClass(row, "agent-name"))).toBe("Claude");
    // The full name survives where it is not competing for scan attention.
    expect(row.attributes["aria-label"]).toContain("Claude · the-mountain-main");
  });

  /* A name the operator typed outranks a name the fleet derived — that is the
     whole point of being able to type one. `agentName` has always resolved that
     order correctly; what these pin is that the ROW asks it. The row reads
     `identity.base` directly to keep the words loud and the hex quiet, and a
     row that reads the server's field without first asking whether a human
     overrode it renders a rename that saved, round-tripped, and then appeared
     to do nothing — indistinguishable from a broken button. */
  const named = (over: Record<string, unknown> = {}) => agent({
    id: "claude:named", sourceSessionId: "cccc-3333", provider: "claude", programId: "p",
    identity: { name: "PR Automation Review & Fix #cccc3333", base: "PR Automation Review & Fix", disambiguator: "#cccc3333", source: "task" },
    ...over,
  });

  test("a session the operator renamed in Ant Hill shows that name on the row", async () => {
    const a = named();
    const program = { id: "p", name: "the-mountain-main", agents: [a] };

    await withState({ aliases: new Map([["agent:claude:named", "Nightly release check"]]) }, () => {
      const row = withDom(() => M.renderAgentRow(a, program));
      expect(textOf(byClass(row, "agent-name"))).toBe("Nightly release check");
    });
  });

  test("a cmux pane the operator renamed shows that name on the row", async () => {
    /* A SURFACE rename is this pane's own name, so it belongs to the session
       even when the pane's folder differs from where the session runs — which
       is the normal shape of an orchestrator: parked in the home directory,
       working in a project. A WORKSPACE title is broader context and stays
       suppressed when directories differ, or a home-cwd orchestrator would borrow the
       name of whatever project it was parked beside. */
    const a = named({
      surfaceTitle: "Agent identity and naming contract",
      target: { resolution: "exact", surfaceId: "s1", workspaceId: "w1", workspaceTitle: "Hormiga Dormida", cwdRelation: "different" },
    });
    const program = { id: "p", name: "the-mountain-main", agents: [a] };

    await withState({ aliases: new Map() }, () => {
      const row = withDom(() => M.renderAgentRow(a, program));
      expect(textOf(byClass(row, "agent-name"))).toBe("Agent identity and naming contract");
    });
  });

  test("a workspace title still loses to the fleet's name when directories differ", async () => {
    // The contrast case. Without it the two tests above would pass on a client
    // that had simply started trusting every title cmux reports.
    const a = named({
      target: { resolution: "exact", surfaceId: "s1", workspaceId: "w1", workspaceTitle: "Hormiga Dormida", cwdRelation: "different" },
    });
    const program = { id: "p", name: "the-mountain-main", agents: [a] };

    await withState({ aliases: new Map() }, () => {
      const row = withDom(() => M.renderAgentRow(a, program));
      expect(textOf(byClass(row, "agent-name"))).toBe("PR Automation Review & Fix");
    });
  });

  test("the server's hex tag prints only where it separates two rows", async () => {
    /* ROW DIET, and a deliberate narrowing of what "print the disambiguator"
       means. The plan asked for the #disambiguator to leave the row outright.
       Taken literally that trades one wall of text for a worse defect: thirty
       rows reading "PR Automation Review & Fix" and nothing to tell them apart,
       on a board whose first doctrine is that names are honest.

       So the tag is printed when — and only when — another session on the board
       is using the same PRINTED name. That removes it from the large majority of
       rows, which is the density the diet was after, and keeps it on exactly the
       rows that would otherwise be indistinguishable. The full session id is in
       the drawer for every row either way. */
    const a = named();
    const program = { id: "p", name: "the-mountain-main", agents: [a] };
    const nameOf = (over: Record<string, unknown> = {}) =>
      textOf(byClass(withDom(() => M.renderAgentRow(a, program, over)), "agent-name-wrap"));

    await withState({ aliases: new Map() }, () => {
      // Unique on the board: the words are the whole name, hex included nowhere.
      expect(nameOf()).toBe("PR Automation Review & Fix");
      expect(nameOf()).not.toContain("#cccc3333");
      // Shared with another session: the hex is what separates them, so it prints.
      expect(nameOf({ sharedNames: new Set(["PR Automation Review & Fix"]) }))
        .toContain("#cccc3333");
    });
    // A name the operator chose is theirs; the server's hex never rides it.
    await withState({ aliases: new Map([["agent:claude:named", "Nightly release check"]]) }, () => {
      expect(nameOf({ sharedNames: new Set(["Nightly release check"]) })).not.toContain("#cccc3333");
    });
  });

  test("sharedRowNames sees the collision the operator sees, which ambiguousNames cannot", () => {
    /* Two sessions the server named apart: identity.name is unique by
       construction ("... #cccc3333" / "... #dddd4444"), so ambiguousNames — which
       counts resolved identities — reports no collision at all. What is on
       screen is two rows reading the same words. */
    const one = named();
    const two = named({
      id: "claude:named-2",
      sourceSessionId: "aaaa-dddd4444",
      identity: { name: "PR Automation Review & Fix #dddd4444", base: "PR Automation Review & Fix", disambiguator: "dddd4444" },
    });
    expect(M.ambiguousNames([one, two]).size).toBe(0);
    expect(M.sharedRowNames([one, two]).has("PR Automation Review & Fix")).toBe(true);
    // One session alone shares nothing.
    expect(M.sharedRowNames([one]).size).toBe(0);
    // And the row signature carries the collision, so the tag can appear and
    // vanish as a twin arrives or leaves.
    const sig = (shared: Set<string>) => M.agentRowSig(one, listUi(), { sharedNames: shared });
    expect(sig(new Set(["PR Automation Review & Fix"]))).not.toBe(sig(new Set()));
  });

  /* ---------- T7a: one session wears one name ------------------------------

     Every fixture in this block is a reading taken off the live board on
     2026-08-05, paired with what /api/snapshot said about the same session in
     the same second. Three names for one session were on screen at once. */
  describe("T7a — one session wears one name", () => {
    /* cmux names its own panes. `surfaceTitle` is routinely a sentence cmux
       distilled from the session's opening prompt, and `workspaceTitle` is the
       workspace path. The client counted both as operator renames, so both
       outranked the name the run manifest declared: the Needs-you strip printed
       "Unify lane fe-states and audit tags with TDD" over a lane the API called
       `fe-states`, and a swarm child printed its workspace path over one the API
       called `be-live`.

       A manifest name is not a guess. It is the id the orchestrator spawned the
       lane under, the id the operator types to address it, and the id the lane
       signs its own DONE line with — so it outranks any title cmux reports. A
       label the operator typed HERE still beats both; that is what renaming is
       for, and the three tests above pin it. */
    const lane = (over: Record<string, unknown> = {}) => agent({
      id: "claude:bb6fe728", sourceSessionId: "bb6fe728-5aca-4c61-a38b-7fcc797ae746",
      provider: "claude", programId: "p",
      identity: { name: "fe-states", base: "fe-states", source: "manifest", authoredBy: "manifest" },
      ...over,
    });
    const groupOf = (...agents: Array<Record<string, unknown>>) =>
      ({ id: "p", name: "disposable checkouts", agents });
    const noLabels = () => {
      const empty = new Map<string, string>();
      return { aliases: empty, labels: empty };
    };

    test("a pane title cmux distilled never replaces a declared lane name", async () => {
      const a = lane({ surfaceTitle: "Unify lane fe-states and audit tags with TDD" });
      await withState(noLabels(), () => {
        const row = withDom(() => M.renderAgentRow(a, groupOf(a)));
        expect(textOf(byClass(row, "agent-name"))).toBe("fe-states");
      });
    });

    test("a cmux workspace title never replaces a declared lane name", async () => {
      const a = lane({
        id: "codex:019fd291", sourceSessionId: "019fd291-62e4-7152-a9b4-6d781396802c", provider: "codex",
        identity: { name: "be-live", base: "be-live", source: "manifest", authoredBy: "manifest" },
        target: { resolution: "exact", surfaceId: "s1", workspaceId: "w1", workspaceTitle: "hardening/be-live" },
      });
      await withState(noLabels(), () => {
        const row = withDom(() => M.renderAgentRow(a, groupOf(a)));
        expect(textOf(byClass(row, "agent-name"))).toBe("be-live");
      });
    });

    test("the title cmux wrote survives as the terminal line, not as the name", async () => {
      /* Refusing it as a NAME must not lose it. The pane title is how an
         operator finds the session in cmux, and the drawer's quiet source line
         is where that has always belonged — it went silent only because the
         name and the title were the same string. */
      const a = lane({ surfaceTitle: "Unify lane fe-states and audit tags with TDD" });
      await withState(noLabels(), () => {
        expect(M.quietSourceLine(a)).toBe("Terminal: Unify lane fe-states and audit tags with TDD");
      });
    });

    test("a session the operator renamed in Ant Hill still outranks its declared name", async () => {
      // The contrast that keeps the rule honest: without it the two tests above
      // would pass on a client that had simply stopped listening to humans.
      const a = lane({ surfaceTitle: "Unify lane fe-states and audit tags with TDD" });
      await withState({ aliases: new Map([["agent:claude:bb6fe728", "Tag audit"]]) }, () => {
        const row = withDom(() => M.renderAgentRow(a, groupOf(a)));
        expect(textOf(byClass(row, "agent-name"))).toBe("Tag audit");
      });
    });

    /* The server's disambiguator is DURABLE by design: once a session has a tag
       it keeps it, so its name cannot churn when the twin that caused the tag
       goes away (`disambiguate` in src/server/naming.ts). What that produced on
       screen is the observed defect — `fe-regroup #8da7e056` was the ONLY
       session carrying that base anywhere in an 1186-agent snapshot, and eight
       characters of hex separated it from nothing.

       The tag is the fleet's to assign and the VIEW's to print. The row already
       decided it that way; every other surface printed `identity.name`, which is
       the two already joined. */
    const soloTagged = (over: Record<string, unknown> = {}) => agent({
      id: "claude:d02c6e5e", sourceSessionId: "d02c6e5e-0a8e-489e-8c8c-b9c48da7e056",
      provider: "claude", programId: "p", status: "archived", lifecycle: "finished",
      identity: {
        name: "fe-regroup #8da7e056", base: "fe-regroup",
        source: "manifest", authoredBy: "manifest", disambiguator: "8da7e056",
      },
      ...over,
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const drawerFor = (a: any, prog: any) => withDom(() => {
      const pane = newNode("div");
      M.renderAgentDrawer(pane, { kind: "agent", agent: a, program: prog });
      return pane;
    });

    test("the drawer drops a hex tag that separates this session from nothing", async () => {
      const a = soloTagged();
      const prog = groupOf(a);
      await withState({ ...noLabels(), snap: { schemaVersion: 1, programs: [prog] } }, () => {
        const title = byClass(drawerFor(a, prog), "inspector-title");
        expect(textOf(title)).toBe("fe-regroup");
        expect(textOf(title)).not.toContain("8da7e056");
      });
    });

    test("the drawer prints the tag again the moment a twin shares the words", async () => {
      // The contrast case. Without it "drop the tag" passes by deleting it.
      const a = soloTagged();
      const twin = soloTagged({
        id: "claude:aaaa1111", sourceSessionId: "aaaa1111-0000-4000-8000-0000aaaa1111",
        identity: {
          name: "fe-regroup #aaaa1111", base: "fe-regroup",
          source: "manifest", authoredBy: "manifest", disambiguator: "aaaa1111",
        },
      });
      const prog = groupOf(a, twin);
      await withState({ ...noLabels(), snap: { schemaVersion: 1, programs: [prog] } }, () => {
        expect(textOf(byClass(drawerFor(a, prog), "inspector-title"))).toContain("8da7e056");
      });
    });

    test("the row and the drawer print one name for one session", async () => {
      /* The whole point of T7a, stated as an equality rather than as two
         separate expectations: whatever the rule turns out to be, the two
         surfaces have to reach it through the same code. */
      const a = soloTagged();
      const prog = groupOf(a);
      await withState({ ...noLabels(), snap: { schemaVersion: 1, programs: [prog] } }, () => {
        const board = M.boardIndex(M.state);
        const opts = { ambiguousNames: board.ambiguous, sharedNames: board.sharedNames };
        const row = withDom(() => M.renderAgentRow(a, prog, opts));
        expect(textOf(byClass(drawerFor(a, prog), "inspector-title")))
          .toBe(textOf(byClass(row, "agent-name-wrap")));
      });
    });

    test("the drawer's lineage spine names a session the way its own row does", async () => {
      /* Live: every lane's spine printed its orchestrator as
         "atlas-hardening-2026-08-05 #23dd6c82" while the orchestrator's own row
         two inches away printed "atlas-hardening-2026-08-05". */
      const boss = agent({
        id: "claude:8c052fe9", sourceSessionId: "8c052fe9-db5c-47c4-9e21-e9b623dd6c82",
        provider: "claude", programId: "p",
        identity: {
          name: "atlas-hardening-2026-08-05 #23dd6c82", base: "atlas-hardening-2026-08-05",
          source: "manifest", authoredBy: "manifest", disambiguator: "23dd6c82",
        },
      });
      const child = soloTagged({ parentAgentId: "claude:8c052fe9" });
      const prog = groupOf(boss, child);
      await withState({ ...noLabels(), snap: { schemaVersion: 1, programs: [prog] } }, () => {
        const pane = drawerFor(child, prog);
        // The ancestor node above the current one, and the current node itself.
        expect(textOf(byClass(pane, "dw-lin-name"))).toContain("atlas-hardening-2026-08-05");
        expect(textOf(byClass(pane, "dw-lin-name"))).not.toContain("23dd6c82");
        expect(textOf(byClass(pane, "dw-cur-name"))).not.toContain("8da7e056");
      });
    });

    test("a swarm anchor names the parent the way the parent's own row does", async () => {
      /* The anchor stands in for a parent that is off screen — pinned into the
         strip, or filtered out — so it is the only place that name appears, and
         it printed `identity.name` complete with a durable hex the board had
         nothing to separate. Driven through agentRowPlan, the path the board
         actually builds anchors from. */
      const boss = soloTagged({ id: "claude:d02c6e5e", status: "running", lifecycle: "working" });
      const child = agent({
        id: "claude:kid", sourceSessionId: "kid-0000-0000-0000-000000000001",
        provider: "claude", programId: "p", parentAgentId: "claude:d02c6e5e",
        identity: { name: "security-review", base: "security-review", source: "manifest", authoredBy: "manifest" },
      });
      const prog = groupOf(boss, child);
      await withState(noLabels(), () => {
        const ui = listUi({ view: "board", lookbackHours: null, snap: { schemaVersion: 1, programs: [prog] } });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const anchor = M.agentRowPlan(prog, [child], ui)
          .find((item: { key: string }) => item.key === "anchor:claude:d02c6e5e") as any;
        expect(anchor).toBeDefined();
        const text = textOf(withDom(() => anchor.build()));
        expect(text).toContain("fe-regroup");
        expect(text).not.toContain("8da7e056");
      });
    });

    test("the program roster names each session the way its row does", async () => {
      // Same drift, one drawer over: the roster is where an operator reads a
      // whole swarm's names at once, so a stray hex on one of them is loudest.
      const a = soloTagged();
      const prog = groupOf(a);
      await withState({ ...noLabels(), snap: { schemaVersion: 1, programs: [prog] } }, () => {
        const pane = withDom(() => {
          const p = newNode("div");
          M.renderProgramDrawer(p, { program: prog });
          return p;
        });
        expect(textOf(byClass(pane, "dw-roster-name"))).toBe("fe-regroup");
      });
    });

    test("the Needs-you strip pins the row under its declared name", async () => {
      /* The strip already reuses renderAgentRow, which is what should have made
         it immune — but the row was reading the pane title too, so the one
         surface an operator cannot ignore carried the distilled sentence. Driven
         through syncProgramList, the path renderPrograms actually runs. */
      const asking = lane({
        surfaceTitle: "Unify lane fe-states and audit tags with TDD",
        status: "attention", outcome: "needs-you", lifecycle: "waiting",
      });
      const prog = groupOf(asking);
      const root = newNode("div");
      await withState(noLabels(), () => {
        withDom(() => M.syncProgramList(root, [{ program: prog, agents: [asking] }], listUi({
          view: "board", lookbackHours: null, snap: { schemaVersion: 1, programs: [prog] },
        })));
        const strip = byClass(root, "needs-strip-agents");
        expect(strip).not.toBeNull();
        expect(textOf(byClass(strip, "agent-name"))).toBe("fe-states");
      });
    });
  });

  /* Cockpit audit §6. NEEDS YOU and HEALTH narrated one fault twice — "1 finding ·
     Two live sessions share one cmux pane" beside "Advisory · 1 degraded source"
     — the second in a full-width row. attentionSummary and topSourceIssue read
     the same issues array, so when the top finding IS the system fault, the two
     cells are the same sentence at different altitudes.

     They genuinely diverge, so HEALTH is suppressed only in that exact overlap. */
  test("(6a) one system fault is narrated by one cell, not two", () => {
    const overlap = snapshot({
      issues: [{ id: "system:pane", kind: "system", severity: "warning", title: "Two live sessions share one cmux pane", summary: "s", affectedAgentIds: [] }],
      totals: { live: 1, tracked: 1, attention: 1, working: 1, idle: 0, history: 0, sourceHealth: { healthy: 3, degraded: 1, absent: 0, total: 4 } },
    });
    /* S2-T1. The overlap this guarded cannot occur any more: NEEDS YOU is
       retired, so there is no second cell for HEALTH to collide with, and the
       header no longer counts a fault it also describes. HEALTH now speaks for
       itself whenever the system is at fault, including here. */
    const ids = M.pulseStripModel(overlap, "live", [], "percent", "").cells.map((c: { id: string }) => c.id);
    expect(ids).not.toContain("needs-you");
    // The fault itself stays reachable — in the surface that owns findings.
    expect(M.notificationFeed(overlap, [], Date.now(), M.NOTIFY_DEPS).map((i: { id: string }) => i.id))
      .toEqual(["system:pane"]);

    /* Divergence must survive. A dead control plane is NOT in the issues list the
       way a pane conflict is, so HEALTH keeps its cell and speaks alone. */
    const blocked = snapshot({ issues: [], controlHealth: { cmuxReachable: false, lastCheckedAt: "", errors: [], staleSources: [] } });
    const blockedIds = M.pulseStripModel(blocked, "live", [], "percent", "").cells.map((c: { id: string }) => c.id);
    expect(blockedIds).toContain("health");
    expect(blockedIds).not.toContain("needs-you");

    /* An agent-level finding leaves HEALTH silent anyway — sources are fine.
       The finding is carried by an agent the client considers alerting, not by a
       server issues[] entry: since the false-all-clear fix, kind:"agent" entries
       on the wire are dropped and the agent half is re-derived, so a server
       finding with no alerting agent behind it renders nothing at all. That is
       the point of the fix, and asserting it here keeps this test honest about
       where an agent finding now comes from. */
    const agentOnly = snapshot({
      issues: [],
      programs: [{ id: "p", name: "P", agents: [agent({ id: "x", outcome: "failed", activity: "working" })] }],
    });
    const agentIds = M.pulseStripModel(agentOnly, "live", [], "percent", "").cells.map((c: { id: string }) => c.id);
    expect(agentIds).not.toContain("needs-you");
    expect(agentIds).not.toContain("health");
    // …and it reaches the operator as an item rather than a tally.
    expect(M.notificationFeed(agentOnly, [], Date.now(), M.NOTIFY_DEPS).map((i: { id: string }) => i.id))
      .toEqual(["agent:x"]);

    // A wire finding with no alerting agent behind it is exactly what used to
    // make the rail disagree with the tab. It now renders no cell.
    const orphan = snapshot({ issues: [{ id: "agent:ghost", kind: "agent", severity: "warning", title: "t", summary: "s", affectedAgentIds: ["ghost"] }] });
    expect(M.pulseStripModel(orphan, "live", [], "percent", "").cells.map((c: { id: string }) => c.id))
      .not.toContain("needs-you");
  });

  test("(2b) provider task is the final deduplicated conversation candidate", () => {
    const both = agent({ task: "Port the SEM forecast rate limiter", lastUserMessage: "start with the buckets", lastAgentMessage: "done" });
    const rendered = textOf(withDom(() => M.renderChat(both)));
    expect(rendered.match(/Port the SEM forecast/g)).toHaveLength(1);

    // With no turns at all the floor still holds, and an exact turn duplicate wins once.
    const bare = agent({ task: "Port the SEM forecast rate limiter", lastUserMessage: "", lastAgentMessage: "", lastHumanMessage: "Port the SEM forecast rate limiter" });
    expect(textOf(withDom(() => M.renderChat(bare)))).toContain("Port the SEM forecast");
    const duplicate = agent({ task: "Port the SEM forecast rate limiter", lastUserMessage: "Port the SEM forecast rate limiter", lastAgentMessage: "" });
    expect(textOf(withDom(() => M.renderChat(duplicate))).match(/Port the SEM forecast/g)).toHaveLength(1);

    // A successfully loaded transcript replaces the preview, so the floor must
    // survive that normal path too. Assistant-only history cannot erase the
    // standing provider task, and an exact loaded duplicate still renders once.
    const loaded = transcriptUi({
      ok: true,
      agentId: both.id,
      source: "/tmp/session.jsonl",
      truncated: false,
      lines: [{ at: null, role: "assistant", text: "done" }],
    });
    const loadedText = textOf(withDom(() => M.renderChatFeedBody(both, loaded)));
    expect(loadedText).toContain("Port the SEM forecast");
    const loadedDuplicate = transcriptUi({
      ok: true,
      agentId: both.id,
      source: "/tmp/session.jsonl",
      truncated: false,
      lines: [{ at: null, role: "assistant", text: "Port the SEM forecast rate limiter" }],
    });
    expect(textOf(withDom(() => M.renderChatFeedBody(both, loadedDuplicate))).match(/Port the SEM forecast/g)).toHaveLength(1);
  });

  /* Cockpit audit §5 and §11: widgets that render their empty state instead of
     not rendering. A cell reporting ABSENCE is noise surrounding the one cell
     reporting a fault, and three separate widgets asserting "nothing needs you"
     teach the operator to stop reading the one that will eventually say 1. */
  test("(5a) a cell with nothing to report is omitted, not rendered empty", () => {
    const quiet = snapshot({ pulse: { burn: { tokensPerMin: null, costLastHourUsd: null }, momentum: { completionsLastHour: 0, observedWindowMs: 0, stalled: 0 }, activity: { buckets: [] } } });
    const ids = M.pulseStripModel(quiet, "live", [], "percent", "").cells.map((c: { id: string }) => c.id);
    expect(ids).not.toContain("burn");        // no rate and no cost
    expect(ids).not.toContain("context-peak");// no live context reports
    expect(ids).not.toContain("health");      // operational is silence

    /* A real finding brings back no header cell at all now — it brings back a
       notification item. The header withholds; attention speaks. */
    const busy = snapshot({ issues: [{ id: "e", kind: "system", severity: "error", title: "t", summary: "s", affectedAgentIds: [] }] });
    expect(M.pulseStripModel(busy, "live", [], "percent", "").cells.map((c: { id: string }) => c.id)).not.toContain("needs-you");
    expect(M.notificationFeed(busy, [], Date.now(), M.NOTIFY_DEPS).map((i: { id: string }) => i.id)).toEqual(["e"]);
    /* A finding alone does not degrade systemStatus — sources and control are
       still fine — so HEALTH stays silent. HEALTH speaks when the system itself
       is at fault. */
    const degraded = snapshot({ controlHealth: { cmuxReachable: false, lastCheckedAt: "", errors: [], staleSources: [] } });
    expect(M.pulseStripModel(degraded, "live", [], "percent", "").cells.map((c: { id: string }) => c.id)).toContain("health");
  });

  /* Cockpit audit §4. The HEALTH cell named the correct action — close one of the
     conflicting sessions — and then rendered a REFRESH button, which does
     something else entirely. The only affordance present was the one that cannot
     help. A control is offered only when re-pulling evidence could actually
     change the answer. */
  test("(4a) the health cell offers refresh only when refreshing could change the answer", () => {
    // A failed fetch is exactly what retrying fixes.
    expect(M.healthRefreshAction({ fetchFailed: true, conn: "live", snap: snapshot() })).toMatchObject({ label: "Retry snapshot" });
    // A feed that is not live is the same class of problem.
    expect(M.healthRefreshAction({ fetchFailed: false, conn: "reconnecting", snap: snapshot() })).toMatchObject({ label: "Retry snapshot" });
    // cmux down is repaired OUTSIDE the app, so the button confirms the repair.
    const unreachable = snapshot({ controlHealth: { cmuxReachable: false, lastCheckedAt: "", errors: [], staleSources: [] } });
    expect(M.healthRefreshAction({ fetchFailed: false, conn: "live", snap: unreachable })).toMatchObject({ label: "Verify repair" });
    /* An evidence-based advisory — two live sessions sharing a pane — is fixed by
       closing one, and the collector rescans on its own. Offering a button here
       is offering the wrong lever. */
    expect(M.healthRefreshAction({ fetchFailed: false, conn: "live", snap: snapshot() })).toBeNull();
  });

  /* Cockpit audit §3. The tile rendered "BURN / No data / $19.54 last hour ·
     31/31 reporting" — a verdict of "no data" printed directly above a dollar
     figure and a claim of COMPLETE coverage. The operator could not tell whether
     spend was unknown or $19.54. The rate and the cost have different sources
     (the rate needs completed 5-minute buckets; the cost comes from BurnBar), so
     one being absent says nothing about the other. */
  test("(3a) BURN never calls itself empty while it is reporting a cost", () => {
    const withCost = snapshot({ pulse: { burn: { tokensPerMin: null, costLastHourUsd: 19.54, coverage: { reporting: 31, eligible: 31 } } } });
    const data = M.summaryWidgetData("burn", withCost, "live", "percent");
    expect(data.value).not.toBe("No data");
    expect(data.value).toContain("rate");
    expect(data.sublabel).toContain("$19.54");

    // A rate present is unchanged — the headline is still the number.
    const full = snapshot({ pulse: { burn: { tokensPerMin: 8200, costLastHourUsd: 5.01, coverage: { reporting: 14, eligible: 14 } } } });
    expect(M.summaryWidgetData("burn", full, "live", "percent").value).toBe(M.fmtTok(8200));

    // Neither number present is still an honest empty tile.
    const neither = snapshot({ pulse: { burn: { tokensPerMin: null, costLastHourUsd: null } } });
    expect(M.summaryWidgetData("burn", neither, "live", "percent").value).toBe("No data");
  });

  test("(8) CONTEXT PEAK reports the server's peak and median", () => {
    const withCtx = snapshot({
      contextPeak: 74,
      contextMedian: 31,
      programs: [{ id: "p", name: "P", agents: [agent({ tokens: { provenance: "observed", scope: "latest-turn", total: 50_000, contextWindow: 200_000 } })] }],
    });
    const data = M.summaryWidgetData("context-peak", withCtx, "live", "percent");
    /* S3. The headline was `contextPeak` — ONE session's extremum standing in
       for a reading about the fleet. Measured live while this was written: peak
       84%, average 29%, median 25%. The header said the fleet was nearly full
       while the typical session sat at a quarter.

       The fleet's typical occupancy leads now. With no average on the wire the
       median leads, and the peak becomes a mark on the dial. */
    expect(data.value).toBe("31%");
    expect(data.meterPct).toBe(31);
    expect(data.spreadMode).toBe("median");
    // Peak survives where it belongs — as a tick, named in the dial's own label.
    expect(data.gaugeMarks.map((m: { label: string }) => m.label)).toContain("Peak 74%");
    expect(data.sublabel).not.toContain("Peak 74%");
    /* …and the alarm still reads the PEAK, not the headline. Demoting it from
       the headline is not the same as ceasing to watch it: one session about to
       run out of room is worth colouring the card for even when the fleet's
       typical occupancy is comfortable. */
    expect(data.tone).toBe("ok");
    expect(M.summaryWidgetData("context-peak", snapshot({ contextPeak: 91, contextMedian: 12 }), "live", "percent").tone)
      .toBe("hot");

    // The card must survive a snapshot the client walk finds nothing in — the
    // exact case that printed "No data" over a reported reading.
    const serverOnly = snapshot({
      contextPeak: 91,
      contextMedian: 12,
      programs: [{ id: "p", name: "P", agents: [agent({ tokens: { provenance: "reported", total: 10 } })] }],
    });
    const bare = M.summaryWidgetData("context-peak", serverOnly, "live", "percent");
    expect(bare.value).toBe("12%");
    expect(bare.value).not.toBe("No data");
    expect(bare.tone).toBe("hot"); // the peak at 91% is a real ceiling warning

    // The fleet reading is a percentage in either display — see (7).
    expect(M.summaryWidgetData("context-peak", withCtx, "live", "tokens").value).toBe("31%");

    // No server fields and no client evidence is still an honest "No data" —
    // the card never invents a number.
    const empty = snapshot({
      programs: [{ id: "p", name: "P", agents: [agent({ tokens: { provenance: "reported", total: 10 } })] }],
    });
    expect(M.summaryWidgetData("context-peak", empty, "live", "percent").value).toBe("No data");
  });

  /* -------- finding 4: five copies of one enum, already disagreeing --------
     `completed` read "Complete" on the plan chip, "complete · verifying" on the
     queue button, "verifying" in the pulse row, "Verifying" in the drawer
     eyebrow and "complete · waiting for fresh data" in the drawer status. */
  test("(4) one investigation state reads with one word on every surface", () => {
    const issue = { id: "system:1", kind: "system", severity: "error", title: "t", summary: "s", affectedAgentIds: [] };
    const item = (state: string) => ({
      issueId: "system:1", state, headline: "Re-bind the sessions", mode: "investigate",
      rationale: "why", steps: [{ title: "Read", detail: "d" }], queueRecommended: true,
      createdAt: "2026-07-28T01:00:00.000Z", startedAt: "2026-07-28T01:01:00.000Z",
    });
    const triageText = (state: string) =>
      textOf(withDom(() => M.renderTriage(issue, triageUi({ queueItems: [item(state)] }))));

    // The state that was broken in four ways.
    const completed = triageText("completed");
    expect(completed).toContain("Verifying");                     // plan chip
    expect(completed).toContain("✓ Investigation verifying");      // queue button
    expect(completed).not.toContain("Complete");                   // the old chip word
    expect(completed).not.toContain("complete · verifying");       // the old button text
    const pulseRow = (state: string) =>
      M.pulseStripModel({ schemaVersion: 1, programs: [], issues: [] }, "live", [item(state)]).findings[0];
    expect(pulseRow("completed").work.label).toBe("Verifying");     // pulse row

    // Every surface agrees for every state, and the four states stay distinct.
    for (const [state, word] of [["queued", "Queued"], ["running", "Running"], ["completed", "Verifying"], ["blocked", "Blocked"]] as const) {
      const view = M.investigationView(state);
      expect(view.label, state).toBe(word);
      expect(triageText(state), state).toContain(word);
      expect(pulseRow(state).impact, state).toBe("Investigation " + word.toLowerCase());
    }
    const labels = Object.values(M.INVESTIGATION_STATE_VIEW as Record<string, { label: string }>).map((v) => v.label);
    expect(new Set(labels).size).toBe(4);

    // A sixth server state degrades to the server's own word CONSISTENTLY,
    // instead of a confident wrong label on one surface and a raw enum on the next.
    const unknown = M.investigationView("cancelled");
    expect(unknown.label).toBe("cancelled");
    expect(unknown.button).toBe("Investigation cancelled");
    expect(triageText("cancelled")).toContain("Investigation cancelled");
  });

  /* -------- finding 3: repaint-and-lose-focus ------------------------------
     render()'s focus-restore contract keys on data-fkey and nothing else, and
     renderFilterBar wipes the whole bar unconditionally on every paint. Chips
     without an fkey were destroyed, nothing was restored, and a keyboard or
     screen-reader operator was thrown back to <body> ~15 times a minute. */

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function focusKeysOf(node: any): string[] {
    return buttonsOf(node).map((b: { dataset: Record<string, string> }) => b.dataset.fkey);
  }

  test("(3) filterChip carries the focus key it is given", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const chip: any = withDom(() => M.filterChip("6h", true, () => {}, { fkey: "lookback:6" }));
    expect(chip.tagName).toBe("button");
    expect(chip.dataset.fkey).toBe("lookback:6");
    expect(chip.attributes["aria-pressed"]).toBe("true");
    // The key names the control, not its label, so it survives the label change
    // that "Custom" → "Custom 12h" performs on the very chip being clicked.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const custom: any = withDom(() => M.filterChip("Custom 12h", true, () => {}, { fkey: "lookback:custom" }));
    expect(custom.dataset.fkey).toBe("lookback:custom");
  });

  /* The collection window left the bar entirely (operator directive,
     2026-08-05): it is the server's reach, not a lens, and the summary rail
     already states it ambiently (renderScanWindow, pinned below at "an
     unconfirmed scan window is withheld"). A Filters bar that mentions the
     server's collection bound teaches operators it is one of the filters. */
  test("(3b) the filter bar carries no collection status and no disclaimer", () => {
    withDom(() => {
      M.renderFilterBar(listUi({ view: "board", scanWindowHours: 12, settingsError: "" }));
      const bar = domById.get("filter-bar");
      expect(byClass(bar, "filter-status")).toBeNull();
      expect(byClass(bar, "filter-note")).toBeNull();   // "· your view only" is gone
      expect(textOf(bar)).not.toContain("Collecting");
      expect(textOf(bar)).not.toContain("your view only");
    });
    // The unverified-settings branch has no bar rendering to fall back to either.
    withDom(() => {
      M.renderFilterBar(listUi({ view: "board", scanWindowHours: 36, settingsError: "settings 500" }));
      expect(textOf(domById.get("filter-bar"))).not.toContain("unverified");
    });
  });

  test("(3b2) the collection window is editable in Settings, not on the bar", () => {
    withDom(() => {
      M.renderFilterBar(listUi({ view: "board", scanWindowHours: 36, lookbackHours: 6 }));
      expect(buttonsOf(domById.get("filter-bar")).map((b: { dataset: Record<string, string> }) => b.dataset.fkey))
        .not.toContain("scan-window");
    });

    /* The editor, where the server's other knobs live — carrying the same
       `scan-window` focus key, so muscle memory lands on the control rather
       than on nothing. */
    return withState({ settingsPanelOpen: true, settings: { scanWindowHours: 48 } }, () => withDom(() => {
      M.renderSettingsPanel();
      const field = byFkey(domById.get("settings-panel"), "scan-window");
      expect(field).toBeTruthy();
      expect(field.tagName).toBe("input");
      expect(field.attributes.max).toBe("168");
      expect(field.value).toBe("48"); // and it opens on the server's value
    }));
  });

  /* D7 ruled review-worker visibility a SERVER setting rather than a per-browser
     lens, so the fleet's default board looks the same from every machine. That
     makes the chip a write, and these drive the real click through the real
     handler — the toggle was source-asserted only, which is a test that cannot
     fail when the write stops happening. */
  const reviewBoard = () => {
    const review = agent({
      id: "claude:r1", provider: "claude", updatedAt: new Date().toISOString(),
      sessionKind: "review", sessionKindSource: "launch-evidence",
      task: "Review this change for security vulnerabilities.",
    });
    return snapshot({ programs: [{ id: "p", name: "P", agents: [review] }] });
  };
  // The click's POST is fire-and-forget by design (the chip must not wait on the
  // network), so the assertions need one turn of the loop to see it land.
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

  test("(3b3) Advanced exposes the fleet provider wait on the server's value", async () => {
    await withState({
      settingsPanelOpen: true,
      settings: { version: 2, providerWaitMs: 15000 },
      settingsPending: false,
      snap: null,
    }, () => withDom(() => {
      M.renderSettingsPanel();
      const panel = domById.get("settings-panel")!;
      const select = byFkey(panel, "provider-wait");
      expect(select).not.toBe(null);
      expect(select.tagName).toBe("select");
      expect(select.value).toBe("15000");
      const options = findAll(select, (node) => node.tagName === "option");
      expect(options.map((option) => option.value))
        .toEqual(["3000", "5000", "7500", "10000", "15000"]);
      expect(options.map(textOf))
        .toEqual(["3 seconds", "5 seconds", "7.5 seconds", "10 seconds", "15 seconds"]);
      expect(textOf(panel)).toContain("Provider wait");
      expect(textOf(panel)).toContain("How long each refresh waits for provider scans before showing last-known data as degraded.");
    }));
  });

  test("(3b4) Save writes the chosen fleet provider wait and Reset all restores 7.5 seconds", async () => {
    const settings = {
      version: 2,
      activityFreshMinutes: 3,
      activityQuietMinutes: 45,
      scanWindowHours: 36,
      historyRetentionDays: 30,
      historyRecordLimit: 5000,
      providerWaitMs: 15000,
    };
    const snap = snapshot();

    await withState({
      settingsPanelOpen: true,
      settings,
      settingsPending: false,
      snap,
    }, () => withRequests([
      { status: 200, json: { ok: true, settings: { ...settings, providerWaitMs: 3000 }, scanWindowHours: 36 } },
      { status: 200, json: snap },
    ], async (calls) => {
      M.renderSettingsPanel();
      const panel = domById.get("settings-panel")!;
      const select = byFkey(panel, "provider-wait");
      select.value = "3000";
      // The fake document does not index created descendants by id; give the
      // real settingsValue lookup the same node a browser getElementById finds.
      domById.set("setting-providerWaitMs", select);
      await fire(byFkey(panel, "settings-save"));
      await settle();
      const post = calls.find((call) => call.url === "/api/settings" && call.method === "POST");
      expect(post).toBeTruthy();
      expect(post!.body.providerWaitMs).toBe(3000);
    }));

    await withState({
      settingsPanelOpen: true,
      settings,
      settingsPending: false,
      snap,
    }, () => withRequests([
      { status: 200, json: { ok: true, settings: { ...settings, providerWaitMs: 7500 }, scanWindowHours: 36 } },
      { status: 200, json: snap },
    ], async (calls) => {
      M.renderSettingsPanel();
      await fire(byFkey(domById.get("settings-panel")!, "settings-reset"));
      await settle();
      const post = calls.find((call) => call.url === "/api/settings" && call.method === "POST");
      expect(post).toBeTruthy();
      expect(post!.body.providerWaitMs).toBe(7500);
    }));
  });

  test("(3c) the review-worker chip writes the shared server setting", async () => {
    const snap = reviewBoard();
    await withState({
      snap, view: "board", query: "", facetProgram: "", facetProviders: [],
      lookbackHours: 6, showReviewWorkers: false, settingsPending: false,
      // FE-4 D3: the control is the Class menu's footer, so the menu is open.
      openFilterMenu: "class",
    }, () => withRequests([
      { status: 200, json: { ok: true, settings: { showReviewWorkers: true } } },
      { status: 200, json: { ok: true, ...snap } },
    ], async (calls) => {
      M.renderFilterBar(M.state);
      const chip = byFkey(domById.get("filter-bar"), "session-kind:review");
      expect(chip).toBeTruthy();
      await fire(chip);
      await settle();
      const post = calls.find((c) => c.url.includes("/api/settings") && c.method === "POST");
      expect(post).toBeTruthy();
      expect(post!.body).toEqual({ showReviewWorkers: true });
      expect(M.state.showReviewWorkers).toBe(true);
    }));
  });

  test("(3d) a rejected save puts the chip back where the server has it", async () => {
    const snap = reviewBoard();
    await withState({
      snap, view: "board", query: "", facetProgram: "", facetProviders: [],
      lookbackHours: 6, showReviewWorkers: false, settingsPending: false,
      openFilterMenu: "class",
    }, () => withRequests([new Error("connection refused")], async () => {
      M.renderFilterBar(M.state);
      await fire(byFkey(domById.get("filter-bar"), "session-kind:review"));
      // The optimistic flip happened...
      expect(M.state.showReviewWorkers).toBe(true);
      await settle();
      /* ...and the rejection took it back, because nothing else would:
         fetchSettings runs once at boot, so an uncorrected optimistic write
         would leave the chip asserting a visibility the server refused, over a
         board still filtered the old way.

         Mutation-checked: dropping the rollback branch from setShowReviewWorkers
         fails this line with `Received: true`, so it cannot pass over the bug it
         was written for. */
      expect(M.state.showReviewWorkers).toBe(false);
    }));
  });

  /* The program lens is SET here and CLEARED from the Filters bar, so the two
     halves have to agree on the id or the operator gets stuck inside a program
     with no visible way out. */
  test("(3f) the program drawer sets the program lens the Filters bar clears", async () => {
    const program = { id: "p1", name: "Ridge", agents: [agent({ id: "codex:a", programId: "p1" })] };
    await withState({ facetProgram: "" }, () => withRequests([], async () => {
      const pane = (globalThis as unknown as { document: { createElement(t: string): FakeNode } })
        .document.createElement("div");
      M.renderProgramDrawer(pane, { program });
      const button = byFkey(pane, "facet-program:p1");
      expect(button).toBeTruthy();
      expect(textOf(button)).toContain("Only this program");
      await fire(button);
      expect(M.state.facetProgram).toBe("p1");

      // And the same button is the way back out, from either surface.
      M.renderFilterBar(M.state);
      await fire(byFkey(domById.get("filter-bar"), "program:clear"));
      expect(M.state.facetProgram).toBe("");
    }));
  });

  /* The read half of D7. fetchSettings is private and runs once at boot, so this
     is source-level by necessity — requiredSlice still fails loudly if the
     function is renamed or the adoption is dropped. */
  test("(3e) fetchSettings adopts the server's review-worker default", () => {
    const fn = requiredSlice(source, /async function fetchSettings\(\)[\s\S]*?\n\}\n/, "fetchSettings");
    expect(fn).toContain("state.showReviewWorkers = body.settings.showReviewWorkers");
    // Guarded on the in-flight save: a refetch racing the operator's own toggle
    // must not flip the chip back under their finger.
    expect(fn).toMatch(/!state\.settingsPending/);
  });

  test("(3) every control the filter bar rebuilds every paint is focus-restorable", () => {
    const bar = () => domById.get("filter-bar");

    /* An EMPTY board carries the Time control and nothing else, and that is the
       lens rule doing its job rather than a gap: an axis renders only when two
       or more of its options are actually populated, so over no sessions there
       is nothing any lens could usefully narrow. Time is the exception because
       it is not a lens — it is how you go and FETCH sessions, which is the one
       thing worth offering on a board that has none.

       The six lookback chips are gone too: a CLOSED menu contributes exactly one
       focus stop, which is the compression the redesign was for. The preset
       fkeys still exist, on the menu items, and only while it is open. */
    withDom(() => {
      M.renderFilterBar(listUi({ view: "board", lookbackHours: 6, scanWindowHours: 36 }));
      const keys = focusKeysOf(bar());
      expect(keys.every(Boolean)).toBe(true);
      expect(new Set(keys).size).toBe(keys.length); // querySelector must find ONE node
      expect(keys).toEqual(["lookback:menu"]);
    });

    /* The same bar over a real fleet, which is where the facet menus appear. The
       ORDER is the contract — the bar is torn down and rebuilt on every paint,
       focus restore keys on position-independent fkeys, and a screen reader
       walks the axes in this sequence: the lenses, then TIME LAST. Time moved to
       the end deliberately (FE-2 D2): everything before it narrows within the
       population, and it is the one control that decides what the population is,
       so the two layers are separated in space as well as in the markup. CLASS
       leads the lenses (FE-4 D2) because it answers who the agent is, and every
       axis after it is a question about that same agent — and the review policy
       is no longer a stop of its own here at all, having moved into the Class
       menu's footer. Updated deliberately here, never incidentally. */
    withDom(() => {
      const updatedAt = new Date().toISOString();
      const review = agent({
        id: "claude:r1", provider: "claude", updatedAt,
        sessionKind: "review", sessionKindSource: "launch-evidence",
        task: "Review this change for security vulnerabilities.",
      });
      const work = agent({ id: "codex:w1", provider: "codex", updatedAt, task: "Ship it." });
      const idle = agent({ id: "codex:w2", provider: "codex", status: "waiting", updatedAt, task: "Waiting." });
      const snap = snapshot({ programs: [{ id: "p", name: "P", agents: [review, work, idle] }] });
      /* showReviewWorkers is TRUE here, and that is load-bearing rather than
         incidental. Counts are working-set counts, so with the reviewer hidden
         this fleet holds one visible provider and the Provider axis correctly
         declines to render — a filter offering one option is the furniture this
         rule exists to refuse. The fixture admits the reviewer so there are two
         providers and two lifecycles to actually distinguish between. */
      M.renderFilterBar(listUi({
        view: "board", lookbackHours: 6, scanWindowHours: 36, snap, showReviewWorkers: true,
      }));
      const keys = focusKeysOf(bar());
      expect(new Set(keys).size).toBe(keys.length);
      /* CLOSED triggers, one per axis. Three focus stops where the chips took
         nine, and the axis order is the contract: the lenses in bar order, then
         TIME last — the working-set control, held apart from everything that
         merely narrows within it. */
      expect(keys).toEqual([
        "class:menu",
        "provider:menu",
        "status:menu",
        "lookback:menu",
      ]);
      /* The review policy is inside the Class menu now, so it is not a stop on
         the closed bar. Its fkey is unchanged and it is one keystroke deeper,
         with the ⊘ on the trigger saying so — pinned in the FE4-D3 tests. */
      expect(keys).not.toContain("session-kind:review");
      /* Model, Span and Context are absent, and for the same reason Provider was
         absent a moment ago: this fleet reports one model, no measured spans and
         no context readings, so each of those axes has exactly one populated
         option and nothing to distinguish. They are not conditional on the view;
         they are conditional on having something to say. */
      expect(keys.some((k: string) => k.startsWith("model:"))).toBe(false);
      expect(keys.some((k: string) => k.startsWith("span:"))).toBe(false);
      expect(keys.some((k: string) => k.startsWith("context:"))).toBe(false);
    });

    /* All six axes at once, over a fleet that can actually distinguish on each
       one. This is the bar-order contract from amendment 1 with FE-4's Class at
       its head: Class · Provider · Status · Model · Span · Context, flat rather
       than nested behind a "More" — a filter you have to go looking for is one
       operators stop knowing they have. */
    withDom(() => {
      const updatedAt = new Date().toISOString();
      const rich = [
        agent({ id: "codex:1", provider: "codex", model: "gpt-5-codex", updatedAt, elapsedMs: 60_000,
          role: "orchestrator",
          tokens: { provenance: "observed", scope: "latest-turn", total: 10_000, contextWindow: 100_000 } }),
        agent({ id: "claude:1", provider: "claude", model: "claude-opus-5", status: "waiting", updatedAt,
          elapsedMs: 20 * 3_600_000,
          tokens: { provenance: "observed", scope: "latest-turn", total: 80_000, contextWindow: 100_000 } }),
      ];
      const snap = snapshot({ programs: [{ id: "p", name: "P", agents: rich }] });
      M.renderFilterBar(listUi({ view: "board", lookbackHours: null, snap, showReviewWorkers: true }));
      expect(focusKeysOf(bar())).toEqual([
        "class:menu", "provider:menu", "status:menu", "model:menu", "span:menu", "context:menu",
        "lookback:menu",
      ]);
    });

    /* The program lens has no always-on menu — programs are unbounded — so its
       clear-chip appears only while it is active, and it sits with the lenses,
       in front of Time. */
    const ridge = () => {
      const only = agent({ id: "codex:w1", provider: "codex", updatedAt: new Date().toISOString(), task: "Ship it." });
      return snapshot({ programs: [{ id: "p", name: "Ridge", agents: [only] }] });
    };
    withDom(() => {
      M.renderFilterBar(listUi({ view: "board", lookbackHours: 6, scanWindowHours: 36, snap: ridge() }));
      expect(focusKeysOf(bar())).not.toContain("program:clear");
    });
    withDom(() => {
      M.renderFilterBar(listUi({ view: "board", lookbackHours: 6, scanWindowHours: 36, snap: ridge(), facetProgram: "p" }));
      const keys = focusKeysOf(bar());
      /* Time is last, and the program lens sits in front of it: the clear-chip
         is a lens like the menus beside it, and the working-set control closes
         the bar. Anything appended after Time would have crossed the boundary
         this layout exists to draw. */
      expect(keys[keys.length - 1]).toBe("lookback:menu");
      expect(keys[keys.length - 2]).toBe("program:clear");
      // The chip names the program it is holding you inside of.
      expect(textOf(byFkey(bar(), "program:clear"))).toContain("Ridge");
    });

    // One provider on the wire is no choice at all, so the axis stays absent
    // rather than rendering a chip whose only effect is to be turned back off.
    withDom(() => {
      const only = agent({ id: "codex:w1", provider: "codex", updatedAt: new Date().toISOString(), task: "Ship it." });
      const snap = snapshot({ programs: [{ id: "p", name: "P", agents: [only] }] });
      M.renderFilterBar(listUi({ view: "board", lookbackHours: 6, scanWindowHours: 36, snap }));
      expect(focusKeysOf(bar()).some((k: string) => k.startsWith("provider:"))).toBe(false);
    });

    // Usage: the range chips, rebuilt on the same cadence.
    withDom(() => {
      M.renderFilterBar(listUi({ view: "usage", usageRangeId: "24h", usageCustomHours: 24 }));
      const keys = focusKeysOf(bar());
      expect(keys).toEqual(["usage-range:1h", "usage-range:24h", "usage-range:7d", "usage-range:30d", "usage-range:custom"]);
    });

    /* The key of the control an operator is standing on does not move when the
       selection changes — otherwise focus restore finds nothing after the click.
       On "board", not the old "idle": lookbackApplies("idle") is false, so that
       bar rendered hidden and empty and the three comparisons below were [] to
       [] — a pin that could not fail. The Time trigger RENAMES itself on every
       pick ("Last 6h" → "Last 24h" → "Time"), which is exactly the label-moves-
       under-the-fkey case this guards, so it now has something to say. */
    const keyAt = (hours: number | null) => withDom(() => {
      M.renderFilterBar(listUi({ view: "board", lookbackHours: hours }));
      return focusKeysOf(bar());
    });
    expect(keyAt(6)).toContain("lookback:menu");
    expect(keyAt(6)).toEqual(keyAt(24));
    expect(keyAt(null)).toEqual(keyAt(6));
  });

  /* -------- FE-2 D1/D2: the time menu ---------------------------------------
     Time stopped being six chips beside the lenses and became one menu at the
     far end of the bar. The point is not compression: the tab count moves when
     time moves and never when a lens moves, and a control that decides the
     population must not dress like the controls that merely narrow it. */

  const timeBar = () => domById.get("filter-bar");
  const openTime = (over: Record<string, unknown> = {}) =>
    M.renderFilterBar(listUi({ view: "board", lookbackHours: 6, openFilterMenu: "time", ...over }));

  test("(FE2-D2) a closed time menu is one focus stop; opening it exposes the presets", async () => {
    await withState({ view: "board", snap: null, lookbackHours: 6, openFilterMenu: "" },
      () => withRequests([], async () => {
        M.renderFilterBar(M.state);
        const trigger = byFkey(timeBar(), "lookback:menu");
        expect(trigger.attributes["aria-haspopup"]).toBe("menu");
        expect(trigger.attributes["aria-expanded"]).toBe("false");
        // Closed means ABSENT, not hidden: a menu left in the tree is a dozen
        // extra tab stops between the operator and the search box.
        expect(byClass(timeBar(), "filter-menu")).toBeNull();
        expect(byFkey(timeBar(), "lookback:24")).toBeNull();

        await fire(trigger);
        expect(M.state.openFilterMenu).toBe("time");
        // The real repaint the click drove, not a second hand-run render.
        const menu = byClass(timeBar(), "filter-menu");
        expect(menu.attributes.role).toBe("menu");
        expect(byFkey(timeBar(), "lookback:menu").attributes["aria-expanded"]).toBe("true");
        expect(focusKeysOf(menu)).toEqual([
          "lookback:1", "lookback:6", "lookback:12", "lookback:24",
          "lookback:48", "lookback:168", "lookback:336", "lookback:720",
          "lookback:all", "lookback:custom",
        ]);

        // Clicking the open trigger is the way back out — the way out is the way in.
        await fire(byFkey(timeBar(), "lookback:menu"));
        expect(M.state.openFilterMenu).toBe("");
        expect(byClass(timeBar(), "filter-menu")).toBeNull();
      }));
  });

  test("(FE2-D2) a day preset stores hours and closes the menu on the operator's pick", async () => {
    await withState({ view: "board", snap: null, lookbackHours: 6, openFilterMenu: "time" },
      () => withRequests([], async () => {
        M.renderFilterBar(M.state);
        /* 2d is 48h in storage. The whole day group is sugar over the SAME
           setLookbackHours the hour group calls, which is why `mtn3-lookbackHours`
           needed no migration — if a day item ever wrote "2" instead of 48, a
           reload would silently narrow a two-day board to two hours. */
        await fire(byFkey(timeBar(), "lookback:48"));
        expect(M.state.lookbackHours).toBe(48);
        // Time is single-valued, so its menu is radio and it closes on the pick.
        expect(M.state.openFilterMenu).toBe("");
        expect(byFkey(timeBar(), "lookback:menu").attributes.role).toBeUndefined();
        expect(textOf(byFkey(timeBar(), "lookback:menu"))).toContain("Last 2d");
      }));
    await withState({ view: "board", snap: null, lookbackHours: 6, openFilterMenu: "time" },
      () => withRequests([], async () => {
        M.renderFilterBar(M.state);
        await fire(byFkey(timeBar(), "lookback:720"));
        expect(M.state.lookbackHours).toBe(720); // 30d, not 30
      }));
  });

  test("(FE2-D2) the items are radios that report which window is in force", () => {
    withDom(() => {
      openTime({ lookbackHours: 48 });
      const checked = buttonsOf(byClass(timeBar(), "filter-menu"))
        .filter((b: { attributes: Record<string, string> }) => b.attributes["aria-checked"] === "true")
        .map((b: { dataset: Record<string, string> }) => b.dataset.fkey);
      // Exactly one, because a session has exactly one lookback window. This is
      // the line that fails if the lens axes' checkbox semantics are ever copied
      // onto time, where "1h AND 7d" has no meaning to give an operator.
      expect(checked).toEqual(["lookback:48"]);
      for (const b of buttonsOf(byClass(timeBar(), "filter-menu"))) {
        expect(b.attributes.role).toBe("menuitemradio");
      }
    });

    // A window nobody offers is the Custom item's job to own, and the trigger
    // states it rather than reading "Custom" and hiding the number.
    withDom(() => {
      openTime({ lookbackHours: 36 });
      expect(byFkey(timeBar(), "lookback:custom").attributes["aria-checked"]).toBe("true");
      expect(textOf(byFkey(timeBar(), "lookback:menu"))).toContain("Last 36h");
    });

    /* "Everything" is not a narrowing, so the trigger drops its pressed ink and
       says the axis name instead of a window. The board is hiding nothing by
       time, and a filled chip claiming otherwise is the overclaim this bar was
       just cleaned of. */
    withDom(() => {
      openTime({ lookbackHours: null });
      const trigger = byFkey(timeBar(), "lookback:menu");
      expect(trigger.attributes["aria-pressed"]).toBe("false");
      expect(textOf(trigger)).toContain("Time");
      expect(byFkey(timeBar(), "lookback:all").attributes["aria-checked"]).toBe("true");
    });
  });

  test("(FE2-D2) the 36h preset is gone, and the Days caveat is Board-only and concrete", () => {
    withDom(() => {
      openTime();
      /* The 36 died deliberately: it was the SERVER's scan constant wearing a
         filter's clothes, and an operator who learned "36h" as a lookback learned
         that the collector's reach and their own filter were one window. */
      expect(byFkey(timeBar(), "lookback:36")).toBeNull();
      const note = byClass(timeBar(), "filter-menu-note");
      expect(textOf(note)).toContain("still on the live wire");
      // Described, not merely printed: a caveat a screen reader walks past is
      // decoration. The Days group points at it.
      const group = byClass(timeBar(), "filter-menu-group");
      expect(allByClass(timeBar(), "filter-menu-group")[1].attributes["aria-describedby"])
        .toBe(note.attributes.id);
      expect(group).toBeTruthy();
    });

    // On History the archive IS the population, so the caveat would be false.
    withDom(() => {
      openTime({ view: "history" });
      expect(byClass(timeBar(), "filter-menu-note")).toBeNull();
    });

    /* The boundary gets a NUMBER when a snapshot has carried one — "reaches only
       the live wire" is abstract until it says how far the wire goes. */
    withDom(() => {
      openTime({ snap: snapshot({ scanWindowHours: 36 }) });
      expect(textOf(byClass(timeBar(), "filter-menu-note"))).toContain("scan 36h back");
    });
    /* …and stays silent when none has. state.scanWindowHours holds a client-side
       36 no server ever confirmed; printing it here as a boundary is the exact
       overclaim renderScanWindow was fixed to stop making, in the one place an
       operator is least able to check it. */
    withDom(() => {
      openTime({ snap: null, scanWindowHours: 36 });
      expect(textOf(byClass(timeBar(), "filter-menu-note"))).not.toContain("36");
    });
  });

  /* -------- FE-2 D3 + amendment 1: the lens axes --------------------------- */

  /* The fleet the lens tests share: two classes, two providers, two models, two
     lifecycles, two span bands, two context bands, and one row that reports none
     of the optional readings — so every axis has something to distinguish AND an
     Unreported population to account for. */
  const lensFleet = () => {
    const updatedAt = new Date().toISOString();
    return snapshot({
      generatedAt: updatedAt,
      programs: [{
        id: "p", name: "P", agents: [
          agent({
            /* FE-4 D2: the Class axis needs two populated members here or the
               table tests below would cover it with a single-bucket fixture,
               where "the options partition the working set" is true of any
               classification at all. */
            id: "codex:short", provider: "codex", model: "gpt-5-codex", updatedAt, role: "orchestrator",
            elapsedMs: 30 * 60_000,                                     // under 1h
            tokens: { provenance: "observed", scope: "latest-turn", total: 10_000, contextWindow: 100_000 }, // 10%
          }),
          agent({
            id: "claude:long", provider: "claude", model: "claude-opus-5", status: "waiting", updatedAt,
            elapsedMs: 30 * 3_600_000,                                  // over 24h
            tokens: { provenance: "observed", scope: "latest-turn", total: 90_000, contextWindow: 100_000 }, // 90%
          }),
          agent({
            id: "codex:bare", provider: "codex", model: "", updatedAt,
            elapsedMs: null,                                            // no measured span
            tokens: { provenance: "reported", total: 5 },               // contextUsage() → null
          }),
        ],
      }],
    });
  };
  const lensUi = (over: Record<string, unknown> = {}) =>
    listUi({ view: "board", lookbackHours: null, snap: lensFleet(), showReviewWorkers: true, ...over });

  test("(FE2-D3) every axis counts over the working set, and its own filter agrees with its own count", () => {
    /* The invariant that makes the whole two-layer model checkable, asserted
       against the AXIS TABLE rather than against five hand-written cases: for
       every axis, and every option it offers, the number printed beside that
       option is exactly the number of rows selecting it would leave. An axis
       that counted by one rule and filtered by another is the original defect
       of this bar wearing a new shape. */
    const ui = lensUi();
    const ws = M.workingSet(ui);
    expect(ws.length).toBe(3);
    for (const axis of M.LENS_AXES) {
      for (const option of M.lensOptions(axis, ui)) {
        const selecting = ws.filter((a: Record<string, unknown>) => axis.matches(a, option.value)).length;
        expect(option.count, `${axis.key}:${option.value}`).toBe(selecting);
      }
      // And the options partition the working set — every row lands in exactly
      // one bucket, so the counts sum to the total and nothing is orphaned.
      const total = M.lensOptions(axis, ui).reduce((n: number, o: { count: number }) => n + o.count, 0);
      expect(total, `${axis.key} partitions the working set`).toBe(ws.length);
    }
  });

  test("(FE2-D3) a model the shortener refuses still gets a labeled option, not a crash", () => {
    /* Live regression, 2026-08-06 06:15: the fleet carries model "<synthetic>"
       (a truthy string, so it passes filter(Boolean)) and modelShort() returns
       NULL for it by design (placeholder guard). The option's label came out
       null, lensFilterMenu called .toLowerCase() on it, and render() threw
       before the board ever painted — the page was down. The label falls back
       to the raw string: honest, filterable, and render survives. */
    const updatedAt = new Date().toISOString();
    const snap = snapshot({
      programs: [{ id: "p", name: "P", agents: [
        agent({ id: "claude:syn", provider: "claude", model: "<synthetic>", updatedAt, task: "A" }),
        agent({ id: "codex:m", provider: "codex", model: "gpt-5.6-sol", updatedAt, task: "B" }),
      ] }],
    });
    const ui = listUi({ view: "board", lookbackHours: null, snap, showReviewWorkers: true });
    const modelAxis = M.LENS_AXES.find((a: { key: string }) => a.key === "model")!;
    const labels = M.lensOptions(modelAxis, ui).map((o: { label: unknown }) => o.label);
    for (const label of labels) expect(typeof label, String(label)).toBe("string");
    expect(labels).toContain("<synthetic>");
    // And the whole bar renders over this fleet — the crash site was render().
    withDom(() => {
      expect(() => M.renderFilterBar(ui)).not.toThrow();
    });
  });

  test("(FE2-D3) the counts do not move when another lens narrows the board", () => {
    /* Counts are working-set counts on purpose. If they were taken AFTER the
       other lenses, every option would fall towards zero as the operator
       narrowed — and a menu of zeroes cannot be used to widen back out, which is
       the one job it has at that moment. */
    const before = M.lensOptions(M.LENS_AXES[0], lensUi());
    const after = M.lensOptions(M.LENS_AXES[0], lensUi({
      facetStatuses: ["waiting"], facetModels: ["claude-opus-5"], query: "nothing-matches",
    }));
    expect(after.map((o: { value: string; count: number }) => [o.value, o.count]))
      .toEqual(before.map((o: { value: string; count: number }) => [o.value, o.count]));
  });

  test("(FE2-D3) Model, Span and Context bucket what the row itself reports", () => {
    const ui = lensUi();
    const opts = (key: string) => {
      const axis = M.LENS_AXES.find((a: { key: string }) => a.key === key);
      return Object.fromEntries(M.lensOptions(axis, ui).map((o: { value: string; count: number }) => [o.value, o.count]));
    };
    /* Unreported is a MEMBER of each axis, not a gap. contextUsage() returns
       null for anything that is not an observed latest-turn reading, which on a
       real board is a large population; an axis whose buckets silently excluded
       it would hide rows behind a filter with no item to un-hide them. */
    expect(opts("model")).toEqual({ "claude-opus-5": 1, "gpt-5-codex": 1, "": 1 });
    expect(opts("span")).toEqual({ "under-1h": 1, "1-8h": 0, "8-24h": 0, "over-24h": 1, "": 1 });
    expect(opts("context")).toEqual({ "under-25": 1, "25-50": 0, "50-75": 0, "over-75": 1, "": 1 });
  });

  test("(FE2-D3) the Span lens reads the same number the SPAN cell prints", () => {
    /* Amendment 1 said reuse the row's elapsed source rather than inventing a
       second duration. This is that promise made checkable: the bucket boundary
       and the cell are both liveElapsedMs, so a row cannot read "9h" in its SPAN
       column while sitting under a filter for 1–8h. Drift correction included —
       a running session's span advances between snapshots, and a lens computing
       from the raw field would disagree with the cell by exactly that drift. */
    const generatedAt = new Date(Date.now() - 2 * 3_600_000).toISOString();
    const running = agent({ id: "codex:r", status: "running", elapsedMs: 30 * 60_000, updatedAt: generatedAt });
    const span = M.LENS_AXES.find((a: { key: string }) => a.key === "span");
    return withState({ snap: snapshot({ generatedAt, programs: [{ id: "p", name: "P", agents: [running] }] }) }, () => {
      // 30min recorded + ~2h of drift = ~2.5h, which is what the cell prints and
      // what the lens must bucket by. "under-1h" is the un-drifted answer, and
      // it is the answer a second, independent duration would have given.
      expect(M.liveElapsedText(running, generatedAt)).toBe("2.5h");
      expect(span.matches(running, "under-1h")).toBe(false);
      expect(span.matches(running, "1-8h")).toBe(true);
    });
  });

  /* -------- FE-2 D5/D6: the sentence, and the count rule it exists to state ---
     The tab number and the row count measure different populations and always
     did. That is the two-layer model, not a bug — but it was left for the
     operator to discover, which is why lenses "looked broken" every time they
     failed to move the number beside the tab they were filtering. */

  /* FE-4 D4 moved the board's sentence into the filter bar row; `#scope-note`
     below the search box is now the Usage line's slot alone. The render target
     changed, the behaviour these pin did not. */
  const noteOf = () => domById.get("bar-scope-note")!;
  /* The fake document lives only for the duration of withRequests, so anything
     that clicks the rendered sentence has to run INSIDE it — render() reads
     `document` and a fire() after the teardown throws rather than failing. */
  const sentence = (over: Record<string, unknown>, shown: number, then: () => Promise<void> | void = () => {}) =>
    withState({ view: "board", lookbackHours: null, showReviewWorkers: true, fetchFailed: false, ...over },
      () => withRequests([], async () => { M.renderScopeNote(shown); await then(); }));

  test("(FE2-D6) lenses and the query never move the tab count", async () => {
    /* THE pinned rule. Tab counts are working-set counts — view × time × the
       fleet's review policy — and the lenses narrow INSIDE that set. If a lens
       ever moved this number, the sentence's "8 of 21" would be quoting a total
       that had already shrunk to 8, and the reconciliation would say nothing.

       Time is the control that MAY move it, and does, asserted last: that is
       what makes this a designed boundary rather than an accident that happens
       to hold for the filters we tested. */
    /* The shared fleet plus one session that went quiet three hours ago. It is
       there for the LAST assertion: without a row the time window can actually
       exclude, "time moves the count" would pass vacuously and this test would
       only be pinning half a boundary. */
    const stale = agent({
      id: "codex:stale", provider: "codex", status: "waiting",
      updatedAt: new Date(Date.now() - 3 * 3_600_000).toISOString(),
    });
    const fleet = lensFleet();
    const snap = { ...fleet, programs: [{ ...fleet.programs[0], agents: [...fleet.programs[0].agents, stale] }] };
    const countWith = async (over: Record<string, unknown>) => {
      let count = "";
      await withState({ snap, view: "board", lookbackHours: null, showReviewWorkers: true, ...over },
        () => withDom(() => { M.renderTabs(); count = domById.get("count-board")!.textContent; }));
      return count;
    };
    const base = await countWith({});
    expect(base).toBe("4");
    expect(await countWith({ facetClasses: ["orchestrator"] })).toBe(base);
    expect(await countWith({ facetProviders: ["codex"] })).toBe(base);
    expect(await countWith({ facetStatuses: ["waiting"] })).toBe(base);
    expect(await countWith({ facetModels: ["gpt-5-codex"] })).toBe(base);
    expect(await countWith({ facetSpans: ["under-1h"] })).toBe(base);
    expect(await countWith({ facetContexts: ["over-75"] })).toBe(base);
    expect(await countWith({ query: "nothing-matches-this" })).toBe(base);
    // Every lens at once, still the same number.
    expect(await countWith({
      facetClasses: ["orchestrator"], facetProviders: ["codex"], facetStatuses: ["waiting"],
      facetModels: ["gpt-5-codex"], facetSpans: ["under-1h"], facetContexts: ["over-75"], query: "zzz",
    })).toBe(base);

    // …and the working-set controls DO move it, which is the other half of the
    // rule: this is a boundary, not a claim that nothing affects the count.
    expect(await countWith({ lookbackHours: 1 })).not.toBe(base);
  });

  test("(FE2-D5) the sentence renders only the lenses that are on, and reconciles the numbers", async () => {
    await sentence({ snap: lensFleet(), facetProviders: ["codex"], facetStatuses: ["waiting"] }, 1);
    const note = noteOf();
    expect(textOf(note)).toContain("Showing");
    expect(textOf(note)).toContain("Codex");
    expect(textOf(note)).toContain("waiting");
    /* "1 of 3": one row survived every lens, out of the three the working set
       holds — and 3 is the tab number, from the same helper, so the sentence can
       never quote a total the tab beside it disagrees with. */
    expect(textOf(byClass(note, "scope-count"))).toBe("1 of 3");
    // Only the ACTIVE axes get a fragment. Three lenses off, three absent.
    expect(focusKeysOf(note)).toEqual(["sentence:provider", "sentence:status", "sentence:clear"]);
  });

  test("(FE2-D5) a quiet board says nothing at all", async () => {
    // The line that always renders is the line nobody reads. With no lens, no
    // query and fresh data, the tabs have already said everything.
    await sentence({ snap: lensFleet() }, 3);
    expect(noteOf().hidden).toBe(true);
    expect(textOf(noteOf())).toBe("");

    // Stale data speaks on its own, with no sentence wrapped around it.
    await sentence({ snap: lensFleet(), fetchFailed: true }, 3);
    expect(noteOf().hidden).toBe(false);
    expect(textOf(noteOf())).toBe("last refresh failed");
  });

  test("(FE2-D5) each fragment reaches the control that owns it", async () => {
    // A lens fragment opens its menu — the operator is already looking at the
    // sentence, so they should not have to hunt the bar for the right trigger.
    await sentence({ snap: lensFleet(), facetStatuses: ["waiting"], query: "ridge" }, 1, async () => {
      await fire(byFkey(noteOf(), "sentence:status"));
      expect(M.state.openFilterMenu).toBe("status");
    });

    /* The program fragment CLEARS instead of opening: programs are unbounded, so
       there is no program menu to open, and the fragment is the way off. The
       title says so, because a button that clears while its siblings open is a
       difference the operator cannot see. */
    await sentence({ snap: lensFleet(), facetProgram: "p" }, 1, async () => {
      expect(byFkey(noteOf(), "sentence:program").attributes.title).toContain("every program");
      await fire(byFkey(noteOf(), "sentence:program"));
      expect(M.state.facetProgram).toBe("");
    });

    /* The query fragment has no menu either — its control is the search box —
       so it focuses and SELECTS: the operator clicked the word they want to
       change, and landing them at its end to backspace through it is a worse
       answer than handing them a replaceable selection. */
    await sentence({ snap: lensFleet(), query: "ridge" }, 1, async () => {
      let focused = false;
      let selected = false;
      domById.set("search", {
        ...newNode("input"),
        focus: () => { focused = true; },
        select: () => { selected = true; },
      } as unknown as FakeNode);
      await fire(byFkey(noteOf(), "sentence:query"));
      expect(focused).toBe(true);
      expect(selected).toBe(true);
    });
  });

  test("(FE2-D5) Clear resets the lenses and the query, and nothing else", async () => {
    /* The two exclusions are the whole point. showReviewWorkers is the FLEET's
       setting saved on the server — a "clear filters" that silently changed what
       a colleague sees would be the worst kind of surprise — and the time window
       is the working set itself, so clearing it would move the very total the
       sentence is standing next to. */
    await sentence({
      snap: lensFleet(), lookbackHours: 6, showReviewWorkers: false, query: "ridge",
      facetProgram: "p", facetClasses: ["orchestrator"], facetProviders: ["codex"],
      facetStatuses: ["waiting"], facetModels: ["gpt-5-codex"], facetSpans: ["under-1h"],
      facetContexts: ["over-75"],
    }, 1, async () => {
      await fire(byFkey(noteOf(), "sentence:clear"));
      expect(M.state.facetClasses).toEqual([]);
      expect(M.state.facetProviders).toEqual([]);
      expect(M.state.facetStatuses).toEqual([]);
      expect(M.state.facetModels).toEqual([]);
      expect(M.state.facetSpans).toEqual([]);
      expect(M.state.facetContexts).toEqual([]);
      expect(M.state.facetProgram).toBe("");
      expect(M.state.query).toBe("");
      // Untouched, both of them.
      expect(M.state.lookbackHours).toBe(6);
      expect(M.state.showReviewWorkers).toBe(false);
    });
  });

  test("(FE2-D1) Escape closes the menu without selecting, and returns focus to the trigger", async () => {
    await withState({ view: "board", snap: null, lookbackHours: 6, openFilterMenu: "time" },
      () => withRequests([], async () => {
        M.renderFilterBar(M.state);
        /* focusFilterTrigger looks the trigger up AFTER the repaint, because the
           node this handler was built on is detached by then and focusing a
           detached element is a silent no-op that lands the operator on <body>.
           The fake document finds nothing by selector, so the lookup is stood in
           for here — what is under test is that the close path performs it at
           all, and against the RIGHT fkey. */
        const focused: string[] = [];
        (globalThis as unknown as { document: Record<string, unknown> }).document.querySelector =
          (sel: string) => ({ focus: () => focused.push(sel) });

        M.closeFilterMenu();
        expect(M.state.openFilterMenu).toBe("");
        expect(M.state.lookbackHours).toBe(6); // nothing was selected on the way out
        expect(focused).toEqual([`[data-fkey="lookback:menu"]`]);

        /* …and out of EVERY lens menu, not just the three a hand-kept map
           happened to name. Escape out of Model, Span or Context looked up
           nothing and dropped the operator on <body>; the trigger key is derived
           from the axis table now, so a new axis cannot arrive without one. */
        for (const axis of M.LENS_AXES) {
          focused.length = 0;
          M.state.openFilterMenu = axis.key;
          M.closeFilterMenu();
          expect(focused, axis.key).toEqual([`[data-fkey="${axis.key}:menu"]`]);
        }
      }));
  });

  /* -------- FE-4 D1: the class of an agent ----------------------------------
     WHO the agent is, as one word, over the fields the server publishes. The
     board already carries role, specialty and sessionKind and asks the operator
     to hold all three in their head; this collapses them into a single axis.

     One class per agent, because the lens axes must PARTITION the working set —
     an agent in two buckets makes the counts sum to more than the board holds,
     which is the invariant (FE2-D3) that lets a menu of counts be trusted at
     all. So the classification is a precedence, and these pin the order rather
     than the individual answers: any test that only checked "an orchestrator is
     an orchestrator" would pass over a table that ranked specialty first. */

  test("(FE4-D1) agentClassOf is a precedence over the published fields, not a set of tags", () => {
    // 1. Review kind outranks everything, including a role the session declared.
    expect(M.agentClassOf(agent({ sessionKind: "review", role: "orchestrator" }))).toBe("reviewer");
    /* …including the prose fallback, so a snapshot from a server that predates
       sessionKind classifies the same way it filters (sessionKindOf, not a
       second reading of the task text). */
    expect(M.agentClassOf(agent({ task: "Review this change for security vulnerabilities." })))
      .toBe("reviewer");

    // 2. Automation, from either carrier — the kind or the role.
    expect(M.agentClassOf(agent({ sessionKind: "automation" }))).toBe("automation");
    expect(M.agentClassOf(agent({ role: "automation" }))).toBe("automation");
    // But a review that happens to run under automation is still a review.
    expect(M.agentClassOf(agent({ sessionKind: "review", role: "automation" }))).toBe("reviewer");

    /* 3 before 4. An orchestrator that also declares a frontend specialty is an
       ORCHESTRATOR: what it does to the fleet outranks what it works on, and
       filing it under Frontend would hide the fleet's coordinators inside a
       discipline bucket. */
    expect(M.agentClassOf(agent({ role: "orchestrator", specialty: "frontend" }))).toBe("orchestrator");
    expect(M.agentClassOf(agent({ role: "orchestrator" }))).toBe("orchestrator");

    // 4. Specialty outranks the remaining roles: a frontend worker is Frontend.
    expect(M.agentClassOf(agent({ specialty: "frontend", role: "worker" }))).toBe("frontend");
    expect(M.agentClassOf(agent({ specialty: "backend", role: "worker" }))).toBe("backend");

    // 5. Every other published role carries through verbatim.
    for (const role of ["tester", "verifier", "worker", "monitor", "service", "human"]) {
      expect(M.agentClassOf(agent({ role })), role).toBe(role);
    }

    /* 6. And the floor. A row with no role, and a row carrying a word that is
       not in the wire's vocabulary, are both simply an agent — guessing a class
       from an unrecognised string is how "any other published role" would turn
       into re-deriving from prose. */
    expect(M.agentClassOf(agent({}))).toBe("agent");
    expect(M.agentClassOf(agent({ role: "vibes-engineer" }))).toBe("agent");
    expect(M.agentClassOf(undefined)).toBe("agent");
  });

  /* -------- FE-4 D2/D3: the Class axis, and the policy inside it ------------ */

  const classAxis = () => M.LENS_AXES.find((a: { key: string }) => a.key === "class");
  const classUi = (over: Record<string, unknown> = {}) =>
    listUi({ view: "board", lookbackHours: null, showReviewWorkers: true, ...over });
  const classFleet = (...agents: unknown[]) =>
    snapshot({ programs: [{ id: "p", name: "P", agents }] });

  test("(FE4-D2) Class leads the axis table, and every class it can produce has a menu label", () => {
    /* Class is FIRST because it answers who the agent is; provider, model, span
       and context are all questions about the same agent once you know that. */
    expect(M.LENS_AXES[0].key).toBe("class");
    expect(M.LENS_AXES[0].stateKey).toBe("facetClasses");

    /* The label table and the precedence are two lists of the same vocabulary,
       and nothing in the type system keeps them together — a class the
       precedence can return but the table has not met would be dropped from the
       options, which breaks the partition invariant by hiding rows behind a
       filter with no item able to un-hide them. So every branch of agentClassOf
       is driven, and each result has to come back as a labeled option. */
    const updatedAt = new Date().toISOString();
    const oneOfEach = [
      agent({ id: "a:rev", updatedAt, sessionKind: "review", task: "Review this change for security vulnerabilities." }),
      agent({ id: "a:auto", updatedAt, role: "automation" }),
      agent({ id: "a:orch", updatedAt, role: "orchestrator" }),
      agent({ id: "a:fe", updatedAt, specialty: "frontend" }),
      agent({ id: "a:be", updatedAt, specialty: "backend" }),
      agent({ id: "a:test", updatedAt, role: "tester" }),
      agent({ id: "a:ver", updatedAt, role: "verifier" }),
      agent({ id: "a:work", updatedAt, role: "worker" }),
      agent({ id: "a:mon", updatedAt, role: "monitor" }),
      agent({ id: "a:svc", updatedAt, role: "service" }),
      agent({ id: "a:human", updatedAt, role: "human" }),
      agent({ id: "a:plain", updatedAt }),
    ];
    const ui = classUi({ snap: classFleet(...oneOfEach) });
    const options = M.lensOptions(classAxis(), ui);
    expect(options.length).toBe(oneOfEach.length);
    for (const option of options) {
      expect(typeof option.label, String(option.value)).toBe("string");
      expect(option.label.length, String(option.value)).toBeGreaterThan(0);
      expect(option.count, String(option.value)).toBe(1);
    }
    // Ordered by what the class MEANS, not alphabetically: the fleet-shaped
    // answers first, the floor last.
    expect(options.map((o: { value: string }) => o.value)).toEqual([
      "reviewer", "orchestrator", "frontend", "backend", "automation",
      "tester", "verifier", "worker", "monitor", "service", "human", "agent",
    ]);
  });

  test("(FE4-D3) the review policy is a footer ACTION inside the Class menu, not a sixth class", async () => {
    const updatedAt = new Date().toISOString();
    const review = agent({
      id: "claude:r1", provider: "claude", updatedAt,
      sessionKind: "review", sessionKindSource: "launch-evidence",
      task: "Review this change for security vulnerabilities.",
    });
    const work = agent({ id: "codex:w1", provider: "codex", updatedAt, role: "orchestrator", task: "Ship it." });
    const snap = classFleet(review, work);

    await withState({ snap, view: "board", lookbackHours: null, showReviewWorkers: false, openFilterMenu: "class" },
      () => withRequests([], async () => {
        M.renderFilterBar(M.state);
        const bar = domById.get("filter-bar");
        const policy = byFkey(bar, "session-kind:review");
        /* Same fkey it has always had — focus restore and muscle memory were
           built on it, and the control moving one level deep is no reason to
           make an operator's hands relearn where it is. */
        expect(policy).toBeTruthy();
        expect(policy.className).toContain("filter-menu-policy");
        /* A menuitem, NOT a menuitemcheckbox. The items above it are members of
           a set this browser narrows by; this one writes a setting on the
           server, and announcing it as a checkbox in that group tells a screen
           reader operator it is a sixth class. */
        expect(policy.attributes.role).toBe("menuitem");
        expect(policy.attributes["aria-checked"]).toBeUndefined();
        expect(textOf(policy)).toContain("1 hidden reviewer");
        expect(textOf(policy)).toContain("fleet-wide setting");
        expect(policy.attributes.title).toContain("colleagues");
      }));

    // Closed, the bar carries no policy control of its own — it is inside the menu.
    withDom(() => {
      M.renderFilterBar(listUi({ view: "board", lookbackHours: null, snap, showReviewWorkers: false }));
      const bar = domById.get("filter-bar");
      expect(byFkey(bar, "session-kind:review")).toBeNull();
      expect(byClass(bar, "filter-policy")).toBeNull();
      /* …but the disclosure does not go with it. A hidden population one level
         deep with nothing at the surface saying so is the same as not saying so:
         the Class TRIGGER wears the mark, and its title carries the count and
         the fact that the setting is the fleet's. */
      const trigger = byFkey(bar, "class:menu");
      expect(textOf(trigger)).toContain("Class");
      expect(textOf(trigger)).toContain("⊘");
      expect(trigger.attributes.title).toContain("1 reviewer");
      expect(trigger.attributes.title).toContain("fleet");
    });

    // Showing them, the mark is gone — nothing is being withheld to disclose.
    withDom(() => {
      M.renderFilterBar(listUi({ view: "board", lookbackHours: null, snap, showReviewWorkers: true }));
      expect(textOf(byFkey(domById.get("filter-bar"), "class:menu"))).not.toContain("⊘");
    });
  });

  test("(FE4-D3) the Reviewer option appears exactly when the policy stops hiding them", () => {
    /* The interplay needs no special case, and this is the pin that says so.
       The working set EXCLUDES hidden reviewers, so while the policy hides them
       the Reviewer class simply has nothing in it and is not offered; flip the
       policy and the option appears with its count. A menu item that filtered
       for a population the board had already removed would offer the operator a
       guaranteed-empty board. */
    const updatedAt = new Date().toISOString();
    const review = agent({
      id: "claude:r1", provider: "claude", updatedAt,
      sessionKind: "review", sessionKindSource: "launch-evidence",
      task: "Review this change for security vulnerabilities.",
    });
    const work = agent({ id: "codex:w1", provider: "codex", updatedAt, role: "orchestrator", task: "Ship it." });
    const snap = classFleet(review, work);

    const values = (showReviewWorkers: boolean) =>
      M.lensOptions(classAxis(), classUi({ snap, showReviewWorkers }))
        .map((o: { value: string; count: number }) => [o.value, o.count]);

    expect(values(false)).toEqual([["orchestrator", 1]]);
    expect(values(true)).toEqual([["reviewer", 1], ["orchestrator", 1]]);
  });

  test("(FE4-D3) the Class menu renders for the policy alone, so the disclosure cannot vanish", () => {
    /* A one-option axis is furniture and does not render — that rule is what
       keeps the bar honest. But the Class menu now carries the fleet's review
       policy in its footer, and an axis that declined to render would take the
       policy down with it: the reviewers would be hidden with no control
       anywhere able to show them. */
    const updatedAt = new Date().toISOString();
    const review = agent({
      id: "claude:r1", provider: "claude", updatedAt,
      sessionKind: "review", sessionKindSource: "launch-evidence",
      task: "Review this change for security vulnerabilities.",
    });
    // Hidden, the working set holds nothing at all — not one class, zero.
    const snap = classFleet(review);
    withDom(() => {
      M.renderFilterBar(listUi({ view: "board", lookbackHours: null, snap, showReviewWorkers: false }));
      expect(byFkey(domById.get("filter-bar"), "class:menu")).toBeTruthy();
    });

    /* The mirror case, and it is not symmetric with the one above: the fleet is
       SHOWING reviewers and there are none in the window. The policy still has
       to be reachable, because otherwise the only way back to the fleet's
       default would be to wait for a reviewer to appear — a setting an operator
       turned on and cannot turn off. */
    const plain = classFleet(agent({ id: "codex:w1", provider: "codex", updatedAt, task: "Ship it." }));
    withDom(() => {
      M.renderFilterBar(listUi({ view: "board", lookbackHours: null, snap: plain, showReviewWorkers: true }));
      expect(byFkey(domById.get("filter-bar"), "class:menu")).toBeTruthy();
    });

    /* And where there is no policy to state at all — the fleet is at its default
       and there is nothing to hide — the ordinary rule holds: one class on the
       wire is no choice, so the axis stays absent rather than rendering a control
       whose only effect is to be turned back off. */
    withDom(() => {
      M.renderFilterBar(listUi({ view: "board", lookbackHours: null, snap: plain, showReviewWorkers: false }));
      expect(byFkey(domById.get("filter-bar"), "class:menu")).toBeNull();
    });
  });

  /* -------- FE-4 D4: the sentence moves into the filter bar row ------------- */

  test("(FE4-D4) the sentence sits between the lenses and the working-set control", async () => {
    /* Where it is IS what it says. The lenses narrow within a population; Time
       decides what the population is; the sentence reconciles those two numbers,
       and it now stands in the gap between the two layers rather than on a line
       of its own below the search box — which also fills the void that made the
       right-aligned Time trigger read as stranded. */
    await withState({
      view: "board", lookbackHours: null, showReviewWorkers: true, fetchFailed: false,
      snap: lensFleet(), facetProviders: ["codex"],
    }, () => withRequests([], async () => {
      M.renderFilterBar(M.state);
      M.renderScopeNote(1);
      const bar = domById.get("filter-bar")!;
      const note = domById.get("bar-scope-note")!;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const slots = (bar as any).children.map((child: any) =>
        child === note ? "sentence" : (focusKeysOf(child)[0] || child.className));
      expect(slots[0]).toBe("filter-lead");
      expect(slots[slots.length - 1]).toBe("lookback:menu");
      expect(slots[slots.length - 2]).toBe("sentence");
      // Every lens trigger is in front of it, none behind.
      expect(slots.indexOf("class:menu")).toBeLessThan(slots.indexOf("sentence"));
      expect(slots.indexOf("provider:menu")).toBeLessThan(slots.indexOf("sentence"));

      expect(note.hidden).toBe(false);
      expect(textOf(note)).toContain("Codex");
      expect(textOf(byClass(note, "scope-count"))).toBe("1 of 3");
      /* Still a live region, and still the SAME one across paints. It is
         declared in the markup rather than built by renderFilterBar because an
         aria-live element that is destroyed and recreated announces nothing —
         the region has to be in the tree before its content changes. */
      expect(html).toContain('id="bar-scope-note"');
      expect(note.attributes["aria-live"] ?? "polite").toBe("polite");
      M.renderFilterBar(M.state);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((bar as any).children.filter((c: unknown) => c === note).length).toBe(1);
      expect(domById.get("bar-scope-note")).toBe(note);

      // The old slot below the search box is emptied, not left holding a stale
      // copy of a sentence that now lives somewhere else.
      expect(textOf(domById.get("scope-note"))).toBe("");
      expect(domById.get("scope-note")!.hidden).toBe(true);
    }));
  });

  test("(FE4-D4) Usage keeps its own line below the search box", async () => {
    /* Usage has no lenses and no working set — only a range — so there is no
       two-layer gap for a sentence to stand in. Its line stays where it was, and
       the bar's region goes quiet rather than carrying a leftover board
       sentence into a view that cannot have one. */
    await withState({ view: "usage", usageRangeId: "24h", usageCustomHours: 24, usageLoading: false, snap: lensFleet() },
      () => withRequests([], async () => {
        M.renderFilterBar(M.state);
        M.renderScopeNote(0);
        expect(textOf(domById.get("scope-note"))).toContain("Usage range 24h");
        /* And it is VISIBLE. Leaving the board's hidden flag on this element was
           how a quiet board followed by a switch to Usage produced a range line
           that was written and never shown. */
        expect(domById.get("scope-note")!.hidden).toBe(false);
        expect(textOf(domById.get("bar-scope-note"))).toBe("");
        expect(domById.get("bar-scope-note")!.hidden).toBe(true);
      }));
  });

  test("(3) the rename form and the usage panel keep their controls addressable", () => {
    const target = { kind: "program", programId: "p1" };
    const form = withDom(() => M.renderLabelForm(target, {
      inputKey: "rename-input:p1", placeholder: "Display name", ariaLabel: "New display name", source: "Source program: P",
    }));
    const keys = focusKeysOf(form);
    expect(keys).toEqual(["label-save:program:p1", "label-cancel:program:p1"]);
    expect(keys.every(Boolean)).toBe(true);

    // Usage: Retry on an unavailable BurnBar, and the session links in the table.
    const failed = withDom(() => {
      M.renderUsagePanel({
        usageLoading: false, usageError: "locked", usageWard: null, usageSeries: null, usageInvocations: null,
        usageSummary: { available: false, error: "BurnBar database is locked." },
      });
      return domById.get("usage-panel");
    });
    expect(focusKeysOf(failed)).toEqual(["usage-retry"]);

    const table = withDom(() => {
      M.renderUsagePanel({
        usageLoading: false, usageError: "", usageWard: null,
        usageSummary: { available: true, processedTokens: 10, invocations: 1, costKnown: false, burnRateTokensPerHour: null },
        usageSeries: { points: [] },
        usageInvocations: { invocations: [{ sessionId: "a1", provider: "codex", model: "gpt-5-codex", tokens: 10, costUsd: null, startTime: "2026-07-28T01:00:00.000Z" }] },
      });
      return domById.get("usage-panel");
    });
    expect(textOf(table)).toContain("Recent invocations");
    /* The session-link button only exists when the invocation maps to an agent
       in state.snap, which this suite cannot set; likewise the two confirm-strip
       Cancel button is gated behind state.confirming.
       Both carry an fkey now, but they are covered by inspection, not here —
       said plainly in LANE-REPORT.md rather than faked with a vacuous loop. */
  });

  /* A failed BurnBar query answers {ok:true, available:false, points:[]}. The
     panel used to read only .points/.invocations, so a SQLCipher failure drew an
     empty chart and an empty table — reporting "you spent nothing" when the
     truth was "the database never answered". Summary and ward already checked
     availability; series and invocations did not. These two assert the operator
     is told the difference, and fail if either guard is dropped again. */
  test("an unavailable usage series says so instead of drawing an empty chart", () => {
    const failed = withDom(() =>
      M.renderUsageSeriesChart({ available: false, points: [], error: "unable to open database file" }));
    expect(textOf(failed)).toContain("unable to open database file");
    expect(textOf(failed)).not.toContain("No series points in this range.");

    // A genuinely empty range must still read as empty, not as a failure.
    const empty = withDom(() => M.renderUsageSeriesChart({ available: true, points: [] }));
    expect(textOf(empty)).toContain("No series points in this range.");
  });

  /* The link called setView("now"), and "now" stopped being a view when the
     three live tabs collapsed into Board. setView ignores a name outside VIEWS,
     so the drawer opened over the Usage table and the operator was left standing
     on the wrong view with no error anywhere. */
  test("a usage session link lands the operator on the Board it opened", async () => {
    const linked = agent({ id: "codex:s1", sourceSessionId: "sess1234", updatedAt: new Date().toISOString() });
    const snap = snapshot({ programs: [{ id: "p", name: "P", agents: [linked] }] });
    await withState({ snap, view: "usage", selected: null }, () => withRequests([], async () => {
      M.renderUsagePanel({
        usageLoading: false, usageError: "", usageWard: null,
        usageSummary: { available: true, processedTokens: 10, invocations: 1, costKnown: false, burnRateTokensPerHour: null },
        usageSeries: { available: true, points: [] },
        usageInvocations: { available: true, invocations: [{ sessionId: "sess1234", provider: "codex", tokens: 10 }] },
      });
      await fire(byFkey(domById.get("usage-panel"), "usage-session:sess1234"));
      expect(M.state.view).toBe("board");
      expect(M.state.selected).toMatchObject({ kind: "agent", id: "codex:s1" });
    }));
  });

  test("an unavailable invocations query says so instead of reporting zero activity", () => {
    const failed = withDom(() => {
      M.renderUsagePanel({
        usageLoading: false, usageError: "", usageWard: null,
        usageSummary: { available: true, processedTokens: 10, invocations: 1, costKnown: false, burnRateTokensPerHour: null },
        usageSeries: { available: true, points: [] },
        usageInvocations: { available: false, invocations: [], error: "database is locked" },
      });
      return domById.get("usage-panel");
    });
    expect(textOf(failed)).toContain("database is locked");
    expect(textOf(failed)).not.toContain("No invocations in this range.");

    const quiet = withDom(() => {
      M.renderUsagePanel({
        usageLoading: false, usageError: "", usageWard: null,
        usageSummary: { available: true, processedTokens: 0, invocations: 0, costKnown: false, burnRateTokensPerHour: null },
        usageSeries: { available: true, points: [] },
        usageInvocations: { available: true, invocations: [] },
      });
      return domById.get("usage-panel");
    });
    expect(textOf(quiet)).toContain("No invocations in this range.");
  });

  /* The second instance of the same leak as the roster row (evidence e024422):
     the Model column echoed whatever the collector wrote, so "<synthetic>" landed
     in a column of model names while a genuinely absent model read "—". The
     invocation is real either way; only the name is unknown, and the column's own
     em dash already says that. */
  test("the invocation table's Model column says nothing rather than a placeholder", () => {
    const table = withDom(() => {
      M.renderUsagePanel({
        usageLoading: false, usageError: "", usageWard: null,
        usageSummary: { available: true, processedTokens: 10, invocations: 1, costKnown: false, burnRateTokensPerHour: null },
        usageSeries: { available: true, points: [] },
        usageInvocations: {
          available: true,
          invocations: [
            { sessionId: "a1", provider: "claude", model: "<synthetic>", tokens: 10, costUsd: null, startTime: "2026-07-28T01:00:00.000Z" },
            { sessionId: "b2", provider: "codex", model: "gpt-5-codex", tokens: 20, costUsd: null, startTime: "2026-07-28T01:00:00.000Z" },
          ],
        },
      });
      return domById.get("usage-panel");
    });
    const text = textOf(table);
    expect(text).not.toContain("<synthetic>");
    // The row itself is still reported, and a known model is still named.
    expect(text).toContain("gpt-5-codex");
    expect(text).toContain("—");
  });

  /* -------- finding 2: one agent's tick rebuilt the whole list -------------
     The list guard was all-or-nothing: any visible agent's status, tokens or
     summary moving invalidated one signature for the WHOLE list, and the next
     paint ran root.textContent = "" and reconstructed every program and every
     row (~27 elements each), taking the operator's text selection with it. */

  const listProgram = (agents: unknown[]) => ({ id: "p1", name: "Prog", agents });
  function planFor(agents: Record<string, unknown>[], over: Record<string, unknown> = {}) {
    const program = listProgram(agents);
    return M.agentRowPlan(program, agents, listUi({ snap: { schemaVersion: 1, programs: [program] }, ...over }));
  }
  /* The plan now leads with the column header AND a lifecycle divider, so these
     index by key rather than by position — a test that counted from zero would
     have to be rewritten again the next time a section is added, and would say
     nothing about the property it is actually guarding. */
  const sigOf = (plan: Array<{ key: string; sig: string }>, key: string) =>
    plan.find((item) => item.key === key)?.sig;

  test("(2) reconcileKeyed keeps the DOM node of every key whose signature held", () => {
    const parent = newNode("div");
    const cache = new Map();
    const plan = (sigs: Record<string, string>) => Object.entries(sigs).map(([key, sig]) => ({
      key, sig, build: () => newNode("div"),
    }));

    M.reconcileKeyed(parent, plan({ a: "1", b: "1", c: "1" }), cache);
    const [a0, b0, c0] = parent.children;
    expect(parent.children.length).toBe(3);

    // Only b moved. a and c must be the SAME objects — that is the whole point:
    // a node that is never detached keeps its selection, hover and focus.
    M.reconcileKeyed(parent, plan({ a: "1", b: "2", c: "1" }), cache);
    expect(parent.children[0]).toBe(a0);
    expect(parent.children[1]).not.toBe(b0);
    expect(parent.children[2]).toBe(c0);
    const b1 = parent.children[1];

    // Insertion lands in order without disturbing its neighbours.
    M.reconcileKeyed(parent, plan({ a: "1", d: "1", b: "2", c: "1" }), cache);
    expect(parent.children.length).toBe(4);
    expect(parent.children[0]).toBe(a0);
    expect(parent.children[2]).toBe(b1);
    expect(parent.children[3]).toBe(c0);

    // Removal drops exactly the missing key…
    const kept = M.reconcileKeyed(parent, plan({ a: "1", c: "1" }), cache);
    expect(parent.children.map((n: { tagName: string }) => n)).toEqual([a0, c0]);
    expect([...kept]).toEqual(["a", "c"]);

    // …and reordering moves nodes rather than rebuilding them.
    M.reconcileKeyed(parent, plan({ c: "1", a: "1" }), cache);
    expect(parent.children).toEqual([c0, a0]);
  });

  test("(2) a row signature moves only for the row that actually changed", () => {
    const a = agent({ id: "codex:a1", tokens: { provenance: "observed", total: 1200 } });
    const b = agent({ id: "codex:a2", tokens: { provenance: "observed", total: 800 } });
    const before = planFor([a, b]);
    // The exact production tick the finding describes: one agent's token count
    // advances on the 4s snapshot.
    const after = planFor([{ ...a, tokens: { provenance: "observed", total: 40_000 } }, b]);
    expect(sigOf(after, "columns")).toBe(sigOf(before, "columns"));
    expect(sigOf(after, "section:active")).toBe(sigOf(before, "section:active"));
    expect(sigOf(after, "row:codex:a1")).not.toBe(sigOf(before, "row:codex:a1")); // the agent that moved
    expect(sigOf(after, "row:codex:a2")).toBe(sigOf(before, "row:codex:a2"));     // …and nothing else
    expect(after.map((i: { key: string }) => i.key)).toEqual(before.map((i: { key: string }) => i.key));
  });

  test("(2) the row signature still covers everything a row paints", () => {
    const base = agent({ id: "codex:a1", elapsedMs: 60_000 });
    const sig = (over: Record<string, unknown> = {}, ui: Record<string, unknown> = {}) =>
      M.agentRowSig({ ...base, ...over }, listUi(ui), { depth: 0, childCount: 0, fullById: new Map() });
    const start = sig();
    const moves: Array<[string, Record<string, unknown>, Record<string, unknown>]> = [
      ["status", { status: "attention" }, {}],
      ["statusReason", { statusReason: "Waiting on review." }, {}],
      ["model", { model: "claude-opus-4-8" }, {}],
      ["tokens", { tokens: { provenance: "observed", total: 40_000, contextWindow: 200_000 } }, {}],
      ["lastHumanMessage (row summary)", { lastHumanMessage: "ship the fix" }, {}],
      ["role chip", { role: "verifier" }, {}],
      ["model policy chip", { modelPolicy: { state: "violation", summary: "off policy" } }, {}],
      ["cwd relation", { target: { resolution: "exact", surfaceId: "s1", cwdRelation: "different" } }, {}],
      ["terminal breadcrumb", { target: { resolution: "exact", surfaceId: "s1", workspaceTitle: "ridge" } }, {}],
      ["staleness fact", { updatedAt: new Date(Date.now() - 40 * 60_000).toISOString() }, {}],
      ["selection highlight", {}, { selectedId: "codex:a1" }],
      ["rename form", {}, { renaming: M.presentationLabelKey(M.preferredRenameTarget(base)) }],
      ["rename pending", {}, { renamePending: true }],
      ["rename error", {}, { renameError: "Too long" }],
      ["custom label", {}, { labels: new Map([["agent:codex:a1", "Ridge"]]) }],
      ["context display toggle", {}, { contextDisplay: "tokens" }],
    ];
    for (const [why, over, ui] of moves) expect(sig(over, ui), why).not.toBe(start);

    // The live elapsed clock is deliberately OUT: tickClocks rewrites it in
    // place from data-elapsed-base, so letting it in would rebuild every row
    // every 5s and undo the entire fix.
    expect(sig({ elapsedMs: 61_000 })).toBe(start);
    // Another agent's rename never touches this row.
    expect(sig({}, { renaming: "agent:codex:other" })).toBe(start);
  });

  test("(2) a token tick leaves the program shell alone, so its rows stay attached", () => {
    const a = agent({ id: "codex:a1", status: "running", tokens: { provenance: "observed", total: 1200 } });
    const b = agent({ id: "codex:a2", status: "running" });
    const shell = (agents: Record<string, unknown>[], ui: Record<string, unknown> = {}) =>
      M.programShellSig(listProgram(agents), agents, listUi(ui));
    const base = shell([a, b]);
    // The tick that used to rebuild everything now rebuilds nothing above the row.
    expect(shell([{ ...a, tokens: { provenance: "observed", total: 40_000 } }, b])).toBe(base);
    expect(shell([{ ...a, statusReason: "Still streaming." }, b])).toBe(base);
    // What the shell DOES paint still moves it.
    expect(shell([{ ...a, status: "attention" }, b])).not.toBe(base); // rollup counts
    expect(shell([a, b], { programOverrides: new Map([["p1", "closed"]]) })).not.toBe(base); // caret
    expect(shell([a, b], { labels: new Map([["program:p1", "Ridge"]]) })).not.toBe(base); // head label
    expect(shell([a, b], { renaming: "program:p1" })).not.toBe(base); // rename form
    expect(shell([a], { })).not.toBe(base); // fewer visible agents
  });

  test("(2) end to end: a tick that changes one agent rebuilds one row", () => {
    const a = agent({ id: "codex:a1", tokens: { provenance: "observed", total: 1200 } });
    const b = agent({ id: "codex:a2" });
    const c = agent({ id: "codex:a3" });
    const body = newNode("div");
    const cache = new Map();

    withDom(() => M.reconcileKeyed(body, planFor([a, b, c]), cache));
    // column header + 3 rows — the sole populated section draws no divider.
    expect(body.children.length).toBe(4);
    const [header, rowA, rowB, rowC] = body.children;

    withDom(() => M.reconcileKeyed(
      body,
      planFor([{ ...a, tokens: { provenance: "observed", total: 40_000 } }, b, c]),
      cache,
    ));
    expect(body.children.length).toBe(4);
    expect(body.children[0]).toBe(header);
    expect(body.children[1]).not.toBe(rowA);
    expect(body.children[2]).toBe(rowB);
    expect(body.children[3]).toBe(rowC);
    // The rebuilt row really is the one that moved, and it shows the new number.
    expect(textOf(body.children[1])).toContain("40k");

    // A repaint with nothing changed touches no node at all.
    const settled = [...body.children];
    withDom(() => M.reconcileKeyed(body, planFor([{ ...a, tokens: { provenance: "observed", total: 40_000 } }, b, c]), cache));
    expect(body.children).toEqual(settled);

    // An agent leaving the view removes exactly its row.
    withDom(() => M.reconcileKeyed(body, planFor([{ ...a, tokens: { provenance: "observed", total: 40_000 } }, c]), cache));
    expect(body.children.length).toBe(3);
    expect(body.children[2]).toBe(rowC);
  });

  test("(2) the whole list path: a live tick repaints one row, not the list", () => {
    /* Drives syncProgramList — the exact two-level path renderPrograms runs —
       with real nodes, so this covers section reuse as well as row reuse. */
    const mk = (id: string, over: Record<string, unknown> = {}) => agent({ id, status: "running", ...over });
    const build = (a1Tokens: number, a3Status = "running") => {
      const alpha = { id: "sync-alpha", name: "Alpha", agents: [mk("codex:s1", { tokens: { provenance: "observed", total: a1Tokens } }), mk("codex:s2")] };
      const beta = { id: "sync-beta", name: "Beta", agents: [mk("codex:s3", { status: a3Status })] };
      return [{ program: alpha, agents: alpha.agents }, { program: beta, agents: beta.agents }];
    };
    const root = newNode("div");
    const ui = (visible: ReturnType<typeof build>) => listUi({
      snap: { schemaVersion: 1, programs: visible.map((v) => v.program) },
    });

    let visible = build(1200);
    const shown = withDom(() => M.syncProgramList(root, visible, ui(visible)));
    expect(shown).toBe(3);
    // Two program sections and no strip: the strip is Board's, and this drives
    // the Now lens on purpose so the assertions stay about reconciliation.
    expect(root.children.length).toBe(2);
    const [alphaSection, betaSection] = root.children;
    const alphaBody = alphaSection.children[alphaSection.children.length - 1];
    const betaBody = betaSection.children[betaSection.children.length - 1];
    expect(alphaBody.children.length).toBe(3); // column header + 2 rows (solo section, no divider)
    const [, rowS1, rowS2] = alphaBody.children;
    const rowS3 = betaBody.children[1];

    // A token tick on codex:s1 — the production case. Everything else must be
    // the same node object it was, including both program sections and the
    // divider directly above the row that moved.
    visible = build(40_000);
    withDom(() => M.syncProgramList(root, visible, ui(visible)));
    expect(root.children[0]).toBe(alphaSection);
    expect(root.children[1]).toBe(betaSection);
    expect(alphaBody.children[1]).not.toBe(rowS1);
    expect(alphaBody.children[2]).toBe(rowS2);
    expect(betaBody.children[1]).toBe(rowS3);
    expect(textOf(alphaBody.children[1])).toContain("40k");

    // A status flip DOES move the program rollup, so Beta's shell is rebuilt —
    // but its row node is re-adopted rather than reconstructed. The row moves
    // out of Active and into Waiting; a solo section either way, no divider.
    visible = build(40_000, "attention");
    withDom(() => M.syncProgramList(root, visible, ui(visible)));
    expect(root.children[0]).toBe(alphaSection);
    expect(root.children[1]).not.toBe(betaSection);
    const newBetaBody = root.children[1].children[root.children[1].children.length - 1];
    expect(newBetaBody.children.length).toBe(2);
    expect(textOf(newBetaBody.children[1])).toContain("Waiting");
    expect(newBetaBody.children[1]).not.toBe(rowS3); // its own signature moved too
    // Alpha is untouched by Beta's rebuild.
    expect(alphaBody.children[2]).toBe(rowS2);
  });

  /* A filter is a lens on the board, not a change to what a program contains.
     The header used to roll up the FILTERED list while the drawer used the full
     program, so under the default Now filter a program holding 32 agents
     announced "1 agent" — the header contradicting its own drawer on screen.
     The shell signature has to watch the full program for the same reason, or a
     change outside the active filter would never repaint the header. */
  test("a filtered view leaves the program header counting the whole program", () => {
    const mk = (id: string, over: Record<string, unknown> = {}) => agent({ id, status: "running", ...over });
    const all = [mk("codex:f1"), mk("codex:f2", { status: "idle" }), mk("codex:f3", { status: "idle" })];
    const program = { id: "filtered", name: "Filtered", agents: all };
    // The active filter keeps one row; the program still holds three.
    const visible = [{ program, agents: [all[0]!] }];
    const root = newNode("div");
    const ui = listUi({ snap: { schemaVersion: 1, programs: [program] } });

    const shown = withDom(() => M.syncProgramList(root, visible, ui));

    expect(shown).toBe(1); // the body lists only what the filter kept
    // section = [visually-hidden h2, head, ...body]; the rollup rides the head.
    const head = root.children[0].children[1];
    expect(textOf(head)).toContain("3agents");
    expect(textOf(head)).not.toContain("1agent");

    // The signature must move when the program changes outside the filter,
    // otherwise the corrected header would cache and go stale.
    const grown = { ...program, agents: [...all, mk("codex:f4", { status: "idle" })] };
    expect(M.programShellSig(grown, [all[0]!], ui))
      .not.toBe(M.programShellSig(program, [all[0]!], ui));
  });

  /* -------- first-paint skeleton ------------------------------------------
     boot() paints nothing until the first /api/snapshot resolves, so the board
     was blank for the length of that request — and any render() triggered in
     that window (a view tab, a keystroke in search) fell through to
     "Can't reach the Ant Hill server", a guess dressed as a diagnosis. */
  test("(10) the skeleton holds the board until the first snapshot resolves", async () => {
    // The fake document replaces the global inside withDom, so its nodes are
    // reached the same way the server-health test does it.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const node = (id: string) => (globalThis as unknown as { document: any }).document.getElementById(id);

    expect(M.firstLoadPending({ snap: null, fetchFailed: false })).toBe(true);
    expect(M.firstLoadPending({ snap: snapshot(), fetchFailed: false })).toBe(false);
    // A failed first fetch is NOT still loading — otherwise a dead server sits
    // under a shimmer forever instead of showing its retry.
    expect(M.firstLoadPending({ snap: null, fetchFailed: true })).toBe(false);
    expect(M.firstLoadPending({ snap: snapshot(), fetchFailed: true })).toBe(false);

    // In flight: skeleton up, and no premature "can't reach the server".
    await withState({ snap: null, fetchFailed: false }, () => withDom(() => {
      M.renderSkeleton();
      M.renderEmpty();
      expect(node("board-skeleton").hidden).toBe(false);
      expect(node("empty-state").hidden).toBe(true);
    }));

    // Failed: skeleton down, the real diagnosis and its retry up.
    await withState({ snap: null, fetchFailed: true }, () => withDom(() => {
      M.renderSkeleton();
      M.renderEmpty();
      expect(node("board-skeleton").hidden).toBe(true);
      expect(node("empty-state").hidden).toBe(false);
      expect(node("empty-message").textContent).toContain("Can't reach");
      expect(node("empty-retry").hidden).toBe(false);
    }));

    // Loaded: skeleton down, board owns the space.
    await withState({ snap: snapshot(), fetchFailed: false }, () => withDom(() => {
      M.renderSkeleton();
      M.renderEmpty();
      expect(node("board-skeleton").hidden).toBe(true);
      expect(node("empty-state").hidden).toBe(true);
    }));
  });

  test("(10b) the skeleton ships visible in the markup and never borrows a status ink", () => {
    /* It must paint before app.js parses — the client is a deferred module, so a
       hidden-by-default skeleton would appear only after the very request it
       exists to cover. */
    const node = html.match(/<div id="board-skeleton"[^>]*>/)?.[0] ?? "";
    expect(node).not.toBe("");
    expect(node).not.toContain("hidden");
    expect(node).toContain('role="status"');
    expect(html).toContain("Loading agents…"); // announced, not just drawn
    expect(styles).toContain(".board-skeleton");
    /* A placeholder that borrowed --ember/--moss/--needs would read as a fleet
       verdict for as long as the request took. Greys only. */
    const block = styles.slice(styles.indexOf(".board-skeleton"), styles.indexOf("@keyframes sk-pulse"));
    for (const ink of ["--ember", "--moss", "--needs", "--blocked", "--failed", "--amber"]) {
      expect(block).not.toContain(ink);
    }
  });

  /* -------- arrow-key row navigation --------------------------------------
     Tab reached rows already, but it walks every focusable on the board, so
     stepping one row could take a dozen presses at 165 rows. These drive the
     real handler against plain nodes — the arithmetic AND the guards. */
  function navRow(): { focused: number; closest: (sel: string) => unknown; focus: () => void } {
    const row = {
      focused: 0,
      closest(sel: string) { return sel.includes(".agent-row") ? row : null; },
      focus() { row.focused += 1; },
    };
    return row;
  }
  function navEvent(key: string, target: unknown, mods: Record<string, boolean> = {}) {
    return { key, target, prevented: 0, preventDefault() { this.prevented += 1; }, ...mods };
  }

  test("(9) arrows walk rows, clamp at both ends, and Home/End jump", () => {
    const rows = [navRow(), navRow(), navRow()];
    const from = (i: number, key: string) => {
      const e = navEvent(key, rows[i]);
      expect(M.handleRowNavigation(e, rows)).toBe(true);
      expect(e.prevented).toBe(1); // never let the board scroll underneath
    };

    from(0, "ArrowDown");
    expect(rows[1].focused).toBe(1);
    from(1, "ArrowUp");
    expect(rows[0].focused).toBe(1);
    from(0, "End");
    expect(rows[2].focused).toBe(1);
    from(2, "Home");
    expect(rows[0].focused).toBe(2);

    /* Clamping, not wrapping: wrapping teleports the operator across a long
       board with no visual event to explain it. The key is still consumed. */
    from(2, "ArrowDown");
    expect(rows[0].focused).toBe(2); // unchanged — no wrap to the top
    from(0, "ArrowUp");
    expect(rows[2].focused).toBe(1); // unchanged — no wrap to the bottom
  });

  test("(9b) row navigation declines the keys that are not its own", () => {
    const rows = [navRow(), navRow()];
    // Keys it must never claim.
    for (const key of ["Enter", " ", "Escape", "a", "Tab", "ArrowLeft"]) {
      const e = navEvent(key, rows[0]);
      expect(M.handleRowNavigation(e, rows)).toBe(false);
      expect(e.prevented).toBe(0);
    }
    // A modified arrow is a browser/OS gesture — word jump, history, scroll.
    for (const mod of ["metaKey", "ctrlKey", "altKey", "shiftKey"]) {
      const e = navEvent("ArrowDown", rows[0], { [mod]: true });
      expect(M.handleRowNavigation(e, rows)).toBe(false);
      expect(rows[1].focused).toBe(0);
    }
    // Typing in a row's rename field must keep its own caret movement.
    const input = { closest: (sel: string) => (sel.includes("input") ? input : null) };
    expect(M.handleRowNavigation(navEvent("ArrowDown", input), rows)).toBe(false);
    // Focus outside any row at all.
    const elsewhere = { closest: () => null };
    expect(M.handleRowNavigation(navEvent("ArrowDown", elsewhere), rows)).toBe(false);
    expect(rows[1].focused).toBe(0);
  });

  test("(9c) nextRowIndex handles the empty board and entry from nowhere", () => {
    expect(M.nextRowIndex(-1, "ArrowDown", 0)).toBe(-1); // nothing to focus
    expect(M.nextRowIndex(0, "ArrowDown", 0)).toBe(-1);
    expect(M.nextRowIndex(-1, "ArrowDown", 5)).toBe(0); // Down enters at the top
    expect(M.nextRowIndex(-1, "ArrowUp", 5)).toBe(4);   // Up enters at the bottom
    expect(M.nextRowIndex(2, "PageDown", 5)).toBe(-1);  // not a key it owns
    // An empty board must not throw on a real keypress.
    expect(M.handleRowNavigation(navEvent("ArrowDown", navRow()), [])).toBe(false);
  });

  test("(9d) the focus ring is visible enough to navigate by", () => {
    /* The ring is the primary cue once arrows move focus, so it must be the
       indigo interaction role shared by the global :focus-visible rule. The alert-row
       variants of this ring are covered by (g), which owns the rail+ring
       interaction. */
    const rule = styles.match(/\.agent-row:focus-visible\s*\{[^}]*\}/)?.[0] ?? "";
    expect(rule).not.toBe("");
    expect(rule).toContain("inset 0 0 0 2px var(--color-interactive)");
    expect(rule).toContain("var(--color-focus-ring)");
  });

  /* Regression: the alerted row that passed the filter and still never painted.
     programRollup prefers the SERVER's rollup, and the server counts needsYou
     over non-ended agents only. A live snapshot carried two programs whose agent
     read activity "ended" (transcript stopped) while its process was still
     running and its status was "attention" — server rollup needsYou: 0, so the
     program stayed collapsed and the row was dropped from the plan. The agent
     cleared the "now" filter and was invisible anyway. */
  test("(3) a program holding an alerted agent expands even when its server rollup says needsYou: 0", () => {
    const stranded = agent({
      id: "codex:w6-server",
      displayName: "Codex · w6-server",
      status: "attention",
      activity: "ended",
      outcome: "needs-you",
      processState: "running",
    });
    const program = {
      id: "cwd-w6-server",
      name: "w6-server",
      agents: [stranded],
      // Verbatim shape the server emitted for this program.
      rollup: { total: 1, live: 0, working: 0, idle: 0, ended: 1, needsYou: 0, blocked: 0, failed: 0, linked: 0 },
    };

    expect(M.viewMatches("now", stranded)).toBe(true); // clears the filter...
    expect(M.programOpen(program, listUi())).toBe(true); // ...and now also paints.

    const root = newNode("div");
    const visible = [{ program, agents: [stranded] }];
    const shown = withDom(() => M.syncProgramList(root, visible, listUi({
      snap: { schemaVersion: 1, programs: [program] },
    })));
    expect(shown).toBe(1);
    const body = root.children[0].children[root.children[0].children.length - 1];
    /* Column header, then the row. No lifecycle divider: this session's own
       lifecycle is `finished` — alerting() rescued it onto the view, and the
       sections are stable Active/Waiting/Unverified bands rather than a catch-
       all, so a row that is none of the three leads the group unlabelled rather
       than being filed under a heading that would misdescribe it. */
    expect(body.children.length).toBe(2);
    const rowText = textOf(body.children[1]);
    /* The roster drops the " · <program>" suffix (audit §9) — the program header
       two rows up already carries it — so the rescued row identifies itself as
       "Codex" here. What this test is about is that it PAINTS at all. */
    expect(rowText).toContain("Codex");
    expect(rowText).toContain("Alert"); // and it reads as needing a human

    // The guard: a program of finished, healthy agents still collapses, so this
    // cannot expand the 60+ done programs on a real board.
    const quiet = {
      id: "cwd-done",
      name: "done",
      agents: [agent({ id: "codex:done", status: "archived", activity: "ended", outcome: "healthy" })],
      rollup: { total: 1, live: 0, working: 0, idle: 0, ended: 1, needsYou: 0, blocked: 0, failed: 0, linked: 0 },
    };
    expect(M.programOpen(quiet, listUi())).toBe(false);
  });

  /* Regression: the same defect on the WORKING half of the predicate. Fix (3)
     patched the alerted case by asking alerting() directly, but working/needsYou
     were still answered by programRollup — i.e. by the SERVER's rollup, which is
     a different derivation over a different population than the client's own
     viewMatches(). Whenever the two disagree, the Now filter admits a row and the
     collapsed program then drops it, so the tab reads near-empty on a busy fleet.
     The gate must ask the identical question the filter asks. */
  test("(3b) a program holding a working agent expands even when its server rollup says working: 0", () => {
    const busy = agent({
      id: "claude:live-worker",
      displayName: "Claude · live worker",
      status: "running",
      activity: "working",
      outcome: "healthy",
    });
    const program = {
      id: "cwd-busy",
      name: "busy",
      agents: [busy],
      // Server rollup disagrees with the client derivation — the whole bug.
      rollup: { total: 1, live: 0, working: 0, idle: 0, ended: 1, needsYou: 0, blocked: 0, failed: 0, linked: 0 },
    };

    expect(M.viewMatches("now", busy)).toBe(true); // clears the filter...
    expect(M.programOpen(program, listUi())).toBe(true); // ...so it must also paint.

    const root = newNode("div");
    const visible = [{ program, agents: [busy] }];
    const shown = withDom(() => M.syncProgramList(root, visible, listUi({
      snap: { schemaVersion: 1, programs: [program] },
    })));
    expect(shown).toBe(1);
    const body = root.children[0].children[root.children[0].children.length - 1];
    expect(body.children.length).toBe(2); // column header + the rescued row (solo section, no divider)
    expect(textOf(body.children[1])).toContain("Claude · live worker");
  });

  /* ------------------------------------------------------------------------
     The single board: the pinned Needs-you strip, the lifecycle dividers, and
     swarm collapse. Driven through syncProgramList and agentRowPlan — the exact
     two-level path renderPrograms runs — rather than through the source text,
     because every one of these is a claim about what the operator SEES.
     --------------------------------------------------------------------- */
  // First node whose className carries the given token (whitespace-separated).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function nodeByClass(node: any, token: string): any {
    if (!node || typeof node !== "object") return null;
    if (typeof node.className === "string" && node.className.split(/\s+/).includes(token)) return node;
    for (const kid of node.children || []) {
      const hit = nodeByClass(kid, token);
      if (hit) return hit;
    }
    return null;
  }

  describe("the single board", () => {
    const boardUi = (over: Record<string, unknown> = {}) =>
      listUi({ view: "board", lookbackHours: null, ...over });
    const asking = (over: Record<string, unknown> = {}) =>
      agent({ status: "attention", outcome: "needs-you", lifecycle: "waiting", ...over });

    /* Two programs, one alerting session in each, plus a calm working row —
       the shape the dedupe has to get right, because the strip is flat and
       cross-program while the groups below it are not. */
    function twoPrograms() {
      const alpha = {
        id: "alpha",
        name: "Alpha",
        agents: [
          agent({ id: "codex:a-work", status: "running" }),
          asking({ id: "codex:a-alert" }),
        ],
      };
      const beta = { id: "beta", name: "Beta", agents: [asking({ id: "codex:b-alert" })] };
      return [
        { program: alpha, agents: alpha.agents },
        { program: beta, agents: beta.agents },
      ];
    }

    test("an alerting row is pinned in the strip and drawn NOWHERE else", () => {
      const root = newNode("div");
      const visible = twoPrograms();
      const ui = boardUi({ snap: { schemaVersion: 1, programs: visible.map((v) => v.program) } });
      const shown = withDom(() => M.syncProgramList(root, visible, ui));

      // The scope note reports what the FILTER admitted; moving a row between
      // sections is not a change to how many sessions matched.
      expect(shown).toBe(3);

      /* Strip first, then Alpha. Beta is GONE: its only session is pinned, and
         a head plus a column bar over nothing is the empty shell this board
         stopped drawing. Its identity lives on the strip's own group heading. */
      expect(root.children.length).toBe(2);
      const [strip, alphaSection] = root.children;
      expect(strip.className).toContain("needs-strip");
      expect(textOf(strip)).toContain("Needs you");

      // Both alerting rows, each under its own program heading — the heading
      // is the fact the missing group header below would have said.
      const stripBody = strip.children[strip.children.length - 1];
      expect(allByClass(stripBody, "strip-group-head")).toHaveLength(2);
      expect(allByClass(stripBody, "agent-row")).toHaveLength(2);
      expect(textOf(stripBody)).toContain("Alpha");
      expect(textOf(stripBody)).toContain("Beta");
      // Heading, then its rows: the head for Alpha directly precedes Alpha's row.
      expect(stripBody.children[0].className).toContain("strip-group-head");
      expect(stripBody.children[1].dataset.fkey).toBe("agent:codex:a-alert");

      /* The dedupe, which is the whole point: one row per session. A session
         rendered twice would carry `agent:<id>` on two nodes, so focus restore
         would land on whichever the document held first and arrow navigation
         would visit the same session twice. */
      const ids = (node: FakeNode, out: string[] = []): string[] => {
        if (node.dataset?.fkey?.startsWith("agent:")) out.push(node.dataset.fkey);
        for (const kid of node.children ?? []) ids(kid as FakeNode, out);
        return out;
      };
      const keys = ids(root);
      expect(new Set(keys).size).toBe(keys.length);
      expect(keys.filter((k) => k === "agent:codex:a-alert")).toHaveLength(1);

      /* The placeholder that used to restate the strip inside each group is
         gone: the group header's own "alerts" rollup cell already says a
         session is asking, and the strip's group heading says where it came
         from. Restating it as a body row doubled the vertical noise for no
         new information. (Beta's whole shell is asserted absent above.) */
      const alphaBody = alphaSection.children[alphaSection.children.length - 1];
      expect(textOf(alphaBody)).not.toContain("in Needs you");
      expect(textOf(alphaBody)).not.toContain("Alert");
    });

    test("acknowledging an alert returns the row to its lifecycle section", () => {
      // The plan's open question, answered: ack means "I have seen it", so the
      // row leaves the strip and rejoins the fleet rather than vanishing.
      const acked = agent({ id: "codex:a-alert", status: "waiting", lifecycle: "waiting" });
      const program = { id: "alpha", name: "Alpha", agents: [acked] };
      const visible = [{ program, agents: [acked] }];
      const root = newNode("div");
      withDom(() => M.syncProgramList(root, visible, boardUi({
        snap: { schemaVersion: 1, programs: [program] },
      })));
      // Strip is present but clear; the row is under Waiting in its own group.
      expect(root.children.length).toBe(2);
      expect(root.children[0].className).toContain("is-clear");
      expect(textOf(root.children[0])).toContain("No session is asking for you");
      const body = root.children[1].children[root.children[1].children.length - 1];
      expect(textOf(body)).toContain("Waiting");
      expect(textOf(body)).not.toContain("in Needs you");
    });

    test("sections are drawn Active → Waiting → Unverified, and an empty one is not drawn", () => {
      const rows = [
        agent({ id: "codex:u", lifecycle: "unverified", status: "stale" }),
        agent({ id: "codex:w", lifecycle: "waiting", status: "waiting" }),
        agent({ id: "codex:a", lifecycle: "working", status: "running" }),
      ];
      const program = { id: "p", name: "P", agents: rows };
      const keys = (list: typeof rows) =>
        M.agentRowPlan({ ...program, agents: list }, list, boardUi({
          snap: { schemaVersion: 1, programs: [{ ...program, agents: list }] },
        })).map((item: { key: string }) => item.key);

      /* Stable order regardless of the order the rows arrive in — the server
         sorts within a program, and the dividers must not re-sort it into a
         different story on the next paint. */
      expect(keys(rows)).toEqual([
        "columns",
        "section:active", "row:codex:a",
        "section:waiting", "row:codex:w",
        "section:unverified", "row:codex:u",
      ]);

      /* A section with no members prints no heading, and the sole populated
         section prints none either — a divider over the only population
         divides nothing. Unverified is exempt: its head is a disclosure about
         evidence, not a state word the rows repeat. */
      expect(keys([rows[2]!])).toEqual(["columns", "row:codex:a"]);
      expect(keys([rows[0]!])).toEqual(["columns", "section:unverified", "row:codex:u"]);
    });

    test("the Unverified divider keeps the sentence the standalone group shipped with", () => {
      // A bare word would read as a claim about the sessions. It is a claim
      // about the evidence, and the copy is unchanged for that reason.
      expect(M.SECTION_HEADS.unverified.label(1)).toBe("1 unverified — quiet, with no process found to check");
      expect(M.SECTION_HEADS.unverified.label(4)).toBe("4 unverified — quiet, with no process found to check");
      // The heads are labels, not controls — nothing here takes a focus key.
      for (const key of M.LIFECYCLE_SECTIONS) {
        expect(M.SECTION_HEADS[key].className).toContain("lifecycle-section");
      }
    });

    test("History draws no dividers and never pins a row away from its group", () => {
      /* Two ways this could have gone wrong. A finished row matches no section,
         so a divider over it would be a lie; and a finished row whose process
         is somehow still running satisfies alerting(), so a board-only dedupe
         applied here would have silently deleted it from the only view that
         shows it. */
      const ghost = agent({
        id: "codex:ghost", status: "attention", outcome: "needs-you",
        lifecycle: "finished", activity: "ended", processState: "running",
      });
      const done = agent({ id: "codex:done", lifecycle: "finished", status: "archived" });
      const program = { id: "p", name: "P", agents: [ghost, done] };
      const plan = M.agentRowPlan(program, program.agents, listUi({
        view: "history", snap: { schemaVersion: 1, programs: [program] },
      }));
      expect(plan.map((i: { key: string }) => i.key))
        .toEqual(["columns", "row:codex:ghost", "row:codex:done"]);
    });

    test("swarm children are collapsed until the operator opens that swarm", () => {
      const parent = agent({ id: "codex:parent", status: "running" });
      const child = agent({ id: "codex:child", status: "running", parentAgentId: "codex:parent" });
      const program = { id: "p", name: "P", agents: [parent, child] };
      const plan = (over: Record<string, unknown> = {}) =>
        M.agentRowPlan(program, program.agents, boardUi({
          snap: { schemaVersion: 1, programs: [program] }, ...over,
        })).map((item: { key: string }) => item.key);

      // Closed by default: absent from the plan, so absent from the DOM — which
      // is what takes it out of navigableRows and Tab order in one move, with
      // no second rule to keep in step.
      expect(plan()).toEqual(["columns", "row:codex:parent"]);
      expect(plan({ swarmOverrides: new Map([["codex:parent", "open"]]) }))
        .toEqual(["columns", "row:codex:parent", "row:codex:child"]);

      // The caret is a real control with its own focus key, because render()
      // restores focus by fkey and the row already owns `agent:<id>`.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const row: any = withDom(() => M.renderAgentRow(parent, program, { childCount: 1, swarmOpen: false }));
      const chip = nodeByClass(row, "swarm-chip");
      expect(chip.tagName).toBe("button");
      expect(chip.dataset.fkey).toBe("swarm:codex:parent");
      expect(chip.attributes["aria-expanded"]).toBe("false");
      expect(textOf(chip)).toContain("swarm 1");
    });

    test("an alerting child cannot hide inside a collapsed swarm", () => {
      const parent = agent({ id: "codex:parent", status: "running" });
      const child = asking({ id: "codex:child", parentAgentId: "codex:parent" });
      const program = { id: "p", name: "P", agents: [parent, child] };
      const visible = [{ program, agents: program.agents }];
      const root = newNode("div");
      withDom(() => M.syncProgramList(root, visible, boardUi({
        snap: { schemaVersion: 1, programs: [program] },
      })));

      // It is in the strip even though its parent is folded — the strip is flat
      // and cross-program precisely so a collapsed swarm cannot swallow one.
      const strip = root.children[0];
      expect(strip.className).toContain("needs-strip");
      // Heading for its program, then the row itself.
      const stripBody = strip.children[strip.children.length - 1];
      expect(stripBody.children.length).toBe(2);
      expect(stripBody.children[0].className).toContain("strip-group-head");
      expect(stripBody.children[1].dataset.fkey).toBe("agent:codex:child");

      /* …and the parent's chip stops promising what its caret cannot show:
         the child's row went to the strip, so expanding here would draw
         nothing. The ember and the caret go with it — the strip owns the
         signal — and a non-expanding chip still names the swarm's size. */
      const body = root.children[1].children[root.children[1].children.length - 1];
      const chip = nodeByClass(body, "swarm-chip");
      expect(chip.tagName).toBe("span");
      expect(chip.className).not.toContain("is-alerting");
      expect(chip.attributes["aria-expanded"]).toBeUndefined();
      expect(textOf(chip)).toContain("swarm 1");
    });

    test("the swarm chip counts what its caret reveals, and names the rest", () => {
      /* Lineage audit §5: the chip counted the whole board's descendants while
         the caret drew one program's filter-admitted rows — measured live at a
         40% mismatch, and a click that reveals nothing teaches the operator
         the control is broken. The button's number is the drawable set; the
         swarm's true size survives in the "of" clause. */
      const parent = agent({ id: "codex:parent", status: "running" });
      const here = agent({ id: "codex:here", status: "running", parentAgentId: "codex:parent" });
      const gone = agent({ id: "codex:gone", status: "running", parentAgentId: "codex:parent" });
      const program = { id: "p", name: "P", agents: [parent, here, gone] };
      const ui = boardUi({ snap: { schemaVersion: 1, programs: [program] } });
      const buildRow = (admitted: unknown[]) => {
        const plan = M.agentRowPlan(program, admitted, ui);
        const item = plan.find((p: { key: string }) => p.key === "row:codex:parent");
        return withDom(() => item.build());
      };

      // One of two children admitted by the filter: the label says both facts.
      const partial = nodeByClass(buildRow([parent, here]), "swarm-chip");
      expect(partial.tagName).toBe("button");
      expect(textOf(partial)).toContain("swarm 1 of 2");

      // Every child out of view: the relationship stays visible, the caret
      // does not — a caret that reveals nothing is the defect being removed.
      const none = nodeByClass(buildRow([parent]), "swarm-chip");
      expect(none.tagName).toBe("span");
      expect(none.attributes["aria-expanded"]).toBeUndefined();
      expect(textOf(none)).toContain("swarm 2");
    });

    test("swarm expansion persists exactly the way program expansion does", () => {
      // Same storage shape, same failure handling, its own key — and only the
      // opened swarms are written, because collapsed is the absence of a choice.
      const fn = source.match(/function loadSwarmOverrides\(\)[\s\S]*?\n\}/)?.[0] ?? "";
      expect(fn).toContain('localStorage.getItem("mtn3-swarms")');
      expect(fn).toContain('mode === "open"');
      expect(source).toContain('localStorage.setItem("mtn3-swarms"');
      expect(source).toContain("loadSwarmOverrides();");
      // toggleSwarm deletes rather than storing "closed", and saves every time.
      const toggle = source.match(/function toggleSwarm\(agent\)[\s\S]*?\n\}/)?.[0] ?? "";
      expect(toggle).toContain("state.swarmOverrides.delete(agent.id)");
      expect(toggle).toContain('state.swarmOverrides.set(agent.id, "open")');
      expect(toggle).toContain("saveSwarmOverrides()");
    });

    test("a pinned parent leaves an anchor whose focus key is not its row's", () => {
      /* Its children are still in the group, so they need a name to hang under.
         Both nodes describe the same session, so they cannot share `agent:<id>`
         — render()'s restore-by-fkey would land on whichever came first. */
      const parent = asking({ id: "codex:parent" });
      const child = agent({ id: "codex:child", status: "running", parentAgentId: "codex:parent" });
      const program = { id: "p", name: "P", agents: [parent, child] };
      const visible = [{ program, agents: program.agents }];
      const root = newNode("div");
      withDom(() => M.syncProgramList(root, visible, boardUi({
        snap: { schemaVersion: 1, programs: [program] },
      })));
      const body = root.children[1].children[root.children[1].children.length - 1];
      const anchor = nodeByClass(body, "swarm-anchor");
      expect(anchor.dataset.fkey).toBe("swarm-anchor:codex:parent");
      expect(anchor.attributes["aria-label"]).toContain("pinned in Needs you");
      // And the strip row keeps the ordinary key (under its group heading).
      const stripRow = byFkey(root.children[0], "agent:codex:parent");
      expect(stripRow).not.toBe(null);
      expect(stripRow.dataset.fkey).toBe("agent:codex:parent");
    });

    test("the strip groups its rows under worktree headings that name both axes", () => {
      const worker = asking({
        id: "codex:wt-alert",
        repo: { repoKey: "r1", repoName: "cooper", worktreePath: "/lanes/ev2-g1", branch: "feat/ev2-g1", ephemeral: false },
      });
      const program = { id: "p-g1", name: "cooper", groupPath: ["r1", "wt-g1"], agents: [worker] };
      const visible = [{ program, agents: program.agents }];
      const root = newNode("div");
      withDom(() => M.syncProgramList(root, visible, boardUi({
        snap: { schemaVersion: 1, programs: [program] },
      })));
      /* A repo name alone is ambiguous across that repo's checkouts — the
         heading carries the same branch@directory words the group header below
         would say, and it IS the jump control back to that group. */
      const head = byClass(root.children[0], "strip-group-head");
      expect(head.tagName).toBe("button");
      expect(textOf(head)).toContain("cooper · feat/ev2-g1");
      expect(head.dataset.fkey).toBe("strip-head:p-g1");
      // The chip is gone from the row line — the heading replaced it, so the
      // row's full width belongs to its title again…
      expect(byClass(root.children[0], "row-program-chip")).toBe(null);
      /* …while the row's own aria-label keeps the words: a screen reader
         arrowing through rows may never visit the heading between them. */
      const row = byFkey(root.children[0], "agent:codex:wt-alert");
      expect(row.attributes["aria-label"]).toContain("cooper · feat/ev2-g1");
    });

    test("the heading's jump clears a closed fold and leaves the rows unselected", async () => {
      const worker = asking({
        id: "codex:wt-alert",
        repo: { repoKey: "r1", repoName: "cooper", worktreePath: "/lanes/ev2-g1", branch: "feat/ev2-g1", ephemeral: false },
      });
      const program = { id: "p-g1", name: "cooper", groupPath: ["r1", "wt-g1"], agents: [worker] };
      const visible = [{ program, agents: program.agents }];
      const realCSS = G.CSS;
      const realLS = G.localStorage;
      const store = new Map<string, string>();
      G.CSS = { escape: (s: string) => s };
      G.localStorage = {
        getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
        setItem: (k: string, v: string) => { store.set(k, String(v)); },
        removeItem: (k: string) => { store.delete(k); },
      };
      try {
        await withState({
          snap: { schemaVersion: 1, programs: [program] },
          view: "board",
          selectedId: null,
          selected: null,
          repoOverrides: new Map([["r1", "closed"]]),
          programOverrides: new Map([["p-g1", "closed"]]),
        }, () => withDom(async () => {
          // The jump repaints the whole page, and renderInspector toggles a
          // class on document.body — give the fake document one, the same way
          // withRequests does.
          (globalThis as unknown as { document: any }).document.body = newNode("body");
          const root = newNode("div");
          M.syncProgramList(root, visible, M.state);
          const head = byClass(root.children[0], "strip-group-head");
          await fire(head, "click");
          /* The fold the operator closed is re-opened by REMOVING the override:
             open is the computed default for a group holding an alerting row,
             and the jump must not persist a choice the operator never made. */
          expect(M.state.repoOverrides.has("r1")).toBe(false);
          expect(M.state.programOverrides.has("p-g1")).toBe(false);
          // The heading is not a row: jumping must not open the inspector.
          expect(M.state.selectedId).toBe(null);
        }));
      } finally {
        G.CSS = realCSS;
        G.localStorage = realLS;
      }
    });

    test("the jump scrolls to the group's own caret after the repaint", () => {
      /* The scroll cannot be observed in this DOM-less harness, so the
         sequencing is pinned at the source: overrides first, one synchronous
         repaint, THEN the scroll — issued after render() has restored
         main.scrollTop, so the jump owns the final position. */
      const fn = source.match(/function jumpToProgramGroup\(program\)[\s\S]*?\n\}/)?.[0] ?? "";
      expect(fn).toContain("render();");
      expect(fn.indexOf("render();")).toBeLessThan(fn.indexOf("scrollIntoView"));
      expect(fn).toContain('"prog:"');
      /* A group whose every session is pinned draws no shell, so its caret is
         not in the DOM — the jump falls back to the repo band that holds it. */
      expect(fn).toContain('"repo:"');
      expect(fn).toContain("scrollIntoView?.(");
      expect(fn).toContain("focus?.(");
    });

    test("a repo band whose every worktree is hollow draws nothing at all", () => {
      const repo = { repoKey: "r-h", repoName: "cooper", worktreePath: "/lanes/h1", branch: "feat/h1", ephemeral: false };
      const pinnedOnly = {
        id: "repo:r-h:worktree:w-h1", name: "cooper", path: "/lanes/h1",
        groupPath: ["r-h", "w-h1"], agents: [asking({ id: "codex:h1-alert", repo })],
      };
      const visible = [{ program: pinnedOnly, agents: pinnedOnly.agents }];
      const root = newNode("div");
      const shown = withDom(() => M.syncProgramList(root, visible, boardUi({
        snap: { schemaVersion: 1, programs: [pinnedOnly] },
      })));
      // The strip holds the session; the board below adds no empty band.
      expect(shown).toBe(1);
      expect(root.children.length).toBe(1);
      expect(root.children[0].className).toContain("needs-strip");
    });

    test("a band keeps only the worktrees that still have something to draw", () => {
      const mk = (key: string, wt: string, agents: Record<string, unknown>[]) => ({
        id: `repo:${key}:worktree:${wt}`, name: "cooper", path: "/lanes/" + wt,
        groupPath: [key, wt], agents,
      });
      const repo = { repoKey: "r-mix", repoName: "cooper", worktreePath: "/lanes/mix", branch: "feat/mix", ephemeral: false };
      const hollowWt = mk("r-mix", "w-a", [asking({ id: "codex:mix-alert", repo })]);
      const liveWt = mk("r-mix", "w-b", [agent({ id: "codex:mix-work", status: "running", repo: { ...repo, worktreePath: "/lanes/mix-b", branch: "feat/mix-b" } })]);
      const visible = [
        { program: hollowWt, agents: hollowWt.agents },
        { program: liveWt, agents: liveWt.agents },
      ];
      const root = newNode("div");
      const shown = withDom(() => M.syncProgramList(root, visible, boardUi({
        snap: { schemaVersion: 1, programs: [hollowWt, liveWt] },
      })));
      expect(shown).toBe(2);
      // Strip + one band, and the band holds exactly one worktree subsection.
      expect(root.children.length).toBe(2);
      const band = root.children[1];
      expect(band.className).toContain("repo-section");
      expect(allByClass(band, "program")).toHaveLength(1);
      expect(byFkey(band, "agent:codex:mix-work")).not.toBe(null);
      expect(byFkey(band, "agent:codex:mix-alert")).toBe(null);
    });

    test("a shelf full of finished work keeps its shell even when live rows are pinned", () => {
      /* Hollow means NOTHING to draw. A worktree whose only live session is
         pinned but whose Finished shelf holds records still owes the operator
         the shelf toggle — suppressing it would orphan those records. */
      const program = { id: "p-shelf", name: "Shelfy", agents: [asking({ id: "codex:shelf-alert" })] };
      const done = agent({ id: "codex:shelf-done", lifecycle: "finished", status: "ended" });
      const visible = [{ program, agents: program.agents, finished: [done] }];
      const root = newNode("div");
      withDom(() => M.syncProgramList(root, visible, boardUi({
        snap: { schemaVersion: 1, programs: [program] },
      })));
      expect(root.children.length).toBe(2);
      expect(textOf(root.children[1])).toContain("Finished");
    });
  });

  /* ------------------------------------------------------------------------
     The Needs-you display preference: where alerting rows are drawn.
     --------------------------------------------------------------------- */
  describe("needs-you display preference", () => {
    test("the preference persists the way the context spread does", () => {
      // Same storage shape, same failure handling, its own key — and the loader
      // runs at boot, or a stored "inline" would be forgotten on every reload.
      expect(source).toContain('NEEDS_YOU_DISPLAY_KEY = "mtn3-needs-you-display"');
      const fn = source.match(/function loadNeedsYouDisplay\(\)[\s\S]*?\n\}/)?.[0] ?? "";
      expect(fn).toContain("localStorage.getItem(NEEDS_YOU_DISPLAY_KEY)");
      expect(fn).toContain('raw === "inline"');
      expect(source).toContain("loadNeedsYouDisplay();");
      const setter = source.match(/function setNeedsYouDisplay\(mode\)[\s\S]*?\n\}/)?.[0] ?? "";
      expect(setter).toContain("saveNeedsYouDisplay()");
      expect(setter).toContain("render()");
    });

    test("stored inline is honoured; anything else falls to the pane", () => {
      const G = globalThis as unknown as Record<string, any>;
      const realLS = G.localStorage;
      const store = new Map<string, string>();
      G.localStorage = {
        getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
        setItem: (k: string, v: string) => { store.set(k, String(v)); },
        removeItem: (k: string) => { store.delete(k); },
      };
      try {
        store.set("mtn3-needs-you-display", "inline");
        M.loadNeedsYouDisplay();
        expect(M.state.needsYouDisplay).toBe("inline");
        // A value this client never wrote falls to the pane — the behavior
        // every operator has already learned — rather than being trusted.
        store.set("mtn3-needs-you-display", "garbage");
        M.loadNeedsYouDisplay();
        expect(M.state.needsYouDisplay).toBe("pane");
        store.delete("mtn3-needs-you-display");
        M.loadNeedsYouDisplay();
        expect(M.state.needsYouDisplay).toBe("pane");
      } finally {
        G.localStorage = realLS;
      }
    });

    test("needsYouDisplayOf answers inline only on the exact word", () => {
      expect(M.needsYouDisplayOf({ needsYouDisplay: "inline" })).toBe("inline");
      expect(M.needsYouDisplayOf({ needsYouDisplay: "pane" })).toBe("pane");
      // Test fixtures (listUi) and old storage carry no field at all.
      expect(M.needsYouDisplayOf({})).toBe("pane");
      expect(M.needsYouDisplayOf({ needsYouDisplay: "INLINE" })).toBe("pane");
    });
  });

  /* ------------------------------------------------------------------------
     Inline mode: the strip disappears and the rows stand where they live.
     --------------------------------------------------------------------- */
  describe("needs-you display modes", () => {
    const inlineUi = (over: Record<string, unknown> = {}) =>
      listUi({ view: "board", lookbackHours: null, needsYouDisplay: "inline", ...over });
    const asking = (over: Record<string, unknown> = {}) =>
      agent({ status: "attention", outcome: "needs-you", lifecycle: "waiting", ...over });

    test("inline mode draws no strip and returns every row to its group", () => {
      const alpha = {
        id: "alpha",
        name: "Alpha",
        agents: [agent({ id: "codex:a-work", status: "running" }), asking({ id: "codex:a-alert" })],
      };
      const beta = { id: "beta", name: "Beta", agents: [asking({ id: "codex:b-alert" })] };
      const visible = [
        { program: alpha, agents: alpha.agents },
        { program: beta, agents: beta.agents },
      ];
      const snap = { schemaVersion: 1, programs: [alpha, beta] };

      const inlineRoot = newNode("div");
      const shownInline = withDom(() => M.syncProgramList(inlineRoot, visible, inlineUi({ snap })));
      // No strip node at all — not even the calm empty state.
      expect(allByClass(inlineRoot, "needs-strip")).toHaveLength(0);
      expect(inlineRoot.children.length).toBe(2);
      // The alerting rows are ordinary rows in their own groups, still wearing
      // the inline alert treatment (ember rail, tinted background)...
      const alphaBody = inlineRoot.children[0].children[inlineRoot.children[0].children.length - 1];
      const alertRow = byFkey(alphaBody, "agent:codex:a-alert");
      expect(alertRow).not.toBe(null);
      expect(alertRow.className).toContain("is-needs-you");
      // ...back in its group — whose solo lifecycle divider is elided now,
      // in every mode: a heading over the only population divides nothing.
      const betaBody = inlineRoot.children[1].children[inlineRoot.children[1].children.length - 1];
      expect(byFkey(betaBody, "agent:codex:b-alert")).not.toBe(null);
      expect(allByClass(betaBody, "lifecycle-section")).toHaveLength(0);
      // ...and every session is drawn exactly once.
      const keys = findAll(inlineRoot, (n) => Boolean(n.dataset?.fkey?.startsWith("agent:")))
        .map((n) => n.dataset.fkey as string);
      expect(new Set(keys).size).toBe(keys.length);

      /* The count the scope note reports is a population fact — where a row is
         DRAWN must never move it. Same fixture, both modes, same number. */
      const paneRoot = newNode("div");
      const shownPane = withDom(() => M.syncProgramList(paneRoot, visible, inlineUi({ snap, needsYouDisplay: "pane" })));
      expect(shownInline).toBe(shownPane);
    });

    test("inline mode marks every row the strip would have taken, whatever its shape", () => {
      /* The live set is dominated by hook-needsInput rows whose outcome is
         healthy — no is-needs-you ink. With the strip off, membership itself
         must mark the row, or six sessions asking for a person render as six
         ordinary Waiting rows. */
      const hookShaped = agent({ id: "codex:hook", status: "waiting", lifecycle: "waiting", hookLifecycle: "needsInput" });
      const outcomeShaped = asking({ id: "codex:outcome" });
      const calm = agent({ id: "codex:calm", status: "running" });
      const program = { id: "p", name: "P", agents: [hookShaped, outcomeShaped, calm] };
      const visible = [{ program, agents: program.agents }];
      const root = newNode("div");
      withDom(() => M.syncProgramList(root, visible, inlineUi({
        snap: { schemaVersion: 1, programs: [program] },
      })));
      const body = root.children[0].children[root.children[0].children.length - 1];
      expect(byFkey(body, "agent:codex:hook").className).toContain("is-alerting");
      expect(byFkey(body, "agent:codex:outcome").className).toContain("is-alerting");
      expect(byFkey(body, "agent:codex:calm").className).not.toContain("is-alerting");

      // Pane mode: the strip is the signal; its rows do not double-mark.
      const paneRoot = newNode("div");
      withDom(() => M.syncProgramList(paneRoot, visible, inlineUi({
        snap: { schemaVersion: 1, programs: [program] }, needsYouDisplay: "pane",
      })));
      const stripRow = byFkey(paneRoot.children[0], "agent:codex:hook");
      expect(stripRow.className).not.toContain("is-alerting");
    });

    test("inline mode still flags an alerting child folded inside a swarm", () => {
      const parent = agent({ id: "codex:parent", status: "running" });
      const child = asking({ id: "codex:child", parentAgentId: "codex:parent" });
      const program = { id: "p", name: "P", agents: [parent, child] };
      const visible = [{ program, agents: program.agents }];
      const root = newNode("div");
      withDom(() => M.syncProgramList(root, visible, inlineUi({
        snap: { schemaVersion: 1, programs: [program] },
      })));
      /* Pane mode's guarantee was the strip: a collapsed swarm could hide
         nothing, because the alerting child was pinned in plain sight. Inline
         mode has no strip, so the fold itself must say what is inside it —
         the parent's swarm chip takes ember ink, exactly as it does when the
         strip holds the child. */
      expect(allByClass(root, "needs-strip")).toHaveLength(0);
      const body = root.children[0].children[root.children[0].children.length - 1];
      expect(byFkey(body, "agent:codex:child")).toBe(null);
      const chipNode = byClass(body, "swarm-chip");
      expect(chipNode.className).toContain("is-alerting");
      expect(chipNode.attributes["aria-expanded"]).toBe("false");
    });

    test("inline mode draws an alerting parent as its own row, not an anchor", () => {
      const parent = asking({ id: "codex:parent" });
      const child = agent({ id: "codex:child", status: "running", parentAgentId: "codex:parent" });
      const program = { id: "p", name: "P", agents: [parent, child] };
      const visible = [{ program, agents: program.agents }];
      const root = newNode("div");
      withDom(() => M.syncProgramList(root, visible, inlineUi({
        snap: { schemaVersion: 1, programs: [program] },
      })));
      // The anchor exists to hold a place for a row that went to the strip.
      // Inline, the row never left, so the anchor must not appear beside it.
      expect(allByClass(root, "needs-strip")).toHaveLength(0);
      const body = root.children[0].children[root.children[0].children.length - 1];
      expect(byClass(body, "swarm-anchor")).toBe(null);
      expect(byFkey(body, "agent:codex:parent")).not.toBe(null);
    });

    test("flipping the mode repaints the list", () => {
      const program = { id: "p", name: "P", agents: [asking({ id: "codex:x" })] };
      const visible = [{ program, agents: program.agents }];
      const pane = M.programsPaintSig(visible, inlineUi({ needsYouDisplay: "pane" }));
      const inline = M.programsPaintSig(visible, inlineUi());
      expect(pane).not.toBe(inline);
    });

    test("the band head's rollup says a shut fold is hiding an alert", () => {
      const repo = { repoKey: "k-band", repoName: "cooper", worktreePath: "/lanes/g1", branch: "feat/g1", ephemeral: false };
      const program = {
        id: "repo:k-band:worktree:wt-g1", name: "cooper", path: "/lanes/g1",
        groupPath: ["k-band", "wt-g1"],
        agents: [asking({ id: "codex:band-alert", repo })],
      };
      const visible = [{ program, agents: program.agents }];
      const snap = { schemaVersion: 1, programs: [program] };

      /* Collapsed is the reachability case: with the fold shut, the band head
         is the only surface left that can say a session inside is asking. The
         band rolls up its WHOLE population through the same programRollupCells
         the worktree heads use, so the two can never disagree. */
      const root = newNode("div");
      withDom(() => M.syncProgramList(root, visible, inlineUi({
        snap, repoOverrides: new Map([["k-band", "closed"]]),
      })));
      const head = byClass(root.children[0], "repo-head");
      expect(textOf(head)).toContain("1alert");
      const cells = allByClass(head, "program-rollup-cell");
      expect(cells.some((c: { className: string }) => c.className.includes("is-alerting"))).toBe(true);
    });

    test("an alert arriving repaints the band head", () => {
      /* The band's shell signature carries its rollup cells: an alert arriving
         changes nothing else the shell paints, so without them the head would
         neither gain nor clear its alerts cell until something unrelated (a PR
         link, a worktree count) repainted the band — the documented
         mutates-only-itself failure class. */
      const repo = { repoKey: "k-sig", repoName: "cooper", worktreePath: "/lanes/s", branch: "feat/s", ephemeral: false };
      const programOf = (agents: Record<string, unknown>[]) => ({
        id: "repo:k-sig:worktree:w", name: "cooper", path: "/lanes/s",
        groupPath: ["k-sig", "w"], agents,
      });
      const root = newNode("div");
      const calm = programOf([agent({ id: "codex:sig-x", status: "running", repo })]);
      withDom(() => M.syncProgramList(root, [{ program: calm, agents: calm.agents }], inlineUi({
        snap: { schemaVersion: 1, programs: [calm] },
      })));
      expect(textOf(byClass(root, "repo-head"))).not.toContain("alert");

      const loud = programOf([asking({ id: "codex:sig-x", repo })]);
      withDom(() => M.syncProgramList(root, [{ program: loud, agents: loud.agents }], inlineUi({
        snap: { schemaVersion: 1, programs: [loud] },
      })));
      expect(textOf(byClass(root, "repo-head"))).toContain("1alert");
    });
  });

  /* ------------------------------------------------------------------------
     Honest history: two different endings, said in two different words.
     --------------------------------------------------------------------- */
  describe("history provenance", () => {
    const chipProgram = { id: "p", name: "P", agents: [] as unknown[] };

    test("an operator archive and a retained record are different chips", () => {
      const archived = agent({ id: "codex:arch", lifecycle: "finished", provenance: "operator-archive" });
      const retained = agent({ id: "codex:ret", lifecycle: "waiting", scope: "retained", provenance: "aged-out" });

      expect(M.historyProvenance(archived).label).toBe("Archived by you");
      expect(M.historyProvenance(retained).label).toBe("Retained history");
      // Two facts, two treatments: solid for the ending you chose, dashed for
      // the one nobody chose.
      expect(M.historyProvenance(archived).className).toContain("history-chip--archived");
      expect(M.historyProvenance(retained).className).toContain("history-chip--retained");
    });

    test("a session that ended some other way claims neither", () => {
      // The board must not call a provider exit "archived by you": four
      // different endings used to share that one word, which is the defect.
      for (const why of ["provider-exit", "process-died", "process-absent"]) {
        expect(M.historyProvenance(agent({ lifecycle: "finished", provenance: why }))).toBeNull();
      }
      // And a live session has no history record at all.
      expect(M.historyProvenance(agent({ status: "running" }))).toBeNull();
    });

    test("the chips render on the row, and reach a screen reader too", () => {
      const retained = agent({ id: "codex:ret", lifecycle: "waiting", scope: "retained", provenance: "aged-out" });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const row: any = withDom(() => M.renderAgentRow(retained, chipProgram));
      expect(nodeByClass(row, "history-chip")).not.toBeNull();
      expect(textOf(row)).toContain("Retained history");
      expect(row.attributes["aria-label"]).toContain("Retained history");
      // A live row stays byte-quiet.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const live: any = withDom(() => M.renderAgentRow(agent({ status: "running" }), chipProgram));
      expect(nodeByClass(live, "history-chip")).toBeNull();
    });

    test("names and program grouping survive into History", () => {
      /* The claim the plan asked to be pinned rather than assumed: History uses
         the same renderAgentRow and the same program sections, so a session's
         name and its workstream are the same there as they were on the board.
         An archived record is exactly where an operator is least able to
         re-derive either one. */
      const renamed = agent({
        id: "claude:done", provider: "claude", lifecycle: "finished",
        provenance: "operator-archive", status: "archived",
        identity: { name: "Nightly release check", base: "Nightly release check", disambiguator: "" },
      });
      const p = { id: "cwd-releases", name: "releases", agents: [renamed] };
      const root = newNode("div");
      const shown = withDom(() => M.syncProgramList(root, [{ program: p, agents: [renamed] }], listUi({
        view: "history",
        // History collapses its programs by default — there are usually a lot —
        // so this opens the one under test rather than asserting into a
        // deliberately empty body.
        programOverrides: new Map([["cwd-releases", "open"]]),
        snap: { schemaVersion: 1, programs: [p] },
      })));
      expect(shown).toBe(1);
      // The program section is still the program section, named for the program.
      expect(root.children.length).toBe(1);
      expect(textOf(root.children[0].children[1])).toContain("releases");
      // …and the row inside it still carries the session's own name.
      const body = root.children[0].children[root.children[0].children.length - 1];
      expect(textOf(body)).toContain("Nightly release check");
      expect(textOf(body)).toContain("Archived by you");
      // No strip on History: it is a record, not a request.
      expect(nodeByClass(root, "needs-strip")).toBeNull();
    });
  });

  /* The invariant behind both (3) and (3b), stated once so it cannot silently
     regress: in the Now view the open-gate can never contradict the filter. */
  test("(3c) in Now, every program with a filter-matching agent is expanded", () => {
    const cases = [
      agent({ id: "a:1", status: "running", activity: "working", outcome: "healthy" }),
      agent({ id: "a:2", status: "attention", activity: "idle", outcome: "needs-you" }),
      agent({ id: "a:3", status: "attention", activity: "ended", outcome: "needs-you", processState: "running" }),
    ];
    for (const a of cases) {
      const program = {
        id: "cwd-" + a.id,
        name: a.id,
        agents: [a],
        rollup: { total: 1, live: 0, working: 0, idle: 0, ended: 1, needsYou: 0, blocked: 0, failed: 0, linked: 0 },
      };
      expect(M.viewMatches("now", a)).toBe(true);
      expect(M.programOpen(program, listUi())).toBe(true);
    }
  });

  /* -------- finding 1: the quarantine dead end -----------------------------
     Identity resolution refuses to bind a session, Focus and Send go dead, and
     the operator was given a fixed sentence with no reason and no way forward —
     while agent.identityTrace sat unread in the payload the client had already
     received, and GET /api/debug/identity sat unused beside it. */

  const CONFLICTED = {
    identityTrace: {
      resolution: "ambiguous",
      reason: "cmux 6952219A-6C2F-4A61-9C0E-1F0B2D3E4A55 has conflicting open agent session files on ttys082.",
      surfaceId: "SURFACE-82",
      steps: [
        { tier: "recorded", outcome: "skipped", detail: "No recorded cmux target IDs on this source." },
        { tier: "session", outcome: "quarantined", detail: "ttys082 has open session files for two providers." },
        { tier: "cwd", outcome: "no-match", detail: "Two terminals report the same working folder." },
      ],
    },
    target: { resolution: "ambiguous", surfaceId: "SURFACE-82" },
    controlState: "quarantined",
    controls: [
      { action: "focus", enabled: false, reason: "Identity conflict on ttys082." },
      { action: "instruct", enabled: false, reason: "Identity conflict on ttys082." },
    ],
  };

  const DEBUG_PAYLOAD = {
    ok: true,
    agent: { id: "codex:a1", resolution: "ambiguous" },
    relatedSurfaces: [{
      surfaceId: "SURFACE-82",
      tty: "ttys082",
      identityConflict: "Two providers hold open session files on this terminal.",
      identityTrace: {
        surfaceId: "SURFACE-82",
        tty: "ttys082",
        processes: [
          { pid: 4242, command: "codex resume 019f94a1", recognizedAgentProcess: true },
          { pid: 5150, command: "claude --resume", recognizedAgentProcess: true },
          { pid: 9001, command: "zsh", recognizedAgentProcess: false },
        ],
        openFileMatches: [
          { pid: 4242, path: "/Users/me/.codex/sessions/019f94a1-....jsonl", provider: "codex", sessionId: "019f94a1-1558-7000-aeb8-26e2cfd0e8ec" },
          { pid: 5150, path: "/Users/me/.claude/projects/p/c0eb6d3f-....jsonl", provider: "claude", sessionId: "c0eb6d3f-9a41-7000-b2aa-77c1f0e93b21" },
        ],
        commandHints: [],
        outcome: "conflict",
        sourceSessionIds: ["019f94a1-1558-7000-aeb8-26e2cfd0e8ec", "c0eb6d3f-9a41-7000-b2aa-77c1f0e93b21"],
      },
    }],
  };

  test("(1) the trace the payload already carried becomes a normalized view", () => {
    const view = M.identityTraceView(agent(CONFLICTED));
    expect(view.resolution).toBe("ambiguous");
    expect(view.matchedTier).toBeNull();
    expect(view.reason).toContain("ttys082");
    expect(view.steps.map((s: { tier: string }) => s.tier)).toEqual(["recorded", "session", "cwd"]);
    expect(view.steps[1]).toMatchObject({
      tierLabel: "Session ID on a terminal",
      outcome: "quarantined",
      outcomeLabel: "quarantined",
    });
    // A bound session still reports which tier bound it.
    const bound = M.identityTraceView(agent({
      identityTrace: { resolution: "exact", matchedTier: "session", surfaceId: "s1", steps: [{ tier: "session", outcome: "matched", detail: "Session ID recorded by cmux." }] },
    }));
    expect(bound.matchedTier).toBe("session");
    // An agent with no trace at all degrades to its target, never to a guess.
    const bare = M.identityTraceView(agent());
    expect(bare.resolution).toBe("exact");
    expect(bare.steps).toEqual([]);
    expect(bare.reason).toBeNull();
  });

  test("(1) a quarantined session gets a reason and a next step, not just 'no'", () => {
    const brief = M.quarantineBrief(agent(CONFLICTED), "quarantined");
    expect(brief.title).toBe("Control routing locked.");
    expect(brief.cause).toBe("contested-terminal");
    expect(brief.why).toContain("More than one session claims the same terminal");
    // The whole point: a way forward, and one that does not require a restart.
    expect(brief.nextStep).toContain("End or close one of the sessions sharing that terminal");

    /* The shape the LIVE board actually produces: every one of the 9 quarantined
       sessions on 127.0.0.1:4701 resolves "ambiguous" having refused at the cwd
       tier, not the session tier — so keying the copy off the resolution alone
       would have told all of them to close a terminal that is not the problem. */
    const sharedFolder = M.quarantineBrief(agent({
      identityTrace: {
        resolution: "ambiguous",
        reason: "2 active sources share this cwd; cwd fallback requires exactly one and controls are disabled.",
        steps: [
          { tier: "recorded", outcome: "skipped", detail: "No recorded cmux target IDs on this source." },
          { tier: "session", outcome: "no-match", detail: "Source session ID is not present on any ready cmux surface this scan." },
          { tier: "cwd", outcome: "ambiguous", detail: "2 active sources share this cwd; cwd fallback requires exactly one." },
        ],
      },
    }), "quarantined");
    expect(sharedFolder.cause).toBe("shared-folder");
    expect(sharedFolder.why).toContain("shares its working folder");
    expect(sharedFolder.nextStep).toContain("own cmux pane");

    // Observed-only with nothing claiming it is a third failure, third next step.
    const observed = M.quarantineBrief(agent({ target: { resolution: "missing" } }), "observed-only");
    expect(observed.title).toBe("Controls unavailable.");
    expect(observed.cause).toBe("missing");
    expect(observed.nextStep).toContain("cmux pane");
    // The three causes really do read differently — this is not one string thrice.
    expect(new Set([brief.nextStep, sharedFolder.nextStep, observed.nextStep]).size).toBe(3);
    // A healthy session gets no banner at all.
    expect(M.quarantineBrief(agent(), "linked")).toBeNull();
  });

  test("(1) the control banner names the reason and the exit, and leaks no cmux identifiers", () => {
    const locked = agent(CONFLICTED);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const banner: any = withDom(() => M.renderControlBanner(locked, "quarantined"));
    expect(banner).not.toBeNull();
    const text = textOf(banner);
    expect(text).toContain("Control routing locked.");
    expect(text).toContain("More than one session claims the same terminal");
    expect(text).toContain("End or close one of the sessions sharing that terminal");
    expect(text).toContain("Why?");
    expect(text).toContain("View Evidence");
    expect(byClass(banner, "control-banner-details")?.tagName).toBe("details");
    // The established Operate-chrome rule holds: raw cmux/session identifiers
    // live in Evidence, never in the banner — even though the trace is full of
    // them and the capability reasons name the tty.
    expect(text).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/i);
    expect(text).not.toContain("ttys082");
    expect(text).not.toContain("SURFACE-82");
    // The evidence link is focus-restorable like every other repainted control.
    const link = buttonsOf(banner)[0];
    expect(link.dataset.fkey).toBe("control-evidence:codex:a1");
    // A linked session still renders no banner.
    expect(withDom(() => M.renderControlBanner(agent({ controls: [{ action: "focus", enabled: true }] }), "linked"))).toBeNull();
  });

  test("(1) Evidence renders the tier trail the resolver actually walked", () => {
    const locked = agent(CONFLICTED);
    const evidence = withDom(() => M.renderEvidence(locked));
    const block = byClass(evidence, "identity-block");
    expect(block).not.toBeNull();
    expect(block.dataset.evidenceSection).toBe("route");
    expect(textOf(byClass(block, "route-chip"))).toBe("Quarantined");
    expect(byClass(block, "route-chip").className).toContain("route-chip--lock");
    const binds = allByClass(block, "route-bind");
    expect(binds.length).toBe(2);
    expect(textOf(binds[0])).toContain("Session ID");
    expect(textOf(binds[0])).toContain("ttys082 has open session files for two providers.");
    expect(textOf(binds[1])).toContain("Working folder");
    expect(textOf(binds[1])).toContain("Two terminals report the same working folder.");
    expect(textOf(block)).not.toContain("No recorded cmux target IDs on this source.");
    expect(textOf(block)).not.toContain("skipped");
    expect(allByClass(block, "identity-step").length).toBe(0);
    const load = buttonsOf(block).find((b) => String(b.dataset.fkey).startsWith("identity-load:"));
    expect(load).toBeDefined();
    expect(load.attributes["aria-label"]).toContain("Show which terminals claim this session");
    const exact = withDom(() => M.renderEvidence(agent()));
    expect(byEvidenceSection(exact, "route")).not.toBeNull();
    expect(textOf(byClass(exact, "route-chip"))).toBe("Exact");
  });

  test("(1) debug-endpoint evidence becomes 'this tty has both of these sessions open'", () => {
    const collisions = M.surfaceCollisions(DEBUG_PAYLOAD);
    expect(collisions.length).toBe(1);
    expect(collisions[0]).toMatchObject({ surfaceId: "SURFACE-82", tty: "ttys082" });
    expect(collisions[0].claims.length).toBe(2);
    // The process that is NOT holding a session file is not presented as a claim.
    expect(collisions[0].claims.map((c: { pid: number }) => c.pid)).toEqual([4242, 5150]);

    const line = M.collisionLine(collisions[0]);
    expect(line).toContain("ttys082");
    expect(line).toContain("2 sessions claim it");
    expect(line).toContain("Codex 019f94a1…");
    expect(line).toContain("Claude c0eb6d3f…");
    expect(line).toContain("pid 4242, codex resume 019f94a1");
    expect(line).toContain("pid 5150, claude --resume");

    // An uncontested terminal reads as one session, and an empty one says so
    // rather than implying a conflict that is not there.
    expect(M.collisionLine({ tty: "ttys001", surfaceId: "S1", conflict: "", claims: [{ provider: "claude", sessionId: "abcdefghijkl", pid: 7, command: "claude" }] }))
      .toBe("ttys001 — one session open: Claude abcdefgh… (pid 7, claude)");
    expect(M.collisionLine({ tty: "", surfaceId: "S9", conflict: "", claims: [] }))
      .toBe("S9 — no open agent session files observed.");
    expect(M.surfaceCollisions(null)).toEqual([]);
  });

  test("(1) fetched terminal evidence reaches the screen and moves the drawer signature", () => {
    const locked = agent(CONFLICTED);
    const loaded = { agentId: "codex:a1", loading: false, error: "", data: DEBUG_PAYLOAD };
    const block = withDom(() => M.renderIdentityBlock(locked, { identity: loaded }));
    const text = textOf(block);
    expect(text).toContain("ttys082 — 2 sessions claim it");
    expect(text).toContain("Two providers hold open session files on this terminal.");
    expect(byClass(block, "is-contested")).not.toBeNull();

    // Failure is reported, never smoothed into "no conflicts found".
    const failed = withDom(() => M.renderIdentityBlock(locked, {
      identity: { agentId: "codex:a1", loading: false, error: "HTTP 404", data: null },
    }));
    expect(textOf(failed)).toContain("Terminal evidence unavailable: HTTP 404");
    expect(buttonsOf(failed).some((b) => textOf(b) === "Retry")).toBe(true);

    // Evidence that arrives while nothing else changed must still repaint: the
    // drawer signature is the only thing standing between the fetch and the DOM.
    const program = { id: "p", name: "P", agents: [locked] };
    const view = { kind: "agent", agent: locked, program };
    const sel = { kind: "agent", id: "codex:a1" };
    const base = M.inspectorPaintSig(sel, view, identityUi());
    expect(M.inspectorPaintSig(sel, view, identityUi({ identity: { agentId: "codex:a1", loading: true, error: "", data: null } }))).not.toBe(base);
    expect(M.inspectorPaintSig(sel, view, identityUi({ identity: loaded }))).not.toBe(base);
    expect(M.inspectorPaintSig(sel, view, identityUi({ identity: { agentId: "codex:a1", loading: false, error: "HTTP 404", data: null } }))).not.toBe(base);
    // Another agent's evidence must not repaint this drawer.
    expect(M.inspectorPaintSig(sel, view, identityUi({ identity: { agentId: "codex:other", loading: false, error: "", data: DEBUG_PAYLOAD } }))).toBe(base);
    // And a trace that changes repaints, now that the drawer renders it.
    const rebound = { ...locked, identityTrace: { ...CONFLICTED.identityTrace, resolution: "exact", matchedTier: "session" } };
    expect(M.inspectorPaintSig(sel, { kind: "agent", agent: rebound, program }, identityUi())).not.toBe(base);
  });

  /* -------- findings 5 + 12: five unreachable render functions -------------
     They were kept alive only by regexes that matched app.js's source TEXT —
     function names, their ordering, even the blank lines between them. Those
     assertions were replaced with the rendered-DOM ones above and below, and
     the functions deleted. What the drawer actually builds is the contract. */
  test("(5) the agent drawer builds Document + Desk together, and no swarm section", () => {
    const rich = agent({
      lastUserMessage: "rebase onto main",
      lastAgentMessage: "rebased, 412 tests green",
      task: "Port the SEM forecast rate limiter",
    });
    const pane = newNode("div");
    withState({ snap: snapshot({ programs: [{ id: "p", name: "P", agents: [rich] }] }) }, () =>
      withDom(() => M.renderAgentDrawer(pane, { kind: "agent", agent: rich, program: { id: "p", name: "P", agents: [rich] } })));
    const text = textOf(pane);
    expect(byClass(pane, "drawer-doc")).not.toBeNull();
    expect(byClass(pane, "drawer-desk")).not.toBeNull();
    expect(byClass(pane, "drawer-grid")).not.toBeNull();
    expect(text).not.toContain("Operate");
    expect(text).toContain("Evidence");
    // Both turns survive, each exactly once, under honest role labels.
    expect(text).toContain("rebase onto main");
    expect(text).toContain("rebased, 412 tests green");
    expect(text).toContain("You");
    expect(text).toContain("Agent");
    // The objective rides the head, not a second panel heading.
    expect(text).toContain("Port the SEM forecast rate limiter");
    expect(text).not.toContain("Last human message");
  });

  /* -------- finding 9: the shadowed `state` identifier ---------------------- */
});

/* ---------------------------------------------------------------------------
   WAVE 3 / FE-C — the four things the operator could not do.

   Finding 1: :4701 served a 91-hour-frozen snapshot while the UI read "Live".
   Wave 1 fixed the BADGE. A badge is something you have to go and look at; the
   failure was that the operator looked at the board and believed it. This block
   pins the alarm, the clocks and the controls all keying off ONE predicate, so
   they can never disagree about whether the board is trustworthy.
   ------------------------------------------------------------------------- */

const FROZEN_AT = "2026-07-24T12:42:29.656Z";   // the real generatedAt on the wedged box
const FROZEN_NOW = Date.parse("2026-07-28T08:00:00.000Z"); // ~91h later

describe("FE-C: a frozen feed is announced, not merely available on inspection", () => {
  test("(1) the alarm fires on DATA age — a live socket cannot talk it down", () => {
    const now = FROZEN_NOW;
    // Fresh data: no alarm, whatever the transport thinks.
    expect(M.feedAlarm("live", new Date(now - 3_000).toISOString(), now)).toBeNull();
    expect(M.feedAlarm("reconnecting", new Date(now - 3_000).toISOString(), now)).toBeNull();
    // The exact production failure: conn === "live" (the server heartbeats every
    // 25s from a timer that knows nothing about the collector) over a snapshot
    // generated four days ago. The alarm must fire anyway.
    const alarm = M.feedAlarm("live", FROZEN_AT, now);
    expect(alarm).not.toBeNull();
    expect(alarm.kind).toBe("frozen");
    expect(alarm.headline).toContain("Feed frozen");
    expect(alarm.headline).toContain("3.8d");            // the age, in the headline
    expect(alarm.ageMs).toBeGreaterThan(91 * 3_600_000);
    // It names the consequence, not just the condition.
    expect(alarm.detail).toContain("Controls are held");
  });

  test("(1) it does not cry wolf: a merely lagging snapshot is not an alarm", () => {
    const now = FROZEN_NOW;
    // 30s > SNAPSHOT_FRESH_MS but <= SNAPSHOT_STALE_MS: "lagging", not stale.
    expect(M.snapshotFreshness(new Date(now - 30_000).toISOString(), now).state).toBe("lagging");
    expect(M.feedAlarm("live", new Date(now - 30_000).toISOString(), now)).toBeNull();
    // Nothing collected yet is not evidence of staleness — never invent one.
    expect(M.feedAlarm("connecting", null, now)).toBeNull();
    expect(M.feedAlarm("live", "not-a-date", now)).toBeNull();
    // 61s past the stale threshold does alarm.
    expect(M.feedAlarm("live", new Date(now - 61_000).toISOString(), now)).not.toBeNull();
  });

  test("(1) an unreachable server is its own alarm, with no invented age", () => {
    const alarm = M.feedAlarm("offline", FROZEN_AT, FROZEN_NOW);
    expect(alarm.kind).toBe("offline");
    expect(alarm.ageMs).toBeNull();               // no age claim we cannot support
    expect(alarm.headline).toContain("not updating");
  });

  test("(1) the alarm names the age and carries the one action that repairs it", () => {
    const alarm = M.feedAlarm("live", FROZEN_AT, FROZEN_NOW);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const node: any = withDom(() => M.feedAlarmNode(alarm));
    const text = textOf(node);
    expect(text).toContain("Feed frozen");
    expect(text).toContain("3.8d");
    expect(text).toContain("Refresh now");
    const refresh = buttonsOf(node);
    expect(refresh).toHaveLength(1);
    // Repainted chrome without an fkey loses keyboard focus on every snapshot.
    expect(refresh[0].dataset.fkey).toBe("feed-alarm-refresh");
    // Offline gets the severed-node mark, not the advisory diamond.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const offline: any = withDom(() => M.feedAlarmNode(M.feedAlarm("offline", null, FROZEN_NOW)));
    expect(byClass(offline, "is-offline")).not.toBeNull();
  });

  test("(1) tickClocks stops extrapolating a dead agent's uptime while the feed is frozen", () => {
    const base = 60_000;
    const from = "2026-07-24T12:42:29.656Z";
    const now = Date.parse(from) + 5_000;
    // Healthy board: the clock advances with wall time, exactly as before.
    expect(M.elapsedTickText(base, from, now, false)).toBe("65s");
    // Frozen board: it HOLDS at the value the snapshot actually reported. The
    // bug was that this number kept climbing for four days, which made a dead
    // agent the most convincingly alive thing on the page.
    expect(M.elapsedTickText(base, from, FROZEN_NOW, true)).toBe("60s");
    expect(M.elapsedTickText(base, from, FROZEN_NOW, false)).toBe("3.8d"); // the lie, for contrast
    // Unreadable datasets yield null rather than "—" written over a real value.
    expect(M.elapsedTickText("nope", from, now, false)).toBeNull();
    expect(M.elapsedTickText(base, "nope", now, false)).toBeNull();
    expect(M.elapsedTickText(base, "nope", now, true)).toBe("60s"); // frozen needs no `from`
  });

  test("(1) the 5s clock tick itself holds — not merely the helper it calls", () => {
    // End-to-end over the real loop: tickClocks walks [data-elapsed-base] nodes
    // and rewrites them in place, which is where the four-day lie was painted.
    const uptime = newNode("div");
    uptime.dataset.elapsedBase = "60000";
    uptime.dataset.elapsedFrom = FROZEN_AT;
    const ago = newNode("div");
    ago.dataset.ago = FROZEN_AT;
    const doc = {
      querySelectorAll: (sel: string) =>
        (sel === "[data-elapsed-base]" ? [uptime] : sel === "[data-ago]" ? [ago] : []),
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const withStub = (fn: () => void) => {
      (globalThis as unknown as { document: unknown }).document = doc;
      try { fn(); } finally { delete (globalThis as unknown as { document?: unknown }).document; }
    };

    withStub(() => M.tickClocks(false, FROZEN_NOW));
    expect(uptime.textContent).toBe("3.8d");               // the bug, reproduced
    expect(uptime.classList.contains("is-frozen")).toBe(false);

    withStub(() => M.tickClocks(true, FROZEN_NOW));
    expect(uptime.textContent).toBe("60s");                // held at the reported value
    expect(uptime.classList.contains("is-frozen")).toBe(true);

    // "4d ago" is a real distance from a real past moment — freezing it would
    // replace one lie with another, so it keeps ticking.
    expect(ago.textContent).toContain("ago");
  });

  test("(1) one predicate drives the alarm, the clocks and the controls", () => {
    for (const [conn, at] of [["live", FROZEN_AT], ["offline", null], ["live", null]] as [string, string | null][]) {
      expect(M.clocksFrozen(conn, at, FROZEN_NOW)).toBe(M.feedAlarm(conn, at, FROZEN_NOW) !== null);
    }
    // feedFrozen reads the same rule off a state-shaped object.
    expect(M.feedFrozen({ conn: "live", snap: { generatedAt: FROZEN_AT } }, FROZEN_NOW)).toBe(true);
    expect(M.feedFrozen({ conn: "live", snap: { generatedAt: new Date(FROZEN_NOW).toISOString() } }, FROZEN_NOW)).toBe(false);
    expect(M.feedFrozen({ conn: "connecting", snap: null }, FROZEN_NOW)).toBe(false);
  });

  test("(1) a Send that cannot send does not render as the primary action", () => {
    /* The panel used to say "you cannot act" and show a primary action in the
       same breath. `.btn.primary` is declared after `.btn:disabled` at equal
       specificity, so the primary fill won the cascade and a disabled Send
       rendered solid ink — the highest-emphasis element on the drawer, beside
       a composer reading "Instruction unavailable" and two dock tools the
       server had already refused.

       Measured when written: `controlsFor` gates instruct on `transmitRefusal`
       and 724 of 731 live agents came back instruct:false, so this was the
       normal rendering rather than an edge case.

       Asserted on the CLASS rather than on a colour, because the class is what
       the cascade reads and a test that could only see computed style would
       need a browser this suite does not have. */
    const refused = agent({
      controls: [
        { action: "focus", enabled: false },
        { action: "instruct", enabled: false },
        { action: "interrupt", enabled: false },
        { action: "archive", enabled: true },
      ],
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const dock: any = withDom(() => M.renderCommandDock(refused, "observed-only", null, []));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const send: any = buttonsOf(dock).find((b: any) => String(b.className).includes("command-send"));

    expect(send).toBeDefined();
    expect(send.hasAttribute("disabled")).toBe(true);
    expect(String(send.className)).not.toContain("primary");
  });

  test("(1) a Send that CAN send keeps its emphasis", async () => {
    /* The control, and the reason the assertion above is not satisfied by
       deleting the class outright: on a linked session Send is the primary
       action and must look like one. */
    const live = agent({
      controls: [
        { action: "focus", enabled: true },
        { action: "instruct", enabled: true },
        { action: "interrupt", enabled: true },
        { action: "archive", enabled: true },
      ],
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const dock: any = await withState({ drafts: new Map([[live.id, "Ship it"]]) }, () =>
      withDom(() => M.renderCommandDock(live, "linked", null, [])));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const send: any = buttonsOf(dock).find((b: any) => String(b.className).includes("command-send"));

    expect(send.hasAttribute("disabled")).toBe(false);
    expect(String(send.className)).toContain("primary");
  });

  test("Send is a paper plane, Focus is a magnifying glass, and the helper copy is gone", async () => {
    const live = agent({
      controls: [
        { action: "focus", enabled: true },
        { action: "instruct", enabled: true },
        { action: "interrupt", enabled: true },
      ],
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const dock: any = await withState({ drafts: new Map([[live.id, "Ship it"]]) }, () =>
      withDom(() => M.renderCommandDock(live, "linked", null, [])));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const send: any = buttonsOf(dock).find((b: any) => String(b.className).includes("command-send"));
    expect(send.attributes["aria-label"]).toBe("Send");
    expect(textOf(send)).toBe("");
    expect(send.children[0]?.tagName).toBe("svg");
    expect(String(send.children[0]?.attributes?.class || "")).toContain("ico");
    expect(source).toContain('icon("send")');
    expect(source).toContain("M22 2 15 22 11 13 2 9z");
    expect(source).toContain("cx: 11, cy: 11, r: 6.5");
    expect(textOf(dock)).not.toContain("Ready · linked");
    expect(textOf(dock)).not.toContain("Enter to send");
    const focus = byFkey(dock, "act:" + live.id + ":focus");
    expect(focus?.attributes?.["aria-label"]).toBe("Focus");
    expect(textOf(focus)).toBe("");
  });

  test("(1) Send follows the trimmed draft immediately without repainting the composer", async () => {
    const live = agent({ controls: [{ action: "instruct", enabled: true }] });
    await withState({ drafts: new Map() }, async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const dock: any = withDom(() => M.renderCommandDock(live, "linked", null, []));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const input: any = findAll(dock, (n: any) => n.tagName === "textarea")[0];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const send: any = byFkey(dock, "act:" + live.id + ":instruct");

      expect(send.hasAttribute("disabled")).toBe(true);
      input.value = "   ";
      await fire(input, "input", { target: input });
      expect(send.hasAttribute("disabled")).toBe(true);
      expect(String(send.className)).not.toContain("primary");

      input.value = "  Ship it  ";
      await fire(input, "input", { target: input });
      expect(send.hasAttribute("disabled")).toBe(false);
      expect(String(send.className)).toContain("primary");

      input.value = "";
      await fire(input, "input", { target: input });
      expect(send.hasAttribute("disabled")).toBe(true);
    });
  });

  test("(4) the composer grows for wrapped prose but never sends server-invalid line breaks", async () => {
    const live = agent({ controls: [{ action: "instruct", enabled: true }] });
    const snap = snapshot({ programs: [{ id: "p", name: "P", agents: [live] }] });
    await withState({
      snap, conn: "live", actions: { items: [] }, pending: new Set(), feedback: new Map(), drafts: new Map([[live.id, "Ship it"]]),
    }, () => withRequests([
      { status: 200, json: { ok: true } },
      { status: 200, json: { ok: true, items: [] } },
    ], async (calls) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const dock: any = M.renderCommandDock(live, "linked", null, []);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const input: any = findAll(dock, (n: any) => n.tagName === "textarea")[0];
      expect(input).toBeDefined();
      expect(input.attributes.rows).toBe("1");

      let prevented = false;
      await fire(input, "keydown", { key: "Enter", shiftKey: true, preventDefault: () => { prevented = true; } });
      expect(prevented).toBe(true);
      expect(calls).toHaveLength(0);

      input.value = "Ship it\ncarefully";
      await fire(input, "input", { target: input });
      expect(input.value).toBe("Ship it carefully");
      expect(M.state.drafts.get(live.id)).toBe("Ship it carefully");

      await fire(input, "keydown", { key: "Enter" });
      expect(calls[0]!.body).toMatchObject({ action: "instruct", instruction: "Ship it carefully" });
    }));

    for (const modifier of ["metaKey", "ctrlKey"] as const) {
      await withState({
        snap, conn: "live", actions: { items: [] }, pending: new Set(), feedback: new Map(), drafts: new Map([[live.id, "Again"]]),
      }, () => withRequests([
        { status: 200, json: { ok: true } },
        { status: 200, json: { ok: true, items: [] } },
      ], async (calls) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const dock: any = M.renderCommandDock(live, "linked", null, []);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const input: any = findAll(dock, (n: any) => n.tagName === "textarea")[0];
        await fire(input, "keydown", { key: "Enter", [modifier]: true });
        expect(calls[0]!.body.instruction).toBe("Again");
      }));
    }
  });

  test("(4) the composer grows with its draft but stops before consuming the transcript", () => {
    const field = { scrollHeight: 76, style: { height: "", overflowY: "" } };
    M.resizeComposer(field);
    expect(field.style.height).toBe("76px");
    expect(field.style.overflowY).toBe("hidden");

    field.scrollHeight = 220;
    M.resizeComposer(field);
    expect(field.style.height).toBe("128px");
    expect(field.style.overflowY).toBe("auto");

    field.scrollHeight = 20;
    M.resizeComposer(field);
    expect(field.style.height).toBe("44px");
    expect(styles).toMatch(/\.command-composer textarea\s*\{[^}]*max-height:\s*8rem[^}]*field-sizing:\s*content/);
    expect(styles).toMatch(/\.command-send\.primary\s*\{[^}]*box-shadow:/);
  });

  test("(4) the composer repairs a saved multiline draft before it can become sendable", async () => {
    const live = agent({ controls: [{ action: "instruct", enabled: true }] });
    await withState({ drafts: new Map([[live.id, "Ship it\r\ncarefully"]]) }, () => {
      const dock = withDom(() => M.renderCommandDock(live, "linked", null, []));
      const input = findAll(dock, (node) => node.tagName === "textarea")[0];
      expect(input.value).toBe("Ship it carefully");
      expect(M.state.drafts.get(live.id)).toBe("Ship it carefully");
      expect(byFkey(dock, "act:" + live.id + ":instruct")?.hasAttribute("disabled")).toBe(false);
    });
  });

  test("(4) composer placeholders name the live, held, quarantined and unavailable states", () => {
    const enabled = agent({ controls: [{ action: "instruct", enabled: true }] });
    const quarantined = agent({ controls: [{ action: "instruct", enabled: false }] });
    const observed = agent({ controls: [{ action: "instruct", enabled: false }] });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const placeholder = (a: any, control: string, alarm: any = null) => {
      const dock: any = withDom(() => M.renderCommandDock(a, control, alarm, []));
      return findAll(dock, (n: any) => n.tagName === "textarea")[0].attributes.placeholder;
    };
    expect(placeholder(enabled, "linked")).toBe("Message this agent…");
    expect(placeholder(enabled, "linked", M.feedAlarm("offline", null))).toBe("Waiting for a fresh snapshot…");
    expect(placeholder(quarantined, "quarantined")).toBe("Resolve routing in Evidence before messaging…");
    expect(placeholder(observed, "observed-only")).toBe("Messaging unavailable for this session");
  });

  test("(1) the composer does not contradict the selected agent's harness or model", () => {
    /* The drawer header already owns harness/model identity. A hard-coded
       provider/model in the input can contradict the authoritative snapshot
       and make a correctly routed instruction look unsafe. */
    for (const [provider, model] of [["claude", "claude-fable-5"], ["codex", "gpt-5.6"]]) {
      const live = agent({
        provider,
        model,
        controls: [{ action: "instruct", enabled: true }],
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const dock: any = withDom(() => M.renderCommandDock(live, "linked", null, []));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const input: any = findAll(dock, (n: any) => n.tagName === "textarea")[0];
      expect(input.attributes.placeholder).toContain("Message this agent");
      expect(input.attributes.placeholder).not.toMatch(/Prime|spark|Claude|fable|Codex|gpt/i);
    }
  });

  test("(1) every control in the dock is held — and says so — on a frozen board", async () => {
    const live = agent({
      controls: [
        { action: "focus", enabled: true },
        { action: "instruct", enabled: true },
        { action: "interrupt", enabled: true },
        { action: "archive", enabled: true },
      ],
    });
    const alarm = M.feedAlarm("live", FROZEN_AT, FROZEN_NOW);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ok: any = await withState({ drafts: new Map([[live.id, "Ship it"]]) }, () =>
      withDom(() => M.renderCommandDock(live, "linked", null)));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const heldDock: any = await withState({ drafts: new Map([[live.id, "Ship it"]]) }, () =>
      withDom(() => M.renderCommandDock(live, "linked", alarm)));

    // Baseline: on a healthy board these controls are live.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const enabledOf = (n: any) => buttonsOf(n).map((b: any) => b.hasAttribute("disabled"));
    expect(enabledOf(ok).every((d: boolean) => d === false)).toBe(true);
    expect(byClass(ok, "command-dock-stale")).toBeNull();
    expect(byClass(ok, "command-dock--linked")).not.toBeNull();

    // Frozen: nothing is clickable, and the input cannot be typed into either.
    expect(enabledOf(heldDock).every((d: boolean) => d === true)).toBe(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const input: any = findAll(heldDock, (n: any) => n.tagName === "textarea")[0];
    expect(input.hasAttribute("disabled")).toBe(true);
    expect(input.attributes.placeholder).toBe("Waiting for a fresh snapshot…");
    // The reason is stated, and it is about the FEED — not a routing capability
    // reason, which this chrome is forbidden to echo.
    const note = byClass(heldDock, "command-dock-stale");
    expect(note).not.toBeNull();
    expect(textOf(note)).toContain("out of date");
    // "Ready · linked" is a claim the board cannot support while frozen.
    expect(textOf(heldDock)).not.toContain("Ready · linked");
  });

  test("(1) the held reason is about the feed, and offline vs frozen read differently", () => {
    expect(M.staleControlNote(null)).toBe("");
    expect(M.staleControlNote(M.feedAlarm("offline", null, FROZEN_NOW))).toContain("unreachable");
    const frozen = M.staleControlNote(M.feedAlarm("live", FROZEN_AT, FROZEN_NOW));
    expect(frozen).toContain("3.8d");
    expect(frozen).toContain("Snapshot stale");
    expect(frozen).toContain("Controls held");
    expect(frozen).toContain("Waiting for a fresh snapshot");
    expect(frozen).not.toContain("Refresh");
  });

  test("(1) a feed that freezes under an OPEN drawer repaints its held controls", () => {
    // Found by driving the real boot path, not by reading the code: when the
    // feed freezes, generatedAt is not in this signature and agentRecordSig is
    // byte-identical across the frozen refresh, so the drawer never repainted —
    // the dock kept offering live-looking Focus/Send over four-day-old routing.
    const a = agent();
    const sel = { kind: "agent", id: a.id };
    const view = { kind: "agent", agent: a, program: { id: "p", name: "P", agents: [] } };
    const fresh = identityUi({ conn: "live", snap: { generatedAt: new Date().toISOString(), programs: [] } });
    const stuck = identityUi({ conn: "live", snap: { generatedAt: FROZEN_AT, programs: [] } });
    expect(M.inspectorPaintSig(sel, view, stuck)).not.toBe(M.inspectorPaintSig(sel, view, fresh));
    // And an unreachable server is the same story.
    expect(M.inspectorPaintSig(sel, view, identityUi({ ...fresh, conn: "offline" })))
      .not.toBe(M.inspectorPaintSig(sel, view, fresh));
  });

});

/* ---------------------------------------------------------------------------
   Finding 2: reading what an agent actually did required leaving the dashboard.
   The snapshot carries a fixed 800-char tail; the decision the operator makes
   most often — "this lane claims done, is that true?" — cannot be made from it.

   The route is being built in a parallel lane and does not exist here, so the
   degrade path is as important as the happy path and is tested first.
   ------------------------------------------------------------------------- */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function transcriptUi(over: Record<string, unknown> = {}): any {
  return { transcript: { agentId: null, loading: false, error: "", data: null, limit: 200, ...over } };
}

describe("FE-C: the transcript is readable inside the drawer", () => {
  test("(2) the request names an agent and a bounded line budget — never a path", () => {
    expect(M.transcriptUrl("claude:abc-123", 200)).toBe("/api/transcript?agent=claude%3Aabc-123&limit=200");
    // The contract's hard max is 1000 and the floor is 1; a caller cannot widen it.
    expect(M.transcriptUrl("a", 99999)).toContain("limit=1000");
    expect(M.clampTranscriptLimit(0)).toBe(1);
    expect(M.clampTranscriptLimit(5000)).toBe(1000);
    expect(M.clampTranscriptLimit("nonsense")).toBe(200);
    expect(M.clampTranscriptLimit(350)).toBe(350);
    // "Load more" walks a fixed ladder and stops at the ceiling.
    expect(M.nextTranscriptLimit(200)).toBe(500);
    expect(M.nextTranscriptLimit(500)).toBe(1000);
    expect(M.nextTranscriptLimit(1000)).toBeNull();
  });

  test("controlOutcome believes success only when the body says so in a boolean", () => {
    // The invariant that matters: HTTP completion alone is never success. This
    // used to be reachable only by driving sendControl through a fake DOM and a
    // fake fetch; it is now a value in, a sentence out.
    expect(M.controlOutcome("instruct", "Claude · main", { status: 200, body: { ok: true } }))
      .toEqual({ ok: true, message: "Send succeeded (Claude · main)" });

    // A 200 with an empty body, and a 200 whose body never parsed, are failures.
    for (const body of [{}, null, undefined, { ok: "yes" }]) {
      const out = M.controlOutcome("instruct", "A", { status: 200, body });
      expect(out.ok, JSON.stringify(body)).toBe(false);
      expect(out.message).toContain("unexpected response");
      expect(out.message).toContain("HTTP 200");
    }
  });

  test("controlOutcome reports every part of a refusal the server gave it", () => {
    const out = M.controlOutcome("interrupt", "A", {
      status: 200,
      body: { ok: false, error: { code: "CMUX_FAILED", message: "no pane", exitCode: 3, stderr: "  boom  " } },
    });
    expect(out.ok).toBe(false);
    // Code, message, exit code and stderr each survive — a refusal the operator
    // cannot act on is the reason this control plane logs exit codes at all.
    expect(out.message).toBe("Interrupt failed [CMUX_FAILED]: no pane (exit 3)\nboom");

    // exitCode 0 is a real value and must not be dropped by a falsy check.
    expect(M.controlOutcome("focus", "A", { status: 200, body: { ok: false, error: { exitCode: 0 } } }).message)
      .toContain("(exit 0)");

    // A transport failure names itself; an error with no message still says something.
    expect(M.controlOutcome("archive", "A", { error: new Error("socket hang up") }).message)
      .toBe("Archive failed: socket hang up");
    expect(M.controlOutcome("archive", "A", { error: {} }).message).toContain("network error");

    // An unknown action degrades to its own name rather than "undefined".
    expect(M.controlOutcome("teleport", "A", { status: 200, body: { ok: true } }).message)
      .toBe("teleport succeeded (A)");
  });

  test("(2) a build without the route says so — it never claims the agent is silent", () => {
    // The exact shape a server with no such route returns: 404, non-JSON body.
    expect(M.transcriptFailureText(404, null)).toBe("Transcript view is not available in this build.");
    // …which must NOT be confused with the contract's real 404.
    expect(M.transcriptFailureText(404, { ok: false, error: { code: "AGENT_NOT_FOUND" } }))
      .toContain("no longer tracked");
    expect(M.transcriptFailureText(0, null)).toContain("Could not reach the server");
    const other = M.transcriptFailureText(500, { ok: false, error: { code: "READ_FAILED", message: "EACCES" } });
    expect(other).toContain("READ_FAILED");
    expect(other).toContain("EACCES");
    // Every degrade names the failure; none of them is silence or a spinner.
    for (const text of [M.transcriptFailureText(404, null), M.transcriptFailureText(0, null), other]) {
      expect(text.length).toBeGreaterThan(10);
    }
  });

  test("(2) the wire payload is defended: no invented content, no invented source", () => {
    const view = M.normalizeTranscript({
      ok: true,
      source: "/Users/e/.claude/projects/x/3de6d691.jsonl",
      truncated: true,
      lines: [
        { at: "2026-07-28T09:12:03.114Z", role: "assistant", text: "pushed the branch" },
        { at: "not-a-date", role: "wizard", text: "odd role and odd time" },
        { at: null, role: "tool", text: "" },
        { role: "user", text: { nope: 1 } },      // non-string text is dropped…
        null,                                     // …as is a non-object row
      ],
    });
    expect(view.source).toBe("/Users/e/.claude/projects/x/3de6d691.jsonl");
    expect(view.truncated).toBe(true);
    expect(view.lines).toHaveLength(3);
    expect(view.lines[1].role).toBe("unknown");   // unknown role collapses, not passed through
    expect(view.lines[1].at).toBeNull();          // an unparseable time becomes absent
    expect(view.lines[2].text).toBe("");          // an empty turn is still a turn
    // An honest empty answer stays empty — source null, zero lines, no filler.
    const empty = M.normalizeTranscript({ ok: true, source: null, truncated: false, lines: [] });
    expect(empty).toEqual({ source: null, truncated: false, lines: [] });
    expect(M.normalizeTranscript({ ok: true }).lines).toEqual([]);
  });

  test("(2) a very long transcript is windowed, and says how much it is hiding", () => {
    const many = Array.from({ length: 1000 }, (_, i) => ({ at: null, role: "assistant", text: "turn " + i }));
    const win = M.transcriptWindow(many);
    expect(win.shown).toHaveLength(300);          // the cap — never 1000 nodes
    expect(win.hidden).toBe(700);
    expect(win.total).toBe(1000);
    expect(win.shown[299].text).toBe("turn 999"); // the window is the TAIL
    // Under the cap nothing is hidden and nothing is copied away.
    const few = many.slice(0, 12);
    expect(M.transcriptWindow(few)).toEqual({ shown: few, hidden: 0, total: 12 });
  });

  test("(2) untrusted transcript text reaches the DOM as text, never as markup", () => {
    const hostile = "<img src=x onerror=alert(1)> & <script>steal()</script>";
    const a = agent();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const feed: any = withDom(() => M.renderChatFeedBody(a, transcriptUi({
      agentId: a.id,
      data: { source: "/tmp/t.jsonl", truncated: false, lines: [{ at: null, role: "assistant", text: hostile }] },
    })));
    const body = byClass(feed, "chat-msg-body");
    // el({ text }) assigns textContent. If it ever became an attribute or markup
    // assignment, the string would not be the node's own textContent.
    expect(body.textContent).toBe(hostile);
    expect(body.children).toHaveLength(0);
    expect(body.attributes.text).toBeUndefined();
  });

  test("(2) bubbles: roles, meta, quiet rows, TL;DR and sender marks keep their semantics", () => {
    /* Same envelope fixture style as the attribution tests below (~:12284):
       senderClaimText reads lastUserMessage, so the claimed line must equal it
       for the verdict to attach — the mark belongs to the ONE text the server
       actually checked, never to every headed turn. */
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
    expect(bubbles).toHaveLength(2); // user + assistant speak; tool/system stay rows
    const user = bubbles[0];
    expect(user.dataset.role).toBe("user");
    // The envelope: stripped from the prose, resolved into the meta line.
    expect(textOf(byClass(user, "chat-msg-body"))).toBe("board is green");
    expect(textOf(byClass(user, "chat-msg-meta"))).toContain("0runX");
    expect(byClass(user, "sender-unconfirmed")).not.toBeNull();
    // Relative time renders for a stamped line, and only for a stamped line.
    expect(byClass(user, "chat-msg-at")).not.toBeNull();
    expect(byClass(bubbles[1], "chat-msg-at")).toBeNull();
    // The [TL;DR] heartbeat is an assistant bubble like any other turn.
    expect(bubbles[1].dataset.role).toBe("assistant");
    expect(textOf(bubbles[1])).toContain("[TL;DR]");
    // The verdict belongs to ONE turn — the assistant bubble is unmarked.
    expect(byClass(bubbles[1], "sender-unconfirmed")).toBeNull();
    // Tool output gets its own expandable activity card; system remains a
    // quiet standalone row so a warning can never be swallowed by the timeline.
    expect(allByClass(body, "chat-tool-card")).toHaveLength(1);
    expect(allByClass(body, "tr-line").map((n: any) => n.dataset.role)).toEqual(["system"]);
    /* The iMessage discriminator, pinned at the stylesheet: the operator's
       sends are the FILLED slate bubbles (white ink), the agent's the white
       bordered cards — fill vs outline, never two near-identical grays. */
    expect(styles).toMatch(/\.chat-msg\[data-role="user"\] \{[^}]*background: var\(--slate\)/);
    expect(styles).toMatch(/\.chat-msg\[data-role="user"\] \.chat-msg-body \{[^}]*color: var\(--color-text-on-inverse\)/);
    expect(styles).toMatch(/\n\.chat-msg \{[^}]*background: var\(--raise\)/);
  });

  test("(2) consecutive speech and tools group without swallowing system warnings", () => {
    const a = agent();
    const at = "2026-08-09T12:00:00.000Z";
    const lines = [
      { at, role: "assistant", text: "First answer" },
      { at, role: "assistant", text: "Second answer" },
      { at, role: "tool", text: "rg -n chat src/web" },
      { at, role: "tool", text: "bun test tests/web-client.test.ts\nstatus: passed\nduration: 1.4s\n591 passed" },
      { at, role: "system", text: "Warning: context compacted" },
      { at, role: "tool", text: "git diff --check\nexit code: 1\nelapsed: 450ms" },
      { at, role: "unknown", text: "provider event" },
      { at, role: "user", text: "One more thing" },
      { at, role: "user", text: "Ship it" },
    ];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const body: any = withDom(() => M.renderChatFeedBody(a, transcriptUi({
      agentId: a.id, data: { source: "/tmp/t.jsonl", truncated: false, lines },
    })));

    const speech = allByClass(body, "chat-msg");
    expect(speech).toHaveLength(2);
    expect(allByClass(speech[0], "chat-msg-role")).toHaveLength(1);
    expect(allByClass(speech[0], "chat-msg-body")).toHaveLength(2);
    expect(allByClass(speech[1], "chat-msg-role")).toHaveLength(1);
    expect(allByClass(speech[1], "chat-msg-body")).toHaveLength(2);

    const toolGroups = allByClass(body, "chat-tool-group");
    expect(toolGroups).toHaveLength(2);
    expect(toolGroups.every((node: any) => node.tagName === "section")).toBe(true);
    expect(textOf(byClass(toolGroups[0], "chat-tool-group-head"))).toContain("Tool activity2");
    expect(textOf(byClass(toolGroups[1], "chat-tool-group-head"))).toContain("Tool activity1");
    const cards = allByClass(body, "chat-tool-card");
    expect(cards).toHaveLength(3);
    expect(cards.every((node: any) => node.tagName === "details")).toBe(true);
    expect(textOf(byClass(cards[0], "chat-tool-title"))).toBe("rg -n chat src/web");
    // The plain command has no result metadata, so the UI invents no verdict or duration.
    expect(byClass(cards[0], "chat-tool-status")).toBeNull();
    expect(byClass(cards[0], "chat-tool-duration")).toBeNull();
    expect(textOf(byClass(cards[1], "chat-tool-status"))).toBe("Passed");
    expect(textOf(byClass(cards[1], "chat-tool-duration"))).toBe("1.4s");
    expect(cards[1].dataset.status).toBe("good");
    expect(textOf(byClass(cards[2], "chat-tool-status"))).toBe("Failed");
    expect(textOf(byClass(cards[2], "chat-tool-duration"))).toBe("450ms");
    expect(cards[2].dataset.status).toBe("bad");
    const raw = byClass(cards[1], "chat-tool-output");
    expect(raw.tagName).toBe("div");
    expect(textOf(raw)).toContain("status: passed\nduration: 1.4s\n591 passed");

    const system = allByClass(body, "tr-line").find((node: any) => node.dataset.role === "system");
    expect(system?.parent).toBe(body);
    const event = allByClass(body, "tr-line").find((node: any) => node.dataset.role === "unknown");
    expect(textOf(byClass(event, "tr-role"))).toBe("Event");
    const times = findAll(body, (node: any) => node.tagName === "time");
    expect(times.length).toBeGreaterThan(0);
    expect(times.every((node: any) => node.attributes.datetime === at)).toBe(true);
  });

  test("(2) entry motion runs once for new transcript data, not on every dashboard repaint", () => {
    const a = agent();
    const data = {
      source: "/tmp/t.jsonl",
      truncated: false,
      lines: [{ at: null, role: "assistant", text: "New answer" }],
    };
    const ui = transcriptUi({ agentId: a.id, data });
    const first = withDom(() => M.renderChatFeedBody(a, ui));
    const repaint = withDom(() => M.renderChatFeedBody(a, ui));
    expect(byClass(first, "chat-entry")).not.toBeNull();
    expect(byClass(repaint, "chat-entry")).toBeNull();

    const refreshed = withDom(() => M.renderChatFeedBody(a, transcriptUi({
      agentId: a.id,
      data: { ...data, lines: [...data.lines, { at: null, role: "assistant", text: "Follow-up" }] },
    })));
    expect(byClass(refreshed, "chat-entry")).not.toBeNull();
  });

  test("(2) opening an agent drawer auto-loads its transcript, without re-fetch churn", () => {
    /* An agent not yet held -> fetch. The SAME agent already held — loaded,
       loading, OR errored, the agentId matches in all three — -> no fetch, so
       a background reopen never hammers the route and a failed load retries
       only through the feed's own Try again action. */
    expect(M.shouldAutoLoadTranscript({ kind: "agent", id: "codex:a1" }, {})).toBe(true);
    expect(M.shouldAutoLoadTranscript({ kind: "agent", id: "codex:a1" }, { agentId: "codex:a2" })).toBe(true);
    expect(M.shouldAutoLoadTranscript({ kind: "agent", id: "codex:a1" }, { agentId: "codex:a1", loading: true })).toBe(false);
    expect(M.shouldAutoLoadTranscript({ kind: "agent", id: "codex:a1" }, { agentId: "codex:a1", error: "x" })).toBe(false);
    // Non-agent drawers have no transcript to load.
    expect(M.shouldAutoLoadTranscript({ kind: "program", id: "p" }, {})).toBe(false);
    expect(M.shouldAutoLoadTranscript(null, {})).toBe(false);
  });

  test("(2) scroll ownership: the document scrolls; only the feed and the true-modal sheet lock alone", () => {
    /* Layout cannot be measured in this DOM-less harness, so the contract is
       pinned at the stylesheet, on the exact rules whose removal reproduced
       the defect (measured 2026-08-09 at 1440x900): a definite-height body
       with its overflow clipped divided ONE viewport between the masthead and
       the cockpit, and every widget the masthead gained was taken from the
       board — ending at a 28px chat viewport holding 1,436px of turns. */
    const bodyRule = requiredSlice(styles, /\nbody \{[^}]*\}/, "body");
    // The document is the scroller: viewport height is a FLOOR, never a ceiling.
    expect(bodyRule).toContain("min-height: 100dvh");
    expect(bodyRule).not.toMatch(/[^-]height: 100d?vh/);
    expect(bodyRule).not.toMatch(/overflow-y\s*:/);
    // The stage sizes to its content — no leftover-space cap to crush the cockpit.
    expect(requiredSlice(styles, /\n\.ops-stage \{[^}]*\}/, ".ops-stage")).not.toContain("max-height");
    // A document scroll lock survives in exactly ONE place: under the true
    // modal — the ≤1024px full-sheet inspector.
    const locks = styles.match(/[^\n{}]*\{[^}]*overflow-y: clip[^}]*\}/g) ?? [];
    expect(locks).toHaveLength(1);
    expect(locks[0]).toContain("body.inspector-open");
    // The feed stays the drawer's one deliberate inner scroller; its desktop
    // height contract (content-sized up to a hard cap) has its own test below.
    expect(styles).toMatch(/\.drawer-chat-scroll \{[^}]*overflow-y: auto/);
    /* The sticky-head path. position:sticky pins against the nearest SCROLL
       CONTAINER, and an overflow that never actually scrolls still is one — so
       a stray overflow on the stage or the roster silently turns the pinned
       head stack static. The stage clips its rounded corners with `clip`
       (identical paint, no scroll container); the roster declares no vertical
       overflow at all, and the heads fall through to the document. */
    expect(requiredSlice(styles, /\n\.ops-stage \{[^}]*\}/, ".ops-stage")).toContain("overflow: clip");
    expect(requiredSlice(styles, /\n\.pane-list \{[^}]*\}/, ".pane-list")).not.toMatch(/overflow-y\s*:/);
  });

  test("(2) Conversation and Evidence consume one bounded content region", () => {
    /* The pane, not the desk's intrinsic content, owns height. Wide inspectors
       use one bounded row; narrow inspectors switch between two in-flow regions
       without taking permanent transcript height. The document itself
       stays in flow, so the old absolute parity feedback loop stays retired. */
    const shell = requiredSlice(styles, /\.pane-inspector\.dw-agent \{[^}]*\}/, ".pane-inspector.dw-agent");
    expect(shell).toContain("grid-template-rows: auto minmax(0, 1fr)");
    expect(shell).toContain("overflow: hidden");
    expect(styles).not.toMatch(/\.drawer-grid \.drawer-doc \{[^}]*position: absolute/);
    const doc = requiredSlice(styles, /\n\.drawer-doc \{[^}]*\}/, ".drawer-doc");
    expect(doc).toContain("grid-template-rows: minmax(0, 1fr)");
    expect(doc).toContain("overflow: hidden");
    expect(styles).toMatch(/@container agent-drawer \(min-width: 46rem\) \{[\s\S]*?\.drawer-grid \.drawer-desk \{[^}]*grid-column: 2 \/ 3/);
    expect(styles).toMatch(/\n\.drawer-desk \{[^}]*overflow-y: auto/);
    expect(styles).not.toMatch(/\.drawer-chat-scroll \{[^}]*max-height/);
    const feedBase = requiredSlice(styles, /\n\.drawer-chat-scroll \{[^}]*\}/, ".drawer-chat-scroll");
    // Keep 16rem as the preferred feed size, but allow it to shrink so the
    // transcript footer and command dock remain inside the clipped chat box.
    expect(feedBase).toContain("flex: 1 1 16rem");
    expect(feedBase).toMatch(/min-height:\s*0/);
    expect(feedBase).toContain("overflow-y: auto");
    expect(styles).not.toMatch(/\.drawer-chat \{[^}]*height: 68vh/);
  });

  test("role stays in the command header while provider task stays in Conversation", () => {
    const selected = agent({ task: "Ship the thing", role: "orchestrator" });
    const program = { id: "p", name: "P", agents: [selected] };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const drawer: any = withDom(() => {
      const pane = newNode("div");
      M.renderAgentDrawer(pane, { kind: "agent", agent: selected, program });
      return pane;
    });
    expect(byClass(drawer, "drawer-role-badge")).toBeNull();
    const header = byClass(drawer, "drawer-session-header");
    expect(textOf(byClass(header, "drawer-session-eyebrow"))).toContain("Orchestrator");
    expect(byClass(header, "drawer-task-summary")).toBeNull();
    expect(textOf(header)).not.toContain("Ship the thing");
    expect(textOf(byClass(drawer, "drawer-chat-scroll"))).toContain("Ship the thing");
    expect(byClass(drawer, "evidence-role")).toBeNull();
    const bare = agent({ task: "", role: "orchestrator" });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const bareDrawer: any = withDom(() => {
      const pane = newNode("div");
      M.renderAgentDrawer(pane, { kind: "agent", agent: bare, program: { id: "p", name: "P", agents: [bare] } });
      return pane;
    });
    expect(byClass(bareDrawer, "drawer-task-summary")).toBeNull();
    expect(byClass(bareDrawer, "drawer-role-badge")).toBeNull();
  });

  test("the retired Task widget leaves no DOM, parser, or style contract", () => {
    expect(source).not.toContain("parseTaskEnvelope");
    expect(source).not.toContain("drawer-task-summary");
    expect(source).not.toContain("drawer-task-brief");
    expect(styles).not.toContain("drawer-task-summary");
    expect(styles).not.toContain("drawer-task-brief");
    expect(html).not.toContain("Full brief");
  });

  test("RHSP-B: chat feed owns the document column; one transcript chrome surface", () => {
    /* Live defect 2026-08-09: with a short preview (1–2 turns) the flex chain
       let .drawer-chat-scroll shrink to content (~sliver) while the pane showed
       dead space. The feed keeps a 16rem preferred basis and can shrink; the old
       expandable "Transcript — …" details shell must not return beside it. */
    const feedRule = requiredSlice(styles, /\n\.drawer-chat-scroll \{[^}]*\}/, ".drawer-chat-scroll");
    expect(feedRule).toMatch(/min-height:\s*0/);
    expect(feedRule).toContain("flex: 1 1 16rem");
    expect(styles).toMatch(/\.drawer-chat \{[^}]*grid-template-rows: minmax\(0, 1fr\) auto/);
    // Dead expandable transcript chrome stays gone.
    expect(styles).not.toMatch(/\.drawer-transcript\b/);
    expect(source).not.toMatch(/drawer-transcript/);
    expect(source).not.toMatch(/Transcript — /);
    expect(styles).not.toContain(".chat-feed-foot");
    expect(source).not.toContain("renderTranscriptFoot");
    expect(styles).toMatch(/\.chat-feed-lead\s*\{[^}]*align-self:\s*flex-start/);
    expect(styles).toMatch(/\.transcript-inline-action\s*\{[^}]*text-decoration:\s*underline/);

    const short = agent({
      lastAgentMessage: "One short reply.",
      lastUserMessage: "",
      task: "Ship the feed height fix.",
      transcriptTail: "One short reply.",
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const drawer: any = withDom(() => {
      const pane = newNode("div");
      M.renderAgentDrawer(pane, { kind: "agent", agent: short, program: { id: "p", name: "P", agents: [short] } });
      return pane;
    });
    expect(byClass(drawer, "drawer-transcript")).toBeNull();
    expect(byClass(drawer, "drawer-chat-scroll")).not.toBeNull();
    // Conversation contains no duplicate Task or Transcript chrome.
    const doc = byClass(drawer, "drawer-doc");
    const titles = findAll(doc, (n: any) => n.className && String(n.className).split(/\s+/).includes("section-title"))
      .map((n: any) => textOf(n).replace(/\s+/g, " ").trim());
    expect(titles.filter((t: string) => /task/i.test(t))).toHaveLength(0);
    expect(titles.filter((t: string) => /transcript/i.test(t))).toHaveLength(0);
    expect(allByClass(drawer, "drawer-task-objective")).toHaveLength(0);
    expect(textOf(byClass(drawer, "drawer-chat-scroll"))).toContain("Ship the feed height fix");
  });

  test("RHSP-A: a turn-less cursor drawer still paints a quiet feed and dock", () => {
    /* Live defect 2026-08-09: unique-cwd Cursor rows publish controlState
       "linked" while Send is disabled. quarantineBrief(linked) is null, and
       renderControlBanner read .title off it — the drawer died after the head
       (blank pane: no Task, no feed, no dock). */
    const cursor = agent({
      id: "cursor:aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      provider: "cursor",
      sourceSessionId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      displayName: "Cursor lane",
      controlState: "linked",
      task: "",
      transcriptTail: undefined,
      lastUserMessage: undefined,
      lastAgentMessage: undefined,
      lastHumanMessage: undefined,
      humanMessages: undefined,
      target: {
        surfaceId: "SURFACE-CURSOR",
        workspaceTitle: "ANT · cursor-lane",
        resolution: "unique-cwd",
        surfaceCwd: "/tmp/cursor-lane",
      },
      controls: [
        { action: "focus", enabled: true },
        { action: "instruct", enabled: false, reason: "Matched by working directory alone." },
        { action: "interrupt", enabled: false, reason: "Matched by working directory alone." },
        { action: "archive", enabled: true },
      ],
    });
    const program = { id: "p", name: "P", agents: [cursor] };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const drawer: any = withDom(() => {
      const pane = newNode("div");
      M.renderAgentDrawer(pane, { kind: "agent", agent: cursor, program });
      return pane;
    });
    expect(byClass(drawer, "drawer-task-summary")).toBeNull();
    expect(byClass(drawer, "drawer-chat")).not.toBeNull();
    expect(byClass(drawer, "drawer-controls-strip")).not.toBeNull();
    expect(textOf(byClass(drawer, "drawer-chat-scroll"))).toContain(
      "No readable turns recorded for this session yet",
    );
    expect(byClass(drawer, "chat-feed-foot")).toBeNull();
    // Banner must not throw; it should explain the unproven cwd match instead.
    expect(byClass(drawer, "control-banner")).not.toBeNull();
    expect(textOf(drawer)).toMatch(/Send is off|cannot confirm/i);
  });

  test("(2) the drawer is a definite sticky viewport instrument", () => {
    const dock = requiredSlice(styles, /@media \(min-width: 1025px\) \{[\s\S]*?\n\}\n/, "≥1025 dock block");
    const app = requiredSlice(dock, /body\.inspector-open \.app-body \{[^}]*\}/, "docked .app-body");
    const stage = requiredSlice(dock, /body\.inspector-open \.ops-stage \{[^}]*\}/, "docked .ops-stage");
    const insp = requiredSlice(dock, /body\.inspector-open \.pane-inspector \{[^}]*\}/, "docked .pane-inspector");
    expect(app).toContain("grid-template-columns: clamp(380px, 40%, 760px) minmax(0, 1fr)");
    expect(app).toContain("align-items: stretch");
    expect(stage).toContain("align-self: stretch");
    expect(insp).toContain("position: sticky");
    expect(insp).toContain("align-self: flex-start");
    expect(insp).toContain("height: calc(100dvh - 2.5rem)");
    expect(styles).toMatch(/@media \(min-width: 1025px\) and \(min-height: 800px\) \{[\s\S]*?body\.inspector-open \.app-body\s*\{[^}]*padding-bottom:\s*1\.25rem/);
    expect(styles).toMatch(/@media \(min-width: 1025px\) and \(min-height: 800px\) \{[\s\S]*?height:\s*calc\(100dvh - var\(--inspector-visible-top, 1\.25rem\) - 1\.25rem\)/);
    expect(insp).not.toContain("position: absolute");
    expect(styles).toMatch(/\.pane-inspector\.dw-agent > \.drawer-grid \{[^}]*min-height: 0/);
    /* Closed quiet board stays content-sized; only the open desktop grid stretches. */
    expect(requiredSlice(styles, /\n\.app-body \{[^}]*\}/, ".app-body")).toContain("align-items: flex-start");
  });

  test("RHSP-C: sticky placement follows its visible top without content-height feedback", () => {
    const dock = requiredSlice(styles, /@media \(min-width: 1025px\) \{[\s\S]*?\n\}\n/, "≥1025 dock block");
    const insp = requiredSlice(dock, /body\.inspector-open \.pane-inspector \{[^}]*\}/, "docked .pane-inspector");
    expect(insp).toContain("position: sticky");
    expect(insp).toMatch(/top:\s*1\.25rem/);
    expect(insp).toMatch(/height:\s*calc\(100dvh - 2\.5rem\)/);
    expect(styles).not.toContain("--drawer-float-top");
    expect(source).not.toContain("drawerFloatTopPx");
    expect(source).not.toContain("syncDrawerFloat");
    expect(source).not.toContain("ResizeObserver");
    expect(source).toContain("function syncInspectorViewportHeight");
    expect(source).toContain("pane.getBoundingClientRect().top");
    expect(source).toContain('window.addEventListener("scroll", scheduleInspectorViewportHeight, { passive: true })');
    expect(source).not.toContain("getBoundingClientRect().top + window.scrollY");
    expect(source).not.toMatch(/syncInspectorViewportHeight[\s\S]{0,1200}(scrollHeight|offsetHeight|clientHeight)/);
  });

  test("(2) the feed opens at the newest turn, then resumes where the operator left it", () => {
    /* Leave-aware scroll memory (operator directive): leaving the widget —
       pointer out, focus out, switching or closing the drawer — commits the
       position per agent; reopening resumes it; the first open pins to the
       newest turn; the live-repaint memo still wins mid-read. */
    const saved = new Map();
    const cold = { key: "", top: 0, atBottom: true };
    // First open: nothing saved — the newest turn.
    expect(M.chatScrollPlan("codex:a1", "chat:codex:a1", cold, saved)).toEqual({ mode: "bottom" });
    // Leaving mid-history commits the place…
    M.saveChatScrollFrom({ scrollHeight: 4000, scrollTop: 1200, clientHeight: 400 }, "codex:a1", saved);
    expect(saved.get("codex:a1")).toBe(1200);
    // …and a reopen resumes it — for THAT agent only.
    expect(M.chatScrollPlan("codex:a1", "chat:codex:a1", cold, saved)).toEqual({ mode: "saved", top: 1200 });
    expect(M.chatScrollPlan("codex:b2", "chat:codex:b2", cold, saved)).toEqual({ mode: "bottom" });
    // A live repaint mid-read keeps the operator's CURRENT place, not the save…
    expect(M.chatScrollPlan("codex:a1", "chat:codex:a1", { key: "chat:codex:a1", top: 2000, atBottom: false }, saved))
      .toEqual({ mode: "memo", top: 2000 });
    // …and watching at the bottom beats a stale save on repaint.
    expect(M.chatScrollPlan("codex:a1", "chat:codex:a1", { key: "chat:codex:a1", top: 3600, atBottom: true }, saved))
      .toEqual({ mode: "bottom" });
    // Leaving at the bottom clears the save: "follow the newest" is a
    // contract, not a coordinate.
    M.saveChatScrollFrom({ scrollHeight: 4000, scrollTop: 3600, clientHeight: 400 }, "codex:a1", saved);
    expect(saved.has("codex:a1")).toBe(false);
  });

  test("(2) the feed owns scroll and exposes Jump to latest at narrow widths", async () => {
    const a = agent();
    const previousWindow = G.window;
    G.window = { matchMedia: () => ({ matches: false }) };
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pane: any = withDom(() => {
        const node = newNode("aside");
        M.renderAgentDrawer(node, { kind: "agent", agent: a, program: { id: "p", name: "P", agents: [a] } });
        return node;
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const feed: any = byClass(pane, "drawer-chat-scroll");
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const jump: any = byClass(pane, "chat-jump-latest");
      expect(typeof feed.onscroll).toBe("function");
      expect(jump).not.toBeNull();

      feed.scrollHeight = 1000;
      feed.clientHeight = 300;
      feed.scrollTop = 200;
      feed.onscroll();
      expect(jump.hidden).toBe(false);

      await fire(jump);
      expect(feed.scrollTop).toBe(1000);
      expect(jump.hidden).toBe(true);
    } finally {
      if (previousWindow === undefined) delete G.window;
      else G.window = previousWindow;
    }
  });

  test("(2) static message prose is not added to the keyboard tab order", () => {
    const a = agent({ lastAgentMessage: "Done", lastUserMessage: "Go" });
    const preview = withDom(() => M.renderChat(a));
    const transcript = withDom(() => M.chatBubbleNode({ at: null, role: "assistant", text: "Done" }, a));
    for (const node of [...allByClass(preview, "chat-turn-body"), ...allByClass(transcript, "chat-msg-body")]) {
      expect(node.hasAttribute("tabindex")).toBe(false);
    }
    expect(source).not.toMatch(/class:\s*"tr-text",\s*tabindex/);
  });

  test("(2) the deprecated transcript footer never consumes chat height", () => {
    /* Count and source path already live in Evidence, while the feed refreshes
       automatically. Only the manual older-history action belongs here, as a
       quiet link at the start of the scroll region. */
    const a = agent();
    const pane = newNode("div");
    withState(transcriptUi({
      agentId: a.id,
      limit: 200,
      data: {
        source: "/tmp/t.jsonl",
        truncated: true,
        lines: [{ at: null, role: "assistant", text: "latest" }],
      },
    }), () => withDom(() => M.renderAgentDrawer(
      pane,
      { kind: "agent", agent: a, program: { id: "p", name: "P", agents: [a] } },
    )));
    const scroll = byClass(pane, "drawer-chat-scroll");
    expect(byClass(pane, "chat-feed-foot")).toBeNull();
    expect(byFkey(scroll, "transcript-more:" + a.id)).not.toBeNull();
    expect(textOf(scroll)).not.toContain("/tmp/t.jsonl");
    expect(textOf(scroll)).not.toContain("Refresh");
  });

  test("(2) essential transcript state and actions live inside the feed", () => {
    const a = agent();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const lead = (over: Record<string, unknown>): any =>
      withDom(() => M.renderTranscriptFeedLead(a, transcriptUi(over)));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const body = (over: Record<string, unknown>): any =>
      withDom(() => M.renderChatFeedBody(a, transcriptUi(over)));

    // Selection auto-loads the transcript, so an unloaded feed adds no chrome
    // and falls back to the preview thread rather than inventing a turn.
    expect(lead({})).toBeNull();
    expect(allByClass(body({}), "chat-msg")).toHaveLength(0);

    // Loading: a stated status, and loadTranscript always settles into data or
    // an error, so this is never an endless spinner.
    expect(textOf(lead({ agentId: a.id, loading: true }))).toContain("Reading the transcript");

    // Failed: the reason, plus a way out.
    const failed = lead({ agentId: a.id, error: "Transcript view is not available in this build." });
    expect(textOf(failed)).toContain("not available in this build");
    expect(buttonsOf(failed).map((b: { dataset: { fkey: string } }) => b.dataset.fkey)).toEqual(["transcript-retry:codex:a1"]);
    expect(buttonsOf(failed)[0].classList.contains("transcript-inline-action")).toBe(true);

    // Empty: honest about which kind of empty it is, and never invents a turn.
    const noFile = lead({ agentId: a.id, data: { source: null, truncated: false, lines: [] } });
    expect(textOf(noFile)).toContain("No transcript file is recorded");
    expect(allByClass(body({ agentId: a.id, data: { source: null, truncated: false, lines: [] } }), "chat-msg")).toHaveLength(0);
    const emptyFile = lead({ agentId: a.id, data: { source: "/tmp/t.jsonl", truncated: false, lines: [] } });
    expect(textOf(emptyFile)).toContain("no readable turns");

    // Loaded: bubbles are capped at the render window. Source and turn count
    // belong to Evidence, and auto-refresh makes a Refresh button redundant;
    // only a real manual action (loading more truncated history) earns a lead.
    const lines = Array.from({ length: 400 }, (_, i) => ({ at: null, role: "assistant", text: "turn " + i }));
    const over = { agentId: a.id, limit: 500, data: { source: "/tmp/t.jsonl", truncated: true, lines } };
    const grouped = body(over);
    expect(allByClass(grouped, "chat-msg")).toHaveLength(1);
    expect(allByClass(grouped, "chat-msg-body")).toHaveLength(300);
    const loaded = lead(over);
    expect(textOf(loaded)).not.toContain("Last 300 of 400");
    expect(textOf(loaded)).not.toContain("/tmp/t.jsonl");
    expect(loaded.classList.contains("chat-feed-lead")).toBe(true);
    const keys = buttonsOf(loaded).map((b: { dataset: { fkey: string } }) => b.dataset.fkey);
    expect(keys).toEqual(["transcript-more:codex:a1"]);
    expect(buttonsOf(loaded)[0].classList.contains("transcript-inline-action")).toBe(true);
    // At the ceiling there is no manual action, so there is no lead at all.
    expect(lead({ ...over, limit: 1000 })).toBeNull();
  });

  test("exceptional chat states have intentional icons without changing their truth", () => {
    const a = agent();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const lead = (over: Record<string, unknown>): any =>
      withDom(() => M.renderTranscriptFeedLead(a, transcriptUi(over)));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const body = (over: Record<string, unknown>): any =>
      withDom(() => M.renderChatFeedBody(a, transcriptUi(over)));

    const loading = lead({ agentId: a.id, loading: true });
    expect(loading.dataset.state).toBe("loading");
    expect(byClass(loading, "chat-feed-state-mark")?.children[0]?.tagName).toBe("svg");
    expect(textOf(loading)).toContain("Reading the transcript");
    expect(textOf(loading)).toContain("Loading the recorded turns");

    const unavailable = lead({ agentId: a.id, error: "Transcript view is not available in this build." });
    expect(unavailable.dataset.state).toBe("unavailable");
    expect(textOf(unavailable)).toContain("Transcript unavailable");
    expect(textOf(unavailable)).toContain("not available in this build");
    expect(byFkey(unavailable, "transcript-retry:" + a.id)).not.toBeNull();

    const noFile = lead({ agentId: a.id, data: { source: null, truncated: false, lines: [] } });
    const emptyFile = lead({ agentId: a.id, data: { source: "/tmp/t.jsonl", truncated: false, lines: [] } });
    expect(noFile.dataset.state).toBe("empty");
    expect(textOf(noFile)).toContain("No transcript recorded");
    expect(textOf(noFile)).toContain("No transcript file is recorded");
    expect(textOf(emptyFile)).toContain("No readable turns");
    expect(textOf(emptyFile)).toContain("file is present");
    expect(allByClass(body({ agentId: a.id, loading: true }), "chat-feed-state")).toHaveLength(0);
    expect(allByClass(body({ agentId: a.id, data: { source: null, truncated: false, lines: [] } }), "chat-feed-state")).toHaveLength(0);
  });

  test("a stale or unavailable feed is called out inside chat from the existing trust verdict", async () => {
    const a = agent();
    const program = { id: "p", name: "P", agents: [a] };
    const render = () => withDom(() => {
      const pane = newNode("div");
      M.renderAgentDrawer(pane, { kind: "agent", agent: a, program });
      return pane;
    });

    await withState({ conn: "stale", snap: snapshot({ generatedAt: new Date(Date.now() - 120_000).toISOString() }) }, () => {
      const card = allByClass(render(), "chat-feed-state").find((node: any) => node.dataset.state === "stale");
      expect(card).not.toBeNull();
      expect(textOf(card)).toContain("Feed frozen");
      expect(textOf(card)).toContain("Controls are held");
    });

    await withState({ conn: "offline", snap: snapshot() }, () => {
      const card = allByClass(render(), "chat-feed-state").find((node: any) => node.dataset.state === "unavailable");
      expect(card).not.toBeNull();
      expect(textOf(card)).toContain("Server unreachable");
      expect(textOf(card)).toContain("this board is not updating");
    });
  });

  test("(2) another agent's transcript never bleeds into this drawer", () => {
    const a = agent();
    const other = {
      agentId: "claude:someone-else",
      data: { source: "/tmp/other.jsonl", truncated: false, lines: [{ at: null, role: "assistant", text: "NOT MINE" }] },
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const body: any = withDom(() => M.renderChatFeedBody(a, transcriptUi(other)));
    expect(textOf(body)).not.toContain("NOT MINE");
    expect(withDom(() => M.renderTranscriptFeedLead(a, transcriptUi(other)))).toBeNull();
  });

  test("the feed is the transcript, once — no preview bubbles or shell beside it", async () => {
    const msg = "F2 is UNLOCKED — B4 landed.";
    const selected = agent({ lastAgentMessage: msg, lastUserMessage: "go", task: "Ship the thing" });
    const program = { id: "p", name: "P", agents: [selected] };
    await withState({
      transcript: {
        agentId: selected.id, loading: false, error: "", limit: 200,
        data: {
          source: "/tmp/t.jsonl", truncated: false, lines: [
            { at: null, role: "user", text: "go" },
            { at: null, role: "assistant", text: msg },
          ],
        },
      },
    }, () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const drawer: any = withDom(() => {
        const pane = newNode("div");
        M.renderAgentDrawer(pane, { kind: "agent", agent: selected, program });
        return pane;
      });
      // The details shell and its summary are gone from the drawer.
      expect(byClass(drawer, "drawer-transcript")).toBeNull();
      expect(byClass(drawer, "transcript-view")).toBeNull();
      // With the record present the preview thread does not render beside it…
      expect(allByClass(drawer, "chat-turn-body")).toHaveLength(0);
      // …so the message text appears exactly once in the entire drawer.
      expect(textOf(drawer).split(msg).length - 1).toBe(1);
      // A fully loaded feed needs no duplicate metadata/refresh footer; the
      // pane-level composer remains independently present.
      expect(byClass(drawer, "chat-feed-foot")).toBeNull();
      expect(byClass(drawer, "drawer-controls-strip")).not.toBeNull();
    });
  });

  test("(2) transcript actions lead the scroll region, and a landed fetch repaints it", () => {
    const a = agent({ transcriptTail: "…tail" });
    const pane = newNode("div");
    withState(transcriptUi({
      agentId: a.id,
      limit: 200,
      data: {
        source: "/tmp/t.jsonl", truncated: true,
        lines: [{ at: null, role: "user", text: "latest" }],
      },
    }), () => withDom(() => M.renderAgentDrawer(
      pane,
      { kind: "agent", agent: a, program: { id: "p", name: "P", agents: [a] } },
    )));
    const scroll = byClass(pane, "drawer-chat-scroll");
    const lead = byClass(scroll, "chat-feed-lead");
    expect(scroll?.children[0]).toBe(lead);
    expect(byFkey(lead, "transcript-more:" + a.id)).not.toBeNull();
    expect(byClass(pane, "chat-feed-foot")).toBeNull();

    // Without the drawer signature tracking it, the fetched turns would sit in
    // state and never reach the screen — the exact failure mode identity had.
    const sel = { kind: "agent", id: a.id };
    const view = { kind: "agent", agent: a, program: { id: "p", name: "P", agents: [] } };
    const base = M.inspectorPaintSig(sel, view, identityUi(transcriptUi()));
    for (const [why, over] of [
      ["loading", { agentId: a.id, loading: true }],
      ["error", { agentId: a.id, error: "Transcript view is not available in this build." }],
      ["landed", { agentId: a.id, data: { source: "/tmp/t.jsonl", truncated: false, lines: [{ at: null, role: "user", text: "hi" }] } }],
      ["widened", { agentId: a.id, limit: 500 }],
    ] as [string, Record<string, unknown>][]) {
      expect(M.inspectorPaintSig(sel, view, identityUi(transcriptUi(over))), why).not.toBe(base);
    }
    // A transcript belonging to a different agent must not move this signature.
    expect(M.inspectorPaintSig(sel, view, identityUi(transcriptUi({
      agentId: "claude:other", data: { source: "/x", truncated: false, lines: [] },
    })))).toBe(base);
  });
});

describe("system infrastructure stays observable without joining dashboard presentation", () => {
  const monitor = (overrides: Record<string, unknown> = {}) => agent({
    id: "prime:ant-heartbeat-monitor",
    provider: "prime",
    sourceSessionId: "ant-heartbeat-monitor",
    sessionKind: "system",
    transcriptTail: '[TL;DR 12:34] {"v":4,"repos":[]}',
    task: "Ant Hill heartbeat monitor",
    ...overrides,
  });

  const fleet = () => {
    const now = new Date().toISOString();
    const sys = monitor({ updatedAt: now });
    const live = agent({ id: "codex:visible", updatedAt: now, task: "Ship dashboard filtering" });
    const done = agent({
      id: "claude:done", provider: "claude", status: "archived", lifecycle: "finished",
      updatedAt: now, task: "Finished user work",
    });
    const repo = { repoKey: "mountain", repoName: "the-mountain", worktreePath: "/repo", branch: "main", ephemeral: false };
    const snap = snapshot({
      totals: { ...snapshot().totals, tracked: 3, live: 2, history: 1 },
      programs: [{
        id: "repo:mountain:worktree:main", name: "the-mountain", groupPath: ["mountain", "main"],
        agents: [{ ...sys, repo }, { ...live, repo }, { ...done, repo }],
      }],
    });
    return { snap, sys, live, done };
  };

  test("one provider-neutral predicate excludes only sessionKind=system", () => {
    expect(M.dashboardVisible(monitor())).toBe(false);
    expect(M.dashboardVisible(agent({ sessionKind: "automation" }))).toBe(true);
    expect(M.dashboardVisible(agent({ sessionKind: "work" }))).toBe(true);
    expect(M.dashboardVisible(agent({ sessionKind: "unknown" }))).toBe(true);
  });

  test("presentation program copies remove system rows and preserve raw inputs", () => {
    const { snap, sys, live, done } = fleet();
    const originalPrograms = snap.programs;
    const originalAgents = snap.programs[0].agents;
    const presented = M.dashboardPrograms(snap);

    expect(presented).not.toBe(originalPrograms);
    expect(presented[0]).not.toBe(originalPrograms[0]);
    expect(presented[0].agents.map((a: { id: string }) => a.id)).toEqual([live.id, done.id]);
    expect(originalAgents.map((a: { id: string }) => a.id)).toEqual([sys.id, live.id, done.id]);
    expect(textOf(withDom(() => M.programHeadRollup(presented[0].agents)))).toBe("1live1ended1working");
  });

  test("Board, History, search, shelf, and tab counts all use the presentation population", async () => {
    const { snap, sys, live, done } = fleet();
    const base = listUi({ snap, view: "board", lookbackHours: null, showReviewWorkers: true });
    expect(M.workingSet(base).map((a: { id: string }) => a.id)).toEqual([live.id]);
    expect(M.workingSet({ ...base, view: "history" }, "history").map((a: { id: string }) => a.id)).toEqual([done.id]);

    await withState({ ...base, query: "heartbeat monitor", facetStatuses: [] }, () => {
      expect(M.currentFilter()(sys, snap.programs[0])).toBe(false);
      expect(M.shelfFilter()(monitor({ status: "archived", lifecycle: "finished" }), snap.programs[0])).toBe(false);
    });

    await withState({ ...base, query: "" }, () => withDom(() => {
      M.renderTabs();
      expect(domById.get("count-board")!.textContent).toBe("1");
      expect(domById.get("count-history")!.textContent).toBe("1");
    }));
  });

  test("lookback and stale selection cannot surface a system session", async () => {
    const old = new Date(Date.now() - 12 * 3_600_000).toISOString();
    const sys = monitor({ updatedAt: old });
    const snap = snapshot({ programs: [{ id: "p", name: "P", agents: [sys] }] });
    const ui = listUi({ snap, view: "board", lookbackHours: 6, showReviewWorkers: true });
    expect(M.hiddenByLookback(ui)).toBe(0);

    await withState({ snap, selected: { kind: "agent", id: sys.id }, selectedId: sys.id }, () => {
      expect(M.findSelected()).toBeNull();
      expect(M.resolveSelection({ kind: "program", id: "p" })).toBeNull();
    });
  });

  test("raw heartbeat and raw totals bypass the presentation filter", () => {
    const { snap, sys } = fleet();
    expect(M.heartbeatTldrAgent(snap)?.id).toBe(sys.id);
    expect(M.totalsOf(snap).tracked).toBe(3);
    expect(M.dashboardPrograms(snap).flatMap((p: { agents: unknown[] }) => p.agents)).toHaveLength(2);
  });
});

describe("the agent RHSP has one explicit header-content-footer contract", () => {
  const lockedAgent = () => agent({
    controlState: "quarantined",
    identityTrace: {
      resolution: "ambiguous",
      reason: "4 active sources share this cwd; cwd fallback requires exactly one and controls are disabled.",
      steps: [
        { tier: "recorded", outcome: "skipped", detail: "No recorded target." },
        { tier: "session", outcome: "no-match", detail: "No exact session match." },
        { tier: "cwd", outcome: "ambiguous", detail: "4 active sources share this cwd." },
      ],
    },
    controls: [
      { action: "focus", enabled: false, reason: "Shared cwd is not identity." },
      { action: "instruct", enabled: false, reason: "Shared cwd is not identity." },
      { action: "interrupt", enabled: false, reason: "Shared cwd is not identity." },
    ],
  });

  test("the static inspector is the ops-stage sibling under app-body", () => {
    expect(html).toMatch(/<\/main>\s*<\/div>\s*<aside id="inspector"[^>]*><\/aside>\s*<\/div>\s*<div id="toast"/);
  });

  test("agent DOM order is head plus bounded grid, with controls owned by chat", async () => {
    const selected = lockedAgent();
    const pane = withDom(() => {
      const node = newNode("aside");
      M.renderAgentDrawer(node, { kind: "agent", agent: selected, program: { id: "p", name: "P", agents: [selected] } });
      return node;
    });
    expect(pane.children.map((node) => node.className)).toEqual(["drawer-shell-head", "drawer-grid"]);
    const grid = byClass(pane, "drawer-grid");
    const chat = byClass(grid, "drawer-chat");
    const desk = byClass(grid, "drawer-desk");
    const dock = byClass(pane, "drawer-controls-strip");
    expect(dock?.parent).toBe(chat);
    expect(byClass(chat, "drawer-controls-strip")).toBe(dock);
    expect(byClass(chat, "chat-feed-foot")).toBeNull();
    expect(desk?.tagName).toBe("div");
    const modeSwitch = byClass(grid, "drawer-mode-switch");
    expect(modeSwitch?.attributes.role).toBe("tablist");
    expect(grid?.children[0]).toBe(modeSwitch);
    const chatTab = byFkey(modeSwitch, "drawer-mode:" + selected.id + ":chat");
    const evidenceTab = byFkey(modeSwitch, "drawer-mode:" + selected.id + ":evidence");
    expect(chatTab?.attributes["aria-selected"]).toBe("true");
    expect(evidenceTab?.attributes["aria-selected"]).toBe("false");
    let arrowPrevented = false;
    await fire(chatTab, "keydown", {
      key: "ArrowRight",
      preventDefault: () => { arrowPrevented = true; },
    });
    expect(arrowPrevented).toBe(true);
    expect(evidenceTab?.attributes["aria-selected"]).toBe("true");
    expect(evidenceTab?.attributes.tabindex).toBe("0");
    await fire(evidenceTab, "keydown", { key: "Home" });
    expect(chatTab?.attributes["aria-selected"]).toBe("true");
    expect(chatTab?.attributes.tabindex).toBe("0");
    expect(byClass(desk, "drawer-evidence-summary")).toBeNull();
    expect(byClass(desk, "drawer-evidence-head")).toBeNull();
    await fire(evidenceTab);
    expect(desk?.classList.contains("is-open")).toBe(true);
    expect(grid?.classList.contains("is-evidence")).toBe(true);
    expect(evidenceTab?.attributes["aria-selected"]).toBe("true");
    expect(chatTab?.attributes["aria-selected"]).toBe("false");
    // Live snapshot and transcript updates repaint the drawer. Evidence must
    // remain open across that replacement instead of flashing closed again.
    const repainted = withDom(() => {
      const node = newNode("aside");
      M.renderAgentDrawer(node, { kind: "agent", agent: selected, program: { id: "p", name: "P", agents: [selected] } });
      return node;
    });
    const repaintedDesk = byClass(repainted, "drawer-desk");
    expect(repaintedDesk?.classList.contains("is-open")).toBe(true);
    const repaintedSwitch = byClass(repainted, "drawer-mode-switch");
    const repaintedChatTab = byFkey(repaintedSwitch, "drawer-mode:" + selected.id + ":chat");
    expect(byFkey(repaintedSwitch, "drawer-mode:" + selected.id + ":evidence")?.attributes["aria-selected"]).toBe("true");
    await fire(repaintedChatTab);
    expect(repaintedDesk?.classList.contains("is-open")).toBe(false);
    expect(byClass(repainted, "drawer-grid")?.classList.contains("is-evidence")).toBe(false);
    expect(chat?.children).toHaveLength(2);
    expect(byClass(dock, "control-banner")).not.toBeNull();
    expect(textOf(dock)).toContain("shares its working folder");
    expect(textOf(dock)).toContain("Why?");
    expect(textOf(dock)).toContain("View Evidence");
    expect(byClass(dock, "control-banner-details")?.tagName).toBe("details");
  });

  test("View Evidence switches a narrow drawer even when identity evidence is already cached", async () => {
    const selected = lockedAgent();
    const snap = snapshot({ programs: [{ id: "p", name: "P", agents: [selected] }] });
    await withState({
      snap,
      conn: "live",
      selected: { kind: "agent", id: selected.id },
      selectedId: selected.id,
      evidenceOpen: false,
      identity: { agentId: selected.id, loading: false, error: "", data: { surfaces: [] } },
    }, () => withRequests([], async (calls) => {
      const pane = newNode("aside");
      M.renderAgentDrawer(pane, { kind: "agent", agent: selected, program: { id: "p", name: "P", agents: [selected] } });
      const evidenceLink = buttonsOf(pane).find((button) => textOf(button).includes("View Evidence"));
      expect(evidenceLink).toBeDefined();

      await fire(evidenceLink);

      expect(calls).toHaveLength(0);
      expect(M.state.evidenceOpen).toBe(true);
      const repainted = domById.get("inspector");
      expect(byClass(repainted, "drawer-grid")?.classList.contains("is-evidence")).toBe(true);
    }));
  });

  test("unavailable controls remain visible, native-disabled, and cannot dispatch", async () => {
    const selected = lockedAgent();
    const now = new Date().toISOString();
    await withState({
      conn: "live",
      snap: snapshot({ generatedAt: now, programs: [{ id: "p", name: "P", agents: [selected] }] }),
      actions: { items: [] },
      pending: new Set(), drafts: new Map(), feedback: new Map(), confirming: null,
    }, () => withRequests([], async (calls) => {
      const pane = newNode("aside");
      M.renderAgentDrawer(pane, { kind: "agent", agent: selected, program: { id: "p", name: "P", agents: [selected] } });
      const dock = byClass(pane, "drawer-controls-strip");
      const input = findAll(dock, (node: FakeNode) => node.tagName === "textarea")[0];
      const form = byClass(dock, "command-composer");
      const focus = byFkey(dock, "act:" + selected.id + ":focus");
      const interrupt = byFkey(dock, "act:" + selected.id + ":interrupt");
      const send = byFkey(dock, "act:" + selected.id + ":instruct");

      for (const control of [input, focus, interrupt, send]) expect(control.hasAttribute("disabled")).toBe(true);
      await fire(focus);
      await fire(interrupt);
      await fire(input, "keydown", { key: "Enter", metaKey: true });
      await fire(form, "submit");
      expect(calls).toHaveLength(0);
    }));
  });

  test("a linked fixture enables route actions but waits for draft text before Send", () => {
    const linked = agent({ controls: [
      { action: "focus", enabled: true },
      { action: "instruct", enabled: true },
      { action: "interrupt", enabled: true },
    ] });
    const dock = withDom(() => M.renderCommandDock(linked, "linked", null, []));
    const focus = byFkey(dock, "act:" + linked.id + ":focus");
    const interrupt = byFkey(dock, "act:" + linked.id + ":interrupt");
    const send = byFkey(dock, "act:" + linked.id + ":instruct");
    expect([focus, interrupt].every((node) => node && !node.hasAttribute("disabled"))).toBe(true);
    expect(send?.hasAttribute("disabled")).toBe(true);
  });

  test("CSS names one scroll owner per region and no content-height feedback", () => {
    const css = styles.replace(/\/\*[\s\S]*?\*\//g, "");
    expect(css).toMatch(/body\.inspector-open \.app-body\s*\{[^}]*grid-template-columns:\s*clamp\(380px, 40%, 760px\) minmax\(0, 1fr\)[^}]*align-items:\s*stretch/);
    expect(css).toMatch(/body\.inspector-open \.ops-stage\s*\{[^}]*align-self:\s*stretch/);
    expect(css).toMatch(/body\.inspector-open \.pane-inspector\s*\{[^}]*position:\s*sticky[^}]*height:\s*calc\(100dvh - 2\.5rem\)/);
    expect(css).toMatch(/@media \(min-width: 1025px\) and \(min-height: 800px\) \{[\s\S]*?height:\s*calc\(100dvh - var\(--inspector-visible-top, 1\.25rem\) - 1\.25rem\)/);
    expect(css).toMatch(/\.pane-inspector\.dw-agent\s*\{[^}]*display:\s*grid[^}]*grid-template-rows:\s*auto minmax\(0, 1fr\)[^}]*overflow:\s*hidden/);
    expect(css).toMatch(/\.pane-inspector\.dw-agent\s*\{[^}]*container:\s*agent-drawer \/ inline-size/);
    expect(css).toMatch(/\.drawer-grid\s*\{[^}]*min-height:\s*0[^}]*overflow:\s*hidden/);
    expect(css).not.toMatch(/\.drawer-grid \.drawer-doc\s*\{[^}]*position:\s*absolute/);
    expect(css).toMatch(/\.drawer-doc\s*\{[^}]*grid-template-rows:\s*minmax\(0, 1fr\)[^}]*overflow:\s*hidden/);
    expect(css).toMatch(/\.drawer-chat\s*\{[^}]*grid-template-rows:\s*minmax\(0, 1fr\) auto/);
    expect(css).toMatch(/\.drawer-chat > \.drawer-controls-strip\s*\{[^}]*border-radius:\s*0 0 var\(--radius-sm\) var\(--radius-sm\)/);
    expect(css).toMatch(/\.drawer-chat-scroll\s*\{[^}]*flex:\s*1 1 16rem[^}]*min-height:\s*0[^}]*overflow-y:\s*auto/);
    expect(css).not.toContain(".chat-feed-foot");
    expect(source).not.toContain("renderTranscriptFoot");
    expect(css).toMatch(/\.chat-feed-lead\s*\{[^}]*align-self:\s*flex-start/);
    expect(css).toMatch(/\.transcript-inline-action\s*\{[^}]*text-decoration:\s*underline/);
    expect(css).toMatch(/\.drawer-desk\s*\{[^}]*overflow-y:\s*auto/);
    expect(css).toMatch(/\.drawer-grid\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)[^}]*grid-template-rows:\s*auto minmax\(0, 1fr\)/);
    expect(css).not.toMatch(/\.drawer-grid \.drawer-desk\s*\{[^}]*position:\s*absolute/);
    expect(css).toMatch(/@container agent-drawer \(min-width: 46rem\) \{[\s\S]*?\.drawer-grid\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\) clamp\(280px, 35%, 320px\)[^}]*grid-template-rows:\s*minmax\(0, 1fr\)/);
    expect(css).toMatch(/\.drawer-controls-strip\s*\{[^}]*position:\s*static/);
    expect(css).not.toContain("--drawer-float-top");
    expect(source).not.toContain("drawerFloatTopPx");
    expect(source).not.toContain("syncDrawerFloat");
    expect(source).not.toContain("ResizeObserver");

    expect(css).toMatch(/@media \(max-width: 860px\) \{[\s\S]*?\.pane-inspector\.dw-agent > \.drawer-grid\s*\{[^}]*overflow:\s*hidden/);
    expect(css).toMatch(/@media \(max-width: 860px\) \{[\s\S]*?\.drawer-chat-scroll\s*\{[^}]*overflow-y:\s*auto/);
    expect(css).not.toMatch(/@media \(max-width: 860px\) \{[\s\S]*?\.drawer-desk\s*\{[^}]*position:\s*absolute/);
    expect(css).not.toMatch(/@media \(max-width: 860px\) \{[\s\S]*?\.drawer-chat\s*\{[^}]*height:\s*68vh/);

    const locks = css.match(/[^\n{}]*\{[^}]*overflow-y:\s*clip[^}]*\}/g) ?? [];
    expect(locks).toHaveLength(1);
    expect(locks[0]).toContain("body.inspector-open");
  });

  test("the short desktop pane reflows existing chrome to preserve a 160px transcript target", () => {
    /* The first safe shell still left only 50.266px of feed at 1357x738. The
       short-height mode keeps every explanation and control, but lets their
       existing text flow horizontally and trims spacing instead of restoring
       the 16rem hard floor that clipped the composer. */
    const css = styles.replace(/\/\*[\s\S]*?\*\//g, "");
    const dock = requiredSlice(css, /\.command-dock\s*\{[^}]*\}/, ".command-dock");
    expect(dock).toContain("padding: 0.5rem var(--inspector-pad-x) max(0.5rem, env(safe-area-inset-bottom))");
    expect(dock).toContain("gap: 0.25rem");
    const feed = requiredSlice(css, /\.drawer-chat-scroll\s*\{[^}]*\}/, ".drawer-chat-scroll");
    expect(feed).toContain("min-height: 0");
    expect(feed.match(/min-height:[^;]+/g)).toEqual(["min-height: 0"]);
    const shortDesktop = requiredSlice(
      css,
      /@media \(min-width: 1025px\) and \(max-height: 760px\) \{[\s\S]*?\n\}/,
      "short desktop drawer budget",
    );
    expect(shortDesktop).toContain(".control-banner-copy");
    expect(shortDesktop).toContain("display: flex");
    expect(shortDesktop).toContain(".control-banner-why");
    expect(shortDesktop).toContain("margin: 0");
  });

  test("mobile keeps the composer inside a bounded chat and switches Evidence in-flow", () => {
    const css = styles.replace(/\/\*[\s\S]*?\*\//g, "");
    const mobile = css.slice(css.lastIndexOf("@media (max-width: 860px)"));
    const grid = requiredSlice(mobile, /\.pane-inspector\.dw-agent > \.drawer-grid\s*\{[^}]*\}/, "mobile drawer grid");
    const doc = requiredSlice(mobile, /\.drawer-doc\s*\{[^}]*\}/, "mobile drawer document");
    const chat = requiredSlice(mobile, /\.drawer-chat\s*\{[^}]*\}/, "mobile drawer chat");
    const feed = requiredSlice(mobile, /\.drawer-chat-scroll\s*\{[^}]*\}/, "mobile chat feed");
    const desk = requiredSlice(mobile, /\.drawer-desk\s*\{[^}]*\}/, "mobile drawer desk");
    expect(grid).toContain("overflow: hidden");
    expect(doc).toContain("min-height: 0");
    expect(chat).toContain("min-height: 0");
    expect(chat).toContain("overflow: hidden");
    expect(feed).toContain("min-height: 0");
    expect(feed).toContain("overflow-y: auto");
    expect(desk).toContain("min-height: 0");
    expect(desk).toContain("overflow-y: auto");
    // Visibility belongs to the drawer-width container rules above. Repeating
    // it in this viewport query creates a 736–860px dead zone where the
    // container hides the tabs while the viewport hides Evidence.
    expect(css).toMatch(/\.drawer-grid:not\(\.is-evidence\) \.drawer-desk\s*\{[^}]*display:\s*none/);
    expect(mobile).not.toMatch(/\.drawer-grid:not\(\.is-evidence\) \.drawer-desk\s*\{[^}]*display:\s*none/);
    expect(mobile).not.toMatch(/\.drawer-grid\.is-evidence \.drawer-doc\s*\{[^}]*display:\s*none/);
  });
});

describe("RHSP follow-up keeps presentation and scroll ownership coherent", () => {
  const agentPane = (paneTop: number, gridTop: number, deskTop: number) => {
    const pane = newNode("aside") as FakeNode & { scrollTop: number };
    pane.className = "pane-inspector dw-agent";
    pane.scrollTop = paneTop;
    const grid = newNode("div") as FakeNode & { scrollTop: number };
    grid.className = "drawer-grid";
    grid.scrollTop = gridTop;
    const doc = newNode("div");
    doc.className = "drawer-doc";
    const desk = newNode("div") as FakeNode & { scrollTop: number };
    desk.className = "drawer-desk";
    desk.scrollTop = deskTop;
    grid.append(doc, desk);
    pane.append(grid);
    return { pane, grid, desk };
  };

  test("same-agent repaint restores the responsive non-transcript owner and new selections reset", () => {
    const before = agentPane(11, 41, 73);
    expect(M.captureDrawerScroll(before.pane, false)).toBe(73);
    expect(M.captureDrawerScroll(before.pane, true)).toBe(41);

    const desktopAfter = agentPane(0, 0, 0);
    M.restoreDrawerScroll(desktopAfter.pane, 73, true, false);
    expect(desktopAfter.desk.scrollTop).toBe(73);
    expect(desktopAfter.grid.scrollTop).toBe(0);
    expect(desktopAfter.pane.scrollTop).toBe(0);

    const mobileAfter = agentPane(0, 0, 0);
    M.restoreDrawerScroll(mobileAfter.pane, 41, true, true);
    expect(mobileAfter.grid.scrollTop).toBe(41);
    expect(mobileAfter.desk.scrollTop).toBe(0);
    expect(mobileAfter.pane.scrollTop).toBe(0);

    M.restoreDrawerScroll(desktopAfter.pane, 73, false, false);
    M.restoreDrawerScroll(mobileAfter.pane, 41, false, true);
    expect(desktopAfter.desk.scrollTop).toBe(0);
    expect(mobileAfter.grid.scrollTop).toBe(0);
  });

  test("non-agent drawers retain the inspector as their scroll owner", () => {
    const pane = newNode("aside") as FakeNode & { scrollTop: number };
    pane.className = "pane-inspector dw-program";
    pane.scrollTop = 29;
    expect(M.captureDrawerScroll(pane, false)).toBe(29);
    M.restoreDrawerScroll(pane, 29, true, false);
    expect(pane.scrollTop).toBe(29);
  });

  test("a system-only raw snapshot reaches the filtered dashboard empty state", async () => {
    const monitor = agent({
      id: "prime:ant-heartbeat-monitor",
      provider: "prime",
      sourceSessionId: "ant-heartbeat-monitor",
      sessionKind: "system",
    });
    const snap = snapshot({
      programs: [{ id: "infra", name: "Infrastructure", agents: [monitor] }],
      totals: { ...snapshot().totals, tracked: 1, live: 1 },
    });

    await withState({ snap, fetchFailed: false }, () => withDom(() => {
      M.renderEmpty();
      expect(domById.get("empty-state")?.hidden).toBe(false);
      expect(domById.get("empty-message")?.textContent).not.toBe("");
    }));
  });

  test("system parents and children stay out of lineage without becoming untracked", async () => {
    const systemParent = agent({
      id: "prime:system-parent",
      provider: "prime",
      sourceSessionId: "system-parent",
      sessionKind: "system",
    });
    const current = agent({ id: "codex:current", parentAgentId: systemParent.id });
    const systemChild = agent({
      id: "prime:system-child",
      provider: "prime",
      sourceSessionId: "system-child",
      sessionKind: "system",
      parentAgentId: current.id,
    });
    const visibleChild = agent({
      id: "codex:visible-child",
      sourceSessionId: "visible-child",
      displayName: "Visible child",
      parentAgentId: current.id,
    });
    const snap = snapshot({
      programs: [{ id: "p", name: "P", agents: [systemParent, current, systemChild, visibleChild] }],
    });

    await withState({ snap }, () => withDom(() => {
      const signature = M.lineagePaintSig(current, snap);
      const spine = M.renderLineageSpine(current);
      expect(signature).toContain(visibleChild.id);
      expect(signature).not.toContain(systemParent.id);
      expect(signature).not.toContain(systemChild.id);
      expect(textOf(spine)).toContain("Visible child");
      expect(textOf(spine)).not.toContain("system-parent");
      expect(textOf(spine)).not.toContain("system-child");
      expect(textOf(spine)).not.toContain("Orchestrator not tracked");
      expect(byFkey(spine, "lineage:" + systemParent.id)).toBeNull();
      expect(byFkey(spine, "lineage-kid:" + systemChild.id)).toBeNull();
    }));
  });
});

/* ---------------------------------------------------------------------------
   Finding 3: what was broadcast, to whom, and whether it landed lived only in
   client memory and died on reload. A broadcast reaches up to 50 agents and
   instruct is fire-and-forget text typed into a terminal, so the natural
   recovery after a refresh is to send it again — double-instructing lanes that
   already got it.
   ------------------------------------------------------------------------- */

function actionsUi(over: Record<string, unknown> = {}) {
  return { actions: { loading: false, error: "", available: true, items: [] as unknown[], fetchedAt: 1, ...over } };
}

const ACT = {
  delivered: { id: "act_01", at: "2026-07-28T09:12:03.114Z", kind: "instruct", agentIds: ["codex:a1"], outcome: "ok", detail: "typed and submitted" },
  staged: { id: "act_02", at: "2026-07-28T09:10:00.000Z", kind: "instruct", agentIds: ["codex:a1"], outcome: "staged", detail: "TEXT_STAGED_NOT_SUBMITTED" },
  failed: { id: "act_03", at: "2026-07-28T09:05:00.000Z", kind: "broadcast", agentIds: ["codex:a1", "claude:b", "claude:c", "claude:d"], outcome: "failed", detail: "0 of 4 recipients delivered" },
  partial: { id: "act_04", at: "2026-07-28T09:00:00.000Z", kind: "broadcast", agentIds: ["claude:b", "claude:c"], outcome: "partial", detail: "3 of 4 recipients delivered" },
};

describe("FE-C: operator actions survive a reload, failures included", () => {
  test("(3) the request is bounded and the payload is defended", () => {
    expect(M.actionsUrl()).toBe("/api/actions?limit=100");
    expect(M.actionsUrl(9999)).toBe("/api/actions?limit=500");   // the contract's hard cap
    expect(M.clampActionsLimit(0)).toBe(1);
    expect(M.clampActionsLimit("x")).toBe(100);

    const items = M.normalizeActions({
      ok: true,
      actions: [
        ACT.delivered,
        { ...ACT.staged, kind: "telepathy" },              // unknown kind: dropped
        { ...ACT.failed, id: "" },                          // no id: dropped
        { ...ACT.partial, at: "nonsense", agentIds: ["ok", 7, ""], outcome: "" },
        null,
      ],
    });
    expect(items.map((a: { id: string }) => a.id)).toEqual(["act_01", "act_04"]);
    expect(items[1].at).toBeNull();                         // unparseable time → absent
    expect(items[1].agentIds).toEqual(["ok"]);              // non-string ids dropped
    expect(items[1].outcome).toBe("unknown");               // never silently "ok"
    expect(M.normalizeActions({ ok: true }).length).toBe(0);
  });

  test("(3) every outcome the contract can return has its own word", () => {
    expect(M.actionOutcomeView("ok").label).toBe("Delivered");
    expect(M.actionOutcomeView("failed").label).toBe("Failed");
    expect(M.actionOutcomeView("partial").label).toBe("Partly delivered");
    // The one the operator most needs to see, and the reason a success-only log
    // is worse than none: text sat in a terminal and was never submitted.
    expect(M.actionOutcomeView("staged").label).toContain("not submitted");
    // The four are distinct — no two states share a word.
    const labels = ["ok", "failed", "partial", "staged"].map((o) => M.actionOutcomeView(o).label);
    expect(new Set(labels).size).toBe(4);
    // Tones separate the good from the bad, so scanning one column works.
    expect(M.actionOutcomeView("ok").tone).toBe("ok");
    expect(M.actionOutcomeView("failed").tone).toBe("err");
    // An outcome the server adds later reads as the server's own word.
    expect(M.actionOutcomeView("rejected").label).toBe("rejected");
    expect(M.actionOutcomeView(undefined).label).toBe("unknown");
  });

  /* The panel that showed these three states is gone (operator directive,
     2026-08-05), but the sentences are not decoration: loadActions still writes
     them into state.actions.error, and a build without the route must latch
     available=false rather than let the dock's "last action" crumb read as
     "nothing was ever sent to this agent". */
  test("(3) a missing route, an unreachable server and a server fault each say so", () => {
    expect(M.actionsFailureText(404, null)).toBe("The action log is not available in this build.");
    expect(M.actionsFailureText(0, null)).toContain("Could not reach the server");
    expect(M.actionsFailureText(500, { error: { code: "LOG_CORRUPT" } })).toContain("LOG_CORRUPT");
  });

  test("(3) the dock answers 'did I already send this?' next to the button that resends", () => {
    const live = agent({ controls: [{ action: "instruct", enabled: true }, { action: "focus", enabled: true }] });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const withLog: any = withDom(() => M.renderCommandDock(live, "linked", null, [ACT.staged, ACT.delivered]));
    const fact = byClass(withLog, "command-dock-last");
    expect(fact).not.toBeNull();
    // Newest-first: the staged one is the most recent, and staged is exactly the
    // case where resending blindly is the wrong move.
    expect(textOf(fact)).toContain("not submitted");
    expect(fact.dataset.tone).toBe("warn");

    // Silence before the log has loaded: an unanswered endpoint must never read
    // as "nothing was ever sent to this agent".
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const noLog: any = withDom(() => M.renderCommandDock(live, "linked", null, []));
    expect(byClass(noLog, "command-dock-last")).toBeNull();
    // An action for a different agent is not this agent's history.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const other: any = withDom(() => M.renderCommandDock(live, "linked", null, [ACT.partial]));
    expect(byClass(other, "command-dock-last")).toBeNull();
    expect(M.lastActionFor([ACT.partial], "codex:a1")).toBeNull();
    expect(M.lastActionFor([ACT.staged, ACT.delivered], "codex:a1").id).toBe("act_02");
  });

  test("(3) a new journal entry repaints the open drawer", () => {
    const a = agent();
    const sel = { kind: "agent", id: a.id };
    const view = { kind: "agent", agent: a, program: { id: "p", name: "P", agents: [] } };
    const base = M.inspectorPaintSig(sel, view, identityUi(actionsUi()));
    // A landed entry for this agent moves it…
    expect(M.inspectorPaintSig(sel, view, identityUi(actionsUi({ items: [ACT.delivered] })))).not.toBe(base);
    // …and so does the SAME entry coming back with a different outcome.
    expect(M.inspectorPaintSig(sel, view, identityUi(actionsUi({ items: [ACT.delivered] }))))
      .not.toBe(M.inspectorPaintSig(sel, view, identityUi(actionsUi({ items: [{ ...ACT.delivered, outcome: "failed" }] }))));
    // Someone else's action does not.
    expect(M.inspectorPaintSig(sel, view, identityUi(actionsUi({ items: [ACT.partial] })))).toBe(base);
  });
});

/* ---------------------------------------------------------------------------
   Finding 4: the operator had to keep the tab visible to learn an agent was
   waiting. grep for Notification / document.title / favicon / vibrate / Audio
   over app.js returned zero matches; the only attention affordances were the
   in-page beacon and the Alerts tab count.

   The firing RULE is the feature. A notifier that cries wolf gets muted, and
   then the feature is worthless — so these tests are mostly about silence.
   ------------------------------------------------------------------------- */

describe("FE-C: an agent that starts waiting reaches the operator outside the tab", () => {
  const waiting = (id: string) => agent({ id, status: "attention", outcome: "needs-you", displayName: id });
  const calm = (id: string) => agent({ id, status: "running", outcome: "healthy", displayName: id });
  const snapOf = (...agents: unknown[]) => snapshot({ programs: [{ id: "p", name: "P", agents }] });

  /* S1-T5 REWRITE. This asserted that delivery fires for the board's broad
     alerting() population — any row that is neither healthy nor finished.

     That was the defect, not the contract. alerting() is a strict SUPERSET of
     "a person is the blocker", so the OS notification woke the operator for a
     stalled advisory while the button beside it correctly stayed amber. The one
     sentence this whole surface rests on — ember only when a person is the
     blocker — broke at the exact moment the operator is not looking at the
     screen to check it. Repointed at the blocking half of the attention
     partition; the rows below are the ones that used to fire and no longer do. */
  test("(4) delivery fires for a person-blocker, not for everything unhealthy", () => {
    const asks = (id: string) => agent({
      id, displayName: id,
      attentionSignal: { kind: "question-pending", evidence: "Push, or hold for the reconciliation?" },
    });
    const snap = snapOf(
      asks("codex:1"),
      // Unhealthy, and asking nobody anything. The board still shows all three
      // as findings; none of them is a reason to interrupt a person elsewhere.
      waiting("codex:2"),
      agent({ id: "codex:3", outcome: "blocked" }),
      agent({ id: "codex:4", outcome: "failed" }),
      calm("codex:5"),
      // An ended session is not waiting for anyone, whatever it last reported.
      agent({ id: "codex:6", status: "archived", outcome: "needs-you" }),
    );
    expect(M.needsHumanIds(snap)).toEqual(["codex:1"]);
    // The watcher's own tier never delivers: nobody is blocked, so nothing may
    // interrupt someone who is not looking.
    expect(M.needsHumanIds(snapOf(agent({ id: "codex:7", attentionSignal: { kind: "stalled-active" } })))).toEqual([]);
    expect(M.needsHumanIds(snapOf(calm("codex:5")))).toEqual([]);
    expect(M.needsHumanIds(null)).toEqual([]);
    // …and it is the same set the badge counts, not a second population.
    expect(M.needsHumanIds(snap)).toEqual(M.blockingAgentIds(snap));
  });

  test("(4) an out-of-page notification never fires for a watcher-only board", () => {
    /* The plan's claim in its sharpest form: a stalled-active fleet is amber on
       the button and SILENT off it. deliverNotification is reached only through
       a plan built from needsHumanIds, so a feed with nobody blocked cannot
       produce one that fires. */
    const stalled = snapOf(
      agent({ id: "codex:1", displayName: "codex:1", attentionSignal: { kind: "stalled-active" } }),
      agent({ id: "codex:2", displayName: "codex:2", attentionSignal: { kind: "stalled-active" } }),
    );
    const plan = M.notificationPlan([], M.needsHumanIds(stalled));
    expect(plan.fire).toBe(false);
    let built = 0;
    class Spy { constructor() { built += 1; } }
    expect(M.deliverNotification(plan, { enabled: true, permission: "granted" }, Spy)).not.toBe("sent");
    expect(built).toBe(0);
    // The badge still speaks — amber, not ember, and never a zero it has not earned.
    expect(M.feedTone(M.notificationFeed(stalled, [], Date.now(), M.NOTIFY_DEPS))).toBe("noticed");
  });

  test("(4) it fires for a NEW waiter and stays silent for everything else", () => {
    // The one case worth interrupting someone for.
    const fired = M.notificationPlan(["codex:1"], ["codex:1", "codex:2"], (id: string) => "Lane " + id.slice(-1));
    expect(fired.fire).toBe(true);
    expect(fired.title).toBe("1 agent needs you");
    expect(fired.body).toBe("Lane 2");

    // Routine churn, all of which must be silent:
    expect(M.notificationPlan(["codex:1"], ["codex:1"]).fire).toBe(false);              // unchanged
    expect(M.notificationPlan(["codex:1", "codex:2"], ["codex:1"]).fire).toBe(false);   // one resolved
    expect(M.notificationPlan(["codex:1"], []).fire).toBe(false);                       // all cleared
    expect(M.notificationPlan([], []).fire).toBe(false);                                // quiet fleet
    // Same agents, different order off the wire — not news.
    expect(M.notificationPlan(["codex:1", "codex:2"], ["codex:2", "codex:1"]).fire).toBe(false);
    // A swap (one clears, one starts) IS news about the one that started.
    const swap = M.notificationPlan(["codex:1"], ["codex:2"]);
    expect(swap.fire).toBe(true);
    expect(swap.title).toBe("1 agent needs you");
  });

  test("(4) opening the page to a backlog is silent — a reload is not news", () => {
    // This is what stops the feature being unusable on a fleet of 200: the first
    // snapshot seeds the baseline, it does not announce it.
    const first = M.notificationPlan(null, ["codex:1", "codex:2", "codex:3"]);
    expect(first.fire).toBe(false);
    expect(first.reason).toBe("seeded");
    expect(first.ids).toEqual(["codex:1", "codex:2", "codex:3"]);
    // Only what arrives AFTER the baseline is announced.
    expect(M.notificationPlan(first.ids, ["codex:1", "codex:2", "codex:3"]).fire).toBe(false);
    expect(M.notificationPlan(first.ids, ["codex:1", "codex:2", "codex:3", "codex:4"]).fire).toBe(true);
  });

  test("(4) a burst names a few agents and counts the rest instead of listing 40", () => {
    const many = Array.from({ length: 40 }, (_, i) => "codex:" + i);
    const plan = M.notificationPlan([], many, (id: string) => id.toUpperCase());
    expect(plan.fire).toBe(true);
    expect(plan.title).toBe("40 agents need you");
    expect(plan.body).toBe("CODEX:0, CODEX:1, CODEX:10 and 37 more");
    // An agent the snapshot no longer names keeps its id rather than vanishing.
    expect(M.notificationPlan([], ["codex:gone"], () => null).body).toBe("codex:gone");
  });

  test("(4) delivery is gated: opted out, blocked and unsupported are all silent", () => {
    const plan = M.notificationPlan(["codex:1"], ["codex:1", "codex:2"]);
    const sent: { title: string; opts: { body: string; tag: string } }[] = [];
    class FakeNotification {
      constructor(title: string, opts: { body: string; tag: string }) { sent.push({ title, opts }); }
    }
    const granted = { enabled: true, permission: "granted" };

    expect(M.deliverNotification(plan, granted, FakeNotification)).toBe("sent");
    expect(sent).toHaveLength(1);
    expect(sent[0].title).toBe(plan.title);
    // One tag, so a second burst REPLACES the first instead of stacking a pile
    // of notifications the operator has to dismiss.
    expect(sent[0].opts.tag).toBe("anthill-needs-you");

    // Every silent path, each with its own reason — never an ambiguous no-op.
    expect(M.deliverNotification(plan, { enabled: false, permission: "granted" }, FakeNotification)).toBe("muted");
    expect(M.deliverNotification(plan, { enabled: true, permission: "denied" }, FakeNotification)).toBe("not-granted");
    expect(M.deliverNotification(plan, granted, null)).toBe("unsupported");
    expect(M.deliverNotification({ fire: false, reason: "seeded" }, granted, FakeNotification)).toBe("seeded");
    // A browser that refuses to construct one degrades, it does not throw.
    const Broken = function Broken() { throw new Error("nope"); } as unknown as new () => unknown;
    expect(M.deliverNotification(plan, granted, Broken)).toBe("refused");
    expect(sent).toHaveLength(1); // nothing else was delivered
  });

  test("(4) the tab title carries the count without asking for anything", () => {
    const base = "Formic — operator console";
    expect(M.titleWithAlerts(base, 3)).toBe("(3) " + base);
    expect(M.titleWithAlerts(base, 0)).toBe(base);
    // Idempotent: repainting must not stack prefixes into "(3) (2) (1) …".
    expect(M.titleWithAlerts(M.titleWithAlerts(base, 3), 2)).toBe("(2) " + base);
    expect(M.titleWithAlerts(M.titleWithAlerts(base, 3), 0)).toBe(base);
  });

  /* F3: "Notifications off" sat silently beside four waiting agents. The button
     reported the delivery channel and never the backlog, so muting the channel
     also hid the work. The count must therefore survive every muted state. */
  test("(4) the waiting count rides every toggle state, muted and blocked included", () => {
    const off = M.notifyToggleView({ enabled: false, permission: "default" }, true, 4);
    expect(off.label).toBe("Notifications off");
    expect(off.count).toBe(4);
    expect(off.ariaLabel).toBe("Notifications off, 4 agents waiting on you");
    expect(off.title).toContain("4 waiting on you");

    // Blocked and unsupported are exactly the states where the operator has no
    // other channel — hiding the number there is the worst case, not a spared one.
    expect(M.notifyToggleView({ enabled: false, permission: "denied" }, true, 4).count).toBe(4);
    expect(M.notifyToggleView({ enabled: false, permission: "default" }, false, 4).count).toBe(4);

    // A quiet fleet stays quiet in the WORDS. The badge itself still renders its
    // zero — see the badge-tone test below — because an absent badge and a calm
    // one look identical and only one of them is good news.
    const calmView = M.notifyToggleView({ enabled: true, permission: "granted" }, true, 0);
    expect(calmView.count).toBe(0);
    expect(calmView.ariaLabel).toBe("Notifications on");
    expect(calmView.title).not.toContain("waiting on you");
    // Singular reads as English, not "1 agents".
    expect(M.notifyToggleView({ enabled: false, permission: "default" }, true, 1).ariaLabel)
      .toBe("Notifications off, 1 agent waiting on you");

    /* The badge is a real node carrying the digit, not text glued onto the
       label — that is what lets it take the ember fill without the count
       entering the button's text content. Its tone class is composed from whole
       string literals, never assembled from a runtime value, because the
       orphan-CSS guard reads this file as text. */
    expect(source).toContain('class: "notify-badge " + BADGE_TONE_CLASS[view.tone]');
    expect(source).toContain('text: String(view.count)');
    expect(source).toContain('icon("bell")');
    expect(source).not.toContain('btn.textContent = "Notifications"');
    for (const cls of ["is-blocked", "is-noticed", "is-clear"]) expect(source, cls).toContain(`"${cls}"`);
    // The disclosure's accessible name, not the delivery switch's.
    expect(source).toMatch(/btn\.setAttribute\("aria-label", view\.disclosureLabel\)/);

    /* Placement rule, not style — this is the bug the unit tests above could
       not see. The toggle used to paint once in boot() and on click, which was
       fine for pure preference state. Now that it carries a snapshot-derived
       count it MUST paint inside render(), because boot() runs before the first
       snapshot exists: the count was always 0 and the badge never appeared on
       the real page even though every assertion above passed.

       renderNotificationCenter is the one that paints it now: it computes the
       feed once and hands the badge its count and tone off that same list, so
       the button cannot report a different population than the panel it opens. */
    const renderFn = source.match(/\nfunction render\(\)[\s\S]*?\n\}/)?.[0] ?? "";
    expect(renderFn).toContain("renderNotificationCenter()");
    expect(source).toContain("renderNotifyToggle(model.count, model.tone, open)");
  });

  test("(4) the badge's ink is the verdict, and it always renders a reading", () => {
    /* The contract the whole surface rests on: semantic danger filled ONLY when a person
       is the blocker. Amber outline is the watcher having something; grey
       outline is a real, rendered zero. */
    expect(M.notifyToggleView({ enabled: true, permission: "granted" }, true, 2, "blocked").tone).toBe("blocked");
    expect(M.notifyToggleView({ enabled: true, permission: "granted" }, true, 1, "noticed").tone).toBe("noticed");
    expect(M.notifyToggleView({ enabled: true, permission: "granted" }, true, 0, "clear").tone).toBe("clear");
    // An unknown tone falls back to the calm one. A badge is never ember by accident.
    expect(M.notifyToggleView({ enabled: true, permission: "granted" }, true, 9, "sideways").tone).toBe("clear");

    // Semantic danger is a fill; the other two are outlines. Asserted on the stylesheet,
    // because "filled" is the entire distinction the operator reads at a glance.
    expect(styles).toContain(".notify-badge.is-blocked { background: var(--color-status-danger)");
    expect(styles).toContain(".notify-badge.is-noticed { color: var(--color-status-warning-text)");
    expect(styles).toContain(".notify-badge.is-clear { color: var(--color-text-secondary)");

    // The digit never stands alone for a screen reader.
    expect(M.notifyToggleView({ enabled: false, permission: "default" }, true, 3, "blocked").disclosureLabel)
      .toBe("Notifications, 3 agents waiting on you");
    expect(M.notifyToggleView({ enabled: false, permission: "default" }, true, 1, "blocked").disclosureLabel)
      .toBe("Notifications, 1 agent waiting on you");
    expect(M.notifyToggleView({ enabled: false, permission: "default" }, true, 2, "noticed").disclosureLabel)
      .toBe("Notifications, 2 being watched, nobody waiting on you");
    expect(M.notifyToggleView({ enabled: false, permission: "default" }, true, 0, "clear").disclosureLabel)
      .toBe("Notifications, nothing waiting");
  });

  test("(4) permission is asked from a click and nowhere else, and denial is quiet", () => {
    // The control states an operator can actually reach.
    expect(M.notifyToggleView({ enabled: false, permission: "default" }, true).label).toBe("Notifications off");
    expect(M.notifyToggleView({ enabled: true, permission: "granted" }, true))
      .toMatchObject({ label: "Notifications on", pressed: true, disabled: false });
    // Denied: stated once, disabled, no nagging and no repeated prompt.
    const denied = M.notifyToggleView({ enabled: false, permission: "denied" }, true);
    expect(denied.disabled).toBe(true);
    expect(denied.label).toBe("Notifications blocked");
    expect(M.notifyToggleView({ enabled: false, permission: "default" }, false).disabled).toBe(true);

    // The one requestPermission call in the client is inside the click handler.
    // Asking on load is how a page gets denied permanently, which would disable
    // the feature forever — so this is a placement rule, not a style rule.
    expect(source.match(/requestPermission\(/g) ?? []).toHaveLength(1);
    const toggle = source.match(/async function toggleNotifications\(\)[\s\S]*?\n\}/)?.[0] ?? "";
    expect(toggle).toContain("requestPermission(");
    const bootFn = source.match(/function boot\(\)[\s\S]*?\n\}/)?.[0] ?? "";
    expect(bootFn).not.toContain("requestPermission(");
    expect(bootFn).toContain('$("notify-toggle").addEventListener("click"');
  });
});

/* ===========================================================================
   WAVE 4 / W4-B — the client meets the endpoints that now exist.

   Item 1 was live-verified against a scratch server on :4788 rather than a fake
   fetch: both read endpoints answer 403 ORIGIN_REJECTED to a browser, because a
   browser attaches no Origin header to a same-origin GET and `Origin` is a
   forbidden header name so fetch() cannot add one. The client cannot fix that;
   what it CAN do is say so honestly, which is what these tests pin.
   ========================================================================= */
describe("W4-B: read endpoints, liveness, attention, triage lifecycle", () => {
  test("(1) ORIGIN_REJECTED reads as a server refusal, not as a missing build", () => {
    const body = { ok: false, error: { code: "ORIGIN_REJECTED", message: "Transcript reads require an exact same-origin loopback Origin header." } };
    const transcript = M.transcriptFailureText(403, body);
    // Never the "this build" sentence: the route IS deployed, and sending the
    // operator to look for a deploy that already happened is the expensive lie.
    expect(transcript).not.toContain("not available in this build");
    expect(transcript).toContain("ORIGIN_REJECTED");
    // W5-B: was `toContain("same-origin GET")`. The server stopped requiring an
    // Origin header on these two GETs, so that sentence became false; the code
    // now means "you reached the server under a non-loopback hostname". The
    // replacement copy is pinned in full by the W5-B block below.
    expect(transcript).toContain("loopback");
    // Not a bare echo of the server's own sentence about HTTP internals.
    expect(transcript).not.toBe(body.error.message);

    const actions = M.actionsFailureText(403, { ok: false, error: { code: "ORIGIN_REJECTED", message: "Action-log reads require an exact same-origin loopback Origin header." } });
    expect(actions).not.toContain("not available in this build");
    expect(actions).toContain("loopback");

    // The other degradations are unchanged: a build with no route at all still
    // says so, and a missing agent still reads as a missing agent.
    expect(M.transcriptFailureText(404, null)).toBe("Transcript view is not available in this build.");
    expect(M.transcriptFailureText(404, { ok: false, error: { code: "AGENT_NOT_FOUND", message: "gone" } }))
      .toContain("no longer tracked");
    expect(M.actionsFailureText(404, null)).toBe("The action log is not available in this build.");
  });

  test("(1) the real /api/transcript envelope normalizes without loss", () => {
    // Captured from the live route on :4788 (45 lines, 4 roles, absolute source
    // path, truncated:false) — the shape FE-C built against, now confirmed.
    const wire = {
      ok: true,
      agentId: "codex:a1",
      source: "/Users/x/.codex/sessions/2026/07/28/rollout.jsonl",
      truncated: false,
      lines: [
        { at: "2026-07-28T20:45:39.752Z", role: "user", text: "Memory You have access to a memory folder" },
        { at: "2026-07-28T20:45:41.000Z", role: "tool", text: "ran ls" },
        { at: null, role: "assistant", text: "done" },
        { at: "2026-07-28T20:45:42.000Z", role: "reasoning", text: "collapses to unknown" },
      ],
    };
    const view = M.normalizeTranscript(wire);
    expect(view.source).toBe(wire.source);
    expect(view.truncated).toBe(false);
    expect(view.lines.map((l: any) => l.role)).toEqual(["user", "tool", "assistant", "unknown"]);
    expect(view.lines[2]!.at).toBeNull();
    // The server's limit ceiling is 1000 and the action log's is 500; asking for
    // more is a 400 INVALID_LIMIT, so the client must never ask for more.
    expect(M.transcriptUrl("codex:a1", 5000)).toBe("/api/transcript?agent=codex%3Aa1&limit=1000");
    expect(M.actionsUrl(5000)).toBe("/api/actions?limit=500");
  });

  test("(3) liveness is absent-first and never infers death", () => {
    // Absent: no verdict at all, so nothing new renders anywhere.
    expect(M.livenessState(agent())).toBeNull();
    expect(M.livenessView(agent())).toBeNull();

    // Both carriers, string or object.
    expect(M.livenessState(agent({ processLiveness: "died" }))).toBe("died");
    expect(M.livenessState(agent({ liveness: "process-gone" }))).toBe("died");
    expect(M.livenessState(agent({ processLiveness: { state: "running" } }))).toBe("running");
    expect(M.livenessState(agent({ processLiveness: { status: "exited" } }))).toBe("exited");

    // The full vocabulary the emitting lane might use.
    for (const word of ["running", "alive", "process-alive", "up"]) {
      expect(M.livenessState(agent({ processLiveness: word })), word).toBe("running");
    }
    for (const word of ["exited", "exited-clean", "finished", "completed", "done"]) {
      expect(M.livenessState(agent({ processLiveness: word })), word).toBe("exited");
    }
    for (const word of ["died", "dead", "process-gone", "crashed", "killed", "terminated"]) {
      expect(M.livenessState(agent({ processLiveness: word })), word).toBe("died");
    }

    // A word this client does not own is unknown — never death, and never health.
    for (const word of ["zombie", "", "  ", "stopped-maybe", "no-evidence"]) {
      expect(M.livenessState(agent({ processLiveness: word })), JSON.stringify(word)).toBe("unknown");
    }
    expect(M.livenessState(agent({ processLiveness: {} }))).toBe("unknown");
    expect(M.livenessState(agent({ processLiveness: 7 }))).toBe("unknown");
  });

  test("(3) 'died' is unmistakable on the row; absence changes nothing", () => {
    const program = { id: "p", name: "P" };
    const calm = withDom(() => M.renderAgentRow(agent(), program));
    const dead = withDom(() => M.renderAgentRow(agent({ processLiveness: "died" }), program));
    const unclear = withDom(() => M.renderAgentRow(agent({ processLiveness: "unknown" }), program));

    // Absent renders exactly what it renders today: no mark, no row class.
    expect(byClass(calm, "row-died")).toBeNull();
    expect(calm.className.split(/\s+/)).not.toContain("is-died");
    expect(calm.attributes["aria-label"]).not.toContain("Process:");

    // Died is marked in text, in the row class, and in the accessible name.
    expect(textOf(byClass(dead, "row-died"))).toContain("Died");
    expect(dead.className.split(/\s+/)).toContain("is-died");
    expect(dead.attributes["aria-label"]).toContain("Process: Died");

    // Unknown is never marked as death, but it is still stated to a reader.
    expect(byClass(unclear, "row-died")).toBeNull();
    expect(unclear.className.split(/\s+/)).not.toContain("is-died");
    // agent() is `running`, so its unknown is the live reading — see (3b).
    expect(unclear.attributes["aria-label"]).toContain("Process: No matching process");
  });

  test("(3) the drawer states all four verdicts, so unknown reads as unknown", () => {
    const cases: Array<[string, string, string]> = [
      ["running", "Process live", "liveness-running"],
      ["exited", "Exited cleanly", "liveness-exited"],
      ["died", "Died", "liveness-died"],
      ["unknown", "No matching process", "liveness-unknown"],
    ];
    for (const [word, label, cls] of cases) {
      const target = agent({ processLiveness: word });
      const pane = newNode("div");
      withDom(() => M.renderAgentDrawer(pane, { kind: "agent", agent: target, program: { id: "p", name: "P", agents: [target] } }));
      const state = byClass(pane, "status-line-liveness");
      if (word === "running") expect(state.attributes["aria-label"], word).toBe(label);
      else expect(textOf(state), word).toContain(label);
      expect(state.className.split(/\s+/), word).toContain(cls);
    }
    // The four labels are distinct words — "exited" must never read like "died".
    const labels = cases.map(([word]) => M.livenessView(agent({ processLiveness: word })).label);
    expect(new Set(labels).size).toBe(4);
  });

  /* One wire value, two different facts — but NOT the two this test first
     asserted. It used to read the live case as "Awaiting first check" and the
     ended one as "No process evidence", on the theory that a live session is
     genuinely waiting for a probe. Watched on the live board for 16 minutes
     (2026-08-03 22:12–22:28 UTC), that theory holds for some sessions and fails
     for others: of 6 live agents wearing the chip, 2 cleared within ~6 minutes
     because a check arrived and bound a process, and 4 aged 7 to 40 minutes
     never cleared. A label that promises a check is wrong for the second group
     and a label that denies one is wrong for the first, so the live wording
     states the fact and says nothing about timing.

     The split still earns its keep, on the fact that DOES separate them: an
     ended session will never be matched, so how it finished is closed
     unanswered. 627 of the 631 unknowns on the board are ended sessions. */
  test("(3b) unknown liveness separates a session that may still match from one that never will", () => {
    const live = M.livenessView(agent({ processState: "unknown", status: "running", activity: "working" }));
    expect(live.label).toBe("No matching process");
    expect(live.detail).toContain("cannot say whether its process is alive");
    // Never promise, and never deny, a check the board does not schedule.
    expect(live.label).not.toContain("Awaiting");
    expect(live.detail).not.toMatch(/yet|never|will/i);

    const finished = M.livenessView(agent({ processState: "unknown", status: "archived", activity: "ended" }));
    expect(finished.label).toBe("No process evidence");
    // The ended chip carries the extra fact, and it is the one an operator acts
    // on: the outcome is unrecoverable, not merely unobserved.
    expect(finished.detail).toContain("cannot be recovered");
    expect(finished.label).not.toBe(live.label);

    // Same key either way, so the chip's styling and every selector still match.
    expect(live.key).toBe("unknown");
    expect(finished.key).toBe("unknown");
    expect(live.tone).toBe(finished.tone);

    // The three states that ARE evidence are unaffected by activity.
    for (const [word, label] of [["running", "Process live"], ["exited", "Exited cleanly"], ["died", "Died"]]) {
      expect(M.livenessView(agent({ processState: word, activity: "ended" })).label).toBe(label);
      expect(M.livenessView(agent({ processState: word, activity: "working" })).label).toBe(label);
    }
    // Absence is still absence — no chip, no claim.
    expect(M.livenessView(agent())).toBeNull();
  });

  test("(2) attention: acknowledge, dismiss and snooze all reach the server", async () => {
    const asking = agent({ status: "attention", statusReason: "Unread cmux notification: Codex — Permission" });
    const snap = snapshot({ programs: [{ id: "p", name: "P", agents: [asking] }] });
    const record = { surfaceId: "s1", action: "acknowledge", updatedAt: "2026-07-22T03:00:00.000Z", throughAt: "2026-07-22T02:00:00.000Z" };

    for (const action of ["acknowledge", "dismiss"]) {
      await withState({
        snap, conn: "live", attention: new Map(), attentionPending: new Set(), attentionErrors: new Map(),
      }, async () => {
        await withRequests([
          { status: 200, json: { ok: true, agentId: asking.id, state: { ...record, action } } },
          { status: 200, json: snap },
        ], async (calls) => {
          await M.applyAttention(asking.id, action);
          expect(calls[0]!.method, action).toBe("POST");
          expect(calls[0]!.url, action).toBe("/api/attention");
          expect(calls[0]!.body, action).toEqual({ action, agentId: asking.id });
          // The snapshot is re-read, which is what makes the agent visibly leave
          // the needs-a-human set rather than just greying a button.
          expect(calls[1]!.url, action).toBe("/api/snapshot");
          expect(M.state.attention.get(asking.id).action, action).toBe(action);
        });
      });
    }

    // Snooze carries an `until`; the server rejects a body without one (400).
    await withState({
      snap, conn: "live", attention: new Map(), attentionPending: new Set(), attentionErrors: new Map(),
    }, async () => {
      const until = new Date(Date.parse("2026-07-22T04:00:00.000Z")).toISOString();
      await withRequests([
        { status: 200, json: { ok: true, agentId: asking.id, state: { surfaceId: "s1", action: "snooze", updatedAt: "2026-07-22T03:00:00.000Z", snoozedUntil: until } } },
        { status: 200, json: snap },
      ], async (calls) => {
        await M.applyAttention(asking.id, "snooze", until);
        expect(calls[0]!.body).toEqual({ action: "snooze", agentId: asking.id, until });
      });
    });
  });

  test("(2) attention failures are named, not swallowed", async () => {
    const asking = agent({ status: "attention" });
    const snap = snapshot({ programs: [{ id: "p", name: "P", agents: [asking] }] });
    const cases: Array<[number, string, string]> = [
      [404, "ATTENTION_NOT_FOUND", "no unread notification recorded"],
      [409, "UNSAFE_TARGET", "no safely resolved terminal"],
      [404, "AGENT_NOT_FOUND", "no longer in the current snapshot"],
    ];
    for (const [status, code, fragment] of cases) {
      await withState({
        snap, conn: "live", attention: new Map(), attentionPending: new Set(), attentionErrors: new Map(),
      }, async () => {
        await withRequests([{ status, json: { ok: false, error: { code, message: "server prose" } } }], async () => {
          await M.applyAttention(asking.id, "acknowledge");
          expect(M.state.attentionErrors.get(asking.id), code).toContain(fragment);
          // A failed change is never recorded as if it had worked.
          expect(M.state.attention.has(asking.id), code).toBe(false);
        });
      });
    }
  });

  test("(2) an expired snooze visibly returns", () => {
    const asking = agent({ status: "attention", statusReason: "Unread cmux notification: Codex — Permission" });
    const now = Date.parse("2026-07-22T03:00:00.000Z");
    const live = { surfaceId: "s1", action: "snooze", updatedAt: "2026-07-22T02:00:00.000Z", snoozedUntil: "2026-07-22T04:00:00.000Z" };
    const expired = { ...live, snoozedUntil: "2026-07-22T02:30:00.000Z" };

    // While it holds, the record is live and states its deadline.
    expect(M.attentionRecord(asking.id, { attention: new Map([[asking.id, live]]) }, now)).toEqual(live);
    expect(M.attentionStateText(live)).toContain("Snoozed until");

    // Once it runs out the record is gone — no timer, no stuck state.
    expect(M.attentionRecord(asking.id, { attention: new Map([[asking.id, expired]]) }, now)).toBeNull();
    // A malformed deadline is treated as expired, never as an eternal snooze.
    expect(M.attentionRecord(asking.id, { attention: new Map([[asking.id, { ...live, snoozedUntil: "not a date" }]]) }, now)).toBeNull();

    // And the drawer says so, rather than letting the alert quietly reappear.
    const ui = { attention: new Map([[asking.id, expired]]), attentionPending: new Set(), attentionErrors: new Map() };
    const returned = withDom(() => M.renderAttentionBlock(asking, ui, now));
    expect(textOf(returned)).toContain("snooze has run out");
    expect(buttonsOf(returned).map((b: any) => b.dataset.fkey)).toEqual([
      "attn:" + asking.id + ":acknowledge",
      "attn:" + asking.id + ":dismiss",
      "attn:" + asking.id + ":snooze",
    ]);

    // A snooze still running shows the state, not the controls again.
    const held = withDom(() => M.renderAttentionBlock(
      agent({ status: "running" }),
      { attention: new Map([["codex:a1", live]]), attentionPending: new Set(), attentionErrors: new Map() },
      now,
    ));
    expect(textOf(held)).toContain("Snoozed until");
    expect(buttonsOf(held)).toHaveLength(0);

    // An agent nobody is waiting on, with nothing recorded, gets no block at all.
    expect(withDom(() => M.renderAttentionBlock(agent(), { attention: new Map(), attentionPending: new Set(), attentionErrors: new Map() }, now))).toBeNull();
  });

  test("(2) triage lifecycle: cancel a run, remove a record, investigate again", async () => {
    const issue = { id: "system:x", kind: "system", severity: "error", title: "T", summary: "s", affectedAgentIds: [] };
    const base = {
      issueId: issue.id, id: "triage:system:x", generatedAt: "2026-07-22T03:00:00.000Z",
      mode: "investigation", headline: "H", rationale: "R", affectedAgents: 2, affectedPrograms: 1,
      providers: ["codex"], evidence: [], steps: [{ title: "s1", detail: "d1" }],
      queueRecommended: true, createdAt: "2026-07-22T03:00:00.000Z",
    };
    const ui = (state: string) => triageUi({ queueItems: [{ ...base, state }], triage: new Map([[issue.id, base]]) });

    // The lever offered depends on where the run actually is.
    const keys = (state: string) => buttonsOf(withDom(() => M.renderTriage(issue, ui(state))))
      .map((b: any) => b.dataset.fkey).filter((k: string) => /^triage-(cancel|remove|rerun|run)/.test(k));
    expect(keys("running")).toEqual(["triage-cancel:system:x"]);
    expect(keys("queued")).toEqual(["triage-run:system:x", "triage-remove:system:x"]);
    expect(keys("completed")).toEqual(["triage-rerun:system:x", "triage-remove:system:x"]);
    expect(keys("blocked")).toEqual(["triage-rerun:system:x", "triage-remove:system:x"]);
    // An untriaged finding grows no lifecycle chrome.
    expect(M.triageLifecycleControls(issue, undefined, false, triageUi())).toEqual([]);

    // Cancel stops the run: the server reports `cancelled`, the item leaves the
    // queue, and the plan survives so it can be re-queued without re-analysing.
    await withState({
      snap: snapshot({ issues: [issue] }), conn: "live",
      triage: new Map(), triagePending: new Set(), triageErrors: new Map(),
      queueItems: [{ ...base, state: "running", pid: 4321 }],
    }, async () => {
      await withRequests([
        { status: 200, json: { ok: true, removed: { ...base, state: "running" }, cancelled: true } },
        { status: 200, json: snapshot({ issues: [issue] }) },
        { status: 200, json: { ok: true, items: [] } },
      ], async (calls) => {
        await M.removeTriageItem(issue.id, "cancel");
        expect(calls[0]!.method).toBe("DELETE");
        expect(calls[0]!.url).toBe("/api/triage/queue?issueId=system%3Ax");
        expect(M.state.queueItems).toEqual([]);
        expect(M.state.triage.get(issue.id).headline).toBe("H");
        expect(M.state.triageErrors.has(issue.id)).toBe(false);
      });
    });

    // A server that cannot safely cancel says so (409) — the client must NOT
    // report a stopped run it did not stop.
    await withState({
      snap: snapshot({ issues: [issue] }), conn: "live",
      triage: new Map(), triagePending: new Set(), triageErrors: new Map(),
      queueItems: [{ ...base, state: "running" }],
    }, async () => {
      await withRequests([{
        status: 409,
        json: { ok: false, error: { code: "INVESTIGATION_CANCEL_UNAVAILABLE", message: "The active investigation has no safe cancellation handle." } },
      }], async () => {
        await M.removeTriageItem(issue.id, "cancel");
        expect(M.state.triageErrors.get(issue.id)).toContain("no safe cancellation handle");
        expect(M.state.queueItems.map((i: any) => i.state)).toEqual(["running"]);
      });
    });

    // "Investigate again" re-queues through the same route the first queue used;
    // the server replaces a finished item, so no second vocabulary exists.
    await withState({
      snap: snapshot({ issues: [issue] }), conn: "live",
      triage: new Map([[issue.id, base]]), triagePending: new Set(), triageErrors: new Map(),
      queueItems: [{ ...base, state: "completed", result: "done" }],
    }, async () => {
      await withRequests([
        { status: 200, json: { ok: true, item: { ...base, state: "queued" } } },
        { status: 200, json: snapshot({ issues: [issue] }) },
        { status: 200, json: { ok: true, items: [{ ...base, state: "queued" }] } },
      ], async (calls) => {
        const rerun = M.triageLifecycleControls(issue, { ...base, state: "completed" }, false, M.state)
          .find((b: any) => b.dataset.fkey === "triage-rerun:system:x");
        await fire(rerun);
        expect(calls[0]!.url).toBe("/api/triage/queue");
        expect(calls[0]!.method).toBe("POST");
        expect(M.state.queueItems.map((i: any) => i.state)).toEqual(["queued"]);
      });
    });
  });

  /* FE-C's lesson: a surface that renders correctly in isolation and is never
     mounted, or never repainted, is not shipped. Both halves are checked. */
  test("(2)(3) both new surfaces are actually mounted in the drawer, and repaint", () => {
    const asking = agent({ status: "attention", statusReason: "Unread cmux notification: Codex — Permission", processLiveness: "died" });
    const program = { id: "p", name: "P", agents: [asking] };
    const pane = newNode("div");
    withDom(() => M.renderAgentDrawer(pane, { kind: "agent", agent: asking, program }));
    expect(byClass(pane, "status-line-liveness")).not.toBeNull();
    expect(textOf(byClass(pane, "status-line-liveness"))).toContain("Died");
    expect(byClass(pane, "drawer-session-hazard")).not.toBeNull();
    expect(byClass(pane, "attn-block")).not.toBeNull();
    expect(buttonsOf(byClass(pane, "attn-block")).map((b: any) => textOf(b)))
      .toEqual(["Acknowledge", "Dismiss", "Snooze 1 hour"]);

    // A drawer with neither field and no attention keeps exactly its old shape.
    const calmPane = newNode("div");
    withDom(() => M.renderAgentDrawer(calmPane, { kind: "agent", agent: agent(), program: { id: "p", name: "P", agents: [agent()] } }));
    expect(byClass(calmPane, "status-line-liveness")).toBeNull();
    expect(byClass(calmPane, "attn-block")).toBeNull();

    // Nothing else in the drawer moves when an attention verdict lands, so
    // without it in the signature the block would never reach the screen —
    // the exact failure state.identity and state.transcript both had.
    const snap = snapshot({ programs: [program] });
    const base = identityUi({ snap, attention: new Map(), attentionPending: new Set(), attentionErrors: new Map(), actions: { items: [] }, transcript: {} });
    const sel = { kind: "agent", id: asking.id };
    const view = { kind: "agent", agent: asking, program };
    const before = M.inspectorPaintSig(sel, view, base);
    const acked = M.inspectorPaintSig(sel, view, { ...base, attention: new Map([[asking.id, { action: "acknowledge", updatedAt: "2026-07-22T03:00:00.000Z" }]]) });
    const failing = M.inspectorPaintSig(sel, view, { ...base, attentionErrors: new Map([[asking.id, "nope"]]) });
    const busy = M.inspectorPaintSig(sel, view, { ...base, attentionPending: new Set([asking.id]) });
    expect(acked).not.toBe(before);
    expect(failing).not.toBe(before);
    expect(busy).not.toBe(before);
  });
});

/* ---------------------------------------------------------------------------
   W5-B.

   Every payload quoted in this block was captured VERBATIM off a live server
   started from this worktree on 127.0.0.1:4792, not hand-written to the
   contract. The previous lane could only test the transcript viewer and the
   action log against a fake `fetch`, and the lane after it could not test them
   at all because both routes answered 403 to every browser. Both are now
   reachable, so these tests pin the client against what the server really
   sends.
   ------------------------------------------------------------------------- */
describe("W5-B: the wire, as the server actually speaks it", () => {
  /* The whole liveness feature was dark: the server emits `processState` and
     the client read only `processLiveness` / `liveness`, so livenessState()
     returned null for all 96 agents in a live snapshot and nothing rendered. */
  test("(1) processState is a liveness carrier, with the server's own four words", () => {
    // src/shared/types.ts: ProcessState = "running" | "exited" | "died" | "unknown".
    const wire: Array<["running" | "exited" | "died" | "unknown", string]> = [
      ["running", "Process live"],
      ["exited", "Exited cleanly"],
      ["died", "Died"],
      // agent() is `running`, so unknown reads as the live case; the ended
      // reading is covered by (3b).
      ["unknown", "No matching process"],
    ];
    for (const [word, label] of wire) {
      expect(M.livenessState(agent({ processState: word })), word).toBe(word);
      expect(M.livenessView(agent({ processState: word })).label, word).toBe(label);
    }
    // The four labels stay four distinct words: "Exited cleanly" collapsing
    // into "Died" is the one confusion this feature exists to remove.
    expect(new Set(wire.map(([w]) => M.livenessView(agent({ processState: w })).label)).size).toBe(4);
  });

  test("(1) processState wins over the legacy carriers", () => {
    // Both carriers on one record can only happen while something is migrating.
    // Read the field the server actually emits, never the guess it replaced.
    expect(M.livenessState(agent({ processState: "died", processLiveness: "running" }))).toBe("died");
    expect(M.livenessState(agent({ processState: "running", liveness: "process-gone" }))).toBe("running");
    // The aliases still work on their own — dropping them would buy nothing and
    // would re-open exactly the failure this test exists for.
    expect(M.livenessState(agent({ processLiveness: "died" }))).toBe("died");
    expect(M.livenessState(agent({ liveness: "process-gone" }))).toBe("died");
  });

  test("(1) processState keeps the absent-first rules", () => {
    // Absent: nothing new renders. A snapshot without the field paints as before.
    expect(M.livenessState(agent())).toBeNull();
    expect(M.livenessState(agent({ processState: null }))).toBeNull();
    expect(M.livenessState(agent({ processState: undefined }))).toBeNull();
    // A word this client does not own is never read as death.
    for (const word of ["zombie", "stopped", "", "  ", 7, {}, []]) {
      expect(M.livenessState(agent({ processState: word })), JSON.stringify(word)).toBe("unknown");
    }
  });

  test("(1) a real processState reaches the row and the drawer", () => {
    const program = { id: "p", name: "P", agents: [] as unknown[] };

    // The row marks only death, and it must be driven by the REAL carrier —
    // reading processLiveness alone left every dead process unmarked.
    const dead = withDom(() => M.renderAgentRow(agent({ processState: "died" }), program));
    expect(dead.className).toContain("is-died");
    expect(dead.attributes["aria-label"]).toContain("Process: Died");

    const alive = withDom(() => M.renderAgentRow(agent({ processState: "running" }), program));
    expect(alive.className).not.toContain("is-died");
    expect(alive.attributes["aria-label"]).toContain("Process: Process live");

    // Absent stays byte-identical to the pre-feature row: no mark, no aria text.
    const bare = withDom(() => M.renderAgentRow(agent(), program));
    expect(bare.className).not.toContain("is-died");
    expect(bare.attributes["aria-label"]).not.toContain("Process:");

    // The drawer states all four, so "unknown" is stated as unknown somewhere
    // rather than quietly reading as health.
    const unclear = agent({ processState: "unknown" });
    const pane = newNode("div");
    withDom(() => M.renderAgentDrawer(pane, { kind: "agent", agent: unclear, program: { id: "p", name: "P", agents: [unclear] } }));
    expect(textOf(byClass(pane, "status-line-liveness"))).toContain("No matching process");
  });

  /* The route that used to 403 every browser now answers. This is a verbatim
     slice of what it returned for a real Codex session on :4792 — including a
     `role: "unknown"` the SERVER itself emits for an unmapped row, which the
     old hand-written fixture did not have. */
  const LIVE_TRANSCRIPT = {
    ok: true,
    agentId: "codex:019faca3-5c0b-71b1-9501-d27671ba2083",
    source: "/Users/emilionunezgarcia/.codex/sessions/2026/07/29/rollout-2026-07-29T08-50-14-019faca3-5c0b-71b1-9501-d27671ba2083.jsonl",
    truncated: false,
    lines: [
      { at: "2026-07-29T06:50:18.291Z", role: "unknown", text: "Memory You have access to a memory folder with guidance from" },
      { at: "2026-07-29T06:50:18.359Z", role: "user", text: "WAVE 5 / W5-C — the suite has a time bomb" },
      { at: "2026-07-29T06:50:29.866Z", role: "assistant", text: "I'll treat the diagnosed triage clock leak as the primary fi" },
      { at: "2026-07-29T06:51:02.100Z", role: "tool", text: "ran bun test" },
    ],
  };

  test("(3) the live transcript route loads and renders through the real client path", async () => {
    const who = agent({ id: LIVE_TRANSCRIPT.agentId });
    const program = { id: "p", name: "P", agents: [who] };
    await withState({ snap: snapshot({ programs: [program] }), transcript: {} }, async () => {
      await withRequests([{ status: 200, json: LIVE_TRANSCRIPT }], async (calls) => {
        await M.loadTranscript(who.id);
        // The client must ask for a limit the server will accept: its ceiling
        // is 1000 and anything above it is a 400 INVALID_LIMIT.
        expect(calls[0]!.method).toBe("GET");
        expect(calls[0]!.url).toBe("/api/transcript?agent=" + encodeURIComponent(who.id) + "&limit=200");
        // Settled into data, never a spinner and never a named failure.
        expect(M.state.transcript.loading).toBe(false);
        expect(M.state.transcript.error).toBe("");

        const body = withDom(() => M.renderChatFeedBody(who, M.state));
        const lead = withDom(() => M.renderTranscriptFeedLead(who, M.state));
        // The four live turns render once each: user + assistant as bubbles,
        // unknown as a quiet row, and tool output as an expandable card.
        expect(allByClass(body, "chat-msg")).toHaveLength(2);
        expect(allByClass(body, "tr-line")).toHaveLength(1);
        expect(allByClass(body, "chat-tool-card")).toHaveLength(1);
        // The source remains normalized in state for Evidence/debug, but loaded
        // chat gets no duplicate count, path, refresh footer, or unnecessary lead.
        expect(M.state.transcript.data.source).toBe(LIVE_TRANSCRIPT.source);
        expect(lead).toBeNull();
        // Untrusted agent text, rendered as text.
        expect(textOf(body)).toContain("WAVE 5 / W5-C — the suite has a time bomb");
      });
    });
  });

  test("(3) the live action-log route loads every real outcome, refusals included", async () => {
    // Verbatim from :4792 after two refused control attempts. A journal that
    // showed only successes would read as proof the instruction landed.
    const live = {
      ok: true,
      actions: [
        {
          id: "act_01KYPANEX9M7N7TMPX77ESF6MN",
          at: "2026-07-29T06:58:18.153Z",
          kind: "interrupt",
          agentIds: ["codex:w5b-probe-not-a-real-agent"],
          outcome: "failed",
          detail: "AGENT_NOT_FOUND: The agent is not present in the current snapshot.",
        },
        {
          id: "act_01KYPANEX22GXBHQ0QA06PFVRH",
          at: "2026-07-29T06:58:18.146Z",
          kind: "focus",
          agentIds: ["codex:w5b-probe-not-a-real-agent"],
          outcome: "failed",
          detail: "AGENT_NOT_FOUND: The agent is not present in the current snapshot.",
        },
      ],
    };
    await withState({ snap: snapshot(), actions: { loading: false, error: "", available: true, items: [], fetchedAt: 0 } }, async () => {
      await withRequests([{ status: 200, json: live }], async (calls) => {
        await M.loadActions();
        expect(calls[0]!.url).toBe("/api/actions?limit=100");
        expect(M.state.actions.error).toBe("");
        // fetchedAt is what lets a later control refresh the journal at all;
        // the 403 era left it 0 forever, so refreshActions() never fired.
        expect(M.state.actions.fetchedAt).toBeGreaterThan(0);
        expect(M.state.actions.items).toHaveLength(2);

        // Newest-first order is the contract, and normalizeActions must not
        // resort it: the dock reads items[0] as "the last thing I did here".
        const first = M.state.actions.items[0];
        expect(first.id).toBe(live.actions[0]!.id);
        expect(first.kind).toBe("interrupt");
        expect(M.actionOutcomeView(first.outcome).label).toBe("Failed");
        // The server's own reason survives normalization, not summarised away.
        expect(first.detail).toBe(live.actions[0]!.detail);
        // A refused attempt is kept as a refusal — a journal that dropped these
        // two would read as proof the interrupt landed.
        expect(M.state.actions.items.map((a: { outcome: string }) => a.outcome)).toEqual(["failed", "failed"]);
      });
    });
  });

  /* The routes stopped requiring an `Origin` header, so the client's
     explanation of ORIGIN_REJECTED became a lie in the opposite direction:
     it told the operator to go and get a server fix that had already shipped. */
  test("(3) ORIGIN_REJECTED names the address, not a server change that already landed", () => {
    const body = { ok: false, error: { code: "ORIGIN_REJECTED", message: "Read endpoints require exact same-origin loopback access." } };
    for (const text of [M.transcriptFailureText(403, body), M.actionsFailureText(403, body)]) {
      // The one thing the operator can act on.
      expect(text).toContain("127.0.0.1");
      expect(text).toContain("loopback");
      expect(text).toContain("ORIGIN_REJECTED");
      // Not a routed fix that has shipped, and not a deploy that has happened.
      expect(text).not.toContain("have to stop requiring");
      expect(text).not.toContain("same-origin GET");
      expect(text).not.toContain("not available in this build");
      // Not a bare echo of the server's own sentence about HTTP internals.
      expect(text).not.toBe(body.error.message);
    }
    // Every other degradation is untouched.
    expect(M.transcriptFailureText(404, null)).toBe("Transcript view is not available in this build.");
    expect(M.actionsFailureText(404, null)).toBe("The action log is not available in this build.");
    expect(M.transcriptFailureText(404, { ok: false, error: { code: "AGENT_NOT_FOUND", message: "gone" } }))
      .toContain("no longer tracked");
  });
});

/* ---------------------------------------------------------------------------
   Server health probe + the real startup path.

   Two gaps this closes. (1) /api/health had no client surface at all: the
   endpoint gates scripts/anthill-deploy.sh but nothing on the board read it, so
   the operator and the deploy could disagree about whether the server was
   healthy. (2) boot() was unreachable from tests — not exported, and it runs
   only behind a document/window guard — so the startup path was covered by
   source-text assertions that cannot fail when the wiring breaks.

   These drive both for real against the fake document and a fake fetch.
   ------------------------------------------------------------------------- */
describe("server health probe (/api/health)", () => {
  test("stays silent while the server calls itself healthy", async () => {
    await withRequests([{ status: 200, json: { ok: true, verdict: "healthy", snapshot: { ageMs: 900, maxAgeMs: 60000 } } }], async (calls) => {
      const result = await M.pollServerHealth();
      expect(calls[0].url).toContain("/api/health");
      expect(result.ok).toBe(true);
      // The connection badge and feed alarm already carry every healthy-state
      // fact; a third green light would be a third thing to read. Hidden is the
      // contract, not an accident of styling.
      expect(M.state.serverHealth.ok).toBe(true);
      const node = (globalThis as unknown as { document: any }).document.getElementById("server-health");
      expect(node.hidden).toBe(true);
    });
    M.state.serverHealth = null;
  });

  test("speaks when the server disowns its own snapshot", async () => {
    await withRequests([{ status: 200, json: { ok: false, verdict: "stale", snapshot: { ageMs: 240000, maxAgeMs: 60000 } } }], async () => {
      const result = await M.pollServerHealth();
      expect(result.ok).toBe(false);
      expect(result.verdict).toBe("stale");
      const node = (globalThis as unknown as { document: any }).document.getElementById("server-health");
      expect(node.hidden).toBe(false);
      expect(node.className).toContain("is-stale");
      // The age must reach the operator, not just the boolean.
      expect(node.attributes.title).toContain("stale");
      expect(node.attributes["aria-label"]).toBeTruthy();
    });
    M.state.serverHealth = null;
  });

  test("a non-200 and a refused request both read as unreachable", async () => {
    await withRequests([{ status: 503 }], async () => {
      const result = await M.pollServerHealth();
      expect(result.ok).toBe(false);
      expect(result.verdict).toBe("unreachable");
      const node = (globalThis as unknown as { document: any }).document.getElementById("server-health");
      expect(node.className).toContain("is-unreachable");
    });
    await withRequests([new Error("connection refused")], async () => {
      // A thrown request is itself the finding — it must not crash the poller.
      const result = await M.pollServerHealth();
      expect(result.ok).toBe(false);
      expect(result.verdict).toBe("unreachable");
    });
    M.state.serverHealth = null;
  });

  test("both inks are defined and the markup slot exists", () => {
    expect(styles).toContain(".server-health.is-stale");
    expect(styles).toContain(".server-health.is-unreachable");
    expect(html).toContain('id="server-health"');
  });
});

describe("boot() is exported and drives the real startup path", () => {
  test("boot wires the page, polls health, and stopBoot leaves no timers", async () => {
    expect(typeof M.boot).toBe("function");
    expect(typeof M.stopBoot).toBe("function");

    // EventSource and localStorage are the two browser globals boot() needs that
    // Bun does not provide. Stub them narrowly rather than adding a DOM library:
    // this project has zero dependencies by design.
    const G = globalThis as unknown as Record<string, any>;
    const realES = G.EventSource;
    const realLS = G.localStorage;
    const store = new Map<string, string>();
    G.localStorage = {
      getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
      setItem: (k: string, v: string) => { store.set(k, String(v)); },
      removeItem: (k: string) => { store.delete(k); },
    };
    let opened = 0;
    G.EventSource = class {
      static OPEN = 1;
      readyState = 1;
      constructor() { opened += 1; }
      addEventListener() {}
      close() {}
    };
    try {
      await withRequests([{ status: 200, json: { ok: true, verdict: "healthy", snapshot: { ageMs: 10, maxAgeMs: 60000 } } }], async (calls) => {
        const doc = (globalThis as unknown as { document: any }).document;
        doc.title = "Formic";
        doc.addEventListener = () => {};
        M.boot();
        // boot() deliberately fires several requests without awaiting them, so
        // let them settle while the fake document still exists — otherwise the
        // harness tears down mid-flight and the client renders into nothing.
        await Bun.sleep(10);
        // The startup path must actually reach the network and the transport,
        // which is exactly what a source-text assertion could never prove.
        expect(opened).toBe(1);
        const urls = calls.map((c) => c.url).join(" ");
        expect(urls).toContain("/api/snapshot");
        expect(urls).toContain("/api/health");
        // Title is captured before any notification rewrites it.
        expect(M.state.notify.baseTitle).toBe("Formic");
      });
    } finally {
      M.stopBoot();
      if (realES === undefined) delete G.EventSource; else G.EventSource = realES;
      if (realLS === undefined) delete G.localStorage; else G.localStorage = realLS;
      M.state.serverHealth = null;
    }
  });
});

describe("W6-B: sequenced snapshot deltas stay complete", () => {
  function transportFixture() {
    const active = agent({ id: "codex:active", sourceSessionId: "active" });
    const ended = agent({
      id: "codex:ended",
      sourceSessionId: "ended",
      status: "archived",
      statusReason: "Retained history",
      transcriptTail: "immutable retained payload",
    });
    const base = snapshot({
      generatedAt: "2026-07-29T08:00:00.000Z",
      programs: [{ id: "p", name: "P", purpose: "Transport", agents: [active, ended] }],
    });
    const changedActive = { ...active, statusReason: "New active evidence" };
    const next = snapshot({
      generatedAt: "2026-07-29T08:00:04.000Z",
      programs: [{ id: "p", name: "P", purpose: "Transport", agents: [changedActive, ended] }],
    });
    const { programs: _programs, ...head } = next;
    const delta = {
      schemaVersion: 1,
      baseSequence: 7,
      sequence: 8,
      snapshot: head,
      programs: [{
        id: "p",
        name: "P",
        purpose: "Transport",
        agentIds: ["codex:active", "codex:ended"],
        agents: [changedActive],
      }],
    };
    return { base, next, delta };
  }

  test("an ordered delta reconstructs the exact whole snapshot before adoption", () => {
    const { base, next, delta } = transportFixture();
    const reconstructed = M.applySnapshotDelta(base, delta, 7);

    expect(reconstructed).toEqual(next);
    expect(reconstructed.programs[0].agents[1]).toBe(base.programs[0].agents[1]);
    expect(reconstructed.generatedAt).toBe("2026-07-29T08:00:04.000Z");

    const { programs: _programs, ...laterHead } = {
      ...next,
      generatedAt: "2026-07-29T08:00:08.000Z",
    };
    const removed = M.applySnapshotDelta(reconstructed, {
      schemaVersion: 1,
      baseSequence: 8,
      sequence: 9,
      snapshot: laterHead,
      programs: [{
        id: "p",
        name: "P renamed",
        agentIds: ["codex:active"],
        agents: [],
      }],
    }, 8);
    expect(removed.programs).toEqual([{
      id: "p",
      name: "P renamed",
      agents: [next.programs[0].agents[0]],
    }]);
  });

  test("the first full SSE event paints immediately and establishes the delta base", async () => {
    const { base, next, delta } = transportFixture();

    await withState({ snap: null, snapshotSequence: null }, async () => {
      await withRequests([], async (calls) => {
        M.handleEventPayload(JSON.stringify(base), "7");
        await M.handleDeltaPayload(JSON.stringify(delta), "8");

        expect(calls).toHaveLength(0);
        expect(M.state.snap).toEqual(next);
        expect(M.state.snapshotSequence).toBe(8);
      });
    });
  });

  test("a gap, replay, malformed order, or unresolved agent rejects the whole delta", () => {
    const { base, delta } = transportFixture();

    expect(() => M.applySnapshotDelta(base, delta, 6)).toThrow();
    expect(() => M.applySnapshotDelta(base, delta, 8)).toThrow();
    expect(() => M.applySnapshotDelta(base, { ...delta, sequence: 9 }, 7)).toThrow();
    expect(() => M.applySnapshotDelta(base, {
      ...delta,
      programs: [{ ...delta.programs[0], agents: [], agentIds: ["codex:missing"] }],
    }, 7)).toThrow();
    expect(base.programs[0].agents.map((item: { id: string }) => item.id))
      .toEqual(["codex:active", "codex:ended"]);
  });

  test("a sequence gap requests a full snapshot and never adopts the partial payload", async () => {
    const { base, next, delta } = transportFixture();
    const gapped = {
      ...delta,
      baseSequence: 8,
      sequence: 9,
      snapshot: { ...delta.snapshot, generatedAt: "2026-07-29T08:00:08.000Z" },
      programs: [{
        ...delta.programs[0],
        agentIds: ["codex:active"],
      }],
    };

    await withState({ snap: base, snapshotSequence: 7 }, async () => {
      await withRequests([{
        status: 200,
        json: next,
        headers: { "x-ant-hill-snapshot-sequence": "9" },
      }], async (calls) => {
        await M.handleDeltaPayload(JSON.stringify(gapped), "9");

        expect(calls.map((call) => [call.method, call.url])).toEqual([["GET", "/api/snapshot"]]);
        expect(M.state.snap).toEqual(next);
        expect(M.state.snapshotSequence).toBe(9);
        expect(M.state.snap.programs[0].agents.map((item: { id: string }) => item.id))
          .toEqual(["codex:active", "codex:ended"]);
      });
    });
  });

  test("an SSE id that disagrees with the delta sequence requests a full snapshot", async () => {
    const { base, next, delta } = transportFixture();

    await withState({ snap: base, snapshotSequence: 7 }, async () => {
      await withRequests([{
        status: 200,
        json: next,
        headers: { "x-ant-hill-snapshot-sequence": "9" },
      }], async (calls) => {
        await M.handleDeltaPayload(JSON.stringify(delta), "9");

        expect(calls.map((call) => call.url)).toEqual(["/api/snapshot"]);
        expect(M.state.snapshotSequence).toBe(9);
        expect(M.state.snap).toEqual(next);
      });
    });
  });

  test("delta generatedAt remains the freshness clock when the feed goes quiet", async () => {
    const { base, delta } = transportFixture();
    const generatedAt = Date.parse(delta.snapshot.generatedAt);

    await withState({ snap: base, snapshotSequence: 7 }, async () => {
      await withRequests([], async (calls) => {
        await M.handleDeltaPayload(JSON.stringify(delta), "8");

        expect(calls).toHaveLength(0);
        expect(M.state.snap.generatedAt).toBe(delta.snapshot.generatedAt);
        expect(M.connVerdictFor({
          open: true,
          lastEventAt: generatedAt,
          generatedAt: M.state.snap.generatedAt,
          now: generatedAt + 60_001,
        })).toBe("stale");
      });
    });
  });

  test("the quiet-feed clock repaints the alarm without waiting for another snapshot", async () => {
    const stale = snapshot({ generatedAt: new Date(Date.now() - 61_000).toISOString() });

    await withState({ snap: stale, conn: "reconnecting", selected: null }, async () => {
      await withRequests([], async (calls) => {
        M.tickFreshnessSurfaces();

        const alarm = domById.get("feed-alarm")!;
        expect(calls).toHaveLength(0);
        expect(alarm.hidden).toBe(false);
        expect(textOf(alarm)).toContain("Feed frozen");
        expect((G.document.body as FakeNode).classList.contains("feed-frozen")).toBe(true);
      });
    });
  });
});

describe("the lifecycle contract on the board itself", () => {
  const quiet = (overrides: Record<string, unknown> = {}) => agent({
    id: "codex:quiet", lifecycle: "unverified", provenance: "no-evidence",
    activity: "unknown", status: "stale",
    updatedAt: "2026-07-20T03:00:00.000Z",
    ...overrides,
  });

  test("three tabs, and the Board is where an unverified session is findable", () => {
    expect(M.OPS_VIEWS).toEqual(["board", "history"]);
    expect(M.viewMatches("board", quiet())).toBe(true);
    // Not History: that is where the original missing-session incident sent it.
    expect(M.viewMatches("history", quiet())).toBe(false);
    // Its own divider inside each program group, so merging the tabs did not
    // merge the distinction — the state is still called out by name on screen.
    expect(M.lifecycleSection(quiet())).toBe("unverified");
  });

  test("Board is the union of the three live tabs it replaced, and nothing more", () => {
    /* The property that makes collapsing the tabs safe: every agent that was
       reachable under Now, Needs you or Waiting is reachable here, and no
       finished record leaks in behind them. */
    const working = agent({ lifecycle: "working", status: "running" });
    const waiting = agent({ id: "codex:w", lifecycle: "waiting", status: "waiting" });
    const alertingRow = agent({ id: "codex:x", status: "attention", outcome: "needs-you", lifecycle: "waiting" });
    const done = agent({ id: "codex:d", lifecycle: "finished", status: "archived" });
    for (const live of [working, waiting, alertingRow, quiet()]) {
      expect(M.viewMatches("board", live)).toBe(true);
    }
    expect(M.viewMatches("board", done)).toBe(false);
    expect(M.viewMatches("history", done)).toBe(true);
  });

  test("the Unverified section ignores the lookback, and ordinary Waiting rows do not", () => {
    /* Without this exemption the flagship state of the contract ships invisible:
       these sessions are quiet BY DEFINITION, so at the default six-hour
       lookback almost every one of them would be filtered out of the only view
       that shows them. The lookback moved from Waiting to Board with the
       population it filters; the exemption moved with it. */
    const now = Date.parse("2026-07-22T03:00:00.000Z");
    const old = { updatedAt: "2026-07-20T03:00:00.000Z" };
    expect(M.lookbackApplies("board")).toBe(true);
    expect(M.passesLookback(quiet(old), "board", 6, now)).toBe(true);
    expect(M.passesLookback(agent({ lifecycle: "waiting", ...old }), "board", 6, now)).toBe(false);
    // The exemption is scoped to the views that filter at all.
    expect(M.lookbackApplies("usage")).toBe(false);
    expect(M.passesLookback(agent({ lifecycle: "waiting", ...old }), "usage", 6, now)).toBe(true);
  });

  test("an unverified session is in neither the live count nor the finished one", () => {
    const snap = snapshot({
      totals: {
        live: 1, tracked: 3, attention: 0,
        byLifecycle: { working: 1, waiting: 0, unverified: 1, finished: 1 },
        retained: 0,
      },
      programs: [{ id: "p", name: "P", agents: [agent(), quiet(), agent({ id: "codex:done", lifecycle: "finished" })] }],
    });
    const totals = M.totalsOf(snap);
    expect(totals.working).toBe(1);
    expect(totals.unverified).toBe(1);
    expect(totals.live).toBe(1);
  });

  test("the settings preview classifies the board in hand, at the numbers being typed", () => {
    /* The panel's whole reason for existing: it says what these thresholds do to
       THIS board before the operator commits to them. Same classifier the
       server runs, so the preview and the post-save board agree. */
    const now = Date.parse("2026-07-22T03:00:00.000Z");
    const snap = snapshot({
      programs: [{
        id: "p", name: "P",
        agents: [
          { ...agent({ id: "codex:fresh" }), lifecycle: undefined, updatedAt: "2026-07-22T02:59:00.000Z" },
          { ...agent({ id: "codex:mid" }), lifecycle: undefined, updatedAt: "2026-07-22T02:55:00.000Z" },
          { ...agent({ id: "codex:quiet" }), lifecycle: undefined, updatedAt: "2026-07-22T02:40:00.000Z" },
        ],
      }],
    });

    // Defaults: 1 minute Working; 5 and 20 minutes both Waiting.
    expect(M.settingsPreview(snap, 3, 45, now)).toMatchObject({ working: 1, waiting: 2, unverified: 0 });
    // Focused shortens the quiet band to fifteen minutes, and the oldest moves.
    expect(M.settingsPreview(snap, 2, 15, now)).toMatchObject({ working: 1, waiting: 1, unverified: 1 });
    // Long-running keeps ten minutes of silence inside Working.
    expect(M.settingsPreview(snap, 10, 180, now)).toMatchObject({ working: 2, waiting: 1, unverified: 0 });
  });

  /* THE REPORTED BUG, in the operator's words: "the settings don't stick, the
     save button doesn't work."

     It did work. It posted, the server persisted, and the board reclassified —
     all of it in total silence. A write that changes what every session on the
     board is called and then says nothing is indistinguishable from a dead
     button, and it was reported as one. The panel now answers either way. */
  test("a save that worked says so, and one that failed says why", async () => {
    /* The verdict is written into a stable node in place, rather than appended
       as a child, so that it can appear, change and expire without rebuilding
       the form around it — see renderSettingsVerdict. */
    const verdictText = () => {
      const node = domById.get("settings-verdict");
      return node ? String(node.textContent ?? "") : "";
    };

    await withState({
      settingsPanelOpen: true,
      settings: { version: 2, activityFreshMinutes: 3, activityQuietMinutes: 45 },
      settingsSavedAt: Date.now(),
      settingsSaveError: "",
      snap: null,
    }, () => withDom(() => {
      M.renderSettingsPanel();
      expect(verdictText()).toContain("Saved");
      // And it says what the save actually did, not merely that a request went.
      expect(verdictText()).toContain("using these numbers now");
    }));

    /* The server rejects rather than clamping, so its sentence IS the answer.
       A toast alone would fade and leave an operator staring at a value they
       believe they saved. */
    await withState({
      settingsPanelOpen: true,
      settings: { version: 2, activityFreshMinutes: 3, activityQuietMinutes: 45 },
      settingsSavedAt: Date.now(),
      settingsSaveError: "activityQuietMinutes must be greater than activityFreshMinutes",
      snap: null,
    }, () => withDom(() => {
      M.renderSettingsPanel();
      expect(verdictText()).toContain("Not saved");
      expect(verdictText()).toContain("must be greater than");
      // The two verdicts must never render together — an error outranks a
      // stale success stamp, or the panel contradicts itself.
      expect(verdictText()).not.toContain("using these numbers now");
    }));

    // Nothing saved this session: no verdict at all, rather than a hopeful one.
    await withState({
      settingsPanelOpen: true,
      settings: { version: 2, activityFreshMinutes: 3, activityQuietMinutes: 45 },
      settingsSavedAt: 0,
      settingsSaveError: "",
      snap: null,
    }, () => withDom(() => {
      M.renderSettingsPanel();
      expect(verdictText()).not.toContain("Saved");
      expect(verdictText()).not.toContain("Not saved");
    }));
  });

  /* A confirmation that outlives the thing it confirms is a lie in waiting:
     reopening to "Saved" from ten minutes ago confirms a write the operator has
     stopped thinking about. */
  test("the saved confirmation expires rather than persisting", async () => {
    await withState({
      settingsPanelOpen: true,
      settings: { version: 2, activityFreshMinutes: 3, activityQuietMinutes: 45 },
      settingsSavedAt: Date.now() - 60_000,
      settingsSaveError: "",
      snap: null,
    }, () => withDom(() => {
      M.renderSettingsPanel();
      const node = domById.get("settings-verdict");
      expect(node ? String(node.textContent ?? "") : "").not.toContain("Saved");
    }));
  });

  test("the needs-you display control lives in Settings and applies instantly", async () => {
    /* Every other field in this panel is a fleet-shared server setting behind
       Save. This one is a per-browser display preference: it applies on click,
       writes localStorage rather than POSTing, and Save must not touch it. */
    const realLS = G.localStorage;
    const store = new Map<string, string>();
    G.localStorage = {
      getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
      setItem: (k: string, v: string) => { store.set(k, String(v)); },
      removeItem: (k: string) => { store.delete(k); },
    };
    try {
      await withState({
        settingsPanelOpen: true,
        settings: { version: 2, activityFreshMinutes: 3, activityQuietMinutes: 45 },
        settingsSavedAt: 0,
        settingsSaveError: "",
        needsYouDisplay: "pane",
        snap: null,
      }, () => withRequests([], async (calls) => {
        M.renderSettingsPanel();
        const panel = domById.get("settings-panel")!;
        const paneRadio = byFkey(panel, "needs-you-display-pane");
        const inlineRadio = byFkey(panel, "needs-you-display-inline");
        expect(paneRadio).not.toBe(null);
        expect(inlineRadio).not.toBe(null);
        expect(paneRadio.attributes.checked).toBe("");
        expect(inlineRadio.hasAttribute("checked")).toBe(false);
        expect(textOf(panel)).toContain("this browser only");

        await fire(inlineRadio, "change");
        expect(M.state.needsYouDisplay).toBe("inline");
        expect(store.get("mtn3-needs-you-display")).toBe("inline");
        // No server round-trip: the pref is not a setting the fleet shares.
        expect(calls).toHaveLength(0);
        /* And the panel repainted itself: the pref is in its paint signature,
           so the radio the operator just clicked reads as chosen — without
           this the form would keep the stale checkmark until a server value
           changed. */
        const rebuilt = byFkey(domById.get("settings-panel")!, "needs-you-display-inline");
        expect(rebuilt.attributes.checked).toBe("");
      }));
    } finally {
      G.localStorage = realLS;
    }
  });

  test("the preview sentence names all four states in the operator's words", () => {
    const text = M.settingsPreviewText({ working: 3, waiting: 14, unverified: 188, finished: 12, retained: 608 });
    expect(text).toContain("3 Working");
    expect(text).toContain("14 Waiting");
    expect(text).toContain("188 Unverified");
    // Finished and retained are one thing to an operator: they are in History.
    expect(text).toContain("620 History");
  });

  test("the presets fill the fields rather than storing a mode", () => {
    /* A stored mode is a fourth thing to reason about and hides the numbers it
       sets. These teach the thresholds by example. */
    expect(M.SETTINGS_PRESETS.map((p: { id: string }) => p.id))
      .toEqual(["focused", "balanced", "long-running"]);
    const balanced = M.SETTINGS_PRESETS.find((p: { id: string }) => p.id === "balanced");
    expect(balanced).toMatchObject({ fresh: 3, quiet: 45 });
    // Every preset keeps quiet longer than fresh, or it would delete the Waiting band.
    for (const preset of M.SETTINGS_PRESETS) expect(preset.quiet).toBeGreaterThan(preset.fresh);
  });
});

/* ---------------------------------------------------------------------------
   Atlas F1a — the board regroups on repo → worktree → role.

   The server (B2) now hands the client one program PER WORKTREE, tagged with
   `groupPath: [repoKey, worktreeKey]`, so five worktrees of one repository
   arrived as five sibling sections all printing the same name. These drive the
   real two-level path (syncProgramList) with real nodes, so they cover the
   grouping, the paint keys that keep rows alive across a 4s repaint, and the
   fallback that must stay exactly as it was for a session with no repo.
   ------------------------------------------------------------------------ */
describe("Atlas F1: repo sections, worktree subsections, role order", () => {
  function repoAgent(id: string, over: Record<string, unknown> = {}) {
    return agent({ id, status: "running", ...over });
  }
  function worktree(opts: {
    repoKey: string;
    repoName?: string;
    worktreeKey: string;
    path: string;
    branch?: string;
    agents: Record<string, unknown>[];
  }) {
    const repo = {
      repoKey: opts.repoKey,
      repoName: opts.repoName ?? "the-mountain",
      worktreePath: opts.path,
      branch: opts.branch,
      ephemeral: false,
    };
    return {
      id: `repo:${opts.repoKey}:worktree:${opts.worktreeKey}`,
      name: repo.repoName,
      path: opts.path,
      groupPath: [opts.repoKey, opts.worktreeKey],
      agents: opts.agents.map((a) => ({ ...a, repo })),
    };
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const visibleOf = (...programs: any[]) => programs.map((program) => ({ program, agents: program.agents }));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const paint = (root: any, visible: any[], over: Record<string, unknown> = {}) =>
    withDom(() => M.syncProgramList(root, visible, listUi({
      snap: { schemaVersion: 1, programs: visible.map((v) => v.program) },
      ...over,
    })));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rowIds = (node: any) => allByClass(node, "agent-row").map((n: any) => String(n.dataset.fkey).slice("agent:".length));
  const withoutRepo = (a: Record<string, unknown>) => {
    const copy = { ...a };
    delete copy.repo;
    return copy;
  };

  test("two worktrees of one repo render under a single repo section", () => {
    const main = worktree({
      repoKey: "k-two", worktreeKey: "wt-main", branch: "main",
      path: "/Users/e/Developer/the-mountain", agents: [repoAgent("codex:two-a")],
    });
    const lane = worktree({
      repoKey: "k-two", worktreeKey: "wt-lane", branch: "atlas-fe",
      path: "/Users/e/Developer/.worktrees/ah-atlas-fe", agents: [repoAgent("codex:two-b")],
    });
    const visible = visibleOf(main, lane);
    const root = newNode("div");

    const shown = paint(root, visible);

    // One section, not two: the repository is the group, the worktrees are its
    // subsections. `shown` still counts every row the filter admitted.
    expect(shown).toBe(2);
    expect(root.children.length).toBe(1);
    const section = root.children[0];
    expect(section.className).toContain("repo-section");
    expect(byClass(section, "repo-name").textContent).toBe("the-mountain");
    expect(textOf(byClass(section, "repo-head"))).toContain("2 worktrees");

    // The subsections carry only what distinguishes them: a checkout named
    // after the repo adds nothing the band has not said, so `main` stands
    // alone while the lane keeps its branch@directory pair.
    expect(allByClass(section, "program").length).toBe(2);
    expect(allByClass(section, "program-name").map((n: { textContent: string }) => n.textContent))
      .toEqual(["main", "atlas-fe@ah-atlas-fe"]);
    expect(rowIds(section)).toEqual(["codex:two-a", "codex:two-b"]);
  });

  test("one column header serves the whole band, and only while it is open", () => {
    /* Ten copies of five never-changing labels — one per worktree — were the
       strongest repeating rhythm on the measured board, and they set the
       perceived section grain at the CHECKOUT, which is why eleven checkouts
       read as eleven unrelated sections. The band draws the one copy; its
       worktrees draw rows only. A flat program is its own band and keeps its
       own header. */
    const main = worktree({
      repoKey: "k-col", worktreeKey: "wt-a", branch: "main",
      path: "/w/one", agents: [repoAgent("codex:col-a")],
    });
    const lane = worktree({
      repoKey: "k-col", worktreeKey: "wt-b", branch: "lane",
      path: "/w/two", agents: [repoAgent("codex:col-b")],
    });
    const root = newNode("div");
    paint(root, visibleOf(main, lane));
    const section = root.children[0];
    expect(allByClass(section, "agent-column-header")).toHaveLength(1);
    // The one copy is the band's, not a worktree's: it sits outside every
    // program body, above the subsections it labels.
    expect(allByClass(byClass(section, "repo-worktrees"), "agent-column-header")).toHaveLength(0);
    // The band head rolls up the whole population under it — before this, the
    // unit the operator buckets attention by had no numbers on it at all.
    expect(textOf(byClass(section, "repo-head"))).toContain("2agents");
    // The two class literals CSS distinguishes the shapes by.
    expect(allByClass(section, "program").every((n: { className: string }) => n.className.includes("is-banded"))).toBe(true);

    // Shut fold: no columns to label, no header.
    const shutRoot = newNode("div");
    paint(shutRoot, visibleOf(main, lane), { repoOverrides: new Map([["k-col", "closed"]]) });
    expect(allByClass(shutRoot.children[0], "agent-column-header")).toHaveLength(0);

    // The flat path is untouched: its own header, its own card.
    const flat = { id: "flat-1", name: "Home", agents: [repoAgent("codex:flat-a")] };
    const flatRoot = newNode("div");
    paint(flatRoot, [{ program: flat, agents: flat.agents }]);
    expect(allByClass(flatRoot.children[0], "agent-column-header")).toHaveLength(1);
    expect(flatRoot.children[0].className).toContain("is-flat");
  });

  test("a band's only checkout is labelled by its branch alone", () => {
    /* `@directory` earns its place by separating siblings; a lone checkout
       has none, and on the live board the directory half actively
       contradicted the band name above it (`…@the-mountain-main` under
       "the-ant-hill"). */
    const only = worktree({
      repoKey: "k-solo", repoName: "the-ant-hill", worktreeKey: "wt-solo",
      branch: "fix/cmux-control-health-lifecycle",
      path: "/Users/e/Developer/the-mountain-main", agents: [repoAgent("codex:solo-a")],
    });
    const root = newNode("div");
    paint(root, visibleOf(only));
    expect(byClass(root, "program-name").textContent).toBe("fix/cmux-control-health-lifecycle");
  });

  test("the Board head speaks the live lens, and discloses what the filter hid", () => {
    /* Sweep audit §8/§11: "554 ended" was the loudest number on the head while
       zero ended rows were below it, and the "session tokens" aggregate is not
       summable with anything visible. Both belong to History/Usage; the Board
       head describes the live lens and says when the body is filtered. */
    const busy = worktree({
      repoKey: "k-lens", worktreeKey: "wt-lens", branch: "lens", path: "/w/lens",
      agents: [
        repoAgent("codex:lens-a"),
        repoAgent("codex:lens-b", {
          status: "idle", lifecycle: "finished",
          tokens: { provenance: "observed", scope: "session", sessionTotal: 9_000_000 },
        }),
        repoAgent("codex:lens-c"),
      ],
    });
    const visible = [{ program: busy, agents: [busy.agents[0], busy.agents[2]] }];
    const root = newNode("div");
    withDom(() => M.syncProgramList(root, visible, listUi({
      view: "board", lookbackHours: null,
      snap: { schemaVersion: 1, programs: [busy] },
    })));
    for (const node of [byClass(root, "repo-head"), byClass(root, "program-head")]) {
      expect(textOf(node)).not.toContain("ended");
      expect(textOf(node)).not.toContain("session tokens");
    }
    expect(textOf(byClass(root, "head-shown"))).toBe("2 of 3 shown");

    // History keeps the full census — ended is the point there.
    const hist = newNode("div");
    withDom(() => M.syncProgramList(hist, visible, listUi({
      view: "history",
      snap: { schemaVersion: 1, programs: [busy] },
    })));
    expect(textOf(byClass(hist, "repo-head"))).toContain("ended");
    expect(byClass(hist, "head-shown")).toBe(null);
  });

  test("an open single-session worktree on the Board carries no rollup", () => {
    // Its one row IS the census, printed just below; "1 agent · 0 working"
    // over it was one fact wearing three cells. The band head keeps the
    // band-level census either way.
    const solo = worktree({
      repoKey: "k-solo2", worktreeKey: "wt-s2", branch: "solo", path: "/w/s2",
      agents: [repoAgent("codex:solo2-a")],
    });
    const root = newNode("div");
    paint(root, visibleOf(solo), { view: "board", lookbackHours: null });
    expect(byClass(byClass(root, "program-head"), "program-rollup")).toBe(null);
    expect(byClass(byClass(root, "repo-head"), "program-rollup")).not.toBe(null);
  });

  test("a lone worktree still groups under its repo, counted honestly", () => {
    const only = worktree({
      repoKey: "k-one", worktreeKey: "wt-only", branch: "main",
      path: "/Users/e/Developer/hormiga", repoName: "hormiga", agents: [repoAgent("codex:one-a")],
    });
    const root = newNode("div");

    paint(root, visibleOf(only));

    const section = root.children[0];
    expect(byClass(section, "repo-name").textContent).toBe("hormiga");
    expect(textOf(byClass(section, "repo-head"))).toContain("1 worktree");
    expect(textOf(byClass(section, "repo-head"))).not.toContain("1 worktrees");
  });

  /* The regression gate. Everything above is additive; a session whose cwd is
     not a git checkout must reach the same DOM it reached before this task. */
  test("a session with no repo keeps today's program section, untouched", () => {
    const program = {
      id: "cwd-loose-9x", name: "loose", path: "/tmp/loose",
      agents: [repoAgent("codex:loose-1"), repoAgent("codex:loose-2")],
    };
    const root = newNode("div");

    const shown = paint(root, visibleOf(program));

    expect(shown).toBe(2);
    expect(root.children.length).toBe(1);
    const section = root.children[0];
    expect(section.className).toContain("program");
    expect(allByClass(root, "repo-section").length).toBe(0);
    expect(byClass(section, "program-name").textContent).toBe("loose");
    expect(byFkey(section, "prog:cwd-loose-9x")).not.toBeNull();
    expect(byFkey(section, "prog-details:cwd-loose-9x")).not.toBeNull();
    expect(rowIds(section)).toEqual(["codex:loose-1", "codex:loose-2"]);
  });

  /* Role order is the third level of the new hierarchy, so it applies where
     that hierarchy does. The fallback path keeps the server's agentSortRank
     order exactly, which is what makes the no-repo section a true regression
     gate rather than a section that merely looks the same. */
  test("role order applies inside a worktree and leaves the fallback alone", () => {
    const roster = [
      repoAgent("codex:role-v", { role: "verifier" }),
      repoAgent("codex:role-o1", { role: "orchestrator" }),
      repoAgent("codex:role-o2", { role: "orchestrator" }),
      repoAgent("codex:role-plain"),
    ];
    const wt = worktree({
      repoKey: "k-role", worktreeKey: "wt-role", branch: "main",
      path: "/Users/e/Developer/roles", agents: roster,
    });
    const grouped = newNode("div");
    paint(grouped, visibleOf(wt));
    // Orchestrators lead; two of them keep the order the server sorted them in.
    expect(rowIds(grouped)).toEqual(["codex:role-o1", "codex:role-o2", "codex:role-v", "codex:role-plain"]);

    const flat = { id: "cwd-role-flat", name: "roles", agents: wt.agents.map(withoutRepo) };
    const loose = newNode("div");
    paint(loose, visibleOf(flat));
    expect(rowIds(loose)).toEqual(["codex:role-v", "codex:role-o1", "codex:role-o2", "codex:role-plain"]);
  });

  test("repo collapse is per repoKey and persists the way program collapse does", () => {
    const wt = worktree({
      repoKey: "k-collapse", worktreeKey: "wt-c", branch: "main",
      path: "/Users/e/Developer/collapsed", agents: [repoAgent("codex:col-1")],
    });
    const visible = visibleOf(wt);

    const shut = newNode("div");
    const shown = paint(shut, visible, { repoOverrides: new Map([["k-collapse", "closed"]]) });
    // The count is what the FILTER admitted, not what was drawn — a collapsed
    // repo hides rows without changing how many sessions matched.
    expect(shown).toBe(1);
    const section = shut.children[0];
    expect(allByClass(section, "program").length).toBe(0);
    expect(rowIds(section)).toEqual([]);
    expect(byFkey(section, "repo:k-collapse").attributes["aria-expanded"]).toBe("false");

    const open = newNode("div");
    paint(open, visible, { repoOverrides: new Map([["k-collapse", "open"]]) });
    expect(rowIds(open)).toEqual(["codex:col-1"]);
    expect(byFkey(open, "repo:k-collapse").attributes["aria-expanded"]).toBe("true");

    // Same storage shape as programOverrides, its own key, loaded at boot.
    const load = source.match(/function loadRepoOverrides\(\)[\s\S]*?\n\}/)?.[0] ?? "";
    expect(load).toContain('localStorage.getItem("mtn3-repos")');
    expect(source).toContain('localStorage.setItem("mtn3-repos"');
    expect(source).toContain("loadRepoOverrides();");
    const toggle = source.match(/function toggleRepo\([\s\S]*?\n\}/)?.[0] ?? "";
    expect(toggle).toContain("saveRepoOverrides()");
  });

  /* programId used to key every paint cache. The new axes need their own keys
     or the 4s tick rebuilds each row — which is how text selection, hover and
     keyboard focus die on this board. */
  test("a quiet repaint reuses the repo section, its worktrees and its rows", () => {
    const wt = worktree({
      repoKey: "k-quiet", worktreeKey: "wt-q", branch: "main",
      path: "/Users/e/Developer/quiet", agents: [repoAgent("codex:quiet-1"), repoAgent("codex:quiet-2")],
    });
    const visible = visibleOf(wt);
    const root = newNode("div");

    paint(root, visible);
    const section = root.children[0];
    const sub = byClass(byClass(section, "repo-worktrees"), "program");
    const rows = allByClass(section, "agent-row");
    expect(sub).not.toBe(section); // the worktree is a subsection, not the section
    expect(rows.length).toBe(2);

    paint(root, visible);

    expect(root.children[0]).toBe(section);
    expect(allByClass(root, "program")[0]).toBe(sub);
    expect(allByClass(root, "agent-row")[0]).toBe(rows[0]);
    expect(allByClass(root, "agent-row")[1]).toBe(rows[1]);
  });

  test("two repos sharing a worktree key keep their own sections and rows", () => {
    // Identical worktreeKey on purpose: the row key has to carry the repoKey or
    // one repo's rows are served out of the other's cache entry.
    const left = worktree({
      repoKey: "k-left", repoName: "left", worktreeKey: "same",
      path: "/a/app", branch: "main", agents: [repoAgent("codex:left-1")],
    });
    const right = worktree({
      repoKey: "k-right", repoName: "right", worktreeKey: "same",
      path: "/b/app", branch: "main", agents: [repoAgent("codex:right-1")],
    });
    const root = newNode("div");

    paint(root, visibleOf(left, right));

    expect(root.children.length).toBe(2);
    expect(allByClass(root, "repo-name").map((n: { textContent: string }) => n.textContent)).toEqual(["left", "right"]);
    expect(rowIds(root)).toEqual(["codex:left-1", "codex:right-1"]);
  });

  test("the board's paint signature carries the repo carets", () => {
    /* Same reason programOverrides is in there: toggleRepo mutates nothing else,
       so on a quiet fleet render()'s early return would swallow the click and
       the caret would sit there dead. */
    const wt = worktree({
      repoKey: "k-sig", worktreeKey: "wt-sig", branch: "main",
      path: "/Users/e/Developer/sig", agents: [repoAgent("codex:sig-1")],
    });
    const visible = visibleOf(wt);
    const ui = (over: Record<string, unknown> = {}) => listUi({
      snap: { schemaVersion: 1, programs: [wt] }, ...over,
    });

    expect(M.programsPaintSig(visible, ui({ repoOverrides: new Map([["k-sig", "closed"]]) })))
      .not.toBe(M.programsPaintSig(visible, ui()));
  });

  /* ------------------------------------------------------------------------
     F1b — a declared run outranks the checkout it happens to have been read in.

     B3 sets `groupPath[1] = "run:<runId>"` when a manifest or ANTHILL_RUN
     declares one, and a run SPANS worktrees: the live atlas run holds four
     lanes in four different checkouts, so `branch@basename` on that subsection
     names one lane's branch and is simply false about the other three. The
     declared runId is the only honest label there — and it is a fact rather
     than a derivation, which is the whole point of the spawn contract.
     --------------------------------------------------------------------- */
  test("a declared run replaces the worktree label", () => {
    // Shaped after the real wire: the run's first agent sits in ONE lane's
    // worktree, and that lane's branch must not become the subsection's name.
    const run = worktree({
      repoKey: "k-run", worktreeKey: "run:agent-atlas-2026-08-05",
      branch: "ant-hill/atlas-links-20260805",
      path: "/Users/e/Developer/.worktrees/ah-atlas-links-20260805",
      agents: [repoAgent("codex:run-1"), repoAgent("codex:run-2")],
    });
    const root = newNode("div");

    paint(root, visibleOf(run));

    const name = byClass(root, "program-name");
    expect(name.textContent).toBe("agent-atlas-2026-08-05");
    // Not the lane it was read in, and not a path shape at all.
    expect(name.textContent).not.toContain("@");
    expect(name.textContent).not.toContain("atlas-links");
    expect(rowIds(root)).toEqual(["codex:run-1", "codex:run-2"]);
  });

  test("a run and a plain worktree share one band, each labelled by its own rule", () => {
    const run = worktree({
      repoKey: "k-mixed", worktreeKey: "run:inbox-ux-overhaul-2026-08-05",
      branch: "feat/inbox", path: "/Users/e/Developer/.worktrees/inbox",
      agents: [repoAgent("codex:mixed-run")],
    });
    const checkout = worktree({
      repoKey: "k-mixed", worktreeKey: "1dao78j", branch: "main",
      path: "/Users/e/Developer/the-mountain-main",
      agents: [repoAgent("codex:mixed-wt")],
    });
    const root = newNode("div");

    paint(root, visibleOf(run, checkout));

    expect(root.children.length).toBe(1);
    expect(allByClass(root, "program-name").map((n: { textContent: string }) => n.textContent))
      .toEqual(["inbox-ux-overhaul-2026-08-05", "main@the-mountain-main"]);
    // Distinct paint keys, so neither subsection is served the other's rows.
    expect(rowIds(root)).toEqual(["codex:mixed-run", "codex:mixed-wt"]);
  });

  test("an operator's own label still outranks the declared run", async () => {
    const run = worktree({
      repoKey: "k-alias", worktreeKey: "run:some-run-2026-08-05", branch: "main",
      path: "/Users/e/Developer/aliased", agents: [repoAgent("codex:alias-1")],
    });
    const root = newNode("div");

    await withState({ aliases: new Map([[`program:${run.id}`, "Ridge"]]) }, () => {
      paint(root, visibleOf(run));
    });

    // Renaming a subsection has to mean something, whatever the server declared.
    expect(byClass(root, "program-name").textContent).toBe("Ridge");
  });

  /* Found by driving the helpers against the live /api/snapshot rather than a
     fixture: eight disposable codex checkouts of one repo all rendered the
     label "elio-intelligence-suite" — the repository name, printed eight times
     inside a band whose header already says it once. That is the exact
     smorgasbord this task exists to remove, one level down.

     `~/.codex/worktrees/<hash>/<repo>` has no branch and a basename equal to
     the repository name, so both of the distinguishing facts were empty and the
     label fell all the way through to `program.name`. What actually tells those
     checkouts apart is the directory ABOVE them. */
  test("a checkout whose folder repeats the repo name is named by the folder above it", () => {
    const disposable = (hash: string, id: string) => worktree({
      repoKey: "k-eph", repoName: "elio-intelligence-suite", worktreeKey: "wt-" + hash,
      path: `/Users/e/.codex/worktrees/${hash}/elio-intelligence-suite`,
      agents: [repoAgent(id)],
    });
    // Same repo, same basename, but this one has a branch to be known by.
    const checkout = worktree({
      repoKey: "k-eph", repoName: "elio-intelligence-suite", worktreeKey: "wt-home",
      branch: "fix/history-rich-detail-drawer",
      path: "/Users/e/elio-intelligence-suite", agents: [repoAgent("codex:eph-home")],
    });
    const root = newNode("div");

    paint(root, visibleOf(disposable("0d42", "codex:eph-a"), disposable("21a3", "codex:eph-b"), checkout));

    const labels = allByClass(root, "program-name").map((n: { textContent: string }) => n.textContent);
    expect(labels).toEqual(["0d42", "21a3", "fix/history-rich-detail-drawer"]);
    // The whole point: no subsection under a band may repeat the band's name.
    expect(labels).not.toContain("elio-intelligence-suite");
    expect(new Set(labels).size).toBe(labels.length);
  });

  /* B2.1 collapsed every undeclared disposable checkout of one repo into a
     single `ephemeral` leaf and named it "disposable checkouts" — ARCHITECTURE
     says so in those words. The client was overriding that name with
     branch@checkout read off whichever agent sorted first, so a leaf spanning
     NINE worktrees wore one of them: the-mountain's ephemeral leaf (4 distinct
     worktrees) was labelled `ant-hill/atlas-fe-20260805@ah-atlas-fe-20260805`.

     Same rule as the declared run, one leaf over: a subsection that spans
     checkouts cannot wear one checkout's name. */
  test("the collapsed ephemeral leaf keeps the name the server gave it", () => {
    const eph = {
      id: "repo:k-eph2:ephemeral",
      name: "disposable checkouts",
      groupPath: ["k-eph2", "ephemeral"],
      agents: [
        repoAgent("codex:e1", {
          repo: {
            repoKey: "k-eph2", repoName: "the-mountain", ephemeral: true,
            branch: "ant-hill/atlas-fe-20260805",
            worktreePath: "/Users/e/Developer/.worktrees/ah-atlas-fe-20260805",
          },
        }),
        repoAgent("codex:e2", {
          repo: {
            repoKey: "k-eph2", repoName: "the-mountain", ephemeral: true,
            worktreePath: "/Users/e/.codex/worktrees/9a01/the-mountain",
          },
        }),
      ],
    };
    const root = newNode("div");
    paint(root, [{ program: eph, agents: eph.agents, finished: [] }]);

    const label = byClass(root, "program-name").textContent;
    expect(label).toBe("disposable checkouts");
    expect(label).not.toContain("atlas-fe");
    expect(label).not.toContain("@");
  });

  test("the repo band ships its own rules rather than borrowing the program card", () => {
    for (const rule of [".repo-section", ".repo-head", ".repo-caret", ".repo-name", ".repo-worktrees"]) {
      expect(styles.includes(rule), rule).toBe(true);
    }
  });
});

/* ---------------------------------------------------------------------------
   Atlas F2 — lineage confidence and message provenance.

   Two facts B3/B4 put on the wire that nothing rendered: HOW a role was decided
   (`roleSource`: 1006 inferred / 164 observed / 4 declared on the live board),
   and WHO sent the instruction a session is working from.

   The second matters more than it sounds. The drawer labels `lastUserMessage`
   "You" — and for every lane in every swarm that message was sent by another
   AGENT, not by the operator. The producer helper prefixes those with
   `[from <agent.id> run <runId>]`, so the envelope is right there in the text
   being misattributed. Parsing it is what makes an unheaded user turn mean
   something: that one really was the human.
   ------------------------------------------------------------------------ */
describe("Atlas F2: role confidence and message provenance", () => {
  // Verbatim from the live wire (this lane's own lastUserMessage).
  const HEADER = "[from claude:8c052fe9-db5c-47c4-9e21-e9b623dd6c82 run agent-atlas-2026-08-05]";
  const ORCH = "claude:8c052fe9-db5c-47c4-9e21-e9b623dd6c82";
  const RUN = "agent-atlas-2026-08-05";

  test("the producer header parses into a sender, a run and the message itself", () => {
    const parsed = M.parseSenderHeader(`${HEADER} F2 is UNLOCKED — B4 landed.`);
    expect(parsed).toEqual({ agentId: ORCH, runId: RUN, body: "F2 is UNLOCKED — B4 landed." });
  });

  test("only a leading header is provenance; a quoted one is prose", () => {
    /* An agent that quotes an instruction back — extremely common — must not
       have its own message attributed to whoever it quoted. The envelope is a
       claim about THIS message's origin, so it only counts at the front. */
    expect(M.parseSenderHeader(`I read "${HEADER} do the thing" and started.`)).toBeNull();
    expect(M.parseSenderHeader("[from someone] no run named")).toBeNull();
    expect(M.parseSenderHeader("plain operator message")).toBeNull();
    expect(M.parseSenderHeader("")).toBeNull();
    expect(M.parseSenderHeader(null)).toBeNull();
  });

  test("senderOf reads the fields that actually carry the header", () => {
    /* The plan named `lastHumanMessage`; the live wire puts the envelope on
       `lastUserMessage` and `task` — `lastHumanMessage` mirrored the AGENT's
       reply on all four atlas lanes. Read all three, request first. */
    expect(M.senderOf(agent({ lastUserMessage: `${HEADER} do the thing` })))
      .toEqual({ agentId: ORCH, runId: RUN });
    expect(M.senderOf(agent({ lastUserMessage: null, task: `${HEADER} you are lane fe-regroup` })))
      .toEqual({ agentId: ORCH, runId: RUN });
    // Absence is the signal that a human really did send it.
    expect(M.senderOf(agent({ lastUserMessage: "ship it", task: "ship it" }))).toBeNull();
  });

  test("a row never spends its width on the envelope", () => {
    /* Live defect: every lane's `task` begins with the 74-character header, and
       rowSummary falls back to `task`, so half a 120-character row was machine
       addressing before this. */
    const summary = M.rowSummary(agent({
      lastHumanMessage: null,
      task: `${HEADER} You are lane fe-regroup. Read the brief in full.`,
    }));
    expect(summary).not.toContain("[from ");
    expect(summary).not.toContain(ORCH);
    expect(summary).toContain("Read the brief in full");
    /* And with the envelope off the front, conciseText's existing "you are"
       trim finally reaches the text it was written for — it never could while
       74 characters of addressing sat in front of it. */
    expect(summary).toBe("lane fe-regroup. Read the brief in full.");
  });

  test("an agent-sent instruction is attributed to the agent, not to \"You\"", () => {
    /* Deliberately NOT named after the run: in this run the orchestrator's
       manifest name happens to equal the runId, which would let a renderer that
       printed only one of the two facts pass while showing the other. */
    const orchestrator = agent({ id: ORCH, displayName: "atlas-orchestrator" });
    const lane = agent({
      id: "claude:lane", displayName: "fe-regroup",
      lastAgentMessage: null,
      lastUserMessage: `${HEADER} F2 is UNLOCKED — B4 landed.`,
    });
    const snap = { schemaVersion: 1, programs: [{ id: "p", name: "P", agents: [orchestrator, lane] }] };

    const pane = withDom(() => M.renderChat(lane, { snap }));
    const turn = byClass(pane, "chat-turn--user");
    const role = byClass(turn, "chat-turn-role");

    expect(textOf(role)).not.toContain("You");
    // Named by whoever sent it — resolved against the board, not printed raw.
    expect(textOf(role)).toBe("atlas-orchestrator");
    expect(textOf(role)).not.toContain(ORCH);
    // The run it was sent under is the other half of the provenance, and it is
    // a DIFFERENT string from the sender's name.
    expect(textOf(byClass(turn, "chat-turn-sender"))).toContain(RUN);
    // And the envelope is gone from the prose it was wrapping.
    expect(textOf(byClass(turn, "chat-turn-body"))).toBe("F2 is UNLOCKED — B4 landed.");
    expect(textOf(turn)).not.toContain("[from ");
  });

  test("an unheaded user turn still says You — absence is the signal", () => {
    const lane = agent({ id: "claude:solo", lastAgentMessage: null, lastUserMessage: "ship it" });
    const pane = withDom(() => M.renderChat(lane, { snap: { schemaVersion: 1, programs: [] } }));
    expect(textOf(byClass(pane, "chat-turn-role"))).toBe("You");
  });

  test("role confidence is a visible difference, not a hidden field", () => {
    // declared solid, observed outline, inferred dashed + why.
    const chipFor = (over: Record<string, unknown>) => {
      const program = { id: "p", name: "P", agents: [agent({ id: "codex:rs", role: "orchestrator", ...over })] };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pane: any = withDom(() => {
        const p = (globalThis as unknown as { document: { createElement(t: string): unknown } })
          .document.createElement("div");
        M.renderProgramDrawer(p, { program });
        return p;
      });
      return byClass(pane, "role-chip");
    };

    expect(chipFor({ roleSource: "declared" }).className).toContain("role-src-declared");
    expect(chipFor({ roleSource: "observed" }).className).toContain("role-src-observed");
    const inferred = chipFor({ roleSource: "inferred" });
    expect(inferred.className).toContain("role-src-inferred");
    // A guess has to say it is one, in words, where the operator is looking.
    expect(String(inferred.attributes.title)).toContain("inferred");
    // An absent roleSource claims nothing rather than claiming certainty.
    expect(chipFor({}).className).not.toContain("role-src-declared");
  });

  test("specialty survives B4's demotion as its own chip", () => {
    /* B4 moved frontend/backend out of the role union and into `specialty`
       because they described territory, not authority. Nothing rendered the new
       field, so a session that read "Frontend / designer" before the demotion
       read "Worker" after it — the fact was on the wire and off the screen. */
    const program = {
      id: "p", name: "P",
      agents: [agent({ id: "codex:sp", role: "worker", roleSource: "declared", specialty: "frontend" })],
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pane: any = withDom(() => {
      const p = (globalThis as unknown as { document: { createElement(t: string): unknown } })
        .document.createElement("div");
      M.renderProgramDrawer(p, { program });
      return p;
    });
    expect(textOf(pane)).toContain("Worker");
    expect(byClass(pane, "specialty-chip")).not.toBeNull();
    expect(textOf(byClass(pane, "specialty-chip")).toLowerCase()).toContain("frontend");
  });

  test("B4's new roles are styled, not left to fall through to the neutral default", () => {
    // worker/human/monitor/service arrived with B4 and had no rules at all;
    // 13 live sessions are workers.
    for (const role of [".role-worker", ".role-human", ".role-monitor", ".role-service"]) {
      expect(styles.includes(role), role).toBe(true);
    }
    for (const src of [".role-src-declared", ".role-src-observed", ".role-src-inferred"]) {
      expect(styles.includes(src), src).toBe(true);
    }
    expect(styles).toContain(".chat-turn-sender");
    expect(styles).toContain(".specialty-chip");
  });
});

/* ---------------------------------------------------------------------------
   Atlas F3 — liveness truth and the finished shelf.

   The plan asks for `hookLifecycle: "needsInput"` to reach the row "even when
   hibernated-dark". Driven against the live board first, that instruction taken
   literally would have put 45 GHOSTS on it: of the 46 sessions whose cmux hook
   record says needsInput, 45 carry processState "died", processAlive false and
   a COMPLETE process roster — the hook froze at needsInput because the process
   died without a clean exit, hours to a day ago. Exactly one is genuinely live,
   and it was already reaching the operator.

   So the rule is not "the hook says needsInput". It is "the hook says needsInput
   AND nothing has since proven the session gone" — which is what the codebase's
   existing scar (alerting()'s rescue arm) has been saying about ghost rows all
   along.
   ------------------------------------------------------------------------ */
describe("Atlas F3: hook-store liveness and the finished shelf", () => {
  // A session cmux says is blocked on a human, quiet for two hours, whose
  // process still answers. This is "hibernated-dark": nothing has been written
  // to the transcript, so recency alone reads it as merely quiet.
  const darkAsker = (over: Record<string, unknown> = {}): Record<string, unknown> => agent({
    id: "claude:dark",
    hookLifecycle: "needsInput",
    lifecycle: "waiting",
    processState: "running",
    processAlive: true,
    attentionSignal: undefined,
    updatedAt: new Date(Date.now() - 2 * 3_600_000).toISOString(),
    ...over,
  });

  test("a hook that says needsInput reaches the operator without a text signal", () => {
    /* The provider hook is a DECLARED fact — the agent told cmux it is blocked.
       Every other route to the strip reads prose and guesses. Declared beats
       inferred is this whole program's thesis; it has to hold here too. */
    const dark = darkAsker();
    expect(dark.attentionSignal).toBeUndefined();
    expect(M.wantsHuman(dark)).toBe(true);
    expect(M.alerting(dark)).toBe(true);
    expect(M.viewMatches("board", dark)).toBe(true);
    expect(M.needsYouStrip([{ program: { id: "p", name: "P", agents: [dark] }, agents: [dark] }]))
      .toHaveLength(1);
  });

  test("a frozen hook record never resurrects a session proven gone", () => {
    /* The live shape of all 45: checked by id, complete roster, nothing claims
       it — with the hook still reading needsInput from before it died. */
    const ghost = darkAsker({
      id: "claude:ghost",
      lifecycle: "finished",
      processState: "died",
      processAlive: false,
      processRosterComplete: true,
      endEvidence: "turn-complete",
    });
    expect(ghost.hookLifecycle).toBe("needsInput");
    expect(M.wantsHuman(ghost)).toBe(false);
    expect(M.alerting(ghost)).toBe(false);
    expect(M.viewMatches("board", ghost)).toBe(false);

    // Same for a retained record whose hook happened to freeze mid-question.
    const retained = darkAsker({ id: "claude:retained", scope: "retained" });
    expect(M.wantsHuman(retained)).toBe(false);
  });

  test("an idle or running hook is not a request for a person", () => {
    // Only needsInput is a claim about wanting a human. The others say what the
    // session is DOING, which the lifecycle already answers.
    for (const hook of ["idle", "running", "unknown"]) {
      expect(M.wantsHuman(darkAsker({ hookLifecycle: hook }))).toBe(false);
    }
  });

  /* ---- the finished shelf ---------------------------------------------- */

  const liveOne = (id: string) => agent({ id, status: "running", lifecycle: "working" });
  const doneOne = (id: string) => agent({ id, lifecycle: "finished", scope: "observed", endEvidence: "session-exit" });

  function shelfBoard(over: Record<string, unknown> = {}) {
    const program = {
      id: "shelf-prog", name: "shelf", path: "/x/shelf",
      groupPath: ["k-shelf", "wt-shelf"],
      agents: [liveOne("codex:live-1"), doneOne("codex:done-1"), liveOne("codex:live-2"), doneOne("codex:done-2")],
    };
    // What the board view admits: the two live sessions. The finished pair is
    // what renderPrograms hands over as the shelf population.
    const live = [program.agents[0]!, program.agents[2]!];
    const finished = [program.agents[1]!, program.agents[3]!];
    const visible = [{ program, agents: live, finished }];
    const root = newNode("div");
    const shown = withDom(() => M.syncProgramList(root, visible, listUi({
      view: "board",
      snap: { schemaVersion: 1, programs: [program] },
      ...over,
    })));
    return { root, shown, program };
  }

  test("finished sessions are a counted shelf, not rows interleaved with live work", () => {
    const { root, shown } = shelfBoard();

    // The live rows, and only the live rows.
    const ids = allByClass(root, "agent-row").map((n: { dataset: { fkey: string } }) => n.dataset.fkey);
    expect(ids).toEqual(["agent:codex:live-1", "agent:codex:live-2"]);

    const shelf = byClass(root, "finished-shelf");
    expect(shelf).not.toBeNull();
    expect(textOf(shelf)).toContain("Finished");
    expect(textOf(shelf)).toContain("2");
    expect(shelf.attributes["aria-expanded"]).toBe("false");

    /* The count the shelf carries is the one that made the header confusing:
       the rollup counts the whole program (4) while the body drew 2. `shown`
       still reports what the FILTER admitted, so the shelf cannot inflate it. */
    expect(shown).toBe(2);
  });

  test("opening the shelf draws the finished rows and still does not count them", () => {
    const { root, shown } = shelfBoard({ shelfOverrides: new Map([["shelf-prog", "open"]]) });
    const ids = allByClass(root, "agent-row").map((n: { dataset: { fkey: string } }) => n.dataset.fkey);
    expect(ids).toEqual([
      "agent:codex:live-1", "agent:codex:live-2",
      "agent:codex:done-1", "agent:codex:done-2",
    ]);
    expect(byClass(root, "finished-shelf").attributes["aria-expanded"]).toBe("true");
    expect(shown).toBe(2);
  });

  test("History grows no shelf — there, finished IS the population", () => {
    /* A shelf holding 100% of the rows is not a shelf, it is a collapsed view.
       History opens to look at finished sessions; hiding them all behind one
       caret would be the single worst thing this feature could do. */
    const program = {
      id: "hist-prog", name: "hist",
      agents: [doneOne("codex:h1"), doneOne("codex:h2")],
    };
    const visible = [{ program, agents: program.agents, finished: [] }];
    const root = newNode("div");
    withDom(() => M.syncProgramList(root, visible, listUi({
      view: "history",
      programOverrides: new Map([["hist-prog", "open"]]),
      snap: { schemaVersion: 1, programs: [program] },
    })));
    expect(byClass(root, "finished-shelf")).toBeNull();
    expect(allByClass(root, "agent-row")).toHaveLength(2);
  });

  test("a worktree with nothing finished grows no shelf at all", () => {
    const program = {
      id: "clean-prog", name: "clean", groupPath: ["k-clean", "wt-clean"],
      agents: [liveOne("codex:c1")],
    };
    const root = newNode("div");
    withDom(() => M.syncProgramList(root, [{ program, agents: program.agents, finished: [] }], listUi({
      view: "board", snap: { schemaVersion: 1, programs: [program] },
    })));
    expect(byClass(root, "finished-shelf")).toBeNull();
  });

  test("the shelf's collapse persists per program and reaches the paint signature", () => {
    const fn = source.match(/function loadShelfOverrides\(\)[\s\S]*?\n\}/)?.[0] ?? "";
    expect(fn).toContain('localStorage.getItem("mtn3-shelves")');
    expect(fn).toContain('mode === "open"');       // collapsed is the default
    expect(source).toContain('localStorage.setItem("mtn3-shelves"');
    expect(source).toContain("loadShelfOverrides();");

    const program = {
      id: "sig-shelf", name: "s", groupPath: ["k", "w"],
      agents: [liveOne("codex:s1"), doneOne("codex:s2")],
    };
    const visible = [{ program, agents: [program.agents[0]!], finished: [program.agents[1]!] }];
    const ui = (over: Record<string, unknown> = {}) =>
      listUi({ view: "board", snap: { schemaVersion: 1, programs: [program] }, ...over });
    expect(M.programsPaintSig(visible, ui({ shelfOverrides: new Map([["sig-shelf", "open"]]) })))
      .not.toBe(M.programsPaintSig(visible, ui()));
  });

  /* The lookback clause is the shelf's only governor, and it is doing more work
     than it looks. Measured on the live board, one worktree holds 448 sessions:
     at the default 24h lookback its shelf reads 15, at 72h it reads 131, and
     with the lookback off entirely it reads 446. The shelf answers "where did
     the rows that were just here go?" — not "show me the archive", which is
     what History is for. Remove this clause and a live view grows a 446-row
     shelf with no test to notice. */
  test("the shelf holds recent finishes, not the archive", async () => {
    const old = doneOne("codex:ancient");
    old.updatedAt = new Date(Date.now() - 30 * 24 * 3_600_000).toISOString();
    const recent = doneOne("codex:recent");
    recent.updatedAt = new Date(Date.now() - 30 * 60_000).toISOString();
    const program = { id: "look-prog", name: "look", agents: [old, recent] };

    await withState({ view: "board", lookbackHours: 24, query: "", facetProgram: "", facetProviders: [] }, () => {
      const keep = M.shelfFilter();
      expect(keep(recent, program)).toBe(true);
      expect(keep(old, program)).toBe(false);
    });

    // An operator who turns the lookback off has asked for everything, and the
    // shelf is collapsed by default — so that costs them one line until they say
    // otherwise, which is their call to make.
    await withState({ view: "board", lookbackHours: null, query: "", facetProgram: "", facetProviders: [] }, () => {
      expect(M.shelfFilter()(old, program)).toBe(true);
    });

    // A search narrows the shelf exactly as it narrows the rows: a filtered
    // board must not grow a shelf of sessions that do not match it.
    await withState({ view: "board", lookbackHours: 24, query: "nothing-matches-this", facetProgram: "", facetProviders: [] }, () => {
      expect(M.shelfFilter()(recent, program)).toBe(false);
    });
  });

  test("the shelf ships its own rules", () => {
    expect(styles).toContain(".finished-shelf");
    expect(styles).toContain(".finished-shelf-count");
  });
});

/* ---------------------------------------------------------------------------
   Atlas F4 — the prose has to describe the board that shipped.

   ANT-GUIDE said the fleet was "grouped by workstream" and ARCHITECTURE's
   Client section named every module without ever saying how the board is
   arranged. Both were true before this program and neither survived it. These
   assert the same way tests/ant-guide.test.ts does — the doc must contain the
   vocabulary the client actually renders — so the next change to the hierarchy
   fails here by name instead of drifting silently.
   ------------------------------------------------------------------------ */
describe("Atlas F4: the guide and the architecture map describe this board", () => {
  let guide = "";
  let architecture = "";
  beforeAll(() => {
    guide = readFileSync(join(import.meta.dir, "../ANT-GUIDE.md"), "utf8");
    architecture = readFileSync(join(import.meta.dir, "../ARCHITECTURE.md"), "utf8");
  });

  test("the guide names the three levels an operator actually sees", () => {
    // The words on screen, not a paraphrase of them.
    for (const phrase of ["repository", "worktree", "run"]) {
      expect(guide.toLowerCase(), `guide never mentions ${phrase} grouping`).toContain(phrase);
    }
    // The stale claim this program invalidated.
    expect(guide).not.toContain("grouped by workstream");
  });

  test("the guide explains the Finished shelf, including why it is not the archive", () => {
    /* Named, not merely mentioned: "Finished" is already a lifecycle word in
       this guide, so asserting the bare word passes on prose that never
       describes the control. */
    expect(guide).toContain("Finished shelf");
    // The governor is the part an operator has to know, or the shelf reads as
    // broken the first time a session they remember is not in it.
    const shelf = guide.slice(guide.indexOf("Finished shelf"));
    expect(shelf.slice(0, 1200).toLowerCase()).toContain("lookback");
    expect(shelf.slice(0, 1200)).toContain("History");
  });

  test("the guide explains role confidence in the words the chip uses", () => {
    // The guide's own convention for a value the client renders, matching how
    // tests/ant-guide.test.ts pins every other chip vocabulary.
    for (const word of ["declared", "observed", "inferred"]) {
      expect(guide, `guide omits the ${word} role source`).toContain(`**${word}**`);
      expect(source, `${word} is not a roleSource the client renders`).toContain(`role-src-${word}`);
    }
  });

  test("the guide says who a message came from when it was not the operator", () => {
    /* The single most misleading thing the drawer used to do. An operator
       reading "You" over an instruction they never sent needs the guide to have
       told them what changed. */
    expect(guide).toContain("[from ");
    expect(guide.toLowerCase()).toContain("sent in run");
  });

  test("ARCHITECTURE maps the board's grouping and its paint keys", () => {
    for (const symbol of ["repoGroups", "worktreeLabel", "shelfFilter", "parseSenderHeader"]) {
      expect(architecture, `ARCHITECTURE stopped naming ${symbol}`).toContain(symbol);
      expect(source, `${symbol} is not a function this client defines`).toContain("function " + symbol);
    }
    // The reason the keys exist at all — a reader who does not know this will
    // key the next grouping axis on programId and rebuild every row every 4s.
    expect(architecture).toContain("groupPath");
    expect(architecture.toLowerCase()).toContain("paint key");
  });

  test("the guide says a cmux pane title is not a rename", () => {
    /* T7a. The guide's naming paragraph already claimed "an operator rename
       wins first; a run manifest wins next" — and the client was inserting a
       third thing between them that the operator never typed. The behavior now
       matches the sentence, so the sentence has to say which titles it is
       refusing, or the next reader re-introduces the same shortcut. */
    const chain = guide.slice(guide.indexOf("Names follow one precedence chain"));
    expect(chain.slice(0, 1400)).toContain("cmux");
    expect(chain.slice(0, 1400)).toContain("Terminal:");
    // And the client really does keep it, rather than dropping it on the floor.
    expect(source).toContain('"Terminal: " + terminal');
  });

  test("the guide explains the session tag an operator sees beside a name", () => {
    // The tag is the one part of a name an operator cannot re-derive, and its
    // rule is counter-intuitive: the fleet keeps it, the view decides to print.
    expect(guide).toContain("session tag");
    /* From the start of the sentence, not from the phrase: the example the
       operator is matching against ("#8da7e056") comes BEFORE the words that
       name it, which is the order the eye reads a row in. */
    const tag = guide.slice(guide.indexOf("session tag") - 200, guide.indexOf("session tag") + 700);
    expect(tag).toMatch(/#[0-9a-f]{8}/);
    // Why a unique-looking row shows none — the half a reader gets wrong.
    expect(tag.toLowerCase()).toContain("same words");
  });

  test("ARCHITECTURE names the one place the client decides a printed name", () => {
    for (const symbol of ["visibleSessionTag", "rowDisplayName"]) {
      expect(architecture, `ARCHITECTURE stopped naming ${symbol}`).toContain(symbol);
      expect(source, `${symbol} is not a function this client defines`).toContain("function " + symbol);
    }
    /* The other half of the rule lives in presentation.js. `source` is every
       src/web/*.js concatenated for exactly this reason: a symbol the docs
       quote can move between client modules without a reader seeing a change. */
    expect(architecture).toContain("declaredIdentity");
    expect(source).toContain("function declaredIdentity");
  });

  test("the guide explains parked and done without claiming the session ended", () => {
    /* T7. The distinction the whole contract turns on, and the one an operator
       will get wrong first: parking is about the WORK. A guide that let a reader
       believe a parked row had ended would undo the reason the rule was kept out
       of lifecycle.ts. */
    const chips = "`Parked` and `Done` are about the work";
    expect(guide).toContain(chips);
    const parked = guide.slice(guide.indexOf(chips), guide.indexOf(chips) + 1400);
    expect(parked.toLowerCase()).toContain("still");   // the session is still live
    expect(parked).toContain("Finished shelf");        // where a done lane goes
    // Both words the chip can print are explained, not just the one.
    expect(parked).toContain("Done");
    // And the client really does render exactly these two.
    expect(source).toContain("task-state-chip");
    expect(Object.keys(M.state).length).toBeGreaterThan(0);
  });

  test("the guide says what Needs-you admits, including the way back in", () => {
    /* The re-alert is the half a reader has to be told, because it is what makes
       parking safe to use: standing a lane down does not gag it. */
    const admits = "What the strip admits";
    expect(guide).toContain(admits);
    const strip = guide.slice(guide.indexOf(admits), guide.indexOf(admits) + 900).toLowerCase();
    expect(strip).toContain("parked");
    expect(strip).toContain("asks");
  });

  test("ARCHITECTURE maps the client half of the task-state contract", () => {
    for (const symbol of ["declaredQuiet", "declaredDone"]) {
      expect(architecture, `ARCHITECTURE stopped naming ${symbol}`).toContain(symbol);
      expect(source, `${symbol} is not a function this client defines`).toContain("function " + symbol);
    }
    // The mirror is the whole reason the two sides agree; naming it is the point.
    expect(architecture).toContain("task-state.js");
    // And the reason `alerting` needed its own gate: outcome is the second door.
    expect(architecture.toLowerCase()).toContain("attention");
  });

  test("the guide describes the sender mark as evidence, never as a verdict", () => {
    /* Pinned because it was a judgement call under pressure and the reasoning has
       to survive it: the board reports that a claimed sender's transcript does
       not contain a message. Whether that is a forgery is not something the
       client can see. */
    expect(guide).toContain("Sender unconfirmed");
    const mark = guide.slice(guide.indexOf("Sender unconfirmed"), guide.indexOf("Sender unconfirmed") + 900);
    expect(mark.toLowerCase()).toContain("transcript");
    expect(mark.toLowerCase()).not.toContain("forged");
    expect(source).toContain("sender-unconfirmed");
  });

  test("the two assets ship under one cache-buster token", () => {
    /* Not a pin on the value — that would need editing on every bump, which is
       the one thing a cache-buster must not make annoying. The invariant is
       that they AGREE: a stylesheet left on the previous token against a fresh
       app.js is a stale-CSS bug that reproduces only on machines that happened
       to cache the old file, which is the worst kind to be handed. */
    const tokens = [...html.matchAll(/(?:styles\.css|app\.js)\?v=([\w.-]+)/g)].map((m) => m[1]);
    expect(tokens).toHaveLength(2);
    expect(new Set(tokens).size, `index.html ships mismatched cache-busters: ${tokens.join(" vs ")}`).toBe(1);
  });

  test("ARCHITECTURE names the storage keys the board persists collapse under", () => {
    // Four collapse controls now, each with its own key; a fifth added without
    // a line here is the drift this catches.
    for (const key of ["mtn3-programs", "mtn3-repos", "mtn3-swarms", "mtn3-shelves"]) {
      expect(architecture, `ARCHITECTURE omits ${key}`).toContain(key);
      expect(source, `${key} is not a key the client writes`).toContain(`"${key}"`);
    }
  });
});

/* ---------------------------------------------------------------------------
   Atlas F4 — focus survives the 4 s tick under the new keys.

   The plan lists this as a manual check. It should not be: `programId` used to
   key every paint cache, and this program added three grouping axes and a
   shelf on top of it. If any of them rebuilds a node that did not change, the
   operator loses their place every four seconds — and if any two nodes answer
   to one `data-fkey`, render()'s restore-by-key lands on whichever the document
   happens to hold first, which is the scar the swarm anchor already carries.
   ------------------------------------------------------------------------ */
describe("Atlas F4: the board keeps the operator's place across a repaint", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fkeysOf = (node: any) =>
    findAll(node, (n: any) => n.dataset && typeof n.dataset.fkey === "string").map((n: any) => n.dataset.fkey);

  function fullBoard() {
    const live = (id: string) => agent({ id, status: "running", lifecycle: "working" });
    const done = (id: string) => agent({ id, lifecycle: "finished", scope: "observed", endEvidence: "session-exit" });
    const repoOf = (branch: string, path: string) => ({
      repoKey: "k-focus", repoName: "the-mountain", worktreePath: path, branch, ephemeral: false,
    });
    const leafA = {
      id: "repo:k-focus:worktree:wa", name: "the-mountain", groupPath: ["k-focus", "wa"],
      agents: [
        { ...live("codex:f-a1"), repo: repoOf("main", "/x/main") },
        { ...live("codex:f-a2"), repo: repoOf("main", "/x/main") },
        { ...done("codex:f-a3"), repo: repoOf("main", "/x/main") },
      ],
    };
    const leafB = {
      id: "repo:k-focus:run:atlas", name: "the-mountain", groupPath: ["k-focus", "run:atlas"],
      agents: [{ ...live("codex:f-b1"), repo: repoOf("lane", "/x/lane") }],
    };
    const loose = { id: "cwd-focus-loose", name: "loose", agents: [live("codex:f-c1")] };
    return [
      { program: leafA, agents: leafA.agents.slice(0, 2), finished: [leafA.agents[2]!] },
      { program: leafB, agents: leafB.agents, finished: [] },
      { program: loose, agents: loose.agents, finished: [] },
    ];
  }

  test("every focus key on the board is unique across all four surfaces", () => {
    /* Repo bands, worktree leaves, a run leaf, the flat fallback, live rows and
       an open shelf, all at once. Two nodes sharing a key is not a cosmetic
       clash: it sends focus restore to the wrong session. */
    const visible = fullBoard();
    const root = newNode("div");
    withDom(() => M.syncProgramList(root, visible, listUi({
      view: "board",
      shelfOverrides: new Map([["repo:k-focus:worktree:wa", "open"]]),
      snap: { schemaVersion: 1, programs: visible.map((v) => v.program) },
    })));

    const keys = fkeysOf(root);
    expect(keys.length).toBeGreaterThan(8); // the surfaces really did render
    expect(new Set(keys).size).toBe(keys.length);
    // The shelved session is drawn exactly once, under its own agent key.
    expect(keys.filter((k: string) => k === "agent:codex:f-a3")).toHaveLength(1);
    // And the new controls each carry their own key rather than borrowing one.
    expect(keys).toContain("repo:k-focus");
    expect(keys).toContain("shelf:repo:k-focus:worktree:wa");
  });

  test("a quiet 4s tick rebuilds nothing the operator could be standing on", () => {
    const visible = fullBoard();
    const root = newNode("div");
    const ui = () => listUi({
      view: "board",
      shelfOverrides: new Map([["repo:k-focus:worktree:wa", "open"]]),
      snap: { schemaVersion: 1, programs: visible.map((v) => v.program) },
    });

    withDom(() => M.syncProgramList(root, visible, ui()));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const before = new Map<string, any>(
      findAll(root, (n: any) => n.dataset && typeof n.dataset.fkey === "string")
        .map((n: any) => [n.dataset.fkey, n]),
    );
    expect(before.size).toBeGreaterThan(8);

    // The tick: same data, same everything.
    withDom(() => M.syncProgramList(root, visible, ui()));

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const after = new Map<string, any>(
      findAll(root, (n: any) => n.dataset && typeof n.dataset.fkey === "string")
        .map((n: any) => [n.dataset.fkey, n]),
    );
    expect([...after.keys()].sort()).toEqual([...before.keys()].sort());
    for (const [key, node] of before) {
      expect(after.get(key), `${key} was rebuilt by a no-op repaint`).toBe(node);
    }
  });
});

/* ---------------------------------------------------------------------------
   T7 — the parked / blocked / done contract, rendered.

   T6 put `taskState` / `taskStateSource` / `taskStateAt` on the wire beside the
   hook's own `hookLifecycleAt`, and `src/web/task-state.js` is the mirror both
   sides execute against one truth table. This file is about what the BOARD does
   with that verdict, which is a separate question the mirror deliberately does
   not answer: `wantsHuman` already consumes it, and every fixture below was read
   off the live board at 11:5x with /api/snapshot open beside it.
   ------------------------------------------------------------------------- */
describe("T7: a declared task state reaches the board", () => {
  /* be-live, exactly as the wire had it: the orchestrator stood the lane down at
     16:52:04, its last hook was `idle` at 16:51:21, and the server still
     published `outcome: "needs-you"` from an attentionSignal raised before the
     stand-down. */
  const parkedLane = (over: Record<string, unknown> = {}) => agent({
    id: "codex:019fd291", sourceSessionId: "019fd291-62e4-7152-a9b4-6d781396802c",
    provider: "codex", programId: "p",
    identity: { name: "be-live", base: "be-live", source: "manifest", authoredBy: "manifest" },
    status: "attention", lifecycle: "waiting", outcome: "needs-you", attentionSignal: true,
    taskState: "parked", taskStateSource: "manifest", taskStateAt: "2026-08-05T16:52:04.000Z",
    hookLifecycle: "idle", hookLifecycleAt: "2026-08-05T16:51:21.000Z",
    ...over,
  });

  test("a parked lane leaves Needs-you even while its outcome still says needs-you", () => {
    /* The live gap this closes. `wantsHuman` already went quiet — the mirror
       suppressed the stale hook — but `alerting()` has a second door: any row
       whose OUTCOME is not healthy and which has not ended. The server's outcome
       was computed from the same pre-stand-down signal, so the lane walked
       straight back into the strip through it.

       Measured before the fix: wantsHuman=false, alerting=true. */
    const parked = parkedLane();
    expect(M.wantsHuman(parked)).toBe(false);
    expect(M.alerting(parked)).toBe(false);
    // And it really is off the pinned strip, through the board's own builder.
    const program = { id: "p", name: "disposable checkouts", agents: [parked] };
    expect(M.needsYouStrip([{ program, agents: [parked] }])).toEqual([]);
  });

  test("a parked lane that asks again is back in Needs-you", () => {
    /* The re-alert path, and the reason parking cannot simply mute a row: a
       lane stood down at 16:52:04 that asks a question at 16:53 is asking NOW.
       Strictly newer, per the truth table both sides execute. */
    const asking = parkedLane({
      hookLifecycle: "needsInput", hookLifecycleAt: "2026-08-05T16:53:00.000Z",
    });
    expect(M.wantsHuman(asking)).toBe(true);
    expect(M.alerting(asking)).toBe(true);
    // A hook at the same instant is not newer, so it stays quiet.
    expect(M.alerting(parkedLane({
      hookLifecycle: "needsInput", hookLifecycleAt: "2026-08-05T16:52:04.000Z",
    }))).toBe(false);
  });

  test("a parked row says so on the row, without claiming the session ended", () => {
    /* The plan is explicit that this rule never enters lifecycle.ts: parking is
       a statement about the ASSIGNMENT, not about the process. So the row keeps
       its lifecycle word and gains a quiet chip beside it — a parked lane that
       rendered as "Finished" would be the same lie in the other direction. */
    const parked = parkedLane();
    const program = { id: "p", name: "disposable checkouts", agents: [parked] };
    const row = withDom(() => M.renderAgentRow(parked, program));
    const chip = byClass(row, "task-state-chip");
    expect(chip).not.toBeNull();
    expect(textOf(chip).toLowerCase()).toContain("parked");
    // Still a waiting session, not an ended one.
    expect(M.lifecycleOf(parked)).toBe("waiting");
    expect(M.isTerminal(parked)).toBe(false);
    // A lane that never declared anything grows no chip at all.
    expect(byClass(withDom(() => M.renderAgentRow(agent(), program)), "task-state-chip")).toBeNull();
  });

  test("a lane that declared itself done leaves the live rows for the Finished shelf", async () => {
    /* The case the live board has not produced yet and the plan names anyway: a
       lane whose assignment is complete but whose process is still sitting at
       its prompt. Its lifecycle is `waiting` — the process really is up — so
       nothing about isTerminal moves. The BOARD is what has to stop listing it
       as live work. */
    const done = parkedLane({
      id: "codex:019fd20d",
      identity: { name: "be-spine", base: "be-spine", source: "manifest", authoredBy: "manifest" },
      status: "waiting", lifecycle: "waiting", outcome: "healthy", attentionSignal: false,
      taskState: "done", taskStateAt: "2026-08-05T16:51:12.000Z",
      hookLifecycle: "idle", hookLifecycleAt: "2026-08-05T14:28:35.000Z",
    });
    expect(M.isTerminal(done)).toBe(false);       // the process is still there
    expect(M.viewMatches("board", done)).toBe(false); // ...and it is not live work
    expect(M.viewMatches("now", done)).toBe(false);

    /* ...and the shelf is where it goes. Driven through shelfFilter, which is
       the production path: renderPrograms builds each leaf's shelf population
       with exactly this predicate. */
    const program = {
      id: "p", name: "disposable checkouts", path: "/x/p", groupPath: ["k-p", "wt-p"],
      agents: [done],
    };
    const shelved = withState({ view: "board", lookbackHours: null, query: "", facetProgram: "", facetProviders: [] },
      () => M.shelfFilter()(done, program));
    expect(await shelved).toBe(true);

    /* A leaf with one lane still working beside it — the real shape of a run,
       and the shape that matters: a board that drops the whole section once its
       last live row leaves would never show the shelf at all. */
    const working = agent({ id: "codex:still", status: "running", lifecycle: "working" });
    const leaf = { ...program, agents: [working, done] };
    const root = newNode("div");
    withDom(() => M.syncProgramList(root, [{ program: leaf, agents: [working], finished: [done] }], listUi({
      view: "board", lookbackHours: null,
      shelfOverrides: new Map([["p", "open"]]),
      snap: { schemaVersion: 1, programs: [leaf] },
    })));
    expect(byClass(root, "finished-shelf")).not.toBeNull();
    expect(textOf(root)).toContain("be-spine");

    // A parked lane is NOT done: it is still live work and stays in the rows.
    expect(M.viewMatches("board", parkedLane({ outcome: "healthy", attentionSignal: false }))).toBe(true);
  });
});

describe("T7: lineage the kernel contradicts, and a sender the server could not confirm", () => {
  const contradicted = (over: Record<string, unknown> = {}) => agent({
    id: "claude:kid", provider: "claude", programId: "p", parentAgentId: "claude:claimed",
    lineageAgreement: "contradicted",
    lineage: { observedParentAgentId: "claude:actual" },
    ...over,
  });

  test("a parent chain the kernel contradicts is marked hostile, and says why", () => {
    /* T1 keeps the DECLARED chain and flags it rather than silently re-parenting
       — so the row is the only place an operator can learn that the two
       disagree. Hostile, because a wrong parent is how an instruction reaches
       the wrong session. */
    const row = withDom(() => M.renderAgentRow(contradicted(), { id: "p", name: "P", agents: [] }));
    const mark = byClass(row, "lineage-contradicted");
    expect(mark).not.toBeNull();
    // The reason, in words, where the operator is looking — not a bare colour.
    expect(String(mark.attributes.title || "").toLowerCase()).toContain("parent");
    expect(row.attributes["aria-label"].toLowerCase()).toContain("contradict");
    // Corroborated and unobserved are ordinary rows; only disagreement is loud.
    for (const agreement of ["corroborated", "unobserved", undefined]) {
      const calm = withDom(() => M.renderAgentRow(
        contradicted({ lineageAgreement: agreement }), { id: "p", name: "P", agents: [] }));
      expect(byClass(calm, "lineage-contradicted"), String(agreement)).toBeNull();
    }
  });

  test("an unconfirmed sender is marked with the server's evidence, not a verdict", () => {
    /* T5 publishes `senderVerified: false` when the claimed sender's own
       transcript does not contain the message. The mark says exactly that and
       stops there. It does not say "forged": the client cannot see the scan, and
       measured on the live board every one of the nine `false` rows was a real
       message the bounded scan had missed. An absent verdict marks nothing —
       unreadable evidence is not an accusation. */
    const HEAD = "[from claude:8c052fe9 run atlas-hardening-2026-08-05]";
    const forged = agent({
      id: "claude:recv", provider: "claude", programId: "p",
      lastUserMessage: `${HEAD} ship the thing`, senderVerified: false,
    });
    const pane = withDom(() => M.renderChat(forged, listUi({
      snap: { schemaVersion: 1, programs: [{ id: "p", name: "P", agents: [forged] }] },
    })));
    const mark = byClass(pane, "sender-unconfirmed");
    expect(mark).not.toBeNull();
    const said = (textOf(mark) + " " + String(mark.attributes.title || "")).toLowerCase();
    expect(said).toContain("transcript");
    expect(said).not.toContain("forged");

    // senderVerified:true and an absent verdict both leave the attribution alone.
    for (const verdict of [true, undefined]) {
      const a = agent({ id: "claude:recv", provider: "claude", programId: "p", lastUserMessage: `${HEAD} ship the thing`, senderVerified: verdict });
      const calm = withDom(() => M.renderChat(a, listUi({
        snap: { schemaVersion: 1, programs: [{ id: "p", name: "P", agents: [a] }] },
      })));
      expect(byClass(calm, "sender-unconfirmed"), String(verdict)).toBeNull();
    }
  });

  test("an unheaded current request does not inherit the kickoff's sender", () => {
    /* be-live's T5 handoff, and the server's rule (`senderClaimFor`): a present
       `lastUserMessage` IS the current request and is authoritative even with no
       header. `task` stays headed forever, so falling through to it attributes a
       human's later follow-up to the orchestrator that opened the lane — and
       then "verifies" that attribution against the wrong message. */
    const HEAD = "[from claude:8c052fe9 run atlas-hardening-2026-08-05]";
    expect(M.senderOf(agent({ lastUserMessage: "now try it with the flag", task: `${HEAD} you are lane fe-states` })))
      .toBeNull();
    // The fallback survives for the case it was built for: no current request.
    expect(M.senderOf(agent({ lastUserMessage: null, task: `${HEAD} you are lane fe-states` })))
      .toEqual({ agentId: "claude:8c052fe9", runId: "atlas-hardening-2026-08-05" });
    expect(M.senderOf(agent({ lastUserMessage: undefined, task: `${HEAD} you are lane fe-states` })))
      .toEqual({ agentId: "claude:8c052fe9", runId: "atlas-hardening-2026-08-05" });
    // An empty string is a present request that is simply empty, not an absence.
    expect(M.senderOf(agent({ lastUserMessage: "", task: `${HEAD} you are lane fe-states` }))).toBeNull();
  });
});

/* ---------------------------------------------------------------------------
   S1 · the notification center.

   The header is confidence and this is attention. Every test below names the
   claim the surface makes and fails when that claim stops being true — the
   badge is ember only when a person is the blocker, nothing resolved or
   impact-free reaches the live list, and every route opens a real drawer.
   ------------------------------------------------------------------------- */

describe("S1: the notification center is attention, and it never aggregates", () => {
  const blocked = (id: string, over: Record<string, unknown> = {}) => agent({
    id, displayName: id, programId: "p",
    attentionSignal: { kind: "question-pending", evidence: "Push the branch and open the PR, or hold for the reconciliation?" },
    ...over,
  });
  const noticed = (id: string, over: Record<string, unknown> = {}) => agent({
    id, displayName: id, programId: "p",
    attentionSignal: { kind: "stalled-active", evidence: "Manifest says active; the hook has stayed idle." },
    ...over,
  });
  const quiet = (id: string) => agent({ id, displayName: id, programId: "p", outcome: "healthy" });
  const snapOf = (agents: unknown[], over: Record<string, unknown> = {}) =>
    snapshot({ programs: [{ id: "p", name: "Ant Hill", agents }], ...over });
  const NOW = Date.parse("2026-08-05T21:00:00.000Z");
  const feed = (snap: unknown, queue: unknown[] = []) => M.notificationFeed(snap, queue, NOW, M.NOTIFY_DEPS);

  const issue = (over: Record<string, unknown> = {}) => ({
    id: "system:sources", kind: "system", severity: "warning",
    title: "Two sources disagree", summary: "The cmux store and the transcript report different session ids.",
    affectedAgentIds: [], ...over,
  });

  test("every live item names its kind, severity, source, lifecycle, evidence, impact and a route", () => {
    const snap = snapOf([blocked("codex:1"), noticed("codex:2"), quiet("codex:3")], { issues: [issue()] });
    const items = feed(snap, [{
      issueId: "inv:1", id: "q1", state: "running", headline: "Isolate the system fault",
      rationale: "Two collectors disagree about one surface.", createdAt: "2026-08-05T19:00:00.000Z",
      affectedAgents: 47, affectedPrograms: 3, runModel: "luna",
    }]);
    // All three feeds are represented — this is the schema assertion the plan asks for.
    expect(items.map((i: { kind: string }) => i.kind).sort())
      .toEqual(["dataflow", "handoff", "handoff", "investigation"]);
    for (const item of items) {
      expect(typeof item.id, item.id).toBe("string");
      expect(item.id.length).toBeGreaterThan(0);
      expect(["handoff", "dataflow", "investigation"]).toContain(item.kind);
      expect(["blocking", "warning"]).toContain(item.severity);
      expect(typeof item.source, item.id).toBe("object");
      expect(typeof item.lifecycle, item.id).toBe("string");
      // Whole sentences, not field dumps: the operator reads these INSTEAD of
      // opening the drawer, so an empty one is a row that says nothing.
      expect(item.evidence.length, item.id).toBeGreaterThan(0);
      expect(item.impact.length, item.id).toBeGreaterThan(0);
      // `since` is required and nullable — "we cannot measure it" is an answer,
      // and the one thing it may never be is a made-up zero.
      expect(item.since === null || typeof item.since === "string", item.id).toBe(true);
      expect(item.route.id.length, item.id).toBeGreaterThan(0);
    }
  });

  test("every route resolves to a real drawer", () => {
    const snap = snapOf([blocked("codex:1"), noticed("codex:2")], {
      issues: [issue(), issue({ id: "system:hard", severity: "error" })],
    });
    const items = feed(snap, [{ issueId: "inv:1", id: "q1", state: "queued", headline: "H", createdAt: "2026-08-05T19:00:00.000Z" }]);
    const kinds = new Set<string>(items.map((i: { route: { kind: string } }) => i.route.kind));
    // Not a hand-kept list: the drawer table itself is the assertion, so a new
    // item kind cannot ship without a drawer to open.
    expect(M.DRAWER_KINDS.length).toBeGreaterThan(0);
    for (const kind of kinds) expect(M.DRAWER_KINDS, kind).toContain(kind);
    expect([...kinds].sort()).toEqual(["advisory", "agent", "intervention", "investigation"]);
  });

  test("a handoff item routes to the agent's own drawer, not to an advisory about it", () => {
    // issuesOf mints `agent:<id>` for the same agent; the center takes that id
    // over so the parity gate is an identity check and one thing gets one row.
    const snap = snapOf([blocked("codex:1")]);
    const items = feed(snap);
    expect(items).toHaveLength(1);
    expect(items[0].id).toBe("agent:codex:1");
    expect(items[0].route).toEqual({ kind: "agent", id: "codex:1" });
    expect(M.issuesOf(snap).map((i: { id: string }) => i.id)).toContain("agent:codex:1");
  });

  test("the ember contract: severity 'blocking' means a person is the blocker and nothing else", () => {
    // A person waiting.
    expect(feed(snapOf([blocked("codex:1")]))[0].severity).toBe("blocking");
    // A watcher's observation is not a person waiting.
    expect(feed(snapOf([noticed("codex:2")]))[0].severity).toBe("warning");
    // Nor is an ERROR-severity collector fault, however bad it is. If the badge
    // is ember, someone stopped and is waiting for you — that is the whole
    // contract, and it only holds if nothing else can claim this severity.
    const faulted = feed(snapOf([quiet("codex:3")], { issues: [issue({ severity: "error" })] }));
    expect(faulted).toHaveLength(1);
    expect(faulted[0].kind).toBe("dataflow");
    expect(faulted[0].severity).toBe("warning");
    expect(M.feedTone(faulted)).toBe("noticed");
  });

  test("the badge tone and count come off the feed, not a parallel population", () => {
    expect(M.feedTone(feed(snapOf([blocked("codex:1"), noticed("codex:2")])))).toBe("blocked");
    expect(M.feedTone(feed(snapOf([noticed("codex:2")])))).toBe("noticed");
    expect(M.feedTone(feed(snapOf([quiet("codex:3")])))).toBe("clear");
    expect(M.feedTone([])).toBe("clear");
    // The count beside an ember button has to mean what the ember means.
    expect(M.blockingCount(feed(snapOf([blocked("codex:1"), blocked("codex:2"), noticed("codex:3")])))).toBe(2);
    expect(M.blockingCount(feed(snapOf([noticed("codex:3")])))).toBe(0);
  });

  test("the blocking/noticed partition is the server's word, and the client's only until it ships", () => {
    // S0-T2's exact rule over the kinds that ARE on the wire today.
    for (const kind of ["permission-requested", "input-requested", "fork-unresolved",
      "handoff-stated", "question-pending", "assumption-stated"]) {
      expect(M.attentionClassOf(agent({ attentionSignal: { kind } })), kind).toBe("blocking");
    }
    expect(M.attentionClassOf(agent({ attentionSignal: { kind: "stalled-active" } }))).toBe("noticed");
    // Absence, not a third value.
    for (const kind of ["nothing-wanted", "out-of-scope", "not-readable"]) {
      expect(M.attentionClassOf(agent({ attentionSignal: { kind } })), kind).toBeNull();
    }
    expect(M.attentionClassOf(agent({}))).toBeNull();
    // When be-dwell ships the field, the server's word wins over the derivation.
    expect(M.attentionClassOf(agent({ attentionClass: "noticed", attentionSignal: { kind: "question-pending" } })))
      .toBe("noticed");
    expect(M.attentionClassOf(agent({ attentionClass: "blocking", attentionSignal: { kind: "stalled-active" } })))
      .toBe("blocking");
  });

  test("a lane that was stood down is not blocking, and a lane that then asks re-alerts", () => {
    // The atlas-hardening T6/T7 precedence, read and not reopened. The veto runs
    // on the server's own word too, so the two can never disagree about it.
    const parked = { taskState: "parked", taskStateSource: "manifest", taskStateAt: "2026-08-05T20:00:00.000Z" };
    expect(M.attentionClassOf(agent({ ...parked, attentionSignal: { kind: "question-pending" } }))).toBeNull();
    expect(M.attentionClassOf(agent({ ...parked, attentionClass: "blocking" }))).toBeNull();
    expect(M.attentionClassOf(agent({ taskState: "done", taskStateSource: "manifest", taskStateAt: "2026-08-05T20:00:00.000Z", attentionSignal: { kind: "question-pending" } }))).toBeNull();
    // …until it asks something NEWER than the declaration.
    const asking = agent({
      ...parked, attentionSignal: { kind: "question-pending" },
      hookLifecycle: "needsInput", hookLifecycleAt: "2026-08-05T20:30:00.000Z",
    });
    expect(M.attentionClassOf(asking)).toBe("blocking");
    expect(feed(snapOf([asking]))).toHaveLength(1);
  });

  test("a handoff carries no dead time, and no clock can sneak in as one", () => {
    /* S0-T1's ruling, pinned so it cannot be quietly reopened.
       docs/S0-T1-DEAD-TIME-MEASUREMENT.md measured every candidate for "when did
       this person-block begin". hookLifecycleAt advanced 01:38:51 → 01:39:16 →
       01:40:41 on a session that stayed needsInput the whole time — a write
       clock. The hook notification repeated mid-wait, so it would RESET the age
       during one block. Stop and UserPromptSubmit mark other boundaries, and the
       cmux journal rolls away. Dead time is DROPPED, not deferred.

       This test fails the moment any of those is wired in, which is the point:
       a heartbeat here makes the oldest wait on the board read as the newest. */
    const clocks = {
      hookLifecycleAt: "2026-08-05T20:59:00.000Z",
      updatedAt: "2026-08-05T20:59:30.000Z",
      taskStateAt: "2026-08-05T20:00:00.000Z",
      // Even if a later lane revives the field, it is not a source any more.
      blockedSince: "2026-08-05T19:56:00.000Z",
    };
    const [item] = feed(snapOf([blocked("codex:1", clocks)]));
    expect(item.since).toBeNull();
    for (const clock of Object.values(clocks)) expect(item.since, clock).not.toBe(clock);
    // …and nothing downstream fabricates a zero out of the absence.
    expect(String(item.since)).not.toBe("0");
    expect(M.notificationPanelModel(snapOf([blocked("codex:1", clocks)]), [], NOW, M.NOTIFY_DEPS))
      .not.toHaveProperty("standby");
  });

  test("a record's own age survives, because that one is actually measured", () => {
    /* The distinction the ruling turns on. A person's dead time is unobtainable;
       a RECORD's age is a durable server fact — when the finding opened, when the
       investigation was created — and those keep their timestamps. */
    const withIssue = snapOf([quiet("codex:9")], {
      issues: [issue({ lifecycle: { state: "open", openedAt: "2026-08-05T19:56:00.000Z" } })],
    });
    expect(feed(withIssue)[0].since).toBe("2026-08-05T19:56:00.000Z");
    const [inv] = feed(snapOf([]), [{
      issueId: "inv:1", id: "q1", state: "running", headline: "H",
      createdAt: "2026-08-05T18:00:00.000Z",
    }]);
    expect(inv.since).toBe("2026-08-05T18:00:00.000Z");
    // A record instant AHEAD of this browser is clock skew, not a negative age.
    const skewed = snapOf([quiet("codex:9")], {
      issues: [issue({ lifecycle: { state: "open", openedAt: "2026-08-05T21:30:00.000Z" } })],
    });
    expect(feed(skewed)[0].since).toBeNull();
  });

  test("with no wait to sort on, the order is stable rather than arbitrary", () => {
    /* Blocking first, then the watch tier — and inside a tier, ids, because
       every handoff now has a null `since`. Stable matters: a list that
       reshuffled on each four-second paint would be unreadable exactly while
       something is waiting. */
    const snap = snapOf([
      blocked("codex:c"), noticed("codex:watch"), blocked("codex:a"), blocked("codex:b"),
    ]);
    const once = feed(snap).map((i: { id: string }) => i.id);
    expect(once).toEqual(["agent:codex:a", "agent:codex:b", "agent:codex:c", "agent:codex:watch"]);
    // Same snapshot, later clock: identical order.
    expect(M.notificationFeed(snap, [], NOW + 60_000, M.NOTIFY_DEPS).map((i: { id: string }) => i.id))
      .toEqual(once);
  });
});

describe("S1-T2: hasCurrentImpact is the only gate between live and history", () => {
  const NOW = Date.parse("2026-08-05T21:00:00.000Z");
  const asking = (id: string, over: Record<string, unknown> = {}) => agent({
    id, displayName: id, programId: "p",
    attentionSignal: { kind: "question-pending", evidence: "Which one?" }, ...over,
  });
  const snapOf = (agents: unknown[], over: Record<string, unknown> = {}) =>
    snapshot({ programs: [{ id: "p", name: "Ant Hill", agents }], ...over });
  const split = (snap: unknown, queue: unknown[] = []) => M.notificationCandidates(snap, queue, NOW, M.NOTIFY_DEPS);
  const issue = (over: Record<string, unknown> = {}) => ({
    id: "system:sources", kind: "system", severity: "warning",
    title: "Two sources disagree", summary: "The cmux store and the transcript disagree.",
    affectedAgentIds: [], ...over,
  });

  test("a person waiting outranks every demotion below it", () => {
    const snap = snapOf([asking("codex:1")]);
    const item = split(snap).live[0];
    expect(item.severity).toBe("blocking");
    expect(M.hasCurrentImpact(item, snap)).toBe(true);
  });

  test("resolved goes to history, and says so", () => {
    const snap = snapOf([], {
      issues: [issue({ lifecycle: { state: "resolved", openedAt: "2026-08-05T18:00:00.000Z", resolvedAt: "2026-08-05T20:00:00.000Z" } })],
    });
    const { live, demoted } = split(snap);
    expect(live).toHaveLength(0);
    expect(demoted.map((d: { id: string; reason: string }) => [d.id, d.reason]))
      .toEqual([["system:sources", "resolved"]]);
  });

  test("verifying stays only while it points at a live agent", () => {
    const verifying = { state: "verifying", openedAt: "2026-08-05T18:00:00.000Z", verificationStartedAt: "2026-08-05T20:00:00.000Z" };
    const live = agent({ id: "codex:live", programId: "p" });
    const withLive = snapOf([live], { issues: [issue({ lifecycle: verifying, affectedAgentIds: ["codex:live"] })] });
    expect(split(withLive).live.map((i: { id: string }) => i.id)).toContain("system:sources");

    // The ended session cannot be helped by verifying anything.
    const ended = agent({ id: "codex:gone", programId: "p", status: "archived" });
    const withEnded = snapOf([ended], { issues: [issue({ lifecycle: verifying, affectedAgentIds: ["codex:gone"] })] });
    expect(split(withEnded).live.map((i: { id: string }) => i.id)).not.toContain("system:sources");
    expect(split(withEnded).demoted[0].reason).toBe("verifying with no live affected agent");

    // Verifying is the WEAKER claim, so system-wide is not enough to keep it —
    // this is the row that distinguishes it from the stale rule below.
    const systemWide = snapOf([], { issues: [issue({ lifecycle: verifying })] });
    expect(split(systemWide).live).toHaveLength(0);
  });

  test("a finding whose agents are all gone is stale; one that named none is system-wide", () => {
    const ended = agent({ id: "codex:gone", programId: "p", status: "archived" });
    const stale = snapOf([ended], { issues: [issue({ affectedAgentIds: ["codex:gone"] })] });
    expect(split(stale).live).toHaveLength(0);
    expect(split(stale).demoted[0].reason).toBe("stale — no live affected agent");

    /* The trap this row exists to avoid: "zero live affected agents" is TRUE of
       a system-wide dataflow fault, which is precisely the item this surface
       exists to carry. An empty list is not a stale list. */
    const systemWide = snapOf([], { issues: [issue({ affectedAgentIds: [] })] });
    expect(split(systemWide).live.map((i: { id: string }) => i.id)).toEqual(["system:sources"]);
  });

  test("a silent reading never becomes a handoff, and never earns the ember", () => {
    /* "We read its closing words and nothing wants a human" is a fact about the
       TEXT, not a request. types.ts:406 types the wire's attentionSignal.kind as
       the seven ACTIONABLE kinds only — isActionable() gates it server-side —
       so this row of the truth table is a defensive gate on a shape the wire
       forbids, not a live demotion. Asserted anyway: the gate is what makes the
       forbidding safe to rely on. */
    for (const kind of ["nothing-wanted", "out-of-scope", "not-readable"]) {
      const snap = snapOf([agent({ id: "codex:1", programId: "p", outcome: "healthy", attentionSignal: { kind } })]);
      expect(M.attentionClassOf(snap.programs[0].agents[0]), kind).toBeNull();
      expect(split(snap).live.filter((i: { kind: string }) => i.kind === "handoff"), kind).toHaveLength(0);
      expect(M.feedTone(split(snap).live), kind).not.toBe("blocked");
    }
  });

  test("an alerting agent with no attention class still reaches the center", () => {
    /* The live case the row above is often confused with, and the one the parity
       gate turns on: a FAILED session that never asked for anything. issuesOf
       mints its finding off alerting(), so the board counts it today and nothing
       counted today may become unreachable. It arrives as a dataflow finding
       rather than a handoff — nobody is waiting on a person — so it is on the
       surface and it is not ember. */
    const failed = snapOf([agent({ id: "codex:2", programId: "p", outcome: "failed" })]);
    expect(M.issuesOf(failed).map((i: { id: string }) => i.id)).toEqual(["agent:codex:2"]);
    const items = split(failed).live;
    expect(items.map((i: { id: string; kind: string; severity: string }) => [i.id, i.kind, i.severity]))
      .toEqual([["agent:codex:2", "dataflow", "warning"]]);
    expect(M.feedTone(items)).toBe("noticed");
    /* The two severities are different axes and this row is where they part.
       The ITEM is "warning" because no person is waiting; the ROUTE is the
       intervention drawer because the BOARD called the finding an error. The
       item's severity drives the ember, the board's drives which drawer opens,
       and folding them would either redden the badge for a collector fault or
       send a failed session to the wrong panel. */
    expect(M.issuesOf(failed)[0].severity).toBe("error");
    expect(items[0].route).toEqual({ kind: "intervention", id: "agent:codex:2" });
  });

  test("an agent that has stopped asking leaves the live list with a reason", () => {
    const snap = snapOf([asking("codex:1")]);
    const item = split(snap).live[0];
    // Same item, next snapshot: it answered.
    const answered = snapOf([agent({ id: "codex:1", programId: "p" })]);
    expect(M.hasCurrentImpact(item, answered)).toBe(false);
    // And gone from the snapshot entirely.
    expect(M.hasCurrentImpact(item, snapOf([]))).toBe(false);
  });

  test("one thing gets one row: a queued investigation does not double its finding", () => {
    const snap = snapOf([], { issues: [issue()] });
    const queue = [{ issueId: "system:sources", id: "q1", state: "running", headline: "Isolate it", createdAt: "2026-08-05T19:00:00.000Z" }];
    const items = split(snap, queue).live;
    expect(items.map((i: { id: string }) => i.id)).toEqual(["system:sources"]);
    expect(items[0].kind).toBe("dataflow");
    // An ORPHAN queue row — its finding has left the snapshot — still surfaces.
    const orphan = split(snapOf([]), [{ issueId: "inv:9", id: "q9", state: "running", headline: "Still running", createdAt: "2026-08-05T19:00:00.000Z" }]);
    expect(orphan.live.map((i: { id: string; kind: string }) => [i.id, i.kind])).toEqual([["inv:9", "investigation"]]);
  });

  test("the parity gate: every finding on the board resolves to an item or a named demotion", () => {
    const ended = agent({ id: "codex:gone", programId: "p", status: "archived" });
    const snap = snapOf([asking("codex:1"), ended], {
      issues: [
        issue(),
        issue({ id: "system:stale", affectedAgentIds: ["codex:gone"] }),
        issue({ id: "system:done", lifecycle: { state: "resolved", openedAt: "2026-08-05T18:00:00.000Z" } }),
      ],
    });
    const queue = [{ issueId: "inv:7", id: "q7", state: "queued", headline: "Q", createdAt: "2026-08-05T19:00:00.000Z" }];
    const { live, demoted } = split(snap, queue);
    const board = [...M.issuesOf(snap).map((i: { id: string }) => i.id), ...queue.map((q) => q.issueId)];
    const accounted = new Set([...live, ...demoted.map((d: { item: unknown }) => d.item)].map((i: { id: string }) => i.id));
    for (const id of board) expect(accounted.has(id), id).toBe(true);
    // …and every demotion carries a reason a human can read in the table.
    for (const d of demoted) expect(d.reason.length, d.id).toBeGreaterThan(0);
  });
});

/* ---------------------------------------------------------------------------
   S2-T3 + S0-T5 · the Tokens card, and the one global scan-window statement
   that had to land before it could ship.
   ------------------------------------------------------------------------- */

describe("Tokens states a consumption floor with its coverage, or says nothing", () => {
  const withTotals = (over: Record<string, unknown>) => snapshot({
    totals: {
      live: 1, tracked: 1, attention: 0, working: 1, idle: 0, history: 0,
      byLifecycle: { working: 1, waiting: 0, unverified: 0, finished: 0 },
      retained: 0, sourceHealth: { healthy: 2, degraded: 0, absent: 0, total: 2 },
      ...over,
    },
  });

  test("a floor keeps its ≥, and the coverage says how many are missing", () => {
    /* Measured on a live board: 75,776,215 consumed across 349 of 389 eligible
       sessions, consumptionIsFloor true. The ≥ follows Cost's costIsFloor
       precedent rather than inventing a third idiom for the same fact. */
    const data = M.summaryWidgetData("tokens", withTotals({
      consumption: 75_776_215, consumptionReporting: 349,
      consumptionEligible: 389, consumptionIsFloor: true,
    }));
    expect(data.value).toBe("≥ 75.8M");
    expect(data.unit).toBe("consumed");
    expect(data.sublabel).toBe("40 sessions not reporting");
  });

  test("a complete reading says nothing about coverage and drops the ≥", () => {
    // Burn's rule for coverage.unknown: speak only when incomplete. A permanent
    // footnote stops being read, and a ≥ on a total is a lie in the other direction.
    const data = M.summaryWidgetData("tokens", withTotals({
      consumption: 1_000_000, consumptionReporting: 12, consumptionEligible: 12,
    }));
    expect(data.value).toBe("1.0M");
    expect(data.value).not.toContain("≥");
    expect(data.sublabel).toBe("");
  });

  test("the card carries no window tag of its own — the board states it once", () => {
    /* The whole reason S2-T3 had to land first. An aggregate with an unstated
       population is the failure this program exists to remove, so the scan
       window is stated once, ambiently, above every reading it qualifies. */
    const data = M.summaryWidgetData("tokens", withTotals({
      consumption: 5_000, consumptionReporting: 3, consumptionEligible: 3,
    }));
    for (const tag of ["36h", "last 36", "24h", "scan"]) {
      expect(`${data.value} ${data.unit} ${data.sublabel}`, tag).not.toContain(tag);
    }
    // …and the statement exists, once, in the rail rather than on a card.
    expect(html).toContain('id="scan-window"');
    expect(source).toContain("sessions seen in the last ");
    // It is not behind the widgets paint guard: a settings change can leave
    // every card's value identical while the population underneath them moves.
    const rail = source.match(/function renderHealthRail\(\)[\s\S]*?\n\}/)?.[0] ?? "";
    expect(rail.indexOf("renderScanWindow()")).toBeLessThan(rail.indexOf('paintUnchanged("widgets"'));
    // The board's reach and the operator's filter are different windows, and
    // the scope note now prints NEITHER: the pressed chip states the lookback,
    // the rail states the scan window (operator directive, 2026-08-05).
    const scope = source.match(/function renderScopeNote\([\s\S]*?\n\}/)?.[0] ?? "";
    expect(scope).not.toContain("lookbackLabel(");
    expect(scope).not.toContain("· scan ");
  });

  test("an unconfirmed scan window is withheld rather than defaulted to 36", () => {
    // state.scanWindowHours carries a client-side 36. Printing that as though a
    // server had confirmed it is the overclaim this program removes.
    const speak = source.match(/function renderScanWindow\(\)[\s\S]*?\n\}/)?.[0] ?? "";
    expect(speak).toContain("state.snap && Number(state.snap.scanWindowHours)");
    expect(speak).not.toContain("state.scanWindowHours");
  });

  test("absent consumption withholds the card — never 0, never occupancy", () => {
    /* The group is absent until the server finishes a full session scan, which
       on a fresh board takes a couple of minutes. Absence means "we cannot count
       this completely", so the card does not render: speaks() drops a missing
       tone. Observed live — the API returned no consumption during the pre-scan
       window and the populated figure after. */
    const bare = withTotals({ tokens: 915_805 });
    const data = M.summaryWidgetData("tokens", bare);
    expect(data.tone).toBe("missing");
    expect(data.value).toBe("No data");
    expect(M.pulseStripModel(bare, "live", [], "percent", "").cells.map((c: { id: string }) => c.id))
      .not.toContain("tokens");

    /* And it NEVER falls back to totals.tokens. That field sums a per-call
       occupancy over working agents only; measured live the two differ by 83x
       (75.8M consumed against 0.9M occupancy). Substituting one for the other is
       the defect the token comments in types.ts were written to prevent, and it
       would be wrong by two orders of magnitude rather than merely imprecise. */
    expect(data.value).not.toContain("915");
    expect(data.value).not.toBe("0");
    const branch = source.slice(source.indexOf('if (id === "tokens")'));
    /* Comments stripped: this file NAMES totals.tokens in prose to explain why
       it is never read, and an assertion that cannot tell code from the comment
       warning about it would forbid documenting the trap. */
    const code = branch.slice(0, branch.indexOf('if (id === "context-peak")'))
      .replace(/\/\*[\s\S]*?\*\//g, "");
    expect(code).not.toContain("totals.tokens");
  });
});

/* ---------------------------------------------------------------------------
   S4 · every header number that could be partial says so.
   ------------------------------------------------------------------------- */

describe("Burn and Cost render their provenance rather than implying it", () => {
  const withBurn = (burn: Record<string, unknown>) => snapshot({
    pulse: {
      burn, momentum: { working: 1, completionsLastHour: null, completionsProvenance: "not-observable" },
      activity: { buckets: [] },
    },
  });
  const sub = (burn: Record<string, unknown>) => M.summaryWidgetData("burn", withBurn(burn), "live").sublabel;

  test("an unavailable cost says so, even when a number rides beside it", () => {
    /* The defect costProvenance exists to prevent. Reading the number's
       null-ness and inferring the rest is one inference away from printing
       "$0.00 last hour" for an hour nobody could price — a fabricated total,
       which is exactly what "never $0" forbids. The provenance wins. */
    const text = sub({ tokensPerMin: 1000, windowMs: 600_000, costLastHourUsd: 0, costProvenance: "unavailable" });
    expect(text).toContain("cost unavailable");
    expect(text).not.toContain("$0");
    expect(text).not.toContain("$0.00");
    // A measured zero from a source that DID answer is a real reading and prints.
    expect(sub({ tokensPerMin: 1000, windowMs: 600_000, costLastHourUsd: 0, costProvenance: "burnbar" }))
      .toContain("$0.00 last hour");
  });

  test("a floor keeps its ≥, and a complete total does not borrow one", () => {
    expect(sub({ tokensPerMin: 1, windowMs: 600_000, costLastHourUsd: 4.12, costProvenance: "burnbar", costIsFloor: true }))
      .toContain("≥$4.12 last hour");
    expect(sub({ tokensPerMin: 1, windowMs: 600_000, costLastHourUsd: 4.12, costProvenance: "burnbar" }))
      .toContain("$4.12 last hour");
    expect(sub({ tokensPerMin: 1, windowMs: 600_000, costLastHourUsd: 4.12, costProvenance: "burnbar" }))
      .not.toContain("≥");
  });

  test("the cost carries an as-of, because it comes from a different clock", () => {
    /* BurnBar computes this over its own hour — the same reason the guide warns
       against dividing the rate by it. A cost with no as-of beside it is one
       whose freshness the operator cannot judge. */
    const text = sub({
      tokensPerMin: 1, windowMs: 600_000, costLastHourUsd: 4.12,
      costProvenance: "burnbar", costAsOf: new Date(Date.now() - 120_000).toISOString(),
    });
    /* Parenthesised onto the cost, not a sibling clause: a qualifier separated
       from its number by another number reads as qualifying the wrong one. */
    expect(text).toMatch(/\$4\.12 last hour \([^)]+\)/);
    // An unavailable cost has no instant to be as-of, and does not invent one.
    expect(sub({ tokensPerMin: 1, windowMs: 600_000, costLastHourUsd: null, costProvenance: "unavailable", costAsOf: new Date().toISOString() }))
      .toContain("cost unavailable");
    expect(sub({ tokensPerMin: 1, windowMs: 600_000, costLastHourUsd: null, costProvenance: "unavailable", costAsOf: new Date().toISOString() }))
      .not.toMatch(/\(/);
    // Nor does a malformed instant.
    expect(sub({ tokensPerMin: 1, windowMs: 600_000, costLastHourUsd: 4.12, costProvenance: "burnbar", costAsOf: "not-a-date" }))
      .not.toMatch(/last hour \(/);
  });

  test("the rate's window sits next to the RATE, never after the cost", () => {
    /* Two fixes, each correct, once composed into a crossed sentence: the window
       was appended last, so "36k/min · $4.20 last hour · 10m average" read as
       qualifying the cost's hour rather than the rate's ten minutes. It only
       became wrong when the cost came back, which is why the order is pinned. */
    const text = sub({ tokensPerMin: 36_000, windowMs: 600_000, costLastHourUsd: 4.20, costProvenance: "burnbar" });
    expect(text.indexOf("10m average")).toBeLessThan(text.indexOf("last hour"));
    expect(text.startsWith("10m average")).toBe(true);
  });

  test("the rate names its blind spot only when it has one", () => {
    // Audit §20: coverage speaks only when incomplete. `unknown` counts live
    // agents whose provider reports no tokens at all, so they contribute zero
    // to the rate forever — a subtotal shown as a total unless it is named.
    expect(sub({ tokensPerMin: 1, windowMs: 600_000, costLastHourUsd: null, costProvenance: "unavailable",
      coverage: { reporting: 29, eligible: 29, unknown: 2 } }))
      .toContain("2 not reporting tokens");
    expect(sub({ tokensPerMin: 1, windowMs: 600_000, costLastHourUsd: null, costProvenance: "unavailable",
      coverage: { reporting: 29, eligible: 29, unknown: 0 } }))
      .not.toContain("not reporting tokens");
  });

  test("a missing rate and a missing cost are reported separately", () => {
    /* One being absent says nothing about the other: the rate needs completed
       five-minute buckets, the cost comes from BurnBar. Headlining "No data"
       over a real dollar figure left the operator unable to tell whether spend
       was unknown or $19.54. */
    const rateOnly = M.summaryWidgetData("burn", withBurn({ tokensPerMin: 500, windowMs: 600_000, costLastHourUsd: null, costProvenance: "unavailable" }), "live");
    expect(rateOnly.value).toBe("500");
    expect(rateOnly.sublabel).toContain("cost unavailable");
    const costOnly = M.summaryWidgetData("burn", withBurn({ tokensPerMin: null, costLastHourUsd: 9.5, costProvenance: "burnbar" }), "live");
    expect(costOnly.value).toBe("Token rate unavailable");
    expect(costOnly.sublabel).toContain("$9.50 last hour");
    // Both gone is "No data", and it KEEPS the honest cost phrasing.
    const neither = M.summaryWidgetData("burn", withBurn({ tokensPerMin: null, costLastHourUsd: null, costProvenance: "unavailable" }), "live");
    expect(neither.value).toBe("No data");
    expect(neither.tone).toBe("missing");
    expect(neither.sublabel).toContain("cost unavailable");
  });
});

/* ---------------------------------------------------------------------------
   S6-T3/T4 · the Clean up action proposes, and the board never deletes.
   ------------------------------------------------------------------------- */

describe("the cleanup sweep proposes and never executes", () => {
  test("THE BOARD NEVER DELETES: propose is the only route the client can reach", () => {
    /* The hard contract from docs/CLEANUP-SWEEP.md. There is no confirm
       endpoint; confirmCommand is text the operator pastes into a terminal.
       This test is the one that must never be relaxed — an agent deleting
       branches with no human in the loop is the single thing the last manual
       pass was careful never to do. */
    expect(source).toContain('"/api/cleanup/propose"');
    expect(source).not.toContain("/api/cleanup/confirm");
    // No destructive verb reachable from a click anywhere in the client.
    for (const verb of ["git branch -D", "worktree remove", "rm -rf"]) {
      expect(source, verb).not.toContain(verb);
    }
    // The request is a POST and carries no plan-mutating body.
    const fn = source.match(/async function requestCleanupProposal\(\)[\s\S]*?\n\}/)?.[0] ?? "";
    expect(fn).toContain('method: "POST"');
    expect(fn).not.toContain("confirm");
  });

  test("an incomplete enumeration reports itself and shows no removables", () => {
    /* Absent, not partial. A plan missing a refusal is a plan that proposes
       deleting something it should not, so a 503 carries no `plan` field and the
       client must not render a subset of one. */
    const fn = source.match(/async function requestCleanupProposal\(\)[\s\S]*?\n\}/)?.[0] ?? "";
    expect(fn).toContain("body.complete !== true");
    expect(fn).toContain("Enumeration incomplete");
    const render = source.match(/function renderCleanupPlan\(\)[\s\S]*?\n\}/)?.[0] ?? "";
    expect(render).toContain("No plan was produced");
    // The error path returns before any removable is read.
    expect(render.indexOf("No plan was produced")).toBeLessThan(render.indexOf("view.removable"));
  });

  test("the indicator says a process is underway, never that the fault is fixed", () => {
    const fn = source.match(/function cleanupAction\(\)[\s\S]*?\n\}/)?.[0] ?? "";
    // Present tense while running; no completion word anywhere on the control.
    expect(fn).toContain('"Examining…"');
    for (const done of ["Cleaned", "Fixed", "Done", "Complete", "Repaired"]) {
      expect(fn, done).not.toContain(done);
    }
    /* The tooltip names three things: what is running, what it is examining, and
       that nothing will be deleted without approval. The third is the contract,
       not reassurance — a button labelled "Clean up" without it reads as
       destructive. */
    expect(fn).toContain("Nothing will be deleted without your approval");
    expect(fn).toContain("worktrees, branches and the process table");
    // Minimal by contract: an indicator on the chip, and no second surface.
    expect(source).not.toContain("cleanup-banner");
    expect(source).not.toContain("cleanup-progress");
  });

  test("the plan carries rollback SHAs, refusals with reasons, and a paste-able command", () => {
    const render = source.match(/function renderCleanupPlan\(\)[\s\S]*?\n\}/)?.[0] ?? "";
    // What makes a proposal reviewable rather than trusted.
    expect(render).toContain("item.rollbackSha");
    expect(render).toContain("item.reasons");
    expect(render).toContain("view.confirmCommand");
    expect(render).toContain("view.planPath");
    // Refusals are shown, not summarised away — each one is a stop.
    expect(render).toContain("refused");
    // It renders as text to paste; nothing here submits it.
    expect(render).toContain('el("code"');
    expect(render).not.toContain("onclick");
  });

  test("Clean up is offered only when there is something to sweep", () => {
    // A permanent Clean up button on a tidy board is a standing suggestion that
    // something is wrong — the scold this program removes.
    const fn = source.match(/function cleanupOffered\(\)[\s\S]*?\n\}/)?.[0] ?? "";
    expect(fn).toContain("remedy.tidy");
    expect(fn).toContain("state.cleanup.running");
    expect(fn).toContain("state.cleanup.view");
  });

  test("the panel repaints while the sweep runs, rather than freezing mid-run", () => {
    /* The indicator starts and the plan arrives without any snapshot value
       changing, so the sweep's own state has to be in the signature — the same
       class of bug as hanging a surface off the widgets guard. */
    const sig = source.match(/function notifyPanelPaintSig\([\s\S]*?\n\}/)?.[0] ?? "";
    expect(sig).toContain("state.cleanup.running");
    expect(sig).toContain("state.cleanup.at");
    expect(sig).toContain("state.cleanup.error");
  });
});

/* ---------------------------------------------------------------------------
   The Board's rich all-clear is unreachable at every lookback an operator can
   pick, and it would be FALSE if it were reached.

   RED ON PURPOSE. These pin the two halves of a defect that is still open, and
   they are written before the fix so that reachability cannot be declared won on
   a branch where the branch is still dead. See
   .agent/runs/board-all-clear-lookback-disclosure/.
   ------------------------------------------------------------------------- */

describe("the Board all-clear is reachable, and honest about its window", () => {
  const boardUi = (over: Record<string, unknown> = {}) => listUi({
    view: "board",
    lookbackHours: M.DEFAULT_LOOKBACK_HOURS,
    query: "",
    facetProgram: "",
    showReviewWorkers: true,
    snap: snapshot({ programs: [{ id: "p", name: "P", agents: [] }] }),
    ...over,
  });

  test("at the DEFAULT lookback, an unconstrained empty board reaches the rich all-clear", () => {
    /* emptyListMessage returning non-null is what makes the rich branch dead:
       renderPrograms prints its thin "Nothing matches…" line instead, and the
       verdict mark, "Nothing is live", the vitals with the ticking age, the
       open-findings disclosure and the escape into History all go with it.

       lookbackApplies("board") is true, LOOKBACK_HOUR_PRESETS carries no null,
       and DEFAULT_LOOKBACK_HOURS is 6 — so `lookbackHours != null` holds for
       every preset an operator can pick and the thin line always wins. Only the
       separate Everything control, which sets it to null, reaches the rich
       state. That is why this rotted silently: `grep "Nothing is live" tests/`
       returned nothing at all. */
    expect(M.emptyListMessage(boardUi())).toBeNull();
  });

  test("a real constraint still speaks — this is a reachability fix, not a mute", () => {
    // The thin line is correct when something the operator chose is hiding rows.
    expect(M.emptyListMessage(boardUi({ query: "ridge" }))).toContain("Nothing matches");
    expect(M.emptyListMessage(boardUi({ facetProgram: "p" }))).toContain("Nothing matches");
  });

  test("the rich all-clear may not claim 'Nothing is live' while a window hides live sessions", () => {
    /* The second half, and the reason the fix is a DISCLOSURE rather than just
       making the branch reachable. withinLookback filters on updatedAt recency,
       so a session whose process is alive and which has been waiting on a person
       for eight hours is live AND outside a 6h window.

       Worse: because the filter keys on quiet time, the rows it excludes FIRST
       are the ones quiet longest — exactly the blocked-on-a-human population
       this program exists to surface. A flat "Nothing is live" at 6h conceals
       precisely the rows that matter most. */
    const eightHoursAgo = new Date(Date.now() - 8 * 3_600_000).toISOString();
    const waiting = agent({ id: "codex:old", updatedAt: eightHoursAgo, status: "waiting" });
    expect(M.withinLookback(waiting, 6)).toBe(false);   // hidden by the window
    expect(M.isTerminal(waiting)).toBe(false);          // …and demonstrably live

    /* So the rich state has to say BOTH facts at once: the board is all-clear,
       and it is only looking back 6h — carrying how many sessions that window is
       hiding, because a bare "showing 6h" leaves the operator guessing whether
       it matters. `hiddenByLookback` is the function that must exist; this fails
       until it does. */
    const hidden = M.hiddenByLookback(boardUi({
      snap: snapshot({ programs: [{ id: "p", name: "P", agents: [waiting] }] }),
    }));
    expect(hidden).toBe(1);
  });
});

describe("header collapse — static masthead and fence contracts", () => {
  test("#compact-summary sits once between the scene and the signals, hidden by default", () => {
    expect(html.match(/id="compact-summary"/g)?.length).toBe(1);
    const inner = html.slice(html.indexOf('class="masthead-inner"'), html.indexOf("</header>"));
    const scene = inner.indexOf('class="masthead-scene"');
    const compact = inner.indexOf('id="compact-summary"');
    const signals = inner.indexOf('class="masthead-signals"');
    expect(scene).toBeGreaterThan(-1);
    expect(compact).toBeGreaterThan(scene);
    expect(signals).toBeGreaterThan(compact);
    const tag = html.match(/<div[^>]*id="compact-summary"[^>]*>/)?.[0] ?? "";
    expect(tag).toContain('class="compact-summary"');
    expect(tag).toContain('role="group"');
    expect(tag).toContain('aria-label="Fleet summary, compact"');
    expect(tag).toContain("hidden");
  });

  test("the disclosure toggle is one native button carrying the locked contract", () => {
    expect(html.match(/data-fkey="header-summary-toggle"/g)?.length).toBe(1);
    const at = html.indexOf('data-fkey="header-summary-toggle"');
    const open = html.lastIndexOf("<", at);
    const close = html.indexOf(">", at);
    const tag = html.slice(open, close + 1);
    expect(tag.startsWith("<button")).toBe(true);
    expect(tag).toContain('type="button"');
    expect(tag).toContain('id="header-summary-toggle"');
    expect(tag).toContain('aria-controls="health-rail compact-summary"');
    expect(tag).toContain('aria-expanded="true"');
    expect(tag).toContain('aria-label="Collapse header"');
    expect(tag).toContain("masthead-icon");
    /* Inside .masthead-signals, so panel anchoring and focus behavior are the
       row's own. */
    const signalsAt = html.indexOf('class="masthead-signals"');
    const signalsEnd = html.indexOf('id="settings-panel"');
    expect(at).toBeGreaterThan(signalsAt);
    expect(at).toBeLessThan(signalsEnd);
  });

  test("existing masthead controls keep their IDs and counts; the alarm stays outside the rail", () => {
    for (const id of ["notify-toggle", "notifications-panel", "settings-toggle", "conn-badge", "server-health", "feed-alarm", "cleanup-status"]) {
      expect(html.match(new RegExp(`id="${id}"`, "g"))?.length, id).toBe(1);
    }
    /* LIVE sits in the Board/History/Usage rail, not the masthead icon row. */
    const viewsAt = html.indexOf('id="views"');
    const connAt = html.indexOf('id="conn-badge"');
    expect(connAt).toBeGreaterThan(viewsAt);
    expect(connAt).toBeLessThan(html.indexOf("</nav>", viewsAt));
    expect(html.indexOf('id="feed-alarm"')).toBeGreaterThan(html.indexOf("</header>"));
    expect(html.indexOf('id="feed-alarm"')).toBeLessThan(html.indexOf('id="health-rail"'));
    /* The static live region stays outside the collapsible rail so cleanup
       announcements remain exposed in compact mode. */
    expect(html.indexOf('id="cleanup-status"')).toBeLessThan(html.indexOf('id="health-rail"'));
  });

  test("both faces read from one derivation: the compact paint reuses the model, never a second summaryWidgetData sweep", () => {
    /* renderHealthRail derives once; the shared target-population helper is the
       only writer of both faces. A compact branch calling summaryWidgetData
       again is the two-sources-of-truth defect the spec locks out. */
    const app = source;
    const railBody = app.slice(app.indexOf("function renderHealthRail("), app.indexOf("function heartbeatTldrAgent("));
    expect(railBody).toContain("renderReadingsInto(");
    const helperBody = app.match(/function renderReadingsInto\(([\s\S]*?)\n\}/)?.[0] ?? "";
    expect(helperBody).not.toContain("summaryWidgetData(");
    expect(helperBody).toContain("renderPulseCalm(");
    expect(helperBody).toContain("renderSummaryWidget(");
    expect(source).not.toContain('healthData || summaryWidgetData("health"');
  });
});

/* ---------------------------------------------------------------------------
   SYNC-RF — inline workspace rename in the drawer session header.

   The board renames a CMUX WORKSPACE, which is a real object in another
   process: the affordance therefore hangs off the workspace title (a snapshot
   fact) and never off the agent's display name (a board derivation, renamed
   through the presentation-label path that already exists).

   The load-bearing claim is the one about truth. This client must never write
   the typed title into its own state on success — the board prints what the
   snapshot says, so a foreign rename landing between the save and the next
   snapshot wins on screen. Every "did it work" assertion below is written so a
   local echo would fail it.
   ------------------------------------------------------------------------- */
describe("SYNC-RF · inline workspace rename (drawer session header)", () => {
  const WS_ID = "WORKSPACE-RF";
  const linkedTarget = (overrides: Record<string, unknown> = {}) => ({
    resolution: "exact",
    surfaceId: "SURFACE-RF",
    workspaceId: WS_ID,
    workspaceTitle: "SYNC · rf",
    ...overrides,
  });
  const linked = (overrides: Record<string, unknown> = {}) =>
    agent({ id: "codex:rf", displayName: "Ridge worker", target: linkedTarget(), ...overrides });

  /* Two spellings on purpose: withDom installs a fake document and REMOVES it
     on the way out, which would tear the one withRequests is standing on. Paint-
     only tests use drawerOf; anything inside a request harness renders against
     the ambient document with buildDrawer. */
  const buildDrawer = (a: Record<string, unknown>) => {
    const pane = newNode("div");
    M.renderAgentDrawer(pane, { kind: "agent", agent: a, program: { id: "p", name: "P", agents: [a] } });
    return pane;
  };
  const drawerOf = (a: Record<string, unknown>) => withDom(() => buildDrawer(a));
  const headerOf = (a: Record<string, unknown>) => byClass(drawerOf(a), "drawer-session-header");
  const headerHere = (a: Record<string, unknown>) => byClass(buildDrawer(a), "drawer-session-header");
  const renameState = (patch: Record<string, unknown> = {}) => ({
    wsRenaming: null, wsRenameDraft: "", wsRenamePending: false, wsRenameError: "", ...patch,
  });

  test("the resolved workspace title carries a rename control; the session name carries none", async () => {
    await withState(renameState(), () => {
      const header = headerOf(linked());
      expect(header).not.toBeNull();

      const row = byClass(header, "drawer-workspace");
      expect(row).not.toBeNull();
      expect(textOf(row)).toContain("SYNC · rf");

      const trigger = byFkey(header, "ws-rename:" + WS_ID);
      expect(trigger?.tagName).toBe("button");
      expect(trigger?.attributes.type).toBe("button");
      // The accessible name says WHICH object moves — sibling panes share a
      // workspace title, so "Rename" alone would be a promise about the wrong scope.
      expect(trigger?.attributes["aria-label"]).toBe("Rename workspace SYNC · rf");

      // Exactly one cmux-rename control in the whole drawer, and it is not on
      // the title: agent display names are board derivations, renamed (if at
      // all) through the presentation-label disclosure, never through cmux.
      const triggers = findAll(drawerOf(linked()), (n) => n.dataset?.fkey?.startsWith("ws-rename:"));
      expect(triggers).toHaveLength(1);
      expect(buttonsOf(byClass(header, "inspector-title"))).toHaveLength(0);
    });
  });

  test("no resolved workspace, no inferred link, and no title means no rename control", async () => {
    await withState(renameState(), () => {
      const cases: Array<[string, Record<string, unknown>]> = [
        ["unlinked", { target: { resolution: "none" } }],
        ["ambiguous", { target: linkedTarget({ resolution: "ambiguous" }) }],
        ["no workspace id", { target: linkedTarget({ workspaceId: undefined }) }],
        ["untitled workspace", { target: linkedTarget({ workspaceTitle: "   " }) }],
      ];
      for (const [name, overrides] of cases) {
        const drawer = drawerOf(linked(overrides));
        expect(byClass(drawer, "drawer-workspace"), name).toBeNull();
        expect(findAll(drawer, (n) => n.dataset?.fkey?.startsWith("ws-rename")), name).toEqual([]);
      }
    });
  });

  test("the editor seeds from the snapshot title and offers explicit save / cancel", async () => {
    await withState(renameState({ wsRenaming: WS_ID, wsRenameDraft: "SYNC · rf" }), () => {
      const header = headerOf(linked());
      const form = byClass(header, "sync-rename-form");
      expect(form?.tagName).toBe("form");
      // Same visual idiom as the program-alias editor, so one inline-edit
      // pattern serves both surfaces.
      expect(form?.className.split(/\s+/)).toContain("rename-form");

      const input = byFkey(form, "ws-rename-input:" + WS_ID);
      expect(input?.tagName).toBe("input");
      // el() assigns `value` as a property — a content attribute is inert here.
      expect(input?.value).toBe("SYNC · rf");
      expect(input?.attributes["aria-label"]).toBe("New title for workspace SYNC · rf");
      expect(byFkey(form, "ws-rename-save:" + WS_ID)?.attributes.type).toBe("submit");
      expect(byFkey(form, "ws-rename-cancel:" + WS_ID)?.attributes.type).toBe("button");
      // The trigger is replaced by the editor, not doubled beside it.
      expect(byFkey(header, "ws-rename:" + WS_ID)).toBeNull();
      // The evidence line names the object and warns about the shared scope.
      expect(textOf(byClass(form, "rename-source"))).toContain(WS_ID);
    });

    // Opening seeds the draft from cmux truth rather than from the agent name.
    await withState(renameState({ snap: snapshot() }), async () => {
      await withRequests([], async () => {
        M.startWorkspaceRename({ workspaceId: WS_ID, title: "SYNC · rf" });
        expect(M.state.wsRenaming).toBe(WS_ID);
        expect(M.state.wsRenameDraft).toBe("SYNC · rf");
        expect(M.state.wsRenameError).toBe("");
      });
    });
  });

  test("save POSTs {workspaceId, title} to the frozen route and never echoes the typed title", async () => {
    await withState(renameState({ snap: snapshot(), wsRenaming: WS_ID, wsRenameDraft: "  SYNC · renamed  " }), async () => {
      await withRequests([{ status: 200, json: { ok: true } }], async (calls) => {
        await M.submitWorkspaceRename({ workspaceId: WS_ID, title: "SYNC · rf" });
        expect(calls).toHaveLength(1);
        expect(calls[0]!.method).toBe("POST");
        expect(calls[0]!.url).toBe("/api/sync/rename");
        expect(calls[0]!.body).toEqual({ workspaceId: WS_ID, title: "SYNC · renamed" });
        expect(M.state.wsRenaming).toBeNull();
        expect(M.state.wsRenamePending).toBe(false);
        expect(M.state.wsRenameError).toBe("");
      });

      /* The truth test: a FOREIGN rename lands between the save and the next
         paint. The field must show what the snapshot says, so the typed title
         is nowhere on screen. A client that echoed its own write fails here. */
      const foreign = linked({ target: linkedTarget({ workspaceTitle: "renamed in cmux" }) });
      const row = byClass(headerOf(foreign), "drawer-workspace");
      expect(textOf(row)).toContain("renamed in cmux");
      expect(textOf(row)).not.toContain("SYNC · renamed");
      expect(byFkey(row, "ws-rename:" + WS_ID)?.attributes["aria-label"])
        .toBe("Rename workspace renamed in cmux");
    });
  });

  test("a refusal states cmux's reason, restores the original title, and keeps the editor open", async () => {
    const refusals: Array<[Record<string, unknown>, string]> = [
      [{ ok: false, code: "invalid_title" }, "title"],
      [{ ok: false, code: "anchor" }, "group"],
    ];
    for (const [body, expected] of refusals) {
      await withState(renameState({ snap: snapshot(), wsRenaming: WS_ID, wsRenameDraft: "   " }), async () => {
        await withRequests([{ status: 200, json: body }], async () => {
          await M.submitWorkspaceRename({ workspaceId: WS_ID, title: "SYNC · rf" });
          expect(M.state.wsRenaming).toBe(WS_ID);
          expect(M.state.wsRenamePending).toBe(false);
          expect(M.state.wsRenameError).toContain(expected);
          // The original title is what the operator gets back, never their
          // rejected draft.
          expect(M.state.wsRenameDraft).toBe("SYNC · rf");
        });
        const form = byClass(headerOf(linked()), "sync-rename-form");
        expect(textOf(byClass(form, "rename-error"))).toBe(M.state.wsRenameError);
        expect(byClass(form, "rename-error")?.attributes.role).toBe("alert");
      });
    }

    // A refusal the client has no sentence for still names the code rather than
    // reporting a silent success. Same for an unreachable server.
    await withState(renameState({ snap: snapshot(), wsRenaming: WS_ID, wsRenameDraft: "x" }), async () => {
      await withRequests([{ status: 404, json: { ok: false, code: "not_found" } }], async () => {
        await M.submitWorkspaceRename({ workspaceId: WS_ID, title: "SYNC · rf" });
        expect(M.state.wsRenameError).toContain("not_found");
        expect(M.state.wsRenaming).toBe(WS_ID);
      });
      await withRequests([new Error("connection refused")], async () => {
        await M.submitWorkspaceRename({ workspaceId: WS_ID, title: "SYNC · rf" });
        expect(M.state.wsRenameError).toMatch(/reach|failed/i);
        expect(M.state.wsRenaming).toBe(WS_ID);
      });
    });
  });

  test("Enter saves, Escape cancels, and focus returns to the trigger either way", async () => {
    // Enter in a text input submits its form; the form's submit handler is the
    // save path, so the two cannot drift apart.
    await withState(renameState({ snap: snapshot(), wsRenaming: WS_ID, wsRenameDraft: "typed by hand" }), async () => {
      await withRequests([{ status: 200, json: { ok: true } }], async (calls) => {
        const form = byClass(headerHere(linked()), "sync-rename-form");
        await fire(form, "submit");
        expect(calls.map((c) => [c.method, c.url])).toEqual([["POST", "/api/sync/rename"]]);
        expect(calls[0]!.body.title).toBe("typed by hand");
      });
    });

    await withState(renameState({ snap: snapshot(), wsRenaming: WS_ID, wsRenameDraft: "abandoned" }), async () => {
      await withRequests([], async (calls) => {
        const focused = trackFocusByFkey();
        const input = byFkey(byClass(headerHere(linked()), "sync-rename-form"), "ws-rename-input:" + WS_ID);
        await fire(input, "keydown", { key: "Escape" });
        expect(M.state.wsRenaming).toBeNull();
        expect(calls).toEqual([]);          // cancelling writes nothing to cmux
        expect(focused()).toEqual(["ws-rename:" + WS_ID]);
      });
    });

    await withState(renameState({ snap: snapshot(), wsRenaming: WS_ID, wsRenameDraft: "saved" }), async () => {
      await withRequests([{ status: 200, json: { ok: true } }], async () => {
        const focused = trackFocusByFkey();
        await M.submitWorkspaceRename({ workspaceId: WS_ID, title: "SYNC · rf" });
        expect(focused()).toEqual(["ws-rename:" + WS_ID]);
      });
    });
  });

  test("an in-flight save holds its own controls and repaints the drawer", async () => {
    await withState(renameState({ wsRenaming: WS_ID, wsRenameDraft: "SYNC · rf", wsRenamePending: true }), () => {
      const form = byClass(headerOf(linked()), "sync-rename-form");
      const save = byFkey(form, "ws-rename-save:" + WS_ID);
      expect(save?.attributes.disabled).toBe("");
      expect(save?.attributes["aria-busy"]).toBe("true");
      expect(byFkey(form, "ws-rename-input:" + WS_ID)?.attributes.disabled).toBe("");
    });

    /* The drawer early-returns on an unchanged paint signature, so every flag
       the editor reads has to be IN that signature or the form never appears.
       The draft deliberately is not: tearing down a live text box is the bug
       that rule exists to stop. */
    const sel = { kind: "agent", id: "codex:rf" };
    const view = { kind: "agent", agent: linked(), program: { id: "p", name: "P", agents: [linked()] } };
    const sig = (patch: Record<string, unknown>) =>
      M.inspectorPaintSig(sel, view, identityUi({ ...renameState(), ...patch }));
    expect(sig({ wsRenaming: WS_ID })).not.toBe(sig({}));
    expect(sig({ wsRenamePending: true })).not.toBe(sig({}));
    expect(sig({ wsRenameError: "nope" })).not.toBe(sig({}));
    expect(sig({ wsRenameDraft: "mid-typing" })).toBe(sig({}));
  });

  test("the rename control clears 44px on touch and every new class has a rule", () => {
    const after = styles.slice(styles.indexOf("@media (max-width: 1024px)"));
    const block = after.slice(0, after.indexOf("@media (max-width: 720px)"));
    const sweep = block.match(/[^{}]*\{\s*min-height:\s*44px;\s*\}/)?.[0] ?? "";
    expect(sweep).toContain(".drawer-workspace-rename");
    for (const name of ["drawer-workspace", "drawer-workspace-label", "drawer-workspace-title", "drawer-workspace-rename", "sync-rename-form"]) {
      expect(styles.includes("." + name), name).toBe(true);
    }
    // Strict CSP: the affordance ships no inline style attribute.
    const drawer = source.match(/function renderWorkspaceRename\(agent\) \{[\s\S]*?\n\}\n/)?.[0] ?? "";
    expect(drawer).toBeTruthy();
    expect(drawer).not.toContain("style:");
  });
});

/* Records which data-fkey the client asked the document for and focused, so
   "focus returns to the trigger" is asserted against the real restore call
   rather than against the source text that makes it. The fake document's
   querySelector answers nothing by default — this is the only test surface that
   needs it to answer something. */
function trackFocusByFkey(): () => string[] {
  const seen: string[] = [];
  const doc = G.document as { querySelector: (selector: string) => unknown };
  doc.querySelector = (selector: string) => {
    const key = /\[data-fkey="(.*)"\]/.exec(selector)?.[1];
    if (key == null) return null;
    return { focus: () => seen.push(key), select: () => {} };
  };
  return () => seen;
}
