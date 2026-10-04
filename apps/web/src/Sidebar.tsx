import { useEffect, useRef, type ReactNode } from 'react';

export function Sidebar({children,className=''}:{children:ReactNode;className?:string}) {
  const sidebar=useRef<HTMLElement>(null);
  useEffect(()=>{
    const element=sidebar.current;if(!element)return;
    // Even a sidebar shorter than its viewport must not scroll the document.
    const wheel=(event:WheelEvent)=>{
      if(event.ctrlKey||!event.deltaY)return;
      const scroll=element.querySelector<HTMLElement>('.sidebar-scroll')??element;
      const atTop=scroll.scrollTop<=0,atBottom=scroll.scrollTop+scroll.clientHeight>=scroll.scrollHeight-1;
      if(!(event.target instanceof Node)||!scroll.contains(event.target)){event.preventDefault();return;}
      if((event.deltaY<0&&atTop)||(event.deltaY>0&&atBottom))event.preventDefault();
    };
    element.addEventListener('wheel',wheel,{passive:false});
    return()=>element.removeEventListener('wheel',wheel);
  },[]);
  return <aside ref={sidebar} className={'admin-sidebar '+className}>{children}</aside>;
}
