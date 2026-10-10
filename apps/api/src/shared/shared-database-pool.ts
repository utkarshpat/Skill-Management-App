// Share connection establishment within one instance, never database operations.
// A failed detached connection must not discard a newer connection after close().
export class SharedDatabasePool<T extends { close(): Promise<unknown> }> {
  private pending: Promise<T> | undefined;
  constructor(private connect: () => Promise<T>) {}
  get(): Promise<T> {
    if (!this.pending) {
      const pending = this.connect().catch(error => {
        if (this.pending === pending) this.pending = undefined;
        throw error;
      });
      this.pending = pending;
    }
    return this.pending;
  }
  async close() {
    const pending = this.pending;
    this.pending = undefined;
    if (pending) await (await pending).close();
  }
}
