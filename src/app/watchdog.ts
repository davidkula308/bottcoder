// Stops waiting on an AI reply that has gone silent, so coding moves on instead of pausing forever.

export class StallError extends Error {
  constructor(seconds: number) {
    super(`no reply for ${seconds}s`);
    this.name = "StallError";
  }
}

/**
 * Runs `task` and fails with StallError when no progress is reported for too long.
 * `firstMs` is the allowed wait before the first chunk (the model warming up), `gapMs` between later chunks.
 */
export function guardStall<T>(
  task: (progress: () => void) => Promise<T>,
  opts: { firstMs: number; gapMs: number; onStall?: () => void },
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let done = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const arm = (ms: number) => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (done) return;
        done = true;
        opts.onStall?.();
        reject(new StallError(Math.round(ms / 1000)));
      }, ms);
    };
    arm(opts.firstMs);
    task(() => { if (!done) arm(opts.gapMs); }).then(
      (v) => { if (done) return; done = true; clearTimeout(timer); resolve(v); },
      (e: unknown) => { if (done) return; done = true; clearTimeout(timer); reject(e); },
    );
  });
}
