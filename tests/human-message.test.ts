import { describe, expect, test } from "bun:test";
import {
  extractChatBodyByRole,
  extractClosingByRole,
  extractLastFacingAtByRole,
  extractLastHumanFacingAt,
  extractLastHumanMessage,
  extractLastMessageByRole,
  readableChatBody,
  readableClosing,
  readableHumanMessage,
  type HumanMessageCandidate,
} from "../src/server/human-message";

describe("extractLastHumanFacingAt — readable prose with an honest source clock", () => {
  test("uses only valid timestamps attached to accepted human-facing prose", () => {
    expect(extractLastHumanFacingAt("codex", [
      { role: "user", content: "Please repair the refresh path.", timestamp: "2026-08-11T10:00:01.000Z" },
      { role: "assistant", content: [{ type: "reasoning", text: "internal plan" }], timestamp: "2026-08-11T10:00:02.000Z" },
      { role: "assistant", content: "tool_result: {\"ok\":true}", timestamp: "2026-08-11T10:00:03.000Z" },
      { role: "assistant", content: "This timestamp is malformed.", timestamp: "not-a-time" },
      { role: "assistant", content: "The refresh path is repaired.", timestamp: "2026-08-11T10:00:04-05:00" },
      { role: "user", content: "Injected metadata.", isMeta: true, timestamp: "2026-08-11T10:00:05.000Z" },
    ])).toBe("2026-08-11T15:00:04.000Z");
  });

  test("leaves the clock unavailable when readable prose has no valid attached timestamp", () => {
    expect(extractLastHumanFacingAt("cursor", [
      { role: "user", content: "A real request with no source time." },
      { role: "assistant", content: "A real reply with no source time.", timestamp: 1786456800000 },
    ])).toBeUndefined();
  });

  test("extractLastFacingAtByRole keeps the user clock distinct from the assistant close", () => {
    const messages: HumanMessageCandidate[] = [
      { role: "user", content: "Parse the grok-bot transcript.", timestamp: "2026-08-16T04:00:00.000Z" },
      { role: "assistant", content: "Done.", timestamp: "2026-08-16T05:00:10.000Z" },
      { role: "user", content: "Start the next pass.", timestamp: "2026-08-16T16:38:00.000Z" },
    ];
    expect(extractLastFacingAtByRole("codex", messages, "user")).toBe("2026-08-16T16:38:00.000Z");
    expect(extractLastFacingAtByRole("codex", messages, "assistant")).toBe("2026-08-16T05:00:10.000Z");
  });
});

describe("readableHumanMessage — human, never machine language", () => {
  test("strips Claude slash-command + local-command transport envelopes", () => {
    const raw = [
      "<command-name>/model</command-name>",
      "<command-message>model</command-message>",
      "<command-args></command-args>",
      "<local-command-stdout>Set model to Opus 4.8</local-command-stdout>",
      "investigate why the Ant Hill server is down",
    ].join("\n");
    // Only the real human sentence survives; no envelope tags leak through.
    expect(readableHumanMessage("claude", raw)).toBe("investigate why the Ant Hill server is down");
  });

  test("flattens markdown so the one-line view reads as prose", () => {
    const raw = "## What landed\nDone — all shipped and live. Refresh **`:4701`** and **1. v2** is retired.";
    const out = readableHumanMessage("claude", raw) ?? "";
    expect(out).not.toContain("**");
    expect(out).not.toContain("##");
    expect(out).not.toContain("`");
    expect(out).toContain("Refresh :4701");
    expect(out).toContain("1. v2 is retired");
  });

  test("keeps ordinary instructions that begin with command words", () => {
    const prompts = [
      "make the header sticky on scroll",
      "find the bug in collectors.ts and fix it",
      "cd into the worktree and run the tests",
      "git rebase this onto main please",
      "curl the endpoint and tell me what it returns",
      "node is crashing on startup",
      "ls the data dir and confirm",
      "rm the stale worktrees when you're done",
      "sed is mangling the file",
      "cat the log and summarize",
      "grep for the error string",
      "npm install is failing",
    ];

    for (const prompt of prompts) {
      expect(readableHumanMessage("codex", prompt)).toBe(prompt);
    }
    expect(readableHumanMessage("codex", "make it faster\nand also fix the flicker")).toBe(
      "make it faster and also fix the flicker",
    );
  });

  test("returns null instead of presenting collector status as a human message", () => {
    expect(extractLastHumanMessage(
      "claude",
      [{ role: "user", content: "$ git diff --check" }],
      undefined,
      "No source activity in the last 3 minutes.",
    )).toBeNull();
  });
});

