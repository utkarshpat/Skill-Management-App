import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useSearchParams } from 'react-router';
import { Plus } from 'lucide-react';
import { authenticatedFetch } from '../auth';
import { readApiResponse } from '../api-response';
import { FormDialog } from '../FormDialog';
import { toast } from '../toast';
import type { WorkspaceState } from '../Workspace';
import { CertificationDialog } from './CertificationDialog';
import { CertificationReviewDialog } from './CertificationReviewDialog';
import { CertificationImage } from './CertificationImage';
import {
  certificationRenewalFields,
  certificationRenewalId,
  certificationStatusLabels,
  credentialValidity,
} from './certification-model';
import type { CertificationFields, CertificationPage, CertificationRecord } from './types';
import { CertificationProfileView } from './CertificationProfileView';
import { CertificationRecommendations } from './CertificationRecommendations';
import { loadCertificationPortfolio } from './certification-portfolio';
import './certifications.css';
import '../skills-profile.css';

export function Certifications({
  actionsContainer,
  personalOnly = false,
}: {
  personalOnly?: boolean;
  workspace?: WorkspaceState;
  actionsContainer?: HTMLDivElement | null;
}) {
  const [params, setParams] = useSearchParams();
  const view = params.get('tab') === 'queue' ? 'queue' : 'mine';
  const recommendationsTab = params.get('tab') === 'recommendations';
  const [data, setData] = useState<CertificationPage>(),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const [viewing, setViewing] = useState<CertificationRecord>();
  const [editing, setEditing] = useState<CertificationRecord | null | undefined>(),
    [reviewing, setReviewing] = useState<CertificationRecord>(),
    [submitting, setSubmitting] = useState<CertificationRecord>();
  const [renewalSource, setRenewalSource] = useState<CertificationRecord>();
  const [renewalFields, setRenewalFields] = useState<CertificationFields>();
  const renewalHandled = useRef<string | undefined>(undefined);
  const [submitError, setSubmitError] = useState(''),
    [busy, setBusy] = useState(false);
  const submissionLock = useRef(false);
  const [today, setToday] = useState(() => new Date().toISOString().slice(0, 10));
  useEffect(() => {
    const refreshDate = () => setToday(new Date().toISOString().slice(0, 10));
    const timer = window.setInterval(refreshDate, 60_000);
    window.addEventListener('focus', refreshDate);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', refreshDate);
    };
  }, []);
  useEffect(() => {
    const c = new AbortController();
    setLoading(true);
    setError('');
    loadCertificationPortfolio(async page => {
      const q = new URLSearchParams({ view, page: String(page), search: '' });
      return readApiResponse<CertificationPage>(
        await authenticatedFetch('/api/certifications?' + q, { signal: c.signal }),
        'Certifications could not be loaded.',
      );
    }, c.signal)
      .then(result => {
        if (!c.signal.aborted) setData(result);
      })
      .catch(e => {
        if (!c.signal.aborted) {
          setData(undefined);
          setViewing(undefined);
          setError(e.message);
        }
      })
      .finally(() => {
        if (!c.signal.aborted) setLoading(false);
      });
    return () => c.abort();
  }, [view, attempt]);
  const renewalId = certificationRenewalId(params.get('renew'));
  useEffect(() => {
    if (!renewalId) {
      renewalHandled.current = undefined;
      return;
    }
    if (loading || !data || renewalHandled.current === renewalId) return;
    renewalHandled.current = renewalId;
    const next = new URLSearchParams(params);
    next.delete('renew');
    setParams(next, { replace: true });
    const source = data.records.find(
      record => record.id === renewalId && record.status === 'APPROVED' && record.expiryDate,
    );
    if (!data.canManage || !source) {
      toast.error('This credential is unavailable for renewal. Refresh your certifications.');
      return;
    }
    setRenewalSource(source);
    setRenewalFields(certificationRenewalFields(source, today));
    setEditing(null);
  }, [params, renewalId, loading, data, setParams, today]);
  const changeView = (tab: string) => {
    const next = new URLSearchParams(params);
    next.set('tab', tab);
    setParams(next);
  };
  async function mutate(payload: object, message: string) {
    await readApiResponse(
      await authenticatedFetch('/api/certifications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }),
      'Save failed. Your entries are still here.',
    );
    toast.success(message);
    setAttempt(n => n + 1);
    window.dispatchEvent(new Event('notifications-updated'));
  }
  const save = async (
    id: string,
    revision: number,
    fields: CertificationFields,
    submit: boolean,
  ) => {
    const result = await readApiResponse<{ revision: number }>(
      await authenticatedFetch('/api/certifications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: submit ? 'SAVE_SUBMIT' : 'SAVE',
          id,
          revision,
          fields,
          // The pre-upload SAVE persists the renewal link; submission keeps it.
          ...(!submit && renewalSource ? { renewedFromId: renewalSource.id } : {}),
        }),
      }),
      'Save failed. Your entries are still here.',
    );
    if (!Number.isSafeInteger(result.revision) || result.revision <= revision)
      throw Error('Save could not be confirmed. Refresh your records before retrying.');
    return result.revision;
  };
  async function submit() {
    if (!submitting || submissionLock.current) return;
    submissionLock.current = true;
    setBusy(true);
    setSubmitError('');
    try {
      await mutate(
        { action: 'SUBMIT', id: submitting.id, revision: submitting.revision },
        'Certification submitted to your assigned current manager.',
      );
      setSubmitting(undefined);
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : 'Submission failed.');
    } finally {
      submissionLock.current = false;
      setBusy(false);
    }
  }
  const actions = (
    <div className="cert-header-actions">
      {data?.canManage && (
        <button className="admin-primary" disabled={loading} onClick={() => setEditing(null)}>
          <Plus size={16} /> Add certification
        </button>
      )}
    </div>
  );
  return (
    <div className="certifications-container">
      {!recommendationsTab && !actionsContainer && (
        <div className="my-skills-actions">{actions}</div>
      )}
      {!recommendationsTab && actionsContainer && createPortal(actions, actionsContainer)}
      {
        <nav className="cert-nav-tabs" aria-label="Certification views">
          <button
            className={`cert-nav-tab-btn ${view === 'mine' && !recommendationsTab ? 'active' : ''}`}
            aria-current={view === 'mine' && !recommendationsTab ? 'page' : undefined}
            onClick={() => changeView('mine')}
          >
            My certifications
          </button>
          {!personalOnly && (data?.canReview || view === 'queue') && (
            <button
              className={`cert-nav-tab-btn ${view === 'queue' ? 'active' : ''}`}
              aria-current={view === 'queue' ? 'page' : undefined}
              onClick={() => changeView('queue')}
            >
              Assigned reviews
            </button>
          )}
          {(data?.canViewRecommendations || data?.canRecommend || recommendationsTab) && (
            <button
              className={`cert-nav-tab-btn ${recommendationsTab ? 'active' : ''}`}
              aria-current={recommendationsTab ? 'page' : undefined}
              onClick={() => changeView('recommendations')}
            >
              Recommendations
            </button>
          )}
        </nav>
      }
      {error && (
        <section className="profile-panel" role="alert">
          <p>{error}</p>
          <button className="secondary-button" onClick={() => setAttempt(n => n + 1)}>
            Retry
          </button>
        </section>
      )}
      {loading && <p role="status">Loading certifications…</p>}
      {data && recommendationsTab && (data.canViewRecommendations || data.canRecommend) && (
        <CertificationRecommendations
          sentOnly={Boolean(data.canRecommend && !data.canViewRecommendations)}
        />
      )}
      {data && !recommendationsTab && (
        <CertificationProfileView
          loading={loading}
          records={data.records}
          today={today}
          canManage={data.canManage}
          canRenew={data.canManage && data.canUploadImage}
          onAdd={() => setEditing(null)}
          onView={setViewing}
          onEdit={setEditing}
          onRenew={record => {
            setRenewalSource(record);
            setRenewalFields(certificationRenewalFields(record, today));
            setEditing(null);
          }}
          onSubmit={record => {
            setSubmitError('');
            setSubmitting(record);
          }}
          onReview={setReviewing}
        />
      )}
      {viewing && (
        <FormDialog
          title={viewing.certificationName}
          subtitle={viewing.provider}
          onClose={() => setViewing(undefined)}
        >
          <section className="cert-review-banner">
            <p>
              {viewing.category} · {certificationStatusLabels[viewing.status]}
            </p>
            <p>
              Issued {viewing.certificationDate} · {credentialValidity(viewing.expiryDate, today)}
              {viewing.expiryDate && ` (${viewing.expiryDate})`}
            </p>
            {viewing.credentialId && <p>Credential ID: {viewing.credentialId}</p>}
            {viewing.credentialUrl ? (
              <a href={viewing.credentialUrl} target="_blank" rel="noopener noreferrer">
                Open issuer / badge link
              </a>
            ) : (
              <p>No issuer link provided.</p>
            )}
            {viewing.notes && <p>{viewing.notes}</p>}
            {data?.canUploadImage && <CertificationImage id={viewing.id} />}
          </section>
          {viewing.feedback && (
            <section className="cert-feedback">
              <h3>Manager feedback</h3>
              <p>{viewing.feedback}</p>
              {viewing.reviewedBy && (
                <small>
                  {viewing.reviewedBy}
                  {viewing.reviewedAt && ` · ${new Date(viewing.reviewedAt).toLocaleDateString()}`}
                </small>
              )}
            </section>
          )}
          <p>
            Manager review is separate from issuer validation, credential expiry and skill
            proficiency.
          </p>
          <div className="certification-dialog-footer">
            <button className="secondary-button" onClick={() => setViewing(undefined)}>
              Close
            </button>
            {viewing.canEdit && (
              <button
                className="primary-button"
                onClick={() => {
                  setEditing(viewing);
                  setViewing(undefined);
                }}
              >
                Edit details
              </button>
            )}
          </div>
        </FormDialog>
      )}
      {editing !== undefined && (
        <CertificationDialog
          initial={editing}
          initialFields={renewalFields}
          renewal={Boolean(renewalSource)}
          canSubmit={Boolean(data?.canSubmitNew)}
          imageAvailable={Boolean(data?.canUploadImage)}
          onClose={() => {
            setEditing(undefined);
            setRenewalSource(undefined);
            setRenewalFields(undefined);
            setAttempt(n => n + 1);
          }}
          onSave={save}
        />
      )}
      {reviewing && (
        <CertificationReviewDialog
          certification={reviewing}
          onClose={() => setReviewing(undefined)}
          onDecision={(record, action, feedback) =>
            mutate(
              { action, id: record.id, revision: record.revision, feedback },
              'Certification review saved.',
            )
          }
        />
      )}
      {submitting && (
        <FormDialog
          title="Submit to your current manager?"
          onClose={() => setSubmitting(undefined)}
          busy={busy}
        >
          <p>
            <strong>{submitting.certificationName}</strong>
          </p>
          <p>
            Your current active manager will be assigned this review. The details become read-only
            while awaiting a decision.
          </p>
          {submitError && <p role="alert">{submitError}</p>}
          <div className="certification-dialog-footer">
            <button
              className="secondary-button"
              disabled={busy}
              onClick={() => setSubmitting(undefined)}
            >
              Keep as draft
            </button>
            <button className="primary-button" disabled={busy} onClick={() => void submit()}>
              {busy ? 'Submitting…' : 'Submit to manager'}
            </button>
          </div>
        </FormDialog>
      )}
    </div>
  );
}
