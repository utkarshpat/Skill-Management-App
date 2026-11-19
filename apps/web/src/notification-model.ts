import { Bell, BookOpen, ClipboardCheck, Inbox, Megaphone } from 'lucide-react';
import { isPhaseTwoPage, phaseTwoVisible } from './release-features';
export function notificationDestination(href: string | null) {
  if (!href?.startsWith('/') || href.startsWith('//') || /[\\\u0000-\u0020\u007f]/.test(href))
    return undefined;
  let url: URL;
  try {
    url = new URL(href, 'https://workspace.invalid');
  } catch {
    return undefined;
  }
  if (url.origin !== 'https://workspace.invalid') return undefined;
  if (!phaseTwoVisible && isPhaseTwoPage(url.pathname)) return undefined;
  const actions: Record<string, { label: string; kind: string; icon: typeof Bell }> = {
    '/announcements': { label: 'Open announcement', kind: 'Announcements', icon: Megaphone },
    '/requests': { label: 'View request', kind: 'Requests', icon: Inbox },
    '/learning': {
      label: url.searchParams.has('recommendation') ? 'Open recommendation' : 'Open learning',
      kind: 'Learn & Grow',
      icon: BookOpen,
    },
    '/skill-reviews': {
      label: url.searchParams.has('recommendation')
        ? 'Open certification recommendation'
        : url.searchParams.has('person')
          ? 'View employee'
          : url.searchParams.get('type') === 'certifications' ||
              url.searchParams.has('certification')
            ? 'Open certification approval'
            : url.searchParams.has('submission')
              ? 'Open approval request'
              : 'Open claim approval',
      kind: 'Skills & approvals',
      icon: ClipboardCheck,
    },
    '/my-skills': {
      label: url.searchParams.has('submission') ? 'View approval outcome' : 'View skill claim',
      kind: 'Skills & approvals',
      icon: ClipboardCheck,
    },
    '/certifications': {
      label: url.searchParams.has('renew')
        ? 'Update renewed certificate'
        : url.searchParams.has('recommendation')
          ? 'Open certification recommendation'
          : 'View certification',
      kind: 'Skills & approvals',
      icon: ClipboardCheck,
    },
    '/profile': { label: 'View profile', kind: 'Profile & access', icon: Bell },
    '/skills': { label: 'View catalogue request', kind: 'Requests', icon: Inbox },
  };
  return actions[url.pathname];
}

export function notificationDay(at: string, now = new Date()) {
  const date = new Date(at);
  if (!Number.isFinite(date.getTime())) return 'Earlier updates';
  const day = (value: Date) => [value.getFullYear(), value.getMonth(), value.getDate()].join('-');
  if (day(date) === day(now)) return 'Today';
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (day(date) === day(yesterday)) return 'Yesterday';
  return date.toLocaleDateString(undefined, { dateStyle: 'medium' });
}
