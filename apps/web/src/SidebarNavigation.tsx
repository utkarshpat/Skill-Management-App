import {useEffect,useRef,useState,type PointerEvent,type KeyboardEvent} from 'react';
import {Link} from 'react-router';
import {ChevronRight,GripVertical,RotateCcw,type LucideIcon} from 'lucide-react';
import {DEFAULT_SIDEBAR_ORDER,moveSidebarItem,normalizeSidebarOrder,orderSidebarItems,readSidebarOrder,saveSidebarOrder,sidebarStorageKey} from './sidebar-order';
import {toast} from './Toast';
export interface SidebarItem {id:string;label:string;icon:LucideIcon;href?:string;onSelect?:()=>void;active?:boolean}
function browserStorage(){try{return typeof window==='undefined'?undefined:window.localStorage;}catch{return undefined;}}
export function SidebarNavigation({items,actorId='',label,onNavigate=()=>{},updatedTime}:{items:SidebarItem[];actorId?:string;label:string;onNavigate?:()=>void;updatedTime?:string}){
 const [saved,setSaved]=useState(()=>({actorId,order:readSidebarOrder(browserStorage(),actorId)}));
 const [notice,setNotice]=useState(''),[dragView,setDragView]=useState<{source:string;target:string}>();
 const root=useRef<HTMLElement>(null),drag=useRef<{id:string;pointer:number;startY:number;active:boolean;target:string;timer:ReturnType<typeof setTimeout>;handle:HTMLButtonElement}|undefined>(undefined);
 const order=saved.actorId===actorId?saved.order:normalizeSidebarOrder(undefined),ordered=orderSidebarItems(items,order).filter(item=>item.id!='profile'),profile=items.find(item=>item.id==='profile');
 const custom=JSON.stringify(order)!==JSON.stringify(DEFAULT_SIDEBAR_ORDER);
 function cancelDrag(){if(drag.current){clearTimeout(drag.current.timer);const {handle,pointer}=drag.current;drag.current=undefined;if(handle.hasPointerCapture(pointer))handle.releasePointerCapture(pointer);}setDragView(undefined);}
 useEffect(()=>{setSaved({actorId,order:readSidebarOrder(browserStorage(),actorId)});setNotice('');cancelDrag();
  const sync=()=>setSaved({actorId,order:readSidebarOrder(browserStorage(),actorId)});
  const storage=(event:StorageEvent)=>{if(event.key===sidebarStorageKey(actorId)||event.key===null)sync();};
  window.addEventListener('sidebar-order-updated',sync);window.addEventListener('storage',storage);
  return()=>{window.removeEventListener('sidebar-order-updated',sync);window.removeEventListener('storage',storage);if(drag.current)clearTimeout(drag.current.timer);};
 },[actorId]);
 function commit(next:string[],message:string){setSaved({actorId,order:next});const persisted=saveSidebarOrder(browserStorage(),actorId,next);setNotice(message+(persisted?'':' Storage unavailable; kept for this session.'));toast.success(message);if(persisted)window.dispatchEvent(new Event('sidebar-order-updated'));}
 function move(source:string,target:string){const next=moveSidebarItem(order,items.map(i=>i.id),source,target);if(JSON.stringify(next)!==JSON.stringify(order))commit(next,(items.find(i=>i.id===source)?.label??'Item')+' moved.');}
 function begin(event:PointerEvent<HTMLButtonElement>,id:string){if(event.button!==0||!actorId)return;cancelDrag();const handle=event.currentTarget,pointer=event.pointerId;handle.setPointerCapture(pointer);const session={id,pointer,startY:event.clientY,active:false,target:id,handle,timer:setTimeout(()=>{if(drag.current===session){session.active=true;setDragView({source:id,target:id});setNotice('Drag to a new position. Escape cancels.');}},220)};drag.current=session;}
 function track(event:PointerEvent<HTMLButtonElement>){const session=drag.current;if(!session||session.pointer!==event.pointerId)return;if(!session.active){if(Math.abs(event.clientY-session.startY)>12)cancelDrag();return;}event.preventDefault();
  const nav=root.current;if(!nav)return;const rows=[...nav.querySelectorAll<HTMLElement>('[data-nav-id]')];if(!rows.length)return;
  const target=rows.reduce((nearest,row)=>Math.abs(event.clientY-(row.getBoundingClientRect().top+row.getBoundingClientRect().height/2))<Math.abs(event.clientY-(nearest.getBoundingClientRect().top+nearest.getBoundingClientRect().height/2))?row:nearest).dataset.navId!;
  session.target=target;setDragView({source:session.id,target});
  const sidebar=nav.closest<HTMLElement>('.sidebar-scroll');if(sidebar){const rect=sidebar.getBoundingClientRect();if(event.clientY<rect.top+55)sidebar.scrollTop-=18;else if(event.clientY>rect.bottom-55)sidebar.scrollTop+=18;}
 }
 function finish(event:PointerEvent<HTMLButtonElement>){const session=drag.current;if(!session||session.pointer!==event.pointerId)return;const {id,target,active}=session;cancelDrag();if(active)move(id,target);}
 function keyboard(event:KeyboardEvent<HTMLButtonElement>,id:string){if(event.key==='Escape'){cancelDrag();setNotice('Reordering cancelled.');return;}const index=ordered.findIndex(i=>i.id===id),target=event.key==='ArrowUp'?index-1:event.key==='ArrowDown'?index+1:event.key==='Home'?0:event.key==='End'?ordered.length-1:undefined;if(target===undefined)return;event.preventDefault();cancelDrag();if(ordered[target])move(id,ordered[target].id);}
 if(!items.length)return null;
 return <><div className="sidebar-scroll"><nav ref={root} className={'sidebar-navigation'+(dragView?' is-reordering':'')} aria-label={label}>
  {ordered.map(({id,label:caption,href,icon:Icon,onSelect,active})=><div key={id} data-nav-id={id} className={'sidebar-nav-row'+(active?' is-current':'')+(dragView?.source===id?' is-dragging':'')+(dragView?.target===id&&dragView.source!==id?' is-drop-target':'')}>
   {href?<Link className="workspace-nav-link sidebar-nav-destination" to={href} aria-current={active?'page':undefined} onClick={()=>{onSelect?.();onNavigate();}}><Icon size={19}/><span>{caption}</span>{active&&<ChevronRight size={14}/>}</Link>:<button className="sidebar-nav-destination" aria-current={active?'page':undefined} onClick={()=>{onSelect?.();onNavigate();}}><Icon size={19}/><span>{caption}</span>{active&&<ChevronRight size={14}/>}</button>}
   {actorId&&<button type="button" className="sidebar-drag-handle" aria-label={'Reorder '+caption} title="Hold and drag to reorder, or use ↑ / ↓ keys" onPointerDown={event=>begin(event,id)} onPointerMove={track} onPointerUp={finish} onPointerCancel={cancelDrag} onLostPointerCapture={cancelDrag} onKeyDown={event=>keyboard(event,id)} onClick={event=>event.preventDefault()}><GripVertical size={17}/></button>}
  </div>)}
 </nav>{actorId&&<div className="sidebar-order-tools"><span>Hold the grip to reorder</span><button type="button" disabled={!custom} aria-label="Reset sidebar order" title="Reset to default order" onClick={()=>{cancelDrag();commit(normalizeSidebarOrder(undefined),'Default order restored.');}}><RotateCcw size={15}/><span>Reset</span></button></div>}</div>{profile&&<nav className="sidebar-navigation sidebar-profile-footer" aria-label="Your profile"><div data-nav-id="profile" className={'sidebar-nav-row'+(profile.active?' is-current':'')}><Link className="workspace-nav-link sidebar-nav-destination" to={profile.href??'/profile'} aria-current={profile.active?'page':undefined} onClick={()=>{profile.onSelect?.();onNavigate();}}><profile.icon size={19}/><span>{profile.label}</span>{profile.active&&<ChevronRight size={14}/>}</Link></div>{updatedTime&&<small className="sidebar-updated-time">{updatedTime}</small>}</nav>}<p className="sr-only" role="status" aria-live="polite">{notice}</p></>;
}
