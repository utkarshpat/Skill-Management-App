import sql from 'mssql';
import { withRuntimeDatabase } from '../../shared/database.js';
import type { Identity } from './auth.js';
import type { OwnOrganization } from '../organization/index.js';
import type { PrimaryCapabilityDetails } from '../access/index.js';
import type { ProfileCompleteness } from './profile-completeness.js';

export interface Profile extends PrimaryCapabilityDetails {
  id: string;
  displayName: string;
  employeeCode: string;
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  jobTitle?: string | null;
  grade?: string | null;
  organization: string;
  status: string;
  roles: string[];
  canManageAccess?: boolean;
  canViewSkills?: boolean;
  organizationDetails?: OwnOrganization;
  completeness?: ProfileCompleteness;
}
export async function ownProfile(identity: Identity): Promise<Profile | undefined> {
  return withRuntimeDatabase(async pool => {
    const result = await pool
      .request()
      .input('tenant_id', sql.UniqueIdentifier, identity.tenantId)
      .input('object_id', sql.UniqueIdentifier, identity.objectId)
      .execute('dbo.GetOwnProfile');
    const sets = result.recordsets as sql.IRecordSet<unknown>[];
    const row = sets[0]?.[0] as Omit<Profile, 'roles'> | undefined;
    if (!row) return undefined;
    return {
      ...row,
      roles:
        (sets[1] as sql.IRecordSet<{ role: string }> | undefined)?.map(role => role.role) ?? [],
    };
  });
}
