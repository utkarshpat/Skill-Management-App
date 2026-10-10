/** SQL FOR JSON emits UTC datetime2 without a zone; keep transport unambiguous. */
export function readSqlJson<T>(value: string): T {
  const identifiers = new Set([
    'id',
    'actorId',
    'personId',
    'projectId',
    'departmentId',
    'scopeId',
    'targetId',
    'providerId',
    'skillId',
    'roleId',
  ]);
  const utc = new Set([
    'asOf',
    'submittedAt',
    'reviewedAt',
    'createdAt',
    'decidedAt',
    'validUntil',
  ]);
  return JSON.parse(value, (key, v) => {
    if (typeof v !== 'string') return v;
    if (
      identifiers.has(key) &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)
    )
      return v.toLowerCase();
    if (utc.has(key) && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(v)) return v + 'Z';
    return v;
  }) as T;
}
