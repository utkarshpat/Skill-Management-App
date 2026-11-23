import { lazy, Suspense } from 'react';
import { Navigate, useLocation } from 'react-router';
import { SkillCertificates } from './capabilities/SkillCertificates';
import type { WorkspaceState } from './Workspace';
import './capability-workspace.css';
const MySkills = lazy(() => import('./MySkills').then(m => ({ default: m.MySkills })));
const Certifications = lazy(() =>
  import('./certifications/Certifications').then(m => ({ default: m.Certifications })),
);
export function CapabilityPortfolio({
  workspace,
  actionsContainer,
}: {
  workspace: WorkspaceState;
  actionsContainer?: HTMLDivElement | null;
}) {
  const { pathname, search } = useLocation();
  const params = new URLSearchParams(search);
  const tab = params.get('tab');
  const { ownSkills, certifications } = workspace.capabilities;
  const certificateRoute = pathname === '/certifications';
  const showStandaloneCertifications = !ownSkills || (certifications && tab === 'recommendations');
  if (certificateRoute && tab === 'queue') {
    const target = new URLSearchParams({ type: 'certifications' });
    const certification = params.get('certification');
    if (certification) target.set('certification', certification);
    return <Navigate to={`/skill-reviews?${target}`} replace />;
  }
  return (
    <Suspense fallback={<p role="status">Loading your portfolio…</p>}>
      {showStandaloneCertifications ? (
        <Certifications actionsContainer={actionsContainer} workspace={workspace} />
      ) : (
        <SkillCertificates enabled={Boolean(certifications)}>
          <MySkills
            actionsContainer={actionsContainer}
            unified={Boolean(ownSkills && certifications)}
            initialType={certificateRoute && certifications ? 'cert' : 'all'}
            canImportCertificates={Boolean(
              workspace.capabilities.ownProfile &&
              workspace.capabilities.administration &&
              workspace.capabilities.manageUsers &&
              workspace.capabilities.viewAudit,
            )}
          />
        </SkillCertificates>
      )}
    </Suspense>
  );
}
