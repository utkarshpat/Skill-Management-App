import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import express from 'express';
import { registerClaimsRoutes } from '../src/modules/skills/claims-routes.js';
import { AccessError } from '../src/shared/errors.js';
import type { LocalAccessState, Assignment } from '../src/modules/access/local-access-store.js';
import type { ClaimsStore, SkillClaim } from '../src/modules/skills/claims.js';
import type { EvidenceStore } from '../src/modules/skills/evidence.js';

const manager = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  employee = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
test('claim HTTP distinguishes own learning, exact assigned review, stale snapshots and private evidence delivery', async t => {
  const permissions: Assignment[] = (
    ['profile.view', 'skill.view', 'skill.claim', 'learning.view'] as const
  ).map(permission => ({ permission, scope: 'OWN', effect: 'ALLOW' }));
  permissions.push(
    { permission: 'skill.view', scope: 'ORGANIZATION', effect: 'ALLOW' },
    { permission: 'skill.verify', scope: 'ORGANIZATION', effect: 'ALLOW' },
  );
  const state: LocalAccessState = {
    revision: 1,
    audit: [],
    roles: [{ id, name: 'Delivery reviewers', permissions }],
    people: [
      {
        id: manager,
        displayName: 'Rohan Mehta',
        employeeCode: 'EMP-1007',
        active: true,
        roleIds: [id],
        overrides: [],
      },
      {
        id: employee,
        displayName: 'Aditi Menon',
        employeeCode: 'EMP-1042',
        active: true,
        roleIds: [id],
        overrides: [],
      },
    ],
    reporting: [{ personId: employee, managerId: manager }],
  };
  const claim: SkillClaim = {
    id,
    revision: 2,
    personId: employee,
    reviewerId: manager,
    skillId: id,
    skillName: 'SQL',
    category: 'Databases',
    definitionRevision: 1,
    rank: 2,
    levelName: 'Practitioner',
    levelDescription: 'Applies SQL to reporting',
    experienceMonths: 12,
    description: 'Customer reporting delivery',
    status: 'SUBMITTED',
    updatedAt: '2026-11-05T00:00:00Z',
  };
  const empty = { claims: [], total: 0, page: 1, pageSize: 20, canClaim: true };
  let effect = () => {},
    enabled = true,
    historyEnabled = true,
    journeyEnabled = true,
    teamEnabled = true;
  let fail: AccessError | undefined;
  const writes: unknown[] = [];
  const current = () => {
    if (fail) throw fail;
    effect();
    return structuredClone(empty);
  };
  const backend: ClaimsStore = {
    read: async actor => {
      assert.equal(actor, manager);
      return current();
    },
    options: async () => {
      current();
      return { skills: [], total: 0, page: 1, pageSize: 20 };
    },
    save: async (actor, input) => {
      assert.equal(actor, manager);
      current();
      writes.push(input);
    },
    reviews: async () => current(),
    get journey() {
      return journeyEnabled ? async () => current() : undefined;
    },
    get team() {
      return teamEnabled
        ? async () => {
            current();
            return {
              total: 0,
              page: 1,
              pageSize: 20,
              scope: 'DIRECT_REPORTS' as const,
              people: [],
              skills: [],
            };
          }
        : undefined;
    },
    get reviewDetail() {
      return historyEnabled
        ? async () => {
            current();
            return { claim: structuredClone(claim), history: [], total: 0, page: 1, pageSize: 20 };
          }
        : undefined;
    },
    transition: async (actor, input) => {
      assert.equal(actor, manager);
      current();
      writes.push(input);
    },
  };
  let evidenceEnabled = true,
    mime = 'application/pdf',
    hasFile = true;
  const evidence: EvidenceStore = {
    read: async () => ({
      revision: 2,
      canUpload: true,
      items: hasFile
        ? [
            {
              id,
              blobName: 'private/customer-proof',
              bytes: 5,
              mimeType: mime,
              fileName: 'SQL delivery evidence.pdf',
            },
          ]
        : [],
    }),
    image: async () => Buffer.from('proof'),
    upload: async (actor, record, revision, data, file) => {
      assert.equal(actor, manager);
      assert.equal(record, id);
      assert.equal(revision, 2);
      assert.equal(file?.fileName, 'proof.pdf');
      assert.equal(data.toString(), 'proof');
      return { revision: 3, canUpload: true, items: [] };
    },
  };
  const app = express();
  app.use(express.json());
  registerClaimsRoutes(
    app,
    {
      verify: async h => {
        if (h !== 'Bearer manager') throw Error();
        return { tenantId: id, objectId: manager };
      },
      resolveAccess: async () => manager,
      access: {
        snapshot: () => structuredClone(state),
        person: who => state.people.find(p => p.id === who),
        save: async () => state,
      },
      get claims() {
        return enabled ? backend : undefined;
      },
      get evidenceStore() {
        return evidenceEnabled ? evidence : undefined;
      },
    },
    undefined,
    undefined,
  );
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => server.close());
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const root = `http://127.0.0.1:${address.port}`,
    headers = { Authorization: 'Bearer manager' },
    get = (path: string) => fetch(root + path, { headers }),
    post = (path: string, body: unknown) =>
      fetch(root + path, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
  assert.equal((await fetch(root + '/api/my-skills')).status, 401);
  for (const path of [
    '/api/my-skills',
    '/api/my-skills/catalogue',
    '/api/my-skills/journey',
    '/api/skill-reviews',
    '/api/skill-reviews/team',
    '/api/skill-reviews/' + id,
  ])
    assert.equal((await get(path)).status, 200, path);
  for (const path of [
    '/api/my-skills?page=0',
    '/api/my-skills/catalogue?pageSize=0',
    '/api/my-skills/journey?person=' + employee,
    '/api/skill-reviews?status=foreign',
    '/api/skill-reviews/team?page=0',
    '/api/skill-reviews/invalid',
    '/api/skill-reviews/' + id + '?actorId=' + employee,
  ])
    assert.equal((await get(path)).status, 400, path);
  const transition = { id, revision: 2, action: 'APPROVE', feedback: 'Reviewed reporting work' };
  assert.equal((await post('/api/skill-reviews/decision', transition)).status, 200);
  assert.equal((await post('/api/my-skills/submit', transition)).status, 400);
  assert.equal(
    (await post('/api/skill-reviews/decision', { id, revision: 2, action: 'SUBMIT' })).status,
    400,
  );
  const written = writes.length;
  claim.reviewerId = employee;
  assert.equal((await post('/api/skill-reviews/decision', transition)).status, 403);
  assert.equal(writes.length, written);
  assert.equal((await get('/api/skill-reviews/' + id)).status, 404);
  claim.reviewerId = manager;
  claim.revision = 3;
  assert.equal((await post('/api/skill-reviews/decision', transition)).status, 409);
  claim.revision = 2;
  for (const path of [
    '/api/skill-reviews',
    '/api/skill-reviews/team',
    '/api/skill-reviews/' + id,
  ]) {
    effect = () => {
      state.revision++;
    };
    assert.equal((await get(path)).status, 409, path);
  }
  effect = () => {};
  for (const path of [
    '/api/skill-reviews',
    '/api/skill-reviews/team',
    '/api/skill-reviews/' + id,
  ]) {
    effect = () => {
      state.people[0].active = false;
    };
    assert.equal((await get(path)).status, 403, path);
    state.people[0].active = true;
  }
  effect = () => {};
  historyEnabled = false;
  assert.equal((await get('/api/skill-reviews/' + id)).status, 503);
  assert.equal((await post('/api/skill-reviews/decision', transition)).status, 503);
  historyEnabled = true;
  teamEnabled = false;
  assert.equal((await get('/api/skill-reviews/team')).status, 503);
  teamEnabled = true;
  journeyEnabled = false;
  assert.equal((await get('/api/my-skills/journey')).status, 503);
  journeyEnabled = true;
  state.people[0].overrides = [{ permission: 'learning.view', scope: 'OWN', effect: 'DENY' }];
  assert.equal((await get('/api/my-skills/journey')).status, 403);
  state.people[0].overrides = [];
  for (const path of ['/api/my-skills', '/api/my-skills/catalogue', '/api/skill-reviews']) {
    enabled = false;
    assert.equal((await get(path)).status, 503, path);
  }
  enabled = true;
  fail = new AccessError(409, 'Current record changed');
  assert.equal((await get('/api/my-skills')).status, 409);
  assert.equal((await post('/api/my-skills', {})).status, 400);
  fail = undefined;
  for (const prefix of ['/api/my-skills', '/api/skill-reviews']) {
    const listing = await get(`${prefix}/${id}/evidence`);
    assert.equal(listing.status, 200);
    const data = (await listing.json()) as { canUpload: boolean; items: Record<string, unknown>[] };
    assert.equal(data.canUpload, prefix === '/api/my-skills');
    assert.equal('blobName' in data.items[0], false);
    const file = await get(`${prefix}/${id}/evidence/${id}`);
    assert.equal(file.status, 200);
    assert.equal(file.headers.get('x-content-type-options'), 'nosniff');
    assert.match(file.headers.get('content-disposition')!, /attachment/);
    assert.equal(await file.text(), 'proof');
  }
  mime = 'text/html';
  assert.equal((await get(`/api/my-skills/${id}/evidence/${id}`)).status, 503);
  mime = 'image/webp';
  assert.equal((await get(`/api/my-skills/${id}/evidence/${id}`)).status, 200);
  hasFile = false;
  assert.equal((await get(`/api/my-skills/${id}/evidence/${id}`)).status, 404);
  hasFile = true;
  const upload = (extra: Record<string, string>) =>
    fetch(`${root}/api/my-skills/${id}/evidence`, {
      method: 'POST',
      headers: {
        ...headers,
        'Content-Type': 'application/pdf',
        'x-claim-revision': '2',
        'x-evidence-file-name': 'proof.pdf',
        ...extra,
      },
      body: 'proof',
    });
  assert.equal((await upload({})).status, 200);
  for (const value of ['0', 'NaN', '1.5'])
    assert.equal((await upload({ 'x-claim-revision': value })).status, 400);
  assert.equal((await upload({ 'x-evidence-file-name': '%ZZ' })).status, 400);
  evidenceEnabled = false;
  assert.equal((await get(`/api/my-skills/${id}/evidence`)).status, 503);
  assert.equal((await get(`/api/my-skills/${id}/evidence/${id}`)).status, 503);
  assert.equal((await upload({})).status, 503);
});
