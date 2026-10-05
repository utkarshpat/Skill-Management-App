import {useState} from 'react';
import {CheckCircle2,MessageSquareMore,XCircle,Clock3,BriefcaseBusiness,ShieldCheck} from 'lucide-react';
import {authenticatedFetch} from './auth';
import {FormDialog} from './FormDialog';
import type {Claim} from './MySkills';
import {ReviewHistory} from './ReviewHistory';
import {ReviewAssistance} from './ReviewAssistance';
import {ClaimReviewAccess} from './ClaimReviewAccess';
import {ClaimEvidence} from './ClaimEvidence';
import {formatSkillDate} from './skill-dates';
import './claim-review.css';
export function SkillClaimDialog({claim,mode,onClose,onSaved,history=false}:{history?:boolean;claim:Claim;mode:'view'|'submit'|'review';onClose:()=>void;onSaved:()=>void}){
 const [feedback,setFeedback]=useState(''),[decision,setDecision]=useState('REQUEST_CHANGES'),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const [revision,setRevision]=useState(claim.revision);
 const [uploading,setUploading]=useState(false);
 const working=busy||uploading;
 const close=()=>{if(working)return;return revision!==claim.revision?onSaved():onClose();};
 const allowed=Boolean(claim.reviewAccess?.allowed),review=mode==='review';
 async function apply(){if(working||(review&&!allowed))return;setBusy(true);setError('');try{const r=await authenticatedFetch(mode==='submit'?'/api/my-skills/submit':'/api/skill-reviews/decision',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:claim.id,revision,action:mode==='submit'?'SUBMIT':decision,feedback})});const data=await r.json().catch(()=>undefined);if(!r.ok)throw Error(data?.error?.message??'Could not save. Refresh and try again.');onSaved();}catch(reason){setError(reason instanceof Error?reason.message:'Could not save the review.');}finally{setBusy(false);}}
 return <FormDialog title={review?'Review skill claim':mode==='submit'?'Submit for review':claim.skillName} subtitle={claim.personName?`${claim.personName} · ${claim.skillName}`:claim.category} className="claim-review-dialog" busy={working} onClose={close} message={error&&<p role="alert">{error}</p>} footer={<><span className="claim-save-note"><ShieldCheck size={15}/>Current access is checked on save</span><button className="secondary-button" disabled={working} onClick={close}>{mode==='view'?'Close':'Cancel'}</button>{mode!=='view'&&<button className="admin-primary" disabled={working||(review&&(!feedback.trim()||!allowed))} onClick={()=>void apply()}>{busy?'Saving…':mode==='submit'?'Submit for review':decision==='APPROVE'?'Confirm verification':decision==='REJECT'?'Confirm rejection':'Send change request'}</button>}</>}>
  <div className={'claim-review-layout'+(review?'':' read-only')}><section className="claim-review-content">
   <div className="claim-review-facts"><div><strong>L{claim.rank}</strong><span>{claim.levelName}</span></div><div><BriefcaseBusiness size={20}/><strong>{claim.experienceMonths} months</strong><span>Experience</span></div><div><Clock3 size={20}/><strong>{formatSkillDate(claim.lastUsedOn)}</strong><span>Last used</span></div></div>
   <section className="claim-content-block"><h3>Experience & projects</h3><p>{claim.description||'No experience description provided.'}</p>{claim.projects&&<><h4>Projects</h4><p>{claim.projects}</p></>}</section>
   <section className="claim-content-block"><h3>Evidence</h3><ClaimEvidence claim={claim} reviewer={review||history} onRevision={setRevision} onBusy={setUploading}/></section>
   {claim.levelDescription&&<details className="claim-detail"><summary>Level criteria · L{claim.rank}</summary><p>{claim.levelDescription}</p></details>}
   {history&&<details className="claim-detail"><summary>Review history</summary><ReviewHistory id={claim.id}/></details>}
   {claim.feedback&&<section className="claim-content-block"><h3>Manager feedback</h3><p>{claim.feedback}</p></section>}
  </section>{review?<aside className="claim-decision-panel"><h3>Your decision</h3>{history&&<ClaimReviewAccess decision={claim.reviewAccess}/>}<div className="claim-decision-choices">{[{value:'APPROVE',label:'Verify',hint:'Confirm the claimed level',icon:CheckCircle2},{value:'REQUEST_CHANGES',label:'Request changes',hint:'Ask for more detail or evidence',icon:MessageSquareMore},{value:'REJECT',label:'Reject',hint:'Record why it is not supported',icon:XCircle}].map(item=><button type="button" className={item.value.toLowerCase()} key={item.value} aria-pressed={decision===item.value} disabled={working||!allowed} onClick={()=>setDecision(item.value)}><item.icon size={20}/><span><strong>{item.label}</strong><small>{item.hint}</small></span></button>)}</div><label className="claim-feedback">Feedback <span>Required</span><textarea aria-label="Review feedback" rows={4} maxLength={2000} disabled={working||!allowed} value={feedback} onChange={e=>setFeedback(e.target.value)} placeholder="What supports your decision, or what should change?"/></label>{history&&<details className="claim-detail claim-ai-help"><summary>Help draft feedback with AI</summary><ReviewAssistance claim={claim} canDraft={allowed} decision={decision} onDecision={setDecision} onUse={setFeedback} hasFeedback={Boolean(feedback.trim())}/></details>}<p className="claim-decision-note">Verification records reviewed proficiency. Learning completion stays separate.</p></aside>:<section className="claim-content-block"><h3>{mode==='submit'?'Ready for manager review':'Review status'}</h3><strong>{claim.status.replaceAll('_',' ')}</strong>{mode==='submit'&&<p>Your current reporting manager receives this claim. Submitted claims remain locked until changes are requested or rejected.</p>}</section>}</div>
 </FormDialog>;
}
