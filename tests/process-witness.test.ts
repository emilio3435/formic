import { describe, expect, test } from "bun:test";
import {
  applyProcessWitness,
  currentBootId,
  JsonProcessWitnessStore,
  witnessesFromScan,
  type ProcessWitness,
  type WitnessFileOperations,
} from "../src/server/process-witness";
import { classifyLifecycle } from "../src/server/lifecycle";
import type { CollectedAgent } from "../src/server/types";

/* The evidence that has to survive a restart, and the one case where surviving
   it proves something on its own.

   Process ids can only be observed while a process is running. Holding them in
   memory alone meant every launchd kickstart erased the board's entire record of
   what it had seen alive — so restarting the dashboard destroyed the evidence
   that made endings provable, and the sessions it had watched for hours became
   permanently `unverified`. */

function agent(overrides: Partial<CollectedAgent> = {}): CollectedAgent {
  return {
    id: "claude:a1",
    provider: "claude",
    sourceSessionId: "a1",
    displayName: "Worker",
    status: "stale",
    statusReason: "quiet",
    updatedAt: "2026-08-04T10:00:00.000Z",
    tokens: { sessionTotal: 1, total: 1, provenance: "observed" },
    artifacts: [],
    gates: [],
    ...overrides,
  };
}

function memoryFiles(seed?: string): WitnessFileOperations & { written: () => string | undefined } {
  let disk = seed;
  return {
    readText: async (path) => {
      if (disk === undefined) throw new Error(`ENOENT: no such file, open '${path}'`);
      return disk;
    },
    writeText: async (_path, text) => { disk = text; },
    written: () => disk,
  };
}

const QUIET_MS = 5 * 60 * 60_000;

describe("what the board witnessed, across restarts", () => {
  test("a first run with no file is not a fault", async () => {
    const files = memoryFiles();
    const store = await JsonProcessWitnessStore.open("/tmp/absent.json", files);
    expect(store.loadError()).toBeUndefined();
    expect(store.get("claude:a1")).toBeUndefined();
  });

  /* An unreadable store means the board is about to under-report endings for
     every session it had already seen. That is a fault an operator is told
     about, not a silent fallback to knowing nothing. */
  test("an unreadable store is reported, not swallowed", async () => {
    const files = memoryFiles("{ this is not json");
    const store = await JsonProcessWitnessStore.open("/tmp/broken.json", files);
    expect(store.loadError()).toContain("cannot be proven finished");
  });

  test("only sessions actually seen running are recorded", async () => {
    const witnesses = witnessesFromScan([
      agent({ id: "claude:live", processAlive: true, processIds: [101] }),
      // Negative answers are not observations of running, so they teach nothing.
      agent({ id: "claude:gone", processAlive: false, processIds: [102] }),
      // Nor is a live flag with no ids behind it.
      agent({ id: "claude:idless", processAlive: true }),
    ], "boot-1", "2026-08-04T10:00:00.000Z");

    expect(witnesses.map((witness) => witness.agentId)).toEqual(["claude:live"]);
    expect(witnesses[0].processIds).toEqual([101]);
  });

  test("a witness survives the process that wrote it", async () => {
    const files = memoryFiles();
    const first = await JsonProcessWitnessStore.open("/tmp/w.json", files);
    await first.record(witnessesFromScan(
      [agent({ processAlive: true, processIds: [4242] })], "boot-1", "2026-08-04T10:00:00.000Z",
    ));

    // A whole new store object, reading only what the first one left on disk.
    const second = await JsonProcessWitnessStore.open("/tmp/w.json", files);
    expect(second.get("claude:a1")?.processIds).toEqual([4242]);
    expect(second.get("claude:a1")?.bootId).toBe("boot-1");
  });
});

describe("restoring witnessed evidence onto agents", () => {
  const store = {
    get: (agentId: string): ProcessWitness | undefined => agentId === "claude:a1"
      ? { agentId, processIds: [4242], bootId: "boot-1", witnessedAt: "2026-08-04T09:00:00.000Z" }
      : undefined,
  };

  test("same boot hands the ids back so the liveness check can answer", () => {
    const [restored] = applyProcessWitness([agent()], store, "boot-1");
    expect(restored.processIds).toEqual([4242]);
    // Deliberately NOT asserting death: within one boot those pids may well
    // still be running, and the scan is what decides.
    expect(restored.processAlive).toBeUndefined();
  });

  /* The case persistence exists for. A process cannot outlive its boot, so a
     witness from an earlier one is not stale data — it is proof. */
  test("a witness from an earlier boot proves the process is gone", () => {
    const [restored] = applyProcessWitness([agent()], store, "boot-2");
    expect(restored.processIds).toEqual([4242]);
    expect(restored.processAlive).toBe(false);

    // And the classifier reads that as a witnessed death, not a roster guess.
    expect(classifyLifecycle({
      ageMs: QUIET_MS,
      processAlive: restored.processAlive,
      processIds: restored.processIds,
    })).toMatchObject({ lifecycle: "finished", provenance: "process-died" });
  });

  /* The erasure bug the binding bridge already had to be taught not to repeat:
     a record must never overwrite a live observation. */
  test("a live observation is never overwritten by an older record", () => {
    const live = agent({ processAlive: true, processIds: [999] });
    const [restored] = applyProcessWitness([live], store, "boot-2");
    expect(restored.processAlive).toBe(true);
    expect(restored.processIds).toEqual([999]);
  });

  test("agents with no witness are returned untouched", () => {
    const [restored] = applyProcessWitness([agent({ id: "claude:unknown" })], store, "boot-1");
    expect(restored.processIds).toBeUndefined();
    expect(restored.processAlive).toBeUndefined();
  });
});

describe("boot identity", () => {
  /* Rounded to the minute because nowMs - uptime jitters between calls, and an
     id that changed on jitter would invalidate every witness on every scan —
     silently turning persistence back off while looking like it worked. */
  test("millisecond jitter does not mint a new boot", () => {
    const boot = currentBootId(3_600, 1_800_000_000_000);
    expect(currentBootId(3_600.4, 1_800_000_000_337)).toBe(boot);
  });

  test("an actual reboot mints a different boot", () => {
    const before = currentBootId(86_400, 1_800_000_000_000);
    // Rebooted: uptime resets while the wall clock keeps going.
    const after = currentBootId(30, 1_800_000_000_000);
    expect(after).not.toBe(before);
  });
});
