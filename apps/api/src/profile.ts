import sql from 'mssql';
import { withRuntimeDatabase } from './database.js';
import type { Identity } from './auth.js';

export interface Profile { id: string; displayName: string; employeeCode: string; organization: string; status: string; roles: string[]; canManageAccess?:boolean }
export async function ownProfile(identity: Identity): Promise<Profile | undefined> {
  return withRuntimeDatabase(async pool => {
    const result = await pool.request().input('tenant_id', sql.UniqueIdentifier, identity.tenantId)
      .input('object_id', sql.UniqueIdentifier, identity.objectId).execute('dbo.GetOwnProfile');
    const sets = result.recordsets as sql.IRecordSet<unknown>[];
    const row = sets[0]?.[0] as Omit<Profile, 'roles'> | undefined;
    if (!row) return undefined;
    return { ...row, roles: (sets[1] as sql.IRecordSet<{ role: string }> | undefined)?.map(role => role.role) ?? [] };
  });
}
