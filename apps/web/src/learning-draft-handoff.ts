import type { LearningPlanDraftInput } from './learning-plan-draft';
// Ephemeral, single-use handoff. Nothing is stored across sign-out or reload.
export class DraftHandoff<T> {
  private pending?: {
    actorId: string;
    ticket: string;
    draft: T;
    expires: number;
  };
  offer(actorId: string, draft: T, now = Date.now()) {
    if (!actorId) throw Error('Your workspace identity is unavailable.');
    const ticket = crypto.randomUUID();
    this.pending = { actorId, ticket, draft: structuredClone(draft), expires: now + 300_000 };
    return ticket;
  }
  take(actorId: string, ticket: string, now = Date.now()) {
    const pending = this.pending;
    this.pending = undefined;
    return pending &&
      pending.actorId === actorId &&
      pending.ticket === ticket &&
      now < pending.expires
      ? pending.draft
      : undefined;
  }
  clear() {
    this.pending = undefined;
  }
}
export class LearningDraftHandoff extends DraftHandoff<LearningPlanDraftInput> {}
export const learningDraftHandoff = new LearningDraftHandoff();
