import {Link} from 'react-router';
import {ShieldCheck,UserRound,Compass,BookOpen,MessageSquare,Briefcase,ArrowRight} from 'lucide-react';
import type {WorkspaceState} from './Workspace';
import {ProfileOrganization,type ProfileOrganizationDetails} from './ProfileOrganization';
import {EmploymentSummary,type Employment} from './EmploymentDetails';
import {ProfileCompleteness,type ProfileCompletenessDetails} from './ProfileCompleteness';

export interface Profile extends Employment {
 id:string;
 displayName:string;
 employeeCode:string;
 organization:string;
 status:string;
 roles:string[];
 organizationDetails?:ProfileOrganizationDetails;
 completeness?:ProfileCompletenessDetails;
}

export function ProfileDetails({workspace,profile,failed=false}:{workspace:WorkspaceState;profile?:Profile;failed?:boolean}){
 const person=profile??workspace.person,initials=person.displayName.trim().split(/\s+/).slice(0,2).map(part=>part[0]).join('');
 const demo=workspace.authentication==='local-demo';
 const isActive=profile?.status==='ACTIVE';

 return <div className="personal-profile-page">
  <section className="profile-hero">
   <div className="profile-hero-content">
    <div className="profile-identity">
     <div className="profile-avatar-wrapper">
      <span className="profile-avatar" aria-hidden="true">{initials}</span>
      {isActive&&<span className="profile-avatar-status" title="Active account"><span className="status-dot-pulse"/></span>}
     </div>
     <div className="profile-identity-details">
      <div className="profile-name-row">
       <h2>{person.displayName}</h2>
       <span className="profile-auth-badge"><ShieldCheck size={16}/>{demo?'Demo account':'Microsoft account'}</span>
      </div>
      <div className="profile-meta-chips">
       <span className="profile-meta-chip code-chip">ID: {person.employeeCode}</span>
       {isActive&&<span className="profile-meta-chip status-chip"><span className="status-dot"/>Active</span>}
      </div>
     </div>
    </div>
   </div>
  </section>

  <div className="personal-profile-grid">
   <div className="profile-column-primary">
    <section className="profile-information">
     <header>
      <span className="profile-card-icon"><UserRound size={19}/></span>
      <div>
       <h3>Work identity</h3>
       <p className="profile-card-subtitle">Assigned workspace and account details</p>
      </div>
     </header>
     <dl className="profile-info-grid">
      <div className="profile-info-tile"><dt>Employee ID</dt><dd><span className="profile-id-badge">{person.employeeCode}</span></dd></div>
      <div className="profile-info-tile"><dt>Workspace</dt><dd>{profile?.organization??(failed?'Unavailable':'Loading workspace details…')}</dd></div>
      <div className="profile-info-tile"><dt>Account status</dt><dd>{profile?.status==='ACTIVE'?<span className="profile-active-pill"><span className="status-dot"/>Active</span>:profile?.status??(failed?'Unavailable':'Checking…')}</dd></div>
      <div className="profile-info-tile"><dt>Sign-in session</dt><dd><span className="profile-auth-method">{demo?'Temporary demo session':'Microsoft'}</span></dd></div>
     </dl>
    </section>

    <ProfileOrganization details={profile?.organizationDetails} loading={!profile&&!failed} failed={failed}/>

    <section className="profile-information">
     <header>
      <span className="profile-card-icon"><Briefcase size={19}/></span>
      <div>
       <h3>Business role</h3>
       <p className="profile-card-subtitle">Organizational role designation</p>
      </div>
     </header>
     <EmploymentSummary value={profile} loading={!profile&&!failed} failed={failed}/>
    </section>
   </div>

   <div className="profile-column-secondary">
    <ProfileCompleteness details={profile?.completeness} loading={!profile&&!failed} failed={failed} canRequest={workspace.capabilities.requestProfileCorrection}/>
    <section className="profile-information">
     <header>
      <span className="profile-card-icon"><ShieldCheck size={19}/></span>
      <div>
       <h3>Access & governance</h3>
       <p className="profile-card-subtitle">Assigned access templates and security scope</p>
      </div>
     </header>
     <dl className="profile-info-grid single-col">
      <div className="profile-info-tile full-width"><dt>Access templates</dt><dd className="profile-role-tags">{person.roles.length?person.roles.map(role=><span key={role} className="profile-role-pill"><ShieldCheck size={13}/>{role}</span>):<span className="profile-no-roles">No access templates assigned</span>}</dd></div>
     </dl>
     <div className="profile-policy-notice"><p>These templates describe access, not your job title or grade. Available actions follow your effective permissions and scope.</p></div>
    </section>

    <section className="profile-information profile-destinations">
     <header>
      <span className="profile-card-icon"><MessageSquare size={19}/></span>
      <div>
       <h3>Profile actions</h3>
       <p className="profile-card-subtitle">Manage record updates and related areas</p>
      </div>
     </header>
     {workspace.capabilities.requestProfileCorrection&&<div className="profile-correction-banner"><div className="profile-correction-info"><strong>Need an update or noticed an error?</strong><p>Profile details are maintained by administrators. Submit an update request.</p></div><Link to="/requests?action=create" className="profile-correction-btn"><span>Request a profile correction</span><ArrowRight size={15}/></Link></div>}
     {(workspace.capabilities.ownSkills||workspace.capabilities.learning)&&<div className="profile-related-links" aria-label="Related workspace areas"><span className="profile-related-label">Related workspace:</span>{workspace.capabilities.ownSkills&&<Link to="/my-skills" className="profile-related-chip"><Compass size={14}/><span>My skills</span></Link>}{workspace.capabilities.learning&&<Link to="/learning" className="profile-related-chip"><BookOpen size={14}/><span>Learn & Grow</span></Link>}</div>}
    </section>
   </div>
  </div>
 </div>;
}