describe("extractLastMessageByRole — the two sides of the exchange", () => {
  const candidates: HumanMessageCandidate[] = [
    { role: "user", content: "First request: connect the provider." },
    { role: "assistant", content: "Working on the provider connect flow." },
    { role: "user", content: "Second request: add the audit trail." },
    { role: "assistant", content: "Audit trail added and verified." },
  ];

  test("returns the LAST user request, not an earlier one and not an assistant reply", () => {
    const message = extractLastMessageByRole("codex", candidates, "user");
    expect(message).toBe("Second request: add the audit trail.");
    expect(message).not.toContain("First request");
    expect(message).not.toContain("Audit trail");
  });

  test("returns the LAST assistant reply independent of the last user request", () => {
    expect(extractLastMessageByRole("codex", candidates, "assistant")).toBe(
      "Audit trail added and verified.",
    );
  });

  test("skips meta candidates when scanning a role", () => {
    const withMeta: HumanMessageCandidate[] = [
      { role: "user", content: "Real question about the router." },
      { role: "user", content: "<system-reminder>injected</system-reminder>", isMeta: true },
    ];
    expect(extractLastMessageByRole("claude", withMeta, "user")).toBe(
      "Real question about the router.",
    );
  });

  test("strips tool/JSON/shell noise and skips a role entry that cleans to nothing", () => {
    const noisy: HumanMessageCandidate[] = [
      { role: "assistant", content: "Deployment succeeded on the ridge." },
      { role: "assistant", content: "tool_result: {\"ok\": true}" },
    ];
    const message = extractLastMessageByRole("codex", noisy, "assistant");
    expect(message).toBe("Deployment succeeded on the ridge.");
    expect(message).not.toContain("tool_result");
    expect(message).not.toContain("{");
  });

  test("returns null when no legible message of that role exists", () => {
    expect(extractLastMessageByRole("codex", [
      { role: "assistant", content: "Only the agent spoke." },
    ], "user")).toBeNull();
    expect(extractLastMessageByRole("codex", [], "assistant")).toBeNull();
  });
});

/* readableHumanMessage keeps the FIRST 240 characters, which is right for a
   one-line preview and exactly wrong for reading intent: an agent asks its
   question in the last sentence, after the explanation. Every one of those was
   discarded before the snapshot existed, which is why the attention detectors
   had almost nothing to read. */
describe("readableClosing — the end of a message, not its beginning", () => {
  const longAnswer =
    "I traced the regression through the writer path and confirmed the lock is held across the flush. "
    + "The safest repair is to narrow the critical section, but that touches the retry logic, which the "
    + "batch importer also depends on, so the blast radius is wider than it first looks. "
    + "I have reproduced it locally against the fixture set and the failure is deterministic. "
    + "Should I narrow the lock, or leave it and add a backpressure gate?";

  test("keeps the closing question that front-truncation destroys", () => {
    expect(readableHumanMessage("claude", longAnswer)).not.toContain("Should I narrow the lock");
    expect(readableClosing("claude", longAnswer)).toContain("Should I narrow the lock");
  });

  test("marks the elision so a clipped closing is never read as the whole message", () => {
    expect(readableClosing("claude", longAnswer)?.startsWith("…")).toBe(true);
  });

  test("a short message is returned whole and unmarked", () => {
    expect(readableClosing("claude", "Ready when you are.")).toBe("Ready when you are.");
  });

  test("messages that are not human-readable stay undefined, as before", () => {
    expect(readableClosing("claude", "")).toBeUndefined();
  });

  test("extractClosingByRole attributes by role rather than by position", () => {
    const candidates: HumanMessageCandidate[] = [
      { role: "assistant", content: "Earlier agent turn that also ends in a question?" },
      { role: "user", content: "Now do the migration and tell me when it lands." },
    ];

    // The operator spoke last; the AGENT's closing is still the agent's.
    expect(extractClosingByRole("claude", candidates, "assistant"))
      .toBe("Earlier agent turn that also ends in a question?");
    expect(extractClosingByRole("claude", candidates, "user"))
      .toBe("Now do the migration and tell me when it lands.");
  });

  /* #17: Codex appends a memory-citation / rollout trailer after spoken prose.
     The end-anchored 240-char window lands inside that trailer unless the
     collector strips it first. The spoken close must survive; the guts must
     not. When that window starts inside the trailer, keep the spoken front
     of THIS turn — do not walk back to N-1. */
  const SPOKEN_FRONT =
    "Done. Lane grok-bot meets its Definition of Done. - Local commit: 83abc44 on feat/grok-bot-parser.";
  const TRAILER =
    " <oai-mem-citation> <citation_entries> MEMORY.md:201-204|note=[report first and strict lane fence preference] </citation_entries> <rollout_ids> 019fabc123 </rollout_ids> </oai-mem-citation>";
  const PADDING =
    " The parser, tests, and send closer are committed locally. Nothing here is pushed or staged by this lane. The remaining work is operator review, not another edit from this session. Padding sentence one keeps the spoken front away from the citation trailer. Padding sentence two keeps the spoken front away from the citation trailer. Padding sentence three keeps the spoken front away from the citation trailer. Padding sentence four keeps the spoken front away from the citation trailer. Work is not pushed or staged by this lane.";
  const CITATION_TURN = SPOKEN_FRONT + PADDING + TRAILER;

  test("strips Codex MEMORY.md / oai-mem-citation / rollout trailers and keeps the spoken close", () => {
    const closing = readableClosing("codex", CITATION_TURN);
    expect(closing).toContain("Definition of Done");
    expect(closing).not.toContain("oai-mem-citation");
    expect(closing).not.toContain("MEMORY.md");
    expect(closing).not.toContain("rollout_ids");
    expect(closing).not.toContain("citation_entries");
    expect(closing).not.toContain("|note=[");

    const body = readableChatBody("codex", CITATION_TURN);
    expect(body).toContain("Definition of Done");
    expect(body).not.toContain("oai-mem-citation");
    expect(body).not.toContain("MEMORY.md:");
    expect(body).not.toContain("rollout_ids");
  });

  test("a close window that lands in the citation trailer stays on this turn's spoken front", () => {
    const candidates: HumanMessageCandidate[] = [
      { role: "assistant", content: "November Generate-button leftover is still in the drawer." },
      { role: "assistant", content: CITATION_TURN },
    ];
    const closing = extractClosingByRole("codex", candidates, "assistant");
    const message = extractLastMessageByRole("codex", candidates, "assistant");
    expect(closing).toContain("Definition of Done");
    expect(closing).not.toContain("November Generate-button");
    expect(closing).not.toContain("oai-mem-citation");
    expect(message).toContain("Definition of Done");
    expect(message).not.toContain("oai-mem-citation");
  });

  test("a spoken mention of MEMORY.md without a citation entry is still the close", () => {
    const spoken = "I recorded the fence in MEMORY.md and stopped there.";
    expect(readableClosing("codex", spoken)).toBe(spoken);
    expect(extractLastMessageByRole("codex", [{ role: "assistant", content: spoken }], "assistant"))
      .toBe(spoken);
  });
});

