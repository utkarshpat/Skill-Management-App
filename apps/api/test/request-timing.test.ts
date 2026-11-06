import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { channel, tracingChannel } from 'node:diagnostics_channel';
import {
  startRequestTiming,
  measureDatabase,
  measureDatabasePhase,
  databaseRetryListener,
} from '../src/shared/request-timing.js';
import { timedSqlCredential } from '../src/shared/database-credential.js';
import { createApp } from '../src/create-app.js';
test('overlapping request contexts count only their own database work, including failures', async () => {
  const first = startRequestTiming(),
    second = startRequestTiming();
  const run = (timing: ReturnType<typeof startRequestTiming>, fail: boolean) =>
    new Promise<void>((resolve, reject) =>
      timing.run(() => {
        void measureDatabase(async () => {
          await new Promise<void>(done => setImmediate(done));
          if (fail) throw Error('SQL failure');
        }).then(resolve, reject);
      }),
    );
  await Promise.all([run(first, false), assert.rejects(run(second, true), /SQL failure/)]);
  assert.equal(first.result().databaseCalls, 1);
  assert.equal(second.result().databaseCalls, 1);
  assert.ok(first.result().databaseMs >= 0);
  assert.ok(second.result().durationMs >= 0);
});
test('database phases preserve credential inputs, return values and failure identity', async () => {
  const timing = startRequestTiming();
  const scopes = ['https://database.windows.net/.default'];
  const options = { abortSignal: new AbortController().signal };
  const token = { token: 'never-log-this-token', expiresOnTimestamp: 1 };
  let calls = 0;
  const failure = Error('Credential unavailable');
  const credential = {
    getToken: async (received: string | string[], receivedOptions?: object) => {
      assert.equal(received, scopes);
      assert.equal(receivedOptions, options);
      calls++;
      if (calls === 2) throw failure;
      return token;
    },
  };
  const wrapped = timedSqlCredential(credential);
  assert.equal(
    await timing.run(() =>
      measureDatabase(() =>
        measureDatabasePhase('acquire', () =>
          measureDatabasePhase('connect', () => wrapped.getToken(scopes, options)),
        ),
      ),
    ),
    token,
  );
  await timing.run(() =>
    assert.rejects(wrapped.getToken(scopes, options), error => error === failure),
  );
  await timing.run(() => measureDatabasePhase('operation', async () => 42));
  const result = timing.result();
  assert.equal(result.databaseCalls, 1);
  assert.equal(result.databasePhases.token.calls, 2);
  assert.equal(result.databasePhases.connect.calls, 1);
  assert.equal(result.databasePhases.acquire.calls, 1);
  assert.equal(result.databasePhases.operation.calls, 1);
  for (const span of Object.values(result.databasePhases)) assert.ok(span.ms >= 0);
  assert.ok(!JSON.stringify(result).includes(token.token));
  assert.equal(startRequestTiming().result().databasePhases.token.calls, 0);
});

test('deferred connection retry events stay with the initiating timing context', () => {
  const first = startRequestTiming(),
    second = startRequestTiming();
  const retry = first.run(databaseRetryListener);
  assert.ok(retry);
  second.run(() => {
    retry();
    retry();
  });
  assert.equal(first.result().databaseConnectionRetries, 2);
  assert.equal(second.result().databaseConnectionRetries, 0);
  assert.equal(databaseRetryListener(), undefined);
});
test('driver checkout timing tracks concurrent requests and ignores work outside HTTP timing', async () => {
  const first = startRequestTiming(),
    second = startRequestTiming();
  const checkout = tracingChannel('mssql:pool:acquire');
  const created = channel('mssql:connection:create');
  const trace = (create: boolean, fail = false) =>
    checkout.tracePromise(async () => {
      await new Promise<void>(resolve => setImmediate(resolve));
      if (create) created.publish({ server: 'private-server', database: 'private-database' });
      if (fail) throw Error('Pool unavailable');
      return 42;
    }, {});
  await Promise.all([
    first.run(async () => {
      assert.equal(await trace(true), 42);
      await trace(false);
    }),
    second.run(() => assert.rejects(trace(false, true), /Pool unavailable/)),
    trace(true),
  ]);
  assert.equal(first.result().databasePhases.checkout.calls, 2);
  assert.equal(second.result().databasePhases.checkout.calls, 1);
  assert.equal(first.result().databasePhysicalConnections, 1);
  assert.equal(second.result().databasePhysicalConnections, 0);
  assert.equal(first.result().databasePhases.acquire.calls, 0);
  assert.doesNotMatch(JSON.stringify(first.result()), /private-server|private-database/);
});
test('HTTP timing uses route templates without query strings and cannot break a response', async () => {
  const metrics: any[] = [];
  const server = createApp(undefined, {
    onRequestTiming: metric => {
      metrics.push(metric);
      throw Error('Logger failure');
    },
  }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const address = server.address() as { port: number };
    const response = await fetch(
      `http://127.0.0.1:${address.port}/api/health?private=never-log-this`,
    );
    assert.equal(response.status, 200);
    await response.text();
    assert.equal(metrics[0].route, '/api/health');
    assert.equal(metrics[0].databaseCalls, 0);
    assert.ok(!JSON.stringify(metrics).includes('never-log-this'));
    assert.equal(metrics[0].requestId, response.headers.get('X-Request-Id'));
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
