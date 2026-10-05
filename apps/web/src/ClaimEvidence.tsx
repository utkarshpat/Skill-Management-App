import {useEffect,useRef,useState} from 'react';
import {ImagePlus,RefreshCw,ExternalLink} from 'lucide-react';
import {authenticatedFetch} from './auth';
import type {Claim} from './MySkills';
import {compressEvidenceImage} from './evidence-image';
import {notify} from './toast';
import './claim-evidence.css';
interface ImageItem {id:string;bytes:number;width:number;height:number}
interface State {revision:number;canUpload:boolean;items:ImageItem[]}
function EvidenceThumbnail({url,index}:{url:string;index:number}){const [src,setSrc]=useState(''),[failed,setFailed]=useState(false);useEffect(()=>{const c=new AbortController();let object='';authenticatedFetch(url,{signal:c.signal}).then(async r=>{if(!r.ok)throw Error();return r.blob();}).then(blob=>{if(!c.signal.aborted){object=URL.createObjectURL(blob);setSrc(object);}}).catch(()=>{if(!c.signal.aborted)setFailed(true);});return()=>{c.abort();if(object)URL.revokeObjectURL(object);};},[url]);return src?<a href={src} target="_blank" rel="noopener noreferrer" className="claim-image-preview" aria-label={`Open evidence image ${index+1}`}><img src={src} alt={`Evidence image ${index+1}`}/><span><ExternalLink size={14}/>View image</span></a>:<div className="claim-image-placeholder">{failed?'Image unavailable':'Loading image…'}</div>;}
export function ClaimEvidence({claim,reviewer=false,onRevision,onBusy}:{claim:Claim;reviewer?:boolean;onRevision?:(revision:number)=>void;onBusy?:(busy:boolean)=>void}){
 const [state,setState]=useState<State>(),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState(''),[attempt,setAttempt]=useState(0);
 const uploadController=useRef<AbortController|undefined>(undefined);
 useEffect(()=>()=>uploadController.current?.abort(),[]);
 const root=`${reviewer?'/api/skill-reviews':'/api/my-skills'}/${encodeURIComponent(claim.id)}/evidence`;
 useEffect(()=>{const c=new AbortController();setLoading(true);setError('');authenticatedFetch(root,{signal:c.signal}).then(async r=>{const data=await r.json();if(!r.ok)throw Error(data?.error?.message??'Image evidence is unavailable.');return data as State;}).then(data=>{if(!c.signal.aborted)setState(data);}).catch(e=>{if(!c.signal.aborted){setState(undefined);setError(e.message);}}).finally(()=>{if(!c.signal.aborted)setLoading(false);});return()=>c.abort();},[root,attempt]);
 async function upload(file?:File){
  if(!file||!state||busy)return;
  const controller=new AbortController();uploadController.current=controller;
  setBusy(true);onBusy?.(true);setError('');
  try{
   const image=await compressEvidenceImage(file);
   if(controller.signal.aborted)return;
   const r=await authenticatedFetch(root,{method:'POST',signal:controller.signal,headers:{'Content-Type':image.type,'X-Claim-Revision':String(state.revision)},body:image});
   const data=await r.json();if(!r.ok)throw Error(data?.error?.message??'Image upload failed.');
   if(!controller.signal.aborted){setState(data);onRevision?.(data.revision);}
  }catch(e){if(!controller.signal.aborted){const message=e instanceof Error?e.message:'Image upload failed.';setError(message);notify(message,'error');}}
  finally{if(!controller.signal.aborted){setBusy(false);onBusy?.(false);}uploadController.current=undefined;}
 }

 const links=(claim.evidence??'').split(/\s+/).filter(value=>/^https:\/\/[^\s]+$/i.test(value));
 return <div className="claim-evidence"><p className="claim-evidence-text">{claim.evidence||'No evidence references added.'}</p>{links.length>0&&<div className="claim-evidence-links">{links.slice(0,8).map((link,i)=><a key={i} href={link} target="_blank" rel="noopener noreferrer"><ExternalLink size={14}/>Open reference {i+1}</a>)}</div>}{loading&&<p role="status">Loading image evidence…</p>}{error&&<div className="claim-evidence-error"><span>{error}</span><button type="button" className="secondary-button" disabled={loading||busy} onClick={()=>setAttempt(n=>n+1)}>Retry images</button></div>}{state&&<><div className="claim-evidence-heading"><strong>Images <span>{state.items.length}/6</span></strong>{state.canUpload&&!reviewer&&<label className={'claim-image-upload'+(busy?' busy':'')}>{busy?<RefreshCw className="review-spin" size={16}/>:<ImagePlus size={16}/>} {busy?'Compressing & uploading…':'Add image'}<input type="file" accept="image/jpeg,image/png,image/webp" disabled={busy||state.items.length>=6} onChange={e=>{void upload(e.target.files?.[0]);e.target.value='';}}/></label>}</div>{state.items.length?<div className="claim-image-grid">{state.items.map((item,i)=><div key={item.id}><EvidenceThumbnail url={root+'/'+item.id} index={i}/><small>{Math.ceil(item.bytes/1024)} KB · {item.width} × {item.height}</small></div>)}</div>:<p className="claim-evidence-empty">No image evidence yet.</p>}{state.canUpload&&!reviewer&&<small>JPEG, PNG or WebP · up to 10 MB · compressed automatically</small>}</>}</div>;
}
