import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Plus, Search, X, BookOpen } from 'lucide-react';
import { authenticatedFetch } from './auth';

interface Level {rank:number;name:string;description:string}
interface Skill {id?:string;name:string;category:string;description:string;status:'DRAFT'|'PUBLISHED'|'ARCHIVED';levels:Level[]}
interface State {revision:number;canManage:boolean;total:number;page:number;pageSize:number;skills:Skill[]}
const blank=():Skill=>({name:'',category:'',description:'',status:'DRAFT',levels:[{rank:1,name:'Level 1',description:''},{rank:2,name:'Level 2',description:''},{rank:3,name:'Level 3',description:''}]});
async function responseBody(response:Response) {
 const body=await response.json().catch(()=>undefined);
 if(!response.ok)throw new Error(body?.error?.message??(response.status===403?'Skill catalogue permission is not assigned.':response.status===401?'Sign in to view the catalogue.':'The catalogue could not be loaded. Please try again.'));
 return body as State;
}
export function SkillCatalogue({actionsContainer,onChanged}:{actionsContainer:HTMLElement|null;onChanged?:()=>void}) {
 const [state,setState]=useState<State>(),[search,setSearch]=useState(''),[status,setStatus]=useState(''),[page,setPage]=useState(1),[attempt,setAttempt]=useState(0);
 const [draft,setDraft]=useState<Skill>(),[draftRevision,setDraftRevision]=useState(0),[error,setError]=useState(''),[notice,setNotice]=useState(''),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false);
 const nameInput=useRef<HTMLInputElement>(null);
 const query=()=>new URLSearchParams({search,status,page:String(page)}).toString();
 useEffect(()=>{
  const controller=new AbortController();setLoading(true);setError('');
  const timer=setTimeout(()=>{authenticatedFetch('/api/skills?'+new URLSearchParams({search,status,page:String(page)}),{signal:controller.signal}).then(responseBody).then(body=>{if(!controller.signal.aborted)setState(body);}).catch(err=>{if(!controller.signal.aborted)setError(err.message);}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});},200);
  return()=>{clearTimeout(timer);controller.abort();};
 },[search,status,page,attempt]);
 function create(){if(!state?.canManage)return;setDraft(blank());setDraftRevision(state.revision);setNotice('');requestAnimationFrame(()=>nameInput.current?.focus());}
 function choose(skill:Skill){setDraft(structuredClone(skill));setDraftRevision(state!.revision);setError('');setNotice('');}
 function levels(next:Level[]){if(draft)setDraft({...draft,levels:next.map((level,index)=>({...level,rank:index+1}))});}
 async function save(){
  if(!draft||!state?.canManage||busy)return;setBusy(true);setError('');setNotice('');let saved=false;
  try{
   await responseBody(await authenticatedFetch('/api/skills',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...draft,revision:draftRevision})}));
   saved=true;setDraft(undefined);setNotice('Skill saved.');onChanged?.();
   const fresh=await responseBody(await authenticatedFetch('/api/skills?'+query()));setState(fresh);
  }catch(err){setError((saved?'The skill was saved, but refreshing failed. ':'')+(err instanceof Error?err.message:'The skill could not be saved.'));}finally{setBusy(false);}
 }
 const actions=state?.canManage?<button className="admin-primary" disabled={busy||loading} onClick={create}><Plus size={17}/>New skill</button>:null;
 return <>{actionsContainer?createPortal(actions,actionsContainer):actions}
  {error&&<div className="access-message" role="alert">{error}<button className="secondary-button" disabled={busy} onClick={()=>setAttempt(value=>value+1)}>Reload catalogue</button></div>}{notice&&<p className="access-message" role="status">{notice}</p>}
  <div className={'catalogue-layout'+(draft?' has-detail':'')}>
   <section className="profile-panel catalogue-list" aria-label="Skill catalogue">
    <div className="catalogue-filters"><label className="list-search"><Search size={16} aria-hidden="true"/><input disabled={busy} aria-label="Search skills" placeholder="Skill or category…" maxLength={100} value={search} onChange={event=>{setSearch(event.target.value);setPage(1);}}/></label>{state?.canManage&&<label className="department-filter">Status<select disabled={busy} value={status} onChange={event=>{setStatus(event.target.value);setPage(1);}}><option value="">All skills</option><option value="DRAFT">Draft</option><option value="PUBLISHED">Published</option><option value="ARCHIVED">Archived</option></select></label>}</div>
    {loading&&<p role="status">Loading skills…</p>}
    {!loading&&state&&!state.skills.length&&<div className="catalogue-empty"><BookOpen size={26} aria-hidden="true"/><h2>{search||status?'No matching skills':state.canManage?'Your catalogue is ready':'No published skills yet'}</h2><p>{search||status?'Try another search or filter.':state.canManage?'Create a skill and define its proficiency levels.':'Published skills will appear here.'}</p></div>}
    {!!state?.skills.length&&<div className="audit-scroll"><table className="catalogue-table"><thead><tr><th scope="col">Skill</th><th scope="col">Category</th><th scope="col">Levels</th>{state.canManage&&<th scope="col">Status</th>}</tr></thead><tbody>{state.skills.map(skill=><tr key={skill.id} className={draft?.id===skill.id?'selected':''}><th scope="row"><button className="catalogue-open" disabled={busy||loading} aria-pressed={draft?.id===skill.id} onClick={()=>choose(skill)}>{skill.name}</button></th><td>{skill.category}</td><td>{skill.levels.length}</td>{state.canManage&&<td><span className={'skill-status '+skill.status.toLowerCase()}>{skill.status[0]+skill.status.slice(1).toLowerCase()}</span></td>}</tr>)}</tbody></table></div>}
    {state&&state.total>0&&<div className="catalogue-pagination"><span>{state.total} skills · Page {state.page} of {Math.ceil(state.total/state.pageSize)}</span><button className="secondary-button" disabled={busy||loading||page<=1} onClick={()=>setPage(value=>value-1)}>Previous</button><button className="secondary-button" disabled={busy||loading||page*state.pageSize>=state.total} onClick={()=>setPage(value=>value+1)}>Next</button></div>}
   </section>
   {draft&&<section className="profile-panel catalogue-detail"><div className="panel-title"><h2>{state?.canManage?draft.id?'Edit skill':'Create skill':draft.name}</h2><button type="button" className="catalogue-close" aria-label="Close skill details" disabled={busy} onClick={()=>setDraft(undefined)}><X size={18}/></button></div>
    {state?.canManage?<form className="access-form" onSubmit={event=>{event.preventDefault();void save();}}><fieldset className="catalogue-fields" disabled={busy}>
     <label>Skill name<input ref={nameInput} required maxLength={100} value={draft.name} onChange={event=>setDraft({...draft,name:event.target.value})}/></label>
     <label>Category<input required maxLength={80} list="skill-categories" value={draft.category} onChange={event=>setDraft({...draft,category:event.target.value})}/><datalist id="skill-categories">{[...new Set(state.skills.map(skill=>skill.category))].map(category=><option key={category} value={category}/>)}</datalist></label>
     <label>Description<textarea required={draft.status==='PUBLISHED'} maxLength={2000} rows={3} value={draft.description} onChange={event=>setDraft({...draft,description:event.target.value})}/></label>
     <label>Status<select value={draft.status} onChange={event=>setDraft({...draft,status:event.target.value as Skill['status']})}><option value="DRAFT">Draft</option><option value="PUBLISHED">Published</option><option value="ARCHIVED">Archived</option></select></label>
     <div className="panel-title"><h3>Proficiency levels</h3><button type="button" className="secondary-button" disabled={draft.levels.length>=8} onClick={()=>levels([...draft.levels,{rank:draft.levels.length+1,name:`Level ${draft.levels.length+1}`,description:''}])}><Plus size={15}/>Add level</button></div>
     {draft.levels.map((level,index)=><div className="skill-level-editor" role="group" aria-label={`Proficiency level ${level.rank}`} key={index}><div className="panel-title"><strong>Level {level.rank}</strong><button type="button" className="catalogue-close" aria-label={`Remove proficiency level ${level.rank}`} disabled={draft.levels.length<=1} onClick={()=>levels(draft.levels.filter((_,i)=>i!==index))}><X size={16}/></button></div><label>Name<input required maxLength={60} value={level.name} onChange={event=>levels(draft.levels.map((item,i)=>i===index?{...item,name:event.target.value}:item))}/></label><label>Criteria<textarea required={draft.status==='PUBLISHED'} rows={2} maxLength={1000} value={level.description} onChange={event=>levels(draft.levels.map((item,i)=>i===index?{...item,description:event.target.value}:item))}/></label></div>)}
     <p className="access-help">Published skills require a description and criteria for each level.</p><button className="microsoft-button" disabled={loading}>{busy?'Saving…':'Save skill'}</button>
    </fieldset></form>:<><p className="skill-category">{draft.category}</p><p>{draft.description}</p><h3>Proficiency levels</h3><ol className="skill-level-list">{draft.levels.map(level=><li key={level.rank}><strong>{level.name}</strong><p>{level.description}</p></li>)}</ol></>}
   </section>}
  </div></>;
}
