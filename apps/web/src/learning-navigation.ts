const learningTabs:Record<string,string>={home:'My learning',paths:'Learning paths',goals:'Goals',journey:'Growth journey',recommendations:'Recommendations',today:'Today',calendar:'Calendar',backlog:'Backlog'};
export function learningView(params:URLSearchParams){return learningTabs[params.get('tab')??'home']??'My learning';}
export function learningTabSearch(params:URLSearchParams,name:string){
 const next=new URLSearchParams(params);
 for(const key of ['recommendation','direction','openPlan','plan','task','action'])next.delete(key);
 const tab=Object.keys(learningTabs).find(key=>learningTabs[key]===name)??'home';
 if(tab==='home')next.delete('tab');else next.set('tab',tab);
 return next;
}
export function recommendationQuery(view:'received'|'sent',page:number,focused:string){
 const query=new URLSearchParams({view,page:String(focused?1:page)});
 if(focused)query.set('id',focused);
 return query;
}
