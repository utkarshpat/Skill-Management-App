import { CapabilityEvidence } from './CapabilityEvidence';
import { credentialValidity } from '../certifications/certification-model';
import { useEffect, useState } from 'react';
import { authenticatedFetch } from '../auth';
import { readApiResponse } from '../api-response';
import { Award, ExternalLink, ShieldCheck, Clock3 } from 'lucide-react';
import './capabilities.css';

export function RelatedCapabilities({ kind, id }: { kind: 'SKILL' | 'CERTIFICATION'; id: string }) {
  const [opened, setOpened] = useState<string>();
  const [links, setLinks] = useState<any[]>(),
    [error, setError] = useState('');
  useEffect(() => {
    const abort = new AbortController();
    setLinks(undefined);
    setOpened(undefined);
    setError('');
    authenticatedFetch(`/api/capability-submissions/links/${kind}/${id}`, { signal: abort.signal })
      .then(r => readApiResponse<any>(r, 'Related capabilities unavailable.'))
      .then(v => {
        if (!abort.signal.aborted)
          setLinks((v.links ?? []).filter((l: any) => kind !== 'SKILL' || !l.supersededById));
      })
      .catch(e => {
        if (!abort.signal.aborted) setError(e.message);
      });
    return () => abort.abort();
  }, [kind, id]);
  return (
    <section className="cap-related-section">
      <h3 className="cap-related-heading">
        <Award size={18} aria-hidden="true" />
        {kind === 'SKILL' ? 'Supporting certifications' : 'Related skills'}
      </h3>
      {error ? (
        <p role="alert">{error}</p>
      ) : !links ? (
        <p role="status">Loading linked credentials…</p>
      ) : links.length ? (
        kind === 'SKILL' ? (
          <div className="cap-linked-certs-grid">
            {links.map(link => (
              <div key={link.claimId + link.certificationId} className="cap-linked-cert-card">
                <div className="cap-cert-card-header">
                  <div className="cap-cert-icon">
                    <Award size={20} aria-hidden="true" />
                  </div>
                  <div className="cap-cert-header-info">
                    <h4 className="cap-cert-card-title">{link.certificationName}</h4>
                    <div className="cap-cert-badges">
                      {link.provider && (
                        <span className="cap-meta-pill highlight">{link.provider}</span>
                      )}
                      {link.category && <span className="cap-meta-pill">{link.category}</span>}
                      <span className={`cap-status-pill ${link.status?.toLowerCase()}`}>
                        {link.status === 'SUBMITTED' ? (
                          <>
                            <Clock3 size={11} aria-hidden="true" /> Awaiting review
                          </>
                        ) : link.status === 'APPROVED' ? (
                          <>
                            <ShieldCheck size={11} aria-hidden="true" /> Manager reviewed
                          </>
                        ) : (
                          link.status?.toLowerCase()
                        )}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="cap-cert-card-body">
                  <div className="cap-cert-detail-grid">
                    <div className="cap-cert-detail-item">
                      <span className="cap-cert-label">Validity</span>
                      <span className="cap-cert-value">
                        {link.expiryDate
                          ? `${credentialValidity(link.expiryDate.slice(0, 10), new Date().toISOString().slice(0, 10))} · ${link.expiryDate.slice(0, 10)}`
                          : 'Does not expire'}
                      </span>
                    </div>
                    {link.credentialId && (
                      <div className="cap-cert-detail-item">
                        <span className="cap-cert-label">Credential ID</span>
                        <span className="cap-cert-value font-mono">{link.credentialId}</span>
                      </div>
                    )}
                    {link.credentialUrl && /^https?:\/\//i.test(link.credentialUrl) && (
                      <div className="cap-cert-detail-item">
                        <span className="cap-cert-label">Verification</span>
                        <a
                          href={link.credentialUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="cap-cert-verify-link"
                        >
                          Verify credential <ExternalLink size={12} aria-hidden="true" />
                        </a>
                      </div>
                    )}
                  </div>
                  {link.submissionId && (
                    <details
                      open={opened === link.certificationId}
                      onToggle={e => {
                        if (e.currentTarget.open) setOpened(link.certificationId);
                        else setOpened(v => (v === link.certificationId ? undefined : v));
                      }}
                    >
                      <summary>View certificate file</summary>
                      {opened === link.certificationId && (
                        <CapabilityEvidence
                          submissionId={link.submissionId}
                          recordId={link.certificationId}
                        />
                      )}
                    </details>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="cap-chips">
            {links.map(link => (
              <span key={link.claimId + link.certificationId}>{link.skillName}</span>
            ))}
          </div>
        )
      ) : (
        <p className="cap-help">
          {kind === 'SKILL'
            ? 'No supporting certification linked to this skill claim.'
            : 'Historical credential without skill links. New submissions require related skills.'}
        </p>
      )}
    </section>
  );
}
