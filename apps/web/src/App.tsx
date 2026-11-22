import { publishWorkspaceFreshness } from './workspace-freshness';
import type { WorkspaceState } from './Workspace';
import { administrationShellFor, isSupportedWorkspacePath } from './WorkspaceNavigation';
import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { FormDialog } from './FormDialog';
import { Link, Navigate, useLocation } from 'react-router';

import { ThemeSwitcher } from './Theme';
import { startActivityRefresh } from './activity-refresh';
import { toast } from './toast';
import {
  authenticatedFetch,
  initializeAuth,
  signedIn,
  signIn,
  signInConfigured,
  refreshDevelopmentLogin,
  signOut,
  companyResumePath,
  resumeCompanySession,
} from './auth';
import { DevelopmentLogin } from './DevelopmentLogin';
import { IdentityPending } from './IdentityPending';
import { BookOpen, BriefcaseBusiness, Compass, Layers3, ListChecks, Users } from 'lucide-react';

const KnowledgeTransfer = lazy(() =>
  import('./knowledge-transfer/KnowledgeTransfer').then(module => ({
    default: module.KnowledgeTransfer,
  })),
);
const Workspace = lazy(() => import('./Workspace').then(module => ({ default: module.Workspace })));
const AccessAdmin = lazy(() =>
  import('./AccessAdmin').then(module => ({ default: module.AccessAdmin })),
);
const AssistantWidget = lazy(() =>
  import('./AssistantWidget').then(module => ({ default: module.AssistantWidget })),
);
const modules = [
  { title: 'My Capability', icon: Compass, description: 'Your skills, evidence and experience.' },
  {
    title: 'Team & Assessment',
    icon: Users,
    description: 'Understand capability. Verify with confidence.',
  },
  {
    title: 'Credentials',
    icon: BookOpen,
    description: 'Track credentials and their validity.',
  },
  {
    title: 'Projects & Demand',
    icon: BriefcaseBusiness,
    description: 'Define the capability a project needs.',
  },
  {
    title: 'Supply & Matching',
    icon: Layers3,
    description: 'Connect verified skills to opportunities.',
  },
  {
    title: 'Requests & Incidents',
    icon: ListChecks,
    description: 'Request access and report issues.',
  },
];

