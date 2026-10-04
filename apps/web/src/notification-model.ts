import {Bell,BookOpen,ClipboardCheck,Inbox} from 'lucide-react';
export function notificationDestination(href:string){
 if(!href.startsWith('/')||href.startsWith('//')||href.includes('\\'))return undefined;
 const url=new URL(href,'https://workspace.invalid');
 const actions:Record<string,{label:string;kind:string;icon:typeof Bell}>={
 '/requests':{label:'View request',kind:'Requests',icon:Inbox},
 '/learning':{label:url.searchParams.has('recommendation')?'Open recommendation':'Open learning',kind:'Learn & Grow',icon:BookOpen},
 '/skill-reviews':{label:'Review claim',kind:'Skill reviews',icon:ClipboardCheck},
 '/my-skills':{label:'View skill claim',kind:'My skills',icon:ClipboardCheck},
 '/profile':{label:'View profile',kind:'Profile & access',icon:Bell}};
 return actions[url.pathname];
}
