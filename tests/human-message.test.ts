import { describe, expect, test } from "bun:test";
import {
  extractLastMessageByRole,
  readableHumanMessage,
  type HumanMessageCandidate,
} from "../src/server/human-message";

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
