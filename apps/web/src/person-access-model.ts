export type ExceptionScope = 'OWN' | 'ORGANIZATION';
export interface ExceptionPermission {
  code: string;
  label: string;
  implemented?: boolean;
  scopes?: ExceptionScope[];
}

// Server metadata is discovery, not an authority inferred from a permission name.
export function exceptionPermissions(catalogue: ExceptionPermission[]) {
  return catalogue
    .filter(p => p.implemented === true)
    .map(p => ({ ...p, scopes: (p.scopes ?? []).filter(s => s === 'OWN' || s === 'ORGANIZATION') }))
    .filter(p => p.scopes.length > 0);
}
export function exceptionSelection(
  catalogue: ExceptionPermission[],
  code: string,
  scope: ExceptionScope,
) {
  const permissions = exceptionPermissions(catalogue);
  const permission = permissions.find(p => p.code === code) ?? permissions[0];
  return {
    permission,
    scope: permission?.scopes?.includes(scope) ? scope : permission?.scopes?.[0],
  };
}
export function templateAssignable(
  rules: { permission: string; scope: ExceptionScope }[],
  catalogue: ExceptionPermission[],
) {
  const permissions = exceptionPermissions(catalogue);
  return rules.every(rule =>
    permissions.some(p => p.code === rule.permission && p.scopes.includes(rule.scope)),
  );
}
export function localDate(value: Date) {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
}
export function exceptionExpiry(value: string, now = new Date()) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw Error('Choose a valid expiry date.');
  const [year, month, day] = value.split('-').map(Number);
  const end = new Date(year, month - 1, day, 23, 59, 59, 999);
  if (!Number.isFinite(end.getTime()) || localDate(end) !== value)
    throw Error('Choose a valid expiry date.');
  if (end <= now) throw Error('Expiration date must be in the future.');
  return end.toISOString();
}
