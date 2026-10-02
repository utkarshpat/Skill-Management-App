import { useEffect, useState } from 'react';
import { ArrowUpRight, BookOpen, BriefcaseBusiness, Check, ChevronRight, CircleHelp, Compass, Layers3, LayoutDashboard, ListChecks, LockKeyhole, RefreshCw, Settings2, ShieldCheck, Sparkles, Users } from 'lucide-react';

const modules = [
  { title: 'My Capability', icon: Compass, description: 'Your skills, evidence and experience.' },
  { title: 'Team & Assessment', icon: Users, description: 'Understand capability. Verify with confidence.' },
  { title: 'Credentials & Development', icon: BookOpen, description: 'Turn learning goals into daily progress.' },
  { title: 'Projects & Demand', icon: BriefcaseBusiness, description: 'Define the capability a project needs.' },
  { title: 'Supply & Matching', icon: Layers3, description: 'Connect verified skills to opportunities.' },
  { title: 'Requests & Incidents', icon: ListChecks, description: 'Request access and report issues.' },
];

export function App() {
  const [health, setHealth] = useState<'loading' | 'ok' | 'error'>('loading');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    let disposed = false;
    const timeout = setTimeout(() => controller.abort(), 5000);
    setHealth('loading');
    fetch('/api/health', { signal: controller.signal }).then(async response => {
      if (!response.ok) throw new Error('API unavailable');
      const body = await response.json();
      if (body.status !== 'ok' || body.service !== 'capability-api') throw new Error('Unexpected response');
      if (!disposed) setHealth('ok');
    }).catch(() => { if (!disposed) setHealth('error'); }).finally(() => clearTimeout(timeout));
    return () => { disposed = true; clearTimeout(timeout); controller.abort(); };
  }, [attempt]);

  return <div className="app">
    <a className="skip-link" href="#main">Skip to content</a>
    <aside className="sidebar" aria-label="Primary navigation">
      <div className="brand"><div className="brand-mark"><Layers3 size={23} /></div><div>capability<span>WORKFORCE PLATFORM</span></div></div>
      <div className="workspace-label">YOUR WORKSPACE</div>
      <nav><a className="nav-item active" href="#main" aria-current="page"><LayoutDashboard size={18} />Overview</a>
        {modules.map(({title, icon: Icon}) => <button className="nav-item" key={title} disabled title="Available in a future build step"><Icon size={18} />{title}<LockKeyhole className="nav-lock" size={12} /></button>)}
        <button className="nav-item" disabled><Sparkles size={18} />AI Assistant<LockKeyhole className="nav-lock" size={12} /></button>
        <button className="nav-item" disabled><Settings2 size={18} />Administration<LockKeyhole className="nav-lock" size={12} /></button>
      </nav>
      <div className="sidebar-bottom"><ShieldCheck size={18} /><div>Built on trust<span>Verified skills. Human decisions.</span></div></div>
    </aside>
    <div className="content">
      <header className="topbar"><div>Workspace <ChevronRight size={14} /><strong>Overview</strong></div><span className="build-label">LOCAL DEVELOPMENT</span></header>
      <main id="main" tabIndex={-1}>
        <div className="page-heading"><div><p className="eyebrow">PEOPLE. POTENTIAL. PROGRESS.</p><h1>A clearer picture of capability.</h1><p className="subtitle">One place to understand skills, build expertise and plan what comes next.</p></div><span className="phase-pill">Step 01 / Foundation</span></div>
        <section className="hero" aria-labelledby="hero-title"><div className="hero-copy"><span className="hero-tag"><span /> THE PLATFORM STARTS HERE</span><h2 id="hero-title">From individual skills<br />to collective strength.</h2><p>Build a trusted capability profile, create a learning path and connect your growth to real opportunities.</p><div className="hero-foot"><ShieldCheck size={18} />Evidence-backed capability. You stay in control.</div></div><div className="capability-map" aria-hidden="true"><div className="map-orbit"><span className="map-node node-top"><Users size={20} />People</span><span className="map-node node-right"><ShieldCheck size={20} />Verification</span><span className="map-node node-bottom"><BookOpen size={20} />Growth</span><span className="map-node node-left"><BriefcaseBusiness size={20} />Opportunity</span><div className="map-center"><Layers3 size={29} /><span>CAPABILITY</span></div></div></div></section>
        <section className="connection" aria-label="Platform connection"><div><span className={`status-dot ${health}`} /><div><strong>{health === 'ok' ? 'Frontend and API are connected' : health === 'loading' ? 'Checking API connection…' : 'API connection unavailable'}</strong><p aria-live="polite">{health === 'ok' ? 'Foundation is running. Organizational sign-in and Azure SQL are the next setup steps.' : health === 'loading' ? 'Verifying the local backend.' : 'Start the backend, then retry the connection check.'}</p></div></div><button className="secondary-button" disabled={health === 'loading'} onClick={() => setAttempt(value => value + 1)}><RefreshCw size={15} />Check connection</button></section>
        <div className="section-heading"><div><h2>Your workspace, step by step</h2><p>We will unlock each module as its complete workflow is built.</p></div><span>6 CORE WORKFLOWS</span></div>
        <section className="module-grid" aria-label="Planned modules">{modules.map(({title, icon: Icon, description}, index) => <article className="module-card" key={title}><div className="module-top"><div className="module-icon"><Icon size={20} /></div><span>0{index + 1}</span></div><h3>{title}</h3><p>{description}</p><div className="module-foot"><span><LockKeyhole size={12} />Planned</span><ArrowUpRight size={17} /></div></article>)}</section>
        <section className="next-step"><div className="next-icon"><Check size={20} /></div><div><span className="eyebrow">NEXT BUILD STEP</span><h3>Identity, organization and access</h3><p>Connect sign-in, store reporting relationships and enforce permissions before adding employee data.</p></div><CircleHelp size={21} /></section>
        <footer>Capability Platform <span>Foundation v0.1 · No employee records loaded</span></footer>
      </main>
    </div>
  </div>;
}
