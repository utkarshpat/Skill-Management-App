import { useRef, useState } from 'react';
import { FormDialog } from '../FormDialog';
import type { CertificationRecord } from './types';
import { credentialValidity } from './certification-model';
import { CertificationImage } from './CertificationImage';
export function CertificationReviewDialog({
  certification,
  onClose,
  onDecision,
}: {
  certification: CertificationRecord;
  onClose: () => void;
  onDecision: (
    record: CertificationRecord,
    action: 'APPROVE' | 'REQUEST_CHANGES' | 'REJECT',
    feedback: string,
  ) => Promise<void>;
}) {
  const [feedback, setFeedback] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const saving = useRef(false);
  async function decide(action: 'APPROVE' | 'REQUEST_CHANGES' | 'REJECT') {
    if (saving.current || !certification.canReview) return;
    if (!feedback.trim()) {
      setError('Add a review note explaining your decision.');
      return;
    }
    saving.current = true;
    setBusy(true);
    setError('');
    try {
      await onDecision(certification, action, feedback.trim());
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Review failed. Your note is still here.');
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }
  return (
    <FormDialog
      title="Review certification"
      subtitle={`${certification.name} · ${certification.employeeCode}`}
      onClose={onClose}
      busy={busy}
      className="certification-review-modal"
    >
      <CertificationImage id={certification.id} />
      <section className="cert-review-banner">
        <h3>{certification.certificationName}</h3>
        <p>
          {certification.provider} · {certification.category}
        </p>
        <p>
          Issued {certification.certificationDate} ·{' '}
          {credentialValidity(certification.expiryDate, new Date().toISOString().slice(0, 10))}
          {certification.expiryDate && ` (${certification.expiryDate})`}
        </p>
        {certification.credentialId && <p>Credential ID: {certification.credentialId}</p>}
        {certification.credentialUrl && (
          <a href={certification.credentialUrl} target="_blank" rel="noopener noreferrer">
            Open issuer / badge link
          </a>
        )}
        {certification.notes && <p>{certification.notes}</p>}
        <p>
          Review the credential details and issuer link. Approval does not extend validity or
          establish skill proficiency.
        </p>
      </section>
      {!certification.canReview && (
        <p role="alert">
          Assigned review is unavailable:{' '}
          {certification.reviewAccess?.reasonCode ?? 'Refresh your queue.'}
        </p>
      )}
      {error && <p role="alert">{error}</p>}
      <label className="form-group">
        Review note *
        <textarea
          value={feedback}
          maxLength={2000}
          rows={4}
          disabled={busy}
          onChange={e => setFeedback(e.target.value)}
        />
      </label>
      <div className="certification-review-footer">
        <button className="secondary-button" disabled={busy} onClick={onClose}>
          Cancel
        </button>
        <button
          className="secondary-button"
          disabled={busy || !certification.canReview}
          onClick={() => void decide('REJECT')}
        >
          Do not approve
        </button>
        <button
          className="secondary-button"
          disabled={busy || !certification.canReview}
          onClick={() => void decide('REQUEST_CHANGES')}
        >
          Request changes
        </button>
        <button
          className="primary-button"
          disabled={busy || !certification.canReview}
          onClick={() => void decide('APPROVE')}
        >
          {busy ? 'Saving…' : 'Approve with note'}
        </button>
      </div>
    </FormDialog>
  );
}
