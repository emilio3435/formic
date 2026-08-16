import { describe, expect, test } from "bun:test";
import { ProviderSettlementCoordinator } from "../src/server/provider-settlement";
import { providerCollectionConfigKey } from "../src/server/state";

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
  test("concurrent generations sharing one scan each observe its fresh settlement", async () => {
    const coordinator = new ProviderSettlementCoordinator<"p", string>(() => true);
    const pending = deferred<string>();
    let scans = 0;
    const scan = async () => {
      scans += 1;
      return pending.promise;
    };

    const first = coordinator.settle(["p"], scan, { waitMs: 7_500 });
    const second = coordinator.settle(["p"], scan, { waitMs: 7_500 });
    await flushSettlements();
    pending.resolve("fresh");

    expect(await first).toMatchObject({ current: { p: "fresh" }, timedOut: [] });
    expect(await second).toMatchObject({ current: { p: "fresh" }, timedOut: [] });
    expect(scans).toBe(1);
  });

  test("an old-config settlement cannot publish current under a new collection config", async () => {
    const coordinator = new ProviderSettlementCoordinator<"p", string>(() => true);
    const pending = deferred<string>();
    let scans = 0;
    const old = coordinator.settle(["p"], async () => {
      scans += 1;
      return pending.promise;
    }, { waitMs: 7_500, configKey: "window=36h;fresh=5m;quiet=30m" });
    await flushSettlements();

    const cutoff = controlledCutoff();
    const changed = coordinator.settle(["p"], async () => {
      scans += 1;
      return "new-config";
    }, {
      waitMs: 7_500,
      configKey: "window=1h;fresh=2m;quiet=10m",
      wait: cutoff.wait,
    });
    await flushSettlements();
    pending.resolve("old-config");
    await flushSettlements();
    cutoff.release();

    expect(await old).toMatchObject({ current: { p: "old-config" } });
    expect(await changed).toMatchObject({ current: {}, timedOut: ["p"] });
    expect(scans).toBe(1);

    const recovered = await coordinator.settle(["p"], async () => {
      scans += 1;
      return "new-config";
    }, { waitMs: 7_500, configKey: "window=1h;fresh=2m;quiet=10m" });
    expect(recovered).toMatchObject({ current: { p: "new-config" }, timedOut: [] });
    expect(scans).toBe(2);
  });

  test("late current evidence keeps its settlement time when consumed later", async () => {
    let nowMs = 1_000;
    const coordinator = new ProviderSettlementCoordinator<"p", string>(() => true);
    const pending = deferred<string>();
    const cutoff = controlledCutoff();
    const timedOut = coordinator.settle(["p"], () => pending.promise, {
      waitMs: 7_500,
      configKey: "same",
      now: () => nowMs,
      wait: cutoff.wait,
    });
    await flushSettlements();
    cutoff.release();
    await timedOut;
    nowMs = 2_000;
    pending.resolve("late");
    await flushSettlements();
    nowMs = 9_000;

    const consumed = await coordinator.settle(["p"], async () => "unused", {
      waitMs: 7_500,
      configKey: "same",
      now: () => nowMs,
    });
    expect(consumed.current).toEqual({ p: "late" });
    expect(consumed.settledAtMs).toEqual({ p: 2_000 });
  });

  test("a slow provider cannot withhold current results and falls back to its last success", async () => {
    const coordinator = new ProviderSettlementCoordinator<Provider, string>(() => true);
    const initial = await coordinator.settle(["fast", "slow"], async (provider) => `${provider}-old`, {
      waitMs: 7_500,
    });
    expect(initial).toMatchObject({
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

    expect(await settling).toMatchObject({
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
    expect(frozen).toMatchObject({
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

  test("extra Cursor GUI roots change the collection config key", () => {
    const windowMs = 36 * 3600_000;
    const thresholds = { freshMs: 5 * 60_000, quietMs: 30 * 60_000 };
    const without = providerCollectionConfigKey(windowMs, thresholds, []);
    const withRoot = providerCollectionConfigKey(
      windowMs,
      thresholds,
      ["/Users/me/Library/Application Support/Cursor-2"],
    );
    expect(withRoot).not.toBe(without);
    expect(withRoot).toContain("Cursor-2");
  });

  test("two settle calls with different extra-root lists do not share a scan", async () => {
    const coordinator = new ProviderSettlementCoordinator<"cursor", string>(() => true);
    let scans = 0;
    const pending = deferred<string>();
    const firstKey = providerCollectionConfigKey(1, undefined, []);
    const secondKey = providerCollectionConfigKey(1, undefined, ["/tmp/Cursor-2"]);

    const first = coordinator.settle(["cursor"], async () => {
      scans += 1;
      return pending.promise;
    }, { waitMs: 7_500, configKey: firstKey });
    await flushSettlements();

    const cutoff = controlledCutoff();
    const second = coordinator.settle(["cursor"], async () => {
      scans += 1;
      return "with-extra";
    }, { waitMs: 7_500, configKey: secondKey, wait: cutoff.wait });
    await flushSettlements();
    pending.resolve("without-extra");
    await flushSettlements();
    cutoff.release();

    expect(await first).toMatchObject({ current: { cursor: "without-extra" } });
    expect(await second).toMatchObject({ current: {}, timedOut: ["cursor"] });
    expect(scans).toBe(1);

    const recovered = await coordinator.settle(["cursor"], async () => {
      scans += 1;
      return "with-extra";
    }, { waitMs: 7_500, configKey: secondKey });
    expect(recovered).toMatchObject({ current: { cursor: "with-extra" }, timedOut: [] });
    expect(scans).toBe(2);
  });
});
