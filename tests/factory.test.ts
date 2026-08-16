import { describe, expect, test } from "bun:test";
import { parseFactoryJsonl } from "../src/server/factory";
import type { ParseMetadata } from "../src/server/collectors";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/* Factory (droid) sessions, against the shape the real files on this machine
   have. Factory is the one provider here that records a TITLE plus a flag
   saying whether a human chose it, which is the difference between an authored
   name and a generated one — so most of what is worth testing is that the
   distinction survives. */

const NOW = Date.parse("2026-08-04T12:00:00.000Z");
const meta: ParseMetadata = { sourcePath: "/tmp/session.jsonl", mtimeMs: NOW, nowMs: NOW };

const start = (over: Record<string, unknown> = {}) => JSON.stringify({
  type: "session_start",
  id: "d3392202-fa64-42a9-b5e3-85f4a73e0cb7",
  title: "Rebuild the settings cockpit",
  cwd: "/Users/ant/Developer/elio-intelligence-suite",
  isSessionTitleManuallySet: false,
  ...over,
});

const message = (role: string, text: string, at = "2026-08-04T11:59:00.000Z") => JSON.stringify({
  type: "message",
  timestamp: at,
  message: { role, content: [{ type: "text", text }] },
});

const transcript = (...lines: string[]) => lines.join("\n");

describe("a Factory session becomes an agent", () => {
  test("human-facing recency ignores later reasoning and tool output", () => {
    const agent = parseFactoryJsonl(transcript(
      start(),
      message("user", "Please inspect Factory.", "2026-08-04T11:50:00.000Z"),
      message("assistant", "Factory is ready.", "2026-08-04T11:51:00.000Z"),
      JSON.stringify({
        type: "message",
        timestamp: "2026-08-04T11:52:00.000Z",
        message: { role: "assistant", content: [{ type: "reasoning", text: "internal" }, { type: "tool_result", text: "ok" }] },
      }),
      JSON.stringify({ type: "message", message: { role: "assistant", content: "Readable, but without source time." } }),
    ), meta);

    expect(agent?.lastHumanFacingAt).toBe("2026-08-04T11:51:00.000Z");
    expect(agent?.updatedAt).toBe("2026-08-04T11:52:00.000Z");
    expect(agent?.lastThreadAt).toBe("2026-08-04T11:52:00.000Z");
    expect(agent?.workingSince).toBe("2026-08-04T11:50:00.000Z");
    expect(agent?.lastUserMessage).toBe("Please inspect Factory.");
    expect(agent?.lastAgentClosing).toBeTruthy();
    expect(agent?.status).toBe("waiting");
    expect(agent?.statusReason).toMatch(/No source activity/);
  });

  test("an assistant question is the closing, not the kickoff", () => {
    const agent = parseFactoryJsonl(transcript(
      start(),
      message("user", "Port the rate limiter.", "2026-08-04T11:50:00.000Z"),
      message("assistant", "Should I land this now?", "2026-08-04T11:59:30.000Z"),
    ), meta);
    expect(agent?.lastAgentClosing).toBe("Should I land this now?");
    expect(agent?.lastUserMessage).toBe("Port the rate limiter.");
    expect(agent?.status).toBe("running");
  });

  test("qualifies an array text message through the shared sanitizer", () => {
    const agent = parseFactoryJsonl(transcript(
      start(),
      JSON.stringify({
        type: "message",
        timestamp: "2026-08-04T11:51:00.000Z",
        message: { role: "assistant", content: [{ type: "output_text", text: "Factory is ready." }] },
      }),
    ), meta);

    expect(agent?.lastHumanFacingAt).toBe("2026-08-04T11:51:00.000Z");
    expect(agent?.transcriptTail).toBe("Factory is ready.");
  });

  test("id, cwd and timing come off the transcript", () => {
    const agent = parseFactoryJsonl(
      transcript(start(), message("user", "go", "2026-08-04T11:50:00.000Z"), message("assistant", "done")),
      meta,
    );

    expect(agent?.id).toBe("factory:d3392202-fa64-42a9-b5e3-85f4a73e0cb7");
    expect(agent?.provider).toBe("factory");
    expect(agent?.cwd).toBe("/Users/ant/Developer/elio-intelligence-suite");
    expect(agent?.startedAt).toBe("2026-08-04T11:50:00.000Z");
    expect(agent?.updatedAt).toBe("2026-08-04T11:59:00.000Z");
  });

  test("the origin directory is recorded, so the name cannot follow the shell", () => {
    const agent = parseFactoryJsonl(transcript(start(), message("user", "go")), meta);
    expect(agent?.originCwd).toBe("/Users/ant/Developer/elio-intelligence-suite");
  });

  /* The gap that bit Cursor's children twice: a parser that builds a
     CollectedAgent directly and forgets `identity` is SILENTLY skipped by the
     fleet-wide naming pass. It does not throw; the session simply never gets a
     name. Asserted here because Factory is built the same way. */
  test("it resolves an identity, rather than being silently unnamed", () => {
    const agent = parseFactoryJsonl(transcript(start(), message("user", "go")), meta);
    expect(agent?.identity).toBeDefined();
    expect(agent?.identity?.name).toBeTruthy();
  });

  test("a title a human set is an authored name", () => {
    const agent = parseFactoryJsonl(
      transcript(start({ isSessionTitleManuallySet: true }), message("user", "go")),
      meta,
    );
    expect(agent?.identity?.source).toBe("authored");
    expect(agent?.identity?.authoredBy).toBe("factory-title");
    expect(agent?.identity?.name).toBe("Rebuild the settings cockpit");
  });

  test("a title Factory generated is NOT treated as authored", () => {
    /* Factory writes a title from the opening prompt when nobody sets one. That
       is the same evidence class as the task line, and calling it authored would
       let a machine-generated sentence outrank a directory a human chose. */
    const agent = parseFactoryJsonl(transcript(start(), message("user", "go")), meta);
    expect(agent?.identity?.source).toBe("origin-cwd");
    expect(agent?.identity?.name).toBe("Factory · elio-intelligence-suite");
  });
});

