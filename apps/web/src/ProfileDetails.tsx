import { Briefcase } from 'lucide-react';
import type { WorkspaceState } from './Workspace';
import { ProfileOrganization, type ProfileOrganizationDetails } from './ProfileOrganization';
import { EmploymentSummary, type Employment } from './EmploymentDetails';
import { ProfileCompleteness, type ProfileCompletenessDetails } from './ProfileCompleteness';

export interface Profile extends Employment {
  id: string;
  displayName: string;
  employeeCode: string;
  organization: string;
  status: string;
  roles: string[];
  organizationDetails?: ProfileOrganizationDetails;
  completeness?: ProfileCompletenessDetails;
}

export function ProfileDetails({
  workspace,
  profile,
  failed = false,
}: {
  workspace: WorkspaceState;
  profile?: Profile;
  failed?: boolean;
}) {
  const person = profile ?? workspace.person,
    initials = person.displayName
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map(part => part[0])
      .join('');
  return (
    <div className="personal-profile-page">
      <section className="profile-hero">
        <span className="profile-avatar" aria-hidden="true">
          {initials}
        </span>
        <div className="profile-identity-details">
          <h2>{person.displayName}</h2>
          <div className="profile-identity-meta">
            <span>Employee ID {person.employeeCode}</span>
            {profile?.organization && <span>{profile.organization}</span>}
          </div>
        </div>
      </section>

      <div className="personal-profile-grid">
        <div className="profile-column-primary">
          <ProfileOrganization
            details={profile?.organizationDetails}
            loading={!profile && !failed}
            failed={failed}
          />

          <section className="profile-information">
            <header>
              <span className="profile-card-icon">
                <Briefcase size={19} />
              </span>
              <h3>Business role</h3>
            </header>
            <EmploymentSummary value={profile} loading={!profile && !failed} failed={failed} />
          </section>
        </div>

        <div className="profile-column-secondary">
          <ProfileCompleteness
            details={profile?.completeness}
            loading={!profile && !failed}
            failed={failed}
            canRequest={workspace.capabilities.requestProfileCorrection}
          />
        </div>
      </div>
    </div>
  );
}
