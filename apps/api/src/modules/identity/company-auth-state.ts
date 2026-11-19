import { createHash } from 'node:crypto';
import sql from 'mssql';
import { withRuntimeDatabase } from '../../shared/database.js';

export interface CompanyAuthState<T extends { expiresAt: number }> {
  read(id: string): Promise<T | undefined>;
  take(id: string): Promise<T | undefined>;
  write(id: string, value: T): Promise<boolean>;
  remove(id: string): Promise<void>;
}

export function memoryCompanyAuthState<T extends { expiresAt: number }>(
  now = Date.now,
): CompanyAuthState<T> {
  const entries = new Map<string, T>();
  const read = (id: string) => {
    const entry = entries.get(id);
    if (entry && entry.expiresAt > now()) return entry;
    entries.delete(id);
  };
  return {
    async read(id) {
      return read(id);
    },
    async take(id) {
      const entry = read(id);
      entries.delete(id);
      return entry;
    },
    async write(id, entry) {
      for (const [key, item] of entries) if (item.expiresAt <= now()) entries.delete(key);
      if (entries.size >= 10_000) return false;
      entries.set(id, entry);
      return true;
    },
    async remove(id) {
      entries.delete(id);
    },
  };
}

export function sqlCompanyAuthState<T extends { expiresAt: number }>(
  namespace: 'SESSION' | 'OIDC',
): CompanyAuthState<T> {
  const run = async (operation: string, id: string, value?: T) =>
    withRuntimeDatabase(async pool => {
      const response = await pool
        .request()
        .input('kind', sql.VarChar(7), namespace)
        .input('operation', sql.VarChar(6), operation)
        .input('entry_hash', sql.VarBinary(32), createHash('sha256').update(id).digest())
        .input('expires_at', sql.DateTime2, value ? new Date(value.expiresAt) : null)
        .input('payload', sql.NVarChar(sql.MAX), value ? JSON.stringify(value) : null)
        .execute('dbo.CompanyAuthStateAccess');
      return response.recordset?.[0];
    });
  const load = async (operation: 'READ' | 'TAKE', id: string) => {
    const row = await run(operation, id);
    return row?.payload ? (JSON.parse(row.payload) as T) : undefined;
  };
  return {
    read: id => load('READ', id),
    take: id => load('TAKE', id),
    async write(id, value) {
      return (await run('WRITE', id, value))?.saved === true;
    },
    async remove(id) {
      await run('DELETE', id);
    },
  };
}
