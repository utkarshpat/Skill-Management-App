import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { MySkills } from './MySkills';
import {assistantNavigationTargets,type AssistantPage} from './assistant-actions';
import { Bot, X, Send, RotateCcw, History, Trash2 } from 'lucide-react';
import { authenticatedFetch } from './auth';
import { AssistantOutput, type Artifact } from './AssistantOutput';
import { AssistantRichText } from './AssistantRichText';
import { AssistantDocument, type AiDocument } from './AssistantDocument';
interface ChatMessage {role:'user'|'assistant';content:string;sources?:{label:string;url:string}[];artifact?:Artifact}

export function AssistantWidget() {
 const navigate=useNavigate();
 const [navigation,setNavigation]=useState<{pages:AssistantPage[];canReviewOwnSkill:boolean}>({pages:[],canReviewOwnSkill:false});
 const [actionBusy,setActionBusy]=useState(false),[reviewDescription,setReviewDescription]=useState<string>(),[actionNotice,setActionNotice]=useState('');
 const [open,setOpen]=useState(false),[messages,setMessages]=useState<ChatMessage[]>([]),[text,setText]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const [status,setStatus]=useState<{configured:boolean;provider:string|null;mode:string}>();
 const [document,setDocument]=useState<AiDocument>();
 const [chats,setChats]=useState<{id:string;title:string;updatedAt:string}[]>([]),[showHistory,setShowHistory]=useState(false);
 const [historyBusy,setHistoryBusy]=useState(false);
 const conversationId=useRef<string|undefined>(undefined);
 const actionController=useRef<AbortController|null>(null);
 const controller=useRef<AbortController|null>(null),input=useRef<HTMLTextAreaElement>(null),launcher=useRef<HTMLButtonElement>(null),latest=useRef<HTMLDivElement>(null),closeButton=useRef<HTMLButtonElement>(null);
 useEffect(()=>()=>{controller.current?.abort();actionController.current?.abort();},[]);
 useEffect(()=>{if(!open)return;const pending=new AbortController();authenticatedFetch('/api/assistant',{signal:pending.signal}).then(async response=>{if(!response.ok)throw new Error('Assistant access could not be verified.');setStatus(await response.json());}).catch(err=>{if(!pending.signal.aborted)setError(err.message);});return()=>pending.abort();},[open]);
 useEffect(()=>{if(open)(status?.configured?input.current:closeButton.current)?.focus();},[open,status?.configured]);
 useEffect(()=>{if(!open)return;const escape=(event:KeyboardEvent)=>{if(event.key==='Escape'&&!document&&reviewDescription===undefined){event.preventDefault();close();}};window.document.addEventListener('keydown',escape);return()=>window.document.removeEventListener('keydown',escape);},[open,document,messages,reviewDescription]);
 useEffect(()=>{latest.current?.scrollIntoView({block:'nearest'});},[messages,busy]);
 useEffect(()=>{if(!open)return;const pending=new AbortController();setNavigation({pages:[],canReviewOwnSkill:false});authenticatedFetch('/api/assistant/navigation',{signal:pending.signal}).then(async response=>{if(!response.ok)throw Error('Assistant actions could not be verified.');const body=await response.json();if(!pending.signal.aborted)setNavigation(body);}).catch(err=>{if(!pending.signal.aborted)setError(err.message);});return()=>pending.abort();},[open]);
 async function action(destination:string,kind:'open_page'|'review_own_skill',description?:string){
  if(actionBusy||busy||historyBusy)return;setActionBusy(true);setError('');setActionNotice('');
  const pending=new AbortController();actionController.current=pending;
  try{const response=await authenticatedFetch('/api/assistant/navigation',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({destination,action:kind}),signal:pending.signal});const body=await response.json();if(pending.signal.aborted)return;if(!response.ok)throw Error(body?.error?.message??'Assistant action is unavailable.');
   if(kind==='review_own_skill')setReviewDescription(description);else{navigate(body.destination);setActionNotice('Opened '+body.label+'. Your chat stays here.');}
  }catch(err){if(!pending.signal.aborted)setError(err instanceof Error?err.message:'Could not open this action.');}finally{if(actionController.current===pending){actionController.current=null;setActionBusy(false);}}
 }
 async function historyRequest(path='',method='GET'){
  const response=await authenticatedFetch('/api/assistant/conversations'+path,{method});
  const body=await response.json().catch(()=>undefined);
  if(!response.ok)throw new Error(body?.error?.message??'Chat history is unavailable. Please retry.');return body;
 }
 async function loadHistory(){setHistoryBusy(true);setError('');try{const body=await historyRequest();setChats(body.conversations);}catch(err){setError(err instanceof Error?err.message:'Could not load chats.');}finally{setHistoryBusy(false);}}
 async function resume(id:string){if(busy||historyBusy||actionBusy)return;setHistoryBusy(true);setError('');try{const body=await historyRequest('/'+id);conversationId.current=id;setMessages(body.messages);setText('');setDocument(undefined);setShowHistory(false);}catch(err){setError(err instanceof Error?err.message:'Could not open chat.');}finally{setHistoryBusy(false);}}
 async function deleteChat(id:string){if(busy||historyBusy||actionBusy)return;setHistoryBusy(true);setError('');try{await historyRequest('/'+id,'DELETE');setChats(current=>current.filter(chat=>chat.id!==id));if(conversationId.current===id){conversationId.current=undefined;setMessages([]);setText('');}}catch(err){setError(err instanceof Error?err.message:'Could not delete chat.');}finally{setHistoryBusy(false);}}
 function close(){actionController.current?.abort();if(controller.current){controller.current.abort();controller.current=null;const pending=messages.at(-1);if(pending?.role==='user'){setText(pending.content);setMessages(current=>current.at(-1)?.role==='user'?current.slice(0,-1):current);}}setBusy(false);setOpen(false);requestAnimationFrame(()=>launcher.current?.focus());}
 async function send(){
  if(busy||historyBusy||actionBusy||!text.trim()||!status?.configured)return;
  const next:ChatMessage[]=[...messages,{role:'user',content:text.trim()}];setMessages(next);setText('');setBusy(true);setError('');
  const pending=new AbortController();controller.current=pending;
  try{
   const response=await authenticatedFetch('/api/assistant',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message:next.at(-1)!.content,conversationId:conversationId.current}),signal:pending.signal});
   const body=await response.json().catch(()=>undefined);if(!response.ok)throw new Error(body?.error?.message??'AI could not reply. Please try again.');
   if(!pending.signal.aborted){conversationId.current=body.conversationId;setShowHistory(false);setMessages(current=>[...current,{role:'assistant',content:body.reply,sources:body.sources,artifact:body.artifact}]);}
  }catch(err){if(!pending.signal.aborted){setError(err instanceof Error?err.message:'Could not send message.');setText(next.at(-1)!.content);setMessages(current=>current.slice(0,-1));}}
  finally{if(controller.current===pending){setBusy(false);controller.current=null;}}
 }
 return <><button ref={launcher} className="assistant-launcher" hidden={open} aria-label="Open AI assistant" aria-expanded={open} aria-controls="assistant-panel" onClick={()=>setOpen(true)}><Bot size={25}/><span>AI</span></button>
 <div className="assistant-drawer"><section id="assistant-panel" className={'assistant-panel'+(open?' is-open':'')} role="dialog" aria-label="AI assistant" aria-hidden={!open} inert={!open}>
  <header><Bot size={20}/><div><strong>AI assistant</strong><small>Answers, drafts & learning practice</small></div><button aria-label="Recent AI chats" aria-expanded={showHistory} disabled={busy||historyBusy||actionBusy} onClick={()=>{setShowHistory(current=>!current);if(!showHistory)void loadHistory();}}><History size={17}/></button><button aria-label="New AI conversation" disabled={busy||historyBusy||actionBusy} onClick={()=>{conversationId.current=undefined;setMessages([]);setActionNotice('');setError('');setText('');setShowHistory(false);}}><RotateCcw size={17}/></button><button ref={closeButton} aria-label="Close AI assistant" onClick={close}><X size={19}/></button></header>
  {showHistory&&<section className="assistant-history" aria-label="Recent conversations"><strong>Recent chats</strong><p>Only your 2 most recent chats are kept. Each chat keeps up to 20 recent exchanges; earlier context is shortened.</p>{historyBusy&&<p role="status">Loading…</p>}{!historyBusy&&!chats.length&&<p>No saved chats yet.</p>}{chats.map(chat=><div className="assistant-history-row" key={chat.id}><button disabled={busy||historyBusy||actionBusy} aria-pressed={conversationId.current===chat.id} onClick={()=>void resume(chat.id)}><strong>{chat.title}</strong><small>{new Date(chat.updatedAt).toLocaleString()}</small></button><button disabled={busy||historyBusy||actionBusy} aria-label={'Delete chat: '+chat.title} onClick={()=>void deleteChat(chat.id)}><Trash2 size={16}/></button></div>)}</section>}
  <div className="assistant-messages" role="log" aria-live="polite">{!status&&!error&&<p>Checking connection…</p>}{status&&!status.configured&&<div className="assistant-empty"><Bot size={28}/><strong>Model connection pending</strong><p>The assistant is integrated. Connect a model on the server to start chatting.</p></div>}{status?.configured&&!messages.length&&<div className="assistant-empty"><strong>How can I help?</strong><p>Ask for guidance on features available to you, or prepare learning practice.</p></div>}{messages.map((message,index)=><div key={index} className={'assistant-message '+message.role}><small>{message.role==='user'?'You':'Assistant'}</small>{message.role==='assistant'?<AssistantRichText>{message.content}</AssistantRichText>:<p>{message.content}</p>}{message.artifact&&<AssistantOutput artifact={message.artifact} onReview={navigation.canReviewOwnSkill?description=>void action('/my-skills','review_own_skill',description):undefined} onDocument={content=>setDocument({content,sources:message.sources})}/>} {message.sources?.map((source,i)=><small className="assistant-source" key={i}>{source.label}</small>)}{message.role==="assistant"&&<div className="assistant-output-actions">{assistantNavigationTargets(message.content,message.sources??[],navigation.pages).map(page=><button key={page.url} type="button" className="secondary-button" disabled={actionBusy||busy||historyBusy} onClick={()=>void action(page.url,"open_page")}>Open {page.label}</button>)}</div>}</div>)}{busy&&<p role="status">Thinking…</p>}<div ref={latest}/></div>
  {actionNotice&&<p className="assistant-action-notice" role="status">{actionNotice}</p>}{error&&<p className="assistant-error" role="alert">{error}</p>}
  <form onSubmit={event=>{event.preventDefault();void send();}}><label className="sr-only" htmlFor="assistant-message">Message AI assistant</label><textarea id="assistant-message" ref={input} value={text} maxLength={2000} rows={2} placeholder="Ask a question…" disabled={!status?.configured||busy||historyBusy||actionBusy} onChange={event=>setText(event.target.value)} onKeyDown={event=>{if(event.key==='Enter'&&!event.shiftKey&&!event.nativeEvent.isComposing){event.preventDefault();void send();}}}/><button aria-label="Send AI message" disabled={busy||historyBusy||actionBusy||!text.trim()||!status?.configured}><Send size={18}/></button></form>
 </section></div>{document&&<AssistantDocument document={document} onClose={()=>setDocument(undefined)}/>} {reviewDescription!==undefined&&<MySkills reviewRequest={{description:reviewDescription,onClose:()=>setReviewDescription(undefined),onSaved:()=>{setReviewDescription(undefined);setActionNotice("Skill draft saved. It remains unverified.");}}}/>}</>;
}
