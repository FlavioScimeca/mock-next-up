// MVP: single concurrent render (RAM-safe default)
// Later: increase MAX_CONCURRENT_RENDERS to 2-3 when stable
const MAX_CONCURRENT_RENDERS = 1;

let queue: Promise<unknown> = Promise.resolve();

export async function withRenderLock<T>(fn: () => Promise<T>): Promise<T> {
  if (MAX_CONCURRENT_RENDERS <= 0) {
    throw new Error("MAX_CONCURRENT_RENDERS must be at least 1");
  }

  const run = queue.then(() => fn());

  queue = run.catch(() => {});
  return run as Promise<T>;
}
