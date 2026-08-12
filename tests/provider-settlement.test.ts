import { describe, expect, test } from "bun:test";
import { ProviderSettlementCoordinator } from "../src/server/provider-settlement";

type Provider = "fast" | "slow";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function controlledCutoff() {
  const cutoff = deferred<void>();
  return { wait: () => cutoff.promise, release: cutoff.resolve };
}

async function flushSettlements() {
  for (let turn = 0; turn < 5; turn += 1) await Promise.resolve();
}

describe("provider settlement", () => {
  test("a slow provider cannot withhold current results and falls back to its last success", async () => {
    const coordinator = new ProviderSettlementCoordinator<Provider, string>(() => true);
    const initial = await coordinator.settle(["fast", "slow"], async (provider) => `${provider}-old`, {
      waitMs: 7_500,
    });
    expect(initial).toEqual({
      current: { fast: "fast-old", slow: "slow-old" },
      lastKnown: {},
      timedOut: [],
    });

    const slow = deferred<string>();
    const cutoff = controlledCutoff();
    const settling = coordinator.settle(
      ["fast", "slow"],
      async (provider) => provider === "fast" ? "fast-new" : slow.promise,
      { waitMs: 7_500, wait: cutoff.wait },
    );
    await flushSettlements();
    cutoff.release();

    expect(await settling).toEqual({
      current: { fast: "fast-new" },
      lastKnown: { slow: "slow-old" },
      timedOut: ["slow"],
    });
  });

  test("late settlement is staged for the next generation without overlapping a scan", async () => {
    const coordinator = new ProviderSettlementCoordinator<Provider, string>(() => true);
    await coordinator.settle(["fast", "slow"], async (provider) => `${provider}-old`, { waitMs: 7_500 });

    let slowCalls = 0;
    const late = deferred<string>();
    const cutoff = controlledCutoff();
    const timedOut = coordinator.settle(
      ["fast", "slow"],
      async (provider) => {
        if (provider === "fast") return "fast-new";
        slowCalls += 1;
        return late.promise;
      },
      { waitMs: 7_500, wait: cutoff.wait },
    );
    await flushSettlements();
    cutoff.release();
    const frozen = await timedOut;

    const secondCutoff = controlledCutoff();
    const stillHung = coordinator.settle(
      ["fast", "slow"],
      async (provider) => {
        if (provider === "fast") return "fast-newer";
        slowCalls += 1;
        return "overlap";
      },
      { waitMs: 7_500, wait: secondCutoff.wait },
    );
    await flushSettlements();
    secondCutoff.release();
    await stillHung;
    expect(slowCalls).toBe(1);

    late.resolve("slow-late");
    await flushSettlements();
    expect(frozen).toEqual({
      current: { fast: "fast-new" },
      lastKnown: { slow: "slow-old" },
      timedOut: ["slow"],
    });

    const recovered = await coordinator.settle(
      ["fast", "slow"],
      async (provider) => provider === "fast" ? "fast-latest" : "slow-should-not-start-yet",
      { waitMs: 7_500 },
    );
    expect(recovered.current.slow).toBe("slow-late");
    expect(recovered.lastKnown.slow).toBeUndefined();
    expect(recovered.timedOut).toEqual([]);
    expect(slowCalls).toBe(1);

    const next = await coordinator.settle(
      ["fast", "slow"],
      async (provider) => {
        if (provider === "slow") slowCalls += 1;
        return `${provider}-after-recovery`;
      },
      { waitMs: 7_500 },
    );
    expect(next.current.slow).toBe("slow-after-recovery");
    expect(slowCalls).toBe(2);
  });
});
