import {
  currentRequestId,
  databaseRetryListener,
  measureDatabase,
  measureDatabasePhase,
  measureDatabaseProcedure,
  startRequestTiming,
  type TimedProcedure,
} from './request-timing.js';
import { errorType, logEvent } from './logger.js';
import { timedSqlCredential } from './database-credential.js';
import { SharedDatabasePool } from './shared-database-pool.js';
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
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
  const idleSetting = env.AZURE_SQL_POOL_IDLE_TIMEOUT_MS?.trim();
  const idleTimeoutMillis = idleSetting ? Number(idleSetting) : 60_000;
  if (
    (idleSetting && !/^\d+$/.test(idleSetting)) ||
    !Number.isInteger(idleTimeoutMillis) ||
    idleTimeoutMillis < 1_000 ||
    idleTimeoutMillis > 300_000
  )
    throw new Error('AZURE_SQL_POOL_IDLE_TIMEOUT_MS must be an integer from 1000 to 300000.');
  const poolSetting = env.AZURE_SQL_POOL_MAX?.trim();
  const poolMax = poolSetting ? Number(poolSetting) : 2;
  if ((poolSetting && !/^\d+$/.test(poolSetting)) || poolMax < 1 || poolMax > 10)
    throw new Error('AZURE_SQL_POOL_MAX must be an integer from 1 to 10.');
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
    // Reuse connections between ordinary page interactions without keeping
    // any connections permanently open or sending background keep-alives.
    pool: { min: 0, max: poolMax, idleTimeoutMillis },
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
          new ManagedIdentityCredential({
            clientId: process.env.AZURE_SQL_MANAGED_IDENTITY_CLIENT_ID || undefined,
          }),
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
  procedure?: TimedProcedure,
): Promise<T> {
  try {
    return await measureDatabase(() =>
      availability.run(async () => {
        const pool = await measureDatabasePhase('acquire', () => runtimePool.get());
        return measureDatabasePhase('operation', () =>
          procedure ? measureDatabaseProcedure(procedure, () => action(pool)) : action(pool),
        );
      }),
    );
  } catch (error) {
    logEvent('error', 'database.request_failed', {
      requestId: currentRequestId(),
      errorType: errorType(error),
    });
    throw error;
  }
}
export async function closeRuntimeDatabase() {
  await runtimePool.close();
}

export async function warmRuntimeDatabase() {
  const requestId = randomUUID();
  const timing = startRequestTiming(requestId);
  try {
    await timing.run(async () => {
      const pool = await runtimePool.get();
      // mssql discards its initial test connection. A query leaves a reusable
      // connection in the existing pool until the normal idle timeout.
      await pool.request().query('SELECT 1');
    });
    logEvent('info', 'database.startup_warmup_completed', { requestId, ...timing.result() });
  } catch (error) {
    // Let the app start and allow ordinary requests to recover if SQL is down.
    logEvent('warn', 'database.startup_warmup_failed', {
      requestId,
      ...timing.result(),
      errorType: errorType(error),
    });
  }
}
