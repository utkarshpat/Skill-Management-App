import { AccessError } from '../../shared/errors.js';
import { claimChange } from './claims.js';
import { certificationChange, certificationId } from './certifications.js';
export interface CapabilitySubmissionStore {
  storageConfigured?: boolean;
  run(actor: string, operation: string, payload: object): Promise<any>;
  stage?(
    actor: string,
    id: string,
    cert: string,
    revision: number,
    file: Buffer,
    mimeType: string,
    fileName: string,
  ): Promise<any>;
  stagedFiles?(actor: string, id: string, cert: string): Promise<any>;
  stagedFile?(
    actor: string,
    id: string,
    cert: string,
    fileId: string,
  ): Promise<{ data: Buffer; item: any }>;
  files?(actor: string, id: string, record: string): Promise<any>;
  file?(
    actor: string,
    id: string,
    record: string,
    fileId: string,
  ): Promise<{ data: Buffer; item: any }>;
}
const object = (value: unknown): Record<string, any> => {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new AccessError(400, 'Invalid submission.');
  return value as Record<string, any>;
};
const revision = (value: unknown) => {
  if (!Number.isSafeInteger(value) || Number(value) < 0 || Number(value) > 2147483646)
    throw new AccessError(400, 'Invalid record revision.');
  return Number(value);
};
function only(value: Record<string, any>, keys: string[]) {
  if (Object.keys(value).some(k => !keys.includes(k)))
    throw new AccessError(400, 'Only editable submission fields are accepted.');
}
export function capabilityIntake(input: unknown) {
  const body = object(input);
  only(body, ['id', 'revision', 'skills', 'certifications']);
  if (
    !Array.isArray(body.skills) ||
    body.skills.length > 10 ||
    !Array.isArray(body.certifications) ||
    body.certifications.length > 10 ||
    (!body.skills.length && !body.certifications.length)
  )
    throw new AccessError(400, 'Add a skill or a certificate before saving a draft.');
  const text = (v: unknown, max: number) => {
    if (typeof v !== 'string' || v.length > max)
      throw new AccessError(400, 'Shorten your draft fields.');
    return v;
  };
  const integer = (v: unknown, max: number) => {
    if (!Number.isSafeInteger(v) || Number(v) < 0 || Number(v) > max)
      throw new AccessError(400, 'Check numeric draft fields.');
    return Number(v);
  };
  const skills = body.skills.map((raw: unknown) => {
    const item = object(raw);
    only(item, [
      'id',
      'revision',
      'choice',
      'reuse',
      'rank',
      'experienceMonths',
      'description',
      'projects',
      'evidence',
      'lastUsedOn',
    ]);
    const choice = object(item.choice);
    only(choice, [
      'id',
      'name',
      'category',
      'description',
      'businessCode',
      'definitionRevision',
      'levels',
    ]);
    if (!Array.isArray(choice.levels) || choice.levels.length > 8)
      throw new AccessError(400, 'Invalid skill catalogue draft.');
    return {
      id: certificationId(item.id),
      revision: revision(item.revision),
      reuse: item.reuse === true,
      choice: {
        id: certificationId(choice.id),
        name: text(choice.name, 100),
        category: text(choice.category, 80),
        definitionRevision: integer(choice.definitionRevision, 2147483646),
        levels: choice.levels.map((l: any) => ({
          rank: integer(l.rank, 8),
          name: text(l.name, 60),
          description: text(l.description, 1000),
        })),
      },
      rank: integer(item.rank, 8),
      experienceMonths: integer(item.experienceMonths, 600),
      description: text(item.description, 2000),
      projects: text(item.projects, 2000),
      evidence: text(item.evidence, 2000),
      lastUsedOn: text(item.lastUsedOn, 10),
    };
  });
  const certifications = body.certifications.map((raw: unknown) => {
    const c = object(raw);
    only(c, ['id', 'revision', 'reuse', 'fields', 'skillIds', 'renewedFromId']);
    const f = object(c.fields);
    only(f, [
      'certificationName',
      'provider',
      'category',
      'certificationDate',
      'expiryDate',
      'credentialId',
      'credentialUrl',
      'notes',
    ]);
    if (!Array.isArray(c.skillIds) || c.skillIds.length > 10)
      throw new AccessError(400, 'Invalid related skills.');
    return {
      id: certificationId(c.id),
      revision: revision(c.revision),
      reuse: c.reuse === true,
      fields: {
        certificationName: text(f.certificationName, 200),
        provider: text(f.provider, 120),
        category: text(f.category, 80),
        certificationDate: text(f.certificationDate, 10),
        expiryDate: f.expiryDate === null ? null : text(f.expiryDate, 10),
        credentialId: text(f.credentialId, 200),
        credentialUrl: text(f.credentialUrl, 1000),
        notes: text(f.notes, 2000),
      },
      skillIds: c.skillIds.map(certificationId),
      ...(c.renewedFromId ? { renewedFromId: certificationId(c.renewedFromId) } : {}),
    };
  });
  if (
    new Set(skills.map(s => s.id)).size !== skills.length ||
    new Set(skills.map(s => s.choice.id)).size !== skills.length ||
    new Set(certifications.map(c => c.id)).size !== certifications.length
  )
    throw new AccessError(400, 'Duplicate draft records.');
  if (
    new Set([...skills.map(s => s.id), ...certifications.map(c => c.id)]).size !==
    skills.length + certifications.length
  )
    throw new AccessError(400, 'Record IDs must be distinct.');
  return {
    id: certificationId(body.id),
    revision: revision(body.revision),
    skills,
    certifications,
  };
}
export function capabilityCommand(input: unknown) {
  const body = object(input);
  only(body, ['id', 'revision', 'skills', 'certifications']);
  const id = certificationId(body.id),
    version = revision(body.revision);
  if (
    !Array.isArray(body.skills) ||
    !body.skills.length ||
    body.skills.length > 10 ||
    !Array.isArray(body.certifications) ||
    body.certifications.length > 10
  )
    throw new AccessError(400, 'Choose 1–10 skills and up to 10 certifications.');
  const skills = body.skills.map((input: unknown) => {
    const item = object(input);
    only(item, ['id', 'revision', 'skillId', 'fields']);
    const base = {
      id: certificationId(item.id),
      revision: revision(item.revision),
      skillId: certificationId(item.skillId),
    };
    return {
      ...base,
      ...(item.fields ? { fields: claimChange({ ...object(item.fields), ...base }) } : {}),
    };
  });
  if (
    new Set(skills.map(s => s.skillId)).size !== skills.length ||
    new Set(skills.map(s => s.id)).size !== skills.length
  )
    throw new AccessError(400, 'Select each skill once.');
  const certifications = body.certifications.map((input: unknown) => {
    const item = object(input);
    only(item, ['id', 'revision', 'fields', 'skillIds', 'renewedFromId']);
    const certId = certificationId(item.id),
      rev = revision(item.revision);
    if (!Array.isArray(item.skillIds) || !item.skillIds.length || item.skillIds.length > 10)
      throw new AccessError(400, 'Link every certification to at least one selected skill.');
    const skillIds: string[] = item.skillIds.map(certificationId);
    if (
      new Set(skillIds).size !== skillIds.length ||
      skillIds.some(s => !skills.some(v => v.skillId === s))
    )
      throw new AccessError(400, 'Choose related skills from this submission.');
    const saved = item.fields
      ? certificationChange({ action: 'SAVE', id: certId, revision: rev, fields: item.fields })
      : undefined;
    return {
      id: certId,
      revision: rev,
      skillIds,
      ...(saved && 'fields' in saved ? { fields: saved.fields } : {}),
      ...(item.renewedFromId ? { renewedFromId: certificationId(item.renewedFromId) } : {}),
    };
  });
  if (new Set(certifications.map(c => c.id)).size !== certifications.length)
    throw new AccessError(400, 'Link each certification once.');
  if (
    new Set([...skills.map(s => s.id), ...certifications.map(c => c.id)]).size !==
    skills.length + certifications.length
  )
    throw new AccessError(400, 'Skill and certification record IDs must be distinct.');
  return { id, revision: version, skills, certifications };
}
export function capabilityDecision(input: unknown) {
  const body = object(input);
  only(body, ['id', 'revision', 'decisions']);
  if (!Array.isArray(body.decisions) || !body.decisions.length || body.decisions.length > 20)
    throw new AccessError(400, 'Review each pending item.');
  const decisions = body.decisions.map((input: unknown) => {
    const item = object(input);
    only(item, ['id', 'kind', 'revision', 'action', 'feedback']);
    if (
      !['SKILL', 'CERTIFICATION'].includes(item.kind) ||
      !['APPROVE', 'REQUEST_CHANGES', 'REJECT'].includes(item.action) ||
      typeof item.feedback !== 'string' ||
      !item.feedback.trim() ||
      item.feedback.length > 2000
    )
      throw new AccessError(400, 'Choose a decision and feedback for every pending item.');
    return {
      id: certificationId(item.id),
      kind: item.kind,
      revision: revision(item.revision),
      action: item.action,
      feedback: item.feedback.trim(),
    };
  });
  if (new Set(decisions.map(d => d.kind + d.id)).size !== decisions.length)
    throw new AccessError(400, 'Duplicate review decisions.');
  return { id: certificationId(body.id), revision: revision(body.revision), decisions };
}

