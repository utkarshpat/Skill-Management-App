import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { BookOpen, Plus, Pencil, Search } from 'lucide-react';
import { authenticatedFetch } from './auth';
import { SkillClaimDialog } from './SkillReviews';
import { FormDialog } from './FormDialog';
import { useLocation, useNavigate } from 'react-router';

export interface Claim {
  id:string; revision:number; skillId:string; skillName:string; category:string;
  definitionRevision:number; rank:number; levelName:string; experienceMonths:number;
  description:string; status:'DRAFT'|'SUBMITTED'|'CHANGES_REQUESTED'|'APPROVED'|'REJECTED'; updatedAt:string; projects?:string; evidence?:string; feedback?:string; personName?:string; levelDescription?:string;
}
interface Option { id:string; name:string; category:string; definitionRevision:number; levels:{rank:number;name:string;description:string}[] }
interface State { claims:Claim[]; total:number; page:number; pageSize:number; canClaim:boolean }
interface Options { skills:Option[]; total:number; page:number; pageSize:number }
interface Draft { id:string; revision:number; skillId:string; definitionRevision:number; rank:number; experienceMonths:number; description:string; projects?:string; evidence?:string }
const emptyDraft=():Draft=>({id:crypto.randomUUID(),revision:0,skillId:'',definitionRevision:0,rank:0,experienceMonths:0,description:''});
async function body<T>(response:Response):Promise<T> {
  const value=await response.json().catch(()=>undefined);
  if(!response.ok)throw new Error(value?.error?.message??(response.status===403?'Your account does not have access to this skill action.':'Could not load your skills. Please try again.'));
  return value;
}
export function MySkills({actionsContainer,reviewRequest}:{actionsContainer?:HTMLElement|null;reviewRequest?:{description:string;onClose:()=>void;onSaved:()=>void}}) {
  const location=useLocation(),navigate=useNavigate();
  const [state,setState]=useState<State>(),[page,setPage]=useState(1),[loading,setLoading]=useState(true);
  const [inspecting,setInspecting]=useState<Claim>(),[submitting,setSubmitting]=useState(false);
  const [error,setError]=useState(''),[notice,setNotice]=useState('');
  const [draft,setDraft]=useState<Draft>(),[formPage,setFormPage]=useState(0),[busy,setBusy]=useState(false),[formError,setFormError]=useState('');
  const [options,setOptions]=useState<Options>(),[search,setSearch]=useState(''),[optionPage,setOptionPage]=useState(1),[optionsLoading,setOptionsLoading]=useState(false);
  async function load(signal?:AbortSignal) {
    setLoading(true);
    try { const value=await body<State>(await authenticatedFetch(`/api/my-skills?page=${page}`,{signal}));if(!signal?.aborted){setState(value);setError('');} }
    catch(error){if(!signal?.aborted)setError(error instanceof Error?error.message:'Could not load your skills.');}
    finally {if(!signal?.aborted)setLoading(false);}
  }
  useEffect(()=>{const controller=new AbortController();void load(controller.signal);const refresh=()=>void load(controller.signal);window.addEventListener('own-skills-updated',refresh);return()=>{controller.abort();window.removeEventListener('own-skills-updated',refresh);};},[page]);
  useEffect(()=>{
    if(!reviewRequest||!state)return;
    if(!state.canClaim){setError('Your account does not have permission to add a skill draft.');return;}
    if(!reviewRequest.description.trim()||reviewRequest.description.length>2000){setError('The suggested experience text is invalid.');return;}
    setDraft({...emptyDraft(),description:reviewRequest.description});setFormPage(0);setFormError('');
  },[reviewRequest?.description,state?.canClaim]);
  useEffect(()=>{
    const suggested=location.state?.aiDraft?.description;
    if(reviewRequest)return;
    if(typeof suggested!=='string'||!state)return;
    navigate(location.pathname+location.search,{replace:true,state:null});
    if(!state.canClaim){setError('Your account does not have permission to add a skill draft.');return;}
    if(!suggested.trim()||suggested.length>2000){setError('The suggested experience text is invalid.');return;}
    setDraft({...emptyDraft(),description:suggested});setFormPage(0);setSearch('');setOptionPage(1);setFormError('');
    setNotice('AI suggestion loaded. Review the skill, proficiency, experience and description before saving.');
  },[location.key,state?.canClaim]);
  useEffect(()=>{
    if(!draft)return;
    const controller=new AbortController();setOptionsLoading(true);setOptions(undefined);
    const timer=setTimeout(()=>{authenticatedFetch(`/api/my-skills/catalogue?search=${encodeURIComponent(search)}&page=${optionPage}`,{signal:controller.signal})
      .then(body<Options>).then(value=>{if(!controller.signal.aborted)setOptions(value);})
      .catch(error=>{if(!controller.signal.aborted)setFormError(error.message);})
      .finally(()=>{if(!controller.signal.aborted)setOptionsLoading(false);});},200);
    return()=>{clearTimeout(timer);controller.abort();};
  },[draft?.id,search,optionPage]);
  const selected=options?.skills.find(item=>item.id===draft?.skillId);
  function edit(claim?:Claim) {
    setNotice('');setFormError('');setFormPage(0);setOptionPage(1);setSearch(claim?.skillName??'');
    setDraft(claim?{id:claim.id,revision:claim.revision,skillId:claim.skillId,definitionRevision:claim.definitionRevision,rank:claim.rank,experienceMonths:claim.experienceMonths,description:claim.description,projects:claim.projects??'',evidence:claim.evidence??''}:emptyDraft());
  }
  async function save() {
    if(!draft||busy)return;
    if(!selected||!selected.levels.some(level=>level.rank===draft.rank)){setFormPage(0);setFormError('Select a published skill and its proficiency level.');return;}
    if(!Number.isSafeInteger(draft.experienceMonths)||draft.experienceMonths<0||draft.experienceMonths>600){setFormPage(0);setFormError('Experience must be between 0 and 600 months.');return;}
    if((draft.projects?.length??0)>2000||(draft.evidence?.length??0)>2000){setFormPage(3);setFormError('Use up to 2,000 characters for projects and evidence.');return;}
    if(!draft.description.trim()||draft.description.trim().length>2000){setFormPage(2);setFormError('Describe your experience using up to 2,000 characters.');return;}
    setBusy(true);setFormError('');
    try {
      await body(await authenticatedFetch('/api/my-skills',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...draft,definitionRevision:selected.definitionRevision})}));
      setDraft(undefined);setNotice('Skill draft saved. It is self-assessed and has not been submitted for review.');reviewRequest?.onSaved();window.dispatchEvent(new Event('own-skills-updated'));await load();
    } catch(error){setFormError(error instanceof Error?error.message:'Your draft could not be saved.');}
    finally {setBusy(false);}
  }
  const actions=state?.canClaim&&<button className="admin-primary" disabled={busy||loading} onClick={()=>edit()}><Plus size={17}/>Add skill</button>;
  function closeDraft(){setDraft(undefined);reviewRequest?.onClose();}
  if(reviewRequest&&!draft)return <FormDialog title="Review skill draft" onClose={reviewRequest.onClose} pages={[{label:'Prepare',content:<p role={error?'alert':'status'}>{error||'Checking your current skill access…'}</p>}]} footer={<button type="button" className="secondary-button" onClick={reviewRequest.onClose}>Cancel</button>}/>;
  return <>
    {!reviewRequest&&<>
    {actionsContainer?createPortal(actions,actionsContainer):actions&&<div className="my-skills-actions">{actions}</div>}
    {error&&<div className="access-message" role="alert">{error}<button className="secondary-button" onClick={()=>void load()}>Retry</button></div>}
    {notice&&<p className="access-message" role="status">{notice}</p>}
    {loading&&!state?<section className="profile-panel" role="status">Loading your skills…</section>:state&&<section className="profile-panel my-skills-panel" aria-label="Your skill drafts">
      <div className="panel-title"><h2>My skills <span className="my-skills-count">{state.total}</span></h2><span className="claim-status">Skill claims</span></div>
      {!state.canClaim&&<p className="my-skills-note">You can view your saved skills. Ask your access administrator for permission to add or edit skill drafts.</p>}
      {state.claims.length?<>
        <div className="my-skills-table-wrap"><table className="my-skills-table"><thead><tr><th scope="col">Skill</th><th scope="col">Claimed proficiency</th><th scope="col">Experience</th><th scope="col">Status</th><th scope="col">Actions</th></tr></thead><tbody>{state.claims.map(claim=><tr key={claim.id}><td><strong>{claim.skillName}</strong><span>{claim.category}</span></td><td>{claim.levelName}<span>Level {claim.rank}</span></td><td>{claim.experienceMonths} months</td><td><span className="claim-status">Draft · Unverified</span></td><td><button className="secondary-button" onClick={()=>{setInspecting(claim);setSubmitting(false);}}>View</button>{state.canClaim&&['DRAFT','CHANGES_REQUESTED','REJECTED'].includes(claim.status)&&<button className="secondary-button" aria-label={`Edit ${claim.skillName} draft`} disabled={busy||loading} onClick={()=>edit(claim)}><Pencil size={15}/>Edit</button>}{state.canClaim&&claim.status!=='APPROVED'&&<button className="secondary-button" disabled={busy||loading} onClick={()=>{setInspecting(claim);setSubmitting(true);}}>{claim.status==='SUBMITTED'?'Reroute review':'Submit for review'}</button>}</td></tr>)}</tbody></table></div>
        <div className="catalogue-pagination"><span>{state.total} skills · Page {state.page}</span><button className="secondary-button" disabled={loading||page===1} onClick={()=>setPage(value=>value-1)}>Previous</button><button className="secondary-button" disabled={loading||page*state.pageSize>=state.total} onClick={()=>setPage(value=>value+1)}>Next</button></div>
      </>:<div className="catalogue-empty"><BookOpen size={30} aria-hidden="true"/><h3>{state.total?'No skills on this page':'Build your skill profile'}</h3><p>{state.total?'Go back to the previous page.':'Choose a published skill and describe your proficiency and experience.'}</p></div>}
    </section>}
    </>}
    {inspecting&&<SkillClaimDialog claim={inspecting} mode={submitting?'submit':'view'} onClose={()=>setInspecting(undefined)} onSaved={()=>{setInspecting(undefined);setNotice('Claim submitted to your assigned reporting manager.');window.dispatchEvent(new Event('own-skills-updated'));void load();}}/>}
    {draft&&<FormDialog title={reviewRequest?'Review skill draft':draft.revision?'Edit skill draft':'Add skill'} busy={busy} onClose={closeDraft} page={formPage} onPageChange={setFormPage} formId="skill-claim-form" onSubmit={()=>void save()} message={formError&&<p role="alert">{formError}</p>}
      pages={[
        {label:'Skill & proficiency',content:<>
          <label>Find a skill<span className="claim-search"><Search size={16} aria-hidden="true"/><input maxLength={100} value={search} onChange={event=>{setSearch(event.target.value);setOptionPage(1);setFormError('');}} placeholder="Search published skills…"/></span></label>
          <label>Skill<select value={draft.skillId} disabled={draft.revision>0||optionsLoading} onChange={event=>setDraft({...draft,skillId:event.target.value,rank:0})}><option value="">{optionsLoading?'Loading skills…':'Select a skill'}</option>{options?.skills.map(skill=><option value={skill.id} key={skill.id}>{skill.name} · {skill.category}</option>)}</select></label>
          {options&&!options.skills.length&&<p className="my-skills-note">No published skills match. Your catalogue administrator can publish skill definitions.</p>}
          {options&&options.total>25&&<div className="claim-option-pages"><span>Page {optionPage}</span><button type="button" className="secondary-button" disabled={optionPage===1||optionsLoading} onClick={()=>setOptionPage(value=>value-1)}>Previous</button><button type="button" className="secondary-button" disabled={optionPage*25>=options.total||optionsLoading} onClick={()=>setOptionPage(value=>value+1)}>Next</button></div>}
          <div className="claim-field-pair"><label>Proficiency<select disabled={!selected||optionsLoading} value={draft.rank} onChange={event=>setDraft({...draft,rank:Number(event.target.value)})}><option value={0}>Select a level</option>{selected?.levels.map(level=><option key={level.rank} value={level.rank}>{level.rank}. {level.name}</option>)}</select></label><label>Experience (months)<input type="number" min={0} max={600} step={1} value={Number.isNaN(draft.experienceMonths)?'':draft.experienceMonths} onChange={event=>setDraft({...draft,experienceMonths:event.target.value===''?NaN:Number(event.target.value)})}/></label></div>

        </>},
        {label:'Level criteria',content:<><h3>{selected?.levels.find(level=>level.rank===draft.rank)?.name??'Select a proficiency level'}</h3><p className="claim-level-description">{selected?.levels.find(level=>level.rank===draft.rank)?.description??'Choose a skill and level in the first step.'}</p></>},
        {label:'Experience',content:<><label>Describe your experience<textarea maxLength={2000} rows={5} value={draft.description} onChange={event=>setDraft({...draft,description:event.target.value})} placeholder="What have you worked on, and how have you used this skill?"/></label><p className="my-skills-note">Your proficiency remains unverified until your reporting manager approves the submission.</p></>},
        {label:'Projects & evidence',content:<><label>Projects<textarea rows={4} maxLength={2000} value={draft.projects??''} onChange={event=>setDraft({...draft,projects:event.target.value})} placeholder="Project names, your contribution and outcomes"/></label><label>Evidence references<textarea rows={4} maxLength={2000} value={draft.evidence??''} onChange={event=>setDraft({...draft,evidence:event.target.value})} placeholder="Links to approved project evidence or certificates, with a short explanation"/></label><p className="my-skills-note">Use references accessible to your reviewer. Do not paste passwords or confidential customer data.</p></>},
      ]}
      footer={<><button type="button" className="secondary-button" disabled={busy} onClick={closeDraft}>Cancel</button>{formPage<3?<button type="button" className="admin-primary" disabled={optionsLoading||!selected||!selected.levels.some(level=>level.rank===draft.rank)} onClick={()=>setFormPage(value=>value+1)}>Continue</button>:<button type="submit" form="skill-claim-form" className="admin-primary" disabled={busy||optionsLoading}>{busy?'Saving…':'Save draft'}</button>}</>}/>
    }
  </>;
}
