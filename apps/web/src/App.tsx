import { useEffect, useState } from 'react';
import { AccessAdmin } from './AccessAdmin';
import { AssistantWidget } from './AssistantWidget';
import { SkillCatalogue } from './SkillCatalogue';
import { ThemeSwitcher } from './Theme';
import { initializeAuth, signedIn, signIn, signOut, profileToken, signInConfigured, developmentPeople, directSignIn, isDemoSession } from './auth';
import { BookOpen, BriefcaseBusiness, Compass, Layers3, ListChecks, ShieldCheck, Users } from 'lucide-react';

const modules = [
  { title: 'My Capability', icon: Compass, description: 'Your skills, evidence and experience.' },
  { title: 'Team & Assessment', icon: Users, description: 'Understand capability. Verify with confidence.' },
  { title: 'Credentials & Development', icon: BookOpen, description: 'Turn learning goals into daily progress.' },
  { title: 'Projects & Demand', icon: BriefcaseBusiness, description: 'Define the capability a project needs.' },
  { title: 'Supply & Matching', icon: Layers3, description: 'Connect verified skills to opportunities.' },
  { title: 'Requests & Incidents', icon: ListChecks, description: 'Request access and report issues.' },
];

export function App() {
  const [session, setSession] = useState<'loading' | 'anonymous' | 'signed-in' | 'error'>('loading');
  useEffect(() => { let active = true; initializeAuth().then(() => { if (active) setSession(signedIn() ? 'signed-in' : 'anonymous'); }).catch(() => { if (active) setSession('error'); }); return () => { active = false; }; }, []);
  if (window.location.pathname === '/preview') return <Overview />;
  if (session === 'loading') return <div className="session-loading" role="status">Preparing your workspace…</div>;
  if (window.location.pathname === '/skills' && session === 'signed-in') return <><CataloguePage /><AssistantWidget /></>;
  if (window.location.pathname === '/access' && session === 'signed-in') return <><AccessAdmin /><AssistantWidget /></>;
  return session === 'signed-in' ? <><ProfilePage /><AssistantWidget /></> : <Welcome authError={session === 'error'} />;
}

function Welcome({ authError }: { authError: boolean }) {
  const [error, setError] = useState('');
  const [person, setPerson] = useState(developmentPeople[0]?.id ?? '');
  const [busy, setBusy] = useState(false);
  return <div className="welcome-page">
    <a className="skip-link" href="#welcome-main">Skip to content</a>
    <header className="welcome-header"><ThemeSwitcher/><img src="/brand/sopra-steria.svg" alt="Sopra Steria" /></header>
    <main id="welcome-main" className="welcome-main" tabIndex={-1}>
      <section className="signin-card" aria-labelledby="signin-title">


        <h1 id="signin-title">Skill Management</h1>
        <p className="signin-intro">Sign in to your workspace.</p>
        <button className="microsoft-button" disabled={!signInConfigured || authError} aria-describedby="signin-status" onClick={() => { signIn().catch(() => setError('Sign-in could not start. Please refresh and try again.')); }}><span className="microsoft-symbol" aria-hidden="true"><i /><i /><i /><i /></span>Continue with Microsoft</button>
        <p id="signin-status" className="signin-status" role="status">{error || (authError ? 'Sign-in could not finish. Please return to this page and try again.' : signInConfigured ? 'Use your Microsoft account to access your assigned workspace.' : 'Sign-in is being set up. Access will be available soon.')}</p>
        {developmentPeople.length > 0 && <div className="demo-login"><p className="demo-label">Development login</p><label htmlFor="demo-person">Test person</label><select id="demo-person" value={person} onChange={event => setPerson(event.target.value)}>{developmentPeople.map(person => <option key={person.id} value={person.id}>{person.displayName} · {person.employeeCode}</option>)}</select><button className="secondary-button" disabled={busy} onClick={() => { setBusy(true); directSignIn(person).catch(() => { setError('Direct login could not finish. Please try again.'); setBusy(false); }); }}>{busy ? 'Opening workspace…' : 'Open demo workspace'}</button></div>}
      </section>
    </main>
  </div>;
}

