import { measureDatabase, measureDatabasePhase, databaseRetryListener } from './request-timing.js';
import { timedSqlCredential } from './database-credential.js';
import { SharedDatabasePool } from './shared-database-pool.js';
import { EventEmitter } from 'node:events';
import {
  DefaultAzureCredential,
  ClientSecretCredential,
  ManagedIdentityCredential,
} from '@azure/identity';
import sql from 'mssql';
import { DatabaseAvailability } from './database-availability.js';

export function databaseConfig(env: NodeJS.ProcessEnv): sql.config {
  const server = env.AZURE_SQL_SERVER?.trim();
  const database = env.AZURE_SQL_DATABASE?.trim();
  if (!server || !database)
    throw new Error('Set AZURE_SQL_SERVER and AZURE_SQL_DATABASE in apps/api/.env.');
  if (!/^[a-z0-9-]+\.database\.windows\.net$/i.test(server))
    throw new Error('AZURE_SQL_SERVER must be an Azure SQL hostname.');
  if (!/^[a-zA-Z0-9_-]+$/.test(database))
    throw new Error('AZURE_SQL_DATABASE must be a database name.');
  const validation = env.AZURE_SQL_CONNECTION_VALIDATION?.trim() || 'socket';
  if (!['socket', 'query'].includes(validation))
    throw new Error('AZURE_SQL_CONNECTION_VALIDATION must be socket or query.');
  return {
    server,
    database,
    authentication: {
      type: 'token-credential',
      options: { credential: new DefaultAzureCredential() },
    },
    options: { encrypt: true, trustServerCertificate: false },
    // The pinned Tedious driver checks protocol/socket health without issuing
    // SELECT 1 before every checkout. Query errors still propagate; no replay.
    validateConnection: validation === 'query' ? true : 'socket',
    connectionTimeout: 30000,
    requestTimeout: 30000,
    pool: { min: 0, max: 2, idleTimeoutMillis: 10000 },
  };
}

// Short-lived setup connections are always closed so free serverless SQL can pause.
export async function withDatabase<T>(
  action: (pool: sql.ConnectionPool) => Promise<T>,
): Promise<T> {
  const pool = new sql.ConnectionPool(databaseConfig(process.env));
  try {
    await pool.connect();
    return await action(pool);
  } finally {
    await pool.close();
  }
}

const runtimePool = new SharedDatabasePool(connectRuntime);
const availability = new DatabaseAvailability();
async function connectRuntime() {
  const {
    ENTRA_TENANT_ID: tenant,
    AZURE_SQL_CLIENT_ID: client,
    AZURE_SQL_CLIENT_SECRET: secret,
  } = process.env;
  const config = databaseConfig(process.env);
  config.beforeConnect = connection => {
    const retry = databaseRetryListener();
    // Tedious emits retry; its public overload list omits this event. Use the
    // inherited EventEmitter API without enabling driver debug/payload logging.
    if (retry) EventEmitter.prototype.on.call(connection, 'retry', retry);
  };
  if (process.env.AZURE_SQL_RUNTIME_AUTH === 'managed-identity') {
    config.authentication = {
      type: 'token-credential',
      options: {
        credential: timedSqlCredential(
          new ManagedIdentityCredential(
            process.env.AZURE_SQL_MANAGED_IDENTITY_CLIENT_ID
              ? { clientId: process.env.AZURE_SQL_MANAGED_IDENTITY_CLIENT_ID }
              : {},
          ),
        ),
      },
    };
  } else {
    if (!tenant || !client || !secret)
      throw new Error('Restricted SQL runtime identity is not configured.');
    config.authentication = {
      type: 'token-credential',
      options: {
        credential: timedSqlCredential(new ClientSecretCredential(tenant, client, secret)),
      },
    };
  }
  const pool = new sql.ConnectionPool(config);
  try {
    await measureDatabasePhase('connect', () => pool.connect());
    return pool;
  } catch (error) {
    await pool.close();
    throw error;
  }
}
export async function withRuntimeDatabase<T>(
  action: (pool: sql.ConnectionPool) => Promise<T>,
): Promise<T> {
  return measureDatabase(() =>
    availability.run(async () => {
      const pool = await measureDatabasePhase('acquire', () => runtimePool.get());
      return measureDatabasePhase('operation', () => action(pool));
    }),
  );
}
export async function closeRuntimeDatabase() {
  await runtimePool.close();
}
