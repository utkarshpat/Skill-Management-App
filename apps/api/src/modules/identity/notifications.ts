import type { LocalAccessState, LocalPerson } from '../access/index.js';

// Only events addressed to this person are exposed. No workspace audit payload,
// administrator identity, other people's names or role definitions reach the client.
export function notificationsFor(state: LocalAccessState, person: LocalPerson) {
  const items = state.audit
    .filter(
      event =>
        event.targetId === person.id &&
        event.action === 'person.updated' &&
        event.actorId !== person.id,
    )
    .sort((a, b) => b.revision - a.revision)
    .slice(0, 30)
    .map(event => ({
      id: `person-${event.revision}`,
      at: event.at,
      title: 'Your workspace access was updated',
      body: 'An administrator updated your profile or access assignments. Review your current profile.',
      href: '/profile',
    }));
  return { personId: person.id, items };
}
