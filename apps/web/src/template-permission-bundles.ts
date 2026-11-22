export interface TemplatePermission {
  permission: string;
  scope: 'OWN' | 'ORGANIZATION';
  effect: 'ALLOW' | 'DENY';
  validUntil?: string;
  reason?: string;
}
export interface PermissionMetadata {
  code: string;
  label: string;
  implemented?: boolean;
  scopes?: ('OWN' | 'ORGANIZATION')[];
}
const own = (permissions: string[]): TemplatePermission[] =>
  permissions.map(permission => ({ permission, scope: 'OWN', effect: 'ALLOW' }));
const organization = (permissions: string[]): TemplatePermission[] =>
  permissions.map(permission => ({ permission, scope: 'ORGANIZATION', effect: 'ALLOW' }));

const permissionBundles = [
  {
    id: 'basic',
    name: 'Basic user',
    description: 'Personal profile, skill claims, learning, requests and incidents.',
    permissions: [
      ...own([
        'profile.view',
        'skill.claim',
        'learning.view',
        'learning.manage',
        'request.create',
        'request.view',
        'request.assign',
        'request.resolve',
        'incident.create',
        'incident.view',
        'incident.assign',
        'incident.resolve',
      ]),
      ...organization(['skill.view']),
    ],
  },
  {
    id: 'catalogue',
    name: 'Catalogue management',
    description: 'Published catalogue access and skill catalogue management.',
    permissions: organization(['skill.view', 'skill.catalogue.manage']),
  },
  {
    id: 'reporting',
    name: 'Reporting',
    description: 'Existing report-view and export permissions at workspace scope.',
    permissions: organization(['reports.view', 'reports.export']),
  },
  {
    id: 'administration',
    name: 'Access administration',
    description: 'People, permissions and audit access.',
    permissions: organization(['users.manage', 'permissions.manage', 'audit.view']),
  },
];

const key = (assignment: Pick<TemplatePermission, 'permission' | 'scope'>) =>
  assignment.permission + ':' + assignment.scope;

export function availableBundles(catalogue: PermissionMetadata[]) {
  return permissionBundles.filter(bundle =>
    bundle.permissions.every(permission =>
      catalogue.some(
        item =>
          item.code === permission.permission &&
          item.implemented === true &&
          item.scopes?.includes(permission.scope),
      ),
    ),
  );
}
export function bundleSelected(value: TemplatePermission[], permissions: TemplatePermission[]) {
  return permissions.every(permission =>
    value.some(
      assignment =>
        key(assignment) === key(permission) &&
        assignment.effect === 'ALLOW' &&
        !assignment.validUntil &&
        !assignment.reason,
    ),
  );
}
export function toggleBundle(
  value: TemplatePermission[],
  permissions: TemplatePermission[],
  enabled: boolean,
) {
  if (enabled) {
    return [
      ...value,
      ...permissions.filter(
        permission => !value.some(assignment => key(assignment) === key(permission)),
      ),
    ];
  }
  return value.filter(
    assignment =>
      !permissions.some(
        permission =>
          key(permission) === key(assignment) &&
          assignment.effect === 'ALLOW' &&
          !assignment.validUntil &&
          !assignment.reason,
      ),
  );
}
