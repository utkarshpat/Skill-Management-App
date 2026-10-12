import { useState } from 'react';
import {
  CheckCircle2,
  MessageSquareMore,
  XCircle,
  Clock3,
  BriefcaseBusiness,
  ShieldCheck,
  UserRound,
  AlertCircle,
} from 'lucide-react';
import { authenticatedFetch } from './auth';
import { FormDialog } from './FormDialog';
import type { Claim } from './MySkills';
import { ReviewHistory } from './ReviewHistory';
import { ReviewAssistance } from './ReviewAssistance';
import { ClaimReviewAccess } from './ClaimReviewAccess';
import { ClaimEvidence } from './ClaimEvidence';
import { RelatedCapabilities } from './capabilities/RelatedCapabilities';
import { formatSkillDate } from './skill-dates';
import './claim-review.css';

export function SkillClaimDialog({
  claim,
  mode,
  onClose,
  onSaved,
  history = false,
}: {
  history?: boolean;
  claim: Claim;
  mode: 'view' | 'submit' | 'review';
  onClose: () => void;
  onSaved: (action?: 'submitted' | 'reviewed') => void;
}) {
  const [feedback, setFeedback] = useState(''),
    [decision, setDecision] = useState('REQUEST_CHANGES'),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const [revision, setRevision] = useState(claim.revision);
  const [uploading, setUploading] = useState(false);
  const working = busy || uploading;
  const close = () => {
    if (working) return;
    return revision !== claim.revision ? onSaved() : onClose();
  };
  const allowed = Boolean(claim.reviewAccess?.allowed),
    review = mode === 'review';
  async function apply() {
    if (working || (review && !allowed)) return;
    setBusy(true);
    setError('');
    try {
      const r = await authenticatedFetch(
        mode === 'submit' ? '/api/my-skills/submit' : '/api/skill-reviews/decision',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: claim.id,
            revision,
            action: mode === 'submit' ? 'SUBMIT' : decision,
            feedback,
          }),
        },
      );
      const data = await r.json().catch(() => undefined);
      if (!r.ok) throw Error(data?.error?.message ?? 'Could not save. Refresh and try again.');
      onSaved(mode === 'submit' ? 'submitted' : 'reviewed');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not save the review.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <FormDialog
      title={
        review ? 'Review skill claim' : mode === 'submit' ? 'Submit for review' : claim.skillName
      }
      subtitle={claim.personName ? `${claim.personName} · ${claim.skillName}` : claim.category}
      className="claim-review-dialog"
      busy={working}
      onClose={close}
      message={error && <p role="alert">{error}</p>}
      footer={
        <>
          <span className="claim-save-note">
            <ShieldCheck size={15} />
            Current access is checked on save
          </span>
          <button className="secondary-button" disabled={working} onClick={close}>
            {mode === 'view' ? 'Close' : 'Cancel'}
          </button>
          {mode !== 'view' && (
            <button
              className="admin-primary"
              disabled={working || (review && (!feedback.trim() || !allowed))}
              onClick={() => void apply()}
            >
              {busy
                ? 'Saving…'
                : mode === 'submit'
                  ? 'Submit for review'
                  : decision === 'APPROVE'
                    ? 'Confirm verification'
                    : decision === 'REJECT'
                      ? 'Confirm rejection'
                      : 'Send change request'}
            </button>
          )}
        </>
      }
    >
      <div className={'claim-review-layout' + (review ? '' : ' read-only')}>
        <section className="claim-review-content">
          {!review && (
            <div className="claim-status-banner">
              <div className="claim-status-banner-left">
                <span className="claim-status-label">Review status:</span>
                <span className={`cap-status-pill ${claim.status.toLowerCase()}`}>
                  {claim.status === 'APPROVED' ? (
                    <ShieldCheck size={12} aria-hidden="true" />
                  ) : claim.status === 'SUBMITTED' ? (
                    <Clock3 size={12} aria-hidden="true" />
                  ) : claim.status === 'DRAFT' ? (
                    <UserRound size={12} aria-hidden="true" />
                  ) : (
                    <AlertCircle size={12} aria-hidden="true" />
                  )}
                  {claim.status === 'SUBMITTED'
                    ? 'Awaiting review'
                    : claim.status.replaceAll('_', ' ')}
                </span>
              </div>
              {claim.updatedAt && (
                <span className="claim-status-date">
                  Updated{' '}
                  {new Date(claim.updatedAt).toLocaleDateString('en-GB', {
                    day: '2-digit',
                    month: 'short',
                    year: 'numeric',
                  })}
                </span>
              )}
            </div>
          )}

          <div className="claim-review-facts">
            <div className="claim-fact-level-card">
              <div className="claim-fact-level-header">
                <strong>Level {claim.rank}</strong>
                <div className="claim-fact-bars" aria-hidden="true">
                  {Array.from({ length: 4 }, (_, i) => (
                    <i key={i} className={i < claim.rank ? 'filled' : 'empty'} />
                  ))}
                </div>
              </div>
              <span className="claim-fact-level-name">{claim.levelName}</span>
              {claim.levelDescription && (
                <p className="claim-fact-desc">{claim.levelDescription}</p>
              )}
            </div>
            <div>
              <BriefcaseBusiness size={20} />
              <strong>
                {claim.experienceMonths < 12
                  ? `${claim.experienceMonths} ${claim.experienceMonths === 1 ? 'month' : 'months'}`
                  : `${Number((claim.experienceMonths / 12).toFixed(1))} ${claim.experienceMonths === 12 ? 'year' : 'years'}`}
              </strong>
              <span>Experience</span>
            </div>
            <div>
              <Clock3 size={20} />
              <strong>{formatSkillDate(claim.lastUsedOn)}</strong>
              <span>Last used</span>
            </div>
          </div>
          <section className="claim-content-block">
            <h3>Experience & projects</h3>
            <p>{claim.description || 'No experience description provided.'}</p>
            {claim.projects && (
              <>
                <h4>Projects</h4>
                <p>{claim.projects}</p>
              </>
            )}
          </section>
          <section className="claim-content-block">
            <RelatedCapabilities kind="SKILL" id={claim.id} />
          </section>
          <section className="claim-content-block">
            <h3>Attached evidence images</h3>
            <ClaimEvidence
              claim={claim}
              reviewer={review || history}
              onRevision={setRevision}
              onBusy={setUploading}
            />
          </section>
          {history && (
            <details className="claim-detail">
              <summary>Review history</summary>
              <ReviewHistory id={claim.id} />
            </details>
          )}
          {claim.feedback && (
            <section className="claim-content-block">
              <h3>Manager feedback</h3>
              <p>{claim.feedback}</p>
            </section>
          )}
        </section>
        {review ? (
          <aside className="claim-decision-panel">
            <h3>Your decision</h3>
            {history && <ClaimReviewAccess decision={claim.reviewAccess} />}
            <div className="claim-decision-choices">
              {[
                {
                  value: 'APPROVE',
                  label: 'Verify',
                  hint: 'Confirm the claimed level',
                  icon: CheckCircle2,
                },
                {
                  value: 'REQUEST_CHANGES',
                  label: 'Request changes',
                  hint: 'Ask for more detail or evidence',
                  icon: MessageSquareMore,
                },
                {
                  value: 'REJECT',
                  label: 'Reject',
                  hint: 'Record why it is not supported',
                  icon: XCircle,
                },
              ].map(item => (
                <button
                  type="button"
                  className={item.value.toLowerCase()}
                  key={item.value}
                  aria-pressed={decision === item.value}
                  disabled={working || !allowed}
                  onClick={() => setDecision(item.value)}
                >
                  <item.icon size={20} />
                  <span>
                    <strong>{item.label}</strong>
                    <small>{item.hint}</small>
                  </span>
                </button>
              ))}
            </div>
            <label className="claim-feedback">
              Feedback{' '}
              <span className="skill-required" aria-hidden="true">
                *
              </span>
              <textarea
                aria-label="Review feedback"
                rows={4}
                maxLength={2000}
                disabled={working || !allowed}
                value={feedback}
                onChange={e => setFeedback(e.target.value)}
                placeholder="What supports your decision, or what should change?"
              />
            </label>
            {history && (
              <details className="claim-detail claim-ai-help">
                <summary>Help draft feedback with AI</summary>
                <ReviewAssistance
                  claim={claim}
                  canDraft={allowed}
                  decision={decision}
                  onDecision={setDecision}
                  onUse={setFeedback}
                  hasFeedback={Boolean(feedback.trim())}
                />
              </details>
            )}
            <p className="claim-decision-note">
              Verification records reviewed proficiency. Learning completion stays separate.
            </p>
          </aside>
        ) : mode === 'submit' ? (
          <section className="claim-content-block">
            <h3>Ready for manager review</h3>
            <strong>{claim.status.replaceAll('_', ' ')}</strong>
            <p>
              Your current reporting manager receives this claim. Submitted claims remain locked
              until changes are requested or rejected.
            </p>
          </section>
        ) : null}
      </div>
    </FormDialog>
  );
}
