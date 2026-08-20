import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseClaudeJsonl, parseCodexJsonl, parseOmpJsonl } from "../src/server/collectors";
import { parseCursorChildSession } from "../src/server/cursor";
import { parseGeminiJsonl } from "../src/server/gemini";
import { sessionCallsResponse } from "../src/server/session-calls";
import { buildSnapshot } from "../src/server/snapshot";
import type { CollectedAgent } from "../src/server/types";
import type { HubSnapshot } from "../src/shared/types";

/* The per-call series — the evidence that makes a cross-source disagreement
   attributable instead of merely detectable.

   The board and OpenBurnBar disagreed about one session: 293,235 against
   112,258. Two totals cannot adjudicate that. Settling it required knowing that
   112,258 was the sum of the session's first THREE calls of seven, which is the
   signature of a recorder that stopped rather than of two applications counting
   differently — a disagreement about cache accounting differs by some ratio of
   the prefix, it does not agree to the token for three calls and then diverge.

   These pin the properties that make that argument possible at all: the series
   is what the board actually added up, a prefix is recognisable as a prefix,
   and absence is reported as absence. */

const at = (minute: number): string => `2026-08-02T10:${String(minute).padStart(2, "0")}:00.000Z`;
const roots: string[] = [];
afterAll(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

/** The session that produced the live disagreement, in shape: seven calls, each
    re-reading a growing cached prefix. */
const CALLS = [
  { input: 6, output: 341, cache_read_input_tokens: 35_489, cache_creation_input_tokens: 0 },
  { input: 1, output: 301, cache_read_input_tokens: 35_489, cache_creation_input_tokens: 2_254 },
  { input: 1, output: 139, cache_read_input_tokens: 37_743, cache_creation_input_tokens: 494 },
  { input: 1, output: 1_173, cache_read_input_tokens: 38_237, cache_creation_input_tokens: 4_871 },
  { input: 1, output: 199, cache_read_input_tokens: 43_108, cache_creation_input_tokens: 1_385 },
  { input: 1, output: 139, cache_read_input_tokens: 44_493, cache_creation_input_tokens: 408 },
  { input: 1, output: 1_266, cache_read_input_tokens: 44_901, cache_creation_input_tokens: 793 },
];

function claudeTranscript(options: { duplicateEvery?: number } = {}): string {
  const rows: unknown[] = [
    { type: "user", timestamp: at(0), sessionId: "s", session_id: "s", cwd: "/p", message: { role: "user", content: "go" } },
  ];
  CALLS.forEach((call, index) => {
    const row = {
      type: "assistant", timestamp: at(index + 1), sessionId: "s", session_id: "s", cwd: "/p",
      message: {
        role: "assistant", id: `msg_${index}`, stop_reason: "end_turn", content: `turn ${index}`,
        usage: {
          input_tokens: call.input, output_tokens: call.output,
          cache_read_input_tokens: call.cache_read_input_tokens,
          cache_creation_input_tokens: call.cache_creation_input_tokens,
        },
      },
    };
    rows.push(row);
    // Claude rewrites a message as its turn streams; the real session had 12
    // usage rows for 7 calls.
    if (options.duplicateEvery && index % options.duplicateEvery === 0) rows.push(row);
  });
  return rows.map((row) => JSON.stringify(row)).join("\n");
}

const sizeOf = (call: typeof CALLS[number]): number =>
  call.input + call.output + call.cache_read_input_tokens + call.cache_creation_input_tokens;

describe("the series is what the board added up", () => {
  test("its sum IS sessionProcessed, not a second number that agrees", async () => {
    /* THE PROPERTY the whole endpoint rests on. `sessionProcessed` is now
       reduced from `callSizes` rather than off the rows separately, so an
       external check summing a prefix of this series is summing exactly the
       numbers the board totalled. Two derivations that merely agree today is
       the failure mode this replaces. */
    const agent = parseClaudeJsonl(claudeTranscript(), { nowMs: Date.parse(at(9)) })!;

    expect(agent.callSizes).toHaveLength(7);
    expect(agent.callSizes!.reduce((total, size) => total + size, 0)).toBe(agent.tokens.sessionProcessed!);
    // The live figure, so a refactor that changes the unit fails here loudly.
    expect(agent.tokens.sessionProcessed).toBe(293_235);
  });

  test("a streamed rewrite is one call, not two", async () => {
    /* Dedup, at the series level. The real transcript carried 12 usage rows for
       7 calls; a series that counted rewrites would put extra boundaries in it,
       and a prefix match against a foreign total would then land on a call that
       never happened. */
    const agent = parseClaudeJsonl(claudeTranscript({ duplicateEvery: 2 }), { nowMs: Date.parse(at(9)) })!;

    expect(agent.callSizes).toHaveLength(7);
    expect(agent.callSizes).toEqual(CALLS.map(sizeOf));
  });

  test("the series is in transcript order, so a prefix is a prefix of time", async () => {
    /* Order is the whole mechanism. An unordered or reversed series still sums
       correctly and still yields "prefix sums", but they would correspond to no
       moment the session ever passed through — a foreign total would match, or
       fail to match, for no reason. */
    const agent = parseClaudeJsonl(claudeTranscript(), { nowMs: Date.parse(at(9)) })!;

    expect(agent.callSizes![0]).toBe(sizeOf(CALLS[0]!));
    expect(agent.callSizes!.at(-1)).toBe(sizeOf(CALLS[6]!));
  });

  test("OMP reports a series too, and it sums the same way", async () => {
    const rows = [
      { type: "session", id: "019f86c4-1558-7000-aeb8-26e2cfd0e8ec", timestamp: at(0) },
      { type: "message", timestamp: at(1), message: { role: "assistant", content: "a", usage: { input: 570, output: 385, cacheRead: 74_711, cacheWrite: 487 } } },
      { type: "message", timestamp: at(2), message: { role: "assistant", content: "b", usage: { input: 10, output: 20, cacheRead: 75_000, cacheWrite: 30 } } },
    ].map((row) => JSON.stringify(row)).join("\n");

    const agent = parseOmpJsonl(rows, {
      sourcePath: "/Users/me/.omp/agent/sessions/-Users-me-p/session.jsonl",
      nowMs: Date.parse(at(3)),
    })!;

    expect(agent.callSizes).toEqual([76_153, 75_060]);
    expect(agent.callSizes!.reduce((total, size) => total + size, 0)).toBe(agent.tokens.sessionProcessed!);
  });

  test("Codex reports no series, because it has no call boundaries to report", async () => {
    /* Absent, never empty. Codex publishes session-cumulative totals; an empty
       array would assert the session made no calls, which is false and would
       make every prefix check against it vacuously fail. */
    const rows = [
      { type: "session_meta", timestamp: at(0), payload: { id: "11111111-2222-3333-4444-555555555555", cwd: "/p" } },
      {
        type: "event_msg", timestamp: at(1),
        payload: {
          type: "token_count",
          info: {
            total_token_usage: { input_tokens: 90_000, output_tokens: 5_000, cached_input_tokens: 80_000 },
            last_token_usage: { input_tokens: 9_000, output_tokens: 500, cached_input_tokens: 8_000 },
          },
        },
      },
    ].map((row) => JSON.stringify(row)).join("\n");

    const agent = parseCodexJsonl(rows, { nowMs: Date.parse(at(2)) })!;

    expect(agent.callSizes).toBeUndefined();
    // The total is still published; only the breakdown is unavailable.
    expect(agent.tokens.sessionProcessed).toBe(95_000);
  });

  test("a session with no usage claims no series", async () => {
    const rows = JSON.stringify({
      type: "user", timestamp: at(0), sessionId: "s", session_id: "s", cwd: "/p", message: { role: "user", content: "go" },
    });
    const agent = parseClaudeJsonl(rows, { nowMs: Date.parse(at(1)) })!;

    expect(agent.callSizes).toBeUndefined();
  });
});

describe("the series does not ride on the wire", () => {
  test("no published agent carries callSizes", async () => {
    /* The payload boundary, asserted rather than remembered. A live snapshot is
       already 2.23MB against a 2MB SSE backlog budget, and the largest session
       on this machine has 1,575 calls; publishing the tail for every agent on
       every update would spend the board's freshness on a series nothing
       renders. Stripped at the one point a CollectedAgent becomes an
       AgentSnapshot, so this test has a single place to watch. */
    const collected = parseClaudeJsonl(claudeTranscript(), { nowMs: Date.parse(at(9)) })!;
    expect(collected.callSizes).toBeDefined();

    const snapshot = buildSnapshot({
      agents: [collected],
      surfaces: [],
      archiveStore: { has: () => false, archive: async () => {} },
      now: new Date(at(9)),
    });

    const published = snapshot.programs.flatMap((program) => program.agents);
    expect(published).not.toHaveLength(0);
    for (const agent of published) {
      expect(agent).not.toHaveProperty("callSizes");
    }
    // The total still ships — it is the bridge, and only the breakdown is held back.
    expect(published[0]!.tokens.sessionProcessed).toBe(293_235);
  });
});

describe("the endpoint answers with checkable evidence", () => {
  async function serve(agents: readonly CollectedAgent[], agentId: string): Promise<{ status: number; body: any }> {
    const snapshot = buildSnapshot({
      agents,
      surfaces: [],
      archiveStore: { has: () => false, archive: async () => {} },
      now: new Date(at(9)),
    });
    const response = await sessionCallsResponse(snapshot, agentId, {});
    return { status: response.status, body: await response.json() };
  }

  /** Writes the transcript where the collected agent says it is, so the
      endpoint re-reads a real file exactly as it does in the server. */
  async function withTranscript(text: string): Promise<CollectedAgent> {
    const root = await mkdtemp(join(tmpdir(), "anthill-session-calls-"));
    roots.push(root);
    const source = join(root, "session.jsonl");
    await writeFile(source, text);
    const agent = parseClaudeJsonl(text, { sourcePath: source, nowMs: Date.parse(at(9)) })!;
    return { ...agent, artifacts: [{ kind: "transcript", path: source, label: "Transcript" } as never] };
  }

  test("a foreign total equal to a prefix is recognisable as one", async () => {
    /* THE POINT. 112,258 is calls 1-3 of this session. The endpoint publishes
       the cumulative sums so that check is a lookup rather than an argument,
       and this is the exact number OpenBurnBar reported for the real session. */
    const agent = await withTranscript(claudeTranscript());
    const { body } = await serve([agent], agent.id);

    expect(body.ok).toBe(true);
    expect(body.prefixSums).toHaveLength(7);
    expect(body.prefixSums).toContain(112_258);
    expect(body.prefixSums.at(-1)).toBe(293_235);
    expect(body.sessionProcessed).toBe(293_235);
  });

  test("Gemini debug session calls reparse the bounded transcript with prefix sums", async () => {
    const source = join(
      import.meta.dir,
      "fixtures/gemini/demo-project/chats/session-2026-08-19T12-00-abcd1234.jsonl",
    );
    const text = await readFile(source, "utf8");
    const parsed = parseGeminiJsonl(text, { sourcePath: source, nowMs: Date.parse(at(9)) })!;
    const agent = {
      ...parsed,
      artifacts: [{ kind: "transcript", path: source, label: "Transcript" } as never],
    };

    expect(parsed.callSizes).toEqual([125, 150]);
    const { body } = await serve([agent], agent.id);
    expect(body.calls).toEqual([125, 150]);
    expect(body.sessionProcessed).toBe(275);
    expect(body.prefixSums).toEqual([125, 275]);
    expect(body.unavailable).toBeUndefined();
  });

  test("a total that is NOT a prefix does not match one", async () => {
    /* The control, and without it the check above proves nothing: a series
       whose prefix sums covered every plausible number would "recognise"
       anything. A real accounting disagreement falls BETWEEN call boundaries,
       and that must stay distinguishable from a recorder that stopped. */
    const agent = await withTranscript(claudeTranscript());
    const { body } = await serve([agent], agent.id);

    expect(body.prefixSums).not.toContain(112_259);
    expect(body.prefixSums).not.toContain(150_000);
  });

  test("a provider with no call boundaries says why, rather than answering null", async () => {
    /* Codex through the endpoint, not just the parser. The distinction the
       whole surface turns on: `calls: null` with no explanation is
       indistinguishable from a failure, and a caller prefix-matching against it
       would conclude the board disagreed with itself. The reason is what makes
       the absence readable. */
    const root = await mkdtemp(join(tmpdir(), "anthill-session-calls-codex-"));
    roots.push(root);
    const source = join(root, "codex.jsonl");
    const text = [
      { type: "session_meta", timestamp: at(0), payload: { id: "11111111-2222-3333-4444-555555555555", cwd: "/p" } },
      {
        type: "event_msg", timestamp: at(1),
        payload: {
          type: "token_count",
          info: {
            total_token_usage: { input_tokens: 90_000, output_tokens: 5_000, cached_input_tokens: 80_000 },
            last_token_usage: { input_tokens: 9_000, output_tokens: 500, cached_input_tokens: 8_000 },
          },
        },
      },
    ].map((entry) => JSON.stringify(entry)).join("\n");
    await writeFile(source, text);
    const parsed = parseCodexJsonl(text, { sourcePath: source, nowMs: Date.parse(at(9)) })!;
    const agent = { ...parsed, artifacts: [{ kind: "transcript", path: source, label: "Transcript" } as never] };

    const { body } = await serve([agent], agent.id);

    expect(body.ok).toBe(true);
    expect(body.calls).toBeNull();
    expect(body.unavailable).toMatch(/session-cumulative/i);
  });

  test("I-103 keeps Cursor callSizes absent and reports the boundary directly", async () => {
    const cursor = parseCursorChildSession({
      sessionId: "6514e366-df29-434b-979d-52a26168e188",
      parentSessionId: "286ab053-e84f-4538-9292-4aa3fae6fe9b",
      cwd: "/tmp/formic",
      transcriptJsonl: JSON.stringify({ role: "user", message: { content: "Inspect Cursor calls." } }),
      transcriptPath: "/tmp/cursor-child.jsonl",
      updatedAtMs: Date.parse(at(1)),
      nowMs: Date.parse(at(2)),
    })!;

    expect(cursor).not.toHaveProperty("callSizes");
    const { body } = await serve([cursor], cursor.id);
    expect(body.calls).toBeNull();
    expect(body.sessionProcessed).toBeNull();
    expect(body.unavailable).toMatch(/does not record per-call/i);
  });

  test("an agent with no transcript at all is distinguished from one with no usage", async () => {
    /* Two different absences that must not collapse into one message. No
       transcript means the evidence was never on disk; a transcript with no
       usage means it was read and the session genuinely made no calls. An
       operator chasing a disagreement needs to know which. */
    const withNothing = await withTranscript(claudeTranscript());
    const noArtifact = { ...withNothing, artifacts: [] };
    const noUsage = await withTranscript(JSON.stringify({
      type: "user", timestamp: at(0), sessionId: "s", session_id: "s", cwd: "/p",
      message: { role: "user", content: "go" },
    }));

    const absent = await serve([noArtifact], withNothing.id);
    const empty = await serve([noUsage], noUsage.id);

    expect(absent.body.calls).toBeNull();
    expect(absent.body.source).toBeNull();
    expect(absent.body.unavailable).toMatch(/no transcript on disk/i);

    expect(empty.body.calls).toBeNull();
    expect(empty.body.unavailable).toMatch(/records no usage/i);
    // Different reasons, so the two absences stay distinguishable.
    expect(empty.body.unavailable).not.toBe(absent.body.unavailable);
  });

  test("an unknown agent is a 404 rather than an empty series", async () => {
    const agent = await withTranscript(claudeTranscript());
    const { status, body } = await serve([agent], "claude:not-here");

    expect(status).toBe(404);
    expect(body.ok).toBe(false);
  });

  test("a transcript that has gone says so instead of reporting no calls", async () => {
    /* Absent-first, at the endpoint. An agent whose transcript rotated away
       must not answer "0 calls" — a caller prefix-matching against an empty
       series would conclude the board disagreed with itself. */
    const agent = await withTranscript(claudeTranscript());
    const missing = { ...agent, artifacts: [{ kind: "transcript", path: "/nowhere/gone.jsonl", label: "Transcript" } as never] };
    const { body } = await serve([missing], agent.id);

    expect(body.ok).toBe(true);
    expect(body.calls).toBeNull();
    expect(body.sessionProcessed).toBeNull();
    expect(body.unavailable).toMatch(/could not be read/i);
  });
});
