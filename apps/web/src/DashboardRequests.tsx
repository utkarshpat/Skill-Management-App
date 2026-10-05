import {useEffect,useState} from 'react';
import {Link} from 'react-router';
import {ArrowUpRight,Inbox,Plus,Clock3} from 'lucide-react';
import {requestStatusLabel,type RequestRecord} from './request-model';
import {ProgressRing} from './ui-kit';
export type RequestPreview=Pick<RequestRecord,'id'|'reference'|'kind'|'title'|'status'|'priority'|'recipientName'|'updatedAt'>;
export interface DashboardRequestsData {total:number;submitted:number;inProgress:number;resolved:number;cancelled:number;canCreate:boolean;recentRecords:RequestPreview[]}
export const requestDashboardViews=[{id:'',label:'All',count:'total'},{id:'SUBMITTED',label:'Submitted',count:'submitted'},{id:'IN_PROGRESS',label:'In progress',count:'inProgress'},{id:'RESOLVED',label:'Resolved',count:'resolved'},{id:'CANCELLED',label:'Cancelled',count:'cancelled'}] as const;
export function requestQueueHref(status:string){return '/requests'+(status?'?status='+encodeURIComponent(status):'');}
type RequestFetcher=(path:string,init?:RequestInit)=>Promise<Response>;
export async function readRequestPreview(status:string,signal:AbortSignal,fetcher:RequestFetcher):Promise<{items:RequestPreview[];total:number}>{
 if(!requestDashboardViews.some(v=>v.id===status))throw Error('Choose a valid request status.');
 const response=await fetcher('/api/dashboard/requests'+(status?'?status='+encodeURIComponent(status):''),{signal});
 const body=await response.json().catch(()=>undefined);if(!response.ok)throw Object.assign(Error(body?.error?.message??'Your request updates could not be loaded.'),{status:response.status});
 const records:RequestPreview[]=Array.isArray(body?.recentRecords)?body.recentRecords:[];
 return {items:records.slice(0,3).map((r:RequestPreview)=>({id:r.id,reference:r.reference,kind:r.kind,title:r.title,status:r.status,priority:r.priority,recipientName:r.recipientName,updatedAt:r.updatedAt})),total:typeof body?.previewTotal==='number'?body.previewTotal:records.length};
}
export function DashboardRequests({data,onAccessChanged,fetcher,status,onStatusChange}:{data:DashboardRequestsData;onAccessChanged:()=>void;fetcher:RequestFetcher;status:string;onStatusChange:(status:string)=>void}){
 const [result,setResult]=useState<{status:string;items:RequestPreview[];total:number}>(),[failure,setFailure]=useState<{status:string;message:string}>(),[attempt,setAttempt]=useState(0);
 useEffect(()=>{
  setResult(undefined);setFailure(undefined);if(!status)return;const c=new AbortController();
  readRequestPreview(status,c.signal,fetcher).then(value=>{if(!c.signal.aborted)setResult({...value,status});}).catch(e=>{if(!c.signal.aborted){setFailure({status,message:e.message});if([401,403,409].includes(e.status))onAccessChanged();}});
  return()=>c.abort();
 },[status,attempt,data]);
 const error=failure?.status===status?failure.message:'',value=status?(result?.status===status?result:undefined):{items:data.recentRecords,total:data.total},label=requestDashboardViews.find(v=>v.id===status)!.label;
 return <div className="dashboard-requests-body"><div className="dashboard-requests-heading"><p>{data.total} {data.total===1?'request or incident':'requests & incidents'} raised by you</p>{data.total>0&&<span className="dashboard-requests-ring"><ProgressRing value={Math.round(data.resolved/data.total*100)} label="Share of your requests resolved" size={52} stroke={6} tone="success"/></span>}{data.canCreate&&<Link className="dashboard-link" to="/requests?action=create"><Plus size={15}/>Raise request</Link>}</div>
 <div className="dashboard-request-tabs" role="group" aria-label="Your request statuses">{requestDashboardViews.map(v=><button key={v.id} aria-pressed={status===v.id} onClick={()=>onStatusChange(v.id)}>{v.label}<span>{data[v.count]}</span></button>)}</div>
 <section className="dashboard-request-preview" aria-label={label+' request updates'}>
 {error?<div role="alert" className="dashboard-error"><p>{error}</p><button className="secondary-button" onClick={()=>setAttempt(n=>n+1)}>Retry request updates</button></div>:!value?<div className="dashboard-skeleton" role="status" aria-label={'Loading '+label.toLowerCase()+' requests'}><i/><i/><i/></div>:value.items.length?<><ul>{value.items.map(r=><li key={r.id}><div><span className="dashboard-request-reference">{r.reference} · {r.kind==='INCIDENT'?'Incident':'Request'}{r.priority==='HIGH'&&<span className="dashboard-request-high">High priority</span>}</span><Link className="dashboard-claim-title" to={'/requests?record='+r.id}>{r.title}<ArrowUpRight size={14}/></Link><p>Recipient: {r.recipientName}</p><time dateTime={r.updatedAt}><Clock3 size={13}/>Updated {new Intl.DateTimeFormat('en-GB',{day:'numeric',month:'short',year:'numeric',timeZone:'UTC'}).format(new Date(r.updatedAt))}</time></div><span className={'dashboard-request-state '+r.status.toLowerCase()}>{requestStatusLabel(r.status)}</span></li>)}</ul><p className="dashboard-learning-caption">Latest {value.items.length} of {value.total} {status?label.toLowerCase()+' ':''}records. <Link to={requestQueueHref(status)}>View matching requests<ArrowUpRight size={14}/></Link></p></>:<div className="dashboard-empty"><Inbox size={25}/><div><strong>{data.total===0?'No requests raised yet':'No '+label.toLowerCase()+' requests'}</strong><p>{data.total===0?'Raise a request or report an incident when you need help.':'Requests in this status will appear here when available.'}</p>{data.total===0&&data.canCreate&&<Link to="/requests?action=create">Raise your first request<ArrowUpRight size={15}/></Link>}</div></div>}
 </section></div>;
}
