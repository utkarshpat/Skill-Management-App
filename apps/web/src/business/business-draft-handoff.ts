export interface BusinessDraft {
  kind: 'amendment_draft' | 'demand_draft';
  title: string;
  body: string;
  summary: string;
}
/** Single-use, actor-bound memory; nothing survives reload or sign-out. */
export class BusinessDraftHandoff {
  private pending?: { actorId: string; ticket: string; draft: BusinessDraft; expires: number };
  offer(actorId: string, draft: BusinessDraft, now = Date.now()) {
    if (
      !actorId ||
      !['amendment_draft', 'demand_draft'].includes(draft.kind) ||
      !draft.title ||
      draft.title.length > 120 ||
      draft.body.length > 2000 ||
      draft.summary.length > 600
    )
      throw Error('Invalid business draft.');
    const ticket = crypto.randomUUID();
    this.pending = { actorId, ticket, draft: structuredClone(draft), expires: now + 300000 };
    return ticket;
  }
  take(actorId: string, ticket: string, now = Date.now()) {
    const p = this.pending;
    this.pending = undefined;
    return p && p.actorId === actorId && p.ticket === ticket && now < p.expires
      ? p.draft
      : undefined;
  }
  clear() {
    this.pending = undefined;
  }
}
export const businessDraftHandoff = new BusinessDraftHandoff();
