import { describe, expect, test } from "bun:test";
import { parseClaudeJsonl, parseCodexJsonl, parseOmpJsonl } from "../src/server/collectors";

/* `sessionProcessed` — the one figure on this board that can be checked against
   a source outside it.

   Everything built today verifies INTERNAL consistency: window plus prior is
   conserved, the chart agrees with the headline, the button agrees with the
   endpoint. All of it says the board does not contradict itself, and none of it
   says the board is right.

   Exactly one external check is constructible. This hub derives agents by
   reading transcript files on disk. OpenBurnBar is a separate application that
   derives usage into its own encrypted store, which this repo only ever reads
   and never writes. Two paths to the same fact, and they JOIN: session ids
   match exactly.

   They could not be COMPARED, because the two published different units. The
   board published `sessionTotal`, which is consumption — each prompt token
   counted once — while BurnBar records the PROCESSED total, every call's size
   summed with cache re-reads included. The 2.6x-16.9x spread between them was
   never a disagreement; it was the cache multiplier.

   So this field exists to put them on one unit. What it must be is therefore
   not a matter of taste: it has to be per-call size summed over the session, or
   the comparison silently stops comparing. These tests pin that definition.

   MEASURED once the field existed, against 36 hours of real data: 297 sessions
   joined, and the board's figure equalled BurnBar's to the token on ALL 297.
   The independence is not assumed either — BurnBar reports a provider this
   board has no collector for at all (Hermes / x-ai), carries costs no
   transcript states, and knows 33 sessions the board cannot see while the board
   knows 34 it cannot. Neither is reading the other. */

const at = (minute: number): string => `2026-08-02T10:${String(minute).padStart(2, "0")}:00.000Z`;

describe("sessionProcessed is per-call size summed, in BurnBar's unit", () => {
  test("Claude: it counts the cached prefix on every call that re-sent it", () => {
    /* THE POINT OF THE FIELD. Two calls, each re-reading a 100k cached prefix.
       Consumption counts that prefix once; processed counts it twice, because
       the provider processed it twice. BurnBar measures the second. */
    const rows = [
      { type: "user", timestamp: at(0), sessionId: "s", session_id: "s", cwd: "/p", message: { role: "user", content: "go" } },
      {
        type: "assistant", timestamp: at(1), sessionId: "s", session_id: "s", cwd: "/p",
        message: {
          role: "assistant", id: "m1", stop_reason: "end_turn", content: "one",
          usage: { input_tokens: 500, output_tokens: 200, cache_read_input_tokens: 100_000, cache_creation_input_tokens: 1_000 },
        },
      },
      {
        type: "assistant", timestamp: at(2), sessionId: "s", session_id: "s", cwd: "/p",
        message: {
          role: "assistant", id: "m2", stop_reason: "end_turn", content: "two",
          usage: { input_tokens: 300, output_tokens: 400, cache_read_input_tokens: 100_000, cache_creation_input_tokens: 0 },
        },
      },
    ].map((row) => JSON.stringify(row)).join("\n");

    const agent = parseClaudeJsonl(rows, { nowMs: Date.parse(at(3)) });
    const tokens = agent!.tokens;

    // Consumption: 500+200+1000 + 300+400 = 2,400. The prefix counted once.
    expect(tokens.sessionTotal).toBe(2_400);
    // Processed: both calls' full size. 101,700 + 100,700 = 202,400.
    expect(tokens.sessionProcessed).toBe(202_400);
    /* The two are different measurements of the same session, and the gap IS
       the cache multiplier — 84x here. Publishing only the first is why the
       board and BurnBar looked like they disagreed. */
    expect(tokens.sessionProcessed! / tokens.sessionTotal!).toBeGreaterThan(80);
  });

  test("Claude: processed equals consumption plus every cache read", () => {
    /* The identity that makes the field checkable without trusting its
       implementation. It is computed from the rows rather than derived as this
       sum — deriving it would make the bridge follow whatever those two fields
       come to mean later, which is exactly how a bridge stops measuring what
       the other side measures. Asserting the identity keeps both honest. */
    const rows = [
      { type: "user", timestamp: at(0), sessionId: "s", session_id: "s", cwd: "/p", message: { role: "user", content: "go" } },
      {
        type: "assistant", timestamp: at(1), sessionId: "s", session_id: "s", cwd: "/p",
        message: {
          role: "assistant", id: "m1", stop_reason: "end_turn", content: "one",
          usage: { input_tokens: 11, output_tokens: 22, cache_read_input_tokens: 33, cache_creation_input_tokens: 44 },
        },
      },
    ].map((row) => JSON.stringify(row)).join("\n");

    const { tokens } = parseClaudeJsonl(rows, { nowMs: Date.parse(at(2)) })!;

    expect(tokens.sessionProcessed).toBe(tokens.sessionTotal! + tokens.sessionCachedInput!);
    expect(tokens.sessionProcessed).toBe(110);
  });

  test("Codex: the cached prefix is already inside its session input", () => {
    /* Codex reports a session-cumulative input that CONTAINS the cached prefix,
       so processed is input + output with nothing re-added. Adding the cache
       again here would double-count it and break the comparison in the opposite
       direction from the Claude case. */
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

    const { tokens } = parseCodexJsonl(rows, { nowMs: Date.parse(at(2)) })!;

    expect(tokens.sessionProcessed).toBe(95_000);
    // Consumption strips the cached prefix; processed keeps it.
    expect(tokens.sessionTotal).toBe(15_000);
    expect(tokens.sessionProcessed).toBe(tokens.sessionTotal! + tokens.sessionCachedInput!);
  });

  test("OMP: the four parts are disjoint, so processed is their sum", () => {
    const rows = [
      { type: "session", id: "019f86c4-1558-7000-aeb8-26e2cfd0e8ec", timestamp: at(0) },
      {
        type: "message", timestamp: at(1),
        message: {
          role: "assistant", content: "hi",
          // OMP's own field names, not the Anthropic shape the other two use.
          usage: { input: 570, output: 385, cacheRead: 74_711, cacheWrite: 487 },
        },
      },
    ].map((row) => JSON.stringify(row)).join("\n");

    const { tokens } = parseOmpJsonl(rows, {
      sourcePath: "/Users/me/.omp/agent/sessions/-Users-me-p/session.jsonl",
      nowMs: Date.parse(at(2)),
    })!;

    // 570 + 385 + 74,711 + 487 — the measured row from the OMP fixture.
    expect(tokens.sessionProcessed).toBe(76_153);
    expect(tokens.sessionProcessed).toBe(tokens.sessionTotal! + tokens.sessionCachedInput!);
  });
});

