import {useEffect,useState} from 'react';
import {Link} from 'react-router';
import {ArrowUpRight,Bell,BookOpen,CheckCircle2,Clock3,Inbox,Layers,Plus,RefreshCw,Sparkles} from 'lucide-react';
import {authenticatedFetch} from './auth';
import './dashboard.css';
import {DashboardQuickActions,type DashboardQuickAction} from './DashboardQuickActions';
import {DashboardRequests,type DashboardRequestsData,type RequestPreview} from './DashboardRequests';
import {DashboardCapability,type DashboardCapabilityData,type RecentCapabilityClaim} from './DashboardCapability';
import {DashboardLearning,learningTaskPrompt,type DashboardLearningData,type NextLearningTask} from './DashboardLearning';
import {DashboardAttention,type AttentionGroup} from './DashboardAttention';
interface Card {id:'attention'|'learning'|'capability'|'requests';title:string;description:string;endpoint:string;priority:number;size:string;scope:{kind:string;actorId:string}}
interface Manifest {revision:number;actorId:string;cards:Card[];actions:DashboardQuickAction[];ai:boolean}
interface Item {id:string;title:string;description:string;href:string;label:string;priority:number;urgency?:string}
interface CardData {canCreate?:boolean;recentRecords?:RequestPreview[];canClaim?:boolean;recentClaims?:RecentCapabilityClaim[];nextTask?:NextLearningTask|null;loggedMinutes?:number;groups?:AttentionGroup[];items?:Item[];total:number;partial?:boolean;verified?:number;pending?:number;draft?:number;changesRequested?:number;rejected?:number;activePlans?:number;progress?:number;completed?:number;overdue?:number;today?:number;submitted?:number;inProgress?:number;resolved?:number;cancelled?:number;canManage?:boolean}
async function read<T>(r:Response):Promise<T>{const body=await r.json().catch(()=>undefined);if(!r.ok)throw Object.assign(Error(body?.error?.message??'This information could not be loaded.'),{status:r.status});return body;}
export function openDashboardAssistant(card:Card['id']){
 const prompts={attention:'Help me prioritize my currently assigned requests, skill reviews and overdue learning tasks. Retrieve current authorized facts before advising.',learning:'Help me choose the next task in my own learning plans. Check my current progress and backlog first.',capability:'Help me improve my skill profile. Check my own reviewed, pending and draft claims; explain what I can update.',requests:'Help me check my own requests and their latest status. Retrieve current records and suggest permitted next steps.'};
 window.dispatchEvent(new CustomEvent('assistant-context-request',{detail:{prompt:prompts[card]}}));
}
export function Dashboard(){
 const [manifest,setManifest]=useState<Manifest>(),[error,setError]=useState(''),[attempt,setAttempt]=useState(0),[cardRefresh,setCardRefresh]=useState(0);
 useEffect(()=>{const c=new AbortController();let generation=0;
  const load=()=>{const n=++generation;authenticatedFetch('/api/dashboard',{signal:c.signal}).then(read<Manifest>).then(value=>{if(!c.signal.aborted&&n===generation){setManifest(value);setCardRefresh(v=>v+1);setError('');}}).catch(e=>{if(!c.signal.aborted&&n===generation){setError(e.message);setManifest(undefined);}});};
  load();const focus=()=>load(),timer=window.setInterval(()=>{if(document.visibilityState==='visible')load();},60000);
  window.addEventListener('focus',focus);window.addEventListener('notifications-updated',focus);window.addEventListener('own-skills-updated',focus);window.addEventListener('requests-updated',focus);
  return()=>{c.abort();clearInterval(timer);window.removeEventListener('focus',focus);window.removeEventListener('notifications-updated',focus);window.removeEventListener('own-skills-updated',focus);window.removeEventListener('requests-updated',focus);};
 },[attempt]);
 return <div className="dashboard-workspace">
  <div className="dashboard-heading"><div><h2>Your day, in focus</h2><p>Move work forward, build skills and keep track of what changes.</p></div><button className="secondary-button" onClick={()=>setAttempt(n=>n+1)} aria-label="Refresh dashboard"><RefreshCw size={17}/>Refresh</button></div>
  {error&&<section className="dashboard-card" role="alert"><h3>Dashboard could not be loaded</h3><p>{error}</p><button className="secondary-button" onClick={()=>setAttempt(n=>n+1)}>Retry</button></section>}
  {!manifest&&!error&&<div className="dashboard-grid" role="status" aria-label="Loading your dashboard">{[1,2,3].map(id=><div key={id} className="dashboard-card dashboard-skeleton"><i/><i/><i/></div>)}</div>}
  {manifest&&<>
   <div className="dashboard-grid">{manifest.cards.map(card=><DashboardCard key={manifest.actorId+card.id} card={card} revision={manifest.revision} refresh={cardRefresh} ai={manifest.ai} onAccessChanged={()=>setAttempt(n=>n+1)}/>)}
   <DashboardQuickActions actions={manifest.actions} onAssist={prompt=>window.dispatchEvent(new CustomEvent('assistant-context-request',{detail:{prompt}}))}/></div>
   {!manifest.cards.length&&<section className="dashboard-card"><h3>Your workspace is ready</h3><p>Your assigned features will appear here when access is available.</p></section>}
  </>}
 </div>;
}
function DashboardCard({card,revision,refresh,ai,onAccessChanged}:{card:Card;revision:number;refresh:number;ai:boolean;onAccessChanged:()=>void}){
 const [data,setData]=useState<CardData>(),[error,setError]=useState(''),[attempt,setAttempt]=useState(0),[denied,setDenied]=useState(false),[requestStatus,setRequestStatus]=useState('');
 useEffect(()=>{const c=new AbortController();setData(undefined);setError('');setDenied(false);
  authenticatedFetch(card.endpoint,{signal:c.signal}).then(read<CardData>).then(value=>{if(!c.signal.aborted)setData(value);}).catch(e=>{if(!c.signal.aborted){setData(undefined);if(e.status===403||e.status===409){setDenied(true);onAccessChanged();}else setError(e.message);}});
  return()=>c.abort();
 },[card.endpoint,revision,refresh,attempt]);
 const Icon={attention:Bell,learning:BookOpen,capability:Layers,requests:Inbox}[card.id];
 if(denied)return null;
 const href={attention:'/requests?inbox=true',learning:'/learning',capability:'/my-skills',requests:'/requests'}[card.id];
 return <section className={'dashboard-card dashboard-'+card.id+(card.id==='attention'&&data?.total===0&&!data.partial?' dashboard-caught-up':'')} aria-label={card.title}>
  <header><span className="dashboard-icon"><Icon size={20}/></span><div><h3>{card.title}</h3><p>{card.description}</p></div></header>
  {error?<div className="dashboard-error" role="alert"><p>{error}</p><button className="secondary-button" onClick={()=>setAttempt(n=>n+1)}>Retry</button></div>:!data?<div className="dashboard-skeleton" role="status" aria-label={'Loading '+card.title}><i/><i/><i/></div>:<>
   {card.id==='attention'&&<DashboardAttention total={data.total} partial={data.partial} groups={data.groups} onRetry={()=>setAttempt(n=>n+1)}/>}
   {card.id==='learning'&&<DashboardLearning data={data as DashboardLearningData} ai={ai} onHelp={task=>window.dispatchEvent(new CustomEvent('assistant-context-request',{detail:{prompt:learningTaskPrompt(task)}}))}/>}
   {card.id==='capability'&&<DashboardCapability data={data as DashboardCapabilityData}/>}
   {card.id==='requests'&&<DashboardRequests status={requestStatus} onStatusChange={setRequestStatus} fetcher={authenticatedFetch} data={data as DashboardRequestsData} onAccessChanged={()=>{setData(undefined);setDenied(true);onAccessChanged();}}/>}
   {card.id==='attention'&&Boolean(data.items?.length)&&<p className="dashboard-learning-caption">Recent actionable items · Open a queue for the complete list.</p>}
   {card.id==='attention'&&Boolean(data.items?.length)&&<ul className="dashboard-items">{data.items!.map(item=><li key={item.id}><div>{(item.urgency||item.priority>=100)&&<span className="dashboard-urgent"><Clock3 size={12}/>{item.urgency??(card.id==='learning'?'Overdue':'High priority')}</span>}<strong>{item.title}</strong><p>{item.description}</p></div><Link className="dashboard-item-action" to={item.href}>{item.label}<ArrowUpRight size={15}/></Link></li>)}</ul>}
   <footer>{card.id!=='attention'&&<Link className="dashboard-link" to={href}>View {card.id==='capability'?'my skills':card.id==='learning'?'learning plans':'all requests'}<ArrowUpRight size={15}/></Link>}{ai&&card.id!=='learning'&&<button className="dashboard-ai" onClick={()=>openDashboardAssistant(card.id)}><Sparkles size={15}/>{card.id==='attention'?'Help me prioritize':card.id==='capability'?'Help improve my profile':'Help with my requests'}</button>}</footer>
  </>}
 </section>;
}
