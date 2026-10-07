import sql from 'mssql';
import { withRuntimeDatabase } from '../../shared/database.js';
import { AccessError } from '../../shared/errors.js';
import {
  organizationChange,
  identifier,
  type OrganizationStore,
  type OrganizationState,
  type OrgNode,
  type OrgAssignment,
  type OrgPerson,
  type OwnOrganization,
} from './organization.js';
export class SqlOrganizationStore implements OrganizationStore {
  constructor(private accountId: string) {
    identifier(accountId);
  }
  async ownOrganization(actorId: string): Promise<OwnOrganization> {
    identifier(actorId);
    try {
      return await withRuntimeDatabase(async pool => {
        const result = await pool
          .request()
          .input('account_id', sql.UniqueIdentifier, this.accountId)
          .input('actor_id', sql.UniqueIdentifier, actorId)
          .execute('dbo.ReadOwnOrganization');
        const row: OwnOrganization | undefined = result.recordset[0];
        if (!row) throw new AccessError(404, 'Your organization details are unavailable.');
        return row;
      });
    } catch (error) {
      const number = (error as { number?: number }).number;
      if (number === 51003)
        throw new AccessError(403, 'Your current permissions do not allow viewing this profile.');
      if (number === 51004) throw new AccessError(404, 'Your workspace is unavailable.');
      throw error;
    }
  }
  async snapshot(): Promise<OrganizationState> {
    return withRuntimeDatabase(async pool => {
      const result = await pool
        .request()
        .input('account_id', sql.UniqueIdentifier, this.accountId)
        .execute('dbo.ReadOrganization');
      const sets = result.recordsets as unknown as [
        sql.IRecordSet<{ revision: number }>,
        sql.IRecordSet<OrgNode>,
        sql.IRecordSet<OrgAssignment>,
        sql.IRecordSet<OrgPerson>,
      ];
      return {
        revision: sets[0][0].revision,
        nodes: sets[1].map(row => ({
          ...row,
          id: row.id.toLowerCase(),
          parentId: row.parentId?.toLowerCase() ?? null,
        })),
        assignments: sets[2].map(row => ({
          personId: row.personId.toLowerCase(),
          teamId: row.teamId?.toLowerCase() ?? null,
          departmentId: row.departmentId?.toLowerCase() ?? null,
          managerId: row.managerId?.toLowerCase() ?? null,
        })),
        people: sets[3].map(row => ({ ...row, id: row.id.toLowerCase() })),
      };
    });
  }
  async save(actorId: string, input: unknown) {
    const change = organizationChange(input);
    try {
      await withRuntimeDatabase(pool =>
        pool
          .request()
          .input('account_id', sql.UniqueIdentifier, this.accountId)
          .input('actor_id', sql.UniqueIdentifier, actorId)
          .input('expected_revision', sql.Int, change.revision)
          .input('kind', sql.VarChar(20), change.kind)
          .input('target_id', sql.UniqueIdentifier, change.targetId)
          .input('is_new', sql.Bit, change.isNew)
          .input('payload', sql.NVarChar(sql.MAX), JSON.stringify(change.payload))
          .execute('dbo.SaveOrganizationChange'),
      );
    } catch (error) {
      const number = (error as { number?: number }).number;
      if (number === 51009)
        throw new AccessError(409, 'Configuration changed. Reload and try again.');
      if (number === 51003)
        throw new AccessError(403, 'Organization administration is not assigned.');
      if (number === 51004) throw new AccessError(404, 'Workspace record unavailable.');
      if (number === 51000) throw new AccessError(400, (error as Error).message);
      if ([2601, 2627].includes(number ?? 0))
        throw new AccessError(400, 'This name already exists under the selected parent.');
      if (number === 547) throw new AccessError(400, 'Choose records from this workspace.');
      throw error;
    }
  }
}
