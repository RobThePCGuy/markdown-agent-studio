export class Semaphore {
  private _available: number;
  private waitQueue: Array<() => void> = [];

  constructor(private max: number) {
    this._available = max;
  }

  get available(): number {
    return this._available;
  }

  async acquire(): Promise<() => void> {
    if (this._available > 0) {
      this._available--;
      return () => this.release();
    }

    return new Promise<() => void>((resolve) => {
      this.waitQueue.push(() => {
        this._available--;
        resolve(() => this.release());
      });
    });
  }

  private release(): void {
    this._available++;
    if (this.waitQueue.length > 0) {
      const next = this.waitQueue.shift()!;
      next();
    }
  }
}
