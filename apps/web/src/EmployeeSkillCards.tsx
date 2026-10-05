import {ArrowRight,Clock3,FileCheck2,Layers3,RefreshCw} from 'lucide-react';
import type {Claim} from './MySkills';
import type {TeamSkill} from './team-analytics';
import {assignedSkillClaim} from './employee-capability';

export function EmployeeSkillCards({skills,assigned,personId,canRead,loading,opening,onOpen}:{skills:TeamSkill[];assigned:Claim[];personId:string;canRead:boolean;loading:boolean;opening:boolean;onOpen:(id:string)=>void}){
 return <div className="employee-skill-card-grid">{skills.filter(skill=>skill.personId===personId).map((skill,index)=>{
  const record=assignedSkillClaim(skill,assigned,personId),pending=skill.status==='SUBMITTED';
  return <article className={'employee-skill-card '+(pending?'pending':'reviewed')} key={`${skill.skillName}-${index}`}>
   <header><span className="employee-skill-symbol"><Layers3 size={23}/></span><span className={'employee-card-status '+(pending?'pending':'reviewed')}>{pending?<Clock3 size={14}/>:<FileCheck2 size={14}/>} {pending?'Awaiting review':'Manager reviewed'}</span></header>
   <h3>{skill.skillName}</h3><p className="employee-card-category">{skill.category}</p>
   <div className="employee-card-level"><strong>L{skill.rank}</strong><div><span>{skill.levelName}</span><small>{pending?'Employee’s claimed level':'Recorded reviewed level'}</small></div></div>
   <div className="employee-card-record">{record?<><Clock3 size={14}/><span>Updated {new Date(record.updatedAt).toLocaleDateString()}</span></>:<span>{loading?'Loading assigned records…':'Capability summary'}</span>}</div>
   <footer>{record&&canRead?<button className={pending?'admin-primary':'secondary-button'} disabled={opening} onClick={()=>onOpen(record.id)}>{opening?<RefreshCw className="review-spin" size={16}/>:null}{pending?'Open review':'Evidence & history'}<ArrowRight size={16}/></button>:<p>{loading?'Checking available details…':'No assigned record available to open.'}</p>}</footer>
  </article>;
 })}</div>;
}
