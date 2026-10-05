import {useEffect,useRef,useState} from 'react';
import {CheckCircle2,AlertCircle,AlertTriangle,Info,X} from 'lucide-react';
import type {ToastKind} from './toast';
import './toast.css';
interface Toast {id:number;message:string;kind:ToastKind}
export function ToastHost({inDialog=false}:{inDialog?:boolean}){
 const [items,setItems]=useState<Toast[]>([]),counter=useRef(0),recent=useRef(new Map<string,number>());
 useEffect(()=>{function receive(event:Event){if(!inDialog&&document.querySelector('dialog[open]'))return;const detail=(event as CustomEvent).detail;if(!detail||typeof detail.message!=='string'||!['success','error','info','warning'].includes(detail.kind))return;const key=detail.kind+detail.message,now=Date.now();if(now-(recent.current.get(key)??0)<4000)return;recent.current.set(key,now);if(recent.current.size>40)recent.current.delete(recent.current.keys().next().value!);setItems(old=>[...old.slice(-2),{id:++counter.current,message:detail.message,kind:detail.kind}]);}window.addEventListener('app-toast',receive);return()=>window.removeEventListener('app-toast',receive);},[inDialog]);
 useEffect(()=>{if(!items.length)return;const timer=setTimeout(()=>setItems(old=>old.slice(1)),items[0].kind==='error'?10000:5000);return()=>clearTimeout(timer);},[items]);
 return <div className="app-toast-stack" aria-label="Application notifications">{items.map(item=>{const Icon=item.kind==='success'?CheckCircle2:item.kind==='error'?AlertCircle:item.kind==='warning'?AlertTriangle:Info;return <div className={'app-toast '+item.kind} key={item.id} role={item.kind==='error'?'alert':'status'}><Icon size={21}/><span>{item.message}</span><button aria-label="Dismiss notification" onClick={()=>setItems(old=>old.filter(i=>i.id!==item.id))}><X size={17}/></button></div>;})}</div>;
}
