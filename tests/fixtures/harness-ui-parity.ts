/* The synthetic board the harness row-parity suites render.
 *
 * Every byte here is invented. No real username, account, store path, prompt,
 * model output, token count, credential, or production directory appears: the
 * homes are `/synthetic/...`, the ids are `ses_synthetic_*`, and the prose is
 * written for this file. That is a hard requirement rather than tidiness — the
 * suites that read this fixture assert on accessible names and titles, so any
 * real string would be published into test output and into any failure a CI
 * log captured.
 *
 * The cases are numbered R1-R23 and each one exists to make a specific claim
 * fail loudly. Where a field is ABSENT that absence is the assertion: R11's
 * missing `callSizes`, R13's missing context percent, R14's missing observed
 * total, R20's missing provider, and R22's missing timestamps are all load
 * bearing. Adding a plausible-looking value to any of them silently deletes the
 * regression it was written for.
 */

/* Structurally an `AgentSnapshot` row, but deliberately typed loose. The row
 * renderers are the dependency-free browser client with no declaration file,
 * and several cases exist precisely to model records the published type forbids
 * — R20 has no `provider` at all, R22 carries an unparseable timestamp. Typing
 * these as `CollectedAgent` would make the fixture uncompilable for the exact
 * shapes the fixture exists to prove the client survives. */
export type SyntheticRow = Record<string, unknown>;

const HOME = "/synthetic/workspace";

/** Shared baseline. Every case overrides only what its claim needs, so a
 *  difference between two rendered rows traces to a stated difference here. */
function row(over: SyntheticRow): SyntheticRow {
  return {
    programId: "prog_synthetic",
    status: "running",
    activity: "working",
    outcome: "healthy",
    lifecycle: "working",
    scope: "observed",
    startedAt: "2026-07-22T02:00:00.000Z",
    updatedAt: "2026-07-22T02:40:00.000Z",
    artifacts: [],
    gates: [],
    tokens: { provenance: "unknown" },
    ...over,
  };
}

/* ---------- R1-R3 · the same grammar from three different harnesses ----------
   These three exist to be compared against each other. Same activity, same
   outcome, same shape of evidence — so any difference in hierarchy, alignment,
   cell count or accessible naming between them is a parity defect and not a
   difference in what the sources reported. */

export const R1_CLAUDE_WORKING = row({
  id: "claude:ses_synthetic_r1",
  provider: "claude",
  sourceSessionId: "ses_synthetic_r1",
  displayName: "Claude · parity-fixture",
  model: "claude-opus-5",
  instanceLabel: "primary",
  task: "Draft the parity baseline row.",
  tokens: { provenance: "observed", scope: "latest-turn", input: 90, output: 30, total: 1200, contextWindow: 200_000 },
  target: { kind: "cmux", surfaceId: "surface_synthetic_1", resolution: "exact" },
});

export const R2_GEMINI_WORKING = row({
  id: "gemini:ses_synthetic_r2",
  provider: "gemini",
  sourceSessionId: "ses_synthetic_r2",
  displayName: "Gemini CLI · parity-fixture",
  model: "gemini-3.7-flash",
  instanceLabel: "primary",
  task: "Draft the Gemini comparison row.",
  tokens: { provenance: "observed", scope: "latest-turn", input: 90, output: 30, total: 1200, contextWindow: 200_000 },
  target: { kind: "cmux", surfaceId: "surface_synthetic_2", resolution: "exact" },
});

export const R3_OPENCODE_WORKING = row({
  id: "opencode:ses_synthetic_r3",
  provider: "opencode",
  sourceSessionId: "ses_synthetic_r3",
  displayName: "OpenCode · parity-fixture",
  model: "route-synthetic/model-alpha",
  instanceLabel: "primary",
  task: "Draft the OpenCode comparison row.",
  tokens: { provenance: "observed", scope: "latest-turn", input: 90, output: 30, total: 1200, contextWindow: 200_000 },
  target: { kind: "cmux", surfaceId: "surface_synthetic_3", resolution: "exact" },
});

/** R23 · Pi, the fourth member of the same comparison. Pi is a first-class
 *  provider with an official mark, so it belongs in the identical-grammar set
 *  rather than in a special case beside it. */
