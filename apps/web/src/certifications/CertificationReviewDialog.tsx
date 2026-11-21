import { useRef, useState } from 'react';
import { CheckCheck, ExternalLink, MessageSquareMore, XCircle } from 'lucide-react';
import { FormDialog } from '../FormDialog';
import { AskSkillGenie, certificateQuestion, focusRecordSection } from '../AskSkillGenie';
import type { CertificationRecord } from './types';
import { credentialValidity } from './certification-model';
import { CertificationImage } from './CertificationImage';
export function CertificationReviewDialog({
  certification,
  onClose,
  onDecision,
  onRefresh,
  refreshForAssistant,
  onReopen,
}: {
  certification: CertificationRecord;
  onClose: () => void;
  onRefresh: () => void;
  refreshForAssistant?: (signal: AbortSignal) => Promise<CertificationRecord | undefined>;
  onReopen?: (record: CertificationRecord) => void;
  onDecision: (
    record: CertificationRecord,
    action: 'APPROVE' | 'REQUEST_CHANGES' | 'REJECT',
    feedback: string,
  ) => Promise<void>;
}) {
  const [feedback, setFeedback] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [needsRefresh, setNeedsRefresh] = useState(false);
  const saving = useRef(false);
  const canDecide = certification.canReview && !needsRefresh;
  async function decide(action: 'APPROVE' | 'REQUEST_CHANGES' | 'REJECT') {
    if (saving.current || !canDecide) return;
    if (action !== 'APPROVE' && !feedback.trim()) {
      setError('Add a decision note for the rejection or change request.');
      return;
    }
    saving.current = true;
    setBusy(true);
    setError('');
    try {
      await onDecision(certification, action, feedback.trim());
      onClose();
    } catch (e) {
      if ([401, 403, 404, 409].includes((e as { status?: number }).status ?? 0))
        setNeedsRefresh(true);
      setError(
        e instanceof Error ? e.message : 'Could not save the decision. Your note is still here.',
      );
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }
  return (
    <FormDialog
      title="Open certification approval"
      subtitle={`${certification.name} · ${certification.employeeCode}`}
      onClose={onClose}
      busy={busy}
      className="certification-review-modal"
      footer={
        <div className="certification-review-footer">
          <button className="secondary-button" disabled={busy} onClick={onClose}>
            Cancel
          </button>
          {needsRefresh && (
            <button type="button" className="primary-button" disabled={busy} onClick={onRefresh}>
              Refresh approval queue
            </button>
          )}
          <button
            className="secondary-button button-tone-rose"
            disabled={busy || !canDecide}
            onClick={() => void decide('REJECT')}
          >
            <XCircle size={15} aria-hidden="true" />
            Do not approve
          </button>
          <button
            className="secondary-button button-tone-blue"
            disabled={busy || !canDecide}
            onClick={() => void decide('REQUEST_CHANGES')}
          >
            <MessageSquareMore size={15} aria-hidden="true" />
            Request changes
          </button>
          <button
            className="primary-button button-tone-teal"
            disabled={busy || !canDecide}
            onClick={() => void decide('APPROVE')}
          >
            <CheckCheck size={16} aria-hidden="true" />
            {busy ? 'Saving…' : 'Approve'}
          </button>
        </div>
      }
    >
      <div tabIndex={-1} data-genie-section="evidence">
        <CertificationImage id={certification.id} />
      </div>
      {refreshForAssistant && onReopen && canDecide && !busy && !feedback.trim() && (
        <AskSkillGenie
          onOpen={onClose}
          load={async signal => {
            async function refresh(signal: AbortSignal) {
              const record = await refreshForAssistant!(signal);
              if (!record?.canReview)
                throw Object.assign(
                  new Error('This certificate is no longer awaiting your approval.'),
                  { status: 404 },
                );
              return record;
            }
            const latest = await refresh(signal);
            return {
              prompt: certificateQuestion(latest, true),
              record: {
                label: latest.certificationName,
                actions: [
                  {
                    label: 'Back to this record',
                    run: async signal => {
                      const current = await refresh(signal);
                      if (!signal.aborted) onReopen(current);
                    },
                  },
                  {
                    label: 'View evidence',
                    run: async signal => {
                      const current = await refresh(signal);
                      if (!signal.aborted) {
                        onReopen(current);
                        focusRecordSection('evidence');
                      }
                    },
                  },
                ],
              },
            };
          }}
        />
      )}
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
          <a
            href={certification.credentialUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="cert-review-link"
          >
            <span>Open issuer / badge link</span>
            <ExternalLink size={13} aria-hidden="true" />
          </a>
        )}
        {certification.notes && <p>{certification.notes}</p>}
        <p>
          Check the credential details and issuer link. Approval does not extend validity or
          establish skill proficiency.
        </p>
      </section>
      {!certification.canReview && (
        <p role="alert">
          Assigned approval is unavailable:{' '}
          {certification.reviewAccess?.reasonCode ?? 'Refresh your queue.'}
        </p>
      )}
      {error && <p role="alert">{error}</p>}
      <label className="form-group">
        Decision note
        <small>Optional for approval. Required for rejection or changes.</small>
        <textarea
          value={feedback}
          maxLength={2000}
          rows={4}
          disabled={busy}
          onChange={e => setFeedback(e.target.value)}
        />
      </label>
    </FormDialog>
  );
}
