export interface ProviderSettlementOptions {
  waitMs: number;
  /** Scan semantics captured by the caller (window plus lifecycle thresholds). */
  configKey?: string;
  now?: () => number;
  /** Deterministic test seam; production uses one cancellable timer. */
  wait?: (waitMs: number) => Promise<void>;
}

export interface ProviderSettlementResult<P extends string, T> {
  current: Partial<Record<P, T>>;
  settledAtMs: Partial<Record<P, number>>;
  lastKnown: Partial<Record<P, T>>;
  timedOut: P[];
}

interface Settled<T> {
  version: number;
  configKey: string;
  value: T;
  settledAtMs: number;
}

interface InFlight<T> {
  version: number;
  configKey: string;
  promise: Promise<Settled<T>>;
  observers: number;
  consumedCurrent: boolean;
  settled?: Settled<T>;
}

interface ProviderSlot<T> {
  version: number;
  inFlight?: InFlight<T>;
  staged?: Settled<T>;
  lastSuccessful?: Settled<T>;
}

/**
 * Owns collection lifetime independently from refresh lifetime. A scan that
 * misses one generation remains the only scan for that provider/config; a
 * changed config starts its own scan, and displaced evidence may return only
 * to its original observers. The promise callback never publishes a value.
 */
export class ProviderSettlementCoordinator<P extends string, T> {
  readonly #slots = new Map<P, ProviderSlot<T>>();

  constructor(private readonly isSuccessful: (value: T) => boolean) {}

  /** A watchdog explicitly abandoned these scans. Keep last-known truth, but
      prevent the replacement generation from reusing an aborting promise. */
  discardInFlight(): void {
    for (const slot of this.#slots.values()) slot.inFlight = undefined;
  }

  async settle(
    providers: readonly P[],
    scan: (provider: P) => Promise<T>,
    options: ProviderSettlementOptions,
  ): Promise<ProviderSettlementResult<P, T>> {
    const current: Partial<Record<P, T>> = {};
    const settledAtMs: Partial<Record<P, number>> = {};
    const lastKnown: Partial<Record<P, T>> = {};
    const candidates = new Map<P, InFlight<T>>();

    const configKey = options.configKey ?? "default";
    for (const provider of providers) {
      const slot = this.#slot(provider);
      if (slot.staged?.configKey === configKey) {
        const staged = slot.staged;
        slot.staged = undefined;
        current[provider] = staged.value;
        settledAtMs[provider] = staged.settledAtMs;
        if (this.isSuccessful(staged.value)) {
          slot.lastSuccessful = staged;
        }
        continue;
      }
      if (slot.staged) slot.staged = undefined;
      const candidate = slot.inFlight?.configKey === configKey
        ? slot.inFlight
        : this.#start(provider, slot, scan, configKey, options.now);
      candidate.observers += 1;
      candidates.set(provider, candidate);
    }

    let timer: ReturnType<typeof setTimeout> | undefined;
    const cutoff = options.wait
      ? options.wait(options.waitMs)
      : new Promise<void>((resolve) => {
          timer = setTimeout(resolve, options.waitMs);
        });
    await Promise.race([
      Promise.allSettled([...candidates.values()].map(({ promise }) => promise)).then(() => {}),
      cutoff,
    ]);
    if (timer) clearTimeout(timer);

    const timedOut: P[] = [];
    for (const provider of providers) {
      if (current[provider] !== undefined) continue;
      const candidate = candidates.get(provider);
      const slot = this.#slot(provider);
      const settled = candidate?.settled;
      if (candidate && settled && candidate.configKey === configKey) {
        current[provider] = settled.value;
        settledAtMs[provider] = settled.settledAtMs;
        candidate.consumedCurrent = true;
        if (settled.version === slot.version && this.isSuccessful(settled.value)) {
          slot.lastSuccessful = settled;
        }
        this.#release(slot, candidate);
        continue;
      }
      timedOut.push(provider);
      if (slot.lastSuccessful?.configKey === configKey) {
        lastKnown[provider] = slot.lastSuccessful.value;
      }
      if (candidate) this.#release(slot, candidate);
    }

    return { current, settledAtMs, lastKnown, timedOut };
  }

  #slot(provider: P): ProviderSlot<T> {
    const existing = this.#slots.get(provider);
    if (existing) return existing;
    const created = { version: 0 };
    this.#slots.set(provider, created);
    return created;
  }

  #start(
    provider: P,
    slot: ProviderSlot<T>,
    scan: (provider: P) => Promise<T>,
    configKey: string,
    now: (() => number) | undefined,
  ): InFlight<T> {
    const version = ++slot.version;
    const promise = Promise.resolve()
      .then(() => scan(provider))
      .then((value) => ({
        version,
        configKey,
        value,
        settledAtMs: (now ?? Date.now)(),
      }));
    const inFlight: InFlight<T> = {
      version,
      configKey,
      promise,
      observers: 0,
      consumedCurrent: false,
    };
    slot.inFlight = inFlight;
    void promise.then(
      (settled) => {
        inFlight.settled = settled;
        if (slot.inFlight === inFlight && this.isSuccessful(settled.value)) {
          slot.lastSuccessful = settled;
        }
        if (inFlight.observers === 0) this.#finish(slot, inFlight);
      },
      () => {
        if (slot.inFlight === inFlight) slot.inFlight = undefined;
      },
    );
    return inFlight;
  }

  #release(slot: ProviderSlot<T>, inFlight: InFlight<T>): void {
    inFlight.observers -= 1;
    if (inFlight.observers === 0 && inFlight.settled) this.#finish(slot, inFlight);
  }

  #finish(slot: ProviderSlot<T>, inFlight: InFlight<T>): void {
    if (slot.inFlight !== inFlight) return;
    slot.inFlight = undefined;
    if (!inFlight.consumedCurrent && inFlight.settled) slot.staged = inFlight.settled;
  }
}
