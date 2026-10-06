import {AccessError} from '../../shared/errors.js';
import {can,type AccessStore,type LocalAccessState} from './local-access-store.js';
export interface PrimaryCapability {id:string;name:string;category:string;status:'PUBLISHED'|'DRAFT'|'ARCHIVED'}
export interface PrimaryCapabilityDetails {primaryCapabilityId?:string|null;primaryCapabilityName?:string|null;primaryCapabilityStatus?:PrimaryCapability['status']|null}
export interface PrimaryCapabilityPage {items:PrimaryCapability[];total:number;page:number;pageSize:number}
function capabilityId(value:unknown):string|null{
 if(value===null||value==='')return null;
 if(typeof value!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value))throw new AccessError(400,'Choose a valid capability from this workspace.');
 return value.toLowerCase();
}
export function primaryCapabilityDetails(body:Record<string,unknown>,previous?:PrimaryCapabilityDetails):PrimaryCapabilityDetails {
 const id=body.primaryCapabilityId===undefined?previous?.primaryCapabilityId??null:capabilityId(body.primaryCapabilityId);
 return {primaryCapabilityId:id,primaryCapabilityName:id&&id===previous?.primaryCapabilityId?previous.primaryCapabilityName??null:null,primaryCapabilityStatus:id&&id===previous?.primaryCapabilityId?previous.primaryCapabilityStatus??null:null};
}
export function primaryCapabilityQuery(query:Record<string,unknown>){
 if(Object.keys(query).some(key=>!['search','page'].includes(key)))throw new AccessError(400,'Unsupported capability filter.');
 const search=query.search??'',page=query.page===undefined?1:Number(query.page);
 if(typeof search!=='string'||search.length>100||!Number.isSafeInteger(page)||page<1||page>100000)throw new AccessError(400,'Enter a search of up to 100 characters and a valid page.');
 return {search:search.trim(),page};
}
export async function validatePrimaryCapabilityChange(store:AccessStore,state:LocalAccessState,actorId:string,input:unknown):Promise<PrimaryCapabilityDetails|undefined>{
 if(!input||typeof input!=='object')return undefined;
 const body=input as Record<string,unknown>;
 if(body.kind!=='person')return undefined;
 const actor=state.people.find(p=>p.id===actorId);
 if(!actor||!can(state,actor,'permissions.manage')||!can(state,actor,'users.manage'))throw new AccessError(403,'People and access administration are required.');
 const previous=state.people.find(p=>p.id===body.id),details=primaryCapabilityDetails(body,previous);
 if(!details.primaryCapabilityId||details.primaryCapabilityId===previous?.primaryCapabilityId)return details;
 if(!store.primaryCapabilities)throw new AccessError(503,'Primary capability selection requires the Azure SQL catalogue.');
 const result=await store.primaryCapabilities(actorId,{search:'',page:1,id:details.primaryCapabilityId});
 const selected=result.items.find(item=>item.id===details.primaryCapabilityId&&item.status==='PUBLISHED');
 if(!selected)throw new AccessError(400,'Choose a currently published capability from this workspace.');
 return {primaryCapabilityId:selected.id,primaryCapabilityName:selected.name,primaryCapabilityStatus:selected.status};
}
