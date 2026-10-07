import { Link } from 'react-router';
export interface ProfileCompletenessDetails {
  filled: number;
  total: number;
  status: 'COMPLETE' | 'INCOMPLETE' | 'UNAVAILABLE';
  items: {
    key: string;
    label: string;
    state: 'COMPLETE' | 'MISSING' | 'NEEDS_ATTENTION' | 'UNAVAILABLE';
  }[];
}
export function ProfileCompleteness({
  details,
  loading = false,
  failed = false,
  canRequest = false,
}: {
  details?: ProfileCompletenessDetails;
  loading?: boolean;
  failed?: boolean;
  canRequest?: boolean;
}) {
  return (
    <section
      className="profile-information profile-completeness"
      aria-label="Profile completeness"
      aria-busy={loading}
    >
      <header>
        <h3>Profile completeness</h3>
      </header>
      {loading ? (
        <p role="status">Checking your required profile fields...</p>
      ) : failed || !details ? (
        <p>Completeness could not be confirmed. Reload your profile to try again.</p>
      ) : (
        <>
          <p>
            <strong>
              {details.filled} of {details.total} required fields complete.
            </strong>
            {details.status === 'UNAVAILABLE'
              ? ' Some fields are unavailable; this is not a confirmed completeness score.'
              : details.status === 'COMPLETE'
                ? ' Your required work information is complete.'
                : ' Review the missing fields below.'}
          </p>
          <dl className="profile-checklist">
            {details.items.map(item => (
              <div key={item.key}>
                <dt>{item.label}</dt>
                <dd data-state={item.state}>
                  {
                    {
                      COMPLETE: 'Complete',
                      MISSING: 'Not assigned',
                      NEEDS_ATTENTION: 'Needs administrator attention',
                      UNAVAILABLE: 'Unavailable',
                    }[item.state]
                  }
                </dd>
              </div>
            ))}
          </dl>
          <p>
            Reporting manager is shown separately and is not required for this score. Optional
            skills, experience, evidence and access templates do not affect completeness.
          </p>
          {details.status !== 'COMPLETE' && (
            <p>
              People administrators maintain your work identity and primary capability. Organization
              administrators maintain your department and reporting assignments.
            </p>
          )}
          {details.status !== 'COMPLETE' && canRequest && (
            <Link className="secondary-button" to="/requests?action=create">
              Request a profile correction
            </Link>
          )}
        </>
      )}
    </section>
  );
}
