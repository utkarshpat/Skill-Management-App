import { useState } from 'react';
import { FormDialog } from '../FormDialog';
import type { CertificationRecord } from './types';
import {
  CheckCheck,
  ExternalLink,
  MessageSquareMore,
  ShieldCheck,
  XCircle,
} from 'lucide-react';

interface CertificationReviewDialogProps {
  certification: CertificationRecord;
  onClose: () => void;
  onDecision: (
    id: string,
    decision: 'APPROVED' | 'CHANGES_REQUESTED' | 'REJECTED',
    feedbackNote?: string,
  ) => void;
  reviewerName?: string;
}

export function CertificationReviewDialog({
  certification,
  onClose,
  onDecision,
  reviewerName = 'Capability Lead / Manager',
}: CertificationReviewDialogProps) {
  const [feedback, setFeedback] = useState('');
  const [decisionMode, setDecisionMode] = useState<
    'idle' | 'CHANGES_REQUESTED' | 'REJECTED'
  >('idle');

  function handleApprove() {
    onDecision(certification.id, 'APPROVED', feedback);
    onClose();
  }

  function handleConfirmRejectionOrChanges() {
    if (decisionMode === 'idle') return;
    onDecision(certification.id, decisionMode, feedback);
    onClose();
  }

  return (
    <FormDialog
      title="Verify Certification Record"
      subtitle={`Review official credential claim for ${certification.name} (${certification.employeeCode})`}
      onClose={onClose}
      className="certification-review-modal"
    >
      <div className="certification-review-content">
        {/* Verification Summary Banner */}
        <div className="cert-review-banner">
          <div className="cert-review-banner-header">
            <div>
              <span className="cert-category-badge">{certification.category}</span>
              <h3 className="cert-review-title">{certification.certificationName}</h3>
              <p className="cert-review-issuer">
                Issuer: <strong>{certification.provider}</strong> • Delivery Unit: <strong>{certification.du}</strong>
              </p>
            </div>
            <div className="cert-review-status-pill">
              <span className={`status-pill status-${certification.status.toLowerCase()}`}>
                {certification.status}
              </span>
            </div>
          </div>
        </div>

        {/* Verification Metadata Grid */}
        <div className="cert-meta-grid">
          <div className="cert-meta-item">
            <span className="meta-label">Candidate</span>
            <span className="meta-value">{certification.name}</span>
          </div>
          <div className="cert-meta-item">
            <span className="meta-label">Employee Code</span>
            <span className="meta-value">{certification.employeeCode}</span>
          </div>
          <div className="cert-meta-item">
            <span className="meta-label">Issue Date</span>
            <span className="meta-value">{certification.certificationDate}</span>
          </div>
          <div className="cert-meta-item">
            <span className="meta-label">Expiry Date</span>
            <span className="meta-value">
              {certification.doesNotExpire === 'Yes'
                ? 'Does Not Expire (2050-12-31)'
                : certification.expiryDate}
            </span>
          </div>
          <div className="cert-meta-item">
            <span className="meta-label">Credential ID</span>
            <span className="meta-value">{certification.credentialId || 'N/A'}</span>
          </div>
          <div className="cert-meta-item">
            <span className="meta-label">Work Email</span>
            <span className="meta-value">{certification.emailId}</span>
          </div>
        </div>

        {/* Evidence & Credential Link Verification */}
        {certification.credentialUrl && (
          <div className="cert-evidence-box">
            <div className="evidence-header">
              <ShieldCheck size={18} className="text-teal" />
              <h4>Digital Credential Verification Link</h4>
            </div>
            <div className="evidence-link-wrap">
              <a
                href={certification.credentialUrl}
                target="_blank"
                rel="noreferrer noopener"
                className="cert-external-link"
              >
                <span>{certification.credentialUrl}</span>
                <ExternalLink size={14} />
              </a>
            </div>
            <p className="evidence-hint">
              Click the link above to inspect the issuer's public badge / transcript.
            </p>
          </div>
        )}

        {/* Feedback / Reason Input */}
        <div className="cert-feedback-section">
          <label htmlFor="review-feedback">
            Reviewer Feedback / Audit Note{' '}
            {decisionMode !== 'idle' ? '(Mandatory for changes/rejection)' : '(Optional)'}
          </label>
          <textarea
            id="review-feedback"
            rows={3}
            placeholder={
              decisionMode === 'CHANGES_REQUESTED'
                ? 'Specify the additional details or revised credential link required from the candidate…'
                : decisionMode === 'REJECTED'
                  ? 'State reason for not approving this certification…'
                  : 'Add notes for the audit trail (optional)…'
            }
            value={feedback}
            onChange={e => setFeedback(e.target.value)}
          />
        </div>

        {/* Decision Actions Bar */}
        <div className="certification-review-footer">
          {decisionMode === 'idle' ? (
            <>
              <button
                type="button"
                className="secondary-button"
                onClick={onClose}
              >
                Cancel
              </button>
              <div className="review-action-buttons">
                <button
                  type="button"
                  className="secondary-button button-tone-rose"
                  onClick={() => setDecisionMode('REJECTED')}
                >
                  <XCircle size={16} />
                  Reject
                </button>
                <button
                  type="button"
                  className="secondary-button button-tone-blue"
                  onClick={() => setDecisionMode('CHANGES_REQUESTED')}
                >
                  <MessageSquareMore size={16} />
                  Request Changes
                </button>
                <button
                  type="button"
                  className="primary-button button-tone-teal"
                  onClick={handleApprove}
                >
                  <CheckCheck size={16} />
                  Approve & Verify
                </button>
              </div>
            </>
          ) : (
            <div className="confirm-decision-row">
              <button
                type="button"
                className="secondary-button"
                onClick={() => setDecisionMode('idle')}
              >
                Back
              </button>
              <button
                type="button"
                className={`primary-button ${
                  decisionMode === 'REJECTED' ? 'button-tone-rose' : 'button-tone-blue'
                }`}
                disabled={!feedback.trim()}
                onClick={handleConfirmRejectionOrChanges}
              >
                Confirm {decisionMode === 'REJECTED' ? 'Rejection' : 'Changes Request'}
              </button>
            </div>
          )}
        </div>
      </div>
    </FormDialog>
  );
}
