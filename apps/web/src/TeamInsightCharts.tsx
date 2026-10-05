import {useId,useState} from 'react';
import {Bot,Send} from 'lucide-react';
import type {TeamReportAnalytics} from './team-reports';
import type {TeamPerson} from './team-analytics';
import {LEVELS,demandPrompt,memberLevel,membersWithoutReviewedSkills,skillProfiles,teamAverageLevel} from './team-insights';

const LEVEL_COLORS=['#9cc9cf','#5fb0ba','#008595','#0b5f6b','#123c44'];
const CATEGORY_COLORS=['#008595','#357ac2','#b87b11','#7b5ea7','#3f8a4f','#c4573a','#5d6b78','#a0466b'];
const EXAMPLES=['2 people at L3+ in Azure','React L4, 1 person','Who could grow into SQL L3?'];

export function askAssistant(prompt:string){window.dispatchEvent(new CustomEvent('assistant-context-request',{detail:{prompt}}));}

function AskAi(){
 const [demand,setDemand]=useState(''),id=useId();
 return <section className="team-chart team-ask-ai" aria-labelledby={id}>
  <header><div><h3 id={id}><Bot size={19}/>Ask AI about gaps and demand</h3><p>Describe what work needs: skills, minimum level and headcount. The assistant compares it with your direct reports’ reviewed records. Nothing is saved.</p></div></header>
  <form onSubmit={e=>{e.preventDefault();askAssistant(demandPrompt(demand));}}>
   <textarea aria-label="Skill demand for the AI assistant" rows={2} maxLength={400} placeholder="e.g. Need 2 people at L3+ in Azure and 1 at L4 in React for the migration" value={demand} onChange={e=>setDemand(e.target.value)}/>
   <div className="team-ask-actions">
    <div className="team-ask-examples">{EXAMPLES.map(example=><button type="button" key={example} onClick={()=>setDemand(example)}>{example}</button>)}</div>
    <button className="admin-primary"><Send size={15}/>{demand.trim()?'Compare with team':'Summarise team gaps'}</button>
   </div>
  </form>
 </section>;
}

function Radar({analytics}:{analytics:TeamReportAnalytics}){
 const skills=skillProfiles(analytics).slice(0,6),titleId=useId();
 if(skills.length<3)return <p className="team-chart-caption">The radar appears once three or more skills have a reviewed record.</p>;
 const point=(i:number,value:number,r=78)=>{const a=i*2*Math.PI/skills.length-Math.PI/2;return [130+Math.cos(a)*r*value/5,112+Math.sin(a)*r*value/5];};
 const ring=(v:number)=>skills.map((_,i)=>point(i,v).join(',')).join(' ');
 return <svg className="team-radar" viewBox="0 0 260 230" role="img" aria-labelledby={titleId}>
  <title id={titleId}>{'Average reviewed level of holders: '+skills.map(s=>`${s.skill} L${s.average}`).join(', ')}</title>
  {LEVELS.map(v=><polygon key={v} points={ring(v)} className="team-radar-ring"/>)}
  {skills.map((s,i)=>{const [x,y]=point(i,5),[lx,ly]=point(i,5,98);return <g key={s.skill}><line x1="130" y1="112" x2={x} y2={y} className="team-radar-ring"/><text x={lx} y={ly+4} textAnchor="middle" className="team-radar-label">{s.skill.length>13?s.skill.slice(0,12)+'…':s.skill}</text></g>;})}
  <polygon points={skills.map((s,i)=>point(i,s.average).join(',')).join(' ')} className="team-radar-area"/>
  {skills.map((s,i)=>{const [x,y]=point(i,s.average);return <circle key={s.skill} cx={x} cy={y} r="3.5" className="team-radar-point"><title>{`${s.skill}: average L${s.average} across ${s.holders} holders`}</title></circle>;})}
 </svg>;
}

