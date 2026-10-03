import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { BookOpen, ChevronRight, Compass, LayoutDashboard, Menu, ShieldCheck, UserRound } from 'lucide-react';
import { authenticatedFetch, isDemoSession } from './auth';
import { Sidebar } from './Sidebar';
import { NavigationDrawer } from './NavigationDrawer';
import { NavbarAccount } from './NavbarAccount';
import {SkillReviews} from './SkillReviews';
import { MySkills } from './MySkills';
import { SkillCatalogue } from './SkillCatalogue';

export interface WorkspaceState {
  person: { id: string; displayName: string; employeeCode: string; roles: string[] };
  authentication: 'microsoft' | 'local-demo';
  capabilities: { ownProfile: boolean; ownSkills: boolean; claimSkills: boolean; catalogue: boolean; administration: boolean; manageCatalogue: boolean; reviewSkills?:boolean };
  upcoming: { id: string; label: string; assigned: boolean; implemented: false }[];
}
type View = 'overview' | 'profile' | 'my-skills' | 'skills' | 'skill-reviews';
const currentView = (pathname: string): View => pathname === '/skill-reviews' ? 'skill-reviews' : pathname === '/profile' ? 'profile' : pathname === '/my-skills' ? 'my-skills' : pathname === '/skills' ? 'skills' : 'overview';

export function Workspace({embedded=false,actionsContainer,initialWorkspace}:{embedded?:boolean;actionsContainer?:HTMLDivElement|null;initialWorkspace?:WorkspaceState}) {
  const { pathname } = useLocation(), navigate = useNavigate();
  const [state, setState] = useState<WorkspaceState|undefined>(initialWorkspace);
  const [error, setError] = useState(''), [attempt, setAttempt] = useState(0);
  const [navigationOpen, setNavigationOpen] = useState(false), [actions, setActions] = useState<HTMLDivElement | null>(null);
  const view = currentView(pathname);
  useEffect(() => {
    if(initialWorkspace&&attempt===0){setState(initialWorkspace);return;}
    const controller = new AbortController();
    setState(undefined); setError('');
    authenticatedFetch('/api/workspace', { signal: controller.signal }).then(async response => {
      const body = await response.json().catch(() => undefined);
      if (!response.ok) throw new Error(body?.error?.message ?? 'Your workspace could not be loaded.');
      if (controller.signal.aborted) return;
      setState(body);
    }).catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Your workspace could not be loaded.'); });
    return () => controller.abort();
  }, [attempt,initialWorkspace]);
  useEffect(() => { if (pathname === '/' && state?.capabilities.administration) navigate('/access', { replace: true }); }, [pathname, state, navigate]);
  useEffect(() => { setNavigationOpen(false); window.scrollTo({ top: 0 }); }, [pathname]);
  const name = state?.person.displayName ?? 'Workspace member';
  const firstName = state ? name.trim().split(/\s+/)[0] || 'there' : 'there';
  const sections = [
    {id:'skill-reviews',label:'Skill reviews',href:'/skill-reviews',icon:ShieldCheck,visible:state?.capabilities.reviewSkills},
    { id: 'overview', label: 'Dashboard', href: '/workspace', icon: LayoutDashboard, visible: true },
    { id: 'profile', label: 'My profile', href: '/profile', icon: UserRound, visible: state?.capabilities.ownProfile },
    { id: 'my-skills', label: 'My skills', href: '/my-skills', icon: Compass, visible: state?.capabilities.ownSkills },
    { id: 'skills', label: 'Skill catalogue', href: '/skills', icon: BookOpen, visible: state?.capabilities.catalogue },
  ];
  const permitted = view === 'overview' || sections.some(section => section.id === view && section.visible);
  const sidebarContent = (close: () => void = () => {}) => <>
    <Link className="admin-brand" to="/workspace"><img src="/brand/sopra-steria.svg" alt="Sopra Steria" /></Link>
    <p className="nav-caption">MY WORKSPACE</p>
    <nav aria-label="Personal workspace sections">{sections.filter(section => section.visible).map(({ id, label, href, icon: Icon }) => <Link className="workspace-nav-link" key={id} to={href} aria-current={view === id ? 'page' : undefined} onClick={close}><Icon size={19} />{label}{view === id && <ChevronRight size={15} />}</Link>)}</nav>
    {state?.capabilities.administration && <Link className="workspace-context-link" to="/access"><ShieldCheck size={18} />Administration</Link>}
  </>;
  if(embedded)return <>
    {error&&<p role="alert">{error}<button className="secondary-button" onClick={()=>setAttempt(value=>value+1)}>Retry</button></p>}
    {!state&&!error&&<p role="status">Loading your workspace…</p>}
    {state&&!permitted&&<section className="profile-panel"><h2>Access is not assigned</h2><p>Your current permissions do not include this page.</p></section>}
    {state&&permitted&&<>
      {view==='overview'&&<PersonalDashboard workspace={state}/>}
      {view==='profile'&&<PersonalProfile workspace={state}/>}
      {view==='my-skills'&&<MySkills actionsContainer={actionsContainer??null}/>}
      {view==='skill-reviews'&&<SkillReviews/>}
      {view==='skills'&&<SkillCatalogue actionsContainer={actionsContainer??null}/>}
    </>}
  </>;
  return <div className="admin-shell personal-workspace">
    <a className="skip-link" href="#workspace-main">Skip to content</a>
    <Sidebar className="desktop-sidebar">{sidebarContent()}</Sidebar>
    {navigationOpen && <NavigationDrawer onClose={() => setNavigationOpen(false)}>{close => <Sidebar>{sidebarContent(close)}</Sidebar>}</NavigationDrawer>}
    <div className="admin-content"><header className="admin-topbar">
      <button className="navigation-toggle secondary-button" aria-label="Open navigation" aria-expanded={navigationOpen} aria-controls="workspace-navigation" onClick={() => setNavigationOpen(true)}><Menu size={20} /></button>
      <div className="page-location navbar-context"><div className="navbar-greeting"><span className="greeting-hello">Hello,</span><strong className="greeting-name" title={name}>{firstName}</strong></div><h1>{sections.find(section => section.id === view)?.label}</h1></div>
      <div className="page-actions" role="group" aria-label="Page actions" ref={setActions} />
      <NavbarAccount name={name} identity={state?.authentication === 'local-demo' ? 'Development session' : 'Microsoft account'} workspaceLink={state?.capabilities.administration ? { href: '/access', label: 'Administration' } : undefined} />
    </header>
    <main id="workspace-main" className="access-main" tabIndex={-1}>
      {isDemoSession() && <p className="workspace-demo" role="status">Development session · {state?.person.employeeCode ?? 'Loading person…'}</p>}
      {error && <section className="profile-panel"><h2>Workspace access</h2><p role="alert">{error}</p><button className="secondary-button" onClick={() => setAttempt(value => value + 1)}>Retry</button></section>}
      {!state && !error && <p role="status">Loading your workspace…</p>}
      {state && !permitted && <section className="profile-panel"><h2>Access is not assigned</h2><p>Your current permissions do not include this page.</p><Link className="secondary-button" to="/workspace">Return to dashboard</Link></section>}
      {state && permitted && <>
        {view === 'overview' && <PersonalDashboard workspace={state} />}
        {view === 'profile' && <PersonalProfile workspace={state}/>}
        {view === 'my-skills' && <MySkills actionsContainer={actions} />}
        {view === 'skill-reviews' && <SkillReviews/>}
        {view === 'skills' && <SkillCatalogue actionsContainer={actions} />}
      </>}
    </main></div>
  </div>;
}

