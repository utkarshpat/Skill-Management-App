// A display preference only. It never supplies links or grants access.
export const DEFAULT_SIDEBAR_ORDER=['dashboard','learning','my-skills','skill-reviews','requests','skills','organization','people','roles','assignments','audit','administration','profile'] as const;
const known=new Set<string>(DEFAULT_SIDEBAR_ORDER);
export function normalizeSidebarOrder(value:unknown):string[]{
 const saved=Array.isArray(value)&&value.length<=30?value.filter((id):id is string=>typeof id==='string'&&known.has(id)):[];
 return [...new Set([...saved,...DEFAULT_SIDEBAR_ORDER])].filter(id=>id!=='profile').concat('profile');
}
export function orderSidebarItems<T extends {id:string}>(items:T[],preference:unknown):T[]{
 const ranks=normalizeSidebarOrder(preference);
 return [...items].sort((a,b)=>ranks.indexOf(a.id)-ranks.indexOf(b.id));
}
export function moveSidebarItem(preference:unknown,visibleIds:string[],source:string,target:string):string[]{
 const full=normalizeSidebarOrder(preference),visible=new Set(visibleIds.filter(id=>known.has(id)&&id!=='profile'));
 const shown=full.filter(id=>visible.has(id)),from=shown.indexOf(source),to=shown.indexOf(target);
 if(from<0||to<0||from===to)return full;
 shown.splice(to,0,...shown.splice(from,1));let index=0;
 return full.map(id=>visible.has(id)?shown[index++]:id);
}
export function sidebarStorageKey(actorId:string){return 'cil.sidebar-order.v1:'+encodeURIComponent(actorId);}
export function readSidebarOrder(storage:Pick<Storage,'getItem'>|undefined,actorId:string):string[]{
 try{const raw=actorId?storage?.getItem(sidebarStorageKey(actorId)):null;return normalizeSidebarOrder(raw&&raw.length<=2000?JSON.parse(raw):undefined);}catch{return normalizeSidebarOrder(undefined);}
}
export function saveSidebarOrder(storage:Pick<Storage,'setItem'>|undefined,actorId:string,order:unknown):boolean{
 if(!storage||!actorId)return false;
 try{storage.setItem(sidebarStorageKey(actorId),JSON.stringify(normalizeSidebarOrder(order)));return true;}catch{return false;}
}
