import type {Profile} from './profile.js';
export function profileCompleteness(profile:Profile){
 if(profile.jobTitle===undefined||profile.grade===undefined||profile.primaryCapabilityId===undefined||!profile.organizationDetails)return {available:false as const};
 const fields=[
  {key:'name',label:'Full name',complete:Boolean(profile.displayName.trim())},
  {key:'employeeCode',label:'Employee ID',complete:Boolean(profile.employeeCode.trim())},
  {key:'jobTitle',label:'Business job title',complete:Boolean(profile.jobTitle?.trim())},
  {key:'grade',label:'Grade',complete:Boolean(profile.grade?.trim())},
  {key:'primaryCapability',label:'Primary capability',complete:Boolean(profile.primaryCapabilityId&&profile.primaryCapabilityStatus==='PUBLISHED')},
  {key:'department',label:'Department',complete:profile.organizationDetails.placementStatus==='ASSIGNED'&&Boolean(profile.organizationDetails.department)},
 ];
 const completed=fields.filter(f=>f.complete).length;
 return {available:true as const,completed,total:fields.length,percent:Math.round(completed/fields.length*100),fields};
}
