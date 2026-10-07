// Local-only characterization of open findings; no SQL or real AI calls.
// Run: node --import tsx apps/api/test/security-audit.repro.ts
import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { Request } from 'express';
import { createApp } from '../src/create-app.js';
import { LocalAccessStore } from '../src/modules/access/local-access-store.js';
import { createDevelopmentSessions } from '../src/modules/identity/development-login.js';
import { AssistantService } from '../src/modules/ai/assistant.js';

const store = await LocalAccessStore.open();
const actor = store.snapshot().people[0].id;
const config = {
  origin: 'https://audit.example',
  accessCode: 'local-audit-only',
  sessionSecret: 'local-audit-signing-secret-at-least-32-characters',
};
const sessions = createDevelopmentSessions(store, () => 1000, config);
const token = await sessions.issue(actor);
assert.ok(token);
const request = {
  get: (name: string) =>
    name.toLowerCase() === 'host'
      ? 'audit.example'
      : name.toLowerCase() === 'cookie'
        ? `skill_dev_session=${token}`
        : undefined,
} as Request;
sessions.revoke(request);
assert.equal(sessions.subject(request), actor);
assert.equal(createDevelopmentSessions(store, () => 1000, config).subject(request), actor);
console.log('CONFIRMED: hosted cookie remains valid after revoke, including on a second instance.');

const server = createApp(undefined, { developmentStore: store, hostedDemo: config }).listen(
  0,
  '127.0.0.1',
);
await once(server, 'listening');
const address = server.address();
assert.ok(address && typeof address !== 'string');
const base = `http://127.0.0.1:${address.port}`;
config.origin = `https://127.0.0.1:${address.port}`;
try {
  const headers = { Origin: config.origin, 'Content-Type': 'application/json' };
  for (let i = 0; i < 25; i++) {
    const response = await fetch(base + '/api/dev-login/people', {
      method: 'POST',
      headers,
      body: JSON.stringify({ accessCode: 'incorrect' }),
    });
    assert.equal(response.status, 403);
    await response.arrayBuffer();
  }
  const response = await fetch(base + '/api/dev-login/people', {
    method: 'POST',
    headers,
    body: JSON.stringify({ accessCode: config.accessCode }),
  });
  assert.equal(response.status, 200);
  await response.arrayBuffer();
  console.log(
    'CONFIRMED: 25 failed local PIN attempts produce no throttle; next valid attempt succeeds.',
  );
} finally {
  await new Promise<void>((resolve, reject) => server.close(e => (e ? reject(e) : resolve())));
}

let calls = 0;
const provider = {
  name: 'audit-stub',
  complete: async () => {
    calls++;
    return { content: 'Local stub response.', calls: [] };
  },
};
const first = new AssistantService(store, undefined, provider);
const input = { messages: [{ role: 'user', content: 'Explain my workspace' }] };
for (let i = 0; i < 10; i++) await first.chat(actor, input);
await assert.rejects(
  first.chat(actor, input),
  (e: unknown) => (e as { status?: number }).status === 429,
);
await new AssistantService(store, undefined, provider).chat(actor, input);
assert.equal(calls, 11);
console.log(
  'CONFIRMED: second assistant instance admits the same actor after first instance rate limit.',
);
