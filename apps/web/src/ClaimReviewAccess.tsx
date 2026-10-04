export interface ClaimReviewDecision {
 allowed:boolean;reasonCode:string;summaryOnly:false;
 resource:{type:'SKILL_CLAIM';id:string;revision:number};
 resolvedScope:{kind:string;actorId:string};constraints:string[];
 sources:{kind:string;label:string;effect:string;scope:string;validUntil?:string}[];
}
const reasons:Record<string,string>={
 REPORTING_POLICY:'You are the current direct manager and assigned reviewer. This claim is awaiting your decision.',
 NOT_AWAITING_REVIEW:'This claim is no longer awaiting a decision. Its review history remains available.',
 EXPLICIT_DENY:'An applicable access restriction blocks this decision.',
 NOT_CURRENT_DIRECT_MANAGER:'You are no longer this employee’s current direct manager.',
 NOT_ASSIGNED_REVIEWER:'This claim is assigned to another reviewer. It must be rerouted through the submission workflow.',
 SELF_APPROVAL:'You cannot review your own claim.',
};
export function ClaimReviewAccess({decision}:{decision?:ClaimReviewDecision}){
 return <section className="review-scope-note" aria-label="Current claim access"><h3>{decision?.allowed?'You can review this claim':'Decision unavailable'}</h3><p>{decision?reasons[decision.reasonCode]??'Current access checks do not permit a decision. Refresh your workspace to check again.':'Current claim access could not be resolved. Reopen this claim before making a decision.'}</p>{decision&&<details><summary>Why this access?</summary><p>Scope: current direct reports · Claim revision {decision.resource.revision}</p><ul>{decision.sources.map((source,index)=><li key={index}>{source.label} · {source.effect=== 'DENY'?'Restriction':'Access source'}{source.validUntil&&<> · Expires {new Date(source.validUntil).toLocaleString()}</>}</li>)}</ul><p>A decision rechecks your permissions, current reporting relationship, reviewer assignment and claim revision when saved.</p></details>}</section>;
}