describe("the bridge only works if it stays a bridge", () => {
  test("a session with no cache reads reports the same figure twice", () => {
    /* The degenerate case, and a useful control: with nothing cached, processed
       and consumption coincide. A test suite that only ever exercised cached
       sessions could not tell the two fields apart from their difference alone. */
    const rows = [
      { type: "user", timestamp: at(0), sessionId: "s", session_id: "s", cwd: "/p", message: { role: "user", content: "go" } },
      {
        type: "assistant", timestamp: at(1), sessionId: "s", session_id: "s", cwd: "/p",
        message: {
          role: "assistant", id: "m1", stop_reason: "end_turn", content: "one",
          usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
        },
      },
    ].map((row) => JSON.stringify(row)).join("\n");

    const { tokens } = parseClaudeJsonl(rows, { nowMs: Date.parse(at(2)) })!;

    expect(tokens.sessionProcessed).toBe(150);
    expect(tokens.sessionProcessed).toBe(tokens.sessionTotal);
  });

  test("a session reporting no usage at all claims no processed total", () => {
    // Absent-first: nothing measured is not zero processed.
    const rows = [
      { type: "user", timestamp: at(0), sessionId: "s", session_id: "s", cwd: "/p", message: { role: "user", content: "go" } },
    ].map((row) => JSON.stringify(row)).join("\n");

    const { tokens } = parseClaudeJsonl(rows, { nowMs: Date.parse(at(1)) })!;

    expect(tokens.sessionProcessed).toBeUndefined();
    expect(tokens.provenance).toBe("unknown");
  });

  test("a repeated usage row is counted once, as it is for consumption", () => {
    /* Claude writes the same message id more than once as a turn streams. If
       processed counted duplicates while consumption deduplicated them, the
       bridge would drift from BurnBar by exactly the streaming rate — a
       difference that would look like a real disagreement about usage. */
    const usage = { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 1_000, cache_creation_input_tokens: 0 };
    const rows = [
      { type: "user", timestamp: at(0), sessionId: "s", session_id: "s", cwd: "/p", message: { role: "user", content: "go" } },
      { type: "assistant", timestamp: at(1), sessionId: "s", session_id: "s", cwd: "/p", message: { role: "assistant", id: "m1", stop_reason: "end_turn", content: "a", usage } },
      { type: "assistant", timestamp: at(2), sessionId: "s", session_id: "s", cwd: "/p", message: { role: "assistant", id: "m1", stop_reason: "end_turn", content: "ab", usage } },
    ].map((row) => JSON.stringify(row)).join("\n");

    const { tokens } = parseClaudeJsonl(rows, { nowMs: Date.parse(at(3)) })!;

    expect(tokens.sessionProcessed).toBe(1_150);
  });
});
