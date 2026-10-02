import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { Bot, X, Send, RotateCcw } from 'lucide-react';
import { authenticatedFetch } from './auth';
interface ChatMessage {role:'user'|'assistant';content:string;sources?:{label:string;url:string}[]}

export function AssistantWidget() {
 const [open,setOpen]=useState(false),[messages,setMessages]=useState<ChatMessage[]>([]),[text,setText]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const [status,setStatus]=useState<{configured:boolean;provider:string|null;mode:string}>();
 const controller=useRef<AbortController|null>(null),input=useRef<HTMLTextAreaElement>(null),launcher=useRef<HTMLButtonElement>(null),latest=useRef<HTMLDivElement>(null),closeButton=useRef<HTMLButtonElement>(null);
 useEffect(()=>()=>controller.current?.abort(),[]);
 useEffect(()=>{if(!open)return;const pending=new AbortController();authenticatedFetch('/api/assistant',{signal:pending.signal}).then(async response=>{if(!response.ok)throw new Error('Assistant access could not be verified.');setStatus(await response.json());}).catch(err=>{if(!pending.signal.aborted)setError(err.message);});return()=>pending.abort();},[open]);
 useEffect(()=>{if(open)(status?.configured?input.current:closeButton.current)?.focus();},[open,status?.configured]);
 useEffect(()=>{if(!open)return;const escape=(event:KeyboardEvent)=>{if(event.key==='Escape'){event.preventDefault();close();}};document.addEventListener('keydown',escape);return()=>document.removeEventListener('keydown',escape);},[open]);
 useEffect(()=>{latest.current?.scrollIntoView({block:'nearest'});},[messages,busy]);
 function close(){controller.current?.abort();setBusy(false);setOpen(false);requestAnimationFrame(()=>launcher.current?.focus());}
 async function send(){
  if(busy||!text.trim()||!status?.configured)return;
  const next:ChatMessage[]=[...messages,{role:'user',content:text.trim()}];setMessages(next);setText('');setBusy(true);setError('');
  const pending=new AbortController();controller.current=pending;
  try{
   const response=await authenticatedFetch('/api/assistant',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({messages:next.slice(-11).map(({role,content})=>({role,content}))}),signal:pending.signal});
   const body=await response.json().catch(()=>undefined);if(!response.ok)throw new Error(body?.error?.message??'AI could not reply. Please try again.');
   setMessages(current=>[...current,{role:'assistant',content:body.reply,sources:body.sources}]);
  }catch(err){if(!pending.signal.aborted){setError(err instanceof Error?err.message:'Could not send message.');setText(next.at(-1)!.content);setMessages(current=>current.slice(0,-1));}}
  finally{if(controller.current===pending){setBusy(false);controller.current=null;}}
 }
 return <><button ref={launcher} className="assistant-launcher" hidden={open} aria-label="Open AI assistant" aria-expanded={open} aria-controls="assistant-panel" onClick={()=>setOpen(true)}><Bot size={25}/><span>AI</span></button>
 <div className="assistant-drawer"><section id="assistant-panel" className={'assistant-panel'+(open?' is-open':'')} role="dialog" aria-label="AI assistant" aria-hidden={!open} inert={!open}>
  <header><Bot size={20}/><div><strong>AI assistant</strong><small>Read-only assistance</small></div><button aria-label="New AI conversation" disabled={busy} onClick={()=>{setMessages([]);setError('');setText('');}}><RotateCcw size={17}/></button><button ref={closeButton} aria-label="Close AI assistant" onClick={close}><X size={19}/></button></header>
  <div className="assistant-messages" role="log" aria-live="polite">{!status&&!error&&<p>Checking connection…</p>}{status&&!status.configured&&<div className="assistant-empty"><Bot size={28}/><strong>Model connection pending</strong><p>The assistant is integrated. Connect a model on the server to start chatting.</p></div>}{status?.configured&&!messages.length&&<div className="assistant-empty"><strong>How can I help?</strong><p>Ask about your workspace or draft a skill description.</p></div>}{messages.map((message,index)=><div key={index} className={'assistant-message '+message.role}><small>{message.role==='user'?'You':'Assistant'}</small><p>{message.content}</p>{message.sources?.map((source,i)=><Link key={i} to={source.url}>{source.label}</Link>)}</div>)}{busy&&<p role="status">Thinking…</p>}<div ref={latest}/></div>
  {error&&<p className="assistant-error" role="alert">{error}</p>}
  <form onSubmit={event=>{event.preventDefault();void send();}}><label className="sr-only" htmlFor="assistant-message">Message AI assistant</label><textarea id="assistant-message" ref={input} value={text} maxLength={2000} rows={2} placeholder="Ask a question…" disabled={!status?.configured||busy} onChange={event=>setText(event.target.value)} onKeyDown={event=>{if(event.key==='Enter'&&!event.shiftKey&&!event.nativeEvent.isComposing){event.preventDefault();void send();}}}/><button aria-label="Send AI message" disabled={busy||!text.trim()||!status?.configured}><Send size={18}/></button></form>
 </section></div></>;
}
