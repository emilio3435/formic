import { describe, expect, test } from "bun:test";

describe("heartbeat tail backstop", () => {
  test("capTranscriptTail keeps a [TL;DR envelope beyond 800 chars and caps others", async () => {
    const { capTranscriptTail, MAX_HEARTBEAT_TAIL_CHARS, MAX_TRANSCRIPT_TAIL_CHARS } =
      await import("../src/server/types");
    const envelope = "[TL;DR 17:33] " + JSON.stringify({ v: 4, fleet: "f".repeat(1200), repos: [] });
    expect(capTranscriptTail(envelope)!.length).toBe(envelope.length); // < 6000 → untouched
    expect(capTranscriptTail(envelope)).toBe(envelope);                 // head preserved
    const chatter = "z".repeat(2000);
    expect(capTranscriptTail(chatter)!.length).toBe(MAX_TRANSCRIPT_TAIL_CHARS);
    const hugeEnvelope = "[TL;DR 17:33] " + "x".repeat(9000);
    expect(capTranscriptTail(hugeEnvelope)!.length).toBe(MAX_HEARTBEAT_TAIL_CHARS);
  });

  test("prime parser preserves a >800-char envelope end-to-end through buildSnapshot", async () => {
    const { parsePrimeJsonl } = await import("../src/server/prime");
    const { buildSnapshot } = await import("../src/server/snapshot");
    const envelope = "[TL;DR 04:03] " + JSON.stringify({
      v: 4, fleet: "eight agents live. " + "detail ".repeat(160),
      repos: [{ repo: "the-mountain-main", summary: "s".repeat(300), blocker: "question pending", signal: "needs-you" }],
    });
    expect(envelope.length).toBeGreaterThan(800);
    const jsonl = [
      JSON.stringify({ type: "session", id: "ant-heartbeat-monitor", cwd: "/tmp", timestamp: new Date().toISOString() }),
      JSON.stringify({ type: "message", message: { role: "assistant", content: envelope, timestamp: new Date().toISOString() } }),
    ].join("\n");
    const agent: any = parsePrimeJsonl(jsonl);
    expect(agent.transcriptTail).toBe(envelope); // head intact — parse survives
    const snap: any = buildSnapshot({ agents: [agent], surfaces: [],
      archiveStore: { archivedAgents: () => [], has: () => false } as any, now: new Date() });
    const out = snap.programs.flatMap((p: any) => p.agents).find((a: any) => a.id === "prime:ant-heartbeat-monitor");
    expect(out.transcriptTail).toBe(envelope); // snapshot re-slice did not decapitate it
  });
});
