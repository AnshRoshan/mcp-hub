/**
 * Run a caller-influenced computation off the main thread with a hard deadline.
 *
 * Node is single-threaded, so a loop that never finishes does not just delay one
 * request — it freezes every user of the process. The classic case is a
 * catastrophic regular expression: `(a+)+$` against a long near-miss takes
 * exponential time inside a *single* exec step, which no match limit or
 * iteration budget can catch, because the hang happens before the limit is
 * consulted. The only reliable bound is an external one that can kill the work.
 */

import { Worker } from "node:worker_threads";

export interface BoundedOptions {
  timeoutMs: number;
  /** Wording for the rejection when the deadline passes. */
  label: string;
}

/**
 * `source` is evaluated as a CommonJS script in a fresh worker with
 * `workerData` available; it must call parentPort.postMessage with its result.
 * The worker is always terminated, including when the deadline fires — the
 * pending computation is killed rather than left running.
 */
export function runBounded<T>(source: string, workerData: unknown, options: BoundedOptions): Promise<T> {
  const worker = new Worker(source, { eval: true, workerData });
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const finish = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };
    const timer = setTimeout(() => {
      finish(() => reject(new Error(`${options.label} (timed out after ${options.timeoutMs}ms)`)));
    }, options.timeoutMs);
    worker.once("message", (value) => finish(() => resolve(value as T)));
    worker.once("error", (err) => finish(() => reject(err)));
    worker.once("exit", (code) => {
      if (code !== 0) finish(() => reject(new Error(`${options.label} (worker exited with code ${code})`)));
    });
  }).finally(() => {
    void worker.terminate();
  });
}
