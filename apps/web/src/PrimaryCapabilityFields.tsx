import {useEffect,useState} from 'react';
import {authenticatedFetch} from './auth';
import {readApiResponse} from './api-response';
import {primaryCapabilityLabel,type PrimaryCapabilityDetails} from './PrimaryCapability';
interface Option {id:string;name:string;category:string;status:'PUBLISHED'}
interface Options {items:Option[];total:number;page:number;pageSize:number}
export function PrimaryCapabilityFields({endpoint,value,onChange,disabled=false}:{endpoint:string;value:PrimaryCapabilityDetails;onChange:(value:PrimaryCapabilityDetails)=>void;disabled?:boolean}){
 const [search,setSearch]=useState(''),[page,setPage]=useState(1),[attempt,setAttempt]=useState(0);
 const [result,setResult]=useState<{search:string;page:number;data:Options}>(),[loading,setLoading]=useState(true),[error,setError]=useState('');
 const data=result?.search===search&&result.page===page?result.data:undefined;
 useEffect(()=>{
  const controller=new AbortController();setLoading(true);setError('');
  const timer=setTimeout(()=>{authenticatedFetch(endpoint+'/primary-capabilities?search='+encodeURIComponent(search)+'&page='+page,{signal:controller.signal})
   .then(response=>readApiResponse<Options>(response,'Published capabilities could not be loaded. Retry the search.'))
   .then(data=>{if(!controller.signal.aborted)setResult({search,page,data});})
   .catch(reason=>{if(!controller.signal.aborted){setResult(undefined);setError(reason instanceof Error?reason.message:'Published capabilities could not be loaded. Retry the search.');}})
   .finally(()=>{if(!controller.signal.aborted)setLoading(false);});},200);
  return()=>{clearTimeout(timer);controller.abort();};
 },[endpoint,search,page,attempt]);
 const selectionInPage=data?.items.some(item=>item.id===value.primaryCapabilityId);
 return <fieldset disabled={disabled} aria-busy={loading}><legend>Primary capability</legend>
  <p className="access-help" id="primary-capability-help">Choose a published catalogue skill as the person's main area of work. This does not create a skill claim or change access. Leave unassigned or clear an existing selection when appropriate.</p>
  <label>Search published capabilities<input maxLength={100} value={search} onChange={event=>{setSearch(event.target.value);setPage(1);}}/></label>
  <label>Selected primary capability<select value={value.primaryCapabilityId??''} aria-describedby="primary-capability-help" onChange={event=>{
   if(event.target.value===value.primaryCapabilityId)return;
   const item=data?.items.find(item=>item.id===event.target.value);
   onChange(item?{primaryCapabilityId:item.id,primaryCapabilityName:item.name,primaryCapabilityStatus:item.status}:{primaryCapabilityId:null,primaryCapabilityName:null,primaryCapabilityStatus:null});
  }}><option value="">Not assigned</option>
   {value.primaryCapabilityId&&!selectionInPage&&<option value={value.primaryCapabilityId}>{primaryCapabilityLabel(value)}{value.primaryCapabilityStatus!=='PUBLISHED'?' - needs attention':''}</option>}
   {data?.items.map(item=><option key={item.id} value={item.id}>{item.name} - {item.category}</option>)}
  </select></label>
  {value.primaryCapabilityId&&value.primaryCapabilityStatus!=='PUBLISHED'&&<p className="access-help">The stored selection is no longer published or needs review. Keep it unchanged, clear it, or choose a published replacement. Other person edits will not silently remove it.</p>}
  {loading&&<p role="status">Loading published capabilities...</p>}
  {error&&<p role="alert">{error}<button type="button" className="secondary-button" onClick={()=>setAttempt(value=>value+1)}>Retry capability search</button></p>}
  {!loading&&data&&!data.total&&<p>No published capabilities match this search. Change the search or ask a catalogue administrator to publish a skill.</p>}
  {data&&data.total>0&&<div className="compact-pagination"><span>{data.total} published matches - page {page} of {Math.ceil(data.total/data.pageSize)}</span><button type="button" className="secondary-button" disabled={loading||page===1} onClick={()=>setPage(value=>value-1)}>Previous</button><button type="button" className="secondary-button" disabled={loading||page*data.pageSize>=data.total} onClick={()=>setPage(value=>value+1)}>Next</button></div>}
 </fieldset>;
}
