import sql from 'mssql';
import { withRuntimeDatabase } from '../../shared/database.js';
import { AccessError } from '../../shared/errors.js';
import type { Session } from './context.js';

export interface SavedMessage {role:'user'|'assistant';content:string;sources?:{label:string;url:string}[];artifact?:unknown}
export interface SavedConversation {id:string;title:string;revision:number;updatedAt:string;messages:SavedMessage[];context:Session}
export interface ConversationsStore {
 list(actor:string):Promise<Pick<SavedConversation,'id'|'title'|'updatedAt'>[]>;
 read(actor:string,id:string):Promise<SavedConversation>;
 save(actor:string,conversation:SavedConversation):Promise<void>;
 delete(actor:string,id:string):Promise<void>;
}
export function conversationReference(id:unknown):string {
 if(typeof id!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))throw new AccessError(400,'Invalid conversation reference.');
 return id;
}
export class SqlConversationsStore implements ConversationsStore {
 constructor(private accountId:string){conversationReference(accountId);}
 private async run(actor:string,operation:string,id?:string,payload?:SavedConversation){
  try{return await withRuntimeDatabase(pool=>pool.request().input('account_id',sql.UniqueIdentifier,this.accountId).input('actor_id',sql.UniqueIdentifier,actor)
   .input('operation',sql.VarChar(8),operation).input('conversation_id',sql.UniqueIdentifier,id??null)
   .input('revision',sql.Int,payload?.revision??0).input('payload',sql.NVarChar(sql.MAX),payload?JSON.stringify(payload):null).execute('dbo.OwnAiConversations'));
  }catch(error){const number=(error as {number?:number}).number;
   if(number===51003)throw new AccessError(403,'Assistant access is not assigned.');
   if(number===51004)throw new AccessError(404,'This conversation is no longer available.');
   if(number===51009)throw new AccessError(409,'Conversation changed in another window. Reopen it before continuing.');
   throw new AccessError(503,'Chat history could not be saved or loaded. Please retry.');
  }
 }
 async list(actor:string){const result=await this.run(actor,'list');return result.recordset.map(row=>({id:String(row.id).toLowerCase(),title:String(row.title),updatedAt:new Date(row.updatedAt).toISOString()}));}
 async read(actor:string,id:string){const result=await this.run(actor,'read',conversationReference(id));const row=result.recordset[0];return {...JSON.parse(row.payload),revision:row.revision,updatedAt:new Date(row.updatedAt).toISOString()} as SavedConversation;}
 async save(actor:string,conversation:SavedConversation){await this.run(actor,'save',conversation.id,conversation);}
 async delete(actor:string,id:string){await this.run(actor,'delete',conversationReference(id));}
}
