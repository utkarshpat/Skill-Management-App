import {Link} from 'react-router';
import {Compass,UserRound} from 'lucide-react';

export const administrationShellFor=(pathname:string,administration:boolean)=>pathname==='/access'||administration;
export const personalPageTitle=(pathname:string|undefined)=>pathname==='/my-skills'?'My skills':pathname==='/profile'?'My profile':pathname==='/skills'?'Skill catalogue':pathname==='/workspace'?'My workspace':undefined;

export function PersonalCapabilityNavigation({capabilities,pathname,onNavigate}:{capabilities?:{ownProfile:boolean;ownSkills:boolean};pathname?:string;onNavigate:()=>void}){
 if(!capabilities||(!capabilities.ownProfile&&!capabilities.ownSkills))return null;
 return <><p className="nav-caption">MY CAPABILITY</p><nav aria-label="Personal capability sections">
  {capabilities.ownProfile&&<Link className="workspace-nav-link" to="/profile" onClick={onNavigate} aria-current={pathname==='/profile'?'page':undefined}><UserRound size={19}/>My profile</Link>}
  {capabilities.ownSkills&&<Link className="workspace-nav-link" to="/my-skills" onClick={onNavigate} aria-current={pathname==='/my-skills'?'page':undefined}><Compass size={19}/>My skills</Link>}
 </nav></>;
}
