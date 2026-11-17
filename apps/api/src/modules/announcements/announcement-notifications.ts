interface ActiveAnnouncement {
  id: string;
  startsAt: string;
  answered: boolean;
  definition: { title: string; message: string; kind: string };
}

// Consume the existing SQL-authorized active feed, including its live audience policy.
export function announcementNotifications(items: ActiveAnnouncement[]) {
  return items.map(item => ({
    id: 'announcement-' + item.id,
    at: item.startsAt,
    title: item.definition.title,
    body: item.answered
      ? 'Your response has been recorded. You can reopen this announcement.'
      : item.definition.message ||
        (item.definition.kind === 'POLL'
          ? 'A poll is available for your scope.'
          : 'An announcement is available for your scope.'),
    href: '/announcements?announcement=' + encodeURIComponent(item.id),
  }));
}