export const R23_PI_WORKING = row({
  id: "pi:ses_synthetic_r23",
  provider: "pi",
  sourceSessionId: "ses_synthetic_r23",
  displayName: "Pi · parity-fixture",
  model: "pi-synthetic-1",
  instanceLabel: "primary",
  task: "Draft the Pi comparison row.",
  tokens: { provenance: "observed", scope: "latest-turn", input: 90, output: 30, total: 1200, contextWindow: 200_000 },
  target: { kind: "cmux", surfaceId: "surface_synthetic_23", resolution: "exact" },
});

/* ---------- R4-R9 · the operator states ---------- */

export const R4_CODEX_WAITING = row({
  id: "codex:ses_synthetic_r4",
  provider: "codex",
  sourceSessionId: "ses_synthetic_r4",
  displayName: "Codex · parity-fixture",
  model: "gpt-synthetic-1",
  status: "waiting",
  activity: "idle",
  lifecycle: "waiting",
  task: "Wait for the operator to answer.",
});

export const R5_GEMINI_NEEDS_YOU = row({
  id: "gemini:ses_synthetic_r5",
  provider: "gemini",
  sourceSessionId: "ses_synthetic_r5",
  displayName: "Gemini CLI · needs-you-fixture",
  model: "gemini-3.7-flash",
  status: "attention",
  activity: "idle",
  outcome: "needs-you",
  lifecycle: "waiting",
  task: "Answer the pending question.",
});

export const R6_OPENCODE_STALLED = row({
  id: "opencode:ses_synthetic_r6",
  provider: "opencode",
  sourceSessionId: "ses_synthetic_r6",
  displayName: "OpenCode · stalled-fixture",
  model: "route-synthetic/model-alpha",
  status: "waiting",
  activity: "idle",
  lifecycle: "unverified",
  /* Stalled is not needs-you. A stalled row has nobody waiting on it; an
     amber alert row does. Collapsing the two is the defect this case pins. */
  updatedAt: "2026-07-21T02:40:00.000Z",
  task: "Stalled with no question pending.",
});

/** R7 · a Gemini row that genuinely ended. Deliberately Gemini rather than
 *  Claude: a Gemini session can reach `ended` and carry a liveness verdict, so
 *  a suite that only ever ends Claude rows would let "Gemini never ends" pass
 *  as an invariant. */
export const R7_GEMINI_ENDED = row({
  id: "gemini:ses_synthetic_r7",
  provider: "gemini",
  sourceSessionId: "ses_synthetic_r7",
  displayName: "Gemini CLI · ended-fixture",
  model: "gemini-3.7-flash",
  status: "archived",
  activity: "ended",
  lifecycle: "finished",
  provenance: "turn-complete",
  task: "Finished work, recorded as ended.",
});

export const R8_CURSOR_BLOCKED = row({
  id: "cursor:ses_synthetic_r8",
  provider: "cursor",
  sourceSessionId: "ses_synthetic_r8",
  displayName: "Cursor · blocked-fixture",
  model: "composer-synthetic-1",
  status: "attention",
  activity: "idle",
  outcome: "blocked",
  task: "Blocked on an external gate.",
});

/** R9 · failure is an OUTCOME, not a harness defect. The row must read as work
 *  that failed, never as a collector that broke. */
export const R9_GEMINI_FAILED = row({
  id: "gemini:ses_synthetic_r9",
  provider: "gemini",
  sourceSessionId: "ses_synthetic_r9",
  displayName: "Gemini CLI · failed-fixture",
  model: "gemini-3.7-flash",
  status: "attention",
  activity: "idle",
  outcome: "failed",
  task: "Work that failed on its own terms.",
});

/* ---------- R10-R11 · swarm parent and child ---------- */

export const R10_OPENCODE_PARENT = row({
  id: "opencode:ses_synthetic_root",
  provider: "opencode",
  sourceSessionId: "ses_synthetic_root",
  displayName: "OpenCode · parent-fixture",
  model: "route-synthetic/model-alpha",
  task: "Parent session with one child.",
});

/** R11 · every observed counter is a literal zero and stays one.
 *
 *  Zero here is a MEASUREMENT: the source counted and found none. It must not
 *  be laundered into "unknown", and the absent `callSizes` must not acquire an
 *  empty array — `[]` claims a series was observed and found empty, which is a
 *  different and false statement from "no series was published". */
