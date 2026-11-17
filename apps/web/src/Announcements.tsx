import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { authenticatedFetch } from './auth';
import { readApiResponse } from './api-response';
import { FormDialog } from './FormDialog';
import { endpoint, type LiveAnnouncement, type Person } from './announcement-model';
import {
  announcementStyle,
  AnnouncementBannerContent,
  AnnouncementCard,
  AnnouncementForm,
  PollOptions,
} from './AnnouncementContent';
import './announcements.css';

const AnnouncementManager = lazy(() =>
  import('./AnnouncementManager').then(module => ({ default: module.AnnouncementManager })),
);

interface Feed {
  items: LiveAnnouncement[];
  person: Person;
  canPublish: boolean;
}
const notificationEvent = 'announcements-updated';
export function refreshAnnouncements() {
  window.dispatchEvent(new Event(notificationEvent));
}

export function Announcements({ page = false }: { page?: boolean }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedId = page ? (searchParams.get('announcement') ?? '') : '';
  const [loadedLink, setLoadedLink] = useState<string>();
  const handledLink = useRef('');
  const [feed, setFeed] = useState<Feed>();
  const [selection, setSelection] = useState('');
  const [dialog, setDialog] = useState<{ item: string; form: boolean }>();
  const [managing, setManaging] = useState(false);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [now, setNow] = useState(Date.now());
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [responseError, setResponseError] = useState(false);
  const responseLock = useRef(false);
  useEffect(() => {
    let request: AbortController | undefined;
    const refresh = () => {
      request?.abort();
      request = new AbortController();
      const signal = request.signal;
      authenticatedFetch(endpoint + '/feed', { signal })
        .then(response => readApiResponse<Feed>(response, 'Announcements are unavailable.'))
        .then(value => {
          if (!signal.aborted) {
            setFeed(value);
            setLoadedLink(requestedId);
            setNow(Date.now());
          }
        })
        .catch(() => {
          if (!signal.aborted) setFeed(undefined);
        });
    };
    const timer = window.setTimeout(refresh, 0);
    const interval = window.setInterval(() => {
      if (!document.hidden) refresh();
    }, 30000);
    window.addEventListener(notificationEvent, refresh);
    window.addEventListener('focus', refresh);
    return () => {
      clearTimeout(timer);
      clearInterval(interval);
      request?.abort();
      window.removeEventListener(notificationEvent, refresh);
      window.removeEventListener('focus', refresh);
    };
  }, [requestedId]);
  const items = feed?.items.filter(item => Date.parse(item.endsAt) > now) ?? [];
  const person = feed?.person;
  const item = items.find(entry => entry.id === selection) ?? items[0];
  const open = items.find(entry => entry.id === dialog?.item);
  useEffect(() => {
    if (!requestedId) {
      handledLink.current = '';
      return;
    }
    if (!feed || loadedLink !== requestedId || handledLink.current === requestedId) return;
    handledLink.current = requestedId;
    const target = items.find(entry => entry.id === requestedId);
    setFeedback('');
    setResponseError(false);
    setDialog(
      target
        ? { item: target.id, form: target.definition.kind === 'FORM' && !target.answered }
        : undefined,
    );
  }, [requestedId, loadedLink, feed, now]);
  const dismissalKey = (entry: LiveAnnouncement) =>
    'announcement-popup:' + person?.employeeId + ':' + entry.id;
  useEffect(() => {
    const next = items.find(entry => {
      if (!entry.definition.popup || entry.answered || dismissed.has(entry.id)) return false;
      try {
        return localStorage.getItem(dismissalKey(entry)) !== 'seen';
      } catch {
        return true;
      }
    });
    if (!page && !dialog && !managing && next && !document.querySelector('dialog[open]'))
      setDialog({ item: next.id, form: false });
  }, [feed, now, dialog, dismissed, managing, page]);
  useEffect(() => {
    if (dialog && !open) setDialog(undefined);
    const ending = Math.min(...items.map(entry => Date.parse(entry.endsAt)));
    if (!Number.isFinite(ending)) return;
    const timeout = setTimeout(
      () => setNow(Date.now()),
      Math.max(1, Math.min(ending - Date.now(), 2147483647)),
    );
    return () => clearTimeout(timeout);
  }, [feed, now, dialog, open]);
  if (!feed || !person)
    return page ? (
      <section className="profile-panel">
        <p role="status">No announcements available. Refresh to check again.</p>
      </section>
    ) : null;
  const dismiss = (entry: LiveAnnouncement) => {
    setDismissed(current => new Set(current).add(entry.id));
    try {
      localStorage.setItem(dismissalKey(entry), 'seen');
    } catch {
      /* Retain in memory. */
    }
    setDialog(undefined);
    if (requestedId === entry.id) {
      const next = new URLSearchParams(searchParams);
      next.delete('announcement');
      setSearchParams(next, { replace: true });
    }
    setFeedback('');
  };
  const respond = async (entry: LiveAnnouncement, answers: Record<string, string | boolean>) => {
    if (responseLock.current) return;
    responseLock.current = true;
    setBusy(true);
    setFeedback('');
    setResponseError(false);
    try {
      await readApiResponse(
        await authenticatedFetch(endpoint + '/' + entry.id + '/respond', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ revision: entry.revision, answers }),
        }),
        'Response could not be saved.',
      );
      setFeed(
        current =>
          current && {
            ...current,
            items: current.items.map(item =>
              item.id === entry.id ? { ...item, answered: true } : item,
            ),
          },
      );
      setFeedback(entry.definition.kind === 'POLL' ? 'Vote recorded.' : 'Response submitted.');
      window.dispatchEvent(new Event('notifications-updated'));
    } catch (error) {
      setResponseError(true);
      setFeedback((error as Error).message);
    } finally {
      responseLock.current = false;
      setBusy(false);
    }
  };
  const action = (entry: LiveAnnouncement) =>
    entry.answered ? (
      <span>Response recorded</span>
    ) : entry.definition.kind === 'POLL' ? (
      <PollOptions
        options={entry.definition.options}
        disabled={busy}
        onVote={vote => void respond(entry, { vote })}
      />
    ) : (
      <button
        className="admin-primary"
        onClick={() => {
          setFeedback('');
          setDialog({ item: entry.id, form: true });
        }}
      >
        {entry.definition.cta}
      </button>
    );
  return (
    <>
      {page && (
        <section className="profile-panel announcement-page-heading">
          <h2>Announcements</h2>
          <p>Events, training, forms and polls for your current scope.</p>
          {feed.canPublish && (
            <button className="admin-primary" onClick={() => setManaging(true)}>
              Manage announcements
            </button>
          )}
          {requestedId &&
            loadedLink === requestedId &&
            !items.some(entry => entry.id === requestedId) && (
              <p role="status">
                This announcement has ended or is no longer available in your scope.
              </p>
            )}
          {items.length === 0 && <p>No active announcements for your scope.</p>}
        </section>
      )}
      {!page && item && (
        <section
          className="announcement-strip"
          aria-label="Announcements"
          style={item ? announcementStyle(item.definition) : undefined}
        >
          {items.length > 1 && (
            <select
              aria-label="Choose announcement"
              value={item.id}
              onChange={event => {
                setSelection(event.target.value);
                setFeedback('');
              }}
            >
              {items.map(entry => (
                <option key={entry.id} value={entry.id}>
                  {entry.definition.title}
                </option>
              ))}
            </select>
          )}
          {item && (
            <AnnouncementBannerContent
              key={item.id}
              definition={item.definition}
              image={item.hasImage ? endpoint + '/' + item.id + '/image' : undefined}
              action={action(item)}
            />
          )}
          {!open && feedback && <span role={responseError ? 'alert' : 'status'}>{feedback}</span>}
        </section>
      )}
      {page && (
        <div className="announcement-page-cards">
          {items.map(entry => (
            <AnnouncementCard
              key={entry.id}
              definition={entry.definition}
              image={entry.hasImage ? endpoint + '/' + entry.id + '/image' : undefined}
              action={action(entry)}
            />
          ))}
          {feedback && <p role={responseError ? 'alert' : 'status'}>{feedback}</p>}
        </div>
      )}
      {open && (
        <FormDialog
          title={open.definition.title}
          onClose={() => dismiss(open)}
          busy={busy}
          className="announcement-dialog"
        >
          <AnnouncementCard
            definition={open.definition}
            image={open.hasImage ? endpoint + '/' + open.id + '/image' : undefined}
            action={
              dialog?.form && !open.answered ? (
                <AnnouncementForm
                  definition={open.definition}
                  person={person}
                  busy={busy}
                  onSubmit={answers => void respond(open, answers)}
                />
              ) : (
                action(open)
              )
            }
          />
          {feedback && <p role={responseError ? 'alert' : 'status'}>{feedback}</p>}
        </FormDialog>
      )}
      {managing && !open && (
        <Suspense fallback={<p role="status">Loading announcement editor…</p>}>
          <AnnouncementManager
            onClose={() => {
              setManaging(false);
              refreshAnnouncements();
            }}
          />
        </Suspense>
      )}
    </>
  );
}
