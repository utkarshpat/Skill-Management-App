import { useEffect, useRef, useState } from 'react';
import { authenticatedFetch } from '../auth';
import { readApiResponse } from '../api-response';
import { CapabilityComposer } from './CapabilityComposer';
import { ArrowRight, Award, CheckCircle2, Clock3, Code2, Trash2 } from 'lucide-react';
import { FormDialog } from '../FormDialog';
import { toast } from '../toast';
import { CapabilityReview } from './CapabilityReview';
import { useSearchParams } from 'react-router';
import './capabilities.css';

function getInitials(name?: string) {
  if (!name) return 'UP';
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}
export function CapabilitySubmissions({
  review = false,
  showEmpty = false,
  onUpdated,
}: {
  review?: boolean;
  showEmpty?: boolean;
  onUpdated?: () => void;
}) {
  const [params] = useSearchParams();
  const consumed = useRef<string | undefined>(undefined);
  const [removing, setRemoving] = useState<any>();
  const [removed, setRemoved] = useState<any>();
  const [mutating, setMutating] = useState(false);
  const mutationLock = useRef(false);
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [records, setRecords] = useState<any[]>([]),
    [error, setError] = useState(''),
    [attempt, setAttempt] = useState(0),
    [opened, setOpened] = useState<string>();
  useEffect(() => {
    const abort = new AbortController();
    setLoading(true);
    authenticatedFetch('/api/capability-submissions?view=' + (review ? 'queue' : 'mine'), {
      signal: abort.signal,
    })
      .then(r => readApiResponse<any>(r, 'Combined submissions could not be loaded.'))
      .then(data => {
        if (!abort.signal.aborted) {
          setRecords(data.records ?? []);
          setError('');
        }
      })
      .catch(e => {
        if (!abort.signal.aborted) {
          setRecords([]);
          setError(e.message);
        }
      })
      .finally(() => {
        if (!abort.signal.aborted) setLoading(false);
      });
    return () => abort.abort();
  }, [review, attempt]);
  useEffect(() => {
    const refresh = () => setAttempt(v => v + 1);
    window.addEventListener('notifications-remote-updated', refresh);
    window.addEventListener('own-skills-updated', refresh);
    return () => {
      window.removeEventListener('notifications-remote-updated', refresh);
      window.removeEventListener('own-skills-updated', refresh);
    };
  }, []);
  useEffect(() => {
    const target = params.get('submission')?.toLowerCase();
    if (target && consumed.current !== target && records.some(r => r.id === target)) {
      consumed.current = target;
      setOpened(target);
    }
  }, [params, records]);
  const done = () => {
    setOpened(undefined);
    setAttempt(v => v + 1);
    onUpdated?.();
  };
  async function changeDraft(record: any, restore = false) {
    if (mutationLock.current) return;
    mutationLock.current = true;
    setMutating(true);
    setError('');
    try {
      const value = await readApiResponse<any>(
        await authenticatedFetch(
          `/api/capability-submissions/${record.id}/${restore ? 'restore' : 'discard'}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ revision: record.revision }),
          },
        ),
        'Draft change could not be confirmed. Refresh before retrying.',
      );
      setRemoved(restore ? undefined : { ...record, revision: value.revision });
      setRemoving(undefined);
      setAttempt(v => v + 1);
      onUpdated?.();
      toast.success(
        restore
          ? 'Draft restored.'
          : 'Submission draft removed. Saved skills and certificates remain.',
      );
    } catch (e) {
      setError((e as Error).message);
      setAttempt(v => v + 1);
    } finally {
      mutationLock.current = false;
      setMutating(false);
    }
  }
  const visibleRecords = review ? records : records.filter(r => r.status === 'DRAFT');
  if (!showEmpty && !visibleRecords.length && !error && !removed && !opened) return null;
  return (
    <section
      className="cap-submissions"
      hidden={!showEmpty && !visibleRecords.length && !error && !removed}
    >
      <header className="cap-submissions-header">
        <div className="cap-submissions-title-group">
          <div className="cap-title-with-badge">
            <h3>{review ? 'Review requests' : 'Drafts'}</h3>
            {visibleRecords.length > 0 && (
              <span className="cap-count-badge">
                {visibleRecords.length} {visibleRecords.length === 1 ? 'request' : 'requests'}
              </span>
            )}
          </div>
          <p className="cap-submissions-sub">
            {review
              ? 'Skills and supporting certificates in one request.'
              : 'Continue where you left off.'}
          </p>
        </div>
      </header>
      {showEmpty && loading && <p role="status">Loading review requests…</p>}
      {showEmpty && !loading && !visibleRecords.length && !error && (
        <div className="cap-empty-box" role="status">
          <CheckCircle2 size={22} className="cap-empty-check" aria-hidden="true" />
          <div>
            <strong>All caught up!</strong>
            <p>No new skill submissions are awaiting your review.</p>
          </div>
        </div>
      )}
      {error && (
        <p role="alert">
          {error}
          <button type="button" className="secondary-button" onClick={() => setAttempt(v => v + 1)}>
            Retry
          </button>
        </p>
      )}
      {(expanded ? visibleRecords : visibleRecords.slice(0, 5)).map(record => (
        <div key={record.id} className="cap-submission-card">
          <div className="cap-card-left">
            {review && (
              <div className="cap-avatar-badge" aria-hidden="true">
                {getInitials(record.name)}
              </div>
            )}
            <div className="cap-card-info">
              <div className="cap-card-title-row">
                {review && <strong className="cap-employee-name">{record.name}</strong>}
                {review && record.label && <span className="cap-title-sep">·</span>}
                <span className="cap-request-label">
                  {record.label || 'Capability submission'}
                </span>
              </div>
              <div className="cap-metadata-pills">
                <span className="cap-meta-pill">
                  <Code2 size={12} aria-hidden="true" />
                  {record.skills} {record.skills === 1 ? 'skill' : 'skills'}
                </span>
                <span className="cap-meta-pill">
                  <Award size={12} aria-hidden="true" />
                  {record.certifications} {record.certifications === 1 ? 'certificate' : 'certificates'}
                </span>
                <span className={`cap-status-pill ${record.status.toLowerCase()}`}>
                  <Clock3 size={11} aria-hidden="true" />
                  {record.status === 'SUBMITTED' ? 'Awaiting review' : record.status.toLowerCase()}
                </span>
              </div>
            </div>
          </div>
          <div className="cap-submission-actions">
            {review || (record.status === 'DRAFT' && record.canEdit) ? (
              <button
                type="button"
                className={review ? 'admin-primary cap-review-btn' : 'secondary-button'}
                onClick={() => setOpened(record.id)}
              >
                {review ? (
                  <>
                    Review request <ArrowRight size={14} aria-hidden="true" />
                  </>
                ) : (
                  'Continue'
                )}
              </button>
            ) : (
              <button
                type="button"
                className="secondary-button"
                onClick={() => setOpened(record.id)}
              >
                View submission
              </button>
            )}
            {!review && record.status === 'DRAFT' && record.canEdit && (
              <button
                type="button"
                className="secondary-button cap-delete-icon"
                aria-label={`Delete ${record.label || 'submission'} draft`}
                title="Delete draft"
                disabled={mutating}
                onClick={() => setRemoving(record)}
              >
                <Trash2 size={15} aria-hidden="true" />
              </button>
            )}
          </div>
        </div>
      ))}
      {removed && (
        <p role="status">
          Draft removed.{' '}
          <button
            type="button"
            className="secondary-button"
            disabled={mutating}
            onClick={() => void changeDraft(removed, true)}
          >
            Undo
          </button>
        </p>
      )}
      {removing && (
        <FormDialog
          title="Delete submission draft?"
          busy={mutating}
          onClose={() => setRemoving(undefined)}
          message={error ? <p role="alert">{error}</p> : undefined}
          footer={
            <>
              <button
                type="button"
                className="secondary-button"
                disabled={mutating}
                onClick={() => setRemoving(undefined)}
              >
                Keep draft
              </button>
              <button
                type="button"
                className="admin-primary"
                disabled={mutating}
                onClick={() => void changeDraft(removing)}
              >
                Delete draft
              </button>
            </>
          }
        >
          <p className="cap-callout">
            This removes the submission from your draft list. Saved profile skills, certificates and
            files stay in your profile. You can undo this removal.
          </p>
        </FormDialog>
      )}
      {visibleRecords.length > 5 && (
        <button type="button" className="secondary-button" onClick={() => setExpanded(v => !v)}>
          {expanded ? 'Show fewer' : 'Show all recent submissions'}
        </button>
      )}
      {opened &&
        (review || !records.find(r => r.id === opened)?.canEdit ? (
          <CapabilityReview
            id={opened}
            employeeName={records.find(r => r.id === opened)?.name}
            submissionLabel={records.find(r => r.id === opened)?.label}
            readOnly={!review}
            onClose={() => setOpened(undefined)}
            onSaved={done}
          />
        ) : (
          <CapabilityComposer
            submissionId={opened}
            onClose={() => setOpened(undefined)}
            onSaved={done}
          />
        ))}
    </section>
  );
}