export const R11_OPENCODE_CHILD = row({
  id: "opencode:ses_synthetic_child",
  provider: "opencode",
  sourceSessionId: "ses_synthetic_child",
  /* `parentAgentId`, carrying the PARENT'S AGENT ID — that is the field
     agentRowPlan walks to build clusters, and the value it matches against is
     the parent's `id`, not its session id. An earlier draft wrote
     `parentSessionId`, which no client code reads: the row rendered as an
     orphan and every depth assertion had to be hand-fed an opts.depth, proving
     the renderer accepts a number rather than that the tree is built. */
  parentAgentId: "opencode:ses_synthetic_root",
  displayName: "OpenCode · child-fixture",
  model: "route-synthetic/model-alpha",
  archivedAt: "2026-07-22T02:58:50.000Z",
  status: "archived",
  activity: "ended",
  lifecycle: "finished",
  tokens: { provenance: "observed", scope: "session", input: 0, output: 0, cachedInput: 0, total: 0 },
  task: "Child session that reported zero of everything.",
});

/** R12 · long labels must not widen, reorder, or move their neighbours.
 *
 *  Deliberately carries the SAME token report as R2. The case isolates label
 *  LENGTH, so every other input has to match its comparison row — a fixture
 *  that also withheld the token counts would omit the tokens cell and the
 *  topology comparison would fail for a reason that has nothing to do with how
 *  long the label is. */
export const R12_GEMINI_LONG = row({
  id: "gemini:ses_synthetic_r12",
  provider: "gemini",
  sourceSessionId: "ses_synthetic_r12",
  displayName: "Gemini CLI · " + "synthetic-long-session-name-".repeat(4) + "end",
  instanceLabel: "synthetic-long-instance-home-label-" + "x".repeat(50),
  model: "gemini-3.7-flash-synthetic-long-model-identifier",
  tokens: { provenance: "observed", scope: "latest-turn", input: 90, output: 30, total: 1200, contextWindow: 200_000 },
  target: { kind: "cmux", surfaceId: "surface_synthetic_12", resolution: "exact" },
  task: "Long-label case. " + "The summary continues at length to prove the row clamps rather than reflows. ".repeat(5),
});

/** R13 · the one case with a genuinely reported session figure.
 *
 *  `sessionProcessed` is published because the complete debug call series was
 *  observed. `callSizes` is DEBUG-ONLY and is therefore absent from this
 *  snapshot shape entirely — the property must not exist, not even empty. And
 *  no context percent: a processed total is not an occupancy reading. */
export const R13_OPENCODE_USAGE = row({
  id: "opencode:ses_synthetic_r13",
  provider: "opencode",
  sourceSessionId: "ses_synthetic_r13",
  displayName: "OpenCode · usage-fixture",
  model: "route-synthetic/model-alpha",
  tokens: {
    provenance: "observed",
    scope: "session",
    input: 120,
    output: 30,
    cachedInput: 400,
    sessionTotal: 557,
    sessionProcessed: 568,
  },
  task: "Session counters observed from the source.",
});

/** R14 · a catalog context WINDOW with no compatible observed total.
 *
 *  Gemini's window is known, so it is published. What is not known is a
 *  latest-turn observed total to measure against it, so there is no context
 *  percent to render and none may be invented. The cell falls to its unknown
 *  indicator; the tokens cell is omitted entirely because no count was
 *  reported. Never 0, 0%, $0, or an empty series. */
export const R14_GEMINI_UNKNOWN_USAGE = row({
  id: "gemini:ses_synthetic_r14",
  provider: "gemini",
  sourceSessionId: "ses_synthetic_r14",
  displayName: "Gemini CLI · unknown-usage-fixture",
  model: "gemini-3.7-flash",
  tokens: { provenance: "observed", scope: "session", contextWindow: 1_048_576 },
  task: "Window known, occupancy not reported.",
});

/* ---------- R15-R16 · control attestation ----------
   Both states arrive from the server's own control evidence. No client-side
   per-provider predicate decides either one; a row is linked because cmux
   attested a surface, not because of which harness produced it. */

/** R15 · controls attested. The client decides this from `target.resolution`
 *  alone — `exact` means cmux attested the surface — so the artifact below is
 *  the server's own evidence trail, NOT the thing the row reads. An earlier
 *  draft asserted that the artifact's path length proved identity, which proved
 *  only that the fixture wrote a long string; the public seam is the resolution
 *  and that is what the suite exercises. */
