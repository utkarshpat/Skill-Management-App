import {useEffect,useRef,useState} from 'react';
import {AlertTriangle,CheckCircle2,Info,X,XCircle} from 'lucide-react';

export type ToastTone='success'|'error'|'info'|'warning';
interface ToastItem {id:number;tone:ToastTone;message:string;title?:string}
interface ToastDetail {tone:ToastTone;message:string;title?:string}

const EVENT='app-toast';
let nextId=1;

function emit(tone:ToastTone,message:string,title?:string){
 if(typeof window==='undefined')return;
 window.dispatchEvent(new CustomEvent<ToastDetail>(EVENT,{detail:{tone,message,title}}));
}

/** Fire-and-forget toast notifications. Safe to call outside React. */
export const toast={
 success:(message:string,title?:string)=>emit('success',message,title),
 error:(message:string,title?:string)=>emit('error',message,title),
 info:(message:string,title?:string)=>emit('info',message,title),
 warning:(message:string,title?:string)=>emit('warning',message,title),
};

const icons={success:CheckCircle2,error:XCircle,info:Info,warning:AlertTriangle};
const titles={success:'Done',error:'Something went wrong',info:'Update',warning:'Heads up'};

/** Mount once at the app root. Renders stacked, auto-dismissing notifications. */
export function ToastHost(){
 const [items,setItems]=useState<ToastItem[]>([]);
 const timers=useRef(new Map<number,ReturnType<typeof setTimeout>>());
 useEffect(()=>{
  const active=timers.current;
  const dismiss=(id:number)=>{const timer=active.get(id);if(timer)clearTimeout(timer);active.delete(id);setItems(list=>list.filter(item=>item.id!==id));};
  const onToast=(event:Event)=>{
   const detail=(event as CustomEvent<ToastDetail>).detail;
   if(!detail?.message)return;
   const id=nextId++;
   setItems(list=>[...list.slice(-3),{id,tone:detail.tone,message:detail.message,title:detail.title}]);
   active.set(id,setTimeout(()=>dismiss(id),detail.tone==='error'?7000:4500));
  };
  window.addEventListener(EVENT,onToast);
  return ()=>{window.removeEventListener(EVENT,onToast);active.forEach(timer=>clearTimeout(timer));active.clear();};
 },[]);
 if(!items.length)return null;
 return <div className="toast-region" aria-label="Notifications">
  {items.map(item=>{const Icon=icons[item.tone];return <div key={item.id} className={'toast toast-'+item.tone} role={item.tone==='error'?'alert':'status'}>
   <Icon size={19} className="toast-icon"/>
   <div className="toast-copy"><strong>{item.title??titles[item.tone]}</strong><p>{item.message}</p></div>
   <button type="button" className="toast-close" aria-label="Dismiss notification" onClick={()=>setItems(list=>list.filter(entry=>entry.id!==item.id))}><X size={15}/></button>
  </div>;})}
 </div>;
}
