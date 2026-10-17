// Read-only A/B. Changes idle retention only in this CLI's private driver pool.
// Prints durations/counts, never identities, credentials or SQL payloads.
import assert from 'node:assert/strict';
import { channel } from 'node:diagnostics_channel';
import { setTimeout as delay } from 'node:timers/promises';
import { SqlAccessStore } from '../src/modules/access/sql-access-store.js';
import { closeRuntimeDatabase, withRuntimeDatabase } from '../src/shared/database.js';
import { startRequestTiming } from '../src/shared/request-timing.js';

const account = process.env.ACCESS_ACCOUNT_ID;
assert.ok(account, 'A configured access account is required.');
const store = new SqlAccessStore(account);
let physicalCreates = 0;
const created = () => {
  physicalCreates++;
};
const events = channel('mssql:connection:create');
events.subscribe(created);
try {
  console.log(
    JSON.stringify({ kind: 'read-only-idle-benchmark-start', startedAt: new Date().toISOString() }),
  );
  const connection = await withRuntimeDatabase(async pool => pool);
  // Pinned node-mssql exposes its Tarn pool at runtime; this override is for
  // the benchmark only and never modifies the app configuration or Azure.
  const pool = (connection as typeof connection & { pool: { idleTimeoutMillis: number } }).pool;
  const originalIdle = pool.idleTimeoutMillis;
  try {
    for (const idleMs of [10_000, 60_000]) {
      pool.idleTimeoutMillis = idleMs;
      await store.snapshot({ includeAudit: false });
      const beforeCreates = physicalCreates;
      const idleStart = performance.now();
      await delay(13_000);
      const waitedMs = Math.round(performance.now() - idleStart);
      const timing = startRequestTiming();
      await timing.run(() => store.snapshot({ includeAudit: false }));
      console.log(
        JSON.stringify({
          kind: 'after-idle',
          idleMs,
          waitedMs,
          newPhysicalConnections: physicalCreates - beforeCreates,
          ...timing.result(),
        }),
      );
      const warm = startRequestTiming();
      await warm.run(() => store.snapshot({ includeAudit: false }));
      console.log(JSON.stringify({ kind: 'immediate-warm', idleMs, ...warm.result() }));
    }
  } finally {
    pool.idleTimeoutMillis = originalIdle;
  }
} finally {
  events.unsubscribe(created);
  await closeRuntimeDatabase();
}