export const R15_GEMINI_LINKED = row({
  id: "gemini:ses_synthetic_r15",
  provider: "gemini",
  sourceSessionId: "ses_synthetic_r15",
  displayName: "Gemini CLI · linked-fixture",
  model: "gemini-3.7-flash",
  target: { kind: "cmux", surfaceId: "surface_synthetic_15", resolution: "exact" },
  artifacts: [{
    label: "GEMINI transcript",
    kind: "transcript",
    path: HOME + "/.gemini/tmp/synthetic-hash/chats/session-ses_synthetic_r15.jsonl",
  }],
  task: "Controls attested by an exact surface match.",
});

/** R16 · no cmux identity, so all three controls are refused and the row wears
 *  its own watch-only sentence. */
export const R16_OPENCODE_OBSERVED_ONLY = row({
  id: "opencode:ses_synthetic_r16",
  provider: "opencode",
  sourceSessionId: "ses_synthetic_r16",
  displayName: "OpenCode · observed-only-fixture",
  model: "route-synthetic/model-alpha",
  controlState: "observed-only",
  target: { kind: "cmux", resolution: "observed-only" },
  task: "Watch-only: no surface was attested.",
});

/** R16b · ambiguous evidence is quarantined rather than guessed. Two panes
 *  match and neither can be told apart, so the board refuses instead of
 *  picking — the failure mode that let a Send land on the wrong terminal. */
export const R16B_PI_QUARANTINED = row({
  id: "pi:ses_synthetic_r16b",
  provider: "pi",
  sourceSessionId: "ses_synthetic_r16b",
  displayName: "Pi · quarantined-fixture",
  model: "pi-synthetic-1",
  target: { kind: "cmux", resolution: "ambiguous" },
  task: "Two candidate surfaces, neither distinguishable.",
});

/** R20 · the FE-1 probe: a record whose provider field did not survive.
 *
 *  Deliberately NOT a PROVIDERS member and deliberately not a typo. This models
 *  an archived or degraded record that reached the client without its provider,
 *  which is the only production-reachable path into the harness-key fallback.
 *  It must never be presented as Claude. */
export const R20_MISSING_PROVIDER = row({
  id: "unknown:ses_synthetic_r20",
  sourceSessionId: "ses_synthetic_r20",
  displayName: "Recovered record",
  model: "",
  status: "archived",
  activity: "ended",
  lifecycle: "finished",
  task: "Archived record whose provider was not retained.",
});

/** R22 · corrupt and absent timestamps.
 *
 *  One unparseable epoch must not blank the row, and must never be clamped to
 *  1970, replaced by the file's mtime, or filled in from the clock. Identity and
 *  prose still render; the time-derived cells go honestly absent rather than
 *  printing `0s`, a measurement-implying dash, or `Invalid Date`. */
export const R22_OPENCODE_CORRUPT_TIME = row({
  id: "opencode:ses_synthetic_r22",
  provider: "opencode",
  sourceSessionId: "ses_synthetic_r22",
  displayName: "OpenCode · corrupt-timestamp-fixture",
  model: "route-synthetic/model-alpha",
  startedAt: undefined,
  updatedAt: "not-a-timestamp",
  diagnostics: ["invalid-record"],
  task: "Timestamps unreadable; identity and prose intact.",
});

/* ---------- cohorts ----------
   The same normalized row topology, rendered from the four providers that
   predate this work and from the four the integration added. Exported as two
   lists from ONE fixture so a suite can compare them directly rather than
   describing each separately and hoping the descriptions matched. */

/* The two cohorts carry EQUIVALENT EVIDENCE by construction.

   An earlier draft built the legacy cohort from whichever cases happened to be
   lying around — a waiting Codex row and a blocked Cursor row, neither of which
   reports tokens. Their rows therefore omit the tokens cell, correctly and by
   design. Comparing that against four token-reporting integrated rows made the
   topology differ for a reason that has nothing to do with the provider, and
   the only way to "fix" it would have been to stop omitting an unknown cell —
   punishing exactly the honesty this whole slice exists to protect.

   So both cohorts are minted by one builder from one evidence set. Any surviving
   difference is the provider, which is the only thing the comparison is for. */
function cohortRow(provider: string, i: number): SyntheticRow {
  return row({
    id: `${provider}:ses_synthetic_cohort_${i}`,
    provider,
    sourceSessionId: `ses_synthetic_cohort_${i}`,
    displayName: `cohort-${i}`,
    model: "synthetic-model-1",
    instanceLabel: "primary",
    task: "Cohort comparison row.",
    tokens: { provenance: "observed", scope: "latest-turn", input: 90, output: 30, total: 1200, contextWindow: 200_000 },
    target: { kind: "cmux", surfaceId: `surface_synthetic_cohort_${i}`, resolution: "exact" },
  });
}

