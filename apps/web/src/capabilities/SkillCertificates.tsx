import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useLocation, useSearchParams } from 'react-router';
import { Award, Eye } from 'lucide-react';
import { authenticatedFetch } from '../auth';
import { readApiResponse } from '../api-response';
import { FormDialog } from '../FormDialog';
import { CertificationImage } from '../certifications/CertificationImage';
import { loadCertificationPortfolio } from '../certifications/certification-portfolio';
import {
  certificationFields,
  certificationRenewalFields,
  certificationStatusLabels,
  credentialValidity,
} from '../certifications/certification-model';
import type { CertificationPage, CertificationRecord } from '../certifications/types';
import { CapabilityComposer } from './DeferredCapabilityDialogs';
import { uniqueCertificates } from './SupportingCertificates';
import { RelatedCapabilities } from './RelatedCapabilities';

type CertificateContext = {
  data?: CertificationPage;
  loading: boolean;
  error: string;
  today: string;
  open: (id: string) => void;
  retry: () => void;
};
const OwnCertificates = createContext<CertificateContext | undefined>(undefined);
export const useOwnCertificates = () => useContext(OwnCertificates);

export function SkillCertificates({
  enabled,
  children,
}: {
  enabled: boolean;
  children: ReactNode;
}) {
  const [params] = useSearchParams();
  const location = useLocation();
  const [data, setData] = useState<CertificationPage>();
  const [loading, setLoading] = useState(enabled),
    [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0),
    [viewing, setViewing] = useState<CertificationRecord>();
  const [opening, setOpening] = useState(false),
    [detailError, setDetailError] = useState('');
  const [editing, setEditing] = useState<CertificationRecord>(),
    [renewing, setRenewing] = useState(false);
  const [today, setToday] = useState(() => new Date().toISOString().slice(0, 10));
  const detailRequest = useRef<AbortController | undefined>(undefined);
  const consumed = useRef('');
  useEffect(() => {
    const tick = () => setToday(new Date().toISOString().slice(0, 10));
    const timer = window.setInterval(tick, 60_000);
    window.addEventListener('focus', tick);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', tick);
    };
  }, []);
  useEffect(() => {
    const refresh = () => setAttempt(v => v + 1);
    window.addEventListener('own-skills-updated', refresh);
    window.addEventListener('notifications-remote-updated', refresh);
    return () => {
      detailRequest.current?.abort();
      window.removeEventListener('own-skills-updated', refresh);
      window.removeEventListener('notifications-remote-updated', refresh);
    };
  }, []);
  useEffect(() => {
    const abort = new AbortController();
    setLoading(enabled);
    setError('');
    if (!enabled) {
      detailRequest.current?.abort();
      setOpening(false);
      setViewing(undefined);
      setEditing(undefined);
      setData(undefined);
      return () => abort.abort();
    }
    loadCertificationPortfolio(
      async page =>
        readApiResponse<CertificationPage>(
          await authenticatedFetch(`/api/certifications?view=mine&page=${page}&search=`, {
            signal: abort.signal,
          }),
          'Your certificates could not be loaded. Please try again.',
        ),
      abort.signal,
    )
      .then(result => {
        if (!abort.signal.aborted) setData(result);
      })
      .catch(e => {
        if (!abort.signal.aborted) {
          setData(undefined);
          setViewing(undefined);
          setEditing(undefined);
          setError(e.message);
        }
      })
      .finally(() => {
        if (!abort.signal.aborted) setLoading(false);
      });
    return () => abort.abort();
  }, [enabled, attempt]);
  async function open(id: string, renewal = false) {
    detailRequest.current?.abort();
    const abort = new AbortController();
    detailRequest.current = abort;
    setViewing(undefined);
    setDetailError('');
    setOpening(true);
    try {
      const result = await readApiResponse<{ record: CertificationRecord }>(
        await authenticatedFetch(`/api/certifications/${encodeURIComponent(id)}`, {
          signal: abort.signal,
        }),
        'This certificate could not open. Please try again.',
      );
      if (abort.signal.aborted) return;
      if (renewal && result.record.activeRenewalId) {
        setDetailError('A renewal is already in progress. Open it to continue.');
        const renewalResult = await readApiResponse<{ record: CertificationRecord }>(
          await authenticatedFetch(`/api/certifications/${result.record.activeRenewalId}`, {
            signal: abort.signal,
          }),
          'The existing renewal could not open.',
        );
        if (abort.signal.aborted) return;
        setDetailError('');
        if (renewalResult.record.canEdit) {
          setRenewing(false);
          setEditing(renewalResult.record);
        } else setViewing(renewalResult.record);
        return;
      }
      if (
        renewal &&
        data?.canManage &&
        data.canUploadImage &&
        result.record.status === 'APPROVED' &&
        result.record.expiryDate &&
        !result.record.supersededById
      ) {
        setRenewing(true);
        setEditing(result.record);
      } else setViewing(result.record);
    } catch (e) {
      if (!abort.signal.aborted) setDetailError((e as Error).message);
    } finally {
      if (!abort.signal.aborted) setOpening(false);
    }
  }
  useEffect(() => {
    const target = params.get('renew') || params.get('record') || params.get('certification');
    const navigation = location.key + ':' + target;
    if (
      !enabled ||
      !data ||
      loading ||
      !target ||
      !/^[a-f0-9-]{36}$/i.test(target) ||
      consumed.current === navigation
    )
      return;
    consumed.current = navigation;
    void open(target, params.has('renew'));
  }, [params, enabled, data, loading, location.key]);
  const close = () => {
    detailRequest.current?.abort();
    setOpening(false);
    setViewing(undefined);
    setDetailError('');
  };
  return (
    <OwnCertificates.Provider
      value={
        enabled
          ? {
              data,
              loading,
              error,
              today,
              open: id => void open(id),
              retry: () => setAttempt(v => v + 1),
            }
          : undefined
      }
    >
      {children}
      {(opening || viewing || detailError) && (
        <FormDialog
          title={viewing?.certificationName || 'Certificate'}
          subtitle={viewing?.provider}
          onClose={close}
          footer={
            <>
              <button type="button" className="secondary-button" onClick={close}>
                Close
              </button>
              {viewing?.canEdit && data?.canManage && (
                <button
                  type="button"
                  className="admin-primary"
                  onClick={() => {
                    setRenewing(false);
                    setEditing(viewing);
                    setViewing(undefined);
                  }}
                >
                  Edit
                </button>
              )}
              {viewing?.status === 'APPROVED' &&
                !viewing.supersededById &&
                viewing.expiryDate &&
                data?.canManage &&
                data.canUploadImage && (
                  <button
                    type="button"
                    className="admin-primary"
                    onClick={() => {
                      void open(viewing.id, true);
                    }}
                  >
                    {viewing.activeRenewalId ? 'Continue renewal' : 'Renew certificate'}
                  </button>
                )}
            </>
          }
        >
          {opening ? (
            <p role="status" className="cap-callout">
              Opening certificate…
            </p>
          ) : detailError ? (
            <p role="alert" className="cap-callout">
              {detailError}
            </p>
          ) : (
            viewing && (
              <section className="cap-certificate-detail">
                <div className="cap-certificate-facts">
                  {viewing.supersededById && (
                    <p className="cap-callout">
                      Renewed certificate approved. This version is kept in history.{' '}
                      <button
                        className="skills-text-link"
                        onClick={() => void open(viewing.supersededById!)}
                      >
                        View latest certificate
                      </button>
                    </p>
                  )}
                  {viewing.renewedFromId && (
                    <button
                      className="skills-text-link"
                      onClick={() => void open(viewing.renewedFromId!)}
                    >
                      View previous certificate
                    </button>
                  )}
                  <p>{certificationStatusLabels[viewing.status]}</p>
                  <p
                    className={
                      credentialValidity(viewing.expiryDate, today) === 'Expired'
                        ? 'cert-expired'
                        : ''
                    }
                  >
                    {credentialValidity(viewing.expiryDate, today)}
                    {viewing.expiryDate && ` · ${viewing.expiryDate}`}
                  </p>
                  <p>
                    Issued {viewing.certificationDate} · {viewing.category}
                  </p>
                  {viewing.credentialId && <p>Credential ID: {viewing.credentialId}</p>}
                  {viewing.credentialUrl && (
                    <a href={viewing.credentialUrl} target="_blank" rel="noopener noreferrer">
                      Verify with issuer
                    </a>
                  )}
                  {viewing.notes && <p>{viewing.notes}</p>}
                  {viewing.feedback && <p>Manager feedback: {viewing.feedback}</p>}
                  <RelatedCapabilities kind="CERTIFICATION" id={viewing.id} />
                </div>
                {data?.canUploadImage && <CertificationImage id={viewing.id} />}
              </section>
            )
          )}
        </FormDialog>
      )}
      {editing && (
        <CapabilityComposer
          submissionId={!renewing ? editing.activeSubmissionId : undefined}
          initialCredential={
            !renewing && !editing.activeSubmissionId
              ? { ...editing, fields: certificationFields(editing) }
              : undefined
          }
          renewal={
            renewing
              ? {
                  id: editing.id,
                  fields: certificationRenewalFields(editing, today),
                  skillIds: editing.relatedSkills?.map(s => s.id),
                }
              : undefined
          }
          onClose={() => setEditing(undefined)}
          onSaved={() => {
            setEditing(undefined);
          }}
        />
      )}
    </OwnCertificates.Provider>
  );
}

