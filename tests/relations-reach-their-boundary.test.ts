import { describe, expect, test } from "bun:test";
import { buildSnapshot } from "../src/server/snapshot";
import { PulseTracker } from "../src/server/pulse";
import type { ArchiveStore, CollectedAgent } from "../src/server/types";

/* THE LAST UNCOVERED CLASS: a relation between two quantities that never meets
   a case where it could fail.

   tests/published-fields-can-vary.test.ts catches a FIELD that stops varying.
   It is blind to a relation whose two sides both vary healthily and yet never
   take values that make the comparison bite. Two live examples from the GPT
   lane's audit, neither of which that file can see:

     J5  tokenReporting <= tokenEligible   observed at 5 vs 5, always
     J10 needsYou identity                 observed at 0 == 0, always

   Both sides of J5 vary across a real fleet. The relation is still vacuous,
   because they have never been DIFFERENT from each other — `a <= b` where a and
   b are always the same number would hold even if the implementation assigned
   one from the other by mistake.

   THE PROPERTY, which is not "both sides varied":

     a <= b   is untested unless the population contains a sample where a === b
              (so the bound is reachable, not permanently slack) AND a sample
              where a < b (so the two are genuinely different quantities rather
              than one expression written twice).

     a === b  is untested unless the shared value itself takes more than one
              value. 0 === 0 across every sample tests nothing.

   A relation that cannot reach a case must be registered with a reason, the
   same friction as the field register. */

const archiveStore: ArchiveStore = { has: () => false, archive: async () => {} };
const T0 = Date.parse("2026-08-02T12:00:00.000Z");
const BUCKET_MS = 5 * 60_000;

function agent(overrides: Partial<CollectedAgent> = {}): CollectedAgent {
  return {
    id: "codex:a1",
    provider: "codex",
    sourceSessionId: "a1",
    displayName: "Ridge worker",
    cwd: "/tmp/project",
    status: "running",
    statusReason: "Fixture activity is recent.",
    updatedAt: new Date(T0).toISOString(),
    tokens: { sessionTotal: 50_000, total: 400_000, provenance: "observed", contextWindow: 1_000_000 },
    artifacts: [],
    gates: [],
    processAlive: true,
    ...overrides,
  } as CollectedAgent;
}

const many = (count: number, overrides: (index: number) => Partial<CollectedAgent>) =>
  Array.from({ length: count }, (_, index) =>
    agent({ id: `codex:a${index}`, sourceSessionId: `a${index}`, ...overrides(index) }));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function board(agents: readonly CollectedAgent[], extra: Record<string, unknown> = {}): any {
  const tracker = new PulseTracker();
  for (const [at, sessionTotal] of [[T0 - 2 * BUCKET_MS, 0], [T0 - BUCKET_MS + 60_000, 90_000]] as const) {
    tracker.observe(
      buildSnapshot({
        agents: agents.map((a) => ({ ...a, tokens: { ...a.tokens, sessionTotal } })),
        surfaces: [], archiveStore, now: new Date(at),
      }),
      at,
    );
  }
  return { ...buildSnapshot({ agents, surfaces: [], archiveStore, now: new Date(T0), ...extra }), pulse: tracker.report(T0) };
}

/* The population. Chosen to make relations DIFFER, which is a harder job than
   making fields vary — several of these exist only to separate two numbers
   that a naive fleet keeps equal. */
