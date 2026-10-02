import { useEffect, useRef, useState, type ReactNode, type FormEvent } from 'react';
import { X } from 'lucide-react';
import { createPortal } from 'react-dom';

export interface FormPage {label:string;content:ReactNode}
export function FormDialog({title,onClose,busy=false,pages,footer,children,page:controlledPage,onPageChange,formId,onSubmit,message,readOnly=false}:{title:string;onClose:()=>void;busy?:boolean;pages?:FormPage[];footer?:ReactNode;children?:ReactNode;page?:number;onPageChange?:(page:number)=>void;formId?:string;onSubmit?:()=>void;message?:ReactNode;readOnly?:boolean}) {
 const dialog=useRef<HTMLDialogElement>(null),[localPage,setLocalPage]=useState(0);
 const page=controlledPage??localPage;
 const changePage=(next:number)=>{setLocalPage(next);onPageChange?.(next);};
 useEffect(()=>{
  const element=dialog.current;if(!element)return;
  const previous=document.activeElement as HTMLElement|null,overflow=document.body.style.overflow;
  document.body.style.overflow='hidden';element.showModal();
  const input=Array.from(element.querySelectorAll<HTMLElement>('input,select,textarea')).find(field=>!field.closest('[hidden]')&&!field.hasAttribute('disabled'));input?.focus();
  return()=>{element.close();document.body.style.overflow=overflow;if(previous?.isConnected)previous.focus();};
 },[]);
 function validate(event:FormEvent<HTMLDialogElement>){
  const form=event.target;if(!(form instanceof HTMLFormElement))return;
  const invalid=Array.from(form.elements).find(element=>(element instanceof HTMLInputElement||element instanceof HTMLSelectElement||element instanceof HTMLTextAreaElement)&&element.willValidate&&!element.validity.valid) as HTMLInputElement|HTMLSelectElement|HTMLTextAreaElement|undefined;
  if(!invalid)return;
  event.preventDefault();event.stopPropagation();
  const target=invalid.closest<HTMLElement>('[data-form-page]');if(target)changePage(Number(target.dataset.formPage));
  requestAnimationFrame(()=>{invalid.focus();invalid.reportValidity();});
 }
 const content=<>{children}{pages?.map((item,index)=><div data-form-page={index} key={index} hidden={page!==index}>{item.content}</div>)}</>;
 return createPortal(<dialog ref={dialog} className="form-dialog" data-readonly={readOnly||undefined} aria-label={title} onCancel={event=>{event.preventDefault();if(!busy)onClose();}} onSubmitCapture={validate}>
  <header className="form-dialog-header"><h2>{title}</h2><button type="button" className="catalogue-close" aria-label={`Close ${title}`} disabled={busy} onClick={onClose}><X size={20}/></button></header>
  {message&&<div className="form-dialog-message">{message}</div>}
  {pages&&pages.length>1&&<nav className="form-page-tabs" aria-label="Form sections">{pages.map((item,index)=><button type="button" key={index} disabled={busy} aria-current={page===index?'step':undefined} onClick={()=>changePage(index)}>{item.label}</button>)}</nav>}
  <div className="form-dialog-body">{formId?<form id={formId} noValidate className="access-form" onSubmit={event=>{event.preventDefault();if(!busy)onSubmit?.();}}><fieldset className="form-dialog-fields" disabled={busy}>{content}</fieldset></form>:content}</div>
  {footer&&<footer className="form-dialog-footer">{footer}</footer>}
 </dialog>,document.body);
}
