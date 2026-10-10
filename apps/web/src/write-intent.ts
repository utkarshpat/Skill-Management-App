// One mounted form retains its operation ID across uncertain responses.
// Persistence/idempotency still belongs to the server transaction.
export class WriteIntent {
  private pending?: { signature: string; id: string };
  private running = false;
  constructor(private newId: () => string = () => crypto.randomUUID()) {}
  begin(payload: object) {
    if (this.running) return undefined;
    const signature = JSON.stringify(payload);
    if (!this.pending || this.pending.signature !== signature)
      this.pending = { signature, id: this.newId() };
    this.running = true;
    return this.pending.id;
  }
  finish(saved: boolean) {
    this.running = false;
    if (saved) this.pending = undefined;
  }
}
