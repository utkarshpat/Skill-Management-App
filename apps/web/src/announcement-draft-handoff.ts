import { DraftHandoff } from './learning-draft-handoff';
import type { Management } from './announcement-model';

export type AnnouncementDraftInput = {
  title: string;
  message: string;
  audienceLabel: string;
  cta: string;
};

export const announcementDraftHandoff = new DraftHandoff<AnnouncementDraftInput>();

export function resolveAnnouncementAudience(data: Management, label: string) {
  const normalize = (value: string) =>
    value.normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ');
  const expected = normalize(label);
  if (!expected) return;
  const candidates = data.scopes.filter(
    scope =>
      scope.kind !== 'ORGANIZATION' &&
      normalize(scope.label) === expected &&
      data.grants.some(grant => grant.id === scope.grantId),
  );
  const match = candidates[0];
  if (match && candidates.every(scope => scope.id === match.id && scope.kind === match.kind))
    return { grantId: match.grantId, audience: [{ kind: match.kind, id: match.id }] };
}
