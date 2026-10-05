import {useEffect,useState} from 'react';
import {useSearchParams} from 'react-router';
import {authenticatedFetch} from './auth';
import {FormDialog} from './FormDialog';
import {SkillClaimDialog} from './SkillClaimDialog';
import type {Claim} from './MySkills';
import {Recommendations} from './Recommendations';
import {TeamCapability} from './TeamCapability';
import type {ClaimReviewDecision} from './ClaimReviewAccess';
import {toast} from './Toast';
import {ArrowRight,CheckCheck,ChevronLeft,ChevronRight,ClipboardCheck,Clock3,FileCheck2,MessageSquareMore,RefreshCw,Search,ShieldCheck,UsersRound,XCircle} from 'lucide-react';
import './review-workbench.css';

async function result<T>(response:Response):Promise<T>{const data=await response.json().catch(()=>undefined);if(!response.ok)throw Error(data?.error?.message??'This action could not finish. Reload to check the current state before retrying.');return data;}
interface ReviewQueue {claims:Claim[];total:number;pageSize:number;canViewTeam?:boolean;canRecommend?:boolean;canReadHistory?:boolean;categories?:string[];summary?:{pending:number;approved:number;changes:number;rejected:number}}
const reviewLabels:Record<string,string>={SUBMITTED:'Pending review',APPROVED:'Manager reviewed',CHANGES_REQUESTED:'Changes requested',REJECTED:'Not approved',ALL:'All review states'};
export function SkillReviews(){
 const [params,setParams]=useSearchParams(),[view,setView]=useState<'queue'|'team'|'recommendations'>('queue');
 const [data,setData]=useState<ReviewQueue>(),[page,setPage]=useState(1),[attempt,setAttempt]=useState(0),[loading,setLoading]=useState(true),[opening,setOpening]=useState(false),[error,setError]=useState(''),[claim,setClaim]=useState<Claim>();
 useEffect(()=>{if(params.get('tab')==='recommendations')setView('recommendations');},[params]);
 const [search,setSearch]=useState(''),[query,setQuery]=useState(''),[category,setCategory]=useState(''),[status,setStatus]=useState('SUBMITTED'),[person,setPerson]=useState<string>();
 useEffect(()=>{const controller=new AbortController();setLoading(true);setError('');setClaim(undefined);const filters=new URLSearchParams({page:String(page),search:query,category,status});if(person)filters.set('person',person);authenticatedFetch('/api/skill-reviews?'+filters,{signal:controller.signal}).then(result<ReviewQueue>).then(value=>{if(!controller.signal.aborted)setData(value);}).catch(reason=>{if(!controller.signal.aborted){setData(undefined);setClaim(undefined);setError(reason.message);}}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});return()=>controller.abort();},[page,attempt,query,category,status,person]);
 useEffect(()=>{const id=params.get('claim');if(!id||loading||!data)return;const next=new URLSearchParams(params);next.delete('claim');setParams(next,{replace:true});void openClaim(id);},[params,loading,data]);
 async function openClaim(id:string){if(opening)return;setOpening(true);setError('');try{if(!data?.canReadHistory){const item=data?.claims.find(c=>c.id===id);if(!item)throw Error('This claim is unavailable in your current queue.');setClaim(item);}else{const detail=await result<{claim:Claim;reviewAccess:ClaimReviewDecision}>(await authenticatedFetch('/api/skill-reviews/'+encodeURIComponent(id)));setClaim({...detail.claim,reviewAccess:detail.reviewAccess});}}catch(e){setClaim(undefined);setError(e instanceof Error?e.message:'Review unavailable.');}finally{setOpening(false);}}
 function clear(){setSearch('');setQuery('');setCategory('');setStatus('SUBMITTED');setPerson(undefined);setPage(1);}
 const filtered=Boolean(query||category||person||status!=='SUBMITTED');
 const metrics=[
  {key:'SUBMITTED',label:'Awaiting review',hint:'Ready for your decision',value:data?.summary?.pending,icon:Clock3,tone:'amber'},
  {key:'APPROVED',label:'Manager reviewed',hint:'Approved proficiency claims',value:data?.summary?.approved,icon:FileCheck2,tone:'teal'},
  {key:'CHANGES_REQUESTED',label:'Changes requested',hint:'Feedback shared with employees',value:data?.summary?.changes,icon:MessageSquareMore,tone:'blue'},
  {key:'REJECTED',label:'Not approved',hint:'Claims with a recorded decision',value:data?.summary?.rejected,icon:XCircle,tone:'rose'},
 ];
 const navigation=<nav className="review-workspace-tabs" aria-label="Skill review workspace"><button aria-pressed={view==='queue'} onClick={()=>{setView('queue');setAttempt(n=>n+1);}}><ClipboardCheck size={18}/>Review queue</button>{data?.canViewTeam&&<button aria-pressed={view==='team'} onClick={()=>setView('team')}><UsersRound size={18}/>Team analytics</button>}{data?.canRecommend&&<button aria-pressed={view==='recommendations'} onClick={()=>setView('recommendations')}><MessageSquareMore size={18}/>Recommendations</button>}</nav>;
 return <div className="review-shell">
  {!(view==='team'&&data?.canViewTeam)&&navigation}
  {view==='recommendations'&&data?.canRecommend?<Recommendations sentOnly/>:view==='team'&&data?.canViewTeam?<TeamCapability navigation={navigation} onReviews={id=>{setPerson(id);setStatus('SUBMITTED');setPage(1);setQuery('');setSearch('');setView('queue');}}/>:<>
  {error&&<div className="review-error" role="alert"><span>{error}</span><button className="secondary-button" onClick={()=>setAttempt(n=>n+1)}>Retry</button></div>}
  {(data?.summary||loading)&&<div className="review-metrics" aria-label="Filter reviews by status">{metrics.map(item=><button className={'review-metric '+item.tone} key={item.key} disabled={loading} aria-pressed={status===item.key} onClick={()=>{setStatus(item.key);setPage(1);}}><span className="review-metric-icon"><item.icon size={22}/></span><span className="review-metric-copy"><strong>{loading?'—':item.value??'—'}</strong><span>{item.label}</span><small>{item.hint}</small></span><ArrowRight size={16} className="review-metric-arrow"/></button>)}</div>}
  <section className="review-workbench" aria-label="Assigned skill reviews" aria-busy={loading}>
   <header><div><h3>{status==='ALL'?'All assigned reviews':reviewLabels[status]}</h3><p>{loading?'Checking current assignments…':`${data?.total??0} ${data?.total===1?'claim':'claims'}${filtered?' matching your filters':' assigned to you'}`}</p></div><button className="secondary-button review-refresh" disabled={loading} onClick={()=>setAttempt(n=>n+1)}><RefreshCw size={16} className={loading?'review-spin':''}/><span>Refresh</span></button></header>
   <form className="review-filters" onSubmit={e=>{e.preventDefault();setPage(1);setQuery(search.trim());}}>
    <div className="review-search"><Search size={18}/><input type="search" aria-label="Search review employee or skill" placeholder="Search employee, code or skill…" maxLength={100} value={search} onChange={e=>setSearch(e.target.value)}/><button type="submit" disabled={loading}>Search</button></div>
    <select aria-label="Review category" value={category} onChange={e=>{setCategory(e.target.value);setPage(1);}}><option value="">All categories</option>{data?.categories?.map(c=><option key={c}>{c}</option>)}</select>
    <select aria-label="Review status" value={status} onChange={e=>{setStatus(e.target.value);setPage(1);}}>{Object.entries(reviewLabels).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select>
    <button type="button" className="review-clear" disabled={!filtered&&!search} onClick={clear}>Clear</button>
   </form>
   {person&&<div className="review-filter-note">Showing one team member’s assigned claims.<button onClick={()=>{setPerson(undefined);setPage(1);}}>Show all direct reports</button></div>}
   {opening&&<p className="review-opening" role="status">Checking current claim access…</p>}
   {loading&&<div className="review-loading" role="status"><span className="review-loading-icon"><RefreshCw size={22} className="review-spin"/></span><strong>Loading your review queue</strong><p>Checking current assignments and claim status.</p></div>}
   {!loading&&data&&!data.claims.length&&<div className="review-empty"><span className="review-empty-icon">{filtered?<Search size={30}/>:<CheckCheck size={32}/>}</span><h3>{filtered?'No matching reviews':'You’re all caught up'}</h3><p>{filtered?'Try another employee, category or review status.':'There are no skill claims awaiting your review. New submissions assigned to you will appear here.'}</p><div className="review-empty-actions">{filtered?<button className="secondary-button" onClick={clear}>Reset filters</button>:<><button className="secondary-button" onClick={()=>{setStatus('ALL');setPage(1);}}>View all review states<ArrowRight size={16}/></button>{data.canViewTeam&&<button className="review-text-action" onClick={()=>setView('team')}>Explore team analytics<ArrowRight size={16}/></button>}</>}</div></div>}
   {!loading&&data&&data.claims.length>0&&<div className="my-skills-table-wrap"><table className="my-skills-table review-table"><thead><tr><th>Employee</th><th>Skill / category</th><th>Claimed proficiency</th><th>Status</th><th>Updated</th><th>Action</th></tr></thead><tbody>{data.claims.map(item=><tr key={item.id}><td><div className="review-person"><span className="review-person-avatar" aria-hidden="true">{(item.personName??'').split(' ').filter(Boolean).slice(0,2).map(n=>n[0]).join('')}</span><strong>{item.personName}</strong></div></td><td><strong>{item.skillName}</strong><span className="review-subtext">{item.category}</span></td><td><span className="review-level">L{item.rank}</span><span className="review-subtext">{item.levelName}</span></td><td><span className={'review-status '+item.status.toLowerCase()}>{reviewLabels[item.status]??item.status}</span></td><td>{new Date(item.updatedAt).toLocaleDateString()}</td><td><button className={item.status==='SUBMITTED'?'admin-primary':'secondary-button'} disabled={opening} onClick={()=>void openClaim(item.id)}>{item.status==='SUBMITTED'?'Review claim':'View history'}<ArrowRight size={15}/></button></td></tr>)}</tbody></table></div>}
   {!loading&&data&&data.total>0&&<footer><span>Showing {(page-1)*data.pageSize+1}–{Math.min(page*data.pageSize,data.total)} of {data.total} claims</span><div className="review-pagination"><button aria-label="Previous reviews page" className="secondary-button" disabled={page===1} onClick={()=>setPage(n=>n-1)}><ChevronLeft size={17}/></button><span>Page {page}</span><button aria-label="Next reviews page" className="secondary-button" disabled={page*data.pageSize>=data.total} onClick={()=>setPage(n=>n+1)}><ChevronRight size={17}/></button></div></footer>}
  </section>
  <p className="review-policy-note"><ShieldCheck size={15}/>Only assigned claims from your current direct reports appear here. Private drafts stay with the employee.</p>
  {!claim&&!error&&(opening||Boolean(params.get('claim')))&&<FormDialog title="Skill review" busy={opening} onClose={()=>{const next=new URLSearchParams(params);next.delete('claim');setParams(next,{replace:true});}}><div className="notification-destination-loading" role="status"><RefreshCw size={26} className="notification-spin"/><strong>Opening skill review…</strong><p>Checking the current claim and your available actions.</p></div></FormDialog>}
  {claim&&<SkillClaimDialog claim={claim} mode={claim.status==='SUBMITTED'&&claim.reviewAccess?.allowed?'review':'view'} history={data?.canReadHistory} onClose={()=>setClaim(undefined)} onSaved={()=>{setClaim(undefined);toast.success('Review saved. The employee has been notified.');setAttempt(n=>n+1);window.dispatchEvent(new Event('notifications-updated'));}}/>}
  </>}
 </div>;
}
