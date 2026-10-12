import { useEffect, useRef, useState } from 'react';
import { authenticatedFetch } from '../auth';
import { readApiResponse } from '../api-response';
import { CapabilityComposer } from './CapabilityComposer';
import { FormDialog } from '../FormDialog';
import { toast } from '../toast';
import { CapabilityReview } from './CapabilityReview';
import { useSearchParams } from 'react-router';
import './capabilities.css';
export function CapabilitySubmissions({
  review = false,
  onUpdated,
}: {
  review?: boolean;
  onUpdated?: () => void;
}) {
  const [params] = useSearchParams();
  const consumed = useRef<string | undefined>(undefined);
  const [removing, setRemoving] = useState<any>();
  const [removed, setRemoved] = useState<any>();
  const [mutating, setMutating] = useState(false);
  const mutationLock = useRef(false);
  const [expanded, setExpanded] = useState(false);
  const [records, setRecords] = useState<any[]>([]),
    [error, setError] = useState(''),
    [attempt, setAttempt] = useState(0),
    [opened, setOpened] = useState<string>();
  useEffect(() => {
    const abort = new AbortController();
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
  if (!records.length && !error && !removed) return null;
  return (
    <section className="cap-submissions">
      <header>
        <h3>{review ? 'Combined capability reviews' : 'Your drafts & reviews'}</h3>
        <small>
          {review
            ? 'Skills and credentials in one request'
            : 'Resume drafts or track reviews. Finish your details before sending them for review.'}
        </small>
      </header>
      {error && (
        <p role="alert">
          {error}
          <button type="button" className="secondary-button" onClick={() => setAttempt(v => v + 1)}>
            Retry
          </button>
        </p>
      )}
      {(expanded ? records : records.slice(0, 5)).map(record => (
        <div key={record.id} className="cap-submission-row">
          <span>
            <strong>
              {review ? record.name + ' - ' : ''}
              {record.label || 'Capability submission'}
            </strong>
            <small>
              {record.skills} skills · {record.certifications} certificates ·{' '}
              {record.status.toLowerCase()}
            </small>
          </span>
          <div className="cap-submission-actions">
            {review || (record.status === 'DRAFT' && record.canEdit) ? (
              <button
                type="button"
                className="secondary-button"
                onClick={() => setOpened(record.id)}
              >
                {review ? 'Review request' : 'Continue draft'}
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
                className="secondary-button"
                disabled={mutating}
                onClick={() => setRemoving(record)}
              >
                Delete draft
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
      {records.length > 5 && (
        <button type="button" className="secondary-button" onClick={() => setExpanded(v => !v)}>
          {expanded ? 'Show fewer' : 'Show all recent submissions'}
        </button>
      )}
      {opened &&
        (review || !records.find(r => r.id === opened)?.canEdit ? (
          <CapabilityReview
            id={opened}
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
