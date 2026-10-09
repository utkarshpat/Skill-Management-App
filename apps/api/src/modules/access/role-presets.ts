import type { Assignment } from './local-access-store.js';
import type { PermissionCode } from './access-catalogue.js';

type PlannedScope = 'OWN' | 'ORGANIZATION' | 'TEAM' | 'DEPARTMENT' | 'DELIVERY_UNIT' | 'CAPABILITY';
export interface RolePreset {
  key: string;
  name: string;
  description: string;
  permissions: Assignment[];
  pending: { permission: PermissionCode; scope: PlannedScope }[];
}
const own: PermissionCode[] = [
  'profile.view',
  'certification.view',
  'certification.manage',
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
];
const employee = (): Assignment[] => [
  ...own.map(permission => ({ permission, scope: 'OWN' as const, effect: 'ALLOW' as const })),
  { permission: 'skill.view', scope: 'ORGANIZATION', effect: 'ALLOW' },
];
const planned = (scope: PlannedScope, permissions: PermissionCode[]) =>
  permissions.map(permission => ({ permission, scope }));

// Editable starting points, never runtime role-name authority. Unsupported scopes
// remain proposals and must not be widened to ORGANIZATION during provisioning.
export const rolePresets: RolePreset[] = [
  {
    key: 'employee',
    name: 'Employee',
    description:
      'Own profile, certifications, claims, learning, requests and incidents; published skills.',
    permissions: employee(),
    pending: planned('OWN', ['profile.edit', 'evidence.view', 'evidence.submit']),
  },
  {
    key: 'manager',
    name: 'Manager',
    description:
      'Employee access plus assigned direct-report skill reviews; team assessments and insights remain planned.',
    permissions: [
      ...employee(),
      { permission: 'skill.verify', scope: 'ORGANIZATION', effect: 'ALLOW' },
    ],
    pending: planned('TEAM', [
      'profile.view',
      'assessment.view',
      'assessment.approve',
      'evidence.view',
      'learning.view',
      'reports.view',
    ]),
  },
  {
    key: 'department-head',
    name: 'Department Head',
    description: 'Employee access plus department insights and skill proposals.',
    permissions: employee(),
    pending: [
      ...planned('DEPARTMENT', ['reports.view']),
      ...planned('CAPABILITY', ['skill.catalogue.propose']),
    ],
  },
  {
    key: 'delivery-unit-head',
    name: 'Delivery Unit Head',
    description: 'Employee access plus delivery unit insights and skill proposals.',
    permissions: employee(),
    pending: [
      ...planned('DELIVERY_UNIT', ['reports.view']),
      ...planned('CAPABILITY', ['skill.catalogue.propose']),
    ],
  },
  {
    key: 'chro',
    name: 'CHRO',
    description: 'Employee access plus organization reports and skill proposals.',
    permissions: employee(),
    pending: [
      ...planned('ORGANIZATION', ['reports.view']),
      ...planned('CAPABILITY', ['skill.catalogue.propose']),
    ],
  },
  {
    key: 'capability-lead',
    name: 'Capability Lead',
    description: 'Employee access plus capability catalogue governance and insights.',
    permissions: employee(),
    pending: planned('CAPABILITY', ['skill.catalogue.manage', 'reports.view']),
  },
];
