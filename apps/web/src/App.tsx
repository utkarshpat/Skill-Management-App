import type {WorkspaceState} from './Workspace';
import {administrationShellFor,isSupportedWorkspacePath} from './WorkspaceNavigation';
import { lazy, Suspense, useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router';


import { ThemeSwitcher } from './Theme';
import { toast } from './toast';
import { authenticatedFetch, initializeAuth, signedIn, signIn, signInConfigured, refreshDevelopmentLogin } from './auth';
import { DevelopmentLogin } from './DevelopmentLogin';
import { BookOpen, BriefcaseBusiness, Compass, Layers3, ListChecks, Users } from 'lucide-react';

const KnowledgeTransfer=lazy(()=>import('./knowledge-transfer/KnowledgeTransfer').then(module=>({default:module.KnowledgeTransfer})));
const Workspace=lazy(()=>import('./Workspace').then(module=>({default:module.Workspace})));
const AccessAdmin=lazy(()=>import('./AccessAdmin').then(module=>({default:module.AccessAdmin})));
const AssistantWidget=lazy(()=>import('./AssistantWidget').then(module=>({default:module.AssistantWidget})));
const modules = [
  { title: 'My Capability', icon: Compass, description: 'Your skills, evidence and experience.' },
  { title: 'Team & Assessment', icon: Users, description: 'Understand capability. Verify with confidence.' },
  { title: 'Credentials & Development', icon: BookOpen, description: 'Turn learning goals into daily progress.' },
  { title: 'Projects & Demand', icon: BriefcaseBusiness, description: 'Define the capability a project needs.' },
  { title: 'Supply & Matching', icon: Layers3, description: 'Connect verified skills to opportunities.' },
  { title: 'Requests & Incidents', icon: ListChecks, description: 'Request access and report issues.' },
];

export function App() {
  const { pathname } = useLocation();
  const isKnowledgeTransfer=pathname==='/knowledgetransfer';
  const [session, setSession] = useState<'loading' | 'anonymous' | 'signed-in' | 'error'>('loading');
  const [sessionNotice,setSessionNotice]=useState('');
  const [workspace,setWorkspace]=useState<WorkspaceState>(),[workspaceError,setWorkspaceError]=useState(''),[workspaceAttempt,setWorkspaceAttempt]=useState(0);
  useEffect(()=>{
    setWorkspaceError('');if(isKnowledgeTransfer)return;if(session!=='signed-in'){setWorkspace(undefined);return;}
    const controller=new AbortController();let generation=0,lastLoad=0;
    const load=()=>{lastLoad=Date.now();const request=++generation;authenticatedFetch('/api/workspace',{signal:controller.signal}).then(async response=>{if(!response.ok)throw Object.assign(Error('Workspace navigation could not be refreshed.'),{status:response.status});const body=await response.json();if(!controller.signal.aborted&&request===generation){setWorkspace(body);setWorkspaceError('');}}).catch(error=>{if(!controller.signal.aborted&&request===generation){if([401,403].includes(error.status))setWorkspace(undefined);setWorkspaceError(error.message);}});};
    const focus=()=>{if(document.visibilityState==='visible'&&Date.now()-lastLoad>15000)load();};
    load();const timer=setInterval(()=>{if(document.visibilityState==='visible')load();},60000);
    window.addEventListener('workspace-access-updated',load);window.addEventListener('focus',focus);document.addEventListener('visibilitychange',focus);
    return()=>{controller.abort();clearInterval(timer);window.removeEventListener('workspace-access-updated',load);window.removeEventListener('focus',focus);document.removeEventListener('visibilitychange',focus);};
  },[session,workspaceAttempt,isKnowledgeTransfer]);
  useEffect(()=>{let active=true;const expired=()=>{setSessionNotice('Your development session expired or the API restarted. Choose a test person to open a new demo session.');toast.error('Your development session expired or the API restarted. Choose a test person to open a new demo session.');setSession('loading');refreshDevelopmentLogin().catch(()=>undefined).finally(()=>{if(active)setSession('anonymous');});};window.addEventListener('development-session-expired',expired);return()=>{active=false;window.removeEventListener('development-session-expired',expired);};},[]);
  useEffect(() => { let active = true; initializeAuth().then(() => { if (active) setSession(signedIn() ? 'signed-in' : 'anonymous'); }).catch(() => { if (active) setSession('error'); }); return () => { active = false; }; }, []);
  if (pathname === '/preview') return <Overview />;
  if (session === 'loading') return <div className="session-loading" role="status">Preparing your workspace…</div>;
  if(session==='signed-in'&&!isSupportedWorkspacePath(pathname))return <main className="profile-main"><h1>Page not found</h1><p>This workspace page is not available.</p><Link className="secondary-button" to="/workspace">Return to your workspace</Link></main>;
  if(session==='signed-in'&&isKnowledgeTransfer)return <Suspense fallback={<div className="session-loading" role="status">Opening project handover…</div>}><KnowledgeTransfer/></Suspense>;
  if(session==='signed-in'&&!workspace)return <div className="session-loading" role="status">{workspaceError?<>{workspaceError}<button onClick={()=>setWorkspaceAttempt(value=>value+1)}>Retry</button></>:'Preparing workspace navigation…'}</div>;
  const refreshWarning=workspace&&workspaceError?<div className="workspace-refresh-warning" role="alert">{workspaceError} <button onClick={()=>setWorkspaceAttempt(n=>n+1)}>Retry</button></div>:null;
  if (session==='signed-in'&&administrationShellFor(pathname,Boolean(workspace?.capabilities.administration)))return <>{refreshWarning}<Suspense fallback={<div className="session-loading" role="status">Opening your workspace…</div>}><AccessAdmin personalPath={pathname==='/access'?undefined:pathname} personalCapabilities={workspace?.capabilities} workspaceContext={workspace}/><Suspense fallback={null}><AssistantWidget /></Suspense></Suspense></>;
  return session === 'signed-in' ? <>{refreshWarning}<Suspense fallback={<div className="session-loading" role="status">Opening your workspace…</div>}><Workspace initialWorkspace={workspace}/><Suspense fallback={null}><AssistantWidget /></Suspense></Suspense></> : <Welcome authError={session === 'error'} sessionNotice={sessionNotice} onDevelopmentSessionReady={()=>{setSessionNotice('');setSession('signed-in');}} />;
}

function Welcome({ authError,sessionNotice,onDevelopmentSessionReady }: { authError: boolean;sessionNotice:string;onDevelopmentSessionReady:()=>void }) {
  const [error, setError] = useState('');
  const [signingIn, setSigningIn] = useState(false);
  return <div className="welcome-page">
    <a className="skip-link" href="#welcome-main">Skip to content</a>
    <header className="welcome-header"><ThemeSwitcher/><img src="/brand/sopra-steria.svg" alt="Sopra Steria" /></header>
    <main id="welcome-main" className="welcome-main" tabIndex={-1}>
      <section className="login-introduction" aria-label="About Cognitive Intelligence Lab"><p className="login-eyebrow">WORKFORCE INTELLIGENCE</p><h2>Cognitive<br/>Intelligence Lab<span className="login-title-dot">.</span></h2><p className="login-tagline">Understand capability.<br/>Build what comes next.</p><p className="login-description">One workspace for people, skills and growth.</p><div className="login-pillars"><span><Compass size={18}/>Discover capability</span><span><BookOpen size={18}/>Develop potential</span><span><Users size={18}/>Connect people</span></div></section><section className="signin-card" aria-labelledby="signin-title">


        <h1 id="signin-title"><span className="desktop-welcome">Welcome back</span><span className="mobile-welcome">Skill Management</span></h1>
        <p className="signin-intro">Sign in to your workspace.</p>
        {sessionNotice&&<p role="status">{sessionNotice}</p>}
        <button className="microsoft-button" disabled={signingIn || !signInConfigured || authError} aria-busy={signingIn} aria-describedby="signin-status" onClick={() => { setError(''); setSigningIn(true); signIn().catch(() => { setError('Sign-in could not start. Please refresh and try again.'); setSigningIn(false); }); }}><span className="microsoft-symbol" aria-hidden="true"><i /><i /><i /><i /></span>{signingIn ? 'Signing in…' : 'Continue with Microsoft'}</button>
        <p id="signin-status" className="signin-status" role="status">{error || (authError ? 'Sign-in could not finish. Please return to this page and try again.' : signInConfigured ? 'Use your Microsoft account to access your assigned workspace.' : 'Sign-in is being set up. Access will be available soon.')}</p>
        <DevelopmentLogin onSessionReady={onDevelopmentSessionReady}/>
      </section>
    </main>
  </div>;
}

function Overview() {
  return <div className="profile-page"><header className="welcome-header"><ThemeSwitcher/><img src="/brand/sopra-steria.svg" alt="Sopra Steria"/><Link className="secondary-button" to="/">Sign in</Link></header><main className="profile-main"><h1>Workspace preview</h1><p className="subtitle">Planned modules. Sign in to access your assigned workspace.</p><div className="module-grid">{modules.map(({title,icon:Icon,description})=><section className="module-card" key={title}><Icon size={20} aria-hidden="true"/><h2>{title}</h2><p>{description}</p></section>)}</div></main></div>;
}
