import {useId,useMemo,useState} from 'react';
import {Bot,Send} from 'lucide-react';
import {coverageRows,type TeamReportAnalytics} from './team-reports';
import {indexCoverage} from './team-coverage';
import type {TeamPerson} from './team-analytics';
import {LEVELS,demandPrompt,memberLevel,membersWithoutReviewedSkills,skillProfiles,teamAverageLevel,type SkillProfile} from './team-insights';

const LEVEL_COLORS=['#9cc9cf','#5fb0ba','#008595','#0b5f6b','#123c44'];
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

function Radar({profiles}:{profiles:SkillProfile[]}){
 const skills=profiles.slice(0,6),titleId=useId();
 if(skills.length<3)return <p className="team-chart-caption">The radar appears once three or more skills have a reviewed record.</p>;
 const point=(i:number,value:number,r=78)=>{const a=i*2*Math.PI/skills.length-Math.PI/2;return [130+Math.cos(a)*r*value/5,112+Math.sin(a)*r*value/5];};
 const ring=(v:number)=>skills.map((_,i)=>point(i,v).join(',')).join(' ');
 return <svg className="team-radar" viewBox="0 0 260 230" role="img" aria-labelledby={titleId}>
  <title id={titleId}>{'Holder averages capped at L5 (historical levels above 5 grouped as L5+): '+skills.map(s=>`${s.skill} ${s.average}`).join(', ')}</title>
  {LEVELS.map(v=><polygon key={v} points={ring(v)} className="team-radar-ring"/>)}
  {skills.map((s,i)=>{const [x,y]=point(i,5),[lx,ly]=point(i,5,98);return <g key={s.skill}><line x1="130" y1="112" x2={x} y2={y} className="team-radar-ring"/><text x={lx} y={ly+4} textAnchor="middle" className="team-radar-label">{s.skill.length>13?s.skill.slice(0,12)+'…':s.skill}</text></g>;})}
  <polygon points={skills.map((s,i)=>point(i,s.average).join(',')).join(' ')} className="team-radar-area"/>
  {skills.map((s,i)=>{const [x,y]=point(i,s.average);return <circle key={s.skill} cx={x} cy={y} r="3.5" className="team-radar-point"><title>{`${s.skill}: capped holder average ${s.average} across ${s.holders} holders (L5+)`}</title></circle>;})}
 </svg>;
}

