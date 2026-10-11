import type { Assignment } from './local-access-store.js';
import type { PermissionCode } from './access-catalogue.js';

type PlannedScope = 'OWN' | 'ORGANIZATION' | 'TEAM' | 'DEPARTMENT' | 'DELIVERY_UNIT' | 'CAPABILITY';
export interface RolePreset {
  key: string;
  name: string;
  description: string;
  permissions: Assignment[];
  pending: { permission: PermissionCode; scope: PlannedScope }[];
  assignmentMode?: 'RESPONSIBILITY';
}
const own: PermissionCode[] = [
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
      'Own profile, claims, evidence, learning, requests and incidents; published skills.',
    permissions: employee(),
    pending: planned('OWN', ['profile.edit', 'evidence.view', 'evidence.submit']),
  },
  {
    key: 'manager',
    name: 'Manager',
    description:
      'Employee access plus current direct-report reviews, team insights and recommendations; reporting and assigned-review checks remain mandatory.',
    permissions: [
      ...employee(),
      { permission: 'skill.verify', scope: 'ORGANIZATION', effect: 'ALLOW' },
    ],
    pending: [],
  },
  {
    key: 'business-analytics',
    name: 'Business Analytics',
    description:
      'Explicit organization, delivery-unit, department or project responsibility. Manage through People & access profiles.',
    assignmentMode: 'RESPONSIBILITY',
    permissions: [],
    pending: [],
  },
  {
    key: 'admin',
    name: 'Admin',
    description:
      'Explicit organization responsibility for catalogue, audit, people/access and Business Analytics. Manage through People & access profiles.',
    assignmentMode: 'RESPONSIBILITY',
    permissions: [],
    pending: [],
  },
];
