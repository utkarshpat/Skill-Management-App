import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { useLocation, useSearchParams } from 'react-router';
import { authenticatedFetch } from './auth';
import { readApiResponse } from './api-response';
import { startActivityRefresh } from './activity-refresh';
import { FormDialog } from './FormDialog';
import { notify } from './toast';
import { Megaphone, MessageSquare, RefreshCw } from 'lucide-react';
import { endpoint, type LiveAnnouncement, type Person } from './announcement-model';
import {
  announcementStyle,
  AnnouncementBannerContent,
  AnnouncementCard,
  AnnouncementForm,
  AnnouncementPoster,
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
function refreshAnnouncements() {
  window.dispatchEvent(new Event(notificationEvent));
}

export function Announcements({
  page = false,
  onPublishAccess,
}: {
  page?: boolean;
  onPublishAccess?: (allowed: boolean) => void;
}) {
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();
  const ticket = page ? location.state?.announcementDraftTicket : undefined;
  const draftTicket = typeof ticket === 'string' ? ticket : undefined;
  const requestedId = page ? (searchParams.get('announcement') ?? '') : '';
  const [loadedLink, setLoadedLink] = useState<string>();
  const handledLink = useRef('');
  const [feed, setFeed] = useState<Feed>();
  const [dialog, setDialog] = useState<{
    item: string;
    form: boolean;
    editing?: boolean;
    responseRevision?: number;
    retryAnswers?: Record<string, string | boolean>;
    refreshedAfterConflict?: boolean;
  }>();
  const conflictTarget = dialog?.retryAnswers ? dialog.item : undefined;
  const [view, setView] = useState<'announcements' | 'responses'>('announcements');
  const [feedError, setFeedError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [feedPage, setFeedPage] = useState(1);
  const requestedPage = page ? feedPage : 1;
  const [feedLoading, setFeedLoading] = useState(false);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [hiddenBanners, setHiddenBanners] = useState<Set<string>>(new Set());
  const [now, setNow] = useState(Date.now());
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [responseError, setResponseError] = useState(false);
  const responseLock = useRef(false);
  useEffect(() => {
    if (!confirmation || dialog) return;
    notify(confirmation, 'success');
    setConfirmation('');
  }, [confirmation, dialog]);
  useEffect(() => {
    let request: AbortController | undefined;
    const refresh = async () => {
      request?.abort();
      request = new AbortController();
      const signal = request.signal;
      setFeedLoading(true);
      const query = new URLSearchParams();
      const target = conflictTarget ?? requestedId;
      if (target) query.set('announcement', target);
      else {
        query.set('pending', '1');
        if (requestedPage > 1) query.set('page', String(requestedPage));
      }
      return authenticatedFetch(endpoint + '/feed' + (query.size ? '?' + query : ''), { signal })
        .then(response => readApiResponse<Feed>(response, 'Announcements are unavailable.'))
        .then(value => {
          if (!signal.aborted) {
            setFeed(value);
            onPublishAccess?.(value.canPublish === true);
            setFeedError('');
            setLoadedLink(requestedId);
            setNow(Date.now());
            if (conflictTarget)
              setDialog(current =>
                current?.item === conflictTarget && current.retryAnswers
                  ? { ...current, refreshedAfterConflict: true }
                  : current,
              );
          }
        })
        .catch(error => {
          if (!signal.aborted) {
            setFeedError(error.message);
            if (error.status === 401 || error.status === 403) {
              onPublishAccess?.(false);
              setFeed(undefined);
              setDialog(undefined);
            }
          }
          return false;
        })
        .finally(() => {
          if (!signal.aborted) setFeedLoading(false);
        });
    };
    const stop = startActivityRefresh(
      refresh,
      [notificationEvent, 'workspace-access-updated'],
      undefined,
      { pollMs: 60_000 },
    );
    return () => {
      stop();
      request?.abort();
    };
  }, [requestedId, conflictTarget, attempt, requestedPage, onPublishAccess]);
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
  const showPoster =
    open?.definition.imagePopup && open.hasImage && !dialog?.form && !open.answered;
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
        ? {
            item: target.id,
            form:
              target.definition.kind === 'FORM' &&
              !target.answered &&
              !target.definition.imagePopup,
          }
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
    if (
      responseLock.current ||
      (conflictTarget === entry.id && (!dialog?.refreshedAfterConflict || feedLoading))
    )
      return;
    responseLock.current = true;
    setBusy(true);
    setFeedback('');
    setResponseError(false);
    try {
      const responseRevision =
        dialog?.item === entry.id && dialog.editing ? (dialog.responseRevision ?? 0) : 0;
      const result = await readApiResponse<{ responseRevision?: number }>(
        await authenticatedFetch(endpoint + '/' + entry.id + '/respond', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ revision: entry.revision, responseRevision, answers }),
        }),
        'Response could not be saved.',
      );
      setFeed(
        current =>
          current && {
            ...current,
            items: current.items.map(item =>
              item.id === entry.id
                ? {
                    ...item,
                    answered: true,
                    responseRevision: result.responseRevision ?? responseRevision + 1,
                    savedAnswers: answers,
                  }
                : item,
            ),
          },
      );
      dismiss(entry);
      setConfirmation(
        entry.answered
          ? 'Response updated.'
          : entry.definition.kind === 'POLL'
            ? 'Vote recorded.'
            : 'Response submitted.',
      );
      window.dispatchEvent(new Event(notificationEvent));
      window.dispatchEvent(new Event('notifications-updated'));
    } catch (error) {
      setResponseError(true);
      setFeedback((error as Error).message);
      if ((error as { status?: number }).status === 409) {
        setDialog({ item: entry.id, form: true, retryAnswers: answers });
        setAttempt(attempt => attempt + 1);
      }
    } finally {
      responseLock.current = false;
      setBusy(false);
    }
  };
  const action = (entry: LiveAnnouncement, startWithPoster = false) =>
    entry.answered ? (
      <span>Response recorded</span>
    ) : entry.definition.kind === 'POLL' && !startWithPoster ? (
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
          setDialog({ item: entry.id, form: !startWithPoster });
        }}
      >
        {entry.definition.kind === 'POLL' ? 'Open poll' : entry.definition.cta}
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
              definition={
                entry.definition.imagePopup
                  ? { ...entry.definition, design: undefined }
                  : entry.definition
              }
              person={person}
              busy={busy}
              answered={entry.answered}
              onSubmit={answers => void respond(entry, answers)}
              onVote={vote => void respond(entry, { vote })}
              onOpen={() => setDialog({ item: entry.id, form: true })}
              image={
                entry.hasImage && !entry.definition.imagePopup
                  ? endpoint + '/' + entry.id + '/image'
                  : undefined
              }
              action={action(entry, entry.hasImage && entry.definition.imagePopup === true)}
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
                draftTicket={draftTicket}
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
            <>
              {draftTicket && (
                <p role="status">Your current access does not allow creating announcements.</p>
              )}
              {cards}
            </>
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
            action={
              <button
                type="button"
                className="admin-primary"
                onClick={() => {
                  setFeedback('');
                  setDialog({
                    item: item.id,
                    form: item.definition.kind === 'FORM' && !item.definition.imagePopup,
                  });
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
          {showPoster ? (
            <AnnouncementPoster
              definition={open.definition}
              image={endpoint + '/' + open.id + '/image'}
              onOpen={() => setDialog({ item: open.id, form: true })}
            />
          ) : (
            <AnnouncementCard
              key={open.id}
              definition={
                open.answered || dialog?.retryAnswers
                  ? { ...open.definition, design: undefined }
                  : open.definition
              }
              person={person}
              busy={busy}
              answered={open.answered}
              onSubmit={answers => void respond(open, answers)}
              onVote={vote => void respond(open, { vote })}
              onOpen={() => setDialog({ item: open.id, form: true })}
              image={
                open.hasImage && !open.definition.imagePopup
                  ? endpoint + '/' + open.id + '/image'
                  : undefined
              }
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
                        disabled={
                          feedLoading ||
                          Boolean(dialog?.retryAnswers && !dialog.refreshedAfterConflict)
                        }
                        onClick={() =>
                          setDialog({
                            item: open.id,
                            form: true,
                            editing: true,
                            responseRevision: open.responseRevision,
                            retryAnswers: dialog?.retryAnswers,
                            refreshedAfterConflict: dialog?.refreshedAfterConflict,
                          })
                        }
                      >
                        {dialog?.retryAnswers ? 'Edit using my unsaved response' : 'Edit response'}
                      </button>
                    )}
                  </div>
                ) : open.definition.kind === 'POLL' ? (
                  <PollOptions
                    options={open.definition.options}
                    disabled={
                      busy ||
                      Boolean(
                        dialog?.retryAnswers && (feedLoading || !dialog.refreshedAfterConflict),
                      )
                    }
                    selectedVote={open.savedAnswers?.vote}
                    onVote={vote => void respond(open, { vote })}
                  />
                ) : dialog?.form ? (
                  <AnnouncementForm
                    key={open.id}
                    definition={open.definition}
                    person={person}
                    busy={busy}
                    submitDisabled={Boolean(
                      dialog.retryAnswers && (feedLoading || !dialog.refreshedAfterConflict),
                    )}
                    editing={Boolean(dialog.editing)}
                    initialAnswers={
                      dialog.retryAnswers ?? (open.answered ? (open.savedAnswers ?? {}) : undefined)
                    }
                    onSubmit={answers => void respond(open, answers)}
                  />
                ) : (
                  action(open)
                )
              }
            />
          )}
          {feedback && <p role={responseError ? 'alert' : 'status'}>{feedback}</p>}
          {dialog?.retryAnswers && !dialog.refreshedAfterConflict && feedError && (
            <button
              type="button"
              className="secondary-button"
              disabled={feedLoading}
              onClick={() => setAttempt(value => value + 1)}
            >
              Refresh announcement
            </button>
          )}
        </FormDialog>
      )}
    </>
  );
}
