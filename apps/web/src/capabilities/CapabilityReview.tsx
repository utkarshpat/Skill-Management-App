import { useEffect, useRef, useState } from 'react';
import { FormDialog } from '../FormDialog';
import { authenticatedFetch } from '../auth';
import { readApiResponse } from '../api-response';
import { CapabilityEvidence } from './CapabilityEvidence';
import { toast } from '../toast';
import type { Submission } from './capability-model';
export function CapabilityReview({
  id,
  readOnly = false,
  onClose,
  onSaved,
}: {
  id: string;
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
  async function save() {
    if (!data || lock.current) return;
    const pending = rows.filter(r => r.needsReview);
    if (pending.some(r => !decisions[r.kind + r.id]?.feedback.trim())) {
      setError('Add feedback for every pending item.');
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
              ...decisions[r.kind + r.id],
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
  return (
    <FormDialog
      title={readOnly ? 'Capability submission' : 'Review capabilities'}
      subtitle="One request; separate decisions for each skill and credential"
      busy={busy}
      onClose={onClose}
      className="capability-composer"
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
              Save review decisions
            </button>
          )}
        </>
      }
    >
      <div className="cap-composer-body">
        {!data && !error && <p role="status">Loading submitted capabilities…</p>}
        {data?.intake && (
          <p>
            This private draft has incomplete details. Open Continue draft from your capability
            submissions to finish it.
          </p>
        )}
        {rows.map(row => {
          const key = row.kind + row.id;
          return (
            <details className="cap-accordion" key={key} open>
              <summary>
                <span>
                  <strong>{row.name}</strong>
                  <small>
                    {row.kind === 'SKILL'
                      ? `L${row.rank} · ${row.experienceMonths} months`
                      : `${row.provider} · ${row.expiryDate ? `Expires ${row.expiryDate.slice(0, 10)}` : 'No expiry'}`}
                  </small>
                </span>
                <span className="cap-pill">{row.status.toLowerCase()}</span>
              </summary>
              <div className="cap-composer-body">
                {row.kind === 'SKILL' ? (
                  <>
                    <p>{row.description}</p>
                    <p>{row.projects}</p>
                    <CapabilityEvidence submissionId={id} recordId={row.id} />
                    <p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                      {row.evidence}
                    </p>
                  </>
                ) : (
                  <>
                    <p>Credential ID: {row.credentialId || 'Not provided'}</p>
                    <p>{row.notes}</p>
                    <CapabilityEvidence submissionId={id} recordId={row.id} />
                  </>
                )}
                <div className="cap-chips" aria-label="Related capabilities">
                  {(row.kind === 'CERTIFICATION'
                    ? data?.skills
                        .filter(s =>
                          row.relatedSkills?.some((link: any) => link.skillId === s.skillId),
                        )
                        .map(s => s.name)
                    : data?.certifications
                        .filter(c =>
                          c.relatedSkills?.some((link: any) => link.skillId === row.skillId),
                        )
                        .map(c => c.certificationName)
                  )?.map((name: string) => (
                    <span key={name}>{name}</span>
                  ))}
                </div>
                {row.feedback && <p>Feedback: {row.feedback}</p>}
                {!readOnly && row.needsReview && (
                  <div className="cap-fields">
                    <label>
                      Decision
                      <select
                        value={decisions[key]?.action ?? 'REQUEST_CHANGES'}
                        disabled={busy}
                        onChange={e =>
                          setDecisions(old => ({
                            ...old,
                            [key]: { feedback: old[key]?.feedback ?? '', action: e.target.value },
                          }))
                        }
                      >
                        <option value="APPROVE">Approve this item</option>
                        <option value="REQUEST_CHANGES">Request changes</option>
                        <option value="REJECT">Do not approve</option>
                      </select>
                    </label>
                    <label>
                      Feedback <span className="cert-required-mark">*</span>
                      <textarea
                        maxLength={2000}
                        disabled={busy}
                        value={decisions[key]?.feedback ?? ''}
                        onChange={e =>
                          setDecisions(old => ({
                            ...old,
                            [key]: {
                              action: old[key]?.action ?? 'REQUEST_CHANGES',
                              feedback: e.target.value,
                            },
                          }))
                        }
                      />
                    </label>
                  </div>
                )}
              </div>
            </details>
          );
        })}
      </div>
    </FormDialog>
  );
}
