export interface PrimaryCapabilityDetails {primaryCapabilityId?:string|null;primaryCapabilityName?:string|null;primaryCapabilityStatus?:'PUBLISHED'|'DRAFT'|'ARCHIVED'|null}
export function primaryCapabilityLabel(value?:PrimaryCapabilityDetails){
 if(value?.primaryCapabilityId===undefined)return 'Unavailable';
 if(!value.primaryCapabilityId)return 'Not assigned';
 return value.primaryCapabilityName||value.primaryCapabilityId;
}
export function PrimaryCapabilitySummary({value,loading=false,failed=false}:{value?:PrimaryCapabilityDetails;loading?:boolean;failed?:boolean}){
 const attention=Boolean(value?.primaryCapabilityId)&&value?.primaryCapabilityStatus!=='PUBLISHED';
 return <><dl><div><dt>Primary capability</dt><dd>{loading?'Loading work details...':failed?'Unavailable':primaryCapabilityLabel(value)}{!loading&&!failed&&attention&&<span> - needs administrator attention</span>}</dd></div></dl>
 {attention&&!loading&&!failed&&<p>This selection is no longer published or its current status is unavailable. Ask a people administrator to review it; it has not been removed.</p>}
 <p>Describes your main area of work, not verified proficiency or access.</p></>;
}
