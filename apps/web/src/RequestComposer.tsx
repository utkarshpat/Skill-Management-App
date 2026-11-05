import { useEffect, useState } from 'react';
import {
  BookOpen,
  Layers3,
  ClipboardCheck,
  BriefcaseBusiness,
  UserRound,
  MoreHorizontal,
  ArrowRight,
  Send,
  Search,
  CheckCircle2,
  ArrowLeft,
  LifeBuoy,
} from 'lucide-react';
import { FormDialog } from './FormDialog';
import { authenticatedFetch } from './auth';
import {
  requestCategories,
  categoryLabel,
  requestRead,
  type RequestCategory,
  type RequestKind,
  type RequestOptions,
} from './request-model';
const icons = [
  BookOpen,
  Layers3,
  ClipboardCheck,
  BriefcaseBusiness,
  UserRound,
  LifeBuoy,
  MoreHorizontal,
];
export function RequestComposer({
  options,
  onClose,
  onSaved,
  draft,
}: {
  options: RequestOptions;
  onClose: () => void;
  onSaved: (id: string) => void;
  draft?: { kind: RequestKind; title: string; description: string };
}) {
  const [page, setPage] = useState(0),
    [kind, setKind] = useState<RequestKind>(
      draft?.kind ?? (options.canRequest ? 'REQUEST' : 'INCIDENT'),
    ),
    [category, setCategory] = useState<RequestCategory>(),
    [title, setTitle] = useState(draft?.title ?? ''),
    [description, setDescription] = useState(draft?.description ?? ''),
    [priority, setPriority] = useState('NORMAL');
  const [resultPage, setResultPage] = useState(0),
    [query, setQuery] = useState(''),
    [recipients, setRecipients] = useState(options.recipients),
    [recipient, setRecipient] = useState<RequestOptions['recipients'][number]>(),
    [searching, setSearching] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [id] = useState(() => crypto.randomUUID());
  const [available, setAvailable] = useState(options);
  useEffect(() => {
    if (page !== 2 || !category) return;
    const c = new AbortController();
    setSearching(true);
    const timer = setTimeout(() => {
      authenticatedFetch(
        '/api/workflows/options?category=' + category + '&q=' + encodeURIComponent(query.trim()),
        {
          signal: c.signal,
        },
      )
        .then(requestRead<RequestOptions>)
        .then(o => {
          if (!c.signal.aborted) {
            setRecipients(o.recipients);
            setAvailable(o);
            setResultPage(0);
            setSearching(false);
            setError('');
          }
        })
        .catch(e => {
          if (!c.signal.aborted) {
            setRecipients([]);
            setRecipient(undefined);
            setSearching(false);
            setError(e.message);
          }
        });
    }, 250);
    return () => {
      clearTimeout(timer);
      c.abort();
    };
  }, [page, query, category, kind]);
  const matches = recipients.filter(r => r.kind === kind);
  const topics = requestCategories.filter(c =>
    available.categories?.some(a => a.code === c.code && a.kind === kind),
  );
  function validate(target: number) {
    if (target > 0 && (!category || !topics.some(c => c.code === category))) {
      setError('Choose what you need help with.');
      setPage(0);
      return false;
    }
    if (target > 1 && (!title.trim() || !description.trim())) {
      setError('Enter a subject and description.');
      setPage(1);
      return false;
    }
    if (target > 2 && (searching || !recipient)) {
      setError('Choose who should receive this.');
      setPage(2);
      return false;
    }
    setError('');
    return true;
  }
  async function submit() {
    if (busy || !validate(3) || !recipient) return;
    setBusy(true);
    try {
      await requestRead(
        await authenticatedFetch('/api/workflows', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'CREATE',
            id,
            kind,
            category,
            title,
            description,
            priority,
            recipientId: recipient.id,
          }),
        }),
      );
      onSaved(id);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not submit.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <FormDialog
      className="request-composer"
      title={kind === 'INCIDENT' ? 'New incident' : 'New request'}
      subtitle="Tell us what you need, choose a recipient and review before sending."
      busy={busy}
      onClose={onClose}
      page={page}
      onPageChange={next => {
        if (next <= page || validate(next)) setPage(next);
      }}
      stepNavigation
      message={error && <p role="alert">{error}</p>}
      pages={[
        {
          label: 'Topic',
          content: (
            <div className="request-topic-step">
              <div className="request-compose-heading">
                <h3>What can we help you with?</h3>
                <fieldset className="request-kind-switch" disabled={busy}>
                  <legend className="sr-only">Record type</legend>
                  {available.canRequest && (
                    <label>
                      <input
                        type="radio"
                        name="request-kind"
                        value="REQUEST"
                        checked={kind === 'REQUEST'}
                        onChange={() => {
                          setKind('REQUEST');
                          setCategory(undefined);
                          setQuery('');
                          setRecipient(undefined);
                          setResultPage(0);
                        }}
                      />
                      Request
                    </label>
                  )}
                  {available.canIncident && (
                    <label>
                      <input
                        type="radio"
                        name="request-kind"
                        value="INCIDENT"
                        checked={kind === 'INCIDENT'}
                        onChange={() => {
                          setKind('INCIDENT');
                          setCategory(undefined);
                          setQuery('');
                          setRecipient(undefined);
                          setResultPage(0);
                        }}
                      />
                      Incident
                    </label>
                  )}
                </fieldset>
              </div>
              <fieldset className="request-category-grid">
                <legend className="sr-only">Request category</legend>
                {topics.map(c => {
                  const Icon = icons[requestCategories.indexOf(c)];
                  return (
                    <label
                      key={c.code}
                      className={
                        'request-category-choice ' + (category === c.code ? 'selected' : '')
                      }
                    >
                      <input
                        type="radio"
                        name="request-category"
                        value={c.code}
                        checked={category === c.code}
                        onChange={() => {
                          setCategory(c.code);
                          setRecipient(undefined);
                          setQuery('');
                          setResultPage(0);
                        }}
                      />
                      <span className="request-category-icon">
                        <Icon size={24} />
                      </span>
                      <strong>{c.label}</strong>
                      <span>{c.description}</span>
                    </label>
                  );
                })}
              </fieldset>
              {!topics.length && (
                <p role="status">
                  No topics are available with your current access. Ask your administrator to check
                  your permissions.
                </p>
              )}
            </div>
          ),
        },
        {
          label: 'Details',
          content: (
            <div className="access-form request-details-step">
              <div className="request-selected-topic">
                <CheckCircle2 size={18} />
                {categoryLabel(category)} · {kind === 'REQUEST' ? 'Request' : 'Incident'}
                <button className="admin-text-button" onClick={() => setPage(0)}>
                  Change
                </button>
              </div>
              <label>
                Subject *
                <input
                  value={title}
                  maxLength={160}
                  onChange={e => setTitle(e.target.value)}
                  placeholder={
                    kind === 'REQUEST' ? 'What would you like help with?' : 'What is not working?'
                  }
                />
              </label>
              <label>
                Description *
                <textarea
                  rows={4}
                  value={description}
                  maxLength={2000}
                  onChange={e => setDescription(e.target.value)}
                  placeholder={
                    kind === 'REQUEST'
                      ? 'Describe what you need and why.'
                      : 'Describe the issue, its impact and any steps to reproduce.'
                  }
                />
              </label>
              <div className="request-description-meta">
                <label>
                  Priority
                  <select value={priority} onChange={e => setPriority(e.target.value)}>
                    <option value="NORMAL">Normal</option>
                    <option value="HIGH">High</option>
                  </select>
                </label>
                <small>{description.length}/2000</small>
              </div>
            </div>
          ),
        },
        {
          label: 'Recipient',
          content: (
            <div className="request-recipient-step">
              <h3>Who should receive this?</h3>
              <p>
                {category === 'PLATFORM'
                  ? 'Platform administrators are shown by default. Search by name to find another eligible recipient.'
                  : 'Your team and reporting line are shown by default. Search by name to find other eligible people.'}
              </p>
              <label className="request-recipient-search">
                <Search size={18} />
                <span className="sr-only">Search recipient by name</span>
                <input
                  type="search"
                  value={query}
                  maxLength={80}
                  placeholder="Search a person's name…"
                  onChange={e => {
                    setQuery(e.target.value);
                    setResultPage(0);
                    setSearching(true);
                  }}
                />
              </label>
              {searching ? (
                <p role="status">Searching people…</p>
              ) : !matches.length ? (
                <p role="status">
                  {query.trim()
                    ? 'No eligible people match this name. Try another name.'
                    : category === 'PLATFORM'
                      ? 'No eligible platform administrator is available. Search by name or ask your administrator to check access.'
                      : 'No eligible team or reporting-line recipients are available. Search by name to find someone else.'}
                </p>
              ) : (
                <>
                  <fieldset className="request-people-grid">
                    <legend className="sr-only">Choose a recipient</legend>
                    {matches.slice(resultPage * 4, resultPage * 4 + 4).map(r => (
                      <label
                        key={r.id}
                        className={
                          'request-person-choice ' + (recipient?.id === r.id ? 'selected' : '')
                        }
                      >
                        <input
                          type="radio"
                          name="request-recipient"
                          value={r.id}
                          checked={recipient?.id === r.id}
                          onChange={() => {
                            setRecipient(r);
                            setError('');
                          }}
                        />
                        <span className="request-recipient-avatar" aria-hidden="true">
                          {r.name
                            .trim()
                            .split(/\s+/)
                            .slice(0, 2)
                            .map(p => p[0] ?? '')
                            .join('')}
                        </span>
                        <span>
                          <strong>{r.name}</strong>
                          <small>
                            {r.systemAdmin && category === 'PLATFORM'
                              ? 'Platform administrator'
                              : r.reportingManager
                                ? 'Your reporting manager'
                                : r.sameTeam
                                  ? 'Your team'
                                  : r.reportingLine
                                    ? 'Your reporting line'
                                    : 'Workspace member'}
                          </small>
                        </span>
                      </label>
                    ))}
                  </fieldset>
                  <div className="request-people-pagination">
                    <small>
                      {matches.length} {matches.length === 1 ? 'person' : 'people'} found
                    </small>
                    {matches.length > 4 && (
                      <>
                        <button
                          className="secondary-button"
                          aria-label="Previous recipient results"
                          disabled={resultPage === 0}
                          onClick={() => setResultPage(n => n - 1)}
                        >
                          <ArrowLeft size={15} />
                        </button>
                        <span>
                          {resultPage + 1} / {Math.ceil(matches.length / 4)}
                        </span>
                        <button
                          className="secondary-button"
                          aria-label="Next recipient results"
                          disabled={(resultPage + 1) * 4 >= matches.length}
                          onClick={() => setResultPage(n => n + 1)}
                        >
                          <ArrowRight size={15} />
                        </button>
                      </>
                    )}
                  </div>
                </>
              )}
              {recipient && (
                <p className="request-recipient-confirmation">
                  <CheckCircle2 size={17} />
                  Selected: <strong>{recipient.name}</strong>
                </p>
              )}
            </div>
          ),
        },
        {
          label: 'Review & send',
          content: (
            <div className="request-review">
              <div className="request-review-top">
                <span className="request-topic">{categoryLabel(category)}</span>
                <button className="admin-text-button" onClick={() => setPage(0)}>
                  Edit topic
                </button>
              </div>
              <h3>{title}</h3>
              <dl className="request-meta">
                <div>
                  <dt>Record type</dt>
                  <dd>{kind === 'REQUEST' ? 'Request' : 'Incident'}</dd>
                </div>
                <div>
                  <dt>Priority</dt>
                  <dd>{priority === 'HIGH' ? 'High' : 'Normal'}</dd>
                </div>
                <div>
                  <dt>Send to</dt>
                  <dd>{recipient?.name}</dd>
                </div>
                <div>
                  <dt>Description</dt>
                  <dd>{description.length} characters</dd>
                </div>
              </dl>
              <p>{description.length > 280 ? description.slice(0, 280) + '…' : description}</p>
              <div className="request-review-edit">
                <button className="admin-text-button" onClick={() => setPage(1)}>
                  Edit details
                </button>
                <button className="admin-text-button" onClick={() => setPage(2)}>
                  Change recipient
                </button>
              </div>
              <p className="request-send-note">
                <CheckCircle2 size={17} />
                The recipient will be notified. You can track replies in Requests.
              </p>
            </div>
          ),
        },
      ]}
      footer={
        <>
          <button
            className="secondary-button"
            disabled={busy}
            onClick={() => (page ? setPage(page - 1) : onClose())}
          >
            {page ? (
              <>
                <ArrowLeft size={17} />
                Back
              </>
            ) : (
              'Cancel'
            )}
          </button>
          <button
            className="admin-primary"
            disabled={busy}
            onClick={() => {
              if (page < 3) {
                if (validate(page + 1)) setPage(page + 1);
              } else void submit();
            }}
          >
            {busy ? (
              'Sending…'
            ) : page === 3 ? (
              <>
                <Send size={17} />
                {kind === 'INCIDENT' ? 'Submit incident' : 'Submit request'}
              </>
            ) : (
              <>
                Next
                <ArrowRight size={17} />
              </>
            )}
          </button>
        </>
      }
    />
  );
}
