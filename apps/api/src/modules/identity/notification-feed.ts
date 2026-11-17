import { AccessError } from '../../shared/errors.js';
interface Item {
  id: string;
  at: string;
  title: string;
  body: string;
  href: string;
}
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
    if (result.status === 'fulfilled') items.push(...result.value);
    else {
      // A changed permission is not a transient failure. Do not return stale data.
      if (result.reason instanceof AccessError && [401, 403].includes(result.reason.status))
        throw result.reason;
      failedSources.push(sources[index].name);
    }
  });
  const reminders = items.filter(item => item.id.startsWith('cert-expiry-'));
  const announcements = items.filter(item => item.id.startsWith('announcement-'));
  const recent = items.filter(
    item => !item.id.startsWith('cert-expiry-') && !item.id.startsWith('announcement-'),
  );
  recent.sort((a, b) => b.at.localeCompare(a.at));
  return {
    ...base,
    items: [...recent.slice(0, 30), ...announcements, ...reminders.slice(0, 30)].sort((a, b) =>
      b.at.localeCompare(a.at),
    ),
    hasMoreReminders: reminders.length > 30,
    partial: failedSources.length > 0,
    failedSources,
  };
}
