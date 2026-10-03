import sql from 'mssql';
import { withRuntimeDatabase } from '../../shared/database.js';
import { AccessError } from '../../shared/errors.js';
import { claimChange, claimTransition, type ClaimsStore, type ClaimState, type ClaimOptions, type SkillClaim, type ClaimOption } from './claims.js';

export class SqlClaimsStore implements ClaimsStore {
  constructor(private accountId: string) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(accountId)) throw new Error('Claims require a workspace UUID.');
  }
  async read(actorId: string, page: number): Promise<ClaimState> {
    try {
      return await withRuntimeDatabase(async pool => {
        const result = await pool.request().input('account_id',sql.UniqueIdentifier,this.accountId).input('actor_id',sql.UniqueIdentifier,actorId).input('page',sql.Int,page).execute('dbo.ReadOwnSkillClaims');
        const sets = result.recordsets as unknown as [sql.IRecordSet<{ total:number; canClaim:boolean }>,sql.IRecordSet<Omit<SkillClaim,'updatedAt'> & { updatedAt:Date }>];
        return { ...sets[0][0], page, pageSize:25, claims:sets[1].map(item=>({...item,id:item.id.toLowerCase(),skillId:item.skillId.toLowerCase(),updatedAt:item.updatedAt.toISOString()})) };
      });
    } catch(error) { throw claimError(error); }
  }
  async options(actorId: string, search: string, page: number): Promise<ClaimOptions> {
    try {
      return await withRuntimeDatabase(async pool => {
        const result = await pool.request().input('account_id',sql.UniqueIdentifier,this.accountId).input('actor_id',sql.UniqueIdentifier,actorId).input('query',sql.NVarChar(100),search).input('page',sql.Int,page).execute('dbo.ReadClaimSkills');
        const sets = result.recordsets as unknown as [sql.IRecordSet<{total:number}>,sql.IRecordSet<Omit<ClaimOption,'levels'>>,sql.IRecordSet<ClaimOption['levels'][number] & {skillId:string}>];
        return {total:sets[0][0].total,page,pageSize:25,skills:sets[1].map(item=>({...item,id:item.id.toLowerCase(),levels:sets[2].filter(level=>level.skillId===item.id).map(({rank,name,description})=>({rank,name,description}))}))};
      });
    } catch(error) { throw claimError(error); }
  }
  async save(actorId: string, input: unknown) {
    const change = claimChange(input);
    try {
      await withRuntimeDatabase(pool=>pool.request().input('account_id',sql.UniqueIdentifier,this.accountId).input('actor_id',sql.UniqueIdentifier,actorId)
        .input('claim_id',sql.UniqueIdentifier,change.id).input('expected_revision',sql.Int,change.revision)
        .input('payload',sql.NVarChar(sql.MAX),JSON.stringify(change)).execute('dbo.SaveOwnSkillClaim'));
    } catch(error) { throw claimError(error); }
  }
  async transition(actorId:string,input:ReturnType<typeof claimTransition>){
    const change=claimTransition(input);
    try{await withRuntimeDatabase(pool=>pool.request().input('account_id',sql.UniqueIdentifier,this.accountId).input('actor_id',sql.UniqueIdentifier,actorId).input('claim_id',sql.UniqueIdentifier,change.id).input('expected_revision',sql.Int,change.revision).input('action',sql.VarChar(20),change.action).input('feedback',sql.NVarChar(2000),change.feedback).execute('dbo.TransitionSkillClaim'));}catch(error){throw claimError(error);}
  }
  async reviews(actorId:string,page:number):Promise<ClaimState>{
    try{return await withRuntimeDatabase(async pool=>{const result=await pool.request().input('account_id',sql.UniqueIdentifier,this.accountId).input('actor_id',sql.UniqueIdentifier,actorId).input('page',sql.Int,page).execute('dbo.ReadAssignedSkillReviews');const sets=result.recordsets as unknown as [sql.IRecordSet<{total:number;canClaim:boolean}>,sql.IRecordSet<Omit<SkillClaim,'updatedAt'>&{updatedAt:Date}>];return {...sets[0][0],page,pageSize:25,claims:sets[1].map(item=>({...item,id:item.id.toLowerCase(),skillId:item.skillId.toLowerCase(),updatedAt:item.updatedAt.toISOString()}))};});}catch(error){throw claimError(error);}
  }
  async notifications(actorId:string){return withRuntimeDatabase(async pool=>{const result=await pool.request().input('account_id',sql.UniqueIdentifier,this.accountId).input('actor_id',sql.UniqueIdentifier,actorId).execute('dbo.ReadSkillClaimNotifications');return result.recordset.map((row:{id:string;at:Date;title:string;body:string;href:string})=>({...row,at:row.at.toISOString()}));});}
}
function claimError(error: unknown) {
  const number = (error as {number?:number})?.number;
  if (number===51003) return new AccessError(403,'Your current permissions do not allow this skill action.');
  if (number===51004) return new AccessError(404,'The draft or published skill is unavailable.');
  if (number===51009) return new AccessError(409,'The draft or skill definition changed. Close the form, reload and review the current version.');
  if (number===51010) return new AccessError(409,'This claim cannot move to that status. Reload and review its current state.');
  if (number===51011) return new AccessError(409,'An active reporting manager with review permission must be assigned before submission. Ask your access administrator.');
  if (number===2601||number===2627) return new AccessError(409,'A draft for this skill already exists. Reload and edit it.');
  if (number===51000||number===547) return new AccessError(400,'Check your skill, proficiency and experience fields.');
  return error;
}
