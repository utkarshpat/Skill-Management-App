import { useState } from 'react';
import { directSignIn, developmentLoginState, refreshDevelopmentLogin } from './auth';
export function DevelopmentLogin({onSessionReady}:{onSessionReady:()=>void}) {
  const [state,setState]=useState(developmentLoginState),[person,setPerson]=useState(developmentLoginState.people[0]?.id??'');
  const [busy,setBusy]=useState(false),[refreshing,setRefreshing]=useState(false),[error,setError]=useState('');
  async function retry(){if(refreshing)return;setRefreshing(true);setError('');try{const result=await refreshDevelopmentLogin();setState(result);setPerson(current=>result.people.some(item=>item.id===current)?current:result.people[0]?.id??'');if(result.signedIn)onSessionReady();}finally{setRefreshing(false);}}
  if(state.status==='disabled')return null;
  return <section className="demo-login" aria-label="Development login">
    <p className="demo-label">Development login</p>
    {refreshing?<p role="status">Checking development login…</p>:state.status==='error'?<><p role="alert">Development login could not be loaded. The API or database may be temporarily unavailable.</p><button className="secondary-button" onClick={()=>void retry()}>Retry development login</button></>:state.people.length?<>
      <label htmlFor="demo-person">Test person</label><select id="demo-person" value={person} disabled={busy} onChange={event=>setPerson(event.target.value)}>{state.people.map(item=><option key={item.id} value={item.id}>{item.displayName} · {item.roles.join(', ')||item.employeeCode}</option>)}</select>
      <button className="secondary-button" disabled={busy||!person} onClick={()=>{setBusy(true);setError('');directSignIn(person).catch(()=>{setError('Direct login could not finish. Try again or refresh the available people.');setBusy(false);});}}>{busy?'Opening workspace…':'Open demo workspace'}</button>
      {error&&<><p role="alert">{error}</p><button className="admin-text-button" onClick={()=>void retry()}>Refresh available people</button></>}
    </>:<><p role="status">No active development-login people are available. Microsoft-linked accounts use Microsoft sign-in.</p><button className="secondary-button" onClick={()=>void retry()}>Refresh available people</button></>}
  </section>;
}
