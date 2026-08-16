import { beforeAll, describe, expect, test } from "bun:test";
import { findClass, textOf, withDom } from "./helpers/fake-dom";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let M: any;

beforeAll(async () => {
  // @ts-expect-error browser client has no declaration
  await import("../src/web/app.js");
  M = (globalThis as unknown as { TheAntHill: unknown }).TheAntHill;
});

function cursorAgent(overrides: Record<string, unknown> = {}) {
  return {
    id: "cursor:a1",
    provider: "cursor",
    sourceSessionId: "a1",
    displayName: "SEM Night",
    programId: "p1",
    status: "running",
    statusReason: "Streaming output.",
    updatedAt: "2026-08-16T03:00:00.000Z",
    lifecycle: "working",
    scope: "observed",
    tokens: { provenance: "observed", total: 1200 },
    artifacts: [],
    gates: [],
    target: { resolution: "exact", surfaceId: "s1", workspaceId: "w1" },
    controls: [],
    ...overrides,
  };
}

const program = { id: "p1", name: "Elio" };

describe("instanceLabel paint", () => {
  test("a Cursor-2 row paints a quiet instance-home chip", () => {
    const agent = cursorAgent({ instanceLabel: "Cursor-2" });
    const row = withDom(() => M.renderAgentRow(agent, program));
    const chip = findClass(row, "instance-home");
    expect(chip).not.toBeNull();
    expect(textOf(chip)).toBe("Cursor-2");
    expect(textOf(row)).toContain("Cursor-2");
    expect(textOf(findClass(row, "agent-name"))).toBe("SEM Night");
  });

  test("a default Cursor row does not grow an instance-home chip", () => {
    const row = withDom(() => M.renderAgentRow(cursorAgent(), program));
    expect(findClass(row, "instance-home")).toBeNull();
    expect(textOf(findClass(row, "agent-name"))).toBe("SEM Night");
  });

  test("blank instanceLabel does not grow the chip", () => {
    const row = withDom(() => M.renderAgentRow(cursorAgent({ instanceLabel: "   " }), program));
    expect(findClass(row, "instance-home")).toBeNull();
  });
});
