import { describe, expect, test } from "bun:test";
import { parseClaudeJsonl, parseCodexJsonl, parseOmpJsonl } from "../src/server/collectors";

/* `sessionTotal` is the number the drawer prints as "used this session" and the
   program header sums into "session tokens". It read 394,199,049 for ONE Claude
   session against a 1,000,000 window; 391,452,609 of that (99.3%) was cache
   reads, because the collector summed each call's total and every call re-sends
   the whole cached prefix. The board's largest session inflated 143.5x.

   These tests pin the PROPERTY, not the numbers: replaying an unchanged cached
   prefix is not consumption, so a session that answers N more calls off the same
   cache must not report N times that cache as used. A test pinned to a constant
   would have passed just as happily on 394M.

   Every fixture below is shaped from real transcripts on this machine — the
   field names, and the containment relationships between them, are the parts
   that make the arithmetic true, so they are asserted here too. */

const claudeCall = (
  index: number,
  usage: Record<string, number>,
): string => JSON.stringify({
  type: "assistant",
  sessionId: "session-under-test",
  cwd: "/tmp/session-under-test",
  requestId: `req-${index}`,
  timestamp: `2026-08-02T10:${String(index).padStart(2, "0")}:00.000Z`,
  message: { role: "assistant", model: "claude-opus-5", content: "ack", usage },
});

/* One call that reads a large cached prefix and writes almost nothing new — the
   shape of every turn in a long session, and the shape that inflated the board. */
const cacheReadingCall = (index: number): string => claudeCall(index, {
  input_tokens: 2,
  output_tokens: 100,
  cache_read_input_tokens: 900_000,
  cache_creation_input_tokens: 0,
});

const claudeSessionOf = (calls: number): ReturnType<typeof parseClaudeJsonl> => parseClaudeJsonl(
  [
    /* Turn one pays to build the cache. Everything after it re-reads it. */
    claudeCall(0, {
      input_tokens: 500,
      output_tokens: 100,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 900_000,
    }),
    ...Array.from({ length: calls }, (_, i) => cacheReadingCall(i + 1)),
  ].join("\n"),
);

describe("sessionTotal counts consumption, not re-reads of the same context", () => {
  test("re-reading an unchanged cache does not grow reported session usage", () => {
    const short = claudeSessionOf(1);
    const long = claudeSessionOf(40);

    /* The only difference between these two sessions is how many times the SAME
       cached prefix was re-sent. The 39 extra calls each contribute exactly the
       genuinely new tokens they carry — 2 uncached input and 100 output — and
       nothing for the 900k they merely re-read. */
    const extraNewWork = 39 * (2 + 100);
    expect(long?.tokens.sessionTotal).toBe((short?.tokens.sessionTotal ?? 0) + extraNewWork);

    /* Stated as the defect itself: 39 further calls at 900k of cache read each
       must not add 35.1M to what the session claims to have used. */
    const inflationIfCacheReadsWereSummed = 39 * 900_000;
    expect((long?.tokens.sessionTotal ?? 0) - (short?.tokens.sessionTotal ?? 0))
      .toBeLessThan(inflationIfCacheReadsWereSummed);
  });

  test("sessionTotal cannot exceed the window by orders of magnitude on a capped session", () => {
    /* 41 calls against a 1M window. Before the fix this reported 37.8M — a
       session claiming 37x its own context window as consumed. The bound is not
       a magic number: new tokens are what entered the conversation once, so a
       session whose content fits the window cannot honestly report multiples
       of it. */
    const session = claudeSessionOf(40);
    expect(session?.tokens.contextWindow).toBe(1_000_000);
    expect(session?.tokens.sessionTotal).toBeLessThan(session?.tokens.contextWindow ?? 0);
  });

  test("cache reads are still reported, under their own name", () => {
    const session = claudeSessionOf(40);
    /* Not deleted — moved. The quantity is real and someone will want it; it just
       cannot live inside a total that reads as consumption. */
    expect(session?.tokens.sessionCachedInput).toBe(40 * 900_000);
    /* Cache-building turn (500 uncached + 100 out + 900k written) plus 40 calls
       of 2 uncached input and 100 output each. The 36M of reads sits in its own
       field above and in none of this. */
    expect(session?.tokens.sessionTotal).toBe((500 + 100 + 900_000) + 40 * (2 + 100));
  });

  test("the latest call's total still includes cache reads, because occupancy does", () => {
    const session = claudeSessionOf(40);
    /* The two measurements must stay apart in BOTH directions. `total` feeds
       contextPct, where a cached token absolutely does occupy the window; the
       fix must not have quietly zeroed it out. a371b23 is the other half of this
       pair and this asserts it still holds. */
    expect(session?.tokens.total).toBe(2 + 100 + 900_000);
    expect(session?.tokens.cachedInput).toBe(900_000);
  });

  test("a cache re-write after expiry is real work and is counted", () => {
    /* The exclusion is of cache READS only. When the cache expires the prefix is
       re-sent and re-written, which the provider bills and which is genuinely
       processed again — so it must still land in sessionTotal, or the fix would
       trade an overstatement for an understatement. */
    const withRewrite = parseClaudeJsonl([
      claudeCall(0, {
        input_tokens: 0, output_tokens: 10,
        cache_read_input_tokens: 0, cache_creation_input_tokens: 50_000,
      }),
      claudeCall(1, {
        input_tokens: 0, output_tokens: 10,
        cache_read_input_tokens: 0, cache_creation_input_tokens: 50_000,
      }),
    ].join("\n"));
    expect(withRewrite?.tokens.sessionTotal).toBe(100_020);
  });
});

