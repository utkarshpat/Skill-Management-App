import { Workspace } from './Workspace';
import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router';
import { AccessAdmin } from './AccessAdmin';
import { AssistantWidget } from './AssistantWidget';
import { ThemeSwitcher } from './Theme';
import { initializeAuth, signedIn, signIn, signInConfigured } from './auth';
import { DevelopmentLogin } from './DevelopmentLogin';
import { BookOpen, BriefcaseBusiness, Compass, Layers3, ListChecks, Users } from 'lucide-react';

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
  const [session, setSession] = useState<'loading' | 'anonymous' | 'signed-in' | 'error'>('loading');
  useEffect(() => { let active = true; initializeAuth().then(() => { if (active) setSession(signedIn() ? 'signed-in' : 'anonymous'); }).catch(() => { if (active) setSession('error'); }); return () => { active = false; }; }, []);
  if (pathname === '/preview') return <Overview />;
  if (session === 'loading') return <div className="session-loading" role="status">Preparing your workspace…</div>;
  if (pathname === '/access' && session === 'signed-in') return <><AccessAdmin /><AssistantWidget /></>;
  return session === 'signed-in' ? <><Workspace /><AssistantWidget /></> : <Welcome authError={session === 'error'} onDevelopmentSessionReady={()=>setSession('signed-in')} />;
}

function Welcome({ authError,onDevelopmentSessionReady }: { authError: boolean;onDevelopmentSessionReady:()=>void }) {
  const [error, setError] = useState('');
  return <div className="welcome-page">
    <a className="skip-link" href="#welcome-main">Skip to content</a>
    <header className="welcome-header"><ThemeSwitcher/><img src="/brand/sopra-steria.svg" alt="Sopra Steria" /></header>
    <main id="welcome-main" className="welcome-main" tabIndex={-1}>
      <section className="login-introduction" aria-label="About Cognitive Intelligence Lab"><p className="login-eyebrow">WORKFORCE INTELLIGENCE</p><h2>Cognitive<br/>Intelligence Lab<span className="login-title-dot">.</span></h2><p className="login-tagline">Understand capability.<br/>Build what comes next.</p><p className="login-description">One workspace for people, skills and growth.</p><div className="login-pillars"><span><Compass size={18}/>Discover capability</span><span><BookOpen size={18}/>Develop potential</span><span><Users size={18}/>Connect people</span></div></section><section className="signin-card" aria-labelledby="signin-title">


        <h1 id="signin-title"><span className="desktop-welcome">Welcome back</span><span className="mobile-welcome">Skill Management</span></h1>
        <p className="signin-intro">Sign in to your workspace.</p>
        <button className="microsoft-button" disabled={!signInConfigured || authError} aria-describedby="signin-status" onClick={() => { signIn().catch(() => setError('Sign-in could not start. Please refresh and try again.')); }}><span className="microsoft-symbol" aria-hidden="true"><i /><i /><i /><i /></span>Continue with Microsoft</button>
        <p id="signin-status" className="signin-status" role="status">{error || (authError ? 'Sign-in could not finish. Please return to this page and try again.' : signInConfigured ? 'Use your Microsoft account to access your assigned workspace.' : 'Sign-in is being set up. Access will be available soon.')}</p>
        <DevelopmentLogin onSessionReady={onDevelopmentSessionReady}/>
      </section>
    </main>
  </div>;
}

function Overview() {
  return <div className="profile-page"><header className="welcome-header"><ThemeSwitcher/><img src="/brand/sopra-steria.svg" alt="Sopra Steria"/><Link className="secondary-button" to="/">Sign in</Link></header><main className="profile-main"><h1>Workspace preview</h1><p className="subtitle">Planned modules. Sign in to access your assigned workspace.</p><div className="module-grid">{modules.map(({title,icon:Icon,description})=><section className="module-card" key={title}><Icon size={20} aria-hidden="true"/><h2>{title}</h2><p>{description}</p></section>)}</div></main></div>;
}
