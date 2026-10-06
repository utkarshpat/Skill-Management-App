import { test } from 'node:test';
import assert from 'node:assert/strict';
import { discoverDevelopmentLogin, parseDemoLogin } from '../src/development-login';

const roster = {
  mode: 'local-demo',
  signedIn: false,
  people: [
    {
      id: 'synthetic-person',
      displayName: 'Test Person',
      employeeCode: 'TEST-001',
      roles: ['Employee'],
    },
  ],
};
const noDelay = async () => {};

test('hosted login exposes a locked gate without a roster and validates gate metadata', async () => {
  const locked = { mode: 'local-demo', signedIn: false, people: [], requiresAccessCode: true };
  assert.deepEqual(
    await discoverDevelopmentLogin((async () => Response.json(locked)) as typeof fetch, noDelay),
    { status: 'available', people: [], signedIn: false, requiresAccessCode: true },
  );
  assert.throws(() => parseDemoLogin({ ...locked, requiresAccessCode: 'yes' }));
  assert.deepEqual(parseDemoLogin({ ...roster, requiresAccessCode: true }).people, roster.people);
});

test('development login recovers from a temporary service failure', async () => {
  let calls = 0;
  const transport = (async () =>
    ++calls === 1 ? new Response('', { status: 503 }) : Response.json(roster)) as typeof fetch;
  assert.deepEqual(await discoverDevelopmentLogin(transport, noDelay), {
    status: 'available',
    people: roster.people,
    signedIn: false,
  });
  assert.equal(calls, 2);
});

test('persistent failures stay visible and a later retry can recover', async () => {
  let calls = 0;
  const transport = (async () =>
    ++calls <= 2 ? new Response('', { status: 500 }) : Response.json(roster)) as typeof fetch;
  assert.deepEqual(await discoverDevelopmentLogin(transport, noDelay), {
    status: 'error',
    people: [],
    signedIn: false,
  });
  assert.equal((await discoverDevelopmentLogin(transport, noDelay)).status, 'available');
  assert.equal(calls, 3);
});

test('disabled endpoint is distinct from an unavailable service', async () => {
  let calls = 0;
  const transport = (async () => {
    calls++;
    return new Response('', { status: 404 });
  }) as typeof fetch;
  assert.deepEqual(await discoverDevelopmentLogin(transport, noDelay), {
    status: 'disabled',
    people: [],
    signedIn: false,
  });
  assert.equal(calls, 1);
});

test('an empty eligible roster remains an available development login', async () => {
  const transport = (async () => Response.json({ ...roster, people: [] })) as typeof fetch;
  assert.deepEqual(await discoverDevelopmentLogin(transport, noDelay), {
    status: 'available',
    people: [],
    signedIn: false,
  });
});

test('network failures and malformed responses cannot create a session', async () => {
  const transports = [
    async () => {
      throw new DOMException('Request timed out', 'TimeoutError');
    },
    async () => new Response('invalid JSON'),
    async () => Response.json({ ...roster, signedIn: 'true' }),
    async () => Response.json({ ...roster, people: [{ id: 'unknown' }] }),
    async () => Response.json({ ...roster, mode: 'production' }),
  ];
  for (const transport of transports)
    assert.deepEqual(await discoverDevelopmentLogin(transport as typeof fetch, noDelay), {
      status: 'error',
      people: [],
      signedIn: false,
    });
});

test('a validated existing development session is restored', async () => {
  const transport = (async () => Response.json({ ...roster, signedIn: true })) as typeof fetch;
  assert.equal((await discoverDevelopmentLogin(transport, noDelay)).signedIn, true);
});
