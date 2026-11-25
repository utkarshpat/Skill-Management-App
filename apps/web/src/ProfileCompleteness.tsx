import { Link } from 'react-router';
import { phaseTwoVisible } from './release-features';
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
  const missing = details?.items.filter(item => item.state !== 'COMPLETE') ?? [];
  const showCorrection = details && details.status !== 'COMPLETE' && phaseTwoVisible && canRequest;
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
          {details.status === 'UNAVAILABLE' ? (
            <p>Some profile fields couldn’t be checked. Reload your profile to try again.</p>
          ) : (
            <p>
              <strong>
                {details.filled} of {details.total} required fields complete.
              </strong>
            </p>
          )}
          {missing.length > 0 && (
            <dl className="profile-checklist">
              {missing.map(item => (
                <div key={item.key}>
                  <dt>{item.key === 'department' ? 'Accounts/Clients' : item.label}</dt>
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
          )}
          {details.status === 'INCOMPLETE' && !showCorrection && (
            <p>Ask your administrator to update missing or incorrect details.</p>
          )}
          {showCorrection && (
            <Link className="secondary-button" to="/requests?action=create">
              Request a profile correction
            </Link>
          )}
        </>
      )}
    </section>
  );
}
