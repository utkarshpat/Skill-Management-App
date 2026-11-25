import { SidebarNavigation } from './SidebarNavigation';
import { lazy, Suspense, useEffect, useState } from 'react';
import { Link, Navigate, useLocation } from 'react-router';
import { BookOpen, LayoutDashboard, LineChart, Menu, ShieldCheck } from 'lucide-react';
import { authenticatedFetch } from './auth';
import { subscribeWorkspaceUpdates } from './cross-tab-updates';
import { Sidebar } from './Sidebar';
import { NavigationDrawer } from './NavigationDrawer';
import { NavbarAccount } from './NavbarAccount';
import {
  catalogueNavigationVisible,
  catalogueRouteAllowed,
  personalNavigationItems,
  personalPageTitle,
} from './WorkspaceNavigation';
const PersonalProfile = lazy(() =>
  import('./PersonalProfile').then(module => ({ default: module.PersonalProfile })),
);
const SkillReviews = lazy(() =>
  import('./ReviewWorkspace').then(module => ({ default: module.ReviewWorkspace })),
);
const CapabilityPortfolio = lazy(() =>
  import('./CapabilityPortfolio').then(module => ({ default: module.CapabilityPortfolio })),
);
const Announcements = lazy(() =>
  import('./Announcements').then(module => ({ default: module.Announcements })),
);
const Learning = lazy(() => import('./Learning').then(module => ({ default: module.Learning })));
const Requests = lazy(() => import('./Requests').then(module => ({ default: module.Requests })));
const SkillCatalogue = lazy(() =>
  import('./SkillCatalogue').then(module => ({ default: module.SkillCatalogue })),
);
const BusinessOperations = lazy(() =>
  import('./business/BusinessOperations').then(module => ({ default: module.BusinessOperations })),
);
const CapabilityLeadAnalytics = lazy(() =>
  import('./business/CapabilityLeadAnalytics').then(module => ({
    default: module.CapabilityLeadAnalytics,
  })),
);
const Dashboard = lazy(() => import('./Dashboard').then(module => ({ default: module.Dashboard })));
export interface WorkspaceState {
  businessPolicyRevision?: number;
  person: { id: string; displayName: string; employeeCode: string; roles: string[] };
  authentication: 'microsoft' | 'local-demo';
  capabilities: {
    ownProfile: boolean;
    ownSkills: boolean;
    claimSkills: boolean;
    catalogue: boolean;
    administration: boolean;
    manageUsers?: boolean;
    viewAudit?: boolean;
    manageCatalogue: boolean;
    reviewSkills?: boolean;
    issuerApprovals?: boolean;
    learning?: boolean;
    requests?: boolean;
    requestProfileCorrection?: boolean;
    certifications?: boolean;
    businessOperations?: boolean;
    businessAdministration?: boolean;
    amendments?: boolean;
    approveAmendments?: boolean;
  };
  upcoming: { id: string; label: string; assigned: boolean; implemented: boolean }[];
}
type View =
  | 'announcements'
  | 'business'
  | 'requests'
  | 'learning'
  | 'overview'
  | 'profile'
  | 'my-skills'
  | 'certifications'
  | 'skills'
  | 'skill-reviews';
