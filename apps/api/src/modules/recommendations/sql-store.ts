import sql from 'mssql';
import {withRuntimeDatabase} from '../../shared/database.js';
import {AccessError} from '../../shared/errors.js';
import type {RecommendationStore,SendRecommendation,RecommendationResponse} from './recommendations.js';
export class SqlRecommendationStore implements RecommendationStore {
 constructor(private accountId:string){}
 private async run(actor:string,action:string,payload:object={}){try{return await withRuntimeDatabase(pool=>pool.request().input('account_id',sql.UniqueIdentifier,this.accountId).input('actor_id',sql.UniqueIdentifier,actor).input('action',sql.VarChar(20),action).input('payload',sql.NVarChar(sql.MAX),JSON.stringify(payload)).execute('dbo.LearningRecommendations'));}catch(e){const n=(e as {number?:number}).number;if(n===51003)throw new AccessError(403,'Current access or reporting relationship does not allow this action.');if(n===51004)throw new AccessError(404,'This recommendation, person or published skill is unavailable.');if(n===51009||n===2627||n===2601)throw new AccessError(409,'This record changed or was already saved. Reload before retrying.');if(n===51000||n===51010)throw new AccessError(400,'Check the recommendation, current state and learning schedule.');throw e;}}
 async read(actor:string,view:'received'|'sent',page:number,id?:string){const r=await this.run(actor,'LIST',{view,page,id});const sets=r.recordsets as unknown as sql.IRecordSet<Record<string,unknown>>[];return {...sets[0][0],page,pageSize:20,items:sets[1].map(row=>({...row,id:String(row.id).toLowerCase(),personId:String(row.personId).toLowerCase(),senderId:String(row.senderId).toLowerCase(),skillId:String(row.skillId).toLowerCase(),planId:row.planId?String(row.planId).toLowerCase():undefined}))};}
 async options(actor:string,search:string){const r=await this.run(actor,'OPTIONS',{search});return {people:r.recordset.map(row=>({...row,id:String(row.id).toLowerCase()}))};}
 async send(actor:string,input:SendRecommendation){await this.run(actor,'SEND',input);return {saved:true,id:input.id};}
 async respond(actor:string,input:RecommendationResponse){await this.run(actor,input.action,input);return {saved:true,planId:input.plan?.id};}
 async notifications(actor:string){const r=await this.run(actor,'NOTIFICATIONS');return r.recordset.map((row:{id:string;at:Date;title:string;body:string;href:string})=>({...row,href:row.href.toLowerCase(),at:row.at.toISOString()}));}
}