/** Claude Code, Codex, Cursor, OMP — the cohort whose row grammar is the
 *  reference, complete and internally comparable. */
export const LEGACY_COHORT: SyntheticRow[] =
  ["claude", "codex", "cursor", "omp"].map((p, i) => cohortRow(p, i));

/** Gemini CLI, OpenCode, Pi — plus one Claude row on the SAME evidence, so the
 *  comparison is anchored to the legacy grammar rather than only to the
 *  integrated rows agreeing with each other. */
export const INTEGRATED_COHORT: SyntheticRow[] =
  ["claude", "gemini", "opencode", "pi"].map((p, i) => cohortRow(p, i + 10));

/** Every case, in case order. */
export const ALL_ROWS: SyntheticRow[] = [
  R1_CLAUDE_WORKING,
  R2_GEMINI_WORKING,
  R3_OPENCODE_WORKING,
  R4_CODEX_WAITING,
  R5_GEMINI_NEEDS_YOU,
  R6_OPENCODE_STALLED,
  R7_GEMINI_ENDED,
  R8_CURSOR_BLOCKED,
  R9_GEMINI_FAILED,
  R10_OPENCODE_PARENT,
  R11_OPENCODE_CHILD,
  R12_GEMINI_LONG,
  R13_OPENCODE_USAGE,
  R14_GEMINI_UNKNOWN_USAGE,
  R15_GEMINI_LINKED,
  R16_OPENCODE_OBSERVED_ONLY,
  R16B_PI_QUARANTINED,
  R20_MISSING_PROVIDER,
  R22_OPENCODE_CORRUPT_TIME,
  R23_PI_WORKING,
  ...LEGACY_COHORT.slice(3),
];

/** R21 · the mix reading. Six providers, four of which have a swatch colour
 *  today and two of which do not — the FE-5a probe. */
export const R21_MIX_PROVIDERS = [
  { prov: "claude", n: 3 },
  { prov: "codex", n: 2 },
  { prov: "cursor", n: 1 },
  { prov: "omp", n: 1 },
  { prov: "gemini", n: 5 },
  { prov: "opencode", n: 2 },
  { prov: "pi", n: 1 },
];

/* ---------- source health ----------
   R17 healthy · R18 degraded · R19 absent. The absent/degraded split is the
   whole point: a provider nobody installed is not a provider that broke, and
   only the second may be counted as a fault on an empty board. */
export const SOURCE_HEALTH_BY_PROVIDER: Record<string, Record<string, unknown>> = {
  /** R17 */
  gemini: { healthy: true },
  /** R18 — degraded. `absent` is OMITTED, not set false-y by accident, and a
   *  source-backed reason plus `lastHealthyAt` say it once worked. */
  opencode: {
    healthy: false,
    lastHealthyAt: "2026-07-22T01:00:00.000Z",
    reason: "Synthetic store could not be opened read-only.",
  },
  /** R19 — absent. Never installed, so never broken. */
  pi: { healthy: false, absent: true },
  claude: { healthy: true },
  codex: { healthy: true },
  cursor: { healthy: true },
  omp: { healthy: true },
};

/** An `AgentSnapshot`-shaped board carrying every case above. */
export function syntheticBoard(): Record<string, unknown> {
  const agents = ALL_ROWS;
  return {
    generatedAt: "2026-07-22T02:45:00.000Z",
    agents,
    programs: [{ id: "prog_synthetic", name: "Parity fixture", agents }],
    totals: {
      sourceHealth: {
        /* Derived from byProvider, never hand-written. The earlier literals said
           total 14 over a byProvider carrying 7 entries, so the board asserted a
           health summary that disagreed with its own breakdown — a fixture that
           could make a correct verdict look wrong, or a wrong one look right. */
        ...healthTotals(SOURCE_HEALTH_BY_PROVIDER),
        byProvider: SOURCE_HEALTH_BY_PROVIDER,
      },
    },
  };
}

/** Totals that agree with the breakdown they summarise. */
function healthTotals(byProvider: Record<string, Record<string, unknown>>) {
  const entries = Object.values(byProvider);
  const healthy = entries.filter((p) => p.healthy === true).length;
  const absent = entries.filter((p) => p.absent === true).length;
  return { total: entries.length, healthy, absent, degraded: entries.length - healthy - absent };
}

