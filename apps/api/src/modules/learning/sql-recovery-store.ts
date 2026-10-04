import sql from 'mssql';
import {withRuntimeDatabase} from '../../shared/database.js';
import {AccessError} from '../../shared/errors.js';
import type {RecoveryPreview,RecoveryStore} from './recovery.js';
export class SqlRecoveryStore implements RecoveryStore {
 constructor(private accountId:string){}
 async apply(actor:string,preview:RecoveryPreview){try{await withRuntimeDatabase(pool=>pool.request().input('account_id',sql.UniqueIdentifier,this.accountId).input('actor_id',sql.UniqueIdentifier,actor).input('plan_id',sql.UniqueIdentifier,preview.planId).input('expected_revision',sql.Int,preview.revision).input('payload',sql.NVarChar(sql.MAX),JSON.stringify({dailyMinutes:preview.dailyMinutes,targetDate:preview.targetDate,startDate:preview.startDate,tasks:preview.tasks.map(t=>({id:t.id,plannedDate:t.newDate}))})).execute('dbo.RecoverOwnLearningPlan'));}catch(error){const number=(error as {number?:number}).number;if(number===51003)throw new AccessError(403,'Your current permissions do not allow recovery.');if(number===51004)throw new AccessError(404,'This learning plan is unavailable.');if(number===51009)throw new AccessError(409,'The plan changed. Review a fresh recovery schedule.');if(number===51000||number===51010)throw new AccessError(400,'Check the recovery dates, capacity and active plan status.');throw error;}}
}
