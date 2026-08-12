export interface ProviderSettlementOptions {
  waitMs: number;
  /** Deterministic test seam; production uses one cancellable timer. */
  wait?: (waitMs: number) => Promise<void>;
}

export interface ProviderSettlementResult<P extends string, T> {
  current: Partial<Record<P, T>>;
  lastKnown: Partial<Record<P, T>>;
  timedOut: P[];
}

interface Settled<T> {
  version: number;
  value: T;
}

interface InFlight<T> {
  version: number;
  promise: Promise<T>;
}

interface ProviderSlot<T> {
  version: number;
  inFlight?: InFlight<T>;
  staged?: Settled<T>;
  lastSuccessful?: T;
}

/**
 * Owns collection lifetime independently from refresh lifetime. A scan that
 * misses one generation remains the only scan for that provider; when it does
 * settle, its value is consumed by the next generation and never published by
 * the promise callback.
 */
export class ProviderSettlementCoordinator<P extends string, T> {
  readonly #slots = new Map<P, ProviderSlot<T>>();

  constructor(private readonly isSuccessful: (value: T) => boolean) {}

  async settle(
    providers: readonly P[],
    scan: (provider: P) => Promise<T>,
    options: ProviderSettlementOptions,
  ): Promise<ProviderSettlementResult<P, T>> {
    const current: Partial<Record<P, T>> = {};
    const lastKnown: Partial<Record<P, T>> = {};
    const candidates = new Map<P, InFlight<T>>();

    for (const provider of providers) {
      const slot = this.#slot(provider);
      if (slot.staged) {
        const staged = slot.staged;
        slot.staged = undefined;
        current[provider] = staged.value;
        if (this.isSuccessful(staged.value)) slot.lastSuccessful = staged.value;
        continue;
      }
      candidates.set(provider, slot.inFlight ?? this.#start(provider, slot, scan));
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
      if (candidate && slot.staged?.version === candidate.version) {
        const settled = slot.staged;
        slot.staged = undefined;
        current[provider] = settled.value;
        if (this.isSuccessful(settled.value)) slot.lastSuccessful = settled.value;
        continue;
      }
      timedOut.push(provider);
      if (slot.lastSuccessful !== undefined) lastKnown[provider] = slot.lastSuccessful;
    }

    return { current, lastKnown, timedOut };
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
  ): InFlight<T> {
    const version = ++slot.version;
    const promise = Promise.resolve().then(() => scan(provider));
    const inFlight = { version, promise };
    slot.inFlight = inFlight;
    void promise.then(
      (value) => {
        if (slot.inFlight !== inFlight) return;
        slot.inFlight = undefined;
        slot.staged = { version, value };
      },
      () => {
        if (slot.inFlight === inFlight) slot.inFlight = undefined;
      },
    );
    return inFlight;
  }
}
