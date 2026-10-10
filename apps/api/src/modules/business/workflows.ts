import { AccessError } from '../../shared/errors.js';
import { identifier } from './business.js';
const text = (v: unknown, max: number, required = false) => {
  if (typeof v !== 'string' || v.trim().length > max || (required && !v.trim()))
    throw new AccessError(400, 'Complete the required fields.');
  return v.trim();
};
export function businessWorkflow(
  operation: unknown,
  value: unknown,
): { operation: string; payload: Record<string, unknown> } {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new AccessError(400, 'Invalid operation.');
  const q = value as Record<string, unknown>;
  const keys: Record<string, string[]> = {
    MASTERS: ['page', 'search', 'includeInactive'],
    AMENDMENTS: ['page'],
    DEMANDS: ['page'],
    AMENDMENT: ['id'],
    PROPOSE: [
      'id',
      'revision',
      'type',
      'targetId',
      'name',
      'category',
      'description',
      'active',
      'providerId',
      'criteria',
      'reason',
    ],
    APPROVE_AMENDMENT: ['id', 'revision', 'note'],
    REJECT_AMENDMENT: ['id', 'revision', 'note'],
    SAVE_DEMAND: ['id', 'revision', 'scopeId', 'title', 'description', 'requirements'],
    MATCHES: ['id', 'page'],
    SHORTLIST: ['id', 'personId', 'revision', 'note'],
  };
  if (
    typeof operation !== 'string' ||
    !keys[operation] ||
    Object.keys(q).some(key => !keys[operation].includes(key))
  )
    throw new AccessError(400, 'Unsupported arguments.');
  const revision = () => {
    if (!Number.isSafeInteger(q.revision) || Number(q.revision) < 1)
      throw new AccessError(400, 'Reload the current revision.');
    return Number(q.revision);
  };
  if (
    operation === 'MASTERS' &&
    q.includeInactive !== undefined &&
    ![true, false, 'true', 'false'].includes(q.includeInactive as boolean)
  )
    throw new AccessError(400, 'Choose valid definition state.');
  if (operation === 'MASTERS' || operation === 'AMENDMENTS' || operation === 'DEMANDS') {
    const page = Number(q.page ?? 1);
    if (!Number.isSafeInteger(page) || page < 1 || page > 10000)
      throw new AccessError(400, 'Choose a valid page.');
    return {
      operation,
      payload: {
        page,
        ...(operation === 'MASTERS'
          ? {
              search: text(q.search ?? '', 100),
              includeInactive: q.includeInactive === true || q.includeInactive === 'true',
            }
          : {}),
      },
    };
  }
  if (operation === 'PROPOSE') {
    if (q.active !== undefined && typeof q.active !== 'boolean')
      throw new AccessError(400, 'Choose definition state.');
    if (!['SKILL', 'CERTIFICATION', 'PROVIDER'].includes(String(q.type)))
      throw new AccessError(400, 'Choose a supported master type.');
    const payload: Record<string, unknown> = {
      name: text(q.name, 100, true),
      category: text(q.category ?? '', 80, q.type !== 'PROVIDER'),
      description: text(q.description ?? '', 2000, q.type === 'SKILL'),
      active: q.active !== false,
    };
    if (q.type === 'CERTIFICATION') payload.providerId = identifier(q.providerId);
    if (q.type === 'SKILL') {
      if (!Array.isArray(q.criteria) || q.criteria.length !== 5)
        throw new AccessError(400, 'Describe all five skill proficiency levels.');
      payload.levels = ['Awareness', 'Foundation', 'Practitioner', 'Advanced', 'Expert'].map(
        (name, index) => ({
          rank: index + 1,
          name,
          description: text((q.criteria as unknown[])[index], 1000, true),
        }),
      );
      payload.status = q.active === false ? 'ARCHIVED' : 'PUBLISHED';
    }
    return {
      operation,
      payload: {
        id: identifier(q.id),
        revision: revision(),
        type: q.type,
        targetId: q.targetId ? identifier(q.targetId) : null,
        isNew: !q.targetId,
        reason: text(q.reason, 1000, true),
        definition: payload,
      },
    };
  }
  if (operation === 'APPROVE_AMENDMENT' || operation === 'REJECT_AMENDMENT')
    return {
      operation,
      payload: { id: identifier(q.id), revision: revision(), note: text(q.note, 1000, true) },
    };
  if (operation === 'SAVE_DEMAND') {
    if (!q.requirements || typeof q.requirements !== 'object' || Array.isArray(q.requirements))
      throw new AccessError(400, 'Enter demand requirements.');
    const r = q.requirements as Record<string, unknown>;
    if (
      !Array.isArray(r.skills) ||
      !Array.isArray(r.certifications) ||
      r.skills.length + r.certifications.length < 1 ||
      r.skills.length + r.certifications.length > 20
    )
      throw new AccessError(400, 'Choose between one and twenty requirements.');
    const skills = r.skills.map(value => {
      if (!value || typeof value !== 'object')
        throw new AccessError(400, 'Invalid skill requirement.');
      const s = value as Record<string, unknown>;
      if (!Number.isInteger(s.minRank) || Number(s.minRank) < 1 || Number(s.minRank) > 5)
        throw new AccessError(400, 'Choose proficiency L1–L5.');
      return { id: identifier(s.id), minRank: Number(s.minRank) };
    });
    const certifications = r.certifications.map(identifier);
    if (
      new Set(skills.map(s => s.id)).size !== skills.length ||
      new Set(certifications).size !== certifications.length
    )
      throw new AccessError(400, 'Choose each requirement once.');
    return {
      operation,
      payload: {
        id: identifier(q.id),
        revision: revision(),
        scopeId: identifier(q.scopeId),
        title: text(q.title, 150, true),
        description: text(q.description ?? '', 2000),
        requirements: { skills, certifications },
      },
    };
  }
  if (operation === 'AMENDMENT') return { operation, payload: { id: identifier(q.id) } };
  if (operation === 'MATCHES') {
    const page = Number(q.page ?? 1);
    if (!Number.isInteger(page) || page < 1 || page > 10000)
      throw new AccessError(400, 'Choose a valid page.');
    return { operation, payload: { id: identifier(q.id), page } };
  }
  if (operation === 'SHORTLIST')
    return {
      operation,
      payload: {
        id: identifier(q.id),
        personId: identifier(q.personId),
        revision: revision(),
        note: text(q.note, 1000, true),
      },
    };
  throw new AccessError(400, 'Unsupported Business Operations action.');
}
