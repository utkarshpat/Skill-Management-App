import { useState } from 'react';
import { authenticatedFetch } from './auth';
import { FormDialog } from './FormDialog';
import type { Claim } from './MySkills';
import { ReviewHistory } from './ReviewHistory';
import { ReviewAssistance } from './ReviewAssistance';
import { ClaimReviewAccess } from './ClaimReviewAccess';
import './review-workbench.css';
import { formatSkillDate } from './skill-dates';
async function result(response: Response) {
  const data = await response.json().catch(() => undefined);
  if (!response.ok)
    throw Error(
      data?.error?.message ??
        'This action could not finish. Reload to check the current state before retrying.',
    );
  return data;
}

/**
 * Interactive dialog component for inspecting, submitting, or reviewing skill claims.
 *
 * Supported modes:
 * - `view`: Displays current claim metadata, criteria evidence, and review history
 * - `submit`: Allows the claimant to submit draft claims for manager review
 * - `review`: Displays manager workbench to approve, request changes, or decline submitted claims,
 *             with server-enforced effective access checks and AI-assisted review suggestions.
 */
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
  onSaved: () => void;
}) {
  const [page, setPage] = useState(0),
    [feedback, setFeedback] = useState(''),
    [decision, setDecision] = useState('REQUEST_CHANGES'),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  async function apply() {
    if (busy || (mode === 'review' && !claim.reviewAccess?.allowed)) return;
    setBusy(true);
    setError('');
    try {
      await result(
        await authenticatedFetch(
          mode === 'submit' ? '/api/my-skills/submit' : '/api/skill-reviews/decision',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              id: claim.id,
              revision: claim.revision,
              action: mode === 'submit' ? 'SUBMIT' : decision,
              feedback,
            }),
          },
        ),
      );
      onSaved();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not complete this review.');
    } finally {
      setBusy(false);
    }
  }
  const textPages = (label: string, text: string) =>
    ((text || 'None provided.').match(/[\s\S]{1,650}/g) ?? []).map((part, index) => ({
      label: label + (index ? ' (continued)' : ''),
      content: (
        <>
          <h3>{label}</h3>
          <p className="claim-level-description">{part}</p>
        </>
      ),
    }));
  const pages = [
    {
      label: 'Claim summary',
      content: (
        <>
          <h3>{claim.personName ?? claim.skillName}</h3>
          {history && <ClaimReviewAccess decision={claim.reviewAccess} />}
          <dl className="profile-details">
            <div>
              <dt>Skill</dt>
              <dd>{claim.skillName}</dd>
            </div>
            <div>
              <dt>Proficiency</dt>
              <dd>
                {claim.levelName} · Level {claim.rank}
              </dd>
            </div>
            <div>
              <dt>Experience</dt>
              <dd>{claim.experienceMonths} months</dd>
            </div>
            <div>
              <dt>Last used</dt>
              <dd>{formatSkillDate(claim.lastUsedOn)}</dd>
            </div>
            <div>
              <dt>Status</dt>
              <dd>{claim.status.replaceAll('_', ' ')}</dd>
            </div>
          </dl>
        </>
      ),
    },
    ...textPages('Experience', claim.description),
    ...textPages('Level criteria', claim.levelDescription ?? ''),
    ...textPages('Projects', claim.projects ?? ''),
    ...textPages('Evidence references', claim.evidence ?? ''),
    ...(history
      ? [
          {
            label: 'AI assistance',
            content: (
              <ReviewAssistance
                claim={claim}
                canDraft={mode === 'review'}
                decision={decision}
                onDecision={setDecision}
                onUse={setFeedback}
                hasFeedback={Boolean(feedback.trim())}
              />
            ),
          },
          { label: 'History', content: <ReviewHistory id={claim.id} /> },
        ]
      : []),
    {
      label: mode === 'review' ? 'Decision' : 'Review',
      content:
        mode === 'review' ? (
          <>
            <label>
              Decision
              <select
                value={decision}
                disabled={busy}
                onChange={event => setDecision(event.target.value)}
              >
                <option value="REQUEST_CHANGES">Request changes</option>
                <option value="APPROVE">Approve</option>
                <option value="REJECT">Reject</option>
              </select>
            </label>
            <label>
              Feedback
              <textarea
                rows={5}
                required
                maxLength={2000}
                value={feedback}
                disabled={busy}
                onChange={event => setFeedback(event.target.value)}
              />
            </label>
            <p>
              Approval records a manager-reviewed proficiency claim, separate from learning quizzes
              and certifications.
            </p>
          </>
        ) : (
          <>
            <h3>{mode === 'submit' ? 'Confirm submission' : 'Review status'}</h3>
            {mode === 'submit' && (
              <p>
                Your current reporting manager will receive this submission. Submitted claims cannot
                be edited until changes are requested or the claim is rejected. If your manager
                changed, resubmitting routes the pending claim to the current manager.
              </p>
            )}
          </>
        ),
    },
    ...(mode !== 'review'
      ? textPages('Manager feedback', claim.feedback ?? 'No review feedback yet.')
      : []),
  ];
  return (
    <FormDialog
      title={
        mode === 'review'
          ? 'Review skill claim'
          : mode === 'submit'
            ? 'Submit skill claim'
            : claim.skillName
      }
      busy={busy}
      onClose={onClose}
      page={page}
      onPageChange={setPage}
      message={error && <p role="alert">{error}</p>}
      pages={pages}
      footer={
        <>
          <button className="secondary-button" disabled={busy} onClick={onClose}>
            {mode === 'view' ? 'Close' : 'Cancel'}
          </button>
          {page < pages.length - 1 ? (
            <button
              className="admin-primary"
              disabled={busy}
              onClick={() => setPage(value => value + 1)}
            >
              Continue
            </button>
          ) : (
            mode !== 'view' && (
              <button
                className="admin-primary"
                disabled={
                  busy || (mode === 'review' && (!feedback.trim() || !claim.reviewAccess?.allowed))
                }
                onClick={() => void apply()}
              >
                {busy ? 'Saving…' : mode === 'submit' ? 'Submit for review' : 'Confirm decision'}
              </button>
            )
          )}
        </>
      }
    />
  );
}
