import { useEffect, useState } from 'react';
import { readApiResponse } from '../api-response';
import { authenticatedFetch } from '../auth';
import './business-administration.css';

interface IssuerMetrics {
  issuer: string;
  people: number;
  pending: number;
  valid: number;
  dueSoon: number;
  expired: number;
}

export function CapabilityLeadAnalytics() {
  const [issuers, setIssuers] = useState<IssuerMetrics[]>();
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setError('');
    setIssuers(undefined);
    authenticatedFetch('/api/capability-leads/analytics', { signal: controller.signal })
      .then(response =>
        readApiResponse<{ issuers: IssuerMetrics[] }>(
          response,
          'Certificate analytics are unavailable.',
        ),
      )
      .then(data => {
        if (!controller.signal.aborted) setIssuers(data.issuers);
      })
      .catch((error: Error) => {
        if (!controller.signal.aborted) setError(error.message);
      });
    return () => controller.abort();
  }, [attempt]);

  return (
    <section className="panel bo-access-admin">
      <h2>Issuer certificate analytics</h2>
      {error ? (
        <>
          <p role="alert">{error}</p>
          <button
            type="button"
            className="secondary-button"
            onClick={() => setAttempt(value => value + 1)}
          >
            Retry
          </button>
        </>
      ) : !issuers ? (
        <p role="status">Loading certificate analytics…</p>
      ) : !issuers.length ? (
        <p>
          No certificates with an active or pending approval in your issuer and organization scope.
        </p>
      ) : (
        <div className="bo-table-wrap">
          <table>
            <thead>
              <tr>
                <th>Issuer</th>
                <th>Employees</th>
                <th>Pending approval</th>
                <th>Valid</th>
                <th>Due within 30 days</th>
                <th>Expired</th>
              </tr>
            </thead>
            <tbody>
              {issuers.map(issuer => (
                <tr key={issuer.issuer}>
                  <th scope="row">{issuer.issuer}</th>
                  <td>{issuer.people}</td>
                  <td>{issuer.pending}</td>
                  <td>{issuer.valid}</td>
                  <td>{issuer.dueSoon}</td>
                  <td>{issuer.expired}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
