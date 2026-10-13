import { credentialValidity } from '../certifications/certification-model';
import { useEffect, useRef, useState } from 'react';
import { FormDialog } from '../FormDialog';
import { authenticatedFetch } from '../auth';
import { readApiResponse } from '../api-response';
import { CapabilityEvidence } from './CapabilityEvidence';
import { toast } from '../toast';
import type { Submission } from './capability-model';
import { submissionLevelName, submissionReviewState } from './capability-model';
import {
  AlertCircle,
  Award,
  CheckCircle2,
  Clock3,
  Code2,
  ExternalLink,
  ShieldCheck,
  XCircle,
} from 'lucide-react';

export function CapabilityReview({
  id,
  employeeName,
  submissionLabel,
  readOnly = false,
  onClose,
  onSaved,
}: {
  id: string;
  employeeName?: string;
  submissionLabel?: string;
  readOnly?: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [data, setData] = useState<Submission>(),
    [error, setError] = useState(''),
    [decisions, setDecisions] = useState<Record<string, { action: string; feedback: string }>>({}),
    [busy, setBusy] = useState(false),
    lock = useRef(false);

  useEffect(() => {
    const abort = new AbortController();
    setData(undefined);
    setError('');
    setDecisions({});
    authenticatedFetch('/api/capability-submissions/' + id, { signal: abort.signal })
      .then(r => readApiResponse<Submission>(r, 'Submission unavailable.'))
      .then(v => {
        if (!abort.signal.aborted) setData(v);
      })
      .catch(e => {
        if (!abort.signal.aborted) setError(e.message);
      });
    return () => abort.abort();
  }, [id]);

  const rows = data
    ? [
        ...data.skills.map(s => ({ ...s, kind: 'SKILL' })),
        ...data.certifications.map(c => ({
          ...c,
          kind: 'CERTIFICATION',
          name: c.certificationName,
        })),
      ]
    : [];

  useEffect(() => {
    if (!data) return;
    const initial: Record<string, { action: string; feedback: string }> = {};
    for (const s of data.skills) {
      if (s.needsReview) {
        initial['SKILL' + s.id] = { action: 'APPROVE', feedback: '' };
      }
    }
    for (const c of data.certifications) {
      if (c.needsReview) {
        initial['CERTIFICATION' + c.id] = { action: 'APPROVE', feedback: '' };
      }
    }
    setDecisions(prev => {
      const merged = { ...initial };
      for (const [k, v] of Object.entries(prev)) {
        if (v && v.feedback) merged[k] = v;
      }
      return merged;
    });
  }, [data]);

  async function save() {
    if (!data || readOnly || data.status !== 'SUBMITTED' || lock.current) return;
    const pending = rows.filter(r => r.needsReview);
    if (pending.some(r => !decisions[r.kind + r.id]?.feedback?.trim())) {
      setError('Please add feedback notes for every pending item before saving.');
      return;
    }
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      await readApiResponse(
        await authenticatedFetch('/api/capability-submissions/decision', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id,
            revision: data.revision,
            decisions: pending.map(r => ({
              id: r.id,
              kind: r.kind,
              revision: r.revision,
              action: decisions[r.kind + r.id]?.action ?? 'APPROVE',
              feedback: decisions[r.kind + r.id]?.feedback?.trim() ?? '',
            })),
          }),
        }),
        'Review was not confirmed. Reload before retrying.',
      );
      toast.success('Individual decisions saved for this review request.');
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }

  async function reroute() {
    if (!data?.canReroute || lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      await readApiResponse(
        await authenticatedFetch('/api/capability-submissions/reroute', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id,
            revision: data.revision,
            skills: data.skills.map(s => ({ id: s.id, revision: s.revision })),
            certifications: data.certifications.map(c => ({ id: c.id, revision: c.revision })),
          }),
        }),
        'Reassignment was not confirmed. Reload before retrying.',
      );
      toast.success('Request sent to your current manager.');
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }

  const skillRows = rows.filter(r => r.kind === 'SKILL');
  const certRows = rows.filter(r => r.kind === 'CERTIFICATION');
  const pendingCount = rows.filter(r => r.needsReview).length;
  const canDecide = !readOnly && data?.status === 'SUBMITTED';

  return (
    <FormDialog
      title={readOnly ? 'Skills & supporting certificates' : 'Review skill request'}
      subtitle={
        employeeName
          ? `Submitted by ${employeeName}${submissionLabel ? ` · ${submissionLabel}` : ''}`
          : 'One request; separate decisions for each skill and credential'
      }
      busy={busy}
      onClose={onClose}
      className="capability-composer cap-review-dialog"
      message={error && <p role="alert">{error}</p>}
      footer={
        <>
          <button type="button" className="secondary-button" disabled={busy} onClick={onClose}>
            Close
          </button>
          {readOnly && data?.canReroute && (
            <button
              type="button"
              className="admin-primary"
              disabled={busy}
              onClick={() => void reroute()}
            >
              Send to current manager
            </button>
          )}
          {!readOnly && data?.status === 'SUBMITTED' && (
            <button
              type="button"
              className="admin-primary"
              disabled={busy}
              onClick={() => void save()}
            >
              {pendingCount > 0
                ? `Save review decisions (${pendingCount})`
                : 'Save review decisions'}
            </button>
          )}
        </>
      }
    >
      <div className="cap-review-container">
        {!data && !error && <p role="status">Loading submitted capabilities…</p>}
        {data?.intake && (
          <p className="cap-callout">
            This draft is incomplete. Choose Continue in Skills to finish it.
          </p>
        )}

        {data && (
          <div className="cap-review-summary-bar">
            <div className="cap-review-summary-left">
              <span className="cap-review-summary-name">
                <strong>{employeeName || 'Team member'}</strong>
              </span>
              <div className="cap-review-summary-counts">
                <span className="cap-meta-pill">
                  <Code2 size={12} aria-hidden="true" />
                  {skillRows.length} {skillRows.length === 1 ? 'skill' : 'skills'}
                </span>
                <span className="cap-meta-pill">
                  <Award size={12} aria-hidden="true" />
                  {certRows.length} {certRows.length === 1 ? 'certificate' : 'certificates'}
                </span>
              </div>
            </div>
            <div className="cap-review-summary-right">
              <span className={`cap-status-pill ${data?.status?.toLowerCase() ?? 'submitted'}`}>
                {readOnly ? 'View only' : `${pendingCount} awaiting decision`}
              </span>
            </div>
          </div>
        )}

        {rows.map(row => {
          const key = row.kind + row.id;
          const isSkill = row.kind === 'SKILL';
          const decision = decisions[key] ?? { action: 'APPROVE', feedback: '' };
          const linkedCerts = isSkill
            ? (data?.certifications.filter(c =>
                c.relatedSkills?.some((link: any) => link.skillId === row.skillId),
              ) ?? [])
            : [];
          const linkedSkills = !isSkill
            ? (data?.skills.filter(s =>
                row.relatedSkills?.some((link: any) => link.skillId === s.skillId),
              ) ?? [])
            : [];
          const levelName = isSkill ? submissionLevelName(row) : '';
          const expLabel = isSkill
            ? `${row.experienceMonths} ${row.experienceMonths === 1 ? 'month' : 'months'} experience`
            : '';

          return (
            <article
              key={key}
              className={`cap-review-card ${row.needsReview ? 'needs-review' : 'is-verified'}`}
            >
              <header className="cap-review-card-header">
                <div className="cap-review-header-left">
                  <span className={`cap-kind-tag ${isSkill ? 'skill' : 'cert'}`}>
                    {isSkill ? 'SKILL' : 'CREDENTIAL'}
                  </span>
                  <h4 className="cap-review-title">{row.name}</h4>
                  <div className="cap-review-meta-inline">
                    {isSkill ? (
                      <>
                        <span className="cap-meta-pill highlight">
                          Level {row.rank}
                          {levelName ? ` · ${levelName}` : ''}
                        </span>
                        <span className="cap-meta-pill">{expLabel}</span>
                      </>
                    ) : (
                      <>
                        <span className="cap-meta-pill highlight">{row.provider}</span>
                        <span className="cap-meta-pill">{row.category}</span>
                        <span className="cap-meta-pill">
                          {row.expiryDate
                            ? `${credentialValidity(row.expiryDate.slice(0, 10), new Date().toISOString().slice(0, 10))} · ${row.expiryDate.slice(0, 10)}`
                            : 'Does not expire'}
                        </span>
                      </>
                    )}
                  </div>
                </div>
                <div className="cap-review-header-right">
                  {canDecide && row.needsReview ? (
                    <span className="cap-status-badge pending">
                      <Clock3 size={12} aria-hidden="true" /> Needs decision
                    </span>
                  ) : (
                    <span className="cap-status-badge verified">
                      <ShieldCheck size={12} aria-hidden="true" />{' '}
                      {submissionReviewState(row.status, row.needsReview, false)}
                    </span>
                  )}
                </div>
              </header>

              <div className="cap-review-body">
                {isSkill && (
                  <>
                    {row.description && (
                      <div className="cap-detail-row">
                        <span className="cap-detail-label">Description:</span>
                        <span className="cap-detail-val">{row.description}</span>
                      </div>
                    )}
                    {row.projects && (
                      <div className="cap-detail-row">
                        <span className="cap-detail-label">Projects:</span>
                        <span className="cap-detail-val">{row.projects}</span>
                      </div>
                    )}
                    {row.evidence && (
                      <div className="cap-detail-row">
                        <span className="cap-detail-label">Claim details:</span>
                        <span className="cap-detail-val font-pre">{row.evidence}</span>
                      </div>
                    )}
                    {linkedCerts.length > 0 && (
                      <div className="cap-linked-row">
                        <span className="cap-detail-label">Supporting credential:</span>
                        <div className="cap-linked-items">
                          {linkedCerts.map((c: any) => (
                            <span key={c.id} className="cap-link-pill">
                              <Award size={13} aria-hidden="true" /> {c.certificationName}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                    <CapabilityEvidence submissionId={id} recordId={row.id} hideIfEmpty />
                  </>
                )}

                {!isSkill && (
                  <>
                    <div className="cap-cert-grid">
                      <div className="cap-cert-item">
                        <span className="cap-detail-label">Issue date</span>
                        <span className="cap-detail-val">
                          {row.certificationDate?.slice(0, 10) || 'Not recorded'}
                        </span>
                      </div>
                      <div className="cap-cert-item">
                        <span className="cap-detail-label">Validity</span>
                        <span className="cap-detail-val">
                          {row.expiryDate
                            ? `${credentialValidity(row.expiryDate.slice(0, 10), new Date().toISOString().slice(0, 10))} · ${row.expiryDate.slice(0, 10)}`
                            : 'Does not expire'}
                        </span>
                      </div>
                      {row.credentialId && (
                        <div className="cap-cert-item">
                          <span className="cap-detail-label">Credential ID</span>
                          <span className="cap-detail-val font-mono">{row.credentialId}</span>
                        </div>
                      )}
                      {row.credentialUrl && /^https?:\/\//i.test(row.credentialUrl) && (
                        <div className="cap-cert-item">
                          <span className="cap-detail-label">Verification link</span>
                          <a
                            href={row.credentialUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="cap-cert-url"
                          >
                            Verify credential <ExternalLink size={12} aria-hidden="true" />
                          </a>
                        </div>
                      )}
                    </div>
                    {row.notes && (
                      <div className="cap-detail-row">
                        <span className="cap-detail-label">Notes:</span>
                        <span className="cap-detail-val">{row.notes}</span>
                      </div>
                    )}
                    {linkedSkills.length > 0 && (
                      <div className="cap-linked-row">
                        <span className="cap-detail-label">Supports skill claims:</span>
                        <div className="cap-linked-items">
                          {linkedSkills.map((s: any) => (
                            <span key={s.id} className="cap-link-pill">
                              <Code2 size={13} aria-hidden="true" /> {s.name}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                    <div className="cap-cert-doc-preview">
                      <span className="cap-detail-label">Attached document:</span>
                      <CapabilityEvidence submissionId={id} recordId={row.id} />
                    </div>
                  </>
                )}

                {row.feedback && (
                  <div className="cap-feedback-recorded">
                    <strong>Recorded feedback:</strong> {row.feedback}
                  </div>
                )}
              </div>

              {canDecide && row.needsReview && (
                <footer className="cap-review-decision-footer">
                  <div className="cap-decision-choice-row">
                    <span className="cap-decision-legend">Record decision:</span>
                    <div
                      className="cap-decision-toggle-group"
                      role="radiogroup"
                      aria-label={`Decision for ${row.name}`}
                    >
                      <button
                        type="button"
                        className={`cap-decision-btn approve ${decision.action === 'APPROVE' ? 'is-active' : ''}`}
                        onClick={() =>
                          setDecisions(prev => ({
                            ...prev,
                            [key]: { ...decision, action: 'APPROVE' },
                          }))
                        }
                        role="radio"
                        disabled={busy}
                        aria-checked={decision.action === 'APPROVE'}
                      >
                        <CheckCircle2 size={14} aria-hidden="true" /> Approve
                      </button>
                      <button
                        type="button"
                        className={`cap-decision-btn changes ${decision.action === 'REQUEST_CHANGES' ? 'is-active' : ''}`}
                        onClick={() =>
                          setDecisions(prev => ({
                            ...prev,
                            [key]: { ...decision, action: 'REQUEST_CHANGES' },
                          }))
                        }
                        role="radio"
                        disabled={busy}
                        aria-checked={decision.action === 'REQUEST_CHANGES'}
                      >
                        <AlertCircle size={14} aria-hidden="true" /> Request changes
                      </button>
                      <button
                        type="button"
                        className={`cap-decision-btn reject ${decision.action === 'REJECT' ? 'is-active' : ''}`}
                        onClick={() =>
                          setDecisions(prev => ({
                            ...prev,
                            [key]: { ...decision, action: 'REJECT' },
                          }))
                        }
                        role="radio"
                        disabled={busy}
                        aria-checked={decision.action === 'REJECT'}
                      >
                        <XCircle size={14} aria-hidden="true" /> Reject
                      </button>
                    </div>
                  </div>
                  <div className="cap-feedback-input-row">
                    <label htmlFor={`fb-${key}`}>
                      Feedback notes <span className="cert-required-mark">*</span>
                    </label>
                    <textarea
                      id={`fb-${key}`}
                      rows={2}
                      disabled={busy}
                      maxLength={2000}
                      value={decision.feedback}
                      placeholder={
                        decision.action === 'APPROVE'
                          ? 'Add confirmation notes (e.g. Verified demonstrated proficiency)...'
                          : decision.action === 'REQUEST_CHANGES'
                            ? 'Explain what changes or additional proof is required...'
                            : 'Provide reason for rejection...'
                      }
                      onChange={e =>
                        setDecisions(prev => ({
                          ...prev,
                          [key]: { ...decision, feedback: e.target.value },
                        }))
                      }
                    />
                  </div>
                </footer>
              )}

              {canDecide && !row.needsReview && (
                <footer className="cap-review-verified-footer">
                  <ShieldCheck size={15} aria-hidden="true" />
                  <span>Previously manager reviewed · No review required</span>
                </footer>
              )}
            </article>
          );
        })}
      </div>
    </FormDialog>
  );
}