function PersonalProfile({workspace:state}:{workspace:WorkspaceState}){return <section className="profile-panel"><div className="panel-title"><h2>{state.person.displayName}</h2><span className="claim-status">Active member</span></div><dl className="profile-details"><div><dt>Employee code</dt><dd>{state.person.employeeCode}</dd></div><div><dt>Assigned roles</dt><dd>{state.person.roles.join(', ')||'None assigned'}</dd></div><div><dt>Sign-in</dt><dd>{state.authentication==='local-demo'?'Temporary development login':'Microsoft'}</dd></div></dl></section>;}

function PersonalDashboard({ workspace }: { workspace: WorkspaceState }) {
  const [skills, setSkills] = useState<{ total: number; claims: { id: string; skillName: string; levelName: string }[] }>();
  const [error, setError] = useState(''), [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!workspace.capabilities.ownSkills) return;
    const controller = new AbortController(); setError(''); setSkills(undefined);
    authenticatedFetch('/api/my-skills?page=1', { signal: controller.signal }).then(async response => {
      if (!response.ok) throw new Error('Your skill summary could not be loaded.');
      const body = await response.json(); if (!controller.signal.aborted) setSkills(body);
    }).catch(reason => { if (!controller.signal.aborted) setError(reason.message); });
    return () => controller.abort();
  }, [workspace, attempt]);
  return <div className="personal-dashboard">
    {workspace.capabilities.ownSkills && <section className="profile-panel personal-skills-summary">
      <div className="panel-title"><div><p className="workspace-eyebrow">MY CAPABILITY</p><h2>Your skills</h2></div><Link className="secondary-button" to="/my-skills">{workspace.capabilities.claimSkills ? 'Manage skills' : 'View skills'}<ChevronRight size={16} /></Link></div>
      {error ? <div><p role="alert">{error}</p><button className="secondary-button" onClick={() => setAttempt(value => value + 1)}>Retry</button></div> : !skills ? <p role="status">Loading your skills…</p> : <>
        <p className="personal-skill-total"><strong>{skills.total}</strong><span>self-assessed {skills.total === 1 ? 'draft' : 'drafts'}</span></p>
        {skills.claims.length ? <ul className="personal-skill-list">{skills.claims.slice(0, 4).map(skill => <li key={skill.id}><div><strong>{skill.skillName}</strong><span>{skill.levelName}</span></div><span className="claim-status">Draft · Unverified</span></li>)}</ul> : <p className="workspace-muted">Start with a published skill and describe your experience.</p>}
      </>}
    </section>}
    <section className="profile-panel workspace-identity"><div className="panel-title"><h2>My workspace</h2>{workspace.capabilities.ownProfile && <Link className="admin-text-button" to="/profile">My profile<ChevronRight size={16} /></Link>}</div><p>{workspace.person.roles.join(' · ') || 'No role assigned'}</p>{!workspace.capabilities.ownSkills && <p className="workspace-muted">Personal skill access is not assigned to this account.</p>}{workspace.capabilities.administration && <Link className="secondary-button" to="/access"><ShieldCheck size={17} />Open administration</Link>}</section>
    {workspace.upcoming.length > 0 && <details className="profile-panel workspace-upcoming"><summary>Upcoming workflows</summary><p>Your permission sets include these workflows. Their pages and actions are still being built.</p><ul>{workspace.upcoming.map(item => <li key={item.id}>{item.label}<span>In development</span></li>)}</ul></details>}
  </div>;
}
