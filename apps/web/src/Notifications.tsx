import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { Link } from 'react-router';
import { ArrowUpRight, Bell, Check, RefreshCw, X } from 'lucide-react';
import { notificationDestination, notificationDay } from './notification-model';
import { authenticatedFetch } from './auth';
import { readApiResponse } from './api-response';
import { startActivityRefresh, type RefreshStatus } from './activity-refresh';
import { RefreshIndicator } from './RefreshIndicator';
import { reportClientAction } from './client-diagnostics';
import { lockPageScroll } from './page-scroll-lock';
interface Item {
  id: string;
  at: string;
  title: string;
  body: string;
  href: string;
  actorName?: string;
  actionLabel?: string;
  subject?: string;
}
interface Feed {
  personId: string;
  items: Item[];
  partial?: boolean;
  hasMoreReminders?: boolean;
  hasMoreAnnouncements?: boolean;
}
const key = (personId: string) => `skill-notifications-read:${personId}`;
// Reminder pages repeat recent updates and active announcements with each page of reminders.
const readMarkerLimit = 1000;
function readIds(personId: string): string[] {
  try {
    const value = JSON.parse(localStorage.getItem(key(personId)) ?? '[]');
    return Array.isArray(value)
      ? value.filter(item => typeof item === 'string').slice(-readMarkerLimit)
      : [];
  } catch {
    return [];
  }
}
export function Notifications({ id }: { id: string }) {
  const [feed, setFeed] = useState<Feed>(),
    [read, setRead] = useState<string[]>([]),
    [error, setError] = useState(''),
    [attempt, setAttempt] = useState(0),
    [loading, setLoading] = useState(false),
    [filter, setFilter] = useState<'all' | 'unread'>('all');
  const [category, setCategory] = useState('All updates');
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(false);
  const [freshness, setFreshness] = useState<RefreshStatus>();
  const [reminderPage, setReminderPage] = useState(1);
  const [announcementPage, setAnnouncementPage] = useState(1);
  // The navbar badge reflects the first page, which the drawer reopens to.
  const [firstPage, setFirstPage] = useState<Feed>();
  useEffect(() => {
    if (!open) {
      setReminderPage(1);
      setAnnouncementPage(1);
    }
  }, [open]);
  const unsavedReadIds = useRef(new Map<string, string[]>());
  useEffect(() => {
    if (!open) return;
    return lockPageScroll({ lockRoot: true });
  }, [open]);
  useEffect(() => {
    const controller = new AbortController();
    let running = false,
      signature: string | undefined,
      publishedUpdate: Event | undefined;
    const load = async () => {
      if (running || document.visibilityState === 'hidden') return;
      running = true;
      setLoading(true);
      try {
        const query = new URLSearchParams();
        if (reminderPage > 1) query.set('reminderPage', String(reminderPage));
        if (announcementPage > 1) query.set('announcementPage', String(announcementPage));
        const path = '/api/notifications' + (query.size ? '?' + query : '');
        let response = await authenticatedFetch(path, {
          signal: controller.signal,
        });
        if (response.status === 409 && !controller.signal.aborted) {
          response = await authenticatedFetch(path, { signal: controller.signal });
        }
        if (!response.ok) {
          if ([401, 403].includes(response.status)) {
            setFeed(undefined);
            setFirstPage(undefined);
          }
          const body = await response.json().catch(() => undefined);
          throw new Error(body?.error?.message ?? 'Notifications could not be loaded.');
        }
        const body = await readApiResponse<Feed>(
          response,
          'Notifications could not be loaded. Try again.',
        );
        if (!controller.signal.aborted) {
          setFeed(body);
          if (reminderPage === 1 && announcementPage === 1) setFirstPage(body);
          setRead(unsavedReadIds.current.get(body.personId) ?? readIds(body.personId));
          setError('');
          if (body.partial) return false;
          const next = JSON.stringify([body.personId, body.items]);
          if (signature !== undefined && signature !== next) {
            publishedUpdate = new Event('notifications-remote-updated');
            window.dispatchEvent(publishedUpdate);
          }
          signature = next;
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          setError(
            error instanceof Error
              ? error.message
              : 'Notifications could not be refreshed. Try again.',
          );
        }
        return false;
      } finally {
        running = false;
        if (!controller.signal.aborted) setLoading(false);
      }
    };
    const stop = startActivityRefresh(
      load,
      [
        'notifications-updated',
        'announcements-updated',
        'notifications-remote-updated',
        'notifications-opened',
        'learning-updated',
      ],
      undefined,
      {
        pollMs: 90_000,
        onStatus: setFreshness,
        ignoreEvent: event => event === publishedUpdate,
      },
    );
    return () => {
      stop();
      controller.abort();
    };
  }, [attempt, reminderPage, announcementPage]);
  useEffect(() => {
    const changed = (event: StorageEvent) => {
      if (feed && event.key === key(feed.personId) && !unsavedReadIds.current.has(feed.personId))
        setRead(readIds(feed.personId));
    };
    window.addEventListener('storage', changed);
    return () => window.removeEventListener('storage', changed);
  }, [feed?.personId]);
  function mark(ids: string[], isRead = true) {
    if (!feed) return;
    reportClientAction(isRead ? 'notifications.mark_read' : 'notifications.mark_unread');
    const next = isRead
      ? [...new Set([...read, ...ids])].slice(-readMarkerLimit)
      : read.filter(id => !ids.includes(id));
    setRead(next);
    try {
      localStorage.setItem(key(feed.personId), JSON.stringify(next));
      unsavedReadIds.current.delete(feed.personId);
    } catch {
      unsavedReadIds.current.set(feed.personId, next);
    }
  }
  function opened(event: MouseEvent<HTMLAnchorElement>, itemId: string) {
    if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    reportClientAction('notifications.item_open');
    mark([itemId]);
    event.currentTarget.closest<HTMLElement>('[popover]')?.hidePopover();
  }
  const readSet = useMemo(() => new Set(read), [read]);
  const unread = feed?.items.filter(item => !readSet.has(item.id)).length ?? 0;
  const badgeFeed = firstPage?.personId === feed?.personId ? firstPage : feed;
  const badgeUnread = badgeFeed?.items.filter(item => !readSet.has(item.id)).length ?? 0;
  const paged =
    reminderPage > 1 ||
    announcementPage > 1 ||
    Boolean(feed?.hasMoreReminders || feed?.hasMoreAnnouncements);
  const entries = useMemo(
    () =>
      (feed?.items ?? []).map(item => ({
        item,
        destination: notificationDestination(item.href),
        searchable: [item.title, item.body, item.subject, item.actorName]
          .filter(Boolean)
          .join(' ')
          .toLocaleLowerCase(),
      })),
    [feed?.items],
  );
  const query = search.trim().toLocaleLowerCase();
  const items = entries.filter(
    ({ item, destination, searchable }) =>
      (filter === 'all' || !readSet.has(item.id)) &&
      (category === 'All updates' || (destination?.kind ?? 'Workspace update') === category) &&
      searchable.includes(query),
  );
  const categories = [
    'All updates',
    ...new Set(entries.map(({ destination }) => destination?.kind ?? 'Workspace update')),
  ];
  return (
    <>
      <button
        className="navbar-icon notification-trigger"
        type="button"
        aria-label={badgeUnread ? `Notifications, ${badgeUnread} unread` : 'Notifications'}
        popoverTarget={id}
        aria-controls={id}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => {
          reportClientAction('notifications.open');
          window.dispatchEvent(new Event('notifications-opened'));
        }}
      >
        <Bell size={21} />
        {badgeUnread > 0 && (
          <span className="notification-count" aria-hidden="true">
            {badgeUnread}
          </span>
        )}
      </button>
      <section
        id={id}
        popover="auto"
        className="navbar-popover notification-popover notification-drawer"
        role="dialog"
        aria-modal="false"
        aria-label="Notifications"
        onToggle={event => setOpen(event.newState === 'open')}
      >
        <div className="notification-heading">
          <div>
            <h2>Notifications</h2>
            <p>
              {unread
                ? `${unread} unread${paged ? ' on this page' : ' updates'}`
                : paged
                  ? 'No unread updates on this page'
                  : 'You’re up to date'}
            </p>
          </div>
          <div>
            <button
              className="navbar-icon"
              type="button"
              aria-label="Refresh notifications"
              disabled={loading}
              onClick={() => {
                reportClientAction('notifications.refresh');
                setAttempt(value => value + 1);
              }}
            >
              <RefreshCw size={17} className={loading ? 'notification-spin' : ''} />
            </button>
            <button
              className="navbar-icon"
              type="button"
              aria-label="Close notifications"
              popoverTarget={id}
              popoverTargetAction="hide"
              onClick={() => reportClientAction('notifications.close')}
            >
              <X size={18} />
            </button>
          </div>
        </div>
        {error && (
          <div className="notification-error">
            <p role="alert">{error}</p>
            <button
              className="admin-text-button"
              disabled={loading}
              onClick={() => setAttempt(value => value + 1)}
            >
              Retry
            </button>
          </div>
        )}
        {!feed && !error ? (
          <div className="notification-empty" role="status">
            <RefreshCw className="notification-spin" size={24} />
            <p>Loading your updates…</p>
          </div>
        ) : (
          feed && (
            <>
              <div className="notification-search">
                <label htmlFor={id + '-search'}>Search notifications</label>
                <div>
                  <input
                    id={id + '-search'}
                    type="search"
                    value={search}
                    placeholder="Search updates, people or subjects"
                    onChange={event => setSearch(event.target.value)}
                  />
                  {search && (
                    <button className="admin-text-button" onClick={() => setSearch('')}>
                      Clear search
                    </button>
                  )}
                </div>
              </div>
              <div className="notification-toolbar">
                <div role="group" aria-label="Notification filter">
                  <button
                    aria-pressed={filter === 'all'}
                    onClick={() => {
                      reportClientAction('notifications.filter_changed');
                      setFilter('all');
                    }}
                  >
                    All
                  </button>
                  <button
                    aria-pressed={filter === 'unread'}
                    onClick={() => {
                      reportClientAction('notifications.filter_changed');
                      setFilter('unread');
                    }}
                  >
                    Unread ({unread})
                  </button>
                </div>
                <button
                  className="admin-text-button"
                  disabled={!unread}
                  onClick={() => {
                    reportClientAction('notifications.mark_all_read');
                    mark(feed.items.map(item => item.id));
                  }}
                >
                  <Check size={14} />
                  {paged ? 'Read all on this page' : 'Read all'}
                </button>
              </div>
              <div
                className="notification-categories"
                role="group"
                aria-label="Notification category"
              >
                {categories.map(c => (
                  <button
                    key={c}
                    aria-pressed={category === c}
                    onClick={() => {
                      reportClientAction('notifications.category_changed');
                      setCategory(c);
                    }}
                  >
                    {c}
                  </button>
                ))}
              </div>
              {feed.partial && (
                <p role="status">Some updates could not be loaded. Refresh to try again.</p>
              )}
              {loading && (
                <p className="notification-refresh-status" role="status">
                  Refreshing updates…
                </p>
              )}
              {!items.length ? (
                <div className="notification-empty">
                  <Bell size={24} />
                  <strong>
                    {search.trim() || category !== 'All updates'
                      ? 'No matching notifications'
                      : filter === 'unread'
                        ? 'No unread notifications'
                        : 'No notifications yet'}
                  </strong>
                  <p>
                    {search.trim() || category !== 'All updates'
                      ? 'Try another search or reset your filters.'
                      : filter === 'unread'
                        ? 'Your recent updates are still available in All.'
                        : 'Updates about your requests, claims and learning will appear here.'}
                  </p>
                  {(filter === 'unread' || search.trim() || category !== 'All updates') && (
                    <button
                      className="admin-text-button"
                      onClick={() => {
                        setFilter('all');
                        setCategory('All updates');
                        setSearch('');
                      }}
                    >
                      View all updates
                    </button>
                  )}
                </div>
              ) : (
                <ul className="notification-list">
                  {items.map(({ item, destination }, index) => {
                    const Icon = destination?.icon ?? Bell,
                      isRead = readSet.has(item.id);
                    const prefix = `${item.actorName} · ${item.actionLabel} · `;
                    const body = (
                      item.actorName && item.actionLabel && item.body.startsWith(prefix)
                        ? item.body.slice(prefix.length)
                        : item.body
                    ).replace(
                      /(\d+) (skill|certificate)\(s\)/g,
                      (_, count, kind) => `${count} ${kind}${Number(count) === 1 ? '' : 's'}`,
                    );
                    return (
                      <li key={item.id} className={isRead ? '' : 'unread'}>
                        {(index === 0 ||
                          notificationDay(items[index - 1].item.at) !==
                            notificationDay(item.at)) && (
                          <span className="notification-date-group">
                            {notificationDay(item.at)}
                          </span>
                        )}
                        <span className="notification-item-icon">
                          <Icon size={18} />
                        </span>
                        <div className="notification-item-content">
                          <span className="notification-kind">
                            {destination?.kind ?? 'Workspace update'}
                            {!isRead && <i aria-label="Unread" />}
                          </span>
                          {item.actorName && (
                            <small className="notification-actor">{item.actorName}</small>
                          )}
                          {destination ? (
                            <Link
                              className="notification-summary-link"
                              to={item.href}
                              onClick={event => opened(event, item.id)}
                            >
                              <strong>{item.title}</strong>
                              {item.subject && (
                                <p className="notification-subject">{item.subject}</p>
                              )}
                              <p>{body}</p>
                            </Link>
                          ) : (
                            <>
                              <strong>{item.title}</strong>
                              {item.subject && (
                                <p className="notification-subject">{item.subject}</p>
                              )}
                              <p>{body}</p>
                            </>
                          )}
                          <time dateTime={item.at}>
                            {new Date(item.at).toLocaleString(undefined, {
                              dateStyle: 'medium',
                              timeStyle: 'short',
                            })}
                          </time>
                          <div className="notification-item-actions">
                            {destination && (
                              <Link to={item.href} onClick={event => opened(event, item.id)}>
                                {destination.label}
                                <ArrowUpRight size={15} />
                              </Link>
                            )}
                            <button
                              className="admin-text-button"
                              onClick={() => mark([item.id], !isRead)}
                            >
                              {isRead ? 'Mark unread' : 'Mark read'}
                            </button>
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
              <RefreshIndicator status={freshness} />
              {(reminderPage > 1 || feed.hasMoreReminders) && (
                <div role="group" aria-label="Reminder pages">
                  <button
                    type="button"
                    disabled={loading || reminderPage === 1}
                    onClick={() => setReminderPage(page => page - 1)}
                  >
                    Previous reminders
                  </button>
                  <span>Reminder page {reminderPage}</span>
                  <button
                    type="button"
                    disabled={loading || !feed.hasMoreReminders}
                    onClick={() => setReminderPage(page => page + 1)}
                  >
                    More reminders
                  </button>
                </div>
              )}
              {(announcementPage > 1 || feed.hasMoreAnnouncements) && (
                <div role="group" aria-label="Announcement notification pages">
                  <button
                    type="button"
                    disabled={loading || announcementPage === 1}
                    onClick={() => setAnnouncementPage(page => page - 1)}
                  >
                    Previous announcements
                  </button>
                  <span>Announcement page {announcementPage}</span>
                  <button
                    type="button"
                    disabled={loading || !feed.hasMoreAnnouncements}
                    onClick={() => setAnnouncementPage(page => page + 1)}
                  >
                    More announcements
                  </button>
                </div>
              )}
              <small className="notification-device-note">
                Read status is saved on this device.
              </small>
            </>
          )
        )}
      </section>
    </>
  );
}