export function TeamInsightCharts({analytics,people,minimumRank,skillFilter,onSkill,onPerson,canAskAi=false}:{canAskAi?:boolean;analytics?:TeamReportAnalytics;people:TeamPerson[];minimumRank:number;skillFilter:string;onSkill:(skill:string)=>void;onPerson:(id:string)=>void}){
 const index=useMemo(()=>analytics?indexCoverage(analytics):undefined,[analytics]);
 const profiles=useMemo(()=>analytics&&index?skillProfiles(analytics,index):[],[analytics,index]);
 if(!analytics)return canAskAi?<AskAi/>:null;
 const without=membersWithoutReviewedSkills(analytics),average=teamAverageLevel(analytics);
 const gaps=coverageRows(analytics,minimumRank,index).slice(0,8);
 const heatSkills=profiles.slice(0,8).map(p=>p.skill),heatPeople=people;
 return <>
  <div className="team-kpi-strip" aria-label="Additional team indicators">
   <div><strong>{profiles.length}</strong><span>Reviewed skills</span><small>Distinct skills with a reviewed record</small></div>
   <div><strong>{average?'L'+average:'—'}</strong><span>Average reviewed level</span><small>Recorded ranks capped at L5</small></div>
   <div><strong>{without}</strong><span>Without reviewed skills</span><small>{analytics.members?Math.round(without/analytics.members*100):0}% of active members</small></div>
   <div><strong>{profiles[0]?.skill??'—'}</strong><span>Most covered skill</span><small>{profiles[0]?`${profiles[0].holders} holders · capped avg ${profiles[0].average} (L5+)`:'No reviewed skills yet'}</small></div>
  </div>
  {canAskAi&&<AskAi/>}
  <div className="team-insight-grid">
   <section className="team-chart"><header><div><h3>Team skill radar</h3><p>Holder averages capped at L5 for the most covered skills.</p></div></header><Radar profiles={profiles}/><p className="team-chart-caption">Scale L1–L5+. Historical ranks above 5 are grouped as L5+, not exact L5. These capped averages include holders only, not the whole team.</p></section>
   <section className="team-chart"><header><div><h3>Recorded gaps at L{minimumRank}+</h3><p>Reviewed holders against members without recorded coverage. Select a skill to filter the member list.</p></div></header>
    {gaps.length?<div className="team-gap-chart">{gaps.map(g=><button key={g.skillName} aria-pressed={skillFilter===g.skillName} onClick={()=>onSkill(g.skillName)}><span>{g.skillName}</span><span className="team-gap-track" title={`${g.holders} with coverage, ${g.missing} without`}><span className="have" style={{flex:g.holders}}/><span className="missing" style={{flex:g.missing}}/></span><strong>{g.missing}<small> without</small></strong></button>)}</div>:<p className="team-chart-caption">No reviewed skills yet.</p>}
    <p className="team-chart-legend-inline"><span><i className="teal"/>Reviewed coverage</span><span><i className="amber"/>No recorded coverage (not a proven deficiency)</span></p>
   </section>
   <section className="team-chart team-span-2"><header><div><h3>Level mix by skill</h3><p>How reviewed holders spread across proficiency levels.</p></div></header>
    {profiles.length?<div className="team-mix">{profiles.slice(0,8).map(p=><div key={p.skill} className="team-mix-row"><span title={p.skill}>{p.skill}</span><span className="team-mix-track" role="img" aria-label={`${p.skill}: ${p.atLevel.map((n,i)=>`L${i+1}${i===4?'+':''} ${n}`).join(', ')}`}>{p.atLevel.map((n,i)=>n?<span key={i} style={{flex:n,background:LEVEL_COLORS[i]}} title={`L${i+1}${i===4?'+':''}: ${n}`}/>:null)}</span><strong>{p.holders}</strong></div>)}</div>:<p className="team-chart-caption">No reviewed skills yet.</p>}
    <p className="team-chart-legend-inline">{LEVELS.map((l,i)=><span key={l}><i style={{background:LEVEL_COLORS[i]}}/>L{l}{l===5?'+':''}</span>)}</p>
   </section>
   <section className="team-chart team-span-2 team-heatmap-card">
    <header className="team-heatmap-header">
     <div>
      <div className="team-heatmap-title-row">
       <h3>Skill heatmap</h3>
       <span className="team-heatmap-badge">{heatSkills.length} {heatSkills.length===1?'skill':'skills'}</span>
      </div>
      <p>Reviewed level per member for the top skills. L5+ includes historical ranks above 5. Members on this page only; select a cell or member to open their profile.</p>
     </div>
     <div className="team-heatmap-legend" aria-label="Heatmap level legend">
      <span className="heatmap-legend-item"><i className="heat-legend-swatch heat-0"/><span>No reviewed record</span></span>
      <span className="heatmap-legend-item"><i className="heat-legend-swatch heat-1"/><span>L1</span></span>
      <span className="heatmap-legend-item"><i className="heat-legend-swatch heat-2"/><span>L2</span></span>
      <span className="heatmap-legend-item"><i className="heat-legend-swatch heat-3"/><span>L3</span></span>
      <span className="heatmap-legend-item"><i className="heat-legend-swatch heat-4"/><span>L4</span></span>
      <span className="heatmap-legend-item"><i className="heat-legend-swatch heat-5"/><span>L5+</span></span>
     </div>
    </header>
    {heatSkills.length&&heatPeople.length?<div className="team-heatmap-wrapper"><table className="team-heatmap"><thead><tr><th scope="col" className="heatmap-member-col">Team member</th>{heatSkills.map(s=>{const prof=profiles.find(p=>p.skill===s);return <th scope="col" key={s} title={s} className="heatmap-skill-col"><span className="heatmap-skill-title">{s}</span>{prof&&<span className="heatmap-skill-meta">{prof.holders} {prof.holders===1?'holder':'holders'} · avg L{prof.average}</span>}</th>;})}</tr></thead><tbody>{heatPeople.map(p=><tr key={p.id}><th scope="row" className="heatmap-member-cell"><button className="heatmap-member-btn" onClick={()=>onPerson(p.id)} title={`Open capability profile for ${p.name}`}><span className="team-avatar" aria-hidden="true">{p.name.split(' ').map(s=>s[0]).slice(0,2).join('')}</span><span className="heatmap-member-info"><strong>{p.name}</strong><small>{p.employeeCode}</small></span></button></th>{heatSkills.map(s=>{const level=memberLevel(analytics,s,p.id,index),label=level?'L'+level+(level===5?'+':''):'no reviewed record';return <td key={s} className="heatmap-cell"><button className={'heat-cell-btn heat-'+level} onClick={()=>onPerson(p.id)} aria-label={`${p.name}, ${s}: ${level?'reviewed '+label:label}`} title={`${p.name} · ${s}: ${level?`Reviewed proficiency ${label}`:'No reviewed record'}`}>{level?label:'—'}</button></td>;})}</tr>)}</tbody></table></div>:<p className="team-chart-caption">The heatmap appears once members on this page have reviewed skills.</p>}
   </section>
  </div>
 </>;
}
