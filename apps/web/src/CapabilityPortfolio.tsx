import { lazy, Suspense } from 'react';
import { Link, Navigate, useLocation } from 'react-router';
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
      <nav className="capability-tabs" aria-label="Skills and certifications">
        {workspace.capabilities.ownSkills && (
          <Link to="/my-skills" aria-current={!certifications ? 'page' : undefined}>
            Skills
          </Link>
        )}
        {workspace.capabilities.certifications && (
          <Link to="/certifications" aria-current={certifications ? 'page' : undefined}>
            Certifications
          </Link>
        )}
      </nav>
      <Suspense fallback={<p role="status">Loading your portfolio…</p>}>
        {certifications ? (
          <Certifications actionsContainer={actionsContainer} personalOnly />
        ) : (
          <MySkills actionsContainer={actionsContainer} />
        )}
      </Suspense>
    </>
  );
}
