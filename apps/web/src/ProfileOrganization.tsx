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
 return <section className="profile-information profile-organization" aria-label="Organization and reporting" aria-busy={loading}>
  <header><Building2 size={20} aria-hidden="true"/><h3>Organization & reporting</h3></header>
  {loading?<p role="status">Loading your organization details...</p>:!details?<p>{failed?'Organization details could not be loaded. Use Retry above to reload your profile.':'Organization details are unavailable for this profile.'}</p>:<>
   <dl>
    <div><dt>Delivery unit</dt><dd>{placement==='ASSIGNED'?details.deliveryUnit:placementValue}</dd></div>
    <div><dt>Department</dt><dd>{placement==='ASSIGNED'?details.department:placementValue}</dd></div>
    <div><dt>Team</dt><dd>{placement==='ASSIGNED'?details.team??'No team assigned':placementValue}</dd></div>
    <div><dt>Reporting manager</dt><dd>{managerValue}</dd></div>
   </dl>
   {(placement==='NEEDS_ATTENTION'||reporting==='NEEDS_ATTENTION')&&<p className="profile-placement-warning">An assignment is inactive or inconsistent. Ask your access administrator to check it.</p>}
   {placement==='NOT_ASSIGNED'&&<p>Your department or team has not been assigned yet. Ask your access administrator to update your placement.</p>}
   <p className="profile-organization-policy">These are your current stored assignments, not access grants. Available actions follow your effective permissions.</p>
  </>}
 </section>;
}