export function CertificateRenewalSummary() {
  const context = useOwnCertificates();
  if (!context) return null;
  const { data, loading, error, today, open, retry } = context;
  if (error)
    return (
      <section className="skills-insight-card">
        <h3>Certificates</h3>
        <p role="alert">{error}</p>
        <button type="button" className="skills-text-link" onClick={retry}>
          Try again
        </button>
      </section>
    );
  if (!data)
    return (
      <section className="skills-insight-card">
        <h3>Certificates</h3>
        <p role="status">Getting your certificates ready…</p>
      </section>
    );
  const history = uniqueCertificates(data.records).filter(c => c.supersededById);
  const records = uniqueCertificates(data.records).filter(c => !c.supersededById);
  const attention = records.filter(c =>
    ['Expired', 'Expires soon'].includes(credentialValidity(c.expiryDate, today)),
  );
  const unlinked = records.filter(c => !c.relatedSkills?.length);
  return (
    <section className="skills-insight-card cap-renewal-summary" aria-busy={loading}>
      <h3>
        <Award size={18} /> Certificate renewals
      </h3>
      <div className="cap-renewal-counts">
        <span>
          <strong>{records.length}</strong>
          {records.length === 1 ? 'Certificate' : 'Certificates'}
        </span>
        <span>
          <strong>
            {attention.filter(c => credentialValidity(c.expiryDate, today) === 'Expired').length}
          </strong>
          Expired
        </span>
        <span>
          <strong>
            {
              attention.filter(c => credentialValidity(c.expiryDate, today) === 'Expires soon')
                .length
            }
          </strong>
          Expiring soon
        </span>
      </div>
      {!attention.length && <p>No renewals due in the next 90 days.</p>}
      {!!history.length && (
        <details>
          <summary>Renewal history ({history.length})</summary>
          <div className="cap-renewal-list">
            {history.map(c => (
              <button type="button" key={c.id} onClick={() => open(c.id)}>
                <span>
                  {c.certificationName}
                  <small>Previous certificate · {c.credentialId || c.certificationDate}</small>
                </span>
                <Eye size={16} />
              </button>
            ))}
          </div>
        </details>
      )}
      {!!attention.length && (
        <details>
          <summary>{attention.length} need attention</summary>
          <div className="cap-renewal-list">
            {attention.map(c => (
              <button type="button" key={c.id} onClick={() => open(c.id)} disabled={loading}>
                <span>
                  {c.certificationName}
                  <small>
                    {credentialValidity(c.expiryDate, today)} · {c.expiryDate}
                  </small>
                </span>
                <Eye size={16} />
              </button>
            ))}
          </div>
        </details>
      )}
      {!!unlinked.length && (
        <details>
          <summary>{unlinked.length} without linked skills</summary>
          <div className="cap-renewal-list">
            {unlinked.map(c => (
              <button type="button" key={c.id} disabled={loading} onClick={() => open(c.id)}>
                <span>
                  {c.certificationName}
                  <small>{certificationStatusLabels[c.status]}</small>
                </span>
                <Eye size={16} />
              </button>
            ))}
          </div>
        </details>
      )}
    </section>
  );
}
