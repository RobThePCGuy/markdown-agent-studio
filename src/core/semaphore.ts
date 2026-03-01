export class Semaphore {
  private _available: number;
  private readonly _max: number;
  private waitQueue: Array<{ resolve: (release: () => void) => void; reject: (err: Error) => void }> = [];

  constructor(max: number) {
    this._available = max;
    this._max = max;
  }

  get available(): number {
    return this._available;
  }

  async acquire(): Promise<() => void> {
    if (this._available > 0) {
      this._available--;
      return () => this.release();
    }

    return new Promise<() => void>((resolve, reject) => {
      this.waitQueue.push({ resolve, reject });
    });
  }

  /** Reject all pending waiters and reset capacity. */
  drain(): void {
    const waiters = this.waitQueue.splice(0);
    for (const waiter of waiters) {
      waiter.reject(new Error('Semaphore drained'));
    }
    this._available = this._max;
  }

  private release(): void {
    this._available++;
    if (this.waitQueue.length > 0) {
      const next = this.waitQueue.shift()!;
      this._available--;
      next.resolve(() => this.release());
    }
  }
}
