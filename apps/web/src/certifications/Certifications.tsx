import { useEffect, useState } from 'react';
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
import { ExcelBulkActions } from '../ExcelBulkActions';
import {
  AskSkillGenie,
  certificateContext,
  certificateQuestion,
  readOwnCertificate,
} from '../AskSkillGenie';

export function Certifications({
  actionsContainer,
  workspace,
}: {
  workspace?: WorkspaceState;
  actionsContainer?: HTMLDivElement | null;
}) {
  const [params, setParams] = useSearchParams();
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
  const [focusFeedback, setFocusFeedback] = useState(false);
  useEffect(() => {
    if (!viewing) setFocusFeedback(false);
  }, [viewing]);
  const [renewalSource, setRenewalSource] = useState<CertificationRecord>();
  const [renewalFields, setRenewalFields] = useState<CertificationFields>();
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
      const q = new URLSearchParams({ view: 'mine', page: String(page), search: '' });
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
          if (e.status === 401 || e.status === 403) {
            setViewing(undefined);
            setCombined(false);
          }
          setError(e.message);
        }
      })
      .finally(() => {
        if (!c.signal.aborted) setLoading(false);
      });
    return () => c.abort();
  }, [attempt]);
  const renewalId = certificationRenewalId(params.get('renew'));
  const editRecordId = certificationRenewalId(params.get('editRecord'));
  const recordId =
    renewalId ??
    editRecordId ??
    certificationRenewalId(params.get('record') ?? params.get('certification'));
  useEffect(() => {
    if (!recordId || loading || !data) return;
    const controller = new AbortController();
    const loadRecord = async (id: string) => {
      const result = await readApiResponse<{ record: CertificationRecord }>(
        await authenticatedFetch(`/api/certifications/${id}`, { signal: controller.signal }),
        'This certification could not be opened.',
      );
      return result.record;
    };
    async function openLinkedRecord() {
      try {
        if (renewalId && (!data?.canManage || !data.canUploadImage))
          throw new Error(
            'This credential is unavailable for renewal. Refresh your certifications.',
          );
        const record = await loadRecord(recordId!);
        if (renewalId && record.activeRenewalId) {
          const active = await loadRecord(record.activeRenewalId);
          if (controller.signal.aborted) return;
          if (active.canEdit) editCredential(active);
          else setViewing(active);
        } else if (!controller.signal.aborted) {
          if (
            renewalId &&
            record.status === 'APPROVED' &&
            record.expiryDate &&
            !record.supersededById
          ) {
            setRenewalSource(record);
            setRenewalFields(certificationRenewalFields(record, today));
            setCombined(true);
          } else if (editRecordId && data?.canManage && record.canEdit) editCredential(record);
          else setViewing(record);
        }
      } catch (error) {
        if (!controller.signal.aborted) toast.error((error as Error).message);
      } finally {
        if (!controller.signal.aborted) {
          const next = new URLSearchParams(params);
          for (const key of ['renew', 'record', 'certification', 'editRecord']) next.delete(key);
          setParams(next, { replace: true });
        }
      }
    }
    void openLinkedRecord();
    return () => controller.abort();
  }, [params, recordId, renewalId, editRecordId, loading, data, setParams, today]);
  const changeView = (tab: string) => {
    const next = new URLSearchParams(params);
    next.set('tab', tab);
    setParams(next);
  };
  const startRenewal = (record: CertificationRecord) => {
    setViewing(undefined);
    const next = new URLSearchParams(params);
    next.set('renew', record.id);
    setParams(next, { replace: true });
  };
  const actions = (
    <div className="cert-header-actions">
      {data &&
        workspace?.capabilities.ownProfile &&
        workspace.capabilities.administration &&
        workspace.capabilities.manageUsers &&
        workspace.capabilities.viewAudit && (
          <ExcelBulkActions
            kind="certifications"
            showImport
            onImported={() => setAttempt(value => value + 1)}
          />
        )}
      {data?.canManage && (
        <button className="admin-primary" disabled={loading} onClick={() => setCombined(true)}>
          <Plus size={16} /> Add certificate
        </button>
      )}
    </div>
  );
  return (
    <div className="certifications-container">
      <CapabilitySubmissions onUpdated={() => setAttempt(v => v + 1)} />
      {combined && !recordId && (
        <CapabilityComposer
          submissionId={combinedId}
          entry={combinedId || initialCredential || renewalSource ? undefined : 'certificate'}
          initialCredential={
            initialCredential
              ? { ...initialCredential, fields: certificationFields(initialCredential) }
              : undefined
          }
          renewal={
            renewalSource && renewalFields
              ? {
                  id: renewalSource.id,
                  fields: renewalFields,
                  skillIds: renewalSource.relatedSkills?.map(skill => skill.id),
                }
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
          onRenew={startRenewal}
          onSubmit={record => {
            editCredential(record);
          }}
        />
      )}
      {viewing && !recordId && (
        <FormDialog
          title={viewing.certificationName}
          subtitle={viewing.provider}
          initialFocus={focusFeedback ? '[data-genie-section="feedback"]' : undefined}
          onClose={() => setViewing(undefined)}
          footer={
            <>
              <AskSkillGenie
                load={async signal => {
                  const latest = await readOwnCertificate(viewing.id, signal);
                  return {
                    prompt: certificateQuestion(latest),
                    record: certificateContext(
                      latest,
                      (record, action) => {
                        if (action === 'renew') startRenewal(record);
                        else {
                          setFocusFeedback(action === 'feedback');
                          setViewing(record);
                        }
                      },
                      Boolean(data?.canManage && data.canUploadImage),
                    ),
                  };
                }}
                onOpen={() => setViewing(undefined)}
              />
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
                !viewing.supersededById &&
                viewing.expiryDate && (
                  <button className="primary-button" onClick={() => startRenewal(viewing)}>
                    {viewing.activeRenewalId ? 'Continue renewal' : 'Record renewal'}
                  </button>
                )}
            </>
          }
        >
          <section className="cert-review-banner">
            <p>Category: {viewing.category}</p>
            <p>
              <strong>Approval status:</strong> {certificationStatusLabels[viewing.status]}
            </p>
            <p
              className={
                credentialValidity(viewing.expiryDate, today) === 'Expired' ? 'cert-expired' : ''
              }
            >
              <strong>Validity:</strong> {credentialValidity(viewing.expiryDate, today)}
              {viewing.expiryDate && ` · Expiry ${viewing.expiryDate}`}
            </p>
            <p>Issued {viewing.certificationDate}</p>
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
              <p tabIndex={-1} data-genie-section="feedback">
                {viewing.feedback}
              </p>
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
    </div>
  );
}
