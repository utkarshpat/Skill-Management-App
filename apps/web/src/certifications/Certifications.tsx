import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useSearchParams } from 'react-router';
import { Plus } from 'lucide-react';
import { authenticatedFetch } from '../auth';
import { readApiResponse } from '../api-response';
import { FormDialog } from '../FormDialog';
import { toast } from '../toast';
import type { WorkspaceState } from '../Workspace';
import { CapabilityComposer } from '../capabilities/DeferredCapabilityDialogs';
import { CapabilitySubmissions } from '../capabilities/CapabilitySubmissions';
import { CertificationReviewDialog } from './CertificationReviewDialog';
import { RelatedCapabilities } from '../capabilities/RelatedCapabilities';
import { CertificationImage } from './CertificationImage';
import {
  certificationFields,
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
  const [combined, setCombined] = useState(false);
  const [combinedId, setCombinedId] = useState<string>();
  const [initialCredential, setInitialCredential] = useState<CertificationRecord>();
  const editCredential = (record: CertificationRecord) => {
    setCombinedId(record.activeSubmissionId ?? undefined);
    setInitialCredential(record.activeSubmissionId ? undefined : record);
    setCombined(true);
  };
  useEffect(() => {
    const refresh = () => setAttempt(value => value + 1);
    window.addEventListener('notifications-remote-updated', refresh);
    return () => window.removeEventListener('notifications-remote-updated', refresh);
  }, []);
  const [viewing, setViewing] = useState<CertificationRecord>();
  const [reviewing, setReviewing] = useState<CertificationRecord>(),
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
    setCombined(true);
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
        <button className="admin-primary" disabled={loading} onClick={() => setCombined(true)}>
          <Plus size={16} /> Add skill
        </button>
      )}
    </div>
  );
  return (
    <div className="certifications-container">
      <CapabilitySubmissions onUpdated={() => setAttempt(v => v + 1)} />
      {combined && (
        <CapabilityComposer
          submissionId={combinedId}
          initialCertificate
          initialCredential={
            initialCredential
              ? { ...initialCredential, fields: certificationFields(initialCredential) }
              : undefined
          }
          renewal={
            renewalSource && renewalFields
              ? { id: renewalSource.id, fields: renewalFields }
              : undefined
          }
          onClose={() => {
            setCombined(false);
            setCombinedId(undefined);
            setInitialCredential(undefined);
            setRenewalSource(undefined);
            setRenewalFields(undefined);
          }}
          onSaved={() => {
            setCombined(false);
            setCombinedId(undefined);
            setInitialCredential(undefined);
            setRenewalSource(undefined);
            setRenewalFields(undefined);
            setAttempt(v => v + 1);
          }}
        />
      )}
      {!recommendationsTab && !actionsContainer && (
        <div className="my-skills-actions">{actions}</div>
      )}
      {!recommendationsTab && actionsContainer && createPortal(actions, actionsContainer)}
      {!personalOnly && (data?.canReview || view === 'queue') && (
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
        </nav>
      )}
      {error && (
        <section className="profile-panel" role="alert">
          <p>{error}</p>
          <button className="secondary-button" onClick={() => setAttempt(n => n + 1)}>
            Retry
          </button>
        </section>
      )}
      {loading && <p role="status">Loading certifications…</p>}
      {recommendationsTab && (
        <section className="cert-recommendation-entry">
          <button type="button" className="secondary-button" onClick={() => changeView('mine')}>
            Back to my certifications
          </button>
          <h2>Recommendations from your manager</h2>
        </section>
      )}
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
          onAdd={() => setCombined(true)}
          onView={setViewing}
          onEdit={editCredential}
          onRenew={record => {
            setRenewalSource(record);
            setRenewalFields(certificationRenewalFields(record, today));
            setCombined(true);
          }}
          onSubmit={record => {
            editCredential(record);
          }}
          onReview={setReviewing}
        />
      )}
      {viewing && (
        <FormDialog
          title={viewing.certificationName}
          subtitle={viewing.provider}
          onClose={() => setViewing(undefined)}
          footer={
            <>
              <button className="secondary-button" onClick={() => setViewing(undefined)}>
                Close
              </button>
              {viewing.canEdit && (
                <button
                  className="primary-button"
                  onClick={() => {
                    editCredential(viewing);
                    setViewing(undefined);
                  }}
                >
                  Edit details
                </button>
              )}
              {data?.canManage &&
                data.canUploadImage &&
                viewing.status === 'APPROVED' &&
                viewing.expiryDate && (
                  <button
                    className="primary-button"
                    onClick={() => {
                      setRenewalSource(viewing);
                      setRenewalFields(certificationRenewalFields(viewing, today));
                      setCombined(true);
                      setViewing(undefined);
                    }}
                  >
                    Record renewal
                  </button>
                )}
            </>
          }
        >
          <section className="cert-review-banner">
            <p>Category: {viewing.category}</p>
            <p>
              <strong>Review status:</strong> {certificationStatusLabels[viewing.status]}
            </p>
            <p
              className={
                credentialValidity(viewing.expiryDate, today) === 'Expired' ? 'cert-expired' : ''
              }
            >
              <strong>Validity:</strong> {credentialValidity(viewing.expiryDate, today)}
              {viewing.expiryDate && ` · Expiry ${viewing.expiryDate}`}
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
            <RelatedCapabilities kind="CERTIFICATION" id={viewing.id} />
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
        </FormDialog>
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
