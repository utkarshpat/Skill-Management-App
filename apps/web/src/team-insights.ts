import type {TeamReportAnalytics} from './team-reports';
import {indexCoverage,type CoverageIndex} from './team-coverage';

export const LEVELS=[1,2,3,4,5] as const;
export interface SkillProfile {skill:string;holders:number;percent:number;average:number;atLevel:number[]}

function holders(index:CoverageIndex,skill:string,rank:number){
 return index.get(skill)?.get(rank)?.memberIds??[];
}

// Coverage rows are cumulative thresholds (people at or above a level); exact counts are their differences.
export function skillProfiles(analytics:TeamReportAnalytics,index=indexCoverage(analytics)):SkillProfile[]{
 return [...index.keys()].map(skill=>{
  const counts=LEVELS.map(rank=>holders(index,skill,rank).length),total=counts[0];
  return {skill,holders:total,percent:analytics.members?Math.round(total/analytics.members*100):0,
   average:total?Math.round(counts.reduce((sum,n)=>sum+n,0)/total*10)/10:0,
   atLevel:counts.map((count,index)=>count-(counts[index+1]??0))};
 }).sort((a,b)=>b.holders-a.holders||b.average-a.average||a.skill.localeCompare(b.skill));
}

export function memberLevel(analytics:TeamReportAnalytics,skill:string,memberId:string,index=indexCoverage(analytics)){
 let level=0;
 for(const rank of LEVELS)if(holders(index,skill,rank).includes(memberId))level=rank;
 return level;
}

export function membersWithoutReviewedSkills(analytics:TeamReportAnalytics){
 const covered=new Set(analytics.coverage.filter(row=>row.rank===1).flatMap(row=>row.memberIds));
 return Math.max(0,analytics.members-covered.size);
}

export function teamAverageLevel(analytics:TeamReportAnalytics){
 const total=analytics.levels.reduce((sum,l)=>sum+l.count,0);
 return total?Math.round(analytics.levels.reduce((sum,l)=>sum+Math.min(5,l.rank)*l.count,0)/total*10)/10:0;
}

export function demandPrompt(demand:string){
 const text=demand.trim().replace(/\s+/g,' ').slice(0,400);
 return text
  ?`Use team_skill_gaps with these requirements from me (demand, not saved): ${text}. For each requirement show who qualifies, the shortfall, and who is one level below and could be developed. Separate missing records from proven gaps.`
  :'Use team_skill_gaps to summarise my direct reports’ skill strengths, level mix and thinnest coverage. Then ask which skill demand (skill, minimum level, headcount) I want compared.';
}
