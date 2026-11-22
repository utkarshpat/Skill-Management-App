import { lazy, Suspense } from 'react';
import { Link, Navigate, useLocation } from 'react-router';
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
  const showCertifications =
    !ownSkills || (certifications && (certificateRoute || tab === 'recommendations'));
  if (certificateRoute && tab === 'queue') {
    const target = new URLSearchParams({ type: 'certifications' });
    const certification = params.get('certification');
    if (certification) target.set('certification', certification);
    return <Navigate to={`/skill-reviews?${target}`} replace />;
  }
  return (
    <>
      {ownSkills && certifications && (
        <nav className="capability-tabs" aria-label="Skills and certifications sections">
          <Link to="/my-skills" aria-current={!showCertifications ? 'page' : undefined}>
            Skills
          </Link>
          <Link to="/certifications" aria-current={showCertifications ? 'page' : undefined}>
            Certifications
          </Link>
        </nav>
      )}
      <Suspense fallback={<p role="status">Loading your portfolio…</p>}>
        {showCertifications ? (
          <Certifications actionsContainer={actionsContainer} workspace={workspace} />
        ) : (
          <SkillCertificates enabled={Boolean(workspace.capabilities.certifications)}>
            <MySkills
              actionsContainer={actionsContainer}
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
    </>
  );
}
