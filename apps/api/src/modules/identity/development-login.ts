import { randomBytes, createHmac, timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';
import { localRequest, localMutation } from '../../shared/http-security.js';
export { localRequest, localMutation } from '../../shared/http-security.js';
import { can, readActorAccess, type AccessStore } from '../access/index.js';
export interface HostedDemoConfig { origin: string; accessCode: string; sessionSecret: string }
export function hostedDemoConfig(env: NodeJS.ProcessEnv): HostedDemoConfig | undefined {
  if (env.HOSTED_DEMO_LOGIN !== 'true') return undefined;
  const origin = env.PUBLIC_APP_ORIGIN ?? '';
  const url = new URL(origin);
  if (env.NODE_ENV !== 'production' || url.protocol !== 'https:' || url.origin !== origin ||
      (env.DEMO_LOGIN_ACCESS_CODE?.length ?? 0) < 4 || (env.DEMO_SESSION_SECRET?.length ?? 0) < 32) {
    throw new Error('Hosted demo requires a production HTTPS origin, an access code of at least 4 characters and a signing secret of at least 32 characters.');
  }
  return { origin, accessCode: env.DEMO_LOGIN_ACCESS_CODE!, sessionSecret: env.DEMO_SESSION_SECRET! };
}
export function developmentLoginEnabled(env: NodeJS.ProcessEnv) {
  if (env.DEV_DIRECT_LOGIN !== 'true') return false;
  if (env.NODE_ENV !== 'development') throw new Error('Direct login requires NODE_ENV=development.');
  return true;
}
export function createDevelopmentSessions(store: AccessStore, now = Date.now, hosted?: HostedDemoConfig) {
  const sessions = new Map<string,{personId:string;expires:number}>();
  const cookieName = 'skill_dev_session'; const lifetime = 30*60*1000;
  const requestAllowed = (req: Request) => hosted ? req.get('host') === new URL(hosted.origin).host : localRequest(req);
  const mutationAllowed = (req: Request) => hosted ? requestAllowed(req) && req.get('Origin') === hosted.origin : localMutation(req);
  const signature = (value: string) => createHmac('sha256', hosted!.sessionSecret + ':' + hosted!.accessCode).update(value).digest('base64url');
  const constantMatch = (left: string, right: string) => {
    const a = createHmac('sha256', 'demo-comparison').update(left).digest();
    const b = createHmac('sha256', 'demo-comparison').update(right).digest();
    return timingSafeEqual(a,b);
  };
  const token = (req: Request) => req.get('Cookie')?.split(';').map(part => part.trim()).find(part => part.startsWith(`${cookieName}=`))?.slice(cookieName.length+1);
  const sweep = () => { for (const [key,session] of sessions) if (session.expires <= now()) sessions.delete(key); };
  const subject = (req: Request) => {
    sweep(); if (!requestAllowed(req)) return undefined;
    const value = token(req); if (!value) return undefined;
    if (!hosted) return sessions.get(value)?.personId;
    if (value.length > 1024) return undefined;
    const [payload,mac,...extra] = value.split('.');
    if (!payload || !mac || extra.length || !constantMatch(mac,signature(payload))) return undefined;
    try {
      const data = JSON.parse(Buffer.from(payload,'base64url').toString('utf8'));
      if (data.version !== 1 || data.origin !== hosted.origin || typeof data.personId !== 'string' ||
          !Number.isSafeInteger(data.issued) || !Number.isSafeInteger(data.expires) || data.issued > now() ||
          data.expires <= now() || data.expires - data.issued !== lifetime) return undefined;
      return data.personId as string;
    } catch { return undefined; }
  };
  const person = async (req: Request) => { const id=subject(req); const user=id?await store.person(id):undefined;return user?.entraObjectId?undefined:user; };
  return {
    cookieName,lifetime,person,requestAllowed,mutationAllowed,secure:Boolean(hosted),requiresAccessCode:Boolean(hosted),
    authorizeCode(value: unknown) { return !hosted || (typeof value === 'string' && value.length <= 256 && constantMatch(value,hosted.accessCode)); },
    subject,
    async issue(id: string) {
      sweep(); const user=await store.person(id); if (!user || !user.active || user.entraObjectId || (!hosted && sessions.size >= 100)) return undefined;
      if (hosted) {
        const issued=now();
        const payload=Buffer.from(JSON.stringify({version:1,personId:id,origin:hosted.origin,issued,expires:issued+lifetime,nonce:randomBytes(16).toString('hex')})).toString('base64url');
        return payload+'.'+signature(payload);
      }
      const value=randomBytes(32).toString('hex'); sessions.set(value,{personId:id,expires:now()+lifetime}); return value;
    },
    revoke(req: Request) { const value=token(req); if (value) sessions.delete(value); },
    async profile(req: Request) {
      const id=subject(req); if(!id)return undefined;
      const state=await readActorAccess(store,id); const user=state.people.find(person=>person.id===id&&person.active);
      if (!user || user.entraObjectId || !can(state,user,'profile.view',true)) return undefined;
      return { id:user.id,displayName:user.displayName,employeeCode:user.employeeCode,jobTitle:user.jobTitle??null,grade:user.grade??null,primaryCapabilityId:user.primaryCapabilityId??null,primaryCapabilityName:user.primaryCapabilityName??null,primaryCapabilityStatus:user.primaryCapabilityStatus??null,organization:'Development Workspace',status:'ACTIVE',canViewSkills:can(state,user,'skill.view')||can(state,user,'skill.catalogue.manage'),roles:state.roles.filter(role => user.roleIds.includes(role.id)).map(role => role.name) };
    },
  };
}
