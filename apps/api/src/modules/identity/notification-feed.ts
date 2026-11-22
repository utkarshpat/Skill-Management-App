import { AccessError } from '../../shared/errors.js';
interface Item {
  id: string;
  at: string;
  title: string;
  body: string;
  href: string;
  actionLabel?: string;
}

// Installed SQL versions and stored skill notifications can still use the original labels.
const approvalTitles = new Map([
  ['Skill review requested', 'Skill approval requested'],
  ['Certificate review requested', 'Certificate approval requested'],
  ['Certification review requested', 'Certification approval requested'],
  ['Certification review completed', 'Certification decision recorded'],
  ['Capability review requested', 'Capability approval requested'],
  ['Capability review completed', 'Capability decision recorded'],
]);
const approvalBodies = new Map([
  [
    'A direct report submitted a skill claim for your review.',
    'A direct report submitted a skill claim for approval.',
  ],
  [
    'Your skill claim was reviewed. Open My skills for feedback.',
    'A decision was recorded for your skill claim. Open My skills for feedback.',
  ],
]);
const approvalActions = new Map([
  ['Submitted for review', 'Submitted for approval'],
  ['Review completed', 'Decision recorded'],
]);

export async function loadNotificationFeed(
  base: { personId: string; items: Item[] },
  sources: { name: string; load: () => Promise<Item[]> }[],
) {
  const results = await Promise.allSettled(
    sources.map(source => Promise.resolve().then(source.load)),
  );
  const items = [...base.items],
    failedSources: string[] = [];
  results.forEach((result, index) => {
    if (result.status === 'fulfilled') {
      const source = sources[index].name;
      items.push(
        ...result.value.map(item => {
          if (source === 'skill-staleness') {
            return {
              ...item,
              // The installed reminder procedure links to the approved claim in view mode.
              body: item.body.replace(
                / Do you want to update or retire this skill\?$/,
                ' Open the claim to review your recorded proficiency and experience.',
              ),
            };
          }
          if (source !== 'reviews' && source !== 'certifications') return item;
          return {
            ...item,
            title: approvalTitles.get(item.title) ?? item.title,
            body: approvalBodies.get(item.body) ?? item.body,
            ...(item.actionLabel && {
              actionLabel: approvalActions.get(item.actionLabel) ?? item.actionLabel,
            }),
          };
        }),
      );
    } else {
      // A changed permission is not a transient failure. Do not return stale data.
      if (result.reason instanceof AccessError && [401, 403].includes(result.reason.status))
        throw result.reason;
      failedSources.push(sources[index].name);
    }
  });
  const reminders = items.filter(item => item.id.startsWith('cert-expiry-'));
  const announcements = items.filter(item => item.id.startsWith('announcement-'));
  const staleSkills = items.filter(item => item.id.startsWith('skill-stale-'));
  const recent = items.filter(
    item =>
      !['cert-expiry-', 'announcement-', 'skill-stale-'].some(prefix => item.id.startsWith(prefix)),
  );
  recent.sort((a, b) => b.at.localeCompare(a.at));
  return {
    ...base,
    items: [
      ...recent.slice(0, 30),
      ...announcements,
      ...reminders.slice(0, 30),
      ...staleSkills.slice(0, 30),
    ].sort((a, b) => b.at.localeCompare(a.at)),
    hasMoreReminders: reminders.length > 30 || staleSkills.length > 30,
    partial: failedSources.length > 0,
    failedSources,
  };
}
