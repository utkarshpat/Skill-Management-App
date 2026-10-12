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
  const certifications = pathname === '/certifications';
  if (certifications && new URLSearchParams(search).get('tab') === 'queue')
    return <Navigate to="/skill-reviews?type=certifications" replace />;
  return (
    <>
      <Suspense fallback={<p role="status">Loading your portfolio…</p>}>
        {!workspace.capabilities.ownSkills ||
        new URLSearchParams(search).get('tab') === 'recommendations' ? (
          <Certifications actionsContainer={actionsContainer} personalOnly />
        ) : (
          <SkillCertificates enabled={Boolean(workspace.capabilities.certifications)}>
            <MySkills actionsContainer={actionsContainer} />
          </SkillCertificates>
        )}
      </Suspense>
    </>
  );
}
