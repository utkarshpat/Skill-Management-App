import {SidebarNavigation} from './SidebarNavigation';
import {BookOpen,Compass,ShieldCheck,UserRound} from 'lucide-react';

export const administrationShellFor=(pathname:string,administration:boolean)=>pathname==='/access'||administration;
export const personalPageTitle=(pathname:string|undefined)=>pathname==='/requests'?'Requests & incidents':pathname==='/learning'?'Learning & development':pathname==='/skill-reviews'?'Skill reviews':pathname==='/my-skills'?'My skills':pathname==='/profile'?'My profile':pathname==='/skills'?'Skill catalogue':pathname==='/workspace'?'My workspace':undefined;
export const catalogueRouteAllowed=(capabilities:{catalogue?:boolean}|undefined)=>capabilities?.catalogue===true;
export const catalogueNavigationVisible=(capabilities:{catalogue?:boolean;manageCatalogue?:boolean;reviewSkills?:boolean}|undefined)=>Boolean(capabilities?.catalogue&&(capabilities.manageCatalogue||capabilities.reviewSkills));
export const isSupportedWorkspacePath=(pathname:string)=>['/','/access','/workspace','/profile','/my-skills','/skills','/skill-reviews','/learning','/requests','/preview','/knowledgetransfer'].includes(pathname);

export interface PersonalNavigationCapabilities {ownProfile:boolean;ownSkills:boolean;reviewSkills?:boolean;learning?:boolean;requests?:boolean}
export function personalNavigationItems(capabilities?:PersonalNavigationCapabilities,pathname?:string){
 if(!capabilities)return [];
 return [
  ...(capabilities.learning?[{id:'learning',label:'Learn & Grow',href:'/learning',icon:BookOpen}]:[]),
  ...(capabilities.ownSkills?[{id:'my-skills',label:'My skills',href:'/my-skills',icon:Compass}]:[]),
  ...(capabilities.reviewSkills?[{id:'skill-reviews',label:'Skill reviews',href:'/skill-reviews',icon:ShieldCheck}]:[]),
  ...(capabilities.requests?[{id:'requests',label:'Requests',href:'/requests',icon:ShieldCheck}]:[]),
  ...(capabilities.ownProfile?[{id:'profile',label:'My profile',href:'/profile',icon:UserRound}]:[]),
 ].map(item=>({...item,active:pathname===item.href}));
}
export function PersonalCapabilityNavigation({capabilities,pathname,onNavigate}:{capabilities?:PersonalNavigationCapabilities;pathname?:string;onNavigate:()=>void}){
 const items=personalNavigationItems(capabilities,pathname);if(!items.length)return null;
 return <><p className="nav-caption">MY CAPABILITY</p><SidebarNavigation items={items} label="Personal capability sections" onNavigate={onNavigate}/></>;
}