export function App() {
  const { pathname } = useLocation();
  const isKnowledgeTransfer = pathname === '/knowledgetransfer';
  const [session, setSession] = useState<'loading' | 'anonymous' | 'signed-in' | 'error'>(
    'loading',
  );
  const [sessionNotice, setSessionNotice] = useState('');
  const [resumePath, setResumePath] = useState<string>();
  const [resumeError, setResumeError] = useState('');
  const [resuming, setResuming] = useState(false);
  const recoveryRequest = useRef<Promise<void>>(undefined);
  const recoveryChannel = useRef<BroadcastChannel>(undefined);
  const paused = useRef(false);
  const [bindingPending, setBindingPending] = useState(false);
  const [leavingWorkspace, setLeavingWorkspace] = useState(false);
  const [signOutError, setSignOutError] = useState('');
  async function leaveWorkspace() {
    if (leavingWorkspace) return;
    setLeavingWorkspace(true);
    setSignOutError('');
    try {
      await signOut();
    } catch {
      setSignOutError('Sign out could not finish. Please try again.');
      setLeavingWorkspace(false);
    }
  }
  const [workspace, setWorkspace] = useState<WorkspaceState>(),
    [workspaceError, setWorkspaceError] = useState(''),
    [workspaceAttempt, setWorkspaceAttempt] = useState(0);
  useEffect(() => {
    setWorkspaceError('');
    if (isKnowledgeTransfer || resumePath) return;
    if (session !== 'signed-in') {
      publishWorkspaceFreshness();
      setWorkspace(undefined);
      return;
    }
    const controller = new AbortController();
    let generation = 0;
    const load = () => {
      const request = ++generation;
      return authenticatedFetch('/api/workspace', { signal: controller.signal })
        .then(async response => {
          const body = await response.json();
          if (!response.ok)
            throw Object.assign(
              Error(body?.error?.message ?? 'Workspace navigation could not be refreshed.'),
              { status: response.status, code: body?.error?.code },
            );
          if (!controller.signal.aborted && request === generation && !paused.current) {
            setWorkspace(body);
            setBindingPending(false);
            setWorkspaceError('');
            if (typeof window !== 'undefined') {
              publishWorkspaceFreshness({ mode: 'live', checkedAt: Date.now() });
            }
          }
        })
        .catch(error => {
          if (!controller.signal.aborted && request === generation && !paused.current) {
            if ([401, 403].includes(error.status)) setWorkspace(undefined);
            setBindingPending(error.status === 403 && error.code === 'ACCESS_NOT_PROVISIONED');
            setWorkspaceError(error.message);
          }
          return false;
        });
    };
    const stop = startActivityRefresh(load, ['workspace-access-updated'], undefined, {
      pollMs: 300_000,
      onStatus: status => {
        if (typeof window !== 'undefined') {
          publishWorkspaceFreshness(status);
        }
      },
    });
    return () => {
      stop();
      controller.abort();
    };
  }, [session, workspaceAttempt, isKnowledgeTransfer, resumePath]);
  useEffect(() => {
    let active = true;
    const expired = () => {
      setSessionNotice(
        'Your development session expired or the API restarted. Choose a test person to open a new demo session.',
      );
      toast.error(
        'Your development session expired or the API restarted. Choose a test person to open a new demo session.',
      );
      setSession('loading');
      refreshDevelopmentLogin()
        .catch(() => undefined)
        .finally(() => {
          if (active) setSession('anonymous');
        });
    };
    const companyExpired = () => {
      const path = companyResumePath();
      if (path && (workspace || isKnowledgeTransfer)) {
        paused.current = true;
        setResumePath(path);
        return;
      }
      setSessionNotice('Your company session expired. Sign in again to continue.');
      setSession('anonymous');
    };
    window.addEventListener('company-session-expired', companyExpired);
    window.addEventListener('development-session-expired', expired);
    return () => {
      active = false;
      window.removeEventListener('company-session-expired', companyExpired);
      window.removeEventListener('development-session-expired', expired);
    };
  }, [workspace, isKnowledgeTransfer]);
  const [entryPath] = useState(pathname);
  useEffect(() => {
    let active = true;
    initializeAuth({ automatic: isSupportedWorkspacePath(entryPath) && entryPath !== '/preview' })
      .then(() => {
        if (active) setSession(signedIn() ? 'signed-in' : 'anonymous');
      })
      .catch(() => {
        if (active) setSession('error');
      });
    return () => {
      active = false;
    };
  }, [entryPath]);
  function resumeWorkspace(showError: boolean) {
    if (recoveryRequest.current) return recoveryRequest.current;
    setResuming(true);
    if (showError) setResumeError('');
    return (recoveryRequest.current = (async () => {
      if (!(await resumeCompanySession())) {
        setResumeError('Choose the same work account to continue with your unsaved changes.');
        setResumePath(companyResumePath(true));
        return;
      }
      const response = await authenticatedFetch('/api/workspace');
      if (!response.ok)
        throw Error('Workspace could not be refreshed. Check your access and try again.');
      setWorkspace(await response.json());
      paused.current = false;
      setResumeError('');
      recoveryChannel.current?.postMessage('resumed');
      setResumePath(undefined);
      window.dispatchEvent(new Event('workspace-access-updated'));
    })()
      .catch(error => {
        if (showError)
          setResumeError(error instanceof Error ? error.message : 'Sign-in could not be resumed.');
      })
      .finally(() => {
        recoveryRequest.current = undefined;
        setResuming(false);
      }));
  }
  useEffect(() => {
    if (!resumePath) return;
    const channel =
      typeof BroadcastChannel === 'function'
        ? new BroadcastChannel('skill-company-recovery')
        : undefined;
    if (channel) {
      recoveryChannel.current = channel;
      channel.onmessage = ({ data }) => {
        if (data === 'complete') void resumeWorkspace(true);
      };
    }
    const onFocus = () => void resumeWorkspace(false);
    window.addEventListener('focus', onFocus);
    return () => {
      window.removeEventListener('focus', onFocus);
      recoveryChannel.current = undefined;
      channel?.close();
    };
  }, [resumePath]);
  const recovery = resumePath && (
    <FormDialog
      title="Sign in to resume your work"
      className="company-session-recovery"
      busy
      onClose={() => {}}
      footer={
        <>
          <a
            href={resumePath}
            target="_blank"
            rel="noopener noreferrer"
            className="secondary-button"
          >
            Sign in with Microsoft
          </a>
          <button
            type="button"
            className="primary-button"
            onClick={() => void resumeWorkspace(true)}
            disabled={resuming}
          >
            {resuming ? 'Checking sign-in…' : 'Resume workspace'}
          </button>
        </>
      }
    >
      <p>
        Sign in with the same work account. This tab will reopen your work when sign-in finishes.
      </p>
      <p>If it stays paused, select Resume workspace.</p>
      {resumeError && <p role="alert">{resumeError}</p>}
    </FormDialog>
  );
  if (pathname === '/preview') return <Overview />;
  if (session === 'loading')
    return (
      <div className="session-loading" role="status">
        Preparing your workspace…
      </div>
    );
  if (session === 'signed-in' && !isSupportedWorkspacePath(pathname))
    return (
      <main className="profile-main">
        <h1>Page not found</h1>
        <p>This workspace page is not available.</p>
        <Link className="secondary-button" to="/workspace">
          Return to your workspace
        </Link>
      </main>
    );
  if (session === 'signed-in' && isKnowledgeTransfer)
    return (
      <Suspense
        fallback={
          <div className="session-loading" role="status">
            Opening project handover…
          </div>
        }
      >
        <KnowledgeTransfer />
        {recovery}
      </Suspense>
    );
  if (session === 'signed-in' && !workspace)
    return workspaceError ? (
      <main className="workspace-state">
        <section className="workspace-state-card" role="alert">
          <h1>{bindingPending ? 'Your access is not set up yet' : 'Workspace unavailable'}</h1>
          <p>{workspaceError}</p>
          <div className="workspace-state-actions">
            <button
              type="button"
              className="primary-button"
              onClick={() => setWorkspaceAttempt(value => value + 1)}
            >
              Try again
            </button>
            <button
              type="button"
              className="secondary-button"
              disabled={leavingWorkspace}
              onClick={() => void leaveWorkspace()}
            >
              {leavingWorkspace ? 'Signing out…' : 'Sign out'}
            </button>
          </div>
          {signOutError && <p role="alert">{signOutError}</p>}
          {bindingPending && <IdentityPending />}
        </section>
      </main>
    ) : (
      <div className="session-loading" role="status">
        Preparing workspace navigation…
      </div>
    );
  if (session === 'signed-in' && pathname === '/' && workspace?.capabilities.administration)
    return <Navigate replace to="/access?view=overview" />;
  const refreshWarning =
    workspace && workspaceError ? (
      <div className="workspace-refresh-warning" role="alert">
        <span>{workspaceError}</span>
        <button
          type="button"
          className="secondary-button"
          onClick={() => setWorkspaceAttempt(n => n + 1)}
        >
          Retry
        </button>
      </div>
    ) : null;
  if (
    session === 'signed-in' &&
    administrationShellFor(pathname, Boolean(workspace?.capabilities.administration))
  )
    return (
      <>
        {refreshWarning}
        <Suspense
          fallback={
            <div className="session-loading" role="status">
              Opening your workspace…
            </div>
          }
        >
          <AccessAdmin
            personalPath={pathname === '/access' ? undefined : pathname}
            personalCapabilities={workspace?.capabilities}
            workspaceContext={workspace}
          />
          <Suspense fallback={null}>
            <AssistantWidget />
          </Suspense>
        </Suspense>
        {recovery}
      </>
    );
  return session === 'signed-in' ? (
    <>
      {refreshWarning}
      <Suspense
        fallback={
          <div className="session-loading" role="status">
            Opening your workspace…
          </div>
        }
      >
        <Workspace initialWorkspace={workspace} />
        <Suspense fallback={null}>
          <AssistantWidget />
        </Suspense>
      </Suspense>
      {recovery}
    </>
  ) : (
    <Welcome
      authError={session === 'error'}
      sessionNotice={sessionNotice}
      onDevelopmentSessionReady={() => {
        setSessionNotice('');
        setSession('signed-in');
      }}
    />
  );
}

