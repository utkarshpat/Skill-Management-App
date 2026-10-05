import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Plus } from 'lucide-react';
import { authenticatedFetch } from './auth';
import {readApiResponse} from './api-response';
import { SkillClaimDialog } from './SkillClaimDialog';
import { FormDialog } from './FormDialog';
import {SkillsProfileView} from './SkillsProfileView';
import './skills-profile.css';
import {SkillClaimWizard,type SkillChoice,type SkillDraft,type SkillChoices} from './SkillClaimWizard';
import { useLocation, useNavigate } from 'react-router';
import type {ClaimReviewDecision} from './ClaimReviewAccess';
import {skillDateError} from './skill-dates';
import {toast} from './Toast';

export interface Claim {
  personId?:string;
  reviewAccess?:ClaimReviewDecision;
  id:string; revision:number; skillId:string; skillName:string; category:string;
  definitionRevision:number; rank:number; levelName:string; experienceMonths:number; lastUsedOn?:string|null;
  description:string; status:'DRAFT'|'SUBMITTED'|'CHANGES_REQUESTED'|'APPROVED'|'REJECTED'; updatedAt:string; projects?:string; evidence?:string; feedback?:string; personName?:string; levelDescription?:string;
}
type Option=SkillChoice;
interface State { claims:Claim[]; total:number; page:number; pageSize:number; canClaim:boolean }
type Options=SkillChoices;
type Draft=SkillDraft;
const emptyDraft=():Draft=>({id:crypto.randomUUID(),revision:0,skillId:'',definitionRevision:0,rank:0,experienceMonths:0,description:''});
async function body<T>(response:Response):Promise<T> {
  return readApiResponse<T>(response,response.status===403?'Your account does not have access to this skill action.':response.status===401?'Sign in to view your skills.':'Could not load your skills. Please try again.');
}
export function MySkills({actionsContainer,reviewRequest}:{actionsContainer?:HTMLElement|null;reviewRequest?:{description:string;onClose:()=>void;onSaved:()=>void}}) {
  const location=useLocation(),navigate=useNavigate();
  const [state,setState]=useState<State>(),[loading,setLoading]=useState(true);
  const [inspecting,setInspecting]=useState<Claim>(),[submitting,setSubmitting]=useState(false);
  const [error,setError]=useState('');
  const [draft,setDraft]=useState<Draft>(),[formPage,setFormPage]=useState(0),[busy,setBusy]=useState(false),[formError,setFormError]=useState('');
  const [options,setOptions]=useState<Options>(),[search,setSearch]=useState(''),[category,setCategory]=useState(''),[picked,setPicked]=useState<Option>(),[optionPage,setOptionPage]=useState(1),[optionsLoading,setOptionsLoading]=useState(false);
  const [suggestedSkillName,setSuggestedSkillName]=useState('');
  async function load(signal?:AbortSignal) {
    setLoading(true);
    try { const value=await body<State>(await authenticatedFetch('/api/my-skills?page=1',{signal}));
      const claims=[...value.claims];
      // Read every authorized page so summary counts and filters cover the whole profile.
      for(let next=2;next<=Math.ceil(value.total/value.pageSize);next+=4){
        const pages=await Promise.all(Array.from({length:Math.min(4,Math.ceil(value.total/value.pageSize)-next+1)},(_,index)=>authenticatedFetch('/api/my-skills?page='+(next+index),{signal}).then(body<State>)));
        for(const result of pages)claims.push(...result.claims);
      }
      if(!signal?.aborted){setState({...value,claims:Array.from(new Map(claims.map(claim=>[claim.id,claim])).values())});setError('');} }
    catch(error){if(!signal?.aborted){if(error&&typeof error==='object'&&'status'in error&&[401,403].includes(Number(error.status)))setState(undefined);setError(error instanceof Error?error.message:'Could not load your skills.');}}
    finally {if(!signal?.aborted)setLoading(false);}
  }
  useEffect(()=>{const controller=new AbortController();void load(controller.signal);const refresh=()=>void load(controller.signal);window.addEventListener('own-skills-updated',refresh);return()=>{controller.abort();window.removeEventListener('own-skills-updated',refresh);};},[]);
  useEffect(()=>{
    if(!reviewRequest||!state)return;
    if(!state.canClaim){setError('Your account does not have permission to add a skill draft.');return;}
    if(!reviewRequest.description.trim()||reviewRequest.description.length>2000){setError('The suggested experience text is invalid.');return;}
    setPicked(undefined);setCategory('');setSearch('');setOptionPage(1);setDraft({...emptyDraft(),description:reviewRequest.description});setFormPage(0);setFormError('');
  },[reviewRequest?.description,state?.canClaim]);
  useEffect(()=>{
    const suggested=location.state?.aiDraft?.description;
    if(reviewRequest)return;
    if(typeof suggested!=='string'||!state)return;
    navigate(location.pathname+location.search,{replace:true,state:null});
    if(!state.canClaim){setError('Your account does not have permission to add a skill draft.');return;}
    if(!suggested.trim()||suggested.length>2000){setError('The suggested experience text is invalid.');return;}
    setPicked(undefined);setCategory('');setDraft({...emptyDraft(),description:suggested});setFormPage(0);setSearch('');setOptionPage(1);setFormError('');
    toast.info('AI suggestion loaded. Review the skill, proficiency, experience and description before saving.');
  },[location.key,state?.canClaim]);
  useEffect(()=>{
    if(!draft)return;
    const controller=new AbortController();setOptionsLoading(true);
    const timer=setTimeout(()=>{authenticatedFetch(`/api/my-skills/catalogue?search=${encodeURIComponent(search)}&page=${optionPage}&category=${encodeURIComponent(category)}&pageSize=3`,{signal:controller.signal})
      .then(body<Options>).then(value=>{if(!controller.signal.aborted)setOptions(value);})
      .catch(error=>{if(!controller.signal.aborted){setOptions(undefined);setFormError(error.message);}})
      .finally(()=>{if(!controller.signal.aborted)setOptionsLoading(false);});},200);
    return()=>{clearTimeout(timer);controller.abort();};
  },[draft?.id,search,optionPage,category]);
  const selected=options?.skills.find(item=>item.id===draft?.skillId)??picked;
  useEffect(()=>{const current=options?.skills.find(item=>item.id===draft?.skillId);if(current)setPicked(current);},[options,draft?.skillId]);
  useEffect(()=>{
    if(!options||!suggestedSkillName||draft?.skillId)return;
    const matches=options.skills.filter(skill=>skill.name.localeCompare(suggestedSkillName,undefined,{sensitivity:'accent'})===0);
    setSuggestedSkillName('');
    if(matches.length===1){const [match]=matches;setPicked(match);setDraft(current=>current&&!current.skillId?{...current,skillId:match.id,definitionRevision:match.definitionRevision}:current);}
  },[options,suggestedSkillName,draft?.skillId]);
  function edit(claim?:Claim) {
    setPicked(undefined);setSuggestedSkillName('');setCategory('');setFormError('');setFormPage(0);setOptionPage(1);setSearch(claim?.skillName??'');
    setDraft(claim?{id:claim.id,revision:claim.revision,skillId:claim.skillId,definitionRevision:claim.definitionRevision,rank:claim.rank,experienceMonths:claim.experienceMonths,lastUsedOn:claim.lastUsedOn??null,description:claim.description,projects:claim.projects??'',evidence:claim.evidence??''}:emptyDraft());
  }
  useEffect(()=>{const params=new URLSearchParams(location.search);if(!state||params.get('action')!=='add')return;const suggested=params.get('skill')??'';params.delete('action');params.delete('skill');navigate(location.pathname+(params.size?'?'+params:''),{replace:true});  if(state.canClaim){edit();if(suggested){setSearch(suggested.slice(0,100));setSuggestedSkillName(suggested);}}else setError('Skill editing is not assigned.');},[location.search,state?.canClaim]);
  useEffect(()=>{
    const params=new URLSearchParams(location.search),editId=params.get('editClaim'),submitId=params.get('submitClaim'),id=editId??submitId??params.get('claim');if(!id||!state||loading)return;
    params.delete('claim');params.delete('editClaim');params.delete('submitClaim');navigate(location.pathname+(params.size?'?'+params:''),{replace:true});
    const claim=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)?state.claims.find(c=>c.id.toLowerCase()===id.toLowerCase()):undefined;
    if(!claim){setError('This claim is unavailable in your current skill profile.');return;}
    if(editId&&state.canClaim&&['DRAFT','CHANGES_REQUESTED','REJECTED'].includes(claim.status)){edit(claim);return;}
    if(submitId&&state.canClaim&&claim.status==='DRAFT'){setInspecting(claim);setSubmitting(true);return;}
    if((editId||submitId)&&!state.canClaim)setError('Your account does not have permission to edit or submit this claim.');
    setInspecting(claim);setSubmitting(false);
  },[location.search,state,loading]);
  async function save(submit=false) {
    if(!draft||busy)return;
    if(!selected||!selected.levels.some(level=>level.rank===draft.rank)){setFormPage(0);setFormError('Select a published skill and its proficiency level.');return;}
    if(!Number.isSafeInteger(draft.experienceMonths)||draft.experienceMonths<0||draft.experienceMonths>600){setFormPage(0);setFormError('Experience must be between 0 and 600 months.');return;}
    const dateError=skillDateError(draft.lastUsedOn);
    if(dateError){setFormPage(1);setFormError(dateError);return;}
    if((draft.projects?.length??0)>2000||(draft.evidence?.length??0)>2000){setFormPage(1);setFormError('Use up to 2,000 characters for projects and evidence.');return;}
    if(!draft.description.trim()||draft.description.trim().length>2000){setFormPage(1);setFormError('Describe your experience using up to 2,000 characters.');return;}
    setBusy(true);setFormError('');
    try {
      await body(await authenticatedFetch('/api/my-skills',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...draft,lastUsedOn:draft.lastUsedOn||null,definitionRevision:selected.definitionRevision})}));
      let message='Skill draft saved. It is self-assessed and has not been submitted for review.';
      if(submit){
        // Saving always advances the claim revision by one; the server rechecks reviewer routing on submit.
        try{await body(await authenticatedFetch('/api/my-skills/submit',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:draft.id,revision:draft.revision+1,action:'SUBMIT',feedback:''})}));message='Skill submitted to your assigned reporting manager for review.';window.dispatchEvent(new Event('notifications-updated'));}
        catch(error){message='Skill draft saved, but it could not be submitted: '+(error instanceof Error?error.message:'try again from My skills.');}
      }
      setDraft(undefined);toast.success(message);reviewRequest?.onSaved();window.dispatchEvent(new Event('own-skills-updated'));
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
    {loading&&!state?<section className="profile-panel" role="status">Loading your skills…</section>:state&&<SkillsProfileView initialStatus={new URLSearchParams(location.search).get("status")??""} onAdd={()=>edit()} claims={state.claims} canClaim={state.canClaim} loading={loading||busy} onView={claim=>{setInspecting(claim);setSubmitting(false);}} onEdit={edit} onSubmit={claim=>{setInspecting(claim);setSubmitting(true);}}/>}
    </>}
    {inspecting&&<SkillClaimDialog claim={inspecting} mode={submitting?'submit':'view'} onClose={()=>setInspecting(undefined)} onSaved={()=>{setInspecting(undefined);toast.success('Claim submitted to your assigned reporting manager.');window.dispatchEvent(new Event('own-skills-updated'));}}/>}
    {draft&&<SkillClaimWizard draft={draft} onDraft={setDraft} selected={selected} onSelect={skill=>{setPicked(skill);const switching=Boolean(draft.skillId)&&skill.id!==draft.skillId;setDraft({...draft,skillId:skill.id,definitionRevision:skill.definitionRevision,...(switching?{rank:0,experienceMonths:0,lastUsedOn:null,description:'',projects:undefined,evidence:undefined}:{})});}} options={options} loading={optionsLoading} busy={busy} error={formError} page={formPage} onPage={setFormPage} search={search} onSearch={value=>{setSearch(value);setOptionPage(1);setFormError('');}} category={category} onCategory={value=>{setCategory(value);setOptionPage(1);setFormError('');}} onResultsPage={setOptionPage} onSave={submit=>void save(submit)} onClose={closeDraft} aiDraft={!!reviewRequest}/>}
  </>;
}
