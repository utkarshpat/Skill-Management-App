import { DefaultAzureCredential } from '@azure/identity';
import sql from 'mssql';

export function databaseConfig(env: NodeJS.ProcessEnv): sql.config {
  const server = env.AZURE_SQL_SERVER?.trim();
  const database = env.AZURE_SQL_DATABASE?.trim();
  if (!server || !database) throw new Error('Set AZURE_SQL_SERVER and AZURE_SQL_DATABASE in apps/api/.env.');
  if (!/^[a-z0-9-]+\.database\.windows\.net$/i.test(server)) throw new Error('AZURE_SQL_SERVER must be an Azure SQL hostname.');
  if (!/^[a-zA-Z0-9_-]+$/.test(database)) throw new Error('AZURE_SQL_DATABASE must be a database name.');
  return {
    server, database,
    authentication: { type: 'token-credential', options: { credential: new DefaultAzureCredential() } },
    options: { encrypt: true, trustServerCertificate: false },
    connectionTimeout: 30000,
    requestTimeout: 30000,
    pool: { min: 0, max: 2, idleTimeoutMillis: 10000 },
  };
}

// Short-lived setup connections are always closed so free serverless SQL can pause.
export async function withDatabase<T>(action: (pool: sql.ConnectionPool) => Promise<T>): Promise<T> {
  const pool = new sql.ConnectionPool(databaseConfig(process.env));
  try {
    await pool.connect();
    return await action(pool);
  } finally {
    await pool.close();
  }
}