function Welcome({
  authError,
  sessionNotice,
  onDevelopmentSessionReady,
}: {
  authError: boolean;
  sessionNotice: string;
  onDevelopmentSessionReady: () => void;
}) {
  const [error, setError] = useState('');
  const [signingIn, setSigningIn] = useState(false);
  const signInResult = new URLSearchParams(window.location.search).get('signin');
  const chooseAccount =
    signInResult === 'failed' || signInResult === 'company-required' || authError;
  function startSignIn() {
    setError('');
    setSigningIn(true);
    signIn({ chooseAccount }).catch(() => {
      setError('Sign-in could not start. Please try again.');
      setSigningIn(false);
    });
  }
  return (
    <div className="welcome-page">
      <a className="skip-link" href="#welcome-main">
        Skip to content
      </a>
      <header className="welcome-header">
        <ThemeSwitcher />
        <img src="/brand/sopra-steria.svg" alt="Sopra Steria" />
      </header>
      <main id="welcome-main" className="welcome-main" tabIndex={-1}>
        <section className="login-introduction" aria-label="About Skill Management App">
          <p className="login-eyebrow">WORKFORCE INTELLIGENCE</p>
          <h2>
            Skill Management App<span className="login-title-dot">.</span>
          </h2>
          <p className="login-tagline">
            Understand capability.
            <br />
            Build what comes next.
          </p>
          <p className="login-description">One workspace for people, skills and growth.</p>
          <div className="login-pillars">
            <span>
              <Compass size={18} />
              Discover capability
            </span>
            <span>
              <BookOpen size={18} />
              Develop potential
            </span>
            <span>
              <Users size={18} />
              Connect people
            </span>
          </div>
        </section>
        <section className="signin-card" aria-labelledby="signin-title">
          <h1 id="signin-title">
            <span className="desktop-welcome">Welcome back</span>
            <span className="mobile-welcome">Skill Management App</span>
          </h1>
          <p className="signin-intro">Sign in to your workspace.</p>
          {sessionNotice && <p role="status">{sessionNotice}</p>}
          <button
            className="microsoft-button"
            disabled={signingIn || !signInConfigured}
            aria-busy={signingIn}
            aria-describedby="signin-status"
            onClick={startSignIn}
          >
            <span className="microsoft-symbol" aria-hidden="true">
              <i />
              <i />
              <i />
              <i />
            </span>
            {signingIn ? 'Signing in…' : 'Continue with Microsoft'}
          </button>
          <p id="signin-status" className="signin-status" role="status">
            {error ||
              (signInResult === 'company-required'
                ? 'Sign in with your @soprasteria.com work account.'
                : signInResult === 'failed' || authError
                  ? 'Sign-in could not finish. Continue with Microsoft to choose your work account.'
                  : signInConfigured
                    ? 'Use your Microsoft account to access your assigned workspace.'
                    : 'Sign-in is being set up. Access will be available soon.')}
          </p>
          <DevelopmentLogin onSessionReady={onDevelopmentSessionReady} />
        </section>
      </main>
    </div>
  );
}

function Overview() {
  return (
    <div className="profile-page">
      <header className="welcome-header">
        <ThemeSwitcher />
        <img src="/brand/sopra-steria.svg" alt="Sopra Steria" />
        <Link className="secondary-button" to="/">
          Sign in
        </Link>
      </header>
      <main className="profile-main">
        <h1>Workspace preview</h1>
        <p className="subtitle">Planned modules. Sign in to access your assigned workspace.</p>
        <div className="module-grid">
          {modules.map(({ title, icon: Icon, description }) => (
            <section className="module-card" key={title}>
              <Icon size={20} aria-hidden="true" />
              <h2>{title}</h2>
              <p>{description}</p>
            </section>
          ))}
        </div>
      </main>
    </div>
  );
}