describe("what it refuses to publish", () => {
  test("a file with no session_start is not a Factory session", () => {
    expect(parseFactoryJsonl(transcript(message("user", "go")), meta)).toBeNull();
  });

  test("a session that was opened and never used has nothing to report", () => {
    expect(parseFactoryJsonl(transcript(start()), meta)).toBeNull();
  });

  test("a half-written final line does not lose the whole session", () => {
    /* Expected while a session is live: the collector reads a file the agent is
       still appending to. */
    const agent = parseFactoryJsonl(
      `${transcript(start(), message("user", "go"))}\n{"type":"message","timesta`,
      meta,
    );
    expect(agent?.id).toBe("factory:d3392202-fa64-42a9-b5e3-85f4a73e0cb7");
  });

  test("an unreadable settings file costs the tokens, not the session", () => {
    /* Model and usage live in a sibling file. Absent, unreadable or malformed
       all mean the same thing, and none of them is a reason to drop a row. */
    const agent = parseFactoryJsonl(
      transcript(start(), message("user", "go")),
      { ...meta, sourcePath: "/tmp/definitely-not-here.jsonl" },
    );
    expect(agent).not.toBeNull();
    expect(agent?.tokens.provenance).toBe("unknown");
    expect(agent?.model).toBeUndefined();
  });
});

describe("token usage is reported for what it is", () => {
  /* Written to a real temp file rather than injected, so the parser's own
     ".jsonl" → ".settings.json" sibling-path derivation is what gets tested. */
  const withSettings = (settings: unknown) => {
    /* A private directory per call. A fixed name under tmpdir() is shared with
       every other run of this suite on the machine — five lanes run it here —
       and a concurrent run reaching its `finally` first deletes the file this
       one is about to read, which reports as "unknown" spend rather than as the
       collision it is. */
    const root = mkdtempSync(join(tmpdir(), "anthill-factory-settings-"));
    const path = join(root, "session.jsonl");
    const settingsPath = path.replace(/\.jsonl$/, ".settings.json");
    writeFileSync(settingsPath, JSON.stringify(settings));
    try {
      return parseFactoryJsonl(transcript(start(), message("user", "go")), { ...meta, sourcePath: path });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  };

  test("input and output are session consumption, not occupancy total", () => {
    /* Factory's settings file accumulates over the whole session rather than
       reporting the latest call. Publishing that sum as `total` lets
       contextPctFor treat lifetime spend as window fill. sessionTotal is
       consumption; total stays unset so occupancy is not invented. */
    const agent = withSettings({
      model: "custom:GPT-5.4-XHigh-7",
      tokenUsage: { inputTokens: 175_384, outputTokens: 18_082, cacheReadTokens: 5_728_128 },
    });
    expect(agent?.tokens.sessionTotal).toBe(193_466);
    expect(agent?.tokens.total).toBeUndefined();
    expect(agent?.tokens.sessionCachedInput).toBe(5_728_128);
    expect(agent?.tokens.scope).toBe("session");
    expect(agent?.tokens.provenance).toBe("observed");
    expect(agent?.model).toBe("custom:GPT-5.4-XHigh-7");
  });

  test("a session that has spent nothing reports zero, not unknown", () => {
    /* Real: Factory writes an all-zero usage block for a session that made no
       calls. Zero spend is a measurement; "unknown" would be a claim that it was
       never read. */
    const agent = withSettings({ tokenUsage: { inputTokens: 0, outputTokens: 0 } });
    expect(agent?.tokens.sessionTotal).toBe(0);
    expect(agent?.tokens.total).toBeUndefined();
    expect(agent?.tokens.provenance).toBe("observed");
  });

  test("a settings file with no usage block reports unknown", () => {
    const agent = withSettings({ model: "custom:whatever" });
    expect(agent?.tokens.provenance).toBe("unknown");
    expect(agent?.tokens.total).toBeUndefined();
  });
});
