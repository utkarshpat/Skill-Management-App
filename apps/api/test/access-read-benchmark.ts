// Read-only SQL benchmark. Outputs timings/counts only, never identities or payloads.
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { SqlAccessStore } from '../src/modules/access/sql-access-store.js';
import { can } from '../src/modules/access/local-access-store.js';
import { closeRuntimeDatabase } from '../src/shared/database.js';
const account = process.env.ACCESS_ACCOUNT_ID;
assert.ok(account);
try {
  const store = new SqlAccessStore(account);
  const start = performance.now(),
    initial = await store.snapshot({ includeAudit: false });
  console.log(
    JSON.stringify({
      kind: 'connection-and-workspace',
      ms: Math.round(performance.now() - start),
      people: initial.people.length,
      roles: initial.roles.length,
    }),
  );
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