/* Chat must keep the CLI's line breaks. The row one-liner still joins; this
   sibling strips the same envelopes and citations without .join(" ") or a
   cross-newline squeeze. */
describe("readableChatBody — layout-preserving sibling of the row one-liner", () => {
  const bullets = [
    "Here is the plan:",
    "",
    "- fix the parser",
    "- add tests",
    "",
    "Should I land this?",
  ].join("\n");
  const table = [
    "Compare the two windows:",
    "",
    "| field | row | chat |",
    "| close | one line | keep breaks |",
    "",
    "Want the table in the bubble?",
  ].join("\n");

  test("keeps bullets, blank lines, and table rows that cleanMessage joins away", () => {
    expect(readableHumanMessage("claude", bullets)).toBe(
      "Here is the plan: - fix the parser - add tests Should I land this?",
    );
    expect(readableChatBody("claude", bullets)).toBe(bullets);
    expect(readableChatBody("claude", bullets)).toContain("\n- fix the parser\n- add tests\n");
    expect((readableChatBody("claude", bullets)?.match(/\n/g) ?? []).length).toBeGreaterThan(0);

    expect(readableHumanMessage("claude", table)).not.toContain("\n");
    expect(readableChatBody("claude", table)).toBe(table);
    expect(readableChatBody("claude", table)?.split("\n")).toEqual(table.split("\n"));
  });

  test("does not squeeze spaces across newlines or inside a table row", () => {
    const padded = "| field  | row  |\n| close  | keep |";
    expect(readableChatBody("claude", padded)).toBe(padded);
    expect(readableHumanMessage("claude", padded)).toBe("| field | row | | close | keep |");
  });

  test("still strips transport envelopes and skips machine-only turns", () => {
    const raw = [
      "<command-name>/model</command-name>",
      "<command-message>model</command-message>",
      "Here is the plan:",
      "- fix the parser",
    ].join("\n");
    expect(readableChatBody("claude", raw)).toBe("Here is the plan:\n- fix the parser");
    expect(readableChatBody("claude", raw)).not.toContain("command-name");
    expect(readableChatBody("claude", "$ git diff --check")).toBeUndefined();
    expect(readableChatBody("claude", "")).toBeUndefined();
  });

  test("does not front-truncate the way the row window does", () => {
    const longList = ["Keep every item in this layout-preserving body:", ...Array.from({ length: 40 }, (_, i) => `- item ${i + 1}`)].join("\n");
    expect(readableHumanMessage("claude", longList)?.endsWith("…")).toBe(true);
    expect(readableChatBody("claude", longList)).toBe(longList);
    expect(readableChatBody("claude", longList)).toContain("- item 40");
  });

  test("extractChatBodyByRole returns the last layout-preserving turn for that role", () => {
    const candidates: HumanMessageCandidate[] = [
      { role: "assistant", content: "Earlier:\n- stale" },
      { role: "user", content: "Please use a table." },
      { role: "assistant", content: bullets },
    ];
    expect(extractChatBodyByRole("claude", candidates, "assistant")).toBe(bullets);
    expect(extractChatBodyByRole("claude", candidates, "user")).toBe("Please use a table.");
    expect(extractLastMessageByRole("claude", candidates, "assistant")).toBe(
      "Here is the plan: - fix the parser - add tests Should I land this?",
    );
  });
});
