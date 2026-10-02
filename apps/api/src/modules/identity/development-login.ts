import { randomBytes } from 'node:crypto';
import type { Request } from 'express';
import { localRequest } from '../../shared/http-security.js';
export { localRequest, localMutation } from '../../shared/http-security.js';
import { can, type AccessStore } from '../access/index.js';
export function developmentLoginEnabled(env: NodeJS.ProcessEnv) {
  if (env.DEV_DIRECT_LOGIN !== 'true') return false;
  if (env.NODE_ENV !== 'development') throw new Error('Direct login requires NODE_ENV=development.');
  return true;
}
export function createDevelopmentSessions(store: AccessStore, now = Date.now) {
  const sessions = new Map<string,{personId:string;expires:number}>();
  const cookieName = 'skill_dev_session'; const lifetime = 30*60*1000;
  const token = (req: Request) => req.get('Cookie')?.split(';').map(part => part.trim()).find(part => part.startsWith(`${cookieName}=`))?.slice(cookieName.length+1);
  const sweep = () => { for (const [key,session] of sessions) if (session.expires <= now()) sessions.delete(key); };
  const subject = (req: Request) => { sweep(); if (!localRequest(req)) return undefined; const value = token(req); return value ? sessions.get(value)?.personId : undefined; };
  const person = async (req: Request) => { const id=subject(req); const user=id?await store.person(id):undefined;return user?.entraObjectId?undefined:user; };
  return {
    cookieName,lifetime,person,
    subject,
    async issue(id: string) { sweep(); const user=await store.person(id); if (!user || user.entraObjectId || sessions.size >= 100) return undefined; const value=randomBytes(32).toString('hex'); sessions.set(value,{personId:id,expires:now()+lifetime}); return value; },
    revoke(req: Request) { const value=token(req); if (value) sessions.delete(value); },
    async profile(req: Request) {
      const id=subject(req); if(!id)return undefined;
      const state=await store.snapshot(); const user=state.people.find(person=>person.id===id&&person.active);
      if (!user || user.entraObjectId || !can(state,user,'profile.view',true)) return undefined;
      return { id:user.id,displayName:user.displayName,employeeCode:user.employeeCode,organization:'Development Workspace',status:'ACTIVE',canViewSkills:can(state,user,'skill.view')||can(state,user,'skill.catalogue.manage'),roles:state.roles.filter(role => user.roleIds.includes(role.id)).map(role => role.name) };
    },
  };
}