const currentView = (pathname: string): View =>
  pathname === '/announcements'
    ? 'announcements'
    : pathname === '/business'
      ? 'business'
      : pathname === '/requests'
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
  const { pathname, search: routeSearch } = useLocation();
  const [state, setState] = useState<WorkspaceState | undefined>(initialWorkspace);
  const [canPublishAnnouncements, setCanPublishAnnouncements] = useState(false);
  useEffect(() => {
    if (state?.person.id) return subscribeWorkspaceUpdates(state.person.id);
  }, [state?.person.id]);
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
  const capabilities = state?.capabilities;
  const personalItems = personalNavigationItems(
    capabilities && { ...capabilities, canPublishAnnouncements },
    pathname,
  ).map(item => (item.id === 'business' ? { ...item, icon: LineChart } : item));
  const sidebarItems = [
    ...personalItems,
    {
      id: 'dashboard',
      label: 'Dashboard',
      href: '/workspace',
      icon: LayoutDashboard,
      active: view === 'overview',
    },
    ...(catalogueNavigationVisible(capabilities)
      ? [
          {
            id: 'skills',
            label: 'Skill catalogue',
            href: '/skills',
            icon: BookOpen,
            active: view === 'skills',
          },
        ]
      : []),
  ];
  const orderedSections = [
    'business',
    'skill-reviews',
    'dashboard',
    'announcements',
    'profile',
    'my-skills',
    'requests',
    'learning',
    'skills',
  ];
  sidebarItems.sort(
    (left, right) => orderedSections.indexOf(left.id) - orderedSections.indexOf(right.id),
  );
  const permitted =
    view === 'overview' ||
    (view === 'announcements' && Boolean(state?.capabilities.ownProfile)) ||
    (view === 'certifications'
      ? Boolean(state?.capabilities.certifications)
      : view === 'my-skills'
        ? Boolean(state?.capabilities.ownSkills)
        : view === 'skills'
          ? catalogueRouteAllowed(state?.capabilities)
          : personalItems.some(item => item.id === view));
  const businessAccess = state?.capabilities.businessOperations;
  const leadAccess = state?.capabilities.issuerApprovals;
  const leadAnalyticsSelected =
    leadAccess &&
    (!businessAccess || new URLSearchParams(routeSearch).get('view') === 'capability-lead');
  const analytics = view === 'business' && (
    <>
      {businessAccess && leadAccess && (
        <nav className="header-actions" aria-label="Analytics views">
          <Link
            to="/business"
            className="secondary-button"
            aria-current={!leadAnalyticsSelected ? 'page' : undefined}
          >
            Overview
          </Link>
          <Link
            to="/business?view=capability-lead"
            className="secondary-button"
            aria-current={leadAnalyticsSelected ? 'page' : undefined}
          >
            Issuer analytics
          </Link>
        </nav>
      )}
      {leadAnalyticsSelected ? (
        <CapabilityLeadAnalytics key={state?.businessPolicyRevision} />
      ) : (
        businessAccess && <BusinessOperations key={state?.businessPolicyRevision} />
      )}
    </>
  );
  const sidebarContent = (close: () => void = () => {}) => (
    <SidebarNavigation
      actorId={state?.person.id}
      label="Personal workspace sections"
      onNavigate={close}
      items={[
        ...sidebarItems,
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
  );
  if (
    state &&
    view === 'business' &&
    !personalItems.some(item => item.id === 'business') &&
    catalogueRouteAllowed(state.capabilities) &&
    state.capabilities.amendments
  ) {
    const next = new URLSearchParams({ tab: 'amendments' });
    const ticket = new URLSearchParams(routeSearch).get('draftTicket');
    if (ticket) next.set('draftTicket', ticket);
    return <Navigate replace to={'/skills?' + next} />;
  }
  const pageActions = embedded ? (actionsContainer ?? null) : actions;
  const content = state && permitted && (
    <Suspense fallback={<p role="status">Loading this workspace page…</p>}>
      {analytics}
      {view === 'overview' && <Dashboard />}
      {view === 'profile' && <PersonalProfile workspace={state} />}
      {(view === 'my-skills' || view === 'certifications') && (
        <CapabilityPortfolio workspace={state} actionsContainer={pageActions} />
      )}
      {view === 'requests' && <Requests actionsContainer={pageActions} />}
      {view === 'learning' && <Learning actionsContainer={pageActions} />}
      {view === 'skill-reviews' && (
        <SkillReviews
          certificationsAllowed={Boolean(state.capabilities.certifications)}
          issuerOnly={!state.capabilities.reviewSkills && state.capabilities.issuerApprovals}
        />
      )}
      {view === 'skills' && (
        <SkillCatalogue
          actionsContainer={pageActions}
          amendmentsAllowed={Boolean(
            state.capabilities.amendments || state.capabilities.approveAmendments,
          )}
        />
      )}
    </Suspense>
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
        {content}
      </>
    );
  return (
    <div className="admin-shell personal-workspace">
      <a className="skip-link" href="#workspace-main">
        Skip to content
      </a>
      <Sidebar brandHref="/workspace" collapsible>
        {sidebarContent()}
      </Sidebar>
      {navigationOpen && (
        <NavigationDrawer onClose={() => setNavigationOpen(false)}>
          {close => (
            <Sidebar brandHref="/workspace" onBrandClick={close}>
              {sidebarContent(close)}
            </Sidebar>
          )}
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
              {view === 'overview'
                ? 'Dashboard'
                : view === 'learning'
                  ? 'Learn & Grow'
                  : personalPageTitle(pathname, capabilities)}
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
          {(view !== 'announcements' || (state && permitted)) && (
            <Suspense fallback={null}>
              <Announcements
                page={view === 'announcements'}
                onPublishAccess={setCanPublishAnnouncements}
              />
            </Suspense>
          )}
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
          {content}
        </main>
      </div>
    </div>
  );
}
