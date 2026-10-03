export interface DemoPerson {id:string;displayName:string;employeeCode:string;roles:string[]}
export type DemoLoginState =
  | {status:'disabled';people:DemoPerson[];signedIn:false}
  | {status:'error';people:DemoPerson[];signedIn:false}
  | {status:'available';people:DemoPerson[];signedIn:boolean;requiresAccessCode?:boolean};

export function parseDemoLogin(data: any): Extract<DemoLoginState,{status:'available'}> {
  if(data?.mode!=='local-demo'||typeof data.signedIn!=='boolean'||(data.requiresAccessCode!==undefined&&typeof data.requiresAccessCode!=='boolean')||!Array.isArray(data.people)||data.people.some((person:DemoPerson)=>!person||['id','displayName','employeeCode'].some(key=>typeof person[key as keyof DemoPerson]!=='string'||!person[key as keyof DemoPerson])||!Array.isArray(person.roles)||person.roles.some(role=>typeof role!=='string')))throw new Error('Invalid development login response');
  return {status:'available',people:data.people,signedIn:data.signedIn,...(data.requiresAccessCode!==undefined?{requiresAccessCode:data.requiresAccessCode}:{})};
}

// A missing endpoint means disabled. Transport/service failures must never be
// interpreted as disabled or as an authenticated development session.
export async function discoverDevelopmentLogin(transport:typeof fetch=fetch,delay:()=>Promise<void>=()=>new Promise(resolve=>setTimeout(resolve,300))):Promise<DemoLoginState> {
  for(let attempt=0;attempt<2;attempt++) {
    try{
      const response=await transport('/api/dev-login',{cache:'no-store',signal:AbortSignal.timeout(15000)});
      if(response.status===404)return {status:'disabled',people:[],signedIn:false};
      if(!response.ok)throw new Error('Development login unavailable');
      const data=await response.json();
      return parseDemoLogin(data);
    }catch{if(attempt===0)await delay();}
  }
  return {status:'error',people:[],signedIn:false};
}
