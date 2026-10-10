import { WriteIntent } from '../write-intent';
import { useEffect, useState, useRef } from 'react';
import { useSearchParams } from 'react-router';
import { ArrowRight, Award, Plus, Search, Send } from 'lucide-react';
import { authenticatedFetch } from '../auth';
import { readApiResponse } from '../api-response';
import { FormDialog } from '../FormDialog';
import { toast } from '../toast';
import {
  certificationResponseFailure,
  currentCertificationResponse,
  canRespondToCertification,
} from './certification-response';
import '../recommendations.css';

type Recommendation = {
  id: string;
  revision: number;
  personId: string;
  personName: string;
  employeeCode: string;
  senderName: string;
  certificationName: string;
  provider: string;
  category: string;
  reason: string;
  credentialUrl: string;
  targetDate?: string;
  status: 'PENDING' | 'DISCUSSION' | 'ACCEPTED' | 'DECLINED';
  response: string;
  canRespond: boolean;
  updatedAt: string;
};
type Person = { id: string; name: string; employeeCode: string };
type Feed = {
  items: Recommendation[];
  total: number;
  page: number;
  pageSize: number;
  canSend: boolean;
};
const statusLabels = {
  PENDING: 'Awaiting response',
  DISCUSSION: 'Discussion requested',
  ACCEPTED: 'Accepted',
  DECLINED: 'Declined',
};

