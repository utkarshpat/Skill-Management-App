import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useSearchParams } from 'react-router';
import { Award, Plus, RefreshCw, Search } from 'lucide-react';
import { authenticatedFetch } from '../auth';
import { readApiResponse } from '../api-response';
import { FormDialog } from '../FormDialog';
import { toast } from '../toast';
import type { WorkspaceState } from '../Workspace';
import { CertificationDialog } from './CertificationDialog';
import { CertificationReviewDialog } from './CertificationReviewDialog';
import { certificationStatusLabels, credentialValidity } from './certification-model';
import type { CertificationFields, CertificationPage, CertificationRecord } from './types';
import './certifications.css';

export function Certifications({
  actionsContainer,
}: {
  workspace?: WorkspaceState;
  actionsContainer?: HTMLDivElement | null;
}) {
  const [params, setParams] = useSearchParams();
  const view = params.get('tab') === 'queue' ? 'queue' : 'mine';
  const [data, setData] = useState<CertificationPage>(),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(true);
  const [search, setSearch] = useState(''),
    [query, setQuery] = useState(''),
    [page, setPage] = useState(1),
    [attempt, setAttempt] = useState(0);
  const [editing, setEditing] = useState<CertificationRecord | null | undefined>(),
    [reviewing, setReviewing] = useState<CertificationRecord>(),
    [submitting, setSubmitting] = useState<CertificationRecord>();
  const [submitError, setSubmitError] = useState(''),
    [busy, setBusy] = useState(false);
  const submissionLock = useRef(false);
  const [today, setToday] = useState(() => new Date().toISOString().slice(0, 10));
  useEffect(() => {
    const refreshDate = () => setToday(new Date().toISOString().slice(0, 10));
    const timer = window.setInterval(refreshDate, 60_000);
    window.addEventListener('focus', refreshDate);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', refreshDate);
    };
  }, []);
  useEffect(() => {
    const timer = setTimeout(() => {
      setQuery(search.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);
  useEffect(() => {
    setPage(1);
  }, [view]);
  useEffect(() => {
    const c = new AbortController();
    setLoading(true);
    setError('');
    setData(undefined);
    const q = new URLSearchParams({ view, page: String(page), search: query });
    authenticatedFetch('/api/certifications?' + q, { signal: c.signal })
      .then(r => readApiResponse<CertificationPage>(r, 'Certifications could not be loaded.'))
      .then(result => {
        if (!c.signal.aborted) setData(result);
      })
      .catch(e => {
        if (!c.signal.aborted) setError(e.message);
      })
      .finally(() => {
        if (!c.signal.aborted) setLoading(false);
      });
    return () => c.abort();
  }, [view, page, query, attempt]);
  const changeView = (tab: string) => {
    setPage(1);
    setSearch('');
    setQuery('');
    const next = new URLSearchParams(params);
    next.set('tab', tab);
    setParams(next);
  };
  async function mutate(payload: object, message: string) {
    await readApiResponse(
      await authenticatedFetch('/api/certifications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }),
      'Save failed. Your entries are still here.',
    );
    toast.success(message);
    setAttempt(n => n + 1);
    window.dispatchEvent(new Event('notifications-updated'));
  }
  const save = (id: string, revision: number, fields: CertificationFields, submit: boolean) =>
    mutate(
      { action: submit ? 'SAVE_SUBMIT' : 'SAVE', id, revision, fields },
      submit
        ? 'Certification submitted to your assigned current manager.'
        : 'Certification draft saved.',
    );
  async function submit() {
    if (!submitting || submissionLock.current) return;
    submissionLock.current = true;
    setBusy(true);
    setSubmitError('');
    try {
      await mutate(
        { action: 'SUBMIT', id: submitting.id, revision: submitting.revision },
        'Certification submitted to your assigned current manager.',
      );
      setSubmitting(undefined);
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : 'Submission failed.');
    } finally {
      submissionLock.current = false;
      setBusy(false);
    }
  }
  const actions = (
    <div className="cert-header-actions">
      <button
        className="secondary-button"
        disabled={loading}
        onClick={() => setAttempt(n => n + 1)}
      >
        <RefreshCw size={16} /> Refresh
      </button>
      {data?.canManage && (
        <button className="primary-button" onClick={() => setEditing(null)}>
          <Plus size={16} /> Add certification
        </button>
      )}
    </div>
  );
  return (
    <div className="certifications-container">
      <header className="certifications-header">
        <div className="cert-header-title-wrap">
          <h1>
            <Award size={26} /> Certifications
          </h1>
          <p>Your credentials, renewal dates and manager review—in one place.</p>
        </div>
        {!actionsContainer && actions}
      </header>
      {actionsContainer && createPortal(actions, actionsContainer)}
      <nav className="cert-nav-tabs" aria-label="Certification views">
        <button
          className={`cert-nav-tab-btn ${view === 'mine' ? 'active' : ''}`}
          aria-current={view === 'mine' ? 'page' : undefined}
          onClick={() => changeView('mine')}
        >
          My certifications
        </button>
        {(data?.canReview || view === 'queue') && (
          <button
            className={`cert-nav-tab-btn ${view === 'queue' ? 'active' : ''}`}
            aria-current={view === 'queue' ? 'page' : undefined}
            onClick={() => changeView('queue')}
          >
            Assigned reviews
          </button>
        )}
      </nav>
      <p className="cert-help">
        {view === 'mine'
          ? 'Save a draft, check the details, then submit it to your current manager. For a renewal, add a new credential; reviewed records stay locked.'
          : 'Review submitted credentials assigned to you from your current direct reports. Private drafts are excluded.'}
      </p>
      <div className="cert-filter-bar">
        <label className="cert-search-box">
          <Search size={16} />
          <span className="sr-only">Search certifications</span>
          <input
            type="search"
            value={search}
            maxLength={100}
            placeholder={
              view === 'mine'
                ? 'Search certification or issuer'
                : 'Search certification, issuer or employee'
            }
            onChange={e => setSearch(e.target.value)}
          />
        </label>
        {data && (
          <span>
            {data.total} {view === 'mine' ? 'credentials' : 'pending reviews'}
          </span>
        )}
      </div>
      {error && (
        <section className="profile-panel" role="alert">
          <p>{error}</p>
          <button className="secondary-button" onClick={() => setAttempt(n => n + 1)}>
            Retry
          </button>
        </section>
      )}
      {loading && <p role="status">Loading certifications…</p>}
      {data?.records.length === 0 && (
        <section className="cert-empty-state-cell">
          <Award size={32} />
          <h2>
            {query
              ? 'No matching certifications'
              : view === 'mine'
                ? 'Start your credential portfolio'
                : 'No assigned reviews waiting'}
          </h2>
          <p>
            {query
              ? 'Try a different certification name or issuer.'
              : view === 'mine'
                ? 'Add your first credential using the details on your certificate.'
                : 'New submissions from your assigned direct reports will appear here.'}
          </p>
          {!query && view === 'mine' && data.canManage && (
            <button className="primary-button" onClick={() => setEditing(null)}>
              Add certification
            </button>
          )}
        </section>
      )}
      <div className="cert-record-list">
        {data?.records.map(record => (
          <article className="cert-record-card" key={record.id}>
            <div className="cert-record-heading">
              <div>
                <span className="cert-category-badge">{record.category}</span>
                <h2>{record.certificationName}</h2>
                <p>
                  {record.provider}
                  {view === 'queue' && ` · ${record.name} (${record.employeeCode})`}
                </p>
              </div>
              <span className={`status-pill status-${record.status.toLowerCase()}`}>
                {certificationStatusLabels[record.status]}
              </span>
            </div>
            <div className="cert-record-meta">
              <span>Issued {record.certificationDate}</span>
              <span
                className={
                  credentialValidity(record.expiryDate, today) === 'Expired' ? 'cert-expired' : ''
                }
              >
                {credentialValidity(record.expiryDate, today)}
                {record.expiryDate && ` · ${record.expiryDate}`}
              </span>
            </div>
            {record.feedback && (
              <div className="cert-feedback">
                <strong>Manager feedback</strong>
                <p>{record.feedback}</p>
                {record.reviewedBy && (
                  <small>
                    {record.reviewedBy}
                    {record.reviewedAt && ` · ${new Date(record.reviewedAt).toLocaleDateString()}`}
                  </small>
                )}
              </div>
            )}
            <details>
              <summary>Credential details</summary>
              {record.credentialId && <p>Credential ID: {record.credentialId}</p>}
              {record.credentialUrl ? (
                <a href={record.credentialUrl} target="_blank" rel="noopener noreferrer">
                  Open issuer / badge link
                </a>
              ) : (
                <p>No issuer link provided.</p>
              )}
              {record.notes && <p>{record.notes}</p>}
              <p>Manager review is separate from issuer validation and skill proficiency.</p>
            </details>
            <div className="cert-header-actions">
              {record.canEdit && (
                <button className="secondary-button" onClick={() => setEditing(record)}>
                  {record.status === 'DRAFT' ? 'Edit draft' : 'Update details'}
                </button>
              )}
              {record.canSubmit && (
                <button
                  className="primary-button"
                  onClick={() => {
                    setSubmitError('');
                    setSubmitting(record);
                  }}
                >
                  {record.status === 'SUBMITTED' ? 'Route to current manager' : 'Submit to manager'}
                </button>
              )}
              {record.canReview && (
                <button className="primary-button" onClick={() => setReviewing(record)}>
                  Review credential
                </button>
              )}
            </div>
          </article>
        ))}
      </div>
      {data && data.total > data.pageSize && (
        <nav className="cert-pagination" aria-label="Certification pages">
          <button
            className="secondary-button"
            disabled={page === 1 || loading}
            onClick={() => setPage(p => p - 1)}
          >
            Previous
          </button>
          <span>
            Page {page} of {Math.ceil(data.total / data.pageSize)}
          </span>
          <button
            className="secondary-button"
            disabled={page * data.pageSize >= data.total || loading}
            onClick={() => setPage(p => p + 1)}
          >
            Next
          </button>
        </nav>
      )}
      {editing !== undefined && (
        <CertificationDialog
          initial={editing}
          canSubmit={editing ? editing.canSubmit : Boolean(data?.canSubmitNew)}
          onClose={() => setEditing(undefined)}
          onSave={save}
        />
      )}
      {reviewing && (
        <CertificationReviewDialog
          certification={reviewing}
          onClose={() => setReviewing(undefined)}
          onDecision={(record, action, feedback) =>
            mutate(
              { action, id: record.id, revision: record.revision, feedback },
              'Certification review saved.',
            )
          }
        />
      )}
      {submitting && (
        <FormDialog
          title="Submit to your current manager?"
          onClose={() => setSubmitting(undefined)}
          busy={busy}
        >
          <p>
            <strong>{submitting.certificationName}</strong>
          </p>
          <p>
            Your current active manager will be assigned this review. The details become read-only
            while awaiting a decision.
          </p>
          {submitError && <p role="alert">{submitError}</p>}
          <div className="certification-dialog-footer">
            <button
              className="secondary-button"
              disabled={busy}
              onClick={() => setSubmitting(undefined)}
            >
              Keep as draft
            </button>
            <button className="primary-button" disabled={busy} onClick={() => void submit()}>
              {busy ? 'Submitting…' : 'Submit to manager'}
            </button>
          </div>
        </FormDialog>
      )}
    </div>
  );
}
