import {useEffect,useState} from 'react';
import {EffectiveAccess} from './EffectiveAccess';
import {authenticatedFetch} from './auth';
import type {WorkspaceState} from './Workspace';
import {ProfileDetails,type Profile} from './ProfileDetails';
export function PersonalProfile({workspace}:{workspace:WorkspaceState}){
 const [profile,setProfile]=useState<Profile>(),[error,setError]=useState(''),[attempt,setAttempt]=useState(0);
 useEffect(()=>{const controller=new AbortController();setProfile(undefined);setError('');authenticatedFetch('/api/me',{signal:controller.signal}).then(async response=>{const body=await response.json();if(!response.ok)throw Error(body?.error?.message??'Profile details could not be loaded.');if(body.profile?.id!==workspace.person.id)throw Error('Profile identity could not be verified.');if(!controller.signal.aborted)setProfile(body.profile);}).catch(e=>{if(!controller.signal.aborted)setError(e.message);});return()=>controller.abort();},[workspace.person.id,attempt]);
 return <>{error&&<p role="alert">{error}<button className="secondary-button" onClick={()=>setAttempt(n=>n+1)}>Retry</button></p>}<ProfileDetails workspace={workspace} profile={profile}/><EffectiveAccess endpoint="/api/effective-access" actorId={workspace.person.id}/></>;
}