export function CertificationRecommendations({ sentOnly = false }: { sentOnly?: boolean }) {
  const [params, setParams] = useSearchParams();
  const sendIntent = useRef(new WriteIntent());
  const responseOperation = useRef<AbortController | undefined>(undefined);
  const [responseError, setResponseError] = useState('');
  const [responseRecheck, setResponseRecheck] = useState(false);
  const focused = params.get('recommendation') ?? '';
  const view = sentOnly || params.get('direction') === 'sent' ? 'sent' : 'received';
  const [loadedFeed, setFeed] = useState<{ key: string; value: Feed }>();
  const [recipientLoading, setRecipientLoading] = useState(true);
  const [people, setPeople] = useState<Person[]>([]);
  const [page, setPage] = useState(1),
    [attempt, setAttempt] = useState(0);
  const [loading, setLoading] = useState(true),
    [saving, setSaving] = useState(false),
    [error, setError] = useState('');
  const [search, setSearch] = useState(''),
    [recipientSearch, setRecipientSearch] = useState('');
  const [sending, setSending] = useState(false),
    [detail, setDetail] = useState<Recommendation>();
  const [name, setName] = useState(''),
    [provider, setProvider] = useState(''),
    [category, setCategory] = useState(''),
    [reason, setReason] = useState(''),
    [url, setUrl] = useState(''),
    [targetDate, setTargetDate] = useState(''),
    [personId, setPersonId] = useState(''),
    [message, setMessage] = useState('');

  const feedKey = JSON.stringify([view, page, search, attempt, focused]);
  const feed = loadedFeed?.key === feedKey ? loadedFeed.value : undefined;

  useEffect(() => {
    const c = new AbortController();
    if (responseOperation.current) {
      responseOperation.current.abort();
      setSaving(false);
    }
    responseOperation.current = undefined;
    setResponseError('');
    setResponseRecheck(false);
    setMessage('');
    setLoading(true);
    setFeed(undefined);
    setDetail(undefined);
    setError('');
    const query = new URLSearchParams({ view, page: String(focused ? 1 : page), search });
    if (focused) query.set('id', focused);
    authenticatedFetch('/api/certification-recommendations?' + query, { signal: c.signal })
      .then(r => readApiResponse<Feed>(r, 'Certification recommendations could not be loaded.'))
      .then(value => {
        if (!c.signal.aborted) setFeed({ key: feedKey, value });
      })
      .catch(e => {
        if (!c.signal.aborted) {
          setFeed(undefined);
          setDetail(undefined);
          setError(e.message);
        }
      })
      .finally(() => {
        if (!c.signal.aborted) setLoading(false);
      });
    return () => {
      c.abort();
      responseOperation.current?.abort();
    };
  }, [view, page, search, attempt, focused]);

  useEffect(() => {
    if (!sending) return;
    setRecipientLoading(true);
    setPeople([]);
    setPersonId('');
    const c = new AbortController();
    authenticatedFetch(
      '/api/certification-recommendations/people?search=' + encodeURIComponent(recipientSearch),
      { signal: c.signal },
    )
      .then(r =>
        readApiResponse<{ people: Person[] }>(r, 'Current direct reports could not be loaded.'),
      )
      .then(value => {
        if (!c.signal.aborted) {
          setPeople(value.people);
        }
      })
      .catch(e => {
        if (!c.signal.aborted) {
          setPeople([]);
          setPersonId('');
          setError(e.message);
        }
      })
      .finally(() => {
        if (!c.signal.aborted) setRecipientLoading(false);
      });
    return () => c.abort();
  }, [sending, recipientSearch]);
  useEffect(() => {
    if (focused && !loading && feed?.items.length === 1) setDetail(feed.items[0]);
  }, [focused, loading, feed]);

  const closeFocus = (direction: 'sent' | 'received' = view) => {
    const next = new URLSearchParams(params);
    next.delete('recommendation');
    if (direction === 'sent') next.set('direction', 'sent');
    else next.delete('direction');
    setParams(next, { replace: true });
    setDetail(undefined);
    setPage(1);
  };
  const closeResponse = () => {
    if (saving || responseOperation.current) return;
    setResponseError('');
    setResponseRecheck(false);
    setMessage('');
    if (focused) closeFocus();
    else setDetail(undefined);
    setAttempt(n => n + 1);
  };
  const responseFailed = (e: unknown, rechecking = false) => {
    const failure = certificationResponseFailure(e);
    if (failure.clear) {
      setFeed(undefined);
      setDetail(undefined);
      setMessage('');
      setError(failure.message);
    } else {
      setResponseError(failure.message);
      setResponseRecheck(failure.recheck || rechecking);
    }
  };
  const recheckResponse = async () => {
    if (!detail || !feed || loading || saving || responseOperation.current) return;
    const c = new AbortController();
    responseOperation.current = c;
    setSaving(true);
    try {
      const query = new URLSearchParams({ view, id: detail.id });
      const current = await readApiResponse<Feed>(
        await authenticatedFetch('/api/certification-recommendations?' + query, {
          signal: c.signal,
        }),
        'Current recommendation status could not be loaded.',
      );
      if (c.signal.aborted) return;
      const record = currentCertificationResponse(current.items, detail.id);
      setFeed({
        key: feedKey,
        value: {
          ...feed,
          canSend: current.canSend,
          items: feed.items.map(item => (item.id === record.id ? record : item)),
        },
      });
      setDetail(record);
      setResponseError('');
      setResponseRecheck(false);
    } catch (e) {
      if (!c.signal.aborted) responseFailed(e, true);
    } finally {
      if (responseOperation.current === c) {
        responseOperation.current = undefined;
        setSaving(false);
      }
    }
  };
  const saveResponse = async (action: 'ACCEPT' | 'DECLINE' | 'DISCUSS') => {
    if (
      !detail ||
      !feed ||
      loading ||
      !canRespondToCertification(detail) ||
      saving ||
      responseRecheck ||
      responseOperation.current
    )
      return;
    const c = new AbortController();
    responseOperation.current = c;
    setSaving(true);
    setResponseError('');
    try {
      await readApiResponse(
        await authenticatedFetch('/api/certification-recommendations/respond', {
          method: 'POST',
          signal: c.signal,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: detail.id, revision: detail.revision, action, message }),
        }),
        'Your response could not be saved.',
      );
      if (c.signal.aborted) return;
      toast.success(
        action === 'ACCEPT'
          ? 'Recommendation accepted.'
          : action === 'DECLINE'
            ? 'Recommendation declined.'
            : 'Discussion request sent.',
      );
      if (focused) closeFocus();
      else setDetail(undefined);
      setMessage('');
      setAttempt(n => n + 1);
      window.dispatchEvent(new Event('notifications-updated'));
    } catch (e) {
      if (!c.signal.aborted) responseFailed(e);
    } finally {
      if (responseOperation.current === c) {
        responseOperation.current = undefined;
        setSaving(false);
      }
    }
  };
  const send = async () => {
    if (
      recipientLoading ||
      !people.some(person => person.id === personId) ||
      !personId ||
      !name.trim() ||
      !reason.trim() ||
      saving
    )
      return;
    const payload = {
      personId,
      certificationName: name.trim(),
      provider: provider.trim(),
      category: category.trim(),
      reason: reason.trim(),
      credentialUrl: url.trim(),
      ...(targetDate ? { targetDate } : {}),
    };
    const id = sendIntent.current.begin(payload);
    if (!id) return;
    let saved = false;
    setSaving(true);
    setError('');
    try {
      await readApiResponse(
        await authenticatedFetch('/api/certification-recommendations/send', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id, ...payload }),
        }),
        'The recommendation could not be sent.',
      );
      saved = true;
      toast.success('Certification recommendation sent.');
      setSending(false);
      setName('');
      setProvider('');
      setCategory('');
      setReason('');
      setUrl('');
      setTargetDate('');
      setPersonId('');
      closeFocus('sent');
      setPage(1);
      setAttempt(n => n + 1);
      window.dispatchEvent(new Event('notifications-updated'));
    } catch (e) {
      const status = (e as { status?: number })?.status;
      setError(
        !status || status >= 500
          ? 'Send status could not be confirmed. Retry unchanged details or check Sent recommendations.'
          : e instanceof Error
            ? e.message
            : 'The recommendation could not be sent.',
      );
    } finally {
      sendIntent.current.finish(saved);
      setSaving(false);
    }
  };

  return (
    <section className="recommendation-workspace" aria-label="Certification recommendations">
      <header>
        <div>
          <h3>
            {view === 'sent' ? 'Certification recommendations sent' : 'Recommended certifications'}
          </h3>
          <p>
            {view === 'sent'
              ? 'Suggest a credential to a current direct report and explain why it may help.'
              : 'Review credential suggestions from your current manager. Your certification record changes only when you add and submit a credential.'}
          </p>
        </div>
        {view === 'sent' && feed?.canSend && (
          <button
            className="admin-primary"
            onClick={() => {
              setPersonId('');
              setPeople([]);
              setRecipientLoading(true);
              setSending(true);
            }}
          >
            <Plus size={17} /> Recommend a certification
          </button>
        )}
      </header>
      {!sentOnly && feed?.canSend && (
        <nav className="recommendation-tabs" aria-label="Recommendation direction">
          <button
            className="secondary-button"
            aria-pressed={view === 'received'}
            onClick={() => {
              closeFocus('received');
            }}
          >
            Received
          </button>
          <button
            className="secondary-button"
            aria-pressed={view === 'sent'}
            onClick={() => {
              closeFocus('sent');
            }}
          >
            Sent
          </button>
        </nav>
      )}
      {error && (
        <p role="alert">
          {error}{' '}
          <button className="secondary-button" onClick={() => setAttempt(n => n + 1)}>
            Retry
          </button>
        </p>
      )}
      {loading && <p role="status">Loading authorized recommendations…</p>}
      {!loading && feed && !feed.items.length && (
        <div className="recommendation-empty">
          <Award size={30} />
          <h3>
            {focused
              ? 'This recommendation is unavailable'
              : 'No certification recommendations yet'}
          </h3>
          <p>
            {view === 'sent'
              ? 'Recommend a credential and include a clear reason and next step.'
              : 'Recommendations from your current manager will appear here.'}
          </p>
          {view === 'sent' && feed.canSend && (
            <button
              className="admin-primary"
              onClick={() => {
                setPersonId('');
                setPeople([]);
                setRecipientLoading(true);
                setSending(true);
              }}
            >
              Recommend a certification
            </button>
          )}
        </div>
      )}
      <div className="recommendation-list">
        {feed?.items.map(item => (
          <article className="recommendation-card" key={item.id}>
            <div className="recommendation-card-icon">
              <Award size={23} />
            </div>
            <div className="recommendation-card-copy">
              <span className="recommendation-category">{item.category || 'Certification'}</span>
              <h4>{item.certificationName}</h4>
              <p>
                {view === 'sent'
                  ? `For ${item.personName} · ${item.employeeCode}`
                  : `From ${item.senderName}`}
                {item.provider ? ` · ${item.provider}` : ''}
              </p>
              <p className="recommendation-reason">{item.reason}</p>
              {item.credentialUrl && (
                <a href={item.credentialUrl} target="_blank" rel="noopener noreferrer">
                  View credential information <ArrowRight size={14} />
                </a>
              )}
              <small>
                {item.targetDate ? `Suggested target: ${item.targetDate} · ` : ''}Updated{' '}
                {new Date(item.updatedAt).toLocaleDateString()}
              </small>
              {item.response && <p className="recommendation-reason">Response: {item.response}</p>}
            </div>
            <div className="recommendation-card-end">
              <span className={'recommendation-status ' + item.status.toLowerCase()}>
                {statusLabels[item.status]}
              </span>
              <button className="secondary-button" onClick={() => setDetail(item)}>
                {canRespondToCertification(item) ? 'Respond' : 'View details'}
              </button>
            </div>
          </article>
        ))}
      </div>
      {feed && feed.total > 0 && (
        <footer className="recommendation-actions">
          <span>
            {(page - 1) * feed.pageSize + 1}–{Math.min(page * feed.pageSize, feed.total)} of{' '}
            {feed.total}
          </span>
          <button
            className="secondary-button"
            disabled={page === 1}
            onClick={() => setPage(n => n - 1)}
          >
            Previous
          </button>
          <button
            className="secondary-button"
            disabled={page * feed.pageSize >= feed.total}
            onClick={() => setPage(n => n + 1)}
          >
            Next
          </button>
        </footer>
      )}
      {sending && (
        <FormDialog
          title="Recommend a certification"
          busy={saving}
          onClose={() => {
            if (!saving) setSending(false);
          }}
          footer={
            <>
              <button
                className="secondary-button"
                disabled={saving}
                onClick={() => setSending(false)}
              >
                Cancel
              </button>
              <button
                className="admin-primary"
                disabled={saving || recipientLoading || !personId || !name.trim() || !reason.trim()}
                onClick={() => void send()}
              >
                <Send size={16} /> Send recommendation
              </button>
            </>
          }
        >
          <fieldset
            disabled={saving}
            className="cert-recommend-form"
            style={{ border: 0, padding: 0, margin: 0 }}
          >
            <label>
              <span>
                <Search size={14} /> Find direct report
              </span>
              <input
                value={recipientSearch}
                onChange={event => {
                  setRecipientSearch(event.target.value);
                  setPersonId('');
                  setPeople([]);
                  setRecipientLoading(true);
                }}
                placeholder="Search name or employee code"
              />
            </label>
            <label>
              Direct report
              <select
                disabled={recipientLoading}
                value={personId}
                onChange={event => setPersonId(event.target.value)}
              >
                <option value="">
                  {recipientLoading ? 'Loading direct reports...' : 'Select a direct report'}
                </option>
                {people.map(person => (
                  <option key={person.id} value={person.id}>
                    {person.name} · {person.employeeCode}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Certification name *
              <input
                required
                maxLength={200}
                value={name}
                onChange={event => setName(event.target.value)}
                placeholder="e.g. Azure Administrator Associate"
              />
            </label>
            <div className="cert-recommend-fields">
              <label>
                Issuer
                <input
                  maxLength={120}
                  value={provider}
                  onChange={event => setProvider(event.target.value)}
                  placeholder="Optional"
                />
              </label>
              <label>
                Category
                <input
                  maxLength={80}
                  value={category}
                  onChange={event => setCategory(event.target.value)}
                  placeholder="Optional"
                />
              </label>
            </div>
            <label>
              Why are you recommending it? *
              <textarea
                required
                maxLength={2000}
                rows={4}
                value={reason}
                onChange={event => setReason(event.target.value)}
              />
            </label>
            <div className="cert-recommend-fields">
              <label>
                Credential information link
                <input
                  type="url"
                  maxLength={1000}
                  value={url}
                  onChange={event => setUrl(event.target.value)}
                  placeholder="https://…"
                />
              </label>
              <label>
                Suggested target date
                <input
                  type="date"
                  value={targetDate}
                  onChange={event => setTargetDate(event.target.value)}
                />
              </label>
            </div>
            <p>
              This recommendation does not create or verify a certification record. The employee can
              respond and add the credential separately.
            </p>
          </fieldset>
        </FormDialog>
      )}
      {detail && feed && !loading && (
        <FormDialog
          title={detail.certificationName}
          subtitle={detail.provider || 'Certification recommendation'}
          busy={saving}
          onClose={closeResponse}
          footer={
            canRespondToCertification(detail) ? (
              <>
                <button
                  className="secondary-button"
                  disabled={saving || responseRecheck}
                  onClick={() => void saveResponse('DECLINE')}
                >
                  Decline
                </button>
                <button
                  className="secondary-button"
                  disabled={saving || responseRecheck || !message.trim()}
                  onClick={() => void saveResponse('DISCUSS')}
                >
                  Ask to discuss
                </button>
                <button
                  className="admin-primary"
                  disabled={saving || responseRecheck}
                  onClick={() => void saveResponse('ACCEPT')}
                >
                  Accept recommendation
                </button>
              </>
            ) : (
              <button className="secondary-button" onClick={closeResponse}>
                Close
              </button>
            )
          }
        >
          {responseError && (
            <p role="alert">
              {responseError}{' '}
              {responseRecheck && (
                <button
                  className="secondary-button"
                  disabled={saving}
                  onClick={() => void recheckResponse()}
                >
                  Check current status
                </button>
              )}
            </p>
          )}
          <p>Status: {statusLabels[detail.status]}</p>
          <p>{detail.reason}</p>
          {detail.credentialUrl && (
            <p>
              <a href={detail.credentialUrl} target="_blank" rel="noopener noreferrer">
                Open credential information
              </a>
            </p>
          )}
          {detail.targetDate && <p>Suggested target: {detail.targetDate}</p>}
          {canRespondToCertification(detail) && (
            <label>
              Your response
              <textarea
                maxLength={2000}
                rows={3}
                disabled={saving}
                value={message}
                onChange={event => setMessage(event.target.value)}
                placeholder="Optional note; required when asking to discuss"
              />
            </label>
          )}
          {!canRespondToCertification(detail) && detail.response && (
            <p>Employee response: {detail.response}</p>
          )}
        </FormDialog>
      )}
    </section>
  );
}
