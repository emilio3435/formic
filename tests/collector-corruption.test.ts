import { describe, expect, test } from "bun:test";
import { parseClaudeJsonl } from "../src/server/collectors";
import type { ParseMetadata } from "../src/server/collectors";

/* Same bug class as the BurnBar zero-spend template, in the token column: a
   transcript the parser could only partly read must not produce a smaller
   believable number. A token total is only meaningful next to a claim about how
   completely it was measured, so the two have to fail together.

   Claude's parser has no Number.isFinite guard on its usage fields, so an
   unreadable amount propagates as NaN and serializes to null — the wire value
   the client already renders as "not reported". That is the safe outcome, and
   these tests exist to keep it that way: the tempting "fix" is to skip the bad
   record instead, which converts a visible gap into a confident undercount. */

const META: ParseMetadata = {
  sourcePath: "/tmp/claude-session.jsonl",
  mtimeMs: Date.parse("2026-07-21T23:00:00.000Z"),
};

const HEAD = JSON.stringify({
  type: "user",
  sessionId: "c1",
  cwd: "/tmp/proj",
  timestamp: "2026-07-21T21:00:00.000Z",
  message: { role: "user", content: "go" },
});

const assistant = (id: string, usage: unknown): string =>
  JSON.stringify({
    type: "assistant",
    sessionId: "c1",
    requestId: id,
    timestamp: "2026-07-21T22:00:00.000Z",
    message: { role: "assistant", id, model: "claude-opus-4-8", content: "ok", usage },
  });

const readable = (input: number) => ({
  input_tokens: input,
  output_tokens: 0,
  cache_read_input_tokens: 0,
  cache_creation_input_tokens: 0,
});

// Realistic corruption: a locale-formatted amount that Number() cannot read.
const UNREADABLE = {
  input_tokens: "1,234",
  output_tokens: 0,
  cache_read_input_tokens: 0,
  cache_creation_input_tokens: 0,
};

const parse = (...rows: string[]) => parseClaudeJsonl([HEAD, ...rows].join("\n"), META);

// What the browser actually receives; NaN has no JSON form and becomes null.
const onTheWire = (tokens: unknown) => JSON.parse(JSON.stringify(tokens));

describe("Claude token totals under an unreadable usage record", () => {
  test("a fully readable transcript reports both totals", () => {
    // The baseline that gives the failures below their meaning.
    const agent = parse(assistant("r1", readable(1_000)), assistant("r2", readable(3_000)));

    expect(agent?.tokens.total).toBe(3_000);
    expect(agent?.tokens.sessionTotal).toBe(4_000);
    expect(agent?.tokens.provenance).toBe("observed");
  });

  test("an unreadable record in the middle voids the session total instead of shrinking it", () => {
    const agent = parse(
      assistant("r1", readable(1_000)),
      assistant("r2", UNREADABLE),
      assistant("r3", readable(3_000)),
    );

    /* 4000 is the number this session would report if the unreadable record
       were simply skipped — identical to a clean two-record session, and wrong.
       Voiding the sum is what keeps a partial read distinguishable. */
    expect(agent?.tokens.sessionTotal).not.toBe(4_000);
    expect(Number.isNaN(agent?.tokens.sessionTotal)).toBe(true);
    expect(onTheWire(agent?.tokens).sessionTotal).toBeNull();
  });

  test("the latest turn still reports when only an earlier record is unreadable", () => {
    const agent = parse(
      assistant("r1", UNREADABLE),
      assistant("r2", readable(3_000)),
    );

    // Scope discipline: latest-turn and session-total are separate measurements,
    // and one being unreadable must not void the other.
    expect(agent?.tokens.total).toBe(3_000);
    expect(onTheWire(agent?.tokens).total).toBe(3_000);
    expect(onTheWire(agent?.tokens).sessionTotal).toBeNull();
  });

  test("an unreadable latest record voids the latest-turn total, so no context % is derived from it", () => {
    const agent = parse(assistant("r1", readable(1_000)), assistant("r2", UNREADABLE));

    /* tokens.total is the numerator the client divides by contextWindow. A
       partial numerator against a full 1M denominator would render a confident,
       far-too-low context percentage — the exact shape of the template bug. */
    expect(Number.isNaN(agent?.tokens.total)).toBe(true);
    expect(onTheWire(agent?.tokens).total).toBeNull();
    expect(agent?.tokens.contextWindow).toBe(1_000_000);
  });

  test("a transcript with no usage records at all is unknown, not zero", () => {
    const agent = parse();

    // The other end of the same boundary: absent measurement is not 0 tokens.
    expect(agent?.tokens).toEqual({ scope: "unknown", provenance: "unknown" });
  });
});
