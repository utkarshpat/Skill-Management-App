import { displayProficiencyName } from '../proficiency';
import { credentialValidity } from '../certifications/certification-model';
import { useEffect, useRef, useState } from 'react';
import { FormDialog } from '../FormDialog';
import { AskSkillGenie, focusRecordSection, recordQuestion } from '../AskSkillGenie';
import type { AssistantRecordAction } from '../assistant-record';
import { authenticatedFetch } from '../auth';
import { readApiResponse } from '../api-response';
import { CapabilityEvidence } from './CapabilityEvidence';
import { toast } from '../toast';
import type { Submission } from './capability-model';
import {
  submissionLevelName,
  submissionReviewState,
  submissionReviewSummary,
} from './capability-model';
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
  onRefresh,
  onReopen,
  initialSection,
}: {
  id: string;
  employeeName?: string;
  submissionLabel?: string;
  readOnly?: boolean;
  onClose: () => void;
  onSaved: () => void;
  onRefresh?: () => void;
  onReopen?: (section?: 'evidence' | 'feedback') => void;
  initialSection?: 'evidence' | 'feedback';
}) {
  const [data, setData] = useState<Submission>(),
    [error, setError] = useState(''),
    [decisions, setDecisions] = useState<Record<string, { action: string; feedback: string }>>({}),
    [busy, setBusy] = useState(false),
    [needsRefresh, setNeedsRefresh] = useState(false),
    request = useRef<AbortController>(undefined),
    lock = useRef(false);

  useEffect(() => {
    const abort = new AbortController();
    request.current = abort;
    setData(undefined);
    setError('');
    setDecisions({});
    setNeedsRefresh(false);
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

  useEffect(() => {
    if (data && initialSection) focusRecordSection(initialSection);
  }, [data?.id, initialSection]);

  function readSubmission(signal: AbortSignal) {
    return authenticatedFetch(`/api/capability-submissions/${encodeURIComponent(id)}`, {
      signal,
    }).then(response =>
      readApiResponse<Submission>(response, 'This approval request could not be refreshed.'),
    );
  }

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
        if (initial[k]) merged[k] = v;
      }
      return merged;
    });
  }, [data]);

  async function refreshApproval(previous: Submission, message: string) {
    setNeedsRefresh(true);
    const signal = request.current?.signal;
    try {
      const latest = await readApiResponse<Submission>(
        await authenticatedFetch('/api/capability-submissions/' + id, { signal }),
        'Approval request could not be refreshed.',
      );
      if (signal?.aborted) return;
      const unchanged = new Set([
        ...latest.skills
          .filter(
            row =>
              row.needsReview &&
              previous.skills.some(old => old.id === row.id && old.revision === row.revision),
          )
          .map(row => 'SKILL' + row.id),
        ...latest.certifications
          .filter(
            row =>
              row.needsReview &&
              previous.certifications.some(
                old => old.id === row.id && old.revision === row.revision,
              ),
          )
          .map(row => 'CERTIFICATION' + row.id),
      ]);
      setDecisions(current =>
        Object.fromEntries(
          [
            ...latest.skills.filter(row => row.needsReview).map(row => 'SKILL' + row.id),
            ...latest.certifications
              .filter(row => row.needsReview)
              .map(row => 'CERTIFICATION' + row.id),
          ].map(key => [
            key,
            unchanged.has(key)
              ? (current[key] ?? { action: 'APPROVE', feedback: '' })
              : { action: '', feedback: '' },
          ]),
        ),
      );
      setData(latest);
      const stillPending =
        latest.status === 'SUBMITTED' &&
        (readOnly ||
          latest.skills.some(row => row.needsReview) ||
          latest.certifications.some(row => row.needsReview));
      const changed =
        latest.revision !== previous.revision ||
        latest.skills.some(row => row.needsReview && !unchanged.has('SKILL' + row.id)) ||
        latest.certifications.some(
          row => row.needsReview && !unchanged.has('CERTIFICATION' + row.id),
        );
      setNeedsRefresh(stillPending && !changed);
      setError(
        stillPending && changed ? `${message} Check the updated request before saving.` : message,
      );
      window.dispatchEvent(new Event('notifications-updated'));
      onRefresh?.();
    } catch (error) {
      if (signal?.aborted) return;
      const status = (error as { status?: number }).status;
      if (status === 401 || status === 403 || status === 404) {
        setData(undefined);
        setDecisions({});
        setNeedsRefresh(false);
        onRefresh?.();
      }
      setError((error as Error).message);
    }
  }

  async function save() {
    if (!data || readOnly || data.status !== 'SUBMITTED' || needsRefresh || lock.current) return;
    const pending = rows.filter(r => r.needsReview);
    if (!pending.length || pending.some(row => decisions[row.kind + row.id]?.action === '')) return;
    if (
      pending.some(r => {
        const decision = decisions[r.kind + r.id];
        return decision && decision.action !== 'APPROVE' && !decision.feedback.trim();
      })
    ) {
      setError('Add feedback for each rejection or change request.');
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
        'Decision was not confirmed. Reload before retrying.',
      );
      toast.success('Individual decisions saved for this approval request.');
      onSaved();
    } catch (e) {
      setError((e as Error).message);
      if ([403, 409].includes((e as { status?: number }).status ?? 0))
        await refreshApproval(data, (e as Error).message);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }

  async function reroute() {
    if (!data?.canReroute || needsRefresh || lock.current) return;
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
      if ([403, 409].includes((e as { status?: number }).status ?? 0))
        await refreshApproval(data, (e as Error).message);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }

  const skillRows = rows.filter(r => r.kind === 'SKILL');
  const certRows = rows.filter(r => r.kind === 'CERTIFICATION');
  const hasUnsavedDecision = Object.values(decisions).some(
    decision => decision.action !== 'APPROVE' || decision.feedback.trim(),
  );
  const {
    pendingCount,
    canDecide,
    label: summaryLabel,
  } = submissionReviewSummary(data?.status, rows, readOnly);

  return (
    <FormDialog
      title={readOnly ? 'Skills & supporting certificates' : 'Skill approval request'}
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
          {needsRefresh && data && (
            <button
              type="button"
              className="secondary-button"
              disabled={busy}
              onClick={async () => {
                if (lock.current) return;
                lock.current = true;
                setBusy(true);
                try {
                  await refreshApproval(data, error);
                } finally {
                  lock.current = false;
                  setBusy(false);
                }
              }}
            >
              Refresh request
            </button>
          )}
          {readOnly && data?.canReroute && (
            <button
              type="button"
              className="admin-primary"
              disabled={busy || needsRefresh}
              onClick={() => void reroute()}
            >
              Send to current manager
            </button>
          )}
          {canDecide && pendingCount > 0 && (
            <button
              type="button"
              className="admin-primary"
              disabled={
                busy ||
                needsRefresh ||
                rows.some(row => row.needsReview && decisions[row.kind + row.id]?.action === '')
              }
              onClick={() => void save()}
            >
              {pendingCount > 0
                ? `Save approval decisions (${pendingCount})`
                : 'Save approval decisions'}
            </button>
          )}
        </>
      }
    >
      <div className="cap-review-container">
        {data && onReopen && !busy && !hasUnsavedDecision && (
          <AskSkillGenie
            onOpen={onClose}
            load={async signal => {
              const latest = await readSubmission(signal);
              const prompt = recordQuestion(
                'What evidence is recorded for this request and what should I check next?',
                [
                  `Skills: ${latest.skills.length}; certificates: ${latest.certifications.length}.`,
                  ...latest.skills.map(
                    skill =>
                      `${String(skill.name).slice(0, 64)}: ${[skill.projects && 'project details', skill.evidence && 'supporting references', skill.description && 'experience description'].filter(Boolean).join(', ') || 'no written evidence shown'}.`,
                  ),
                  ...latest.certifications.map(
                    cert =>
                      `${String(cert.certificationName).slice(0, 64)}: ${submissionReviewState(String(cert.status), false, false)}.`,
                  ),
                ],
              );
              const hasFeedback = (submission: Submission) =>
                [...submission.skills, ...submission.certifications].some(
                  row => typeof row.feedback === 'string' && row.feedback.trim(),
                );
              const actions: AssistantRecordAction[] = [
                {
                  label: 'Back to this record',
                  run: async signal => {
                    await readSubmission(signal);
                    if (!signal.aborted) onReopen();
                  },
                },
              ];
              if (latest.skills.length || latest.certifications.length)
                actions.push({
                  label: 'View evidence',
                  run: async signal => {
                    const current = await readSubmission(signal);
                    if (!current.skills.length && !current.certifications.length)
                      throw new Error('Evidence is no longer available for this request.');
                    if (!signal.aborted) onReopen('evidence');
                  },
                });
              if (hasFeedback(latest))
                actions.push({
                  label: 'Open feedback',
                  run: async signal => {
                    const current = await readSubmission(signal);
                    if (!hasFeedback(current))
                      throw new Error('Feedback is no longer available for this request.');
                    if (!signal.aborted) onReopen('feedback');
                  },
                });
              return {
                prompt,
                record: { label: submissionLabel || 'Skill approval request', actions },
              };
            }}
          />
        )}
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
                {summaryLabel}
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
                          {levelName || displayProficiencyName(row.rank)}
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
                    <div tabIndex={-1} data-genie-section="evidence">
                      <CapabilityEvidence submissionId={id} recordId={row.id} hideIfEmpty />
                    </div>
                  </>
                )}

                {!isSkill && (
                  <>
                    {row.renewedFromId && (
                      <p className="cap-callout">
                        Renewal certificate. Approval makes this the current version and keeps the
                        previous certificate in history. Requesting changes or rejecting it keeps
                        the previous version in place.
                      </p>
                    )}
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
                      <div tabIndex={-1} data-genie-section="evidence">
                        <CapabilityEvidence submissionId={id} recordId={row.id} />
                      </div>
                    </div>
                  </>
                )}

                {row.feedback && (
                  <div
                    className="cap-feedback-recorded"
                    tabIndex={-1}
                    data-genie-section="feedback"
                  >
                    <strong>Recorded feedback:</strong> {row.feedback}
                  </div>
                )}
              </div>

              {canDecide && row.needsReview && (
                <footer className="cap-review-decision-footer">
                  <div className="cap-decision-choice-row">
                    <span className="cap-decision-legend">
                      {decision.action
                        ? 'Record decision:'
                        : 'Item changed. Select a new decision.'}
                    </span>
                    <div
                      className="cap-decision-toggle-group"
                      role="radiogroup"
                      aria-label={`Decision for ${row.name}`}
                      onKeyDown={event => {
                        if (
                          !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(
                            event.key,
                          ) ||
                          busy
                        )
                          return;
                        const options = Array.from(
                          event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="radio"]'),
                        );
                        const current = options.indexOf(event.target as HTMLButtonElement);
                        if (current < 0) return;
                        event.preventDefault();
                        const step = event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 1;
                        const next = options[(current + step + options.length) % options.length];
                        next.focus();
                        next.click();
                      }}
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
                        tabIndex={!decision.action || decision.action === 'APPROVE' ? 0 : -1}
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
                        tabIndex={decision.action === 'REQUEST_CHANGES' ? 0 : -1}
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
                        tabIndex={decision.action === 'REJECT' ? 0 : -1}
                        disabled={busy}
                        aria-checked={decision.action === 'REJECT'}
                      >
                        <XCircle size={14} aria-hidden="true" /> Reject
                      </button>
                    </div>
                  </div>
                  <div className="cap-feedback-input-row">
                    <label htmlFor={`fb-${key}`}>
                      Feedback notes{' '}
                      {decision.action === 'APPROVE' ? (
                        '(optional)'
                      ) : (
                        <span className="cert-required-mark">*</span>
                      )}
                    </label>
                    <textarea
                      id={`fb-${key}`}
                      rows={2}
                      disabled={busy}
                      required={decision.action !== 'APPROVE'}
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
                  <span>Previously approved</span>
                </footer>
              )}
            </article>
          );
        })}
      </div>
    </FormDialog>
  );
}
