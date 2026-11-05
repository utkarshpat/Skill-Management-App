/** Presentation only; stored kinds, bindings and permission scopes are unchanged. */
export function organizationKindLabel(kind: string) {
  if (kind === 'PORTFOLIO') return 'Portfolio/Division';
  if (kind === 'DEPARTMENT') return 'Accounts/Clients';
  if (kind === 'TEAM' || kind === 'PROJECT') return 'Project';
  return kind.replaceAll('_', ' ');
}

export type OrganizationKind = 'DELIVERY_UNIT' | 'PORTFOLIO' | 'DEPARTMENT' | 'TEAM';
export const organizationParentKind: Record<OrganizationKind, OrganizationKind | null> = {
  DELIVERY_UNIT: null,
  PORTFOLIO: 'DELIVERY_UNIT',
  DEPARTMENT: 'PORTFOLIO',
  TEAM: 'DEPARTMENT',
};
export const organizationChildKind: Record<OrganizationKind, OrganizationKind | null> = {
  DELIVERY_UNIT: 'PORTFOLIO',
  PORTFOLIO: 'DEPARTMENT',
  DEPARTMENT: 'TEAM',
  TEAM: null,
};

export function organizationPathValid(
  nodes: { id: string; kind: OrganizationKind; parentId: string | null; active: boolean }[],
  id: string,
) {
  let cursor: string | null = id;
  let expected: OrganizationKind | undefined;
  for (let depth = 0; cursor && depth < 4; depth++) {
    const matches = nodes.filter(node => node.id === cursor);
    if (matches.length !== 1) return false;
    const node = matches[0];
    if (
      !node.active ||
      !Object.hasOwn(organizationParentKind, node.kind) ||
      (expected && node.kind !== expected)
    )
      return false;
    const parent = organizationParentKind[node.kind];
    if (parent === null) return node.parentId === null;
    expected = parent;
    cursor = node.parentId;
  }
  return false;
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
