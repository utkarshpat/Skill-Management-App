import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { authenticatedFetch } from './auth';
import { readApiResponse } from './api-response';
import { FormDialog } from './FormDialog';
import { notify } from './toast';
import { Megaphone, MessageSquare, RefreshCw } from 'lucide-react';
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
  page?: number;
  hasMore?: boolean;
  total?: number;
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
  const [dialog, setDialog] = useState<{ item: string; form: boolean; editing?: boolean }>();
  const [view, setView] = useState<'announcements' | 'responses'>('announcements');
  const [feedError, setFeedError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [feedPage, setFeedPage] = useState(1);
  const [feedLoading, setFeedLoading] = useState(false);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [hiddenBanners, setHiddenBanners] = useState<Set<string>>(new Set());
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
      setFeedLoading(true);
      const query = new URLSearchParams();
      if (feedPage > 1 && !requestedId) query.set('page', String(feedPage));
      if (requestedId) query.set('announcement', requestedId);
      else query.set('pending', '1');
      authenticatedFetch(endpoint + '/feed' + (query.size ? '?' + query : ''), { signal })
        .then(response => readApiResponse<Feed>(response, 'Announcements are unavailable.'))
        .then(value => {
          if (!signal.aborted) {
            setFeed(value);
            setFeedError('');
            setLoadedLink(requestedId);
            setNow(Date.now());
          }
        })
        .catch(error => {
          if (!signal.aborted) {
            setFeedError(error.message);
            if (error.status === 401 || error.status === 403) {
              setFeed(undefined);
              setDialog(undefined);
            }
          }
        })
        .finally(() => {
          if (!signal.aborted) setFeedLoading(false);
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
  }, [requestedId, attempt, feedPage]);
  const items = feed?.items.filter(item => Date.parse(item.endsAt) > now) ?? [];
  const person = feed?.person;
  const bannerKey = (entry: LiveAnnouncement) =>
    'announcement-banner:' + person?.employeeId + ':' + entry.id;
  const item = items.find(entry => {
    if (entry.answered || hiddenBanners.has(bannerKey(entry))) return false;
    try {
      return localStorage.getItem(bannerKey(entry)) !== 'hidden';
    } catch {
      return true;
    }
  });
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
    if (!page && !dialog && next && !document.querySelector('dialog[open]'))
      setDialog({ item: next.id, form: false });
  }, [feed, now, dialog, dismissed, page]);
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
      <section className="announcement-workspace" aria-label="Announcements">
        <h2>Announcements</h2>
        {feedError ? (
          <div className="announcement-feedback" role="alert">
            <p>{feedError}</p>
            <button className="secondary-button" onClick={() => setAttempt(value => value + 1)}>
              <RefreshCw size={16} aria-hidden="true" /> Retry
            </button>
          </div>
        ) : (
          <p role="status">Loading announcements…</p>
        )}
      </section>
    ) : null;
  const hideBanner = (entry: LiveAnnouncement) => {
    const key = bannerKey(entry);
    setHiddenBanners(current => new Set(current).add(key));
    try {
      localStorage.setItem(key, 'hidden');
    } catch {
      // Keep the dismissal for this visit when storage is unavailable.
    }
  };
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
              item.id === entry.id ? { ...item, answered: true, savedAnswers: answers } : item,
            ),
          },
      );
      dismiss(entry);
      notify(
        entry.answered
          ? 'Response updated.'
          : entry.definition.kind === 'POLL'
            ? 'Vote recorded.'
            : 'Response submitted.',
        'success',
      );
      window.dispatchEvent(new Event(notificationEvent));
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
  const pendingItems = items.filter(entry => !entry.answered);
  const cards = (
    <>
      {pendingItems.length > 0 ? (
        <div className="announcement-page-cards">
          {pendingItems.map(entry => (
            <AnnouncementCard
              key={entry.id}
              definition={entry.definition}
              person={person}
              busy={busy}
              answered={entry.answered}
              onSubmit={answers => void respond(entry, answers)}
              onVote={vote => void respond(entry, { vote })}
              onOpen={() => setDialog({ item: entry.id, form: true })}
              image={entry.hasImage ? endpoint + '/' + entry.id + '/image' : undefined}
              action={action(entry)}
            />
          ))}
        </div>
      ) : (
        <div className="announcement-empty">
          <Megaphone size={28} strokeWidth={1.5} aria-hidden="true" />
          <h3>No active announcements</h3>
          <p>Events, training and polls for you will appear here.</p>
        </div>
      )}
      {(feedPage > 1 || feed.hasMore) && !requestedId && (
        <div
          role="group"
          aria-label="Active announcement pages"
          className="announcement-editor-actions"
        >
          <button
            className="secondary-button"
            disabled={feedLoading || feedPage === 1}
            onClick={() => {
              setFeed(undefined);
              setFeedPage(p => p - 1);
            }}
          >
            Previous announcements
          </button>
          <span>Page {feed.page ?? feedPage}</span>
          <button
            className="secondary-button"
            disabled={feedLoading || !feed.hasMore}
            onClick={() => {
              setFeed(undefined);
              setFeedPage(p => p + 1);
            }}
          >
            More announcements
          </button>
        </div>
      )}
      {feedback && <p role={responseError ? 'alert' : 'status'}>{feedback}</p>}
    </>
  );
  return (
    <>
      {page && (
        <section className="announcement-workspace" aria-label="Announcements">
          <header className="announcement-page-heading">
            <h2>Announcements</h2>
            <p>What's happening, all in one place.</p>
          </header>
          {feed.canPublish && (
            <div className="announcement-tabs" role="tablist" aria-label="Announcements workspace">
              {(['announcements', 'responses'] as const).map(tab => {
                const Icon = tab === 'announcements' ? Megaphone : MessageSquare;
                return (
                  <button
                    key={tab}
                    id={'announcement-tab-' + tab}
                    type="button"
                    role="tab"
                    aria-selected={view === tab}
                    aria-controls={'announcement-panel-' + tab}
                    tabIndex={view === tab ? 0 : -1}
                    onClick={() => setView(tab)}
                    onKeyDown={event => {
                      if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
                        event.preventDefault();
                        const next =
                          event.key === 'Home'
                            ? 'announcements'
                            : event.key === 'End'
                              ? 'responses'
                              : view === 'announcements'
                                ? 'responses'
                                : 'announcements';
                        setView(next);
                        document.getElementById('announcement-tab-' + next)?.focus();
                      }
                    }}
                  >
                    <Icon size={18} aria-hidden="true" />
                    {tab === 'announcements' ? 'Announcements' : 'Responses'}
                  </button>
                );
              })}
            </div>
          )}
          {feedError && (
            <div className="announcement-feedback" role="alert">
              <p>{feedError}</p>
              <button className="secondary-button" onClick={() => setAttempt(value => value + 1)}>
                Retry
              </button>
            </div>
          )}
          {requestedId &&
            loadedLink === requestedId &&
            !items.some(entry => entry.id === requestedId) && (
              <p role="status">
                This announcement has ended or is no longer available in your scope.
              </p>
            )}
          {feed.canPublish ? (
            <Suspense fallback={<p role="status">Loading your announcements…</p>}>
              <AnnouncementManager
                view={view}
                onViewChange={setView}
                onUpdated={refreshAnnouncements}
              >
                {(pendingItems.length > 0 || feedPage > 1 || feed.hasMore) && (
                  <section className="announcement-for-you" aria-label="For you">
                    <h3>For you</h3>
                    {cards}
                  </section>
                )}
              </AnnouncementManager>
            </Suspense>
          ) : (
            cards
          )}
        </section>
      )}
      {!page && item && (
        <section
          className="announcement-strip"
          aria-label="Announcements"
          style={item ? announcementStyle(item.definition) : undefined}
        >
          <AnnouncementBannerContent
            key={item.id}
            definition={item.definition}
            onDismiss={() => hideBanner(item)}
            image={item.hasImage ? endpoint + '/' + item.id + '/image' : undefined}
            action={
              <button
                type="button"
                className="admin-primary"
                onClick={() => {
                  setFeedback('');
                  setDialog({ item: item.id, form: item.definition.kind === 'FORM' });
                }}
              >
                {item.definition.kind === 'POLL' ? 'Open poll' : item.definition.cta}
              </button>
            }
          />
        </section>
      )}
      {open && (
        <FormDialog
          title={open.definition.title}
          onClose={() => dismiss(open)}
          busy={busy}
          className="announcement-dialog"
          compact
        >
          <AnnouncementCard
            key={open.id}
            definition={open.answered ? { ...open.definition, design: undefined } : open.definition}
            person={person}
            busy={busy}
            answered={open.answered}
            onSubmit={answers => void respond(open, answers)}
            onVote={vote => void respond(open, { vote })}
            onOpen={() => setDialog({ item: open.id, form: true })}
            image={open.hasImage ? endpoint + '/' + open.id + '/image' : undefined}
            action={
              open.answered && !dialog?.editing ? (
                <div className="announcement-saved-response">
                  <strong>Response recorded</strong>
                  {open.savedAnswers && (
                    <dl>
                      {(open.definition.kind === 'POLL'
                        ? [{ id: 'vote', label: 'Your vote' }]
                        : open.definition.fields
                      ).map(field => {
                        const value = open.savedAnswers?.[field.id];
                        return (
                          <div key={field.id}>
                            <dt>{field.label}</dt>
                            <dd>
                              {typeof value === 'boolean' ? (value ? 'Yes' : 'No') : value || '—'}
                            </dd>
                          </div>
                        );
                      })}
                    </dl>
                  )}
                  {open.definition.allowResponseUpdates && (
                    <button
                      type="button"
                      className="admin-primary"
                      onClick={() => setDialog({ item: open.id, form: true, editing: true })}
                    >
                      Edit response
                    </button>
                  )}
                </div>
              ) : open.answered && open.definition.kind === 'POLL' ? (
                <PollOptions
                  options={open.definition.options}
                  disabled={busy}
                  selectedVote={open.savedAnswers?.vote}
                  onVote={vote => void respond(open, { vote })}
                />
              ) : dialog?.form ? (
                <AnnouncementForm
                  definition={open.definition}
                  person={person}
                  busy={busy}
                  initialAnswers={open.answered ? (open.savedAnswers ?? {}) : undefined}
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
    </>
  );
}