describe("every provider reports sessionTotal in the same unit", () => {
  /* The program header sums sessionTotal across providers into one figure, so a
     provider that still folded cache reads in would re-inflate the rollup on its
     own. These fixtures use each provider's real field names and containment. */

  test("omp excludes cacheRead, whose parts are disjoint from input", () => {
    const omp = parseOmpJsonl([
      JSON.stringify({ type: "session", id: "omp-1", cwd: "/tmp/omp", timestamp: "2026-08-02T10:00:00.000Z" }),
      ...Array.from({ length: 5 }, () => JSON.stringify({
        type: "message",
        timestamp: "2026-08-02T10:05:00.000Z",
        message: {
          role: "assistant",
          model: "gpt-5",
          content: "ack",
          /* Real row shape: 570+385+74711+487 = 76153, i.e. totalTokens is the
             sum of four disjoint parts, so cacheRead is not inside input. */
          usage: { input: 570, output: 385, cacheRead: 74_711, cacheWrite: 487, totalTokens: 76_153 },
        },
      })),
    ].join("\n"));

    expect(omp?.tokens.total).toBe(76_153);
    expect(omp?.tokens.sessionTotal).toBe(5 * (570 + 385 + 487));
    expect(omp?.tokens.sessionCachedInput).toBe(5 * 74_711);
  });

  test("codex subtracts cached_input_tokens, which its input_tokens contains", () => {
    const codex = parseCodexJsonl([
      JSON.stringify({
        type: "session_meta",
        timestamp: "2026-08-02T10:00:00.000Z",
        payload: { id: "codex-1", cwd: "/tmp/codex" },
      }),
      JSON.stringify({
        type: "event_msg",
        timestamp: "2026-08-02T10:05:00.000Z",
        payload: {
          type: "token_count",
          info: {
            /* Real rollout values. cached is a SUBSET of input here, unlike omp:
               cumulative 56564−37376 = 19188 equals per-turn 15511 + 3677. */
            total_token_usage: {
              input_tokens: 56_564, cached_input_tokens: 37_376,
              cache_write_input_tokens: 0, output_tokens: 433, total_tokens: 56_997,
            },
            last_token_usage: {
              input_tokens: 30_045, cached_input_tokens: 26_368,
              cache_write_input_tokens: 0, output_tokens: 139, total_tokens: 30_184,
            },
            model_context_window: 258_400,
          },
        },
      }),
    ].join("\n"));

    expect(codex?.tokens.sessionTotal).toBe(56_564 - 37_376 + 433);
    expect(codex?.tokens.sessionCachedInput).toBe(37_376);
    /* Occupancy untouched: the latest call's size still counts its cache read. */
    expect(codex?.tokens.total).toBe(30_184);
  });
});
