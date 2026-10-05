import sql from 'mssql';
import { withRuntimeDatabase } from '../../shared/database.js';
import { AccessError } from '../../shared/errors.js';
import { claimChange, claimTransition, type ClaimsStore, type ClaimState, type ClaimOptions, type SkillClaim, type ClaimOption, type TeamCapability, type teamQuery, reviewQuery, type ReviewDetail, type OwnSkillSummary, type TopReviewedSkill } from './claims.js';

export class SqlClaimsStore implements ClaimsStore {
  async team(actorId:string,query:ReturnType<typeof teamQuery>):Promise<TeamCapability>{
    try{return await withRuntimeDatabase(async pool=>{
      const result=await pool.request().input('account_id',sql.UniqueIdentifier,this.accountId).input('actor_id',sql.UniqueIdentifier,actorId).input('query',sql.NVarChar(100),query.search).input('page',sql.Int,query.page).input('person_id',sql.UniqueIdentifier,query.person??null).execute('dbo.ReadDirectReportCapability');
      const sets=result.recordsets as unknown as [sql.IRecordSet<{total:number}>,sql.IRecordSet<TeamCapability['people'][number]>,sql.IRecordSet<TeamCapability['skills'][number]>,sql.IRecordSet<{members:number;reviewed:number;pending:number}>,sql.IRecordSet<{skillName:string;rank:number;people:number;memberIds:string}>,sql.IRecordSet<{rank:number;count:number;memberIds:string}>,sql.IRecordSet<{category:string;count:number}>];
      return {total:sets[0][0].total,page:query.page,pageSize:12,scope:'DIRECT_REPORTS',people:sets[1].map(p=>({...p,id:p.id.toLowerCase()})),skills:sets[2].map(s=>({...s,personId:s.personId.toLowerCase()})),...(sets[3]?.[0]?{analytics:{...sets[3][0],coverage:sets[4].map(row=>({...row,memberIds:row.memberIds.split(',').map(id=>id.toLowerCase())})),levels:sets[5].map(row=>({...row,memberIds:row.memberIds.split(',').map(id=>id.toLowerCase())})),categories:sets[6]}}:{})};
    });}catch(error){throw claimError(error);}
  }
  async summary(actorId:string){
    try{return await withRuntimeDatabase(async pool=>{
      const result=await pool.request().input('account_id',sql.UniqueIdentifier,this.accountId).input('actor_id',sql.UniqueIdentifier,actorId).execute('dbo.ReadOwnSkillSummary');
      const sets=result.recordsets as unknown as [sql.IRecordSet<OwnSkillSummary>,sql.IRecordSet<TopReviewedSkill>?];
      return {...sets[0][0],...(sets[1]?{topSkills:sets[1].map(skill=>({...skill,id:skill.id.toLowerCase()}))}:{})};
    });}catch(error){throw claimError(error);}
  }
  constructor(private accountId: string) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(accountId)) throw new Error('Claims require a workspace UUID.');
  }
  async read(actorId: string, page: number): Promise<ClaimState> {
    try {
      return await withRuntimeDatabase(async pool => {
        const result = await pool.request().input('account_id',sql.UniqueIdentifier,this.accountId).input('actor_id',sql.UniqueIdentifier,actorId).input('page',sql.Int,page).execute('dbo.ReadOwnSkillClaims');
        const sets = result.recordsets as unknown as [sql.IRecordSet<{ total:number; canClaim:boolean }>,sql.IRecordSet<Omit<SkillClaim,'updatedAt'> & { updatedAt:Date }>];
        return { ...sets[0][0], page, pageSize:25, claims:sets[1].map(item=>({...item,id:item.id.toLowerCase(),skillId:item.skillId.toLowerCase(),personId:item.personId?.toLowerCase(),reviewerId:item.reviewerId?.toLowerCase(),updatedAt:item.updatedAt.toISOString()})) };
      });
    } catch(error) { throw claimError(error); }
  }
  async options(actorId: string, search: string, page: number, category='',pageSize=25) : Promise<ClaimOptions> {
    try {
      return await withRuntimeDatabase(async pool => {
        const result = await pool.request().input('account_id',sql.UniqueIdentifier,this.accountId).input('actor_id',sql.UniqueIdentifier,actorId).input('query',sql.NVarChar(100),search).input('category',sql.NVarChar(80),category).input('page_size',sql.Int,pageSize).input('page',sql.Int,page).execute('dbo.ReadClaimSkills');
        const sets = result.recordsets as unknown as [sql.IRecordSet<{total:number}>,sql.IRecordSet<Omit<ClaimOption,'levels'>>,sql.IRecordSet<ClaimOption['levels'][number] & {skillId:string}>,sql.IRecordSet<{name:string;count:number}>];
        return {total:sets[0][0].total,page,pageSize,categories:sets[3]??[],skills:sets[1].map(item=>({...item,id:item.id.toLowerCase(),levels:sets[2].filter(level=>level.skillId===item.id).map(({rank,name,description})=>({rank,name,description}))}))};
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
  private async workbench(actor:string,page:number,query:ReturnType<typeof reviewQuery>,id?:string,historyPage=1){
    return withRuntimeDatabase(pool=>pool.request().input('account_id',sql.UniqueIdentifier,this.accountId).input('actor_id',sql.UniqueIdentifier,actor).input('page',sql.Int,page).input('query',sql.NVarChar(100),query.search).input('category',sql.NVarChar(80),query.category).input('status',sql.VarChar(20),query.status).input('person_id',sql.UniqueIdentifier,query.person??null).input('claim_id',sql.UniqueIdentifier,id??null).input('history_page',sql.Int,historyPage).execute('dbo.ReadSkillReviewWorkbench'));
  }
  async reviews(actorId:string,page:number,query=reviewQuery({})):Promise<ClaimState>{
    try{const result=await this.workbench(actorId,page,query);const sets=result.recordsets as unknown as [sql.IRecordSet<{total:number;canClaim:boolean}>,sql.IRecordSet<Omit<SkillClaim,'updatedAt'>&{updatedAt:Date}>,sql.IRecordSet<{category:string}>,sql.IRecordSet<NonNullable<ClaimState['summary']>>];return {...sets[0][0],page,pageSize:25,categories:sets[2].map(c=>c.category),summary:sets[3][0],claims:sets[1].map(item=>({...item,id:item.id.toLowerCase(),skillId:item.skillId.toLowerCase(),personId:item.personId?.toLowerCase(),reviewerId:item.reviewerId?.toLowerCase(),updatedAt:item.updatedAt.toISOString()}))};}catch(error){throw claimError(error);}
  }
  async reviewDetail(actorId:string,id:string,page:number):Promise<ReviewDetail>{
    try{const result=await this.workbench(actorId,1,reviewQuery({status:'ALL'}),id,page);const sets=result.recordsets as unknown as sql.IRecordSet<Record<string,unknown>>[];const raw=sets[1][0] as unknown as Omit<SkillClaim,'updatedAt'>&{updatedAt:Date};if(!raw)throw new AccessError(404,'Assigned review unavailable.');return {claim:{...raw,id:raw.id.toLowerCase(),skillId:raw.skillId.toLowerCase(),personId:raw.personId?.toLowerCase(),reviewerId:raw.reviewerId?.toLowerCase(),updatedAt:raw.updatedAt.toISOString()},history:sets[4].map(row=>({revision:Number(row.revision),action:String(row.action),at:(row.at as Date).toISOString(),actorName:String(row.actorName),feedback:String(row.feedback)})),total:Number(sets[5][0].total),page,pageSize:20};}catch(error){if(error instanceof AccessError)throw error;throw claimError(error);}
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
