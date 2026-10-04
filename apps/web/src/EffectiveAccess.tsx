import {useEffect,useState} from 'react';
import {authenticatedFetch} from './auth';
import {AccessDecisionList,type AccessSummary} from './AccessDecisionList';
export type {Decision,AccessSummary} from './AccessDecisionList';
export function EffectiveAccess({endpoint,actorId}:{endpoint:string;actorId:string}){
 const [summary,setSummary]=useState<AccessSummary>(),[error,setError]=useState(''),[attempt,setAttempt]=useState(0);
 useEffect(()=>{const controller=new AbortController();setSummary(undefined);setError('');authenticatedFetch(endpoint,{signal:controller.signal}).then(async response=>{const body=await response.json();if(!response.ok)throw Error(body?.error?.message??'Access explanations are unavailable.');if(body.actorId!==actorId)throw Error('Access identity mismatch.');if(!controller.signal.aborted)setSummary(body);}).catch(e=>{if(!controller.signal.aborted)setError(e.message);});return()=>controller.abort();},[endpoint,actorId,attempt]);
 return <section className="profile-panel"><h2>Effective access</h2>{summary?<AccessDecisionList summary={summary}/>:error?<p role="alert">{error}<button className="secondary-button" onClick={()=>setAttempt(n=>n+1)}>Retry</button></p>:<p role="status">Loading current access…</p>}</section>;
}
