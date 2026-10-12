import { useEffect, useState } from 'react';
import { authenticatedFetch } from '../auth';
import { readApiResponse } from '../api-response';
import './capabilities.css';
export function RelatedCapabilities({ kind, id }: { kind: 'SKILL' | 'CERTIFICATION'; id: string }) {
  const [links, setLinks] = useState<any[]>(),
    [error, setError] = useState('');
  useEffect(() => {
    const abort = new AbortController();
    authenticatedFetch(`/api/capability-submissions/links/${kind}/${id}`, { signal: abort.signal })
      .then(r => readApiResponse<any>(r, 'Related capabilities unavailable.'))
      .then(v => {
        if (!abort.signal.aborted) setLinks(v.links ?? []);
      })
      .catch(e => {
        if (!abort.signal.aborted) setError(e.message);
      });
    return () => abort.abort();
  }, [kind, id]);
  return (
    <section>
      <h3>{kind === 'SKILL' ? 'Supporting certifications' : 'Related skills'}</h3>
      {error ? (
        <p role="alert">{error}</p>
      ) : !links ? (
        <p role="status">Loading links…</p>
      ) : links.length ? (
        <div className="cap-chips">
          {links.map(link => (
            <span
              key={link.claimId + link.certificationId}
              title={
                kind === 'SKILL'
                  ? `${link.provider} · ${link.status.toLowerCase()}${link.expiryDate ? ` · Expires ${link.expiryDate.slice(0, 10)}` : ''}`
                  : undefined
              }
            >
              {kind === 'SKILL' ? link.certificationName : link.skillName}
            </span>
          ))}
        </div>
      ) : (
        <p className="cap-help">
          {kind === 'SKILL'
            ? 'No supporting certification linked.'
            : 'Historical credential without skill links. New submissions require related skills.'}
        </p>
      )}
    </section>
  );
}
