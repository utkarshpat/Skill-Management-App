import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createApp } from '../src/create-app.js';
import { LocalAccessStore } from '../src/modules/access/local-access-store.js';
import type { CapabilitySubmissionStore } from '../src/modules/skills/capability-submissions.js';
const id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  cert = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  file = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
test('capability file HTTP contract binds verified owner, hides private keys and validates staging/autofill before provider IO', async t => {
  const current = (await LocalAccessStore.open()).snapshot(),
    actor = current.people[0].id;
  current.people[0] = {
    ...current.people[0],
    displayName: 'Aditi Menon',
    employeeCode: 'EMP-1042',
    roleIds: [],
    overrides: [
      { permission: 'profile.view', scope: 'OWN', effect: 'ALLOW' },
      { permission: 'skill.claim', scope: 'OWN', effect: 'ALLOW' },
      { permission: 'skill.view', scope: 'ORGANIZATION', effect: 'ALLOW' },
    ],
  };
  const access = LocalAccessStore.fromState(current),
    calls: { actor: string; operation: string; payload: unknown }[] = [];
  let pending = false,
    mime = 'text/plain',
    fileReady = true,
    autofills = 0;
  const item = () => ({
    id: file,
    blobName: 'private/account/secret-key',
    fileName: 'oracle-sql.txt',
    mimeType: mime,
    bytes: 3,
  });
  const storage: CapabilitySubmissionStore = {
    storageConfigured: true,
    run: async (caller, operation, payload) => {
      calls.push({ actor: caller, operation, payload });
      return { records: [], links: [], id, revision: 2 };
    },
    stage: async (caller, record, credential, revision, source, type, name) => {
      assert.equal(caller, actor);
      assert.equal(record, id);
      assert.equal(credential, cert);
      assert.equal(revision, 2);
      assert.equal(source.toString(), 'SQL');
      assert.equal(type, 'text/plain');
      assert.equal(name, 'oracle-sql.txt');
      return pending ? { pending: true } : { revision: 3, items: [item()] };
    },
    stagedFiles: async () => ({ revision: 3, items: [item()] }),
    stagedFile: async () => ({ data: Buffer.from('SQL'), item: item() }),
    files: async () => ({ items: [item()] }),
    file: async () => ({ data: Buffer.from('SQL'), item: item() }),
    autofillPart: async () => (fileReady ? Buffer.from('SQL') : undefined),
  };
  const dependencies = {
    verify: async (header: string | undefined) => {
      if (header !== 'Bearer owner') throw Error('Invalid bearer');
      return { tenantId: id, objectId: actor };
    },
    resolveAccess: async () => actor,
    profile: async () => undefined,
    access,
    capabilitySubmissions: storage,
    certificateAutofill: async (caller: string, input: { data: Buffer; fileName: string }) => {
      assert.equal(caller, actor);
      assert.equal(input.fileName, 'oracle-sql.txt');
      autofills++;
      return { fields: { certificationName: 'Oracle SQL', provider: 'Oracle' } };
    },
  };
  const server = createApp(dependencies).listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => server.close());
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const root = `http://127.0.0.1:${address.port}/api/capability-submissions`,
    headers = { Authorization: 'Bearer owner' },
    jsonHeaders = { ...headers, 'Content-Type': 'application/json' },
    rawHeaders = {
      ...headers,
      'Content-Type': 'text/plain',
      'X-Submission-Revision': '2',
      'X-Certificate-File-Name': 'oracle-sql.txt',
    },
    autoHeaders = { ...headers, 'Content-Type': 'text/plain', 'X-File-Name': 'oracle-sql.txt' };
  const post = (path: string, body: unknown) =>
    fetch(root + path, { method: 'POST', headers: jsonHeaders, body: JSON.stringify(body) });
  assert.equal((await fetch(root + '/options')).status, 401);
  assert.equal((await fetch(root + '/availability', { headers })).status, 200);
  for (const path of [
    '/options',
    '?view=queue',
    '/links/SKILL/' + id,
    '/links/CERTIFICATION/' + id,
    '/' + id,
  ])
    assert.equal((await fetch(root + path, { headers })).status, 200);
  for (const path of [
    '?view=foreign',
    '?personId=' + cert,
    '/links/OTHER/' + id,
    '/links/SKILL/not-an-id',
  ])
    assert.equal((await fetch(root + path, { headers })).status, 400);
  for (const path of [`/${id}/staged/${cert}`, `/${id}/files/${cert}`]) {
    const response = await fetch(root + path, { headers });
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const data = await response.json();
    assert.equal(data.items[0].id, file);
    assert.equal('blobName' in data.items[0], false);
  }
  for (const path of [`/${id}/staged/${cert}/${file}`, `/${id}/files/${cert}/${file}`]) {
    const response = await fetch(root + path, { headers });
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.match(response.headers.get('content-disposition') ?? '', /attachment/);
    assert.equal(await response.text(), 'SQL');
  }
  mime = 'text/html';
  for (const path of [`/${id}/staged/${cert}/${file}`, `/${id}/files/${cert}/${file}`])
    assert.equal((await fetch(root + path, { headers })).status, 503);
  mime = 'text/plain';
  const stage = `/${id}/staged/${cert}`;
  assert.equal(
    (await fetch(root + stage, { method: 'POST', headers: rawHeaders, body: 'SQL' })).status,
    200,
  );
  pending = true;
  assert.equal(
    (await fetch(root + stage, { method: 'POST', headers: rawHeaders, body: 'SQL' })).status,
    202,
  );
  pending = false;
  for (const patch of [
    { 'X-Submission-Revision': '0' },
    { 'X-Submission-Revision': 'NaN' },
    { 'X-Certificate-File-Name': '%' },
  ])
    assert.equal(
      (
        await fetch(root + stage, {
          method: 'POST',
          headers: { ...rawHeaders, ...patch },
          body: 'SQL',
        })
      ).status,
      400,
    );
  for (const path of ['submit', 'reroute', 'publish-links']) {
    const valid = { id, revision: 2, skills: [{ id: cert, revision: 1 }], certifications: [] };
    assert.equal((await post('/' + path, valid)).status, 200);
    for (const invalid of [
      { ...valid, actorId: cert },
      { ...valid, revision: 0 },
      { ...valid, skills: [{ id: cert, revision: 0 }] },
      { ...valid, skills: [{ id: cert, revision: 1, reviewerId: actor }] },
      { ...valid, skills: 'not-an-array' },
    ])
      assert.equal((await post('/' + path, invalid)).status, 400);
  }
  assert.equal((await post('/decision', {})).status, 400);
  assert.equal((await post('/intake', {})).status, 400);
  for (const action of ['discard', 'restore']) {
    assert.equal((await post(`/${id}/${action}`, { revision: 2 })).status, 200);
    assert.equal((await post(`/${id}/${action}`, { revision: 0 })).status, 400);
  }
  const autofill = () =>
    fetch(root + '/autofill', { method: 'POST', headers: autoHeaders, body: 'SQL' });
  assert.equal((await autofill()).status, 200);
  assert.equal(autofills, 1);
  assert.equal(
    (
      await fetch(root + '/autofill', {
        method: 'POST',
        headers: { ...autoHeaders, 'X-File-Name': '%' },
        body: 'SQL',
      })
    ).status,
    400,
  );
  const chunk = {
    'X-Upload-Id': file,
    'X-Upload-Index': '0',
    'X-Upload-Count': '1',
    'X-Upload-Bytes': '3',
  };
  fileReady = false;
  assert.equal(
    (
      await fetch(root + '/autofill', {
        method: 'POST',
        headers: { ...autoHeaders, ...chunk },
        body: 'SQL',
      })
    ).status,
    202,
  );
  assert.equal(autofills, 1);
  fileReady = true;
  assert.equal(
    (
      await fetch(root + '/autofill', {
        method: 'POST',
        headers: { ...autoHeaders, ...chunk },
        body: 'SQL',
      })
    ).status,
    200,
  );
  assert.equal(autofills, 2);
  for (const key of [
    'stage',
    'stagedFiles',
    'stagedFile',
    'files',
    'file',
    'autofillPart',
  ] as const)
    delete storage[key];
  for (const path of [
    stage,
    stage + '/' + file,
    `/${id}/files/${cert}`,
    `/${id}/files/${cert}/${file}`,
  ])
    assert.equal((await fetch(root + path, { headers })).status, 503);
  assert.equal(
    (await fetch(root + stage, { method: 'POST', headers: rawHeaders, body: 'SQL' })).status,
    503,
  );
  assert.equal(
    (
      await fetch(root + '/autofill', {
        method: 'POST',
        headers: { ...autoHeaders, ...chunk },
        body: 'SQL',
      })
    ).status,
    503,
  );
  assert.ok(calls.every(c => c.actor === actor));
  const revoked = access.snapshot();
  revoked.people[0].overrides.push({ permission: 'skill.claim', scope: 'OWN', effect: 'DENY' });
  access.snapshot = () => revoked;
  assert.equal((await autofill()).status, 403);
  assert.equal(autofills, 2);
});
