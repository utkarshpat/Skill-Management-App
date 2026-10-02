import { AccessError } from '../../shared/errors.js';

export interface SkillClaim {
  id: string; revision: number; skillId: string; skillName: string; category: string;
  definitionRevision: number; rank: number; levelName: string; levelDescription: string;
  experienceMonths: number; description: string; status: 'DRAFT'; updatedAt: string;
}
export interface ClaimOption {
  id: string; name: string; category: string; definitionRevision: number;
  levels: { rank: number; name: string; description: string }[];
}
export interface ClaimState { claims: SkillClaim[]; total: number; page: number; pageSize: number; canClaim: boolean }
export interface ClaimOptions { skills: ClaimOption[]; total: number; page: number; pageSize: number }
export interface ClaimsStore {
  read(actorId: string, page: number): Promise<ClaimState>;
  options(actorId: string, search: string, page: number): Promise<ClaimOptions>;
  save(actorId: string, input: unknown): Promise<void>;
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function claimPage(value: unknown): number {
  if(value!==undefined&&typeof value!=='string'&&typeof value!=='number')throw new AccessError(400,'Choose a valid page.');
  const page = value === undefined ? 1 : Number(value);
  if (!Number.isSafeInteger(page) || page < 1 || page > 100000) throw new AccessError(400, 'Choose a valid page.');
  return page;
}
export function claimSearch(value: unknown): string {
  if (value === undefined) return '';
  if (typeof value !== 'string' || value.length > 100) throw new AccessError(400, 'Search using up to 100 characters.');
  return value.trim();
}
export function claimChange(input: unknown) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new AccessError(400, 'Invalid skill draft.');
  const body = input as Record<string, unknown>;
  const fields = new Set(['id','revision','skillId','definitionRevision','rank','experienceMonths','description']);
  if (Object.keys(body).some(key => !fields.has(key))) throw new AccessError(400, 'Only editable skill draft fields are accepted.');
  if (typeof body.id !== 'string' || !uuid.test(body.id) || typeof body.skillId !== 'string' || !uuid.test(body.skillId)) throw new AccessError(400, 'Choose a valid skill draft.');
  for (const [key, min, max] of [['revision',0,2147483646],['definitionRevision',1,2147483646],['rank',1,8],['experienceMonths',0,600]] as const) {
    if (!Number.isSafeInteger(body[key]) || Number(body[key]) < min || Number(body[key]) > max) throw new AccessError(400, 'Check proficiency, experience and draft version.');
  }
  if (typeof body.description !== 'string' || !body.description.trim() || body.description.trim().length > 2000) throw new AccessError(400, 'Describe your experience using up to 2,000 characters.');
  return { id: body.id.toLowerCase(), revision: Number(body.revision), skillId: body.skillId.toLowerCase(), definitionRevision: Number(body.definitionRevision), rank: Number(body.rank), experienceMonths: Number(body.experienceMonths), description: body.description.trim() };
}
