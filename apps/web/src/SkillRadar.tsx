import {useId} from 'react';
import {Link} from 'react-router';

export interface TopReviewedSkill {id:string;skillName:string;category:string;rank:number;levelName:string;maxRank:number|null}
export function SkillRadar({skills,reviewed}:{skills:TopReviewedSkill[];reviewed:number}){
 const titleId=useId(),descriptionId=useId();
 if(!skills.length)return <section className="skill-radar-empty"><h4>Your top skills</h4><p>No manager-reviewed skills yet. Your proficiency snapshot appears after review; pending claims and drafts stay separate.</p></section>;
 const scaleAvailable=skills.every(s=>s.maxRank!==null&&s.maxRank>=s.rank);
 const maximum=Math.max(...skills.map(s=>s.maxRank??s.rank),...skills.map(s=>s.rank));
 const point=(index:number,rank:number,radius=82)=>{const angle=index*2*Math.PI/skills.length-Math.PI/2;return {x:130+Math.cos(angle)*radius*rank/maximum,y:115+Math.sin(angle)*radius*rank/maximum};};
 const polygon=(rank:number)=>skills.map((_,i)=>{const p=point(i,rank);return `${p.x},${p.y}`;}).join(' ');
 const strongest=skills[0];
 return <section className="skill-radar" aria-labelledby={titleId}>
  <div className="skill-radar-heading"><h4 id={titleId}>Your top skills</h4><span>Manager reviewed</span></div>
  <div className="skill-radar-layout">
   {skills.length>=3&&scaleAvailable?<figure><svg viewBox="0 0 260 240" role="img" aria-labelledby={`${titleId} ${descriptionId}`}>
    <desc id={descriptionId}>Spider-web chart of reviewed proficiency. {skills.map((s,i)=>`S${i+1}: ${s.skillName}, level ${s.rank} of ${s.maxRank}, ${s.levelName}`).join('. ')}. Ranks use each skill's saved definition, not a percentage score.</desc>
    {Array.from({length:maximum},(_,i)=>i+1).map(rank=><g key={rank}><polygon points={polygon(rank)} className="skill-radar-ring"/><text x="134" y={115-82*rank/maximum+4} className="skill-radar-tick">{rank}</text></g>)}
    {skills.map((s,i)=>{const end=point(i,maximum);const label=point(i,maximum,103);return <g key={s.id}><line x1="130" y1="115" x2={end.x} y2={end.y} className="skill-radar-ring"/><text x={label.x} y={label.y+4} textAnchor="middle" className="skill-radar-label">S{i+1}</text></g>;})}
    <polygon points={skills.map((s,i)=>{const p=point(i,s.rank);return `${p.x},${p.y}`;}).join(' ')} className="skill-radar-area"/>
    {skills.map((s,i)=>{const p=point(i,s.rank);return <circle key={s.id} cx={p.x} cy={p.y} r="3.5" className="skill-radar-point"><title>{`${s.skillName}: L${s.rank} / ${s.maxRank} — ${s.levelName}`}</title></circle>;})}
   </svg><figcaption>Reviewed level · scale 1–{maximum}</figcaption></figure>:<p className="skill-radar-small">{scaleAvailable?<>Add more reviewed skills to unlock the spider-web view. Your {skills.length===1?'reviewed skill is':'reviewed skills are'} listed here.</>:<>A saved proficiency scale is unavailable for a historical claim. Exact reviewed levels are listed here; no chart scale has been assumed.</>}</p>}
   <ol className="skill-radar-list">{skills.map((s,i)=><li key={s.id}><span className="skill-radar-key">S{i+1}</span><div><Link to={'/my-skills?claim='+s.id}>{s.skillName}</Link><span>L{s.rank}{s.maxRank!==null?` / ${s.maxRank}`:' · Scale unavailable'} · {s.levelName}</span></div></li>)}</ol>
  </div>
  <p className="skill-radar-summary"><strong>{strongest.skillName}</strong> is your highest recorded level: <strong>L{strongest.rank} · {strongest.levelName}</strong>. Showing {skills.length} of {reviewed} reviewed skills, ordered by level. Different skill frameworks may use different level definitions.</p>
 </section>;
}
