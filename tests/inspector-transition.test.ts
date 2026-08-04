import { beforeAll, describe, expect, test } from "bun:test";

/* The drawer TRANSITION — what the panel does between one agent and the next.

   Measured on the live board before this existed: with agent A's drawer scrolled
   291px down, flicking to agent B repainted B's content and put 291px back, so
   the operator landed part-way into a stranger's drawer with its <h2> 246px above
   the top of the pane — an unnamed panel holding a live Send box. render() saved
   and restored inspector.scrollTop unconditionally, which is exactly right for an
   SSE repaint under a drawer someone is reading and exactly wrong across a change
   of entity, and nothing told the two apart.

   paintedEntityKey is what tells them apart, so the part worth pinning is its
   BINDING to the real signature: that it stays equal while only the agent's data
   moves, and stops being equal the moment the entity does. Both directions are
   load-bearing — an over-eager key would reset the scroll on every 4s snapshot
   and reintroduce the yank the restore exists to prevent.

   The DOM halves (render() consulting it, closeInspector returning focus) are
   asserted against the source: this client has no jsdom by policy, and the
   package carries zero runtime dependencies. */

interface Seam {
  inspectorPaintSig: (sel: unknown, view: unknown, ui: unknown) => string;
}
interface ClientState {
  paintedEntityKey: (sig: string) => string | null;
}
let M: Seam;
let paintedEntityKey: ClientState["paintedEntityKey"];
let source: string;

beforeAll(async () => {
  // @ts-expect-error the dependency-free browser client has no declaration file
  await import("../src/web/app.js");
  M = (globalThis as unknown as { TheAntHill: Seam }).TheAntHill;
  // @ts-expect-error same — dynamic import keeps tsc off a module with no .d.ts
  const clientState: ClientState = await import("../src/web/client-state.js");
  paintedEntityKey = clientState.paintedEntityKey;
  source = await Bun.file(new URL("../src/web/app.js", import.meta.url)).text();
});

const agent = (over: Record<string, unknown> = {}) => ({
  id: "codex:a1",
  provider: "codex",
  sourceSessionId: "a1",
  displayName: "Alpha",
  programId: "p",
  status: "running",
  statusReason: "Working.",
  activity: "working",
  outcome: "healthy",
  updatedAt: "2026-08-03T12:00:00.000Z",
  elapsedMs: 60_000,
  tokens: null,
  target: null,
  ...over,
});

const program = (agents: unknown[]) => ({ id: "p", name: "P", agents });

const ui = (agents: unknown[], over: Record<string, unknown> = {}) => ({
  snap: { generatedAt: "2026-08-03T12:00:00.000Z", programs: [program(agents)] },
  queueItems: [] as unknown[],
  triage: new Map(),
  triagePending: new Set<string>(),
  evidenceOpen: false,
  pending: new Set<string>(),
  feedback: new Map(),
  confirming: null,
  renaming: null,
  renamePending: false,
  renameError: "",
  labelsLoading: false,
  labelLoadError: "",
  identity: { agentId: null, loading: false, error: "", data: null },
  transcript: { agentId: null, loading: false, error: "", data: null, limit: 200 },
  actions: { loading: false, error: "", available: true, items: [], fetchedAt: 0 },
  attention: new Map(),
  attentionPending: new Set<string>(),
  attentionErrors: new Map(),
  conn: "live",
  lastEventAt: Date.now(),
  ...over,
});

const sigFor = (id: string, over: Record<string, unknown> = {}, kind = "agent") => {
  const a = agent({ id, ...over });
  return M.inspectorPaintSig(
    { kind, id },
    { kind: "agent", agent: a, program: program([a]) },
    ui([a]),
  );
};

