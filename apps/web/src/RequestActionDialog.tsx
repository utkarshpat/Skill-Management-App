import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Search, Sparkles } from 'lucide-react';
import { FormDialog } from './FormDialog';
import { authenticatedFetch } from './auth';
import { requestRead, type RequestOptions, type RequestRecord } from './request-model';
export type RequestAction = 'COMMENT' | 'CANCEL' | 'START' | 'RESOLVE' | 'REASSIGN';
const titles = {
  COMMENT: 'Add comment',
  CANCEL: 'Cancel record',
  START: 'Start work',
  RESOLVE: 'Resolve record',
  REASSIGN: 'Reassign record',
};
export function RequestActionDialog({
  record,
  action,
  onClose,
  onSaved,
  onReload,
}: {
  record: RequestRecord;
  action: RequestAction;
  onClose: () => void;
  onSaved: () => void;
  onReload: () => void;
}) {
  const [body, setBody] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [eventId] = useState(() => crypto.randomUUID());
  const [query, setQuery] = useState(''),
    [matches, setMatches] = useState<RequestOptions['recipients']>([]),
    [recipient, setRecipient] = useState<RequestOptions['recipients'][number]>(),
    [page, setPage] = useState(0),
    [searching, setSearching] = useState(false);
  const [handoffStep, setHandoffStep] = useState(0);
  const [ai, setAi] = useState(false),
    [notes, setNotes] = useState(''),
    [draft, setDraft] = useState('');
  const controller = useRef<AbortController | null>(null);
  const choosing = action === 'REASSIGN' && handoffStep === 0 && !ai;
  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => {
    if (action !== 'REASSIGN') return;
    const c = new AbortController();
    setSearching(true);
    const timer = setTimeout(() => {
      authenticatedFetch(
        '/api/workflows/' + record.id + '/recipients?q=' + encodeURIComponent(query),
        { signal: c.signal },
      )
        .then(requestRead<{ recipients: RequestOptions['recipients'] }>)
        .then(r => {
          if (!c.signal.aborted) {
            setMatches(r.recipients);
            setSearching(false);
          }
        })
        .catch(e => {
          if (!c.signal.aborted) {
            setMatches([]);
            setError(e.message);
            setSearching(false);
          }
        });
    }, 250);
    return () => {
      clearTimeout(timer);
      c.abort();
    };
  }, [query, record.id, action]);
  async function generate() {
    if (busy || !notes.trim()) return;
    setBusy(true);
    setError('');
    const c = new AbortController();
    controller.current = c;
    try {
      const d = await requestRead<{ body: string }>(
        await authenticatedFetch('/api/assistant/workflow-draft', {
          method: 'POST',
          signal: c.signal,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: record.id, revision: record.revision, action, notes }),
        }),
      );
      if (!c.signal.aborted) setDraft(d.body);
    } catch (e) {
      if (!c.signal.aborted) setError(e instanceof Error ? e.message : 'Could not draft a note.');
    } finally {
      if (controller.current === c) {
        controller.current = null;
        setBusy(false);
      }
    }
  }
  async function submit() {
    if (busy || !body.trim() || (action === 'REASSIGN' && !recipient)) return;
    setBusy(true);
    setError('');
    try {
      await requestRead(
        await authenticatedFetch('/api/workflows', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action,
            id: record.id,
            eventId,
            revision: record.revision,
            body,
            ...(action === 'REASSIGN' ? { recipientId: recipient!.id } : {}),
          }),
        }),
      );
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save.');
    } finally {
      setBusy(false);
    }
  }
  const label =
    action === 'RESOLVE'
      ? 'Resolution note'
      : action === 'START'
        ? 'Work plan'
        : action === 'REASSIGN'
          ? 'Handoff note'
          : action === 'CANCEL'
            ? 'Cancellation reason'
            : 'Your comment';
  return (
    <FormDialog
      className="request-action-dialog"
      title={titles[action]}
      subtitle={record.reference + ' · ' + record.title}
      busy={busy}
      onClose={onClose}
      message={
        error && (
          <p role="alert">
            {error}{' '}
            <button className="admin-text-button" disabled={busy} onClick={onReload}>
              Reload record
            </button>
          </p>
        )
      }
      footer={
        <>
          <button
            className="secondary-button"
            disabled={busy}
            onClick={
              ai
                ? () => {
                    setAi(false);
                    setDraft('');
                  }
                : action === 'REASSIGN' && handoffStep === 1
                  ? () => setHandoffStep(0)
                  : onClose
            }
          >
            {ai ? 'Back to note' : 'Back'}
          </button>
          {ai ? (
            <button
              className="admin-primary"
              disabled={busy || !draft.trim()}
              onClick={() => {
                setBody(draft);
                setAi(false);
              }}
            >
              Use draft
            </button>
          ) : choosing ? (
            <button
              className="admin-primary"
              disabled={busy || !recipient || searching}
              onClick={() => setHandoffStep(1)}
            >
              Next <ArrowRight size={17} />
            </button>
          ) : (
            <button
              className="admin-primary"
              disabled={busy || !body.trim() || (action === 'REASSIGN' && !recipient)}
              onClick={() => void submit()}
            >
              {busy
                ? 'Saving…'
                : action === 'COMMENT'
                  ? 'Post comment'
                  : 'Confirm ' +
                    (action === 'START'
                      ? 'start'
                      : action === 'RESOLVE'
                        ? 'resolution'
                        : action === 'REASSIGN'
                          ? 'reassignment'
                          : 'cancellation')}
            </button>
          )}
        </>
      }
    >
      {ai ? (
        <div className="access-form">
          <p>
            AI creates an editable suggestion from your facts. Review it before confirming the
            action.
          </p>
          {draft ? (
            <>
              <label>
                Review AI draft
                <textarea
                  name="aiDraft"
                  rows={7}
                  value={draft}
                  maxLength={1000}
                  disabled={busy}
                  onChange={e => setDraft(e.target.value)}
                />
              </label>
              <button className="admin-text-button" disabled={busy} onClick={() => setDraft('')}>
                Edit facts and regenerate
              </button>
            </>
          ) : (
            <>
              <label>
                Facts for the draft
                <textarea
                  name="aiDraftFacts"
                  rows={5}
                  value={notes}
                  maxLength={500}
                  disabled={busy}
                  onChange={e => setNotes(e.target.value)}
                />
              </label>
              <button
                className="secondary-button request-ai-button"
                disabled={busy || !notes.trim()}
                onClick={() => void generate()}
              >
                <Sparkles size={17} />
                {busy ? 'Drafting…' : 'Generate draft'}
              </button>
            </>
          )}
        </div>
      ) : (
        <div className="access-form">
          {choosing && (
            <>
              <p>Choose the person who should receive this record.</p>
              <label className="request-recipient-search">
                <Search size={18} />
                <span className="sr-only">Search new recipient by name</span>
                <input
                  type="search"
                  value={query}
                  maxLength={80}
                  disabled={busy}
                  placeholder="Search a person's name…"
                  onChange={e => {
                    setQuery(e.target.value);
                    setPage(0);
                    setSearching(true);
                  }}
                />
              </label>
              {searching ? (
                <p role="status">Searching people…</p>
              ) : (
                <>
                  <fieldset className="request-people-grid">
                    <legend className="sr-only">Choose new recipient</legend>
                    {matches.slice(page * 4, page * 4 + 4).map(r => (
                      <label
                        className={
                          'request-person-choice ' + (recipient?.id === r.id ? 'selected' : '')
                        }
                        key={r.id}
                      >
                        <input
                          type="radio"
                          name="reassign-person"
                          checked={recipient?.id === r.id}
                          disabled={busy}
                          onChange={() => setRecipient(r)}
                        />
                        <strong>{r.name}</strong>
                      </label>
                    ))}
                  </fieldset>
                  {!matches.length && <p>No eligible matches. Try another name.</p>}
                  {matches.length > 4 && (
                    <div className="request-people-pagination">
                      <button
                        className="secondary-button"
                        aria-label="Previous recipient results"
                        disabled={page === 0 || busy}
                        onClick={() => setPage(p => p - 1)}
                      >
                        <ArrowLeft size={15} />
                      </button>
                      <span>
                        {page + 1}/{Math.ceil(matches.length / 4)}
                      </span>
                      <button
                        className="secondary-button"
                        aria-label="Next recipient results"
                        disabled={(page + 1) * 4 >= matches.length || busy}
                        onClick={() => setPage(p => p + 1)}
                      >
                        <ArrowRight size={15} />
                      </button>
                    </div>
                  )}
                </>
              )}
              {recipient && <small>Selected: {recipient.name}</small>}
            </>
          )}
          {!choosing && (
            <>
              {action === 'REASSIGN' && (
                <p>
                  Send to <strong>{recipient?.name}</strong>
                </p>
              )}
              <label>
                {label}
                <textarea
                  name="actionNote"
                  rows={action === 'REASSIGN' ? 3 : 5}
                  value={body}
                  maxLength={1000}
                  disabled={busy}
                  onChange={e => setBody(e.target.value)}
                />
              </label>
              <small>{body.length}/1000</small>
              {action !== 'CANCEL' && (
                <button
                  className="secondary-button request-ai-button"
                  onClick={() => {
                    setNotes(body.slice(0, 500));
                    setAi(true);
                  }}
                  disabled={busy}
                >
                  <Sparkles size={17} />
                  Draft with AI
                </button>
              )}
              <p className="workspace-muted">
                {action === 'REASSIGN'
                  ? 'The former recipient loses access. The new recipient receives this record as Submitted and is notified.'
                  : action === 'RESOLVE'
                    ? 'Confirm only after the work is complete. The requester will be notified and the resolution retained.'
                    : action === 'CANCEL'
                      ? 'Cancellation cannot be undone. History is retained.'
                      : 'Your note is visible to the current participants and retained in Activity.'}
              </p>
            </>
          )}
        </div>
      )}
    </FormDialog>
  );
}
