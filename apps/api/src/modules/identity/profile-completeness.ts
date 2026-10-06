import type {Profile} from './profile.js';
export interface ProfileChecklistItem {key:string;label:string;state:'COMPLETE'|'MISSING'|'NEEDS_ATTENTION'|'UNAVAILABLE'}
export interface ProfileCompleteness {filled:number;total:number;status:'COMPLETE'|'INCOMPLETE'|'UNAVAILABLE';items:ProfileChecklistItem[]}
export function profileCompleteness(profile:Profile):ProfileCompleteness {
 const text=(value:string|null|undefined):ProfileChecklistItem['state']=>value===undefined?'UNAVAILABLE':value?.trim()?'COMPLETE':'MISSING';
 const organization=profile.organizationDetails;
 const items:ProfileChecklistItem[]=[
  {key:'name',label:'Full name',state:text(profile.displayName)},
  {key:'employeeCode',label:'Employee ID',state:text(profile.employeeCode)},
  {key:'jobTitle',label:'Business job title',state:text(profile.jobTitle)},
  {key:'grade',label:'Grade',state:text(profile.grade)},
  {key:'department',label:'Department',state:!organization?'UNAVAILABLE':organization.placementStatus==='NEEDS_ATTENTION'?'NEEDS_ATTENTION':organization.placementStatus==='ASSIGNED'?text(organization.department):'MISSING'},
  {key:'primaryCapability',label:'Primary capability',state:profile.primaryCapabilityId===undefined?'UNAVAILABLE':!profile.primaryCapabilityId?'MISSING':profile.primaryCapabilityStatus==='PUBLISHED'&&profile.primaryCapabilityName?.trim()?'COMPLETE':'NEEDS_ATTENTION'},
 ];
 const filled=items.filter(item=>item.state==='COMPLETE').length;
 return {filled,total:items.length,status:items.some(item=>item.state==='UNAVAILABLE')?'UNAVAILABLE':filled===items.length?'COMPLETE':'INCOMPLETE',items};
}
