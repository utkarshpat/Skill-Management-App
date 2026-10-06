// Refresh projections on user activity, never on a timer that keeps SQL awake.
// These projections do not authorize actions; APIs/SQL recheck current access.
export function startActivityRefresh(load:()=>Promise<unknown>, events:string[], environment={
  window:window as EventTarget, document:document as EventTarget & {visibilityState:string}, now:Date.now,
}) {
  let disposed=false,running=false,queued=false,lastLoad=-Infinity;
  const refresh=(force=false,age=300_000)=>{
    if(disposed)return;
    if(environment.document.visibilityState!=='visible'){if(force)queued=true;return;}
    if(running){if(force)queued=true;return;}
    if(!force&&environment.now()-lastLoad<age)return;
    queued=false;running=true;lastLoad=environment.now();
    void Promise.resolve().then(()=>{if(!disposed)return load();}).catch(()=>undefined).finally(()=>{
      running=false;if(queued){queued=false;refresh(true);}
    });
  };
  const activity=()=>refresh(),focus=()=>refresh(queued,60_000),changed=()=>refresh(true);
  environment.window.addEventListener('focus',focus);
  environment.document.addEventListener('visibilitychange',focus);
  environment.document.addEventListener('pointerdown',activity);
  environment.document.addEventListener('keydown',activity);
  for(const event of events)environment.window.addEventListener(event,changed);
  refresh(true);
  return()=>{
    disposed=true;queued=false;
    environment.window.removeEventListener('focus',focus);
    environment.document.removeEventListener('visibilitychange',focus);
    environment.document.removeEventListener('pointerdown',activity);
    environment.document.removeEventListener('keydown',activity);
    for(const event of events)environment.window.removeEventListener(event,changed);
  };
}
