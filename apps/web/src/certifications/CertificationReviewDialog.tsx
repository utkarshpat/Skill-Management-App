import { useRef, useState } from 'react';
import { FormDialog } from '../FormDialog';
import {
  issuerLink,
  statusLabel,
  type CertificationChange,
  type CertificationRecord,
} from './types';

export function CertificationReviewDialog({
  certification: record,
  onClose,
  onDecision,
}: {
  certification: CertificationRecord;
  onClose: () => void;
  onDecision: (input: CertificationChange) => Promise<void>;
}) {
  const [feedback, setFeedback] = useState(''),
    [confirmed, setConfirmed] = useState(false);
  const [mode, setMode] = useState<'APPROVED' | 'CHANGES_REQUESTED' | 'REJECTED'>('APPROVED');
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const pending = useRef(false);
  const url = issuerLink(record.credentialUrl);
  const reasons: Record<string, string> = {
    SELF_REVIEW: 'You cannot review your own credential.',
    INACTIVE_CLAIMANT: 'The credential owner is not currently active.',
    REVIEW_ACCESS_DENIED: 'Current access does not permit credential review.',
    INVALID_RELATIONSHIP: 'The reporting relationship cannot be safely resolved.',
    NOT_CURRENT_DIRECT_MANAGER: 'You are not the current direct manager.',
    NOT_ASSIGNED_REVIEWER: 'This submission is not assigned to you.',
    NOT_AWAITING_REVIEW: 'This record is not awaiting a review decision.',
    CURRENT_ASSIGNED_DIRECT_MANAGER:
      'You are the current assigned direct manager of this active employee.',
  };
  async function decide() {
    if (pending.current || !record.canReview) return;
    if (
      (mode === 'APPROVED' && (!confirmed || !url)) ||
      (mode !== 'APPROVED' && !feedback.trim())
    ) {
      setError(
        'Confirm the issuer evidence for approval, or enter a reason for changes/rejection.',
      );
      return;
    }
    pending.current = true;
    setBusy(true);
    setError('');
    try {
      await onDecision({ id: record.id, revision: record.revision, action: mode, feedback });
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The review could not be saved.');
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  return (
    <FormDialog
      title={record.canReview ? 'Review certification' : 'Certification details'}
      subtitle={`${record.name} (${record.employeeCode})`}
      className="certification-review-modal"
      onClose={onClose}
      busy={busy}
      formId={record.canReview ? 'certification-review' : undefined}
      onSubmit={() => void decide()}
      message={error ? <p role="alert">{error}</p> : undefined}
      footer={
        <div className="certification-dialog-footer">
          <button className="secondary-button" type="button" onClick={onClose} disabled={busy}>
            Close
          </button>
          {record.canReview && (
            <button
              className="primary-button"
              type="submit"
              form="certification-review"
              disabled={busy || (mode === 'APPROVED' ? !confirmed || !url : !feedback.trim())}
            >
              {busy
                ? 'Saving...'
                : `Confirm ${mode === 'APPROVED' ? 'approval' : mode === 'REJECTED' ? 'rejection' : 'changes request'}`}
            </button>
          )}
        </div>
      }
    >
      <h3>{record.certificationName}</h3>
      <dl className="cert-meta-grid">
        <div>
          <dt>Issuer</dt>
          <dd>{record.provider}</dd>
        </div>
        <div>
          <dt>Category</dt>
          <dd>{record.category}</dd>
        </div>
        <div>
          <dt>Delivery unit</dt>
          <dd>{record.du}</dd>
        </div>
        <div>
          <dt>Review status</dt>
          <dd>{statusLabel[record.status]}</dd>
        </div>
        <div>
          <dt>Issued</dt>
          <dd>{record.certificationDate}</dd>
        </div>
        <div>
          <dt>Expires</dt>
          <dd>{record.expiryDate ?? 'Does not expire'}</dd>
        </div>
        <div>
          <dt>Credential ID</dt>
          <dd>{record.credentialId || 'Not supplied'}</dd>
        </div>
        <div>
          <dt>Current compliance</dt>
          <dd>
            {record.active === 'Y' ? 'Approved and currently valid' : 'Not currently compliant'}
          </dd>
        </div>
      </dl>
      {url ? (
        <p>
          <a className="cert-issuer-link" href={url} target="_blank" rel="noopener noreferrer">
            Open issuer verification page (new tab)
          </a>
        </p>
      ) : (
        <p>No valid issuer verification link is supplied.</p>
      )}
      {record.feedbackNote && (
        <p className="cert-feedback-note">
          <strong>Latest reviewer feedback:</strong> {record.feedbackNote}
        </p>
      )}
      {record.routingMismatch && (
        <p role="status">
          The assigned reviewer is no longer the current manager. The employee must explicitly route
          this unchanged submission to their new eligible manager.
        </p>
      )}
      <details>
        <summary>Why this review access?</summary>
        <p>{reasons[record.reviewReason] ?? 'Review eligibility could not be resolved.'}</p>
        <p>
          Checked for this record at revision {record.revision}. The server rechecks access,
          assignment and revision when saving.
        </p>
      </details>
      {record.canReview ? (
        <div className="cert-review-controls">
          <p>
            Only the current assigned direct manager may decide. Approval records a human evidence
            review, not a proficiency upgrade.
          </p>
          <label htmlFor="cert-decision">Decision</label>
          <select
            id="cert-decision"
            value={mode}
            onChange={e => setMode(e.target.value as typeof mode)}
          >
            <option value="APPROVED">Approve</option>
            <option value="CHANGES_REQUESTED">Request changes</option>
            <option value="REJECTED">Reject</option>
          </select>
          {mode === 'APPROVED' && (
            <label className="cert-check-label">
              <input
                type="checkbox"
                checked={confirmed}
                required
                onChange={e => setConfirmed(e.target.checked)}
              />
              I checked the issuer page, recipient identity, credential details and dates.
            </label>
          )}
          <label htmlFor="cert-review-note">
            Review note {mode !== 'APPROVED' ? '(required)' : '(optional)'}
          </label>
          <textarea
            id="cert-review-note"
            rows={4}
            maxLength={2000}
            value={feedback}
            required={mode !== 'APPROVED'}
            onChange={e => setFeedback(e.target.value)}
          />
        </div>
      ) : (
        <p>
          This record is read-only here. Editing and review require a currently allowed action and
          workflow state.
        </p>
      )}
      <h3>Recent submission and decision history</h3>
      <p className="field-hint">
        Latest 20 events. Full immutable snapshots remain in the server audit.
      </p>
      {record.history.length ? (
        <ol className="cert-history">
          {record.history.map(event => (
            <li key={event.revision}>
              <strong>{event.action.replaceAll('_', ' ')}</strong> by {event.actorName}{' '}
              <time dateTime={event.at}>{event.at.slice(0, 10)}</time> (revision {event.revision})
              {event.feedback && <p>{event.feedback}</p>}
            </li>
          ))}
        </ol>
      ) : (
        <p>No submissions or decisions yet.</p>
      )}
    </FormDialog>
  );
}
