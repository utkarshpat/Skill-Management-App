import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { Bell, RefreshCw } from 'lucide-react';
import { authenticatedFetch } from './auth';
interface Item {id:string;at:string;title:string;body:string;href:string}
interface Feed {personId:string;items:Item[]}
const key=(personId:string)=>`skill-notifications-read:${personId}`;
function readIds(personId:string):string[]{try{const value=JSON.parse(localStorage.getItem(key(personId))??'[]');return Array.isArray(value)?value.filter(item=>typeof item==='string').slice(-100):[];}catch{return [];}}
export function Notifications({id}:{id:string}) {
  const [feed,setFeed]=useState<Feed>(),[read,setRead]=useState<string[]>([]),[error,setError]=useState(''),[attempt,setAttempt]=useState(0);
  useEffect(()=>{
    const controller=new AbortController();let running=false;
    const load=async()=>{if(running||document.visibilityState==='hidden')return;running=true;
      try{const response=await authenticatedFetch('/api/notifications',{signal:controller.signal});if(!response.ok)throw new Error('Notifications could not be loaded.');const body:Feed=await response.json();if(!controller.signal.aborted){setFeed(body);setRead(readIds(body.personId));setError('');}}
      catch{if(!controller.signal.aborted){setFeed(undefined);setError('Notifications could not be loaded.');}}
      finally{running=false;}
    };
    void load();const timer=setInterval(()=>void load(),60000),refresh=()=>void load();document.addEventListener('visibilitychange',refresh);
    return()=>{controller.abort();clearInterval(timer);document.removeEventListener('visibilitychange',refresh);};
  },[attempt]);
  useEffect(()=>{const changed=(event:StorageEvent)=>{if(feed&&event.key===key(feed.personId))setRead(readIds(feed.personId));};window.addEventListener('storage',changed);return()=>window.removeEventListener('storage',changed);},[feed?.personId]);
  function mark(ids:string[]){if(!feed)return;const next=[...new Set([...read,...ids])].slice(-100);setRead(next);try{localStorage.setItem(key(feed.personId),JSON.stringify(next));}catch{/* Read state still works in this session. */}}
  const unread=feed?.items.filter(item=>!read.includes(item.id)).length??0;
  return <><button className="navbar-icon notification-trigger" type="button" aria-label={unread?`Notifications, ${unread} unread`:'Notifications'} popoverTarget={id}><Bell size={21}/>{unread>0&&<span className="notification-count" aria-hidden="true">{unread}</span>}</button>
    <section id={id} popover="auto" className="navbar-popover notification-popover" aria-label="Notifications">
      <div className="notification-heading"><h2>Notifications</h2><button className="navbar-icon" type="button" aria-label="Refresh notifications" onClick={()=>setAttempt(value=>value+1)}><RefreshCw size={16}/></button></div>
      {error?<div><p role="alert">{error}</p><button className="secondary-button" onClick={()=>setAttempt(value=>value+1)}>Retry</button></div>:!feed?<p role="status">Loading notifications…</p>:!feed.items.length?<div className="notification-empty"><Bell size={24}/><p>You’re all caught up.</p></div>:<>
        <button className="admin-text-button" disabled={!unread} onClick={()=>mark(feed.items.map(item=>item.id))}>Mark all as read</button>
        <ul className="notification-list">{feed.items.map(item=><li key={item.id} className={read.includes(item.id)?'':'unread'}><Link to={item.href} onClick={event=>{mark([item.id]);event.currentTarget.closest<HTMLElement>('[popover]')?.hidePopover();}}><strong>{item.title}</strong><span>{item.body}</span><time dateTime={item.at}>{new Date(item.at).toLocaleString()}</time></Link></li>)}</ul>
        <small>Read status is saved on this device.</small>
      </>}
    </section>
  </>;
}