// SQL JSON serializes uniqueidentifier values in uppercase; public IDs use the
// same lowercase contract as the existing skill and certification adapters.
export function normalizeCapabilityIds<T>(value: T): T {
  const keys = new Set([
    'id',
    'skillId',
    'claimId',
    'certificationId',
    'personId',
    'reviewerId',
    'submissionId',
    'recordId',
    'fileId',
    'renewedFromId',
  ]);
  const walk = (v: any): any =>
    Array.isArray(v)
      ? v.map(walk)
      : v && typeof v === 'object'
        ? Object.fromEntries(
            Object.entries(v).map(([key, item]) => [
              key,
              typeof item === 'string' &&
              keys.has(key) &&
              /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(item)
                ? item.toLowerCase()
                : walk(item),
            ]),
          )
        : v;
  return walk(value);
}

export function capabilityResult(operation: string, value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new AccessError(503, 'Capability result could not be confirmed.');
  const result = normalizeCapabilityIds(value) as Record<string, any>;
  const arrays =
    operation === 'OPTIONS'
      ? ['claims', 'certifications', 'definitions']
      : operation === 'LINKS'
        ? ['links']
        : operation === 'MINE' || operation === 'QUEUE'
          ? ['records']
          : ['skills', 'certifications', 'stagedFiles'];
  // SQL FOR JSON omits NULL properties for empty item queries. A private
  // intake has no materialized claims yet, but its public DTO still uses arrays.
  for (const key of arrays) {
    if (result[key] == null) result[key] = [];
    else if (!Array.isArray(result[key]))
      throw new AccessError(503, 'Capability result could not be confirmed.');
  }
  return result;
}