const POPULATION: readonly { label: string; snapshot: unknown }[] = [
  { label: "empty", snapshot: board([]) },
  { label: "all reporting tokens", snapshot: board(many(4, () => ({}))) },
  /* Separates tokenReporting from tokenEligible: eligible counts working
     agents, reporting counts those with a token total. An agent with no total
     is eligible and not reporting, which is the only way the two differ. */
  { label: "some working agents report no tokens", snapshot: board([
    agent({ id: "codex:r1", sourceSessionId: "r1" }),
    agent({ id: "codex:r2", sourceSessionId: "r2", tokens: { provenance: "unknown" } } as Partial<CollectedAgent>),
    agent({ id: "codex:r3", sourceSessionId: "r3", tokens: { provenance: "unknown" } } as Partial<CollectedAgent>),
  ]) },
  { label: "one asking for a human", snapshot: board([agent({
    status: "attention",
    attentionSignal: { kind: "question-pending", detail: "Waiting." },
  } as Partial<CollectedAgent>)]) },
  { label: "several asking for a human", snapshot: board(many(5, (i) => (i < 3 ? {
    status: "attention",
    attentionSignal: { kind: "question-pending", detail: "Waiting." },
  } : {}) as Partial<CollectedAgent>)) },
  { label: "a live fleet gone quiet", snapshot: board(many(4, () => ({
    updatedAt: new Date(T0 - 3 * 60 * 60_000).toISOString(), status: "waiting", processAlive: true,
  }))) },
  { label: "a fleet that has finished", snapshot: board(many(3, () => ({
    status: "stale", processAlive: false, processIds: [4_242],
    updatedAt: new Date(T0 - 6 * 60 * 60_000).toISOString(),
  }))) },
  { label: "mixed activity", snapshot: board(many(6, (i) => ({
    status: i % 3 === 0 ? "running" : i % 3 === 1 ? "waiting" : "stale",
  }))) },
];

type Kind = "le" | "eq";
interface Relation {
  readonly label: string;
  readonly kind: Kind;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly left: (snapshot: any) => number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly right: (snapshot: any) => number;
}

const RELATIONS: readonly Relation[] = [
  { label: "tokenReporting <= tokenEligible", kind: "le",
    left: (s) => s.totals.tokenReporting, right: (s) => s.totals.tokenEligible },
  { label: "burn.coverage.reporting <= burn.coverage.eligible", kind: "le",
    left: (s) => s.pulse.burn.coverage.reporting, right: (s) => s.pulse.burn.coverage.eligible },
  { label: "attention <= tracked", kind: "le",
    left: (s) => s.totals.attention, right: (s) => s.totals.tracked },
  /* Declared as an EQUALITY, not <=. The instrument caught this as my own
     modelling error: `live` is DEFINED as working + idle, so writing it as <=
     was an inequality that could never be strict. Stating it as === is both
     honest and stronger — it fails if either side drifts. */
  { label: "working + idle === live", kind: "eq",
    left: (s) => s.totals.working + s.totals.idle, right: (s) => s.totals.live },
  { label: "stalled === stalledAgentIds.length", kind: "eq",
    left: (s) => s.pulse.momentum.stalled, right: (s) => s.pulse.momentum.stalledAgentIds.length },
  { label: "needsYou === agents carrying an attention signal", kind: "eq",
    left: (s) => s.totals.needsYou,
    right: (s) => s.programs.flatMap((p: { agents: unknown[] }) => p.agents)
      .filter((a: { attentionSignal?: unknown }) => Boolean(a.attentionSignal)).length },
];

/* Relations that genuinely cannot reach a case in this population, with the
   reason and what covers them instead. Same friction as the field register:
   adding an entry is meant to make somebody think. */
const UNREACHABLE: Record<string, string> = {
  "burn.coverage.reporting <= burn.coverage.eligible":
    "This population cannot separate them: board() assigns the same sessionTotal to every agent on "
    + "each observe, so an agent is eligible and reporting together or neither. Separating them needs "
    + "an agent with provenance 'observed' and no sessionTotal, which this harness cannot express. "
    + "Covered by tests/burn-rate-denominator.test.ts, which drives coverage through the tracker directly.",
};

interface Coverage { readonly tight: number; readonly strict: number; readonly distinctValues: number }

function coverage(relation: Relation): Coverage {
  let tight = 0;
  let strict = 0;
  const values = new Set<number>();
  for (const { snapshot } of POPULATION) {
    const a = relation.left(snapshot);
    const b = relation.right(snapshot);
    if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
    values.add(a);
    if (a === b) tight += 1;
    else if (a < b) strict += 1;
  }
  return { tight, strict, distinctValues: values.size };
}

