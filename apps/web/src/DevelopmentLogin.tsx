import { useState } from 'react';
import { directSignIn, developmentLoginState, refreshDevelopmentLogin, unlockDemoPeople } from './auth';
export function DevelopmentLogin({onSessionReady}:{onSessionReady:()=>void}) {
  const [state,setState]=useState(developmentLoginState),[person,setPerson]=useState(developmentLoginState.people[0]?.id??'');
  const [busy,setBusy]=useState(false),[refreshing,setRefreshing]=useState(false),[error,setError]=useState('');
  const [accessCode,setAccessCode]=useState('');
  const hosted=state.status==='available'&&state.requiresAccessCode;
  async function unlock(){if(busy||!accessCode)return;setBusy(true);setError('');try{const result=await unlockDemoPeople(accessCode);setState(result);setPerson(result.people[0]?.id??'');}catch(error){setError(error instanceof Error&&error.name==='TimeoutError'?'The database is taking longer to wake up. Wait a moment and retry.':error instanceof Error?error.message:'Demo login could not be unlocked.');}finally{setBusy(false);}}
  async function retry(){if(refreshing)return;setRefreshing(true);setError('');try{const result=await refreshDevelopmentLogin();setState(result);setPerson(current=>result.people.some(item=>item.id===current)?current:result.people[0]?.id??'');if(result.signedIn)onSessionReady();}finally{setRefreshing(false);}}
  if(state.status==='disabled')return null;
  return <section className="demo-login" aria-label="Development login">
    <p className="demo-label">{hosted?'Demo login':'Development login'}</p>
    {hosted&&<><label htmlFor="demo-access-code">Demo access code</label><input id="demo-access-code" type="password" autoComplete="off" maxLength={256} value={accessCode} disabled={busy} onChange={event=>setAccessCode(event.target.value)} />{!state.people.length&&<>{busy&&<p role="status">Checking access. The database may take a minute to wake up.</p>}<button className="secondary-button" disabled={busy||!accessCode} onClick={()=>void unlock()}>{busy?'Checking access…':'Show test people'}</button>{error&&<p role="alert">{error}</p>}</>}</>}
    {refreshing?<p role="status">Checking development login…</p>:state.status==='error'?<><p role="alert">Development login could not be loaded. The API or database may be temporarily unavailable.</p><button className="secondary-button" onClick={()=>void retry()}>Retry development login</button></>:state.people.length?<>
      <label htmlFor="demo-person">Test person</label><select id="demo-person" value={person} disabled={busy} onChange={event=>setPerson(event.target.value)}>{state.people.map(item=><option key={item.id} value={item.id}>{item.displayName} · {item.roles.join(', ')||item.employeeCode}</option>)}</select>
      <button className="secondary-button" disabled={busy||!person||(hosted&&!accessCode)} onClick={()=>{setBusy(true);setError('');directSignIn(person,accessCode||undefined).catch(()=>{setError('Direct login could not finish. Check the access code or refresh the available people.');setBusy(false);});}}>{busy?'Opening workspace…':'Open demo workspace'}</button>
      {error&&<><p role="alert">{error}</p><button className="admin-text-button" onClick={()=>void retry()}>Refresh available people</button></>}
    </>:hosted?null:<><p role="status">No active development-login people are available. Microsoft-linked accounts use Microsoft sign-in.</p><button className="secondary-button" onClick={()=>void retry()}>Refresh available people</button></>}
  </section>;
}
