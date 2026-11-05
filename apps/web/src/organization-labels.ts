/** Presentation only; stored kinds, bindings and permission scopes are unchanged. */
export function organizationKindLabel(kind: string) {
  if (kind === 'DEPARTMENT') return 'Accounts/Clients';
  if (kind === 'TEAM' || kind === 'PROJECT') return 'Project';
  return kind.replaceAll('_', ' ');
}

export function organizationScopeLabel(scope: string) {
  const separator = scope.indexOf(':');
  return separator === -1
    ? organizationKindLabel(scope)
    : organizationKindLabel(scope.slice(0, separator)) + scope.slice(separator);
}

export function organizationPreviewText(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return JSON.stringify(value, null, 2);
  const labels: Record<string, string> = {
    id: 'Record ID',
    personId: 'Employee ID',
    departmentId: 'Accounts/Clients ID',
    teamId: 'Project ID',
    managerId: 'Reporting manager ID',
    parentId: 'Parent ID',
    type: 'Level',
    kind: 'Level',
    name: 'Name',
    active: 'Active',
  };
  return JSON.stringify(
    Object.fromEntries(
      Object.entries(value).map(([key, raw]) => [
        labels[key] ?? key,
        (key === 'kind' || key === 'type') && typeof raw === 'string'
          ? organizationKindLabel(raw)
          : raw,
      ]),
    ),
    null,
    2,
  );
}
