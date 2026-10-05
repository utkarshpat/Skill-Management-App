import { AccessError } from '../../shared/errors.js';
import type { TeamCapability } from './claims.js';

type Analytics = NonNullable<TeamCapability['analytics']>;
export interface SkillRequirement { skill:string; level:number; headcount:number }
const levels=[1,2,3,4,5] as const;
const normalize=(value:string)=>value.toLowerCase().replace(/[^\p{L}\p{N}+#.]+/gu,' ').trim();

// Requirements ("demand") are supplied by the manager in the conversation and never stored.
export function teamGapArguments(value:unknown):{search:string;requirements:SkillRequirement[]}{
  if(!value||typeof value!=='object'||Array.isArray(value))throw new AccessError(400,'Enter valid team gap arguments.');
  const args=value as Record<string,unknown>;
  if(Object.keys(args).some(key=>!['search','requirements'].includes(key)))throw new AccessError(400,'Team gap analysis cannot choose another person, manager or workspace.');
  if(args.search!==undefined&&(typeof args.search!=='string'||args.search.length>100))throw new AccessError(400,'Choose a valid team search.');
  if(args.requirements!==undefined&&(!Array.isArray(args.requirements)||args.requirements.length>10))throw new AccessError(400,'Provide up to 10 skill requirements.');
  const requirements=((args.requirements as unknown[]|undefined)??[]).map(item=>{
    if(!item||typeof item!=='object'||Array.isArray(item))throw new AccessError(400,'Each requirement needs a skill and level.');
    const r=item as Record<string,unknown>;
    if(Object.keys(r).some(key=>!['skill','level','headcount'].includes(key))||typeof r.skill!=='string'||!normalize(r.skill)||!/[\p{L}\p{N}]/u.test(r.skill)||r.skill.length>80||!Number.isSafeInteger(r.level)||Number(r.level)<1||Number(r.level)>5||(r.headcount!==undefined&&(!Number.isSafeInteger(r.headcount)||Number(r.headcount)<1||Number(r.headcount)>500)))throw new AccessError(400,'Each requirement needs a skill name, level 1-5 and an optional headcount of 1-500.');
    return {skill:r.skill.trim().replace(/\s+/g,' '),level:Number(r.level),headcount:r.headcount===undefined?1:Number(r.headcount)};
  });
  return {search:typeof args.search==='string'?args.search.trim().replace(/\s+/g,' '):'',requirements};
}

function holders(analytics:Analytics,skillName:string,rank:number){
  return analytics.coverage.find(row=>row.skillName===skillName&&row.rank===rank)?.memberIds??[];
}

export function skillProfiles(analytics:Analytics){
  return [...new Set(analytics.coverage.map(row=>row.skillName))].map(skillName=>{
    const counts=levels.map(rank=>holders(analytics,skillName,rank).length);
    const total=counts[0];
    return {skill:skillName,holders:total,coveragePercent:analytics.members?Math.round(total/analytics.members*100):0,
      averageLevel:total?Math.round(counts.reduce((sum,count)=>sum+count,0)/total*10)/10:0,
      atLevel:levels.map((rank,index)=>({level:'L'+rank+(rank===5?'+':''),people:counts[index]-(counts[index+1]??0)}))};
  }).sort((a,b)=>b.holders-a.holders||b.averageLevel-a.averageLevel||a.skill.localeCompare(b.skill));
}

export function requirementGaps(analytics:Analytics,requirements:SkillRequirement[],name:(id:string)=>string){
  const skills=[...new Set(analytics.coverage.map(row=>row.skillName))];
  const names=(ids:string[])=>({count:ids.length,people:ids.slice(0,8).map(name),morePeople:Math.max(0,ids.length-8)});
  return requirements.map(requirement=>{
    const wanted=normalize(requirement.skill);
    const exact=skills.filter(skill=>normalize(skill)===wanted);
    const candidates=exact.length?exact:skills.filter(skill=>{const value=normalize(skill);return value.includes(wanted)||wanted.includes(value);});
    const base={requested:requirement.skill,minimumLevel:'L'+requirement.level,headcount:requirement.headcount};
    if(!candidates.length)return {...base,status:'NO_REVIEWED_RECORD',qualified:0,shortfall:requirement.headcount,note:'No current direct report has a manager-reviewed claim for a matching skill name. This is missing evidence, not proof nobody has the skill.'};
    if(!exact.length||candidates.length>1)return {...base,status:'AMBIGUOUS',candidates:candidates.slice(0,6),note:'Confirm the intended published skill before evaluating qualification; a similar name is not equivalent proficiency.'};
    const skill=candidates[0],qualified=holders(analytics,skill,requirement.level);
    const below=requirement.level>1?holders(analytics,skill,requirement.level-1).filter(id=>!qualified.includes(id)):[];
    return {...base,status:qualified.length>=requirement.headcount?'MET':'SHORTFALL',matchedSkill:skill,qualified:names(qualified),shortfall:Math.max(0,requirement.headcount-qualified.length),oneLevelBelow:names(below)};
  });
}

export function teamGapReport(analytics:Analytics,requirements:SkillRequirement[],name:(id:string)=>string){
  const profiles=skillProfiles(analytics);
  const covered=new Set(analytics.coverage.filter(row=>row.rank===1).flatMap(row=>row.memberIds));
  return {
    members:analytics.members,managerReviewedClaims:analytics.reviewed,assignedPendingReviews:analytics.pending,
    membersWithoutReviewedSkills:Math.max(0,analytics.members-covered.size),
    requirements:requirementGaps(analytics,requirements,name),
    teamSkills:profiles.slice(0,15),totalReviewedSkills:profiles.length,
    thinnestCoverage:[...profiles].sort((a,b)=>a.holders-b.holders||a.averageLevel-b.averageLevel).slice(0,5).map(({skill,holders,averageLevel})=>({skill,holders,averageLevel})),
    categories:analytics.categories.slice(0,8),
    basis:'Scope: current active direct reports only. Coverage counts manager-reviewed (APPROVED) claims; pending reviews and private drafts are not proficiency. Requirements come only from this conversation and are not saved. Missing records are not proven deficiencies. Levels above 5 are grouped as L5+.',
  };
}
