import {AccessError} from '../../shared/errors.js';
interface Item {id:string;at:string;title:string;body:string;href:string}
export async function loadNotificationFeed(base:{personId:string;items:Item[]},sources:{name:string;load:()=>Promise<Item[]>}[]){
 const results=await Promise.allSettled(sources.map(source=>Promise.resolve().then(source.load)));
 const items=[...base.items],failedSources:string[]=[];
 results.forEach((result,index)=>{
  if(result.status==='fulfilled')items.push(...result.value);
  else {
   // A changed permission is not a transient failure. Do not return stale data.
   if(result.reason instanceof AccessError&&[401,403].includes(result.reason.status))throw result.reason;
   failedSources.push(sources[index].name);
  }
 });
 return {...base,items:items.sort((a,b)=>b.at.localeCompare(a.at)).slice(0,30),partial:failedSources.length>0,failedSources};
}
