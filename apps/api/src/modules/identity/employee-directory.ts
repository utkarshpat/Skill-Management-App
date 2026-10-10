import type { Identity } from './auth.js';
import { AccessError } from '../../shared/errors.js';

// Source facts only. Roles, grants, review assignments and application UUIDs
// belong to the local application and must never come from a directory payload.
export interface EmployeeDirectoryRecord {
  employeeCode: string;
  displayName: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  entraObjectId: string;
  active: boolean;
  managerEmployeeCode: string | null;
  deliveryUnit: string | null;
  department: string | null;
  team: string | null;
}

export interface EmployeeDirectoryQuery {
  // Constructed by the backend after token validation and local authorization.
  identity: Identity;
  stored: EmployeeDirectoryRecord;
}

export interface EmployeeDirectoryProvider {
  readonly source: 'stored' | 'external';
  readEmployee(query: EmployeeDirectoryQuery): Promise<EmployeeDirectoryRecord | undefined>;
}

// Existing authorized database reads supply the snapshot; no duplicate SQL reads.
export class StoredEmployeeDirectoryProvider implements EmployeeDirectoryProvider {
  readonly source = 'stored' as const;
  async readEmployee(query: EmployeeDirectoryQuery) {
    return { ...query.stored };
  }
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function validateEmployeeDirectoryRecord(value: unknown): EmployeeDirectoryRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new AccessError(502, 'Employee directory returned an invalid employee.');
  const row = value as Record<string, unknown>;
  const text = (key: string, limit: number, required = false): string | null => {
    const value = row[key];
    if (!required && value === null) return null;
    if (
      typeof value !== 'string' ||
      !value.trim() ||
      value.trim().length > limit ||
      /[\u0000-\u001f\u007f]/.test(value)
    )
      throw new AccessError(502, 'Employee directory returned invalid employee details.');
    return value.trim();
  };
  const employeeCode = text('employeeCode', 40, true)!;
  const displayName = text('displayName', 100, true)!;
  const entraObjectId = text('entraObjectId', 36, true)!;
  const email = text('email', 254);
  const managerEmployeeCode = text('managerEmployeeCode', 40);
  if (
    !uuid.test(entraObjectId) ||
    typeof row.active !== 'boolean' ||
    (email !== null && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) ||
    managerEmployeeCode?.toLowerCase() === employeeCode.toLowerCase()
  )
    throw new AccessError(502, 'Employee directory returned invalid employee identity.');
  // Construct an allow-listed DTO; arbitrary external roles/permissions are dropped.
  return {
    employeeCode,
    displayName,
    entraObjectId: entraObjectId.toLowerCase(),
    active: row.active,
    firstName: text('firstName', 100),
    lastName: text('lastName', 100),
    email,
    managerEmployeeCode,
    deliveryUnit: text('deliveryUnit', 100),
    department: text('department', 100),
    team: text('team', 100),
  };
}

export function validateDirectoryBinding(
  record: EmployeeDirectoryRecord,
  query: EmployeeDirectoryQuery,
) {
  if (
    record.entraObjectId !== query.identity.objectId.toLowerCase() ||
    record.entraObjectId !== query.stored.entraObjectId.toLowerCase() ||
    record.employeeCode !== query.stored.employeeCode
  )
    throw new AccessError(409, 'Employee directory identity needs reconciliation.');
  // Relationships must be persisted through audited synchronization before they
  // can be displayed as the relationships used by SQL authorization.
  for (const field of ['managerEmployeeCode', 'deliveryUnit', 'department', 'team'] as const)
    if (record[field] !== query.stored[field])
      throw new AccessError(409, 'Employee organization changes need synchronization.');
}
