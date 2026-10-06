import { randomUUID } from 'node:crypto';
import { AccessError } from '../../shared/errors.js';
import { hasStandardProficiency } from './proficiency.js';

export type SkillStatus = 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';
export interface SkillLevel {
  rank: number;
  name: string;
  description: string;
}
export interface CatalogueSkill {
  businessCode?: string | null;
  definitionRevision?: number;
  id: string;
  name: string;
  category: string;
  description: string;
  status: SkillStatus;
  levels: SkillLevel[];
}
export interface CatalogueQuery {
  search: string;
  status: SkillStatus | '';
  page: number;
}
export interface CatalogueState {
  revision: number;
  canManage: boolean;
  total: number;
  page: number;
  pageSize: number;
  skills: CatalogueSkill[];
}
export interface CatalogueStore {
  read(actorId: string, query: CatalogueQuery): Promise<CatalogueState>;
  save(actorId: string, input: unknown): Promise<void>;
}
export const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const statuses = ['DRAFT', 'PUBLISHED', 'ARCHIVED'];
function text(value: unknown, max: number, required = true, compact = false): string {
  if (typeof value !== 'string') throw new AccessError(400, 'Enter valid skill fields.');
  const result = compact ? value.trim().replace(/\s+/g, ' ') : value.trim();
  if (result.length > max || (required && !result))
    throw new AccessError(400, 'Check required fields and text lengths.');
  return result;
}
export function catalogueQuery(input: Record<string, unknown>): CatalogueQuery {
  const search = input.search === undefined ? '' : text(input.search, 100, false, true);
  const status = input.status === undefined || input.status === '' ? '' : input.status;
  const page = input.page === undefined ? 1 : Number(input.page);
  if (
    typeof status !== 'string' ||
    (status && !statuses.includes(status)) ||
    !Number.isSafeInteger(page) ||
    page < 1 ||
    page > 100000
  )
    throw new AccessError(400, 'Choose a valid catalogue filter or page.');
  return { search, status: status as CatalogueQuery['status'], page };
}
export function catalogueChange(input: unknown) {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new AccessError(400, 'Invalid skill change.');
  const body = input as Record<string, unknown>;
  if (!Number.isSafeInteger(body.revision) || Number(body.revision) < 1)
    throw new AccessError(400, 'Reload the catalogue before saving.');
  if (typeof body.status !== 'string' || !statuses.includes(body.status))
    throw new AccessError(400, 'Choose a skill status.');
  if (body.id !== undefined && (typeof body.id !== 'string' || !uuid.test(body.id)))
    throw new AccessError(400, 'Choose a valid skill.');
  const published = body.status === 'PUBLISHED';
  if (!Array.isArray(body.levels) || body.levels.length !== 5)
    throw new AccessError(
      400,
      'Use exactly five levels: Awareness, Foundation, Practitioner, Advanced and Expert.',
    );
  const names = new Set<string>();
  const levels: SkillLevel[] = body.levels.map((item, index) => {
    if (!item || typeof item !== 'object' || item.rank !== index + 1)
      throw new AccessError(400, 'Keep proficiency levels in sequential order.');
    const name = text(item.name, 60, true, true),
      description = text(item.description, 1000, published);
    if (names.has(name.toLowerCase()))
      throw new AccessError(400, 'Proficiency level names must be unique.');
    names.add(name.toLowerCase());
    return { rank: index + 1, name, description };
  });
  if (!hasStandardProficiency(levels))
    throw new AccessError(
      400,
      'Use exactly five levels: Awareness, Foundation, Practitioner, Advanced and Expert.',
    );
  return {
    revision: Number(body.revision),
    targetId: body.id === undefined ? randomUUID() : String(body.id).toLowerCase(),
    isNew: body.id === undefined,
    payload: {
      name: text(body.name, 100, true, true),
      category: text(body.category, 80, true, true),
      description: text(body.description, 2000, published),
      status: body.status as SkillStatus,
      levels,
    },
  };
}
