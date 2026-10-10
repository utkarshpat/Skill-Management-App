import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
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