/* ---------- one uniform row per provider ----------
   Built from PROVIDERS rather than hand-listed, so a fifteenth provider joins
   every all-14 assertion the moment it joins the union. A hand-written list
   would silently keep testing fourteen. */

/** One row per PROVIDERS member, identical in every respect but the provider.
 *  Any difference in what the board renders for these therefore traces to the
 *  provider alone. */
export function allProviderRows(providers: readonly string[]): SyntheticRow[] {
  return providers.map((p, i) => row({
    id: `${p}:ses_synthetic_all_${i}`,
    provider: p,
    sourceSessionId: `ses_synthetic_all_${i}`,
    /* PROVIDER-NEUTRAL in every searchable field.

       `matchesQuery` hays the name, the task, the model, the cwd, the program
       name and the raw provider key. If ANY of those carried the harness word,
       a search for "Gemini CLI" could succeed without the label seam existing
       at all — the test would pass on the fixture's prose. The id and the
       provider field still name the provider because they are identity, not
       prose, and the raw key is the very thing the label is meant to replace. */
    displayName: `worker-${i}`,
    model: "synthetic-model-1",
    instanceLabel: "default-home",
    /* Every searchable string is checked against the provider keys themselves,
       not merely eyeballed. "comparison" was the leak that made this necessary:
       it contains `omp`, so a peer-label search for OMP matched all fourteen
       rows and the cross-provider negative could never fail. */
    task: "Uniform synthetic row.",
    cwd: "/synthetic/workspace/session",
    tokens: { provenance: "observed", scope: "latest-turn", input: 90, output: 30, total: 1200, contextWindow: 200_000 },
    target: { kind: "cmux", surfaceId: `surface_synthetic_all_${i}`, resolution: "exact" },
  }));
}

/** A program whose own name cannot answer a harness query either. */
export const NEUTRAL_PROGRAM = { id: "prog_synthetic", name: "Synthetic board", agents: [] as SyntheticRow[] };

/** Every string `matchesQuery` hays, for one row. Exported so the neutrality of
 *  the search inputs is proven rather than asserted by inspection. */
export function searchableStrings(r: SyntheticRow, programName: string): string[] {
  return [r.displayName, r.task, r.model, r.cwd, r.instanceLabel, r.statusReason, programName]
    .filter((v): v is string => typeof v === "string");
}

/** A board whose rows are the uniform per-provider set, for the lens and query
 *  seams. `generatedAt` is fixed; the caller supplies a lookback wide enough
 *  that the window never decides the answer. */
export function allProviderBoard(providers: readonly string[]): Record<string, unknown> {
  const agents = allProviderRows(providers);
  return {
    generatedAt: "2026-07-22T02:45:00.000Z",
    agents,
    programs: [{ id: "prog_synthetic", name: "Parity fixture", agents }],
    totals: {
      sourceHealth: {
        total: providers.length,
        healthy: providers.length,
        degraded: 0,
        absent: 0,
        byProvider: Object.fromEntries(providers.map((p) => [p, { healthy: true }])),
      },
    },
  };
}

/* ---------- isolated source-health boards ----------
   R18 and R19 shared one board, which meant "degraded is a fault" and "absent
   is not" were being proven by the same number. Each now gets a board carrying
   only its own case, so neither verdict can borrow the other's evidence. */

function healthBoard(byProvider: Record<string, Record<string, unknown>>): Record<string, unknown> {
  return {
    generatedAt: "2026-07-22T02:45:00.000Z",
    agents: [],
    programs: [],
    totals: { sourceHealth: { ...healthTotals(byProvider), byProvider } },
  };
}

/* ---------- long labels, per provider ----------
   A long label is a per-provider fact: "Gemini CLI" is nine characters wider
   than "Pi" before a single model string is added, so a clamp proven on one
   provider is not proven on the others. */
export function longLabelRow(provider: string): SyntheticRow {
  return row({
    id: `${provider}:ses_synthetic_long`,
    provider,
    sourceSessionId: "ses_synthetic_long",
    displayName: `${provider}-` + "synthetic-long-session-name-".repeat(4) + "end",
    instanceLabel: "synthetic-long-instance-home-label-" + "x".repeat(50),
    model: `${provider}-synthetic-long-model-identifier-that-keeps-going`,
    task: "Long-label case. " + "The summary continues at length to prove the row clamps rather than reflows. ".repeat(5),
    tokens: { provenance: "observed", scope: "latest-turn", input: 90, output: 30, total: 1200, contextWindow: 200_000 },
    target: { kind: "cmux", surfaceId: `surface_synthetic_long_${provider}`, resolution: "exact" },
  });
}

