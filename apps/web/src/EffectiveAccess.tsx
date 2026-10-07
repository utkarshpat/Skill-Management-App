import { useEffect, useState } from 'react';
import { ShieldCheck, ChevronDown } from 'lucide-react';
import { authenticatedFetch } from './auth';
import { AccessDecisionList, type AccessSummary } from './AccessDecisionList';
export type { Decision, AccessSummary } from './AccessDecisionList';
export function EffectiveAccess({
  endpoint,
  actorId,
  collapsible = false,
}: {
  endpoint: string;
  actorId: string;
  collapsible?: boolean;
}) {
  const [summary, setSummary] = useState<AccessSummary>(),
    [error, setError] = useState(''),
    [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setSummary(undefined);
    setError('');
    authenticatedFetch(endpoint, { signal: controller.signal })
      .then(async response => {
        const body = await response.json();
        if (!response.ok)
          throw Error(body?.error?.message ?? 'Access explanations are unavailable.');
        if (body.actorId !== actorId) throw Error('Access identity mismatch.');
        if (!controller.signal.aborted) setSummary(body);
      })
      .catch(e => {
        if (!controller.signal.aborted) setError(e.message);
      });
    return () => controller.abort();
  }, [endpoint, actorId, attempt]);
  const content = summary ? (
    <AccessDecisionList summary={summary} />
  ) : error ? (
    <p role="alert">
      {error}
      <button className="secondary-button" onClick={() => setAttempt(n => n + 1)}>
        Retry
      </button>
    </p>
  ) : (
    <p role="status">Loading current access…</p>
  );
  if (collapsible) {
    return (
      <details className="profile-panel profile-effective-accordion">
        <summary className="profile-effective-summary">
          <div className="profile-effective-header-left">
            <span className="profile-card-icon">
              <ShieldCheck size={18} />
            </span>
            <div>
              <strong>Effective access & security scope</strong>
              <small>Inspect verified server permissions and scope evaluation</small>
            </div>
          </div>
          <span className="profile-effective-action">
            <span>Audit & details</span>
            <ChevronDown size={16} className="profile-accordion-icon" />
          </span>
        </summary>
        <div className="profile-effective-body">{content}</div>
      </details>
    );
  }
  return (
    <section className="profile-panel">
      <h2>Effective access</h2>
      {content}
    </section>
  );
}
