import { SidebarNavigation } from './SidebarNavigation';
import { lazy, Suspense, useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router';
import {
  Award,
  BookOpen,
  ChevronRight,
  Compass,
  LayoutDashboard,
  Menu,
  ShieldCheck,
  UserRound,
} from 'lucide-react';
import { authenticatedFetch } from './auth';
import { Sidebar } from './Sidebar';
import { NavigationDrawer } from './NavigationDrawer';
import { NavbarAccount } from './NavbarAccount';
import { catalogueNavigationVisible, catalogueRouteAllowed } from './WorkspaceNavigation';
const PersonalProfile = lazy(() =>
  import('./PersonalProfile').then(module => ({ default: module.PersonalProfile })),
);
const SkillReviews = lazy(() =>
  import('./SkillReviews').then(module => ({ default: module.SkillReviews })),
);
const MySkills = lazy(() => import('./MySkills').then(module => ({ default: module.MySkills })));
const Learning = lazy(() => import('./Learning').then(module => ({ default: module.Learning })));
const Requests = lazy(() => import('./Requests').then(module => ({ default: module.Requests })));
const SkillCatalogue = lazy(() =>
  import('./SkillCatalogue').then(module => ({ default: module.SkillCatalogue })),
);
const Dashboard = lazy(() => import('./Dashboard').then(module => ({ default: module.Dashboard })));
const Certifications = lazy(() =>
  import('./certifications/Certifications').then(module => ({ default: module.Certifications })),
);

export interface WorkspaceState {
  person: { id: string; displayName: string; employeeCode: string; roles: string[] };
  authentication: 'microsoft' | 'local-demo';
  capabilities: {
    ownProfile: boolean;
    ownSkills: boolean;
    claimSkills: boolean;
    catalogue: boolean;
    administration: boolean;
    manageCatalogue: boolean;
    reviewSkills?: boolean;
    learning?: boolean;
    requests?: boolean;
    requestProfileCorrection?: boolean;
    certifications?: boolean;
  };
  upcoming: { id: string; label: string; assigned: boolean; implemented: boolean }[];
}
type View =
  | 'requests'
  | 'learning'
  | 'overview'
  | 'profile'
  | 'my-skills'
  | 'certifications'
  | 'skills'
  | 'skill-reviews';
const currentView = (pathname: string): View =>
  pathname === '/requests'
    ? 'requests'
    : pathname === '/learning'
      ? 'learning'
      : pathname === '/skill-reviews'
        ? 'skill-reviews'
        : pathname === '/profile'
          ? 'profile'
          : pathname === '/my-skills'
            ? 'my-skills'
            : pathname === '/certifications'
              ? 'certifications'
              : pathname === '/skills'
                ? 'skills'
                : 'overview';

export function Workspace({
  embedded = false,
  actionsContainer,
  initialWorkspace,
}: {
  embedded?: boolean;
  actionsContainer?: HTMLDivElement | null;
  initialWorkspace?: WorkspaceState;
}) {
  const { pathname } = useLocation();
  const [state, setState] = useState<WorkspaceState | undefined>(initialWorkspace);
  const [error, setError] = useState(''),
    [attempt, setAttempt] = useState(0);
  const [navigationOpen, setNavigationOpen] = useState(false),
    [actions, setActions] = useState<HTMLDivElement | null>(null);
  const view = currentView(pathname);
  useEffect(() => {
    if (initialWorkspace && attempt === 0) {
      setState(initialWorkspace);
      return;
    }
    const controller = new AbortController();
    setState(undefined);
    setError('');
    authenticatedFetch('/api/workspace', { signal: controller.signal })
      .then(async response => {
        const body = await response.json().catch(() => undefined);
        if (!response.ok)
          throw new Error(body?.error?.message ?? 'Your workspace could not be loaded.');
        if (controller.signal.aborted) return;
        setState(body);
      })
      .catch(reason => {
        if (!controller.signal.aborted)
          setError(
            reason instanceof Error ? reason.message : 'Your workspace could not be loaded.',
          );
      });
    return () => controller.abort();
  }, [attempt, initialWorkspace]);
  useEffect(() => {
    setNavigationOpen(false);
    window.scrollTo({ top: 0 });
  }, [pathname]);
  const name = state?.person.displayName ?? 'Workspace member';
  const firstName = state ? name.trim().split(/\s+/)[0] || 'there' : 'there';
  const sections = [
    {
      id: 'skill-reviews',
      label: 'Skill reviews',
      href: '/skill-reviews',
      icon: ShieldCheck,
      visible: state?.capabilities.reviewSkills,
    },
    {
      id: 'overview',
      label: 'Dashboard',
      href: '/workspace',
      icon: LayoutDashboard,
      visible: true,
    },
    {
      id: 'profile',
      label: 'My profile',
      href: '/profile',
      icon: UserRound,
      visible: state?.capabilities.ownProfile,
    },
    {
      id: 'my-skills',
      label: 'My skills',
      href: '/my-skills',
      icon: Compass,
      visible: state?.capabilities.ownSkills,
    },
    {
      id: 'certifications',
      label: 'Certifications',
      href: '/certifications',
      icon: Award,
      visible: Boolean(state?.capabilities.certifications),
    },
    {
      id: 'requests',
      label: 'Requests',
      href: '/requests',
      icon: ShieldCheck,
      visible: state?.capabilities.requests,
    },
    {
      id: 'learning',
      label: 'Learn & Grow',
      href: '/learning',
      icon: BookOpen,
      visible: state?.capabilities.learning,
    },
    {
      id: 'skills',
      label: 'Skill catalogue',
      href: '/skills',
      icon: BookOpen,
      visible: catalogueNavigationVisible(state?.capabilities),
    },
  ];
  const permitted =
    view === 'overview' ||
    (view === 'skills'
      ? catalogueRouteAllowed(state?.capabilities)
      : sections.some(section => section.id === view && section.visible));
  const sidebarContent = (close: () => void = () => {}) => (
    <>
      <Link className="admin-brand" to="/workspace">
        <img src="/brand/sopra-steria.svg" alt="Sopra Steria" />
      </Link>
      <p className="nav-caption">MY WORKSPACE</p>
      <SidebarNavigation
        actorId={state?.person.id}
        label="Personal workspace sections"
        onNavigate={close}
        items={[
          ...sections
            .filter(section => section.visible)
            .map(({ id, label, href, icon }) => ({
              id: id === 'overview' ? 'dashboard' : id,
              label,
              href,
              icon,
              active: view === id,
            })),
          ...(state?.capabilities.administration
            ? [
                {
                  id: 'administration',
                  label: 'Administration',
                  href: '/access',
                  icon: ShieldCheck,
                },
              ]
            : []),
        ]}
      />
    </>
  );
  if (embedded)
    return (
      <>
        {error && (
          <p role="alert">
            {error}
            <button className="secondary-button" onClick={() => setAttempt(value => value + 1)}>
              Retry
            </button>
          </p>
        )}
        {!state && !error && <p role="status">Loading your workspace…</p>}
        {state && !permitted && (
          <section className="profile-panel">
            <h2>Access is not assigned</h2>
            <p>Your current permissions do not include this page.</p>
          </section>
        )}
        {state && permitted && (
          <>
            <Suspense fallback={<p role="status">Loading this workspace page…</p>}>
              {view === 'overview' && <Dashboard />}
              {view === 'profile' && <PersonalProfile workspace={state} />}
              {view === 'my-skills' && <MySkills actionsContainer={actionsContainer ?? null} />}
              {view === 'certifications' && (
                <Certifications
                  workspace={state}
                  actionsContainer={actionsContainer ?? null}
                />
              )}
              {view === 'requests' && <Requests actionsContainer={actionsContainer} />}
              {view === 'learning' && <Learning actionsContainer={actionsContainer} />}
              {view === 'skill-reviews' && <SkillReviews />}
              {view === 'skills' && <SkillCatalogue actionsContainer={actionsContainer ?? null} />}
            </Suspense>
          </>
        )}
      </>
    );
  return (
    <div className="admin-shell personal-workspace">
      <a className="skip-link" href="#workspace-main">
        Skip to content
      </a>
      <Sidebar className="desktop-sidebar">{sidebarContent()}</Sidebar>
      {navigationOpen && (
        <NavigationDrawer onClose={() => setNavigationOpen(false)}>
          {close => <Sidebar>{sidebarContent(close)}</Sidebar>}
        </NavigationDrawer>
      )}
      <div className="admin-content">
        <header className="admin-topbar">
          <button
            className="navigation-toggle secondary-button"
            aria-label="Open navigation"
            aria-expanded={navigationOpen}
            aria-controls="workspace-navigation"
            onClick={() => setNavigationOpen(true)}
          >
            <Menu size={20} />
          </button>
          <div className="page-location navbar-context">
            <div className="navbar-greeting">
              <span className="greeting-hello">Hello,</span>
              <strong className="greeting-name" title={name}>
                {firstName}
              </strong>
            </div>
            <h1>
              {view === 'requests'
                ? 'Requests & incidents'
                : sections.find(section => section.id === view)?.label}
            </h1>
          </div>
          <div className="page-actions" role="group" aria-label="Page actions" ref={setActions} />
          <NavbarAccount
            name={name}
            identity={
              state?.authentication === 'local-demo' ? 'Development session' : 'Microsoft account'
            }
            workspaceLink={
              state?.capabilities.administration
                ? { href: '/access', label: 'Administration' }
                : undefined
            }
          />
        </header>
        <main id="workspace-main" className="access-main" tabIndex={-1}>
          {error && (
            <section className="profile-panel">
              <h2>Workspace access</h2>
              <p role="alert">{error}</p>
              <button className="secondary-button" onClick={() => setAttempt(value => value + 1)}>
                Retry
              </button>
            </section>
          )}
          {!state && !error && <p role="status">Loading your workspace…</p>}
          {state && !permitted && (
            <section className="profile-panel">
              <h2>Access is not assigned</h2>
              <p>Your current permissions do not include this page.</p>
              <Link className="secondary-button" to="/workspace">
                Return to dashboard
              </Link>
            </section>
          )}
          {state && permitted && (
            <>
              <Suspense fallback={<p role="status">Loading this workspace page…</p>}>
                {view === 'overview' && <Dashboard />}
                {view === 'profile' && <PersonalProfile workspace={state} />}
                {view === 'my-skills' && <MySkills actionsContainer={actions} />}
                {view === 'certifications' && (
                  <Certifications workspace={state} actionsContainer={actions} />
                )}
                {view === 'requests' && <Requests actionsContainer={actions} />}
                {view === 'learning' && <Learning actionsContainer={actions} />}
                {view === 'skill-reviews' && <SkillReviews />}
                {view === 'skills' && <SkillCatalogue actionsContainer={actions} />}
              </Suspense>
            </>
          )}
        </main>
      </div>
    </div>
  );
}