/* ---------- control states, per provider ----------
   Four states the row, Inspector and dock all have to agree about. Built per
   provider so "controls follow attestation, not harness" is proven by rendering
   rather than by one shared call to deriveControlState. */
/* Each case carries the CAPABILITY EVIDENCE the server would publish —
   `agent.controls`, an array of `{ action, enabled, reason }` — because that is
   what `capability()` reads and what the banner, the dock and the composer all
   branch on. A fixture with only a `target` proves the state word; it does not
   prove that any control was actually offered or refused.

   `unavailable` is deliberately NOT an observed-only alias. Both refuse, but
   they refuse for different reasons — one was never identified, the other has
   no control channel at all — and an operator who is told the wrong one goes
   looking for the wrong fix. Its refusal text is its own. */
const ACTIONS = ["instruct", "focus", "interrupt"] as const;

const allow = () => ACTIONS.map((action) => ({ action, enabled: true }));
const refuse = (reason: string) => ACTIONS.map((action) => ({ action, enabled: false, reason }));

export const CONTROL_CASES: Array<{ key: string; state: string; refusal: string | null; over: SyntheticRow }> = [
  {
    key: "exact",
    state: "linked",
    refusal: null,
    over: {
      target: { kind: "cmux", surfaceId: "surface_synthetic_ctl", resolution: "exact" },
      controls: allow(),
    },
  },
  {
    key: "observed-only",
    state: "observed-only",
    refusal: "This session's terminal was not identified, so it can be watched but not driven.",
    over: {
      controlState: "observed-only",
      target: { kind: "cmux", resolution: "observed-only" },
      controls: refuse("This session's terminal was not identified, so it can be watched but not driven."),
    },
  },
  {
    key: "quarantined",
    state: "quarantined",
    refusal: "Two panes match this session and neither can be told apart, so every write is refused.",
    over: {
      target: { kind: "cmux", resolution: "ambiguous" },
      controls: refuse("Two panes match this session and neither can be told apart, so every write is refused."),
    },
  },
  {
    key: "unavailable",
    state: "observed-only",
    /* Its OWN sentence. Sharing observed-only's wording would certify this case
       by alias and hide the distinction the operator needs. */
    refusal: "No control channel exists for this session, so there is nothing to send to.",
    over: {
      target: {},
      controls: refuse("No control channel exists for this session, so there is nothing to send to."),
    },
  },
];

export function controlRow(provider: string, over: SyntheticRow): SyntheticRow {
  return row({
    id: `${provider}:ses_synthetic_ctl`,
    provider,
    sourceSessionId: "ses_synthetic_ctl",
    displayName: `${provider}-controls`,
    model: "synthetic-model-1",
    task: "Control attestation case.",
    ...over,
  });
}

/** Every snapshot-shaped row this fixture publishes, for the whole-set audits
 *  (`callSizes` must not exist on any of them). */
export function everySnapshotRow(providers: readonly string[]): SyntheticRow[] {
  return [
    ...ALL_ROWS,
    ...LEGACY_COHORT,
    ...INTEGRATED_COHORT,
    ...allProviderRows(providers),
    ...providers.map((p) => longLabelRow(p)),
    ...providers.flatMap((p) => CONTROL_CASES.map((c) => controlRow(p, c.over))),
  ];
}

/** R18 alone — one collector that WAS healthy and is not now. A fault. */
export const DEGRADED_ONLY_BOARD = () => healthBoard({
  claude: { healthy: true },
  opencode: {
    healthy: false,
    lastHealthyAt: "2026-07-22T01:00:00.000Z",
    reason: "Synthetic store could not be opened read-only.",
  },
});

/** R19 alone — one collector that was never installed. Not a fault. */
export const ABSENT_ONLY_BOARD = () => healthBoard({
  claude: { healthy: true },
  pi: { healthy: false, absent: true },
});

/** Nothing installed at all. Still not a fault: a newcomer running one harness
 *  must not be told on their first screen that something is broken. */
export const ALL_ABSENT_BOARD = () => healthBoard({
  opencode: { healthy: false, absent: true },
  pi: { healthy: false, absent: true },
});
