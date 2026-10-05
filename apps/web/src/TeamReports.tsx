import {useEffect,useRef,useState} from 'react';
import {Download,FileSpreadsheet,RefreshCw} from 'lucide-react';
import {authenticatedFetch} from './auth';
import {coverageRows,fetchTeamReport,reportLabels,type TeamReportAnalytics,type TeamReportKind} from './team-reports';

export function TeamReports({analytics,query,onAccessChanged}:{analytics?:TeamReportAnalytics;query:string;onAccessChanged:()=>void}){
 const [kind,setKind]=useState<TeamReportKind>('summary'),[rank,setRank]=useState(3),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
 const request=useRef<AbortController|undefined>(undefined);
 useEffect(()=>()=>request.current?.abort(),[]);
 useEffect(()=>{request.current?.abort();setBusy(false);setError('');setMessage('');},[query,analytics]);
 const rows=analytics?coverageRows(analytics,rank).filter(r=>kind!=='gap'||r.missing>0):[];
 async function download(){
  const controller=new AbortController();request.current=controller;setBusy(true);setError('');setMessage('');
  try{
   const {csv,at}=await fetchTeamReport(authenticatedFetch,kind,rank,query,controller.signal);
   if(controller.signal.aborted)return;
   const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));
   const link=document.createElement('a');link.href=url;link.download=`direct-reports-${kind}${kind==='summary'?'':'-L'+rank}-${at.toISOString().slice(0,10)}.csv`;
   document.body.append(link);
   try{link.click();}finally{link.remove();window.setTimeout(()=>URL.revokeObjectURL(url),1000);}
   setMessage('CSV download started with freshly checked direct-report data.');
  }catch(reason){if(!controller.signal.aborted){
   if(reason instanceof Error&&'status' in reason&&[401,403,409].includes(Number(reason.status)))onAccessChanged();
   setError(reason instanceof Error?reason.message:'Report download failed. Refresh and retry.');
  }}
  finally{if(!controller.signal.aborted)setBusy(false);}
 }
 return <section className="team-reports" aria-labelledby="team-reports-title">
  <header><div><h3 id="team-reports-title"><FileSpreadsheet size={19}/>Reports & downloads</h3><p>Preview a report, then download the latest authorized data as CSV.</p></div><span className="team-report-format">CSV · Excel compatible</span></header>
  {!analytics?<p role="status" className="team-report-note">Full-team reports are unavailable. Refresh team data; page-only totals will not be exported.</p>:<>
   <div className="team-report-controls"><label>Report<select value={kind} disabled={busy} onChange={e=>{setKind(e.target.value as TeamReportKind);setMessage('');setError('');}}>{(Object.keys(reportLabels) as TeamReportKind[]).map(k=><option key={k} value={k}>{reportLabels[k]}</option>)}</select></label>
   {kind!=='summary'&&<label>Minimum proficiency<select value={rank} disabled={busy} onChange={e=>{setRank(Number(e.target.value));setMessage('');setError('');}}>{[1,2,3,4,5].map(n=><option key={n} value={n}>L{n} and above</option>)}</select></label>}
   <button className="admin-primary" disabled={busy||analytics.members===0} onClick={download}>{busy?<RefreshCw size={16} className="review-spin"/>:<Download size={16}/>} {busy?'Preparing CSV...':'Download CSV'}</button></div>
   <p className="team-report-scope"><strong>{analytics.members} active direct reports</strong> · {query?`Search: "${query}"`:'All current direct reports'} · All pages included. Chart/member selections do not narrow this report.</p>
   <div className="team-report-preview" aria-label="Report preview">
    {kind==='summary'?<dl><div><dt>Active members</dt><dd>{analytics.members}</dd></div><div><dt>Reviewed claims</dt><dd>{analytics.reviewed}</dd></div><div><dt>Assigned pending</dt><dd>{analytics.pending}</dd></div></dl>:rows.length?<><div className="my-skills-table-wrap"><table className="my-skills-table"><caption>{reportLabels[kind]} · L{rank} and above</caption><thead><tr><th>Skill</th><th>Reviewed coverage</th><th>Without recorded coverage</th></tr></thead><tbody>{rows.slice(0,5).map(r=><tr key={r.skillName}><td>{r.skillName}</td><td>{r.holders}/{analytics.members} <span className="review-subtext">({r.percent}%)</span></td><td>{r.missing} {r.missing===1?'member':'members'}</td></tr>)}</tbody></table></div><p className="team-report-note">Preview: {Math.min(5,rows.length)} of {rows.length} skills. The CSV includes every matching row.</p></>:<p className="team-report-note">{analytics.coverage.length?'No recorded coverage gaps at this level for skills in this report.':'No reviewed skills to report yet.'}</p>}
   </div>
   <p className="team-report-note">{kind==='summary'?'Category and proficiency breakdowns are included in the CSV. Pending reviews are not verified proficiency.':'A coverage gap means no manager-reviewed claim at this level, not a proven skill deficiency. Role-based targets are not configured; skills with no reviewed record are not included.'} Private drafts are excluded.</p>
  </>}
  {error&&<p className="team-report-error" role="alert">{error}</p>}
  {message&&<p className="team-report-success" role="status">{message}</p>}
 </section>;
}
