import { describe, it, expect } from 'vitest';
import { Semaphore } from './semaphore';

describe('Semaphore', () => {
  it('allows up to max concurrent acquisitions', async () => {
    const sem = new Semaphore(2);
    const r1 = await sem.acquire();
    const r2 = await sem.acquire();
    expect(sem.available).toBe(0);
    r1();
    expect(sem.available).toBe(1);
    r2();
    expect(sem.available).toBe(2);
  });

  it('queues when full', async () => {
    const sem = new Semaphore(1);
    const r1 = await sem.acquire();
    let acquired = false;
    const p = sem.acquire().then((r) => { acquired = true; return r; });
    await new Promise((r) => setTimeout(r, 10));
    expect(acquired).toBe(false);
    r1();
    const r2 = await p;
    expect(acquired).toBe(true);
    r2();
  });
});