describe("drawer transition: the scroll offset belongs to one entity", () => {
  test("a signature with no entity behind it is not an entity", () => {
    // renderInspector writes "closed" when nothing is selected. If that compared
    // equal to a real drawer, opening one from the closed state would inherit
    // whatever offset the pane happened to be sitting at.
    expect(paintedEntityKey("closed")).toBeNull();
    expect(paintedEntityKey("")).toBeNull();
    expect(paintedEntityKey(null as unknown as string)).toBeNull();
    expect(paintedEntityKey(undefined as unknown as string)).toBeNull();
  });

  test("two different agents never share a key, so switching resets the scroll", () => {
    expect(paintedEntityKey(sigFor("codex:a1"))).not.toBe(paintedEntityKey(sigFor("codex:a2")));
  });

  test("one agent whose data moved keeps its key, so a live repaint does not yank", () => {
    /* The other half of the fix, and the one a careless key would break: these
       signatures differ (that is what drives the repaint at all), but they name
       the same drawer, so the operator's place in it must survive. Every field
       here is one an SSE snapshot really does move under an open drawer. */
    const base = paintedEntityKey(sigFor("codex:a1"));
    const moved = [
      ["status changed", { status: "attention", outcome: "needs-you" }],
      ["activity changed", { activity: "idle" }],
      ["message changed", { statusReason: "Waiting on a decision." }],
      ["tokens landed", { tokens: { total: 1000, contextWindow: 200_000, scope: "latest-turn", provenance: "observed" } }],
    ] as const;
    for (const [why, over] of moved) {
      const sig = sigFor("codex:a1", over as Record<string, unknown>);
      expect(sig, why + " must still repaint the drawer").not.toBe(sigFor("codex:a1"));
      expect(paintedEntityKey(sig), why + " must not move the operator").toBe(base);
    }
  });

  test("the same id under a different drawer kind is a different entity", () => {
    // Ids are unique per kind, not across kinds. Keying on the id alone would
    // carry an agent drawer's offset into a program drawer of the same name.
    expect(paintedEntityKey(sigFor("p", {}, "agent")))
      .not.toBe(paintedEntityKey(sigFor("p", {}, "program")));
  });
});

describe("drawer transition: render() and close honour the entity", () => {
  test("render() restores the drawer scroll only when the entity is unchanged", () => {
    /* The bug was one unconditional assignment. Pin the branch, not the comment:
       an edit that drops the comparison and restores flat again fails here. */
    expect(source).toContain("const inspectorShowed = paintedEntityKey(state.paintSig.inspector)");
    expect(source).toMatch(
      /inspector\.scrollTop\s*=\s*paintedEntityKey\(state\.paintSig\.inspector\)\s*===\s*inspectorShowed\s*\?\s*inspectorScroll\s*:\s*0/,
    );
    // The list pane keeps its unconditional restore — it is not entity-scoped.
    expect(source).toContain("main.scrollTop = listScroll;");
  });

  test("closing any drawer kind returns focus, not just an agent's", () => {
    /* state.selectedId is null for program / intervention / advisory / resolved
       drawers, so the agent-row route left those closing onto <body>. */
    expect(source).toContain("const origin = state.selectionOrigin;");
    expect(source).toContain("state.selectionOrigin = null;");
    expect(source).toMatch(/const back = row\s*\r?\n?\s*\|\|\s*\(origin \?/);
    expect(source).toContain("if (back) back.focus({ preventScroll: true });");
  });

  test("a control that renames itself under its own repaint does not strand focus", () => {
    /* render() restores focus by data-fkey. A control whose key changes as a
       result of the very click that repaints it is therefore unfindable, and
       focus lands on <body> — the top of the document, from inside the drawer.
       The Evidence disclosure is the live case: two keys for one control. */
    expect(source).toContain('dataset: { fkey: "shelf:evidence:open" }');
    expect(source).toContain('dataset: { fkey: "shelf:evidence:close" }');
    expect(source).toContain("inspector.contains(document.activeElement)");
    expect(source).toContain("else if (focusWasInDrawer && !inspector.hidden) focusDrawerLead();");
  });

  test("the fallback never guesses a sibling action button", () => {
    // Prefix-matching would have found shelf:evidence:close, and also would have
    // put focus on Archive when Interrupt disappeared. The fallback is the
    // drawer lead precisely so it can never land on an action.
    expect(source).not.toMatch(/data-fkey\^=|startsWith\(focusKey|focusKey\.slice\(0, focusKey\.lastIndexOf/);
  });

  test("the origin is only re-recorded from outside the drawer", () => {
    // A lineage link inside the drawer is destroyed by the repaint it triggers;
    // adopting it as the way back would strand the operator on a dead node.
    expect(source).toMatch(/if \(!\(origin && pane && pane\.contains\(origin\)\)\) \{/);
  });
});
