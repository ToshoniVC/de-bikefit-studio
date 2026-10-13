import { describe, expect, it, vi } from 'vitest';
import { ConcurrencyQueueFullError, createConcurrencyLimiter } from './concurrency';

/** A promise the test settles by hand. */
function gate() {
  let open!: () => void;
  const promise = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { promise, open };
}

/** Lets every pending promise callback run. */
const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

describe('createConcurrencyLimiter', () => {
  it('never runs more than `max` tasks at once and passes each result through', async () => {
    const limiter = createConcurrencyLimiter(2, 10);
    const gates = Array.from({ length: 6 }, () => gate());
    let running = 0;
    let peak = 0;
    const results = gates.map((g, index) =>
      limiter.run(async () => {
        running += 1;
        peak = Math.max(peak, running);
        await g.promise;
        running -= 1;
        return index;
      }),
    );

    await settle();
    expect([running, limiter.active, limiter.queued]).toEqual([2, 2, 4]);
    for (const g of gates) {
      g.open();
      await settle();
      expect(running).toBeLessThanOrEqual(2);
    }
    expect(await Promise.all(results)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(peak).toBe(2);
    expect([limiter.active, limiter.queued]).toEqual([0, 0]);
  });

  it('starts waiting tasks in arrival order, also when a newcomer arrives as a slot frees up', async () => {
    const limiter = createConcurrencyLimiter(1, 10);
    const first = gate();
    const started: string[] = [];
    const a = limiter.run(async () => {
      started.push('a');
      await first.promise;
    });
    const b = limiter.run(async () => {
      started.push('b');
    });
    const c = limiter.run(async () => {
      started.push('c');
    });
    // Arrives the moment `a` has finished, while `b` and `c` still wait.
    const d = a.then(() =>
      limiter.run(async () => {
        started.push('d');
      }),
    );

    first.open();
    await Promise.all([a, b, c, d]);
    expect(started).toEqual(['a', 'b', 'c', 'd']);
  });

  it('refuses a task outright when `max` run and `maxQueue` wait, and recovers afterwards', async () => {
    const limiter = createConcurrencyLimiter(1, 2);
    const first = gate();
    const ran: string[] = [];
    const accepted = Promise.allSettled([
      limiter.run(async () => {
        ran.push('first');
        await first.promise;
      }),
      limiter.run(async () => {
        ran.push('queued 1');
      }),
      limiter.run(async () => {
        ran.push('queued 2');
      }),
    ]);
    const refusedTask = vi.fn(async () => 'never');

    await expect(limiter.run(refusedTask)).rejects.toBeInstanceOf(ConcurrencyQueueFullError);
    expect(refusedTask).not.toHaveBeenCalled();
    expect([limiter.active, limiter.queued]).toEqual([1, 2]);

    first.open();
    expect((await accepted).every((outcome) => outcome.status === 'fulfilled')).toBe(true);
    expect(ran).toEqual(['first', 'queued 1', 'queued 2']);
    await expect(limiter.run(async () => 'again')).resolves.toBe('again');
  });

  it('with maxQueue 0, refuses anything beyond `max`', async () => {
    const limiter = createConcurrencyLimiter(1, 0);
    const first = gate();
    const running = limiter.run(() => first.promise);
    await expect(limiter.run(async () => 'x')).rejects.toBeInstanceOf(ConcurrencyQueueFullError);
    first.open();
    await running;
    await expect(limiter.run(async () => 'x')).resolves.toBe('x');
  });

  it('releases the slot however a task ends: resolved, rejected or thrown synchronously', async () => {
    const limiter = createConcurrencyLimiter(1, 5);
    const boom = new Error('boom');
    const outcomes = await Promise.allSettled([
      limiter.run(() => Promise.reject(boom)),
      limiter.run(() => {
        throw boom;
      }),
      limiter.run(async () => 'still runs'),
    ]);
    expect(outcomes).toEqual([
      { status: 'rejected', reason: boom },
      { status: 'rejected', reason: boom },
      { status: 'fulfilled', value: 'still runs' },
    ]);
    expect([limiter.active, limiter.queued]).toEqual([0, 0]);
  });

  it('rejects nonsensical limits up front', () => {
    for (const [max, maxQueue] of [
      [0, 1],
      [1.5, 1],
      [Number.NaN, 1],
      [1, -1],
      [1, 0.5],
      [1, Number.POSITIVE_INFINITY],
    ]) {
      expect(() => createConcurrencyLimiter(max, maxQueue), `${max}, ${maxQueue}`).toThrow(
        RangeError,
      );
    }
    expect(() => createConcurrencyLimiter(1, 0)).not.toThrow();
  });
});