interface OwnProfile { id: string; displayName: string; employeeCode: string; organization: string; status: string; roles: string[]; canViewSkills?:boolean }
function ProfilePage() {
  const [profile, setProfile] = useState<OwnProfile>();
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    const timeout = setTimeout(() => controller.abort(), 45000);
    setLoading(true); setError('');
    (isDemoSession() ? Promise.resolve(undefined) : profileToken()).then(token => fetch('/api/me', { headers: token ? { Authorization: `Bearer ${token}` } : {}, signal: controller.signal })).then(async response => {
      if (response.status === 403) throw new Error(isDemoSession() ? 'Your ID does not have permission to view this profile. Contact your access administrator.' : 'Your Microsoft sign-in is complete. Workspace access has not been assigned yet. Contact your administrator.');
      if (response.status === 401) throw new Error('Your session could not be verified. Sign out and try again.');
      if (!response.ok) throw new Error('Your profile could not be loaded. Please try again.');
      const body = await response.json();
      if(body.profile?.canManageAccess && !isDemoSession()){window.location.replace('/access');return;}
      if (active) setProfile(body.profile);
    }).catch(err => { if (active) setError(err.name === 'AbortError' ? 'The connection took too long. Please try again.' : err.message); }).finally(() => { clearTimeout(timeout); if (active) setLoading(false); });
    return () => { active = false; clearTimeout(timeout); controller.abort(); };
  }, [attempt]);
  return <div className="profile-page"><a className="skip-link" href="#profile-main">Skip to content</a>
    <header className="welcome-header"><ThemeSwitcher/><img src="/brand/sopra-steria.svg" alt="Sopra Steria" /><button className="secondary-button" onClick={() => { signOut().catch(() => setError('Sign-out could not finish. Please try again.')); }}>Sign out</button></header>
    <main id="profile-main" className="profile-main" tabIndex={-1}>{isDemoSession() && <aside className="demo-banner" role="status">Local demo session · Test data · <a href="/access">Access administration</a><button className="secondary-button" onClick={() => { signOut().catch(() => setError('Could not switch person. Please try again.')); }}>Switch person</button></aside>}<h1>My profile</h1><p className="subtitle">Your account and workspace details.</p>
      {loading ? <section className="profile-panel" role="status">Loading your profile…</section> : error ? <section className="profile-panel"><ShieldCheck size={28} /><h2>Workspace access</h2><p role="alert">{error}</p><button className="secondary-button" onClick={() => setAttempt(value => value + 1)}>Try again</button></section> : profile && <>
        <section className="profile-panel profile-identity"><div className="profile-avatar" aria-hidden="true">{profile.displayName.trim().split(/\s+/).slice(0,2).map(name => name[0]).join('')}</div><div><h2>{profile.displayName}</h2><p>{profile.organization}</p><span className="profile-status">Active workspace member</span></div></section>
        <section className="profile-panel"><h2>Workspace details</h2><dl className="profile-details"><div><dt>Employee code</dt><dd>{profile.employeeCode}</dd></div><div><dt>Assigned roles</dt><dd>{profile.roles.map(role => role.replaceAll('_',' ')).join(', ') || 'None assigned'}</dd></div><div><dt>Account status</dt><dd>{profile.status}</dd></div></dl></section>{profile.canViewSkills&&<a className="secondary-button" href="/skills">Skill catalogue</a>}
      </>}
    </main></div>;
}

function CataloguePage() {
 const [actions,setActions]=useState<HTMLDivElement|null>(null),[error,setError]=useState('');
 return <div className="profile-page"><a className="skip-link" href="#catalogue-main">Skip to content</a><header className="welcome-header"><ThemeSwitcher/><a href="/"><img src="/brand/sopra-steria.svg" alt="Sopra Steria"/></a><a href="/" className="secondary-button">My profile</a><button className="secondary-button" onClick={()=>signOut().catch(()=>setError('Sign out could not finish.'))}>Sign out</button></header><nav className="admin-topbar" aria-label="Skill catalogue actions"><div className="page-location"><h1>Skill catalogue</h1></div><div className="page-actions" ref={setActions}/></nav><main id="catalogue-main" className="catalogue-main">{error&&<p role="alert">{error}</p>}<SkillCatalogue actionsContainer={actions}/></main></div>;
}

function Overview() {
  return <div className="profile-page"><header className="welcome-header"><ThemeSwitcher/><img src="/brand/sopra-steria.svg" alt="Sopra Steria"/><a className="secondary-button" href="/">Sign in</a></header><main className="profile-main"><h1>Workspace preview</h1><p className="subtitle">Planned modules. Sign in to access your assigned workspace.</p><div className="module-grid">{modules.map(({title,icon:Icon,description})=><section className="module-card" key={title}><Icon size={20} aria-hidden="true"/><h2>{title}</h2><p>{description}</p></section>)}</div></main></div>;
}
