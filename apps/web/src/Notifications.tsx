import { useEffect, useState, type MouseEvent } from 'react';
import { Link } from 'react-router';
import { ArrowUpRight, Bell, Check, RefreshCw, X } from 'lucide-react';
import { notificationDestination } from './notification-model';
import { authenticatedFetch } from './auth';
interface Item {
  id: string;
  at: string;
  title: string;
  body: string;
  href: string;
}
interface Feed {
  personId: string;
  items: Item[];
  partial?: boolean;
}
const key = (personId: string) => `skill-notifications-read:${personId}`;
function readIds(personId: string): string[] {
  try {
    const value = JSON.parse(localStorage.getItem(key(personId)) ?? '[]');
    return Array.isArray(value) ? value.filter(item => typeof item === 'string').slice(-100) : [];
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
  useEffect(() => {
    const controller = new AbortController();
    let running = false;
    const load = async () => {
      if (running || document.visibilityState === 'hidden') return;
      running = true;
      setLoading(true);
      try {
        const response = await authenticatedFetch('/api/notifications', {
          signal: controller.signal,
        });
        if (!response.ok) {
          if ([401, 403].includes(response.status)) setFeed(undefined);
          throw new Error('Notifications could not be loaded.');
        }
        const body: Feed = await response.json();
        if (!controller.signal.aborted) {
          setFeed(body);
          setRead(readIds(body.personId));
          setError('');
        }
      } catch {
        if (!controller.signal.aborted) {
          setError('Notifications could not be refreshed. Try again.');
        }
      } finally {
        running = false;
        if (!controller.signal.aborted) setLoading(false);
      }
    };
    void load();
    const timer = setInterval(() => void load(), 60000),
      refresh = () => void load();
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener('notifications-updated', refresh);
    return () => {
      controller.abort();
      clearInterval(timer);
      document.removeEventListener('visibilitychange', refresh);
      window.removeEventListener('notifications-updated', refresh);
    };
  }, [attempt]);
  useEffect(() => {
    const changed = (event: StorageEvent) => {
      if (feed && event.key === key(feed.personId)) setRead(readIds(feed.personId));
    };
    window.addEventListener('storage', changed);
    return () => window.removeEventListener('storage', changed);
  }, [feed?.personId]);
  function mark(ids: string[], isRead = true) {
    if (!feed) return;
    const next = isRead
      ? [...new Set([...read, ...ids])].slice(-100)
      : read.filter(id => !ids.includes(id));
    setRead(next);
    try {
      localStorage.setItem(key(feed.personId), JSON.stringify(next));
    } catch {
      /* Read state still works in this session. */
    }
  }
  function opened(event: MouseEvent<HTMLAnchorElement>, itemId: string) {
    if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    mark([itemId]);
    event.currentTarget.closest<HTMLElement>('[popover]')?.hidePopover();
  }
  const unread = feed?.items.filter(item => !read.includes(item.id)).length ?? 0;
  const items = feed?.items.filter(item => filter === 'all' || !read.includes(item.id)) ?? [];
  return (
    <>
      <button
        className="navbar-icon notification-trigger"
        type="button"
        aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'}
        popoverTarget={id}
      >
        <Bell size={21} />
        {unread > 0 && (
          <span className="notification-count" aria-hidden="true">
            {unread}
          </span>
        )}
      </button>
      <section
        id={id}
        popover="auto"
        className="navbar-popover notification-popover"
        aria-label="Notifications"
      >
        <div className="notification-heading">
          <div>
            <h2>Notifications</h2>
            <p>{unread ? `${unread} unread updates` : 'You’re up to date'}</p>
          </div>
          <div>
            <button
              className="navbar-icon"
              type="button"
              aria-label="Refresh notifications"
              disabled={loading}
              onClick={() => setAttempt(value => value + 1)}
            >
              <RefreshCw size={17} className={loading ? 'notification-spin' : ''} />
            </button>
            <button
              className="navbar-icon"
              type="button"
              aria-label="Close notifications"
              popoverTarget={id}
              popoverTargetAction="hide"
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
              <div className="notification-toolbar">
                <div role="group" aria-label="Notification filter">
                  <button aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>
                    All
                  </button>
                  <button aria-pressed={filter === 'unread'} onClick={() => setFilter('unread')}>
                    Unread ({unread})
                  </button>
                </div>
                <button
                  className="admin-text-button"
                  disabled={!unread}
                  onClick={() => mark(feed.items.map(item => item.id))}
                >
                  <Check size={14} />
                  Read all
                </button>
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
                    {filter === 'unread' ? 'No unread notifications' : 'No notifications yet'}
                  </strong>
                  <p>
                    {filter === 'unread'
                      ? 'Your recent updates are still available in All.'
                      : 'Updates about your requests, claims and learning will appear here.'}
                  </p>
                  {filter === 'unread' && (
                    <button className="admin-text-button" onClick={() => setFilter('all')}>
                      View all updates
                    </button>
                  )}
                </div>
              ) : (
                <ul className="notification-list">
                  {items.map(item => {
                    const destination = notificationDestination(item.href),
                      Icon = destination?.icon ?? Bell,
                      isRead = read.includes(item.id);
                    return (
                      <li key={item.id} className={isRead ? '' : 'unread'}>
                        <span className="notification-item-icon">
                          <Icon size={18} />
                        </span>
                        <div className="notification-item-content">
                          <span className="notification-kind">
                            {destination?.kind ?? 'Workspace update'}
                            {!isRead && <i aria-label="Unread" />}
                          </span>
                          {destination ? (
                            <Link
                              className="notification-summary-link"
                              to={item.href}
                              onClick={event => opened(event, item.id)}
                            >
                              <strong>{item.title}</strong>
                              <p>{item.body}</p>
                            </Link>
                          ) : (
                            <>
                              <strong>{item.title}</strong>
                              <p>{item.body}</p>
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
              <small className="notification-device-note">
                Read status is saved on this device. Actions use your current access.
              </small>
            </>
          )
        )}
      </section>
    </>
  );
}