describe("a relation is only tested where it could have failed", () => {
  test("every <= relation reaches its bound AND is exercised away from it", () => {
    /* THE INSTRUMENT. A relation with no tight case is permanently slack — it
       has never been near failing. A relation with no strict case is `===` in
       disguise: it would hold even if one side were assigned from the other.

       J5 is the second kind. tokenReporting <= tokenEligible was observed at
       5 vs 5 on every real sample, so nothing distinguishes it from a single
       expression written twice. */
    const failures = RELATIONS.filter(({ kind }) => kind === "le")
      .filter(({ label }) => !(label in UNREACHABLE))
      .map((relation) => ({ label: relation.label, ...coverage(relation) }))
      .filter(({ tight, strict }) => tight === 0 || strict === 0)
      .map(({ label, tight, strict }) => `${label} [tight=${tight} strict=${strict}]`);

    expect(
      failures,
      "These <= relations never met a case that could distinguish them from a tautology. "
      + "tight=0 means the bound was never reached, so the constraint has never been near failing. "
      + "strict=0 means the two sides were never different, so <= is === in disguise. "
      + "Widen the population, or register the relation with a reason.",
    ).toEqual([]);
  });

  test("every === relation is exercised at more than one value", () => {
    /* J10's shape. `0 == 0` across every sample holds for any implementation
       that returns zero from both sides, including one that computes neither. */
    const failures = RELATIONS.filter(({ kind }) => kind === "eq")
      .filter(({ label }) => !(label in UNREACHABLE))
      .map((relation) => ({ label: relation.label, ...coverage(relation) }))
      .filter(({ distinctValues }) => distinctValues < 2)
      .map(({ label, distinctValues }) => `${label} [distinct=${distinctValues}]`);

    expect(
      failures,
      "These === relations held at a single value across the whole population, which any "
      + "implementation returning that value from both sides would satisfy.",
    ).toEqual([]);
  });

  test("the relations actually hold, so coverage is not being measured on a broken board", () => {
    /* The control. Coverage of a relation that is FALSE is not a good sign, and
       measuring reach without checking truth would report healthy on a fleet
       where every relation was violated. */
    for (const relation of RELATIONS) {
      for (const { label, snapshot } of POPULATION) {
        const a = relation.left(snapshot);
        const b = relation.right(snapshot);
        if (relation.kind === "le") expect(a, `${relation.label} violated on "${label}"`).toBeLessThanOrEqual(b);
        else expect(a, `${relation.label} violated on "${label}"`).toBe(b);
      }
    }
  });

  test("the population is what does the work, so it is asserted rather than assumed", () => {
    /* This file is exactly as good as POPULATION, and unlike a field census a
       relation needs states built to SEPARATE two numbers — which is a harder
       fixture job and the reason J5 stayed vacuous on real data for months.

       Asserted here so a future edit that simplifies the population fails
       loudly rather than quietly reducing every relation to a tautology. */
    expect(POPULATION.length).toBeGreaterThanOrEqual(8);
    expect(RELATIONS.length).toBeGreaterThanOrEqual(6);

    const shapes = new Set(POPULATION.map(({ snapshot }) => JSON.stringify(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      [(snapshot as any).totals, (snapshot as any).pulse.momentum.stalled],
    )));
    expect(shapes.size, "population states collapsed into fewer distinct boards").toBe(POPULATION.length);
  });

  test("a registered relation must say why it cannot reach its case", () => {
    // Same rule as the field register: an entry with no reason is a relation
    // nothing tests, with a paper trail that looks like diligence.
    for (const [label, reason] of Object.entries(UNREACHABLE)) {
      expect(reason.length, `${label}: register entry is too short to say anything`).toBeGreaterThan(60);
      expect(RELATIONS.map((r) => r.label), `${label}: registered but not a declared relation`).toContain(label);
    }
  });
});
