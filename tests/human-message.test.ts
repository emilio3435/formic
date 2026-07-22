import { describe, expect, test } from "bun:test";
import { readableHumanMessage } from "../src/server/human-message";

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
