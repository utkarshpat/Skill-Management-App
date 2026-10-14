import { AccessError } from '../../shared/errors.js';
import { identifier, type BusinessContext } from './business.js';
export interface PeopleSearchQuery {
  scopeId?: string;
  skills: { id: string; minRank: number }[];
  certifications: string[];
  headcount: number;
  onlyEligible: boolean;
  page: number;
}
export interface PeopleSearchResult {
  context: BusinessContext;
  query: PeopleSearchQuery;
  requirements: { type: string; name: string; criterion: string }[];
  total: number;
  eligibleTotal: number;
  required: number;
  page: number;
  pageSize: number;
  rows: {
    id: string;
    employee: string;
    employeeCode: string;
    matched: number;
    eligible: boolean;
    criteria: { type: string; name: string; criterion: string; matched: boolean }[];
  }[];
}
export function peopleSearchQuery(value: unknown): PeopleSearchQuery {
  const fail = (): never => {
    throw new AccessError(
      400,
      'Choose published skills, minimum levels and active certificates for matching.',
    );
  };
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail();
  const q = value as Record<string, unknown>;
  if (
    Object.keys(q).some(
      k =>
        !['scopeId', 'skills', 'certifications', 'headcount', 'onlyEligible', 'page'].includes(k),
    )
  )
    fail();
  const skills = q.skills ?? [],
    certifications = q.certifications ?? [];
  if (
    !Array.isArray(skills) ||
    !Array.isArray(certifications) ||
    skills.length + certifications.length < 1 ||
    skills.length + certifications.length > 20
  )
    fail();
  const normalized = (skills as unknown[]).map(value => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail();
    const s = value as Record<string, unknown>;
    if (
      Object.keys(s).some(k => !['id', 'minRank'].includes(k)) ||
      !Number.isInteger(s.minRank) ||
      Number(s.minRank) < 1 ||
      Number(s.minRank) > 4
    )
      fail();
    return { id: identifier(s.id), minRank: Number(s.minRank) };
  });
  const certs = (certifications as unknown[]).map(identifier);
  if (
    new Set(normalized.map(s => s.id)).size !== normalized.length ||
    new Set(certs).size !== certs.length
  )
    fail();
  if (q.onlyEligible !== undefined && typeof q.onlyEligible !== 'boolean') fail();
  for (const [key, max] of [
    ['page', 10000],
    ['headcount', 10000],
  ] as const)
    if (
      q[key] !== undefined &&
      (!Number.isInteger(q[key]) || Number(q[key]) < 1 || Number(q[key]) > max)
    )
      fail();
  return {
    ...(q.scopeId !== undefined ? { scopeId: identifier(q.scopeId) } : {}),
    skills: normalized,
    certifications: certs,
    headcount: Number(q.headcount ?? 1),
    page: Number(q.page ?? 1),
    onlyEligible: q.onlyEligible === true,
  };
}
