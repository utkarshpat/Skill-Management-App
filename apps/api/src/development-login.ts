import { randomBytes } from 'node:crypto';
import type { Request } from 'express';
import { can, LocalAccessStore } from './local-access-store.js';
export function developmentLoginEnabled(env: NodeJS.ProcessEnv) {
  if (env.DEV_DIRECT_LOGIN !== 'true') return false;
  if (env.NODE_ENV !== 'development') throw new Error('Direct login requires NODE_ENV=development.');
  return true;
}
export function localRequest(req: Request) {
  return ['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress ?? '') && ['localhost','127.0.0.1','[::1]'].includes(req.hostname);
}
export function localMutation(req: Request) {
  if (!localRequest(req)) return false;
  try {
    const origin = new URL(req.get('Origin') ?? '');
    // Vite's proxy can replace Host with the API target; explicitly allow only our local UI origins.
    return origin.protocol === 'http:' && ['localhost','127.0.0.1','[::1]'].includes(origin.hostname) &&
      (origin.host === req.get('host') || ['http://localhost:5173','http://127.0.0.1:5173'].includes(origin.origin));
  }
  catch { return false; }
}
export function createDevelopmentSessions(store: LocalAccessStore, now = Date.now) {
  const sessions = new Map<string,{personId:string;expires:number}>();
  const cookieName = 'skill_dev_session'; const lifetime = 30*60*1000;
  const token = (req: Request) => req.get('Cookie')?.split(';').map(part => part.trim()).find(part => part.startsWith(`${cookieName}=`))?.slice(cookieName.length+1);
  const sweep = () => { for (const [key,session] of sessions) if (session.expires <= now()) sessions.delete(key); };
  const person = (req: Request) => { sweep(); if (!localRequest(req)) return undefined; const value = token(req); const session = value ? sessions.get(value) : undefined; return session ? store.person(session.personId) : undefined; };
  return {
    cookieName,lifetime,person,
    issue(id: string) { sweep(); if (!store.person(id) || sessions.size >= 100) return undefined; const value=randomBytes(32).toString('hex'); sessions.set(value,{personId:id,expires:now()+lifetime}); return value; },
    revoke(req: Request) { const value=token(req); if (value) sessions.delete(value); },
    profile(req: Request) {
      const user=person(req); if (!user || !can(store.snapshot(),user,'profile.view',true)) return undefined;
      return { id:user.id,displayName:user.displayName,employeeCode:user.employeeCode,organization:'Local Demo Workspace',status:'ACTIVE',roles:store.snapshot().roles.filter(role => user.roleIds.includes(role.id)).map(role => role.name) };
    },
  };
}
