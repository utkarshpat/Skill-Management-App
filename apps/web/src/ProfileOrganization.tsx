import {Building2} from 'lucide-react';

export interface ProfileOrganizationDetails {
 workspace:string;
 placementStatus:'ASSIGNED'|'NOT_ASSIGNED'|'NEEDS_ATTENTION';
 deliveryUnit:string|null;department:string|null;team:string|null;
 managerStatus:'ASSIGNED'|'NOT_ASSIGNED'|'NEEDS_ATTENTION';managerName:string|null;
}
export function ProfileOrganization({details,loading=false,failed=false}:{details?:ProfileOrganizationDetails;loading?:boolean;failed?:boolean}){
 const placement=details?.placementStatus,reporting=details?.managerStatus;
 const placementValue=placement==='NEEDS_ATTENTION'?'Needs administrator attention':'Not assigned';
 const managerValue=reporting==='ASSIGNED'?details?.managerName:reporting==='NEEDS_ATTENTION'?'Needs administrator attention':'Not assigned';
 const managerInitials=details?.managerName?details.managerName.trim().split(/\s+/).slice(0,2).map(n=>n[0]).join(''):'';
 return <section className="profile-information profile-organization" aria-label="Organization and reporting" aria-busy={loading}>
  <header><span className="profile-card-icon"><Building2 size={19} aria-hidden="true"/></span><div><h3>Organization & reporting</h3><p className="profile-card-subtitle">Assigned organizational unit and direct manager</p></div></header>
  {loading?<p role="status">Loading your organization details...</p>:!details?<p>{failed?'Organization details could not be loaded. Use Retry above to reload your profile.':'Organization details are unavailable for this profile.'}</p>:<>
   <dl className="profile-info-grid">
    <div className="profile-info-tile"><dt>Delivery unit</dt><dd>{placement==='ASSIGNED'?<span className="profile-unit-tag">{details.deliveryUnit}</span>:placementValue}</dd></div>
    <div className="profile-info-tile"><dt>Department</dt><dd>{placement==='ASSIGNED'?<span className="profile-dept-tag">{details.department}</span>:placementValue}</dd></div>
    <div className="profile-info-tile"><dt>Team</dt><dd>{placement==='ASSIGNED'?(details.team?<span className="profile-team-tag">{details.team}</span>:<span className="profile-neutral-tag">No team assigned</span>):placementValue}</dd></div>
    <div className="profile-info-tile"><dt>Reporting manager</dt><dd>{reporting==='ASSIGNED'&&details.managerName?<span className="profile-manager-chip"><span className="manager-chip-avatar" aria-hidden="true">{managerInitials}</span><span className="manager-chip-name">{details.managerName}</span></span>:managerValue}</dd></div>
   </dl>
   {(placement==='NEEDS_ATTENTION'||reporting==='NEEDS_ATTENTION')&&<p className="profile-placement-warning">An assignment is inactive or inconsistent. Ask your access administrator to check it.</p>}
   {placement==='NOT_ASSIGNED'&&<p>Your department or team has not been assigned yet. Ask your access administrator to update your placement.</p>}
   <p className="profile-organization-policy">These are your current stored assignments, not access grants. Available actions follow your effective permissions.</p>
  </>}
 </section>;
}
