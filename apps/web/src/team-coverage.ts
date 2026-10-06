import type {TeamReportAnalytics} from './team-reports';

export type CoverageIndex=Map<string,Map<number,TeamReportAnalytics['coverage'][number]>>;
export function indexCoverage(analytics:TeamReportAnalytics):CoverageIndex{
 const index:CoverageIndex=new Map();
 for(const row of analytics.coverage){
  let ranks=index.get(row.skillName);
  if(!ranks){ranks=new Map();index.set(row.skillName,ranks);}
  ranks.set(row.rank,row);
 }
 return index;
}
