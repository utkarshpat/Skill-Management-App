import type {TeamReportAnalytics} from './team-reports';

export const LEVELS=[1,2,3,4,5] as const;
export interface SkillProfile {skill:string;holders:number;percent:number;average:number;atLevel:number[]}

function holders(analytics:TeamReportAnalytics,skill:string,rank:number){
 return analytics.coverage.find(row=>row.skillName===skill&&row.rank===rank)?.memberIds??[];
}

// Coverage rows are cumulative thresholds (people at or above a level); exact counts are their differences.
export function skillProfiles(analytics:TeamReportAnalytics):SkillProfile[]{
 return [...new Set(analytics.coverage.map(row=>row.skillName))].map(skill=>{
  const counts=LEVELS.map(rank=>holders(analytics,skill,rank).length),total=counts[0];
  return {skill,holders:total,percent:analytics.members?Math.round(total/analytics.members*100):0,
   average:total?Math.round(counts.reduce((sum,n)=>sum+n,0)/total*10)/10:0,
   atLevel:counts.map((count,index)=>count-(counts[index+1]??0))};
 }).sort((a,b)=>b.holders-a.holders||b.average-a.average||a.skill.localeCompare(b.skill));
}

export function memberLevel(analytics:TeamReportAnalytics,skill:string,memberId:string){
 let level=0;
 for(const rank of LEVELS)if(holders(analytics,skill,rank).includes(memberId))level=rank;
 return level;
}

export function membersWithoutReviewedSkills(analytics:TeamReportAnalytics){
 const covered=new Set(analytics.coverage.filter(row=>row.rank===1).flatMap(row=>row.memberIds));
 return Math.max(0,analytics.members-covered.size);
}

export function teamAverageLevel(analytics:TeamReportAnalytics){
 const total=analytics.levels.reduce((sum,l)=>sum+l.count,0);
 return total?Math.round(analytics.levels.reduce((sum,l)=>sum+l.rank*l.count,0)/total*10)/10:0;
}

export function demandPrompt(demand:string){
 const text=demand.trim().replace(/\s+/g,' ').slice(0,400);
 return text
  ?`Use team_skill_gaps with these requirements from me (demand, not saved): ${text}. For each requirement show who qualifies, the shortfall, and who is one level below and could be developed. Separate missing records from proven gaps.`
  :'Use team_skill_gaps to summarise my direct reports’ skill strengths, level mix and thinnest coverage. Then ask which skill demand (skill, minimum level, headcount) I want compared.';
}
