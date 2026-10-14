import type { BusinessDashboard } from './business-model';
export function CredentialCoverage({
  data,
  pending,
  onExport,
}: {
  data: BusinessDashboard;
  pending: boolean;
  onExport: (format: string) => void;
}) {
  const rows = [
    ...(data.credentialCoverage ?? []).map(c => ({ ...c, catalogue: true })),
    ...(data.uncataloguedCredentials ?? []).map((c, i) => ({
      ...c,
      id: `unlisted-${i}`,
      catalogue: false,
    })),
  ].sort(
    (a, b) =>
      b.currentHolders - a.currentHolders ||
      a.name.localeCompare(b.name) ||
      a.issuer.localeCompare(b.issuer),
  );
  return (
    <section className="bo-panel bo-credential-headcount" aria-busy={pending}>
      <div className="bo-panel-header">
        <div>
          <h2>Certification headcount</h2>
          <p className="bo-note">
            Distinct employees per credential. Current means manager reviewed and valid today. One
            employee can hold several credentials; counts cannot be added as workforce headcount.
          </p>
        </div>
        <div className="bo-export">
          {['csv', 'xlsx'].map(format => (
            <button
              key={format}
              disabled={pending || !data.context.canExport || !data.coverageComplete}
              onClick={() => onExport(format)}
            >
              {format === 'csv' ? 'CSV' : 'Excel'}
            </button>
          ))}
        </div>
      </div>
      {!data.coverageComplete ? (
        <p>Full credential reporting is not available in this environment yet.</p>
      ) : (
        <div className="bo-table-wrap bo-full-coverage-scroll">
          <table>
            <thead>
              <tr>
                <th>Credential / issuer</th>
                <th>Current holders</th>
                <th>Reviewed holders</th>
                <th>Expired holders</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(c => (
                <tr key={c.id}>
                  <td>
                    <strong>{c.name}</strong>
                    <small className="bo-access-code">
                      {c.issuer}
                      {!c.catalogue && ' · Uncatalogued or retired'}
                    </small>
                  </td>
                  <td>{c.currentHolders}</td>
                  <td>{c.reviewedHolders}</td>
                  <td>{c.expiredHolders}</td>
                </tr>
              ))}
              {!rows.length && (
                <tr>
                  <td colSpan={4}>No credentials match these filters.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
