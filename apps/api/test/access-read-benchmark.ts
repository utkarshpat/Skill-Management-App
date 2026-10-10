// Read-only SQL benchmark. Outputs timings/counts only, never identities or payloads.
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import type sql from 'mssql';
import { SqlAccessStore } from '../src/modules/access/sql-access-store.js';
import { can } from '../src/modules/access/local-access-store.js';
import { closeRuntimeDatabase, withRuntimeDatabase } from '../src/shared/database.js';
import { startRequestTiming } from '../src/shared/request-timing.js';
const account = process.env.ACCESS_ACCOUNT_ID;
assert.ok(account);
try {
  const store = new SqlAccessStore(account);
  const startedAt = new Date().toISOString();
  const timing = startRequestTiming();
  const initial = await timing.run(() => store.snapshot({ includeAudit: false }));
  console.log(
    JSON.stringify({
      kind: 'connection-and-workspace',
      startedAt,
      ...timing.result(),
      people: initial.people.length,
      roles: initial.roles.length,
    }),
  );
  // A/B on the same warm pool, alternating modes to reduce ordering bias.
  // This CLI changes only its own connection configuration, never SQL data.
  const pool = await withRuntimeDatabase(async connection => connection);
  // The pinned driver's config property is exposed at runtime, but omitted by
  // @types/mssql. This benchmark-only override is restored before continuing.
  const config = (pool as typeof pool & { config: sql.config }).config;
  const validation = config.validateConnection;
  try {
    for (let sample = 0; sample < 5; sample++)
      for (const mode of sample % 2
        ? (['socket', 'query'] as const)
        : (['query', 'socket'] as const)) {
        config.validateConnection = mode === 'query' ? true : 'socket';
        const at = performance.now();
        await store.snapshot({ includeAudit: false });
        console.log(
          JSON.stringify({
            kind: 'warm-validation-comparison',
            mode,
            sample,
            ms: Math.round(performance.now() - at),
          }),
        );
      }
  } finally {
    config.validateConnection = validation;
  }
  for (let sample = 0; sample < 3; sample++) {
    const at = performance.now(),
      state = await store.snapshot({ includeAudit: false });
    console.log(
      JSON.stringify({
        kind: 'workspace',
        sample,
        ms: Math.round(performance.now() - at),
        bytes: Buffer.byteLength(JSON.stringify(state)),
        people: state.people.length,
        roles: state.roles.length,
        audit: state.audit.length,
      }),
    );
  }
  const selected = [
    initial.people.find(p => p.active && p.hasDirectReports),
    initial.people.find(p => p.active && !p.hasDirectReports),
  ];
  for (const [index, actor] of selected.entries())
    if (actor)
      for (let sample = 0; sample < 3; sample++) {
        const at = performance.now(),
          state = await store.actorSnapshot(actor.id);
        console.log(
          JSON.stringify({
            kind: index === 0 ? 'manager-context' : 'personal-context',
            sample,
            ms: Math.round(performance.now() - at),
            bytes: Buffer.byteLength(JSON.stringify(state)),
            people: state.people.length,
            roles: state.roles.length,
            audit: state.audit.length,
          }),
        );
      }
  const admin = initial.people.find(p => can(initial, p, 'audit.view'));
  if (admin) {
    const at = performance.now(),
      history = await store.snapshot();
    console.log(
      JSON.stringify({
        kind: 'full-audit',
        ms: Math.round(performance.now() - at),
        bytes: Buffer.byteLength(JSON.stringify(history.audit)),
        rows: history.audit.length,
      }),
    );
    const pageAt = performance.now(),
      page = await store.auditPage(admin.id, { query: '', pageSize: 25, details: false });
    console.log(
      JSON.stringify({
        kind: 'audit-page',
        ms: Math.round(performance.now() - pageAt),
        bytes: Buffer.byteLength(JSON.stringify(page)),
        rows: page.items.length,
        hasMore: page.hasMore,
      }),
    );
  }
} finally {
  await closeRuntimeDatabase();
}
