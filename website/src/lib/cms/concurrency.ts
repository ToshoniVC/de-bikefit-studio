/**
 * A small in-process concurrency limiter: at most `max` tasks run at once, at
 * most `maxQueue` more wait (first come, first served), and anything beyond
 * that is refused at once instead of piling up.
 *
 * Pure: no I/O, no timers, no Node or Next APIs. `./password.ts` routes every
 * scrypt computation (~128 MiB each) through one of these.
 */

/** The rejection of `run()` when `max` tasks run and `maxQueue` already wait. */
export class ConcurrencyQueueFullError extends Error {
  constructor() {
    super('concurrency limiter queue is full');
    this.name = 'ConcurrencyQueueFullError';
  }
}

export type ConcurrencyLimiter = {
  /**
   * Runs `task` as soon as a slot is free and settles with its outcome. The
   * slot is released however the task ends (value, rejection or synchronous
   * throw), so a task must eventually settle. Rejects with
   * {@link ConcurrencyQueueFullError}, without calling `task`, when the queue
   * is full.
   */
  run<T>(task: () => Promise<T>): Promise<T>;
  /** Tasks running now. */
  readonly active: number;
  /** Tasks waiting for a slot. */
  readonly queued: number;
};

export function createConcurrencyLimiter(max: number, maxQueue: number): ConcurrencyLimiter {
  if (!Number.isInteger(max) || max < 1) {
    throw new RangeError(`max must be a whole number of at least 1, got ${max}`);
  }
  if (!Number.isInteger(maxQueue) || maxQueue < 0) {
    throw new RangeError(`maxQueue must be a whole number of at least 0, got ${maxQueue}`);
  }

  let active = 0;
  const waiting: Array<() => void> = [];

  // A finished task hands its slot straight to the longest waiter (`active`
  // stays the same), so a newcomer never finds a slot free while others wait.
  const release = () => {
    const next = waiting.shift();
    if (next) next();
    else active -= 1;
  };

  return {
    async run<T>(task: () => Promise<T>): Promise<T> {
      if (active < max) {
        active += 1;
      } else if (waiting.length < maxQueue) {
        await new Promise<void>((resolve) => waiting.push(resolve));
      } else {
        throw new ConcurrencyQueueFullError();
      }
      try {
        return await task();
      } finally {
        release();
      }
    },
    get active() {
      return active;
    },
    get queued() {
      return waiting.length;
    },
  };
}
