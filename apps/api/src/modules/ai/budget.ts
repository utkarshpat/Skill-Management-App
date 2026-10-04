import {randomUUID} from 'node:crypto';
import sql from 'mssql';
import {withRuntimeDatabase} from '../../shared/database.js';
import {AccessError} from '../../shared/errors.js';
export interface AiBudget {acquire(actor:string):Promise<()=>Promise<void>>}
// Local/test fallback only. Hosted runtime injects SqlAiBudget.
export class MemoryAiBudget implements AiBudget {
 private actors=new Map<string,{minute:number;count:number;lease?:string;expires:number}>();
 private day=-1;private count=0;
 constructor(private now=Date.now){}
 async acquire(actor:string){
  const now=this.now(),minute=Math.floor(now/60000),day=Math.floor(now/86400000);
  if(day!==this.day){this.day=day;this.count=0;}
  for(const [id,entry] of this.actors)if(entry.expires<=now&&entry.minute!==minute)this.actors.delete(id);
  const prior=this.actors.get(actor);
  if(prior?.lease&&prior.expires>now)throw new AccessError(429,'A reply is already being generated.');
  const count=prior?.minute===minute?prior.count:0;
  if(count>=10||this.count>=500)throw new AccessError(429,'AI request limit reached. Please try again later.');
  const lease=randomUUID();this.count++;this.actors.set(actor,{minute,count:count+1,lease,expires:now+120000});
  return async()=>{const entry=this.actors.get(actor);if(entry?.lease===lease)entry.lease=undefined;};
 }
}
export class SqlAiBudget implements AiBudget {
 constructor(private accountId:string){}
 async acquire(actor:string){
  const lease=randomUUID();
  const run=(operation:string)=>withRuntimeDatabase(pool=>pool.request()
   .input('account_id',sql.UniqueIdentifier,this.accountId).input('actor_id',sql.UniqueIdentifier,actor)
   .input('lease_id',sql.UniqueIdentifier,lease).input('operation',sql.VarChar(8),operation).execute('dbo.AiRequestBudget'));
  try{await run('acquire');}catch(error){
   const number=(error as {number?:number}).number;
   if(number===51029)throw new AccessError(429,'AI is busy or your request limit was reached. Please try again shortly.');
   if(number===51003)throw new AccessError(403,'Assistant access is not assigned.');
   throw new AccessError(503,'AI capacity could not be checked. Please retry shortly.');
  }
  return async()=>{try{await run('release');}catch{console.warn('AI lease release failed; the bounded lease will expire.');}};
 }
}
