type Entry = {
  controller: AbortController;
  promise: Promise<Response>;
  consumers: number;
  settled: boolean;
};

// Share only overlapping reads. Settled responses and writes are never cached.
export class InflightReads {
  private entries = new Map<string, Entry>();
  constructor(
    private transport: typeof fetch,
    private limit = 64,
  ) {}

  invalidate() {
    this.entries.clear();
  }

  async fetch(path: string, init: RequestInit = {}): Promise<Response> {
    init.signal?.throwIfAborted();
    const method = (init.method ?? 'GET').toUpperCase();
    if (method !== 'GET' || init.body != null || !path.startsWith('/api/')) {
      if (method !== 'GET' && method !== 'HEAD') this.invalidate();
      try {
        return await this.transport(path, init);
      } finally {
        if (method !== 'GET' && method !== 'HEAD') this.invalidate();
      }
    }
    const headers = [...new Headers(init.headers).entries()].sort(([a], [b]) => a.localeCompare(b));
    const { signal: _signal, headers: _headers, ...options } = init;
    // Authorization and every transport option participate in isolation.
    const key = JSON.stringify([path, headers, options]);
    let entry = this.entries.get(key);
    if (!entry) {
      const controller = new AbortController();
      entry = { controller, consumers: 0, settled: false, promise: undefined! };
      const created = entry;
      entry.promise = Promise.resolve()
        .then(() => this.transport(path, { ...init, signal: controller.signal }))
        .then(
          response => {
            created.settled = true;
            return response;
          },
          error => {
            created.settled = true;
            throw error;
          },
        )
        .finally(() => {
          if (this.entries.get(key) === created) this.entries.delete(key);
        });
      if (this.entries.size < this.limit) this.entries.set(key, entry);
    }
    const shared = entry;
    shared.consumers++;
    return new Promise((resolve, reject) => {
      let done = false;
      const finish = (callback: () => void) => {
        if (done) return;
        done = true;
        init.signal?.removeEventListener('abort', abort);
        shared.consumers--;
        if (!shared.consumers) {
          if (this.entries.get(key) === shared) this.entries.delete(key);
          // Fetch resolves at headers, before its body finishes streaming.
          if (!shared.settled) shared.controller.abort();
        }
        callback();
      };
      const abort = () => finish(() => reject(init.signal?.reason));
      init.signal?.addEventListener('abort', abort, { once: true });
      if (init.signal?.aborted) abort();
      shared.promise.then(
        response => {
          if (done) return;
          try {
            const cloned = response.clone();
            finish(() => resolve(cloned));
          } catch (error) {
            finish(() => reject(error));
          }
        },
        error => finish(() => reject(error)),
      );
    });
  }
}