export function TeamInsightCharts({analytics,people,minimumRank,skillFilter,onSkill,onPerson}:{analytics?:TeamReportAnalytics;people:TeamPerson[];minimumRank:number;skillFilter:string;onSkill:(skill:string)=>void;onPerson:(id:string)=>void}){
 if(!analytics)return <AskAi/>;
 const profiles=skillProfiles(analytics),without=membersWithoutReviewedSkills(analytics),average=teamAverageLevel(analytics);
 const gaps=analytics.coverage.filter(r=>r.rank===minimumRank).map(r=>({skill:r.skillName,holders:r.people,missing:analytics.members-r.people})).sort((a,b)=>b.missing-a.missing||a.skill.localeCompare(b.skill)).slice(0,8);
 const heatSkills=profiles.slice(0,6).map(p=>p.skill),heatPeople=people.slice(0,8);
 const categories=[...analytics.categories].sort((a,b)=>b.count-a.count).slice(0,8),categoryTotal=categories.reduce((s,c)=>s+c.count,0);
 const memberMax=Math.max(1,...people.map(p=>p.reviewed+p.pending));
 return <>
  <div className="team-kpi-strip" aria-label="Additional team indicators">
   <div><strong>{profiles.length}</strong><span>Reviewed skills</span><small>Distinct skills with a reviewed record</small></div>
   <div><strong>{average?'L'+average:'—'}</strong><span>Average reviewed level</span><small>Recorded ranks capped at L5</small></div>
   <div><strong>{without}</strong><span>Without reviewed skills</span><small>{analytics.members?Math.round(without/analytics.members*100):0}% of active members</small></div>
   <div><strong>{profiles[0]?.skill??'—'}</strong><span>Most covered skill</span><small>{profiles[0]?`${profiles[0].holders} holders · avg L${profiles[0].average}`:'No reviewed skills yet'}</small></div>
  </div>
  <AskAi/>
  <div className="team-insight-grid">
   <section className="team-chart"><header><div><h3>Team skill radar</h3><p>Average reviewed level of holders for the most covered skills.</p></div></header><Radar analytics={analytics}/><p className="team-chart-caption">Scale L1–L5+. Historical ranks above five are capped for this chart. This is a recorded-rank summary, not equivalence across frameworks. Averages include holders only.</p></section>
   <section className="team-chart"><header><div><h3>Recorded gaps at L{minimumRank}+</h3><p>Reviewed holders against members without recorded coverage. Select a skill to filter the member list.</p></div></header>
    {gaps.length?<div className="team-gap-chart">{gaps.map(g=><button key={g.skill} aria-pressed={skillFilter===g.skill} onClick={()=>onSkill(g.skill)}><span>{g.skill}</span><span className="team-gap-track" title={`${g.holders} with coverage, ${g.missing} without`}><span className="have" style={{flex:g.holders}}/><span className="missing" style={{flex:g.missing}}/></span><strong>{g.missing}<small> without</small></strong></button>)}</div>:<p className="team-chart-caption">No reviewed skills at this level yet.</p>}
    <p className="team-chart-legend-inline"><span><i className="teal"/>Reviewed coverage</span><span><i className="amber"/>No recorded coverage (not a proven deficiency)</span></p>
   </section>
   <section className="team-chart team-span-2"><header><div><h3>Level mix by skill</h3><p>How reviewed holders spread across proficiency levels.</p></div></header>
    {profiles.length?<div className="team-mix">{profiles.slice(0,8).map(p=><div key={p.skill} className="team-mix-row"><span title={p.skill}>{p.skill}</span><span className="team-mix-track" role="img" aria-label={`${p.skill}: ${p.atLevel.map((n,i)=>`L${i+1}${i===4?'+':''} ${n}`).join(', ')}`}>{p.atLevel.map((n,i)=>n?<span key={i} style={{flex:n,background:LEVEL_COLORS[i]}} title={`L${i+1}${i===4?'+':''}: ${n}`}/>:null)}</span><strong>{p.holders}</strong></div>)}</div>:<p className="team-chart-caption">No reviewed skills yet.</p>}
    <p className="team-chart-legend-inline">{LEVELS.map((l,i)=><span key={l}><i style={{background:LEVEL_COLORS[i]}}/>L{l}{l===5?'+':''}</span>)}</p>
   </section>
   <section className="team-chart team-span-2"><header><div><h3>Skill heatmap</h3><p>Reviewed level per member for the top skills. Members on this page only; select a cell to open that member.</p></div></header>
    {heatSkills.length&&heatPeople.length?<div className="my-skills-table-wrap"><table className="team-heatmap"><thead><tr><th scope="col">Member</th>{heatSkills.map(s=><th scope="col" key={s} title={s}>{s}</th>)}</tr></thead><tbody>{heatPeople.map(p=><tr key={p.id}><th scope="row">{p.name}</th>{heatSkills.map(s=>{const level=memberLevel(analytics,s,p.id);return <td key={s}><button className={'heat-'+level} onClick={()=>onPerson(p.id)} aria-label={`${p.name}, ${s}: ${level?'reviewed L'+level+(level===5?'+':''):'no reviewed record'}`}>{level?'L'+level+(level===5?'+':''):'·'}</button></td>;})}</tr>)}</tbody></table></div>:<p className="team-chart-caption">The heatmap appears once members on this page have reviewed skills.</p>}
   </section>
   <section className="team-chart"><header><div><h3>Category share</h3><p>Reviewed claims by skill category.</p></div></header>
    {categoryTotal?<div className="team-treemap">{categories.map((c,i)=><div key={c.category} style={{flexGrow:c.count,background:CATEGORY_COLORS[i%CATEGORY_COLORS.length]}} title={`${c.category}: ${c.count} reviewed claims`}><strong>{c.category}</strong><span>{c.count} · {Math.round(c.count/categoryTotal*100)}%</span></div>)}</div>:<p className="team-chart-caption">No reviewed categories yet.</p>}
   </section>
   <section className="team-chart"><header><div><h3>Claims per member</h3><p>Reviewed and assigned pending claims, members on this page.</p></div></header>
    {people.length?<div className="team-member-bars">{people.slice(0,10).map(p=><button key={p.id} onClick={()=>onPerson(p.id)}><span title={p.name}>{p.name}</span><span className="team-member-track" style={{width:(p.reviewed+p.pending)/memberMax*100+'%'}}><span className="reviewed" style={{flex:p.reviewed}}/><span className="pending" style={{flex:p.pending}}/></span><strong>{p.reviewed}<small>/{p.pending}</small></strong></button>)}</div>:<p className="team-chart-caption">No members on this page.</p>}
    <p className="team-chart-legend-inline"><span><i className="teal"/>Reviewed</span><span><i className="amber"/>Assigned pending</span></p>
   </section>
  </div>
 </>;
}
