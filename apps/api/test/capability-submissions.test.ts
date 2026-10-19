import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import {
  capabilityCommand,
  capabilityDecision,
  normalizeCapabilityIds,
  capabilityResult,
} from '../src/modules/skills/capability-submissions.js';
import { CertificateAutofillService } from '../src/modules/ai/certificate-autofill.js';
import { MemoryAiBudget } from '../src/modules/ai/budget.js';
import { createApp } from '../src/create-app.js';
import type { AccessStore } from '../src/modules/access/index.js';
import type { ClaimsStore } from '../src/modules/skills/index.js';
import type { Provider } from '../src/modules/ai/index.js';
const actor = '00000000-0000-4000-8000-000000000001',
  id = '00000000-0000-4000-8000-000000000002',
  skill = '00000000-0000-4000-8000-000000000003',
  cert = '00000000-0000-4000-8000-000000000004';
const fields = {
  certificationName: 'Networking certificate',
  provider: 'QA',
  category: 'Networking',
  certificationDate: '2026-01-01',
  expiryDate: null,
  credentialId: '',
  credentialUrl: '',
  notes: '',
};
const command = () => ({
  id,
  revision: 0,
  skills: [
    {
      id: skill,
      revision: 0,
      skillId: skill,
      fields: {
        definitionRevision: 1,
        rank: 2,
        experienceMonths: 2,
        description: 'Built and tested network services',
      },
    },
  ],
  certifications: [{ id: cert, revision: 0, fields, skillIds: [skill] }],
});
const state = () =>
  ({
    revision: 1,
    roles: [],
    permissionCatalogue: [
      { code: 'profile.view', label: 'Profile', scopes: ['OWN'] },
      { code: 'skill.view', label: 'Skills', scopes: ['OWN', 'ORGANIZATION'] },
      { code: 'skill.claim', label: 'Claims', scopes: ['OWN'] },
    ],
    people: [
      {
        id: actor,
        displayName: 'QA',
        email: 'qa@example.com',
        employeeCode: 'QA',
        active: true,
        revision: 1,
        roleIds: [],
        overrides: [
          { permission: 'profile.view', scope: 'OWN', effect: 'ALLOW' },
          { permission: 'skill.view', scope: 'OWN', effect: 'ALLOW' },
          { permission: 'skill.view', scope: 'ORGANIZATION', effect: 'ALLOW' },
          { permission: 'skill.claim', scope: 'OWN', effect: 'ALLOW' },
        ],
        orgLinks: [],
      },
    ],
    audit: [],
  }) as any;
test('linked submission parser accepts many-to-many links, rejects duplicate/foreign references and forged authority', () => {
  const valid = capabilityCommand(command());
  assert.deepEqual(valid.certifications[0].skillIds, [skill]);
  for (const invalid of [
    { ...command(), actorId: actor },
    { ...command(), skills: [command().skills[0], command().skills[0]] },
    { ...command(), certifications: [{ ...command().certifications[0], skillIds: [] }] },
    { ...command(), certifications: [{ ...command().certifications[0], skillIds: [cert] }] },
    { ...command(), certifications: [{ ...command().certifications[0], owner: actor }] },
    { ...command(), skills: [] },
  ])
    assert.throws(() => capabilityCommand(invalid));
  assert.throws(() =>
    capabilityDecision({
      id,
      revision: 1,
      decisions: [{ id: skill, revision: 1, kind: 'SKILL', action: 'APPROVE', feedback: '' }],
    }),
  );
  const item = { id: skill, revision: 1, kind: 'SKILL', action: 'APPROVE', feedback: 'Reviewed' };
  assert.throws(() => capabilityDecision({ id, revision: 1, decisions: [item, item] }));
});
test('AI extraction uses bounded catalogue candidates, strips invented proficiency and malformed dates; revocation discards the reply', async () => {
  let current = state(),
    calls = 0,
    revoked = false;
  const access = {
    snapshot: () => structuredClone(current),
    person: () => current.people[0],
    save: async () => current,
  } as AccessStore;
  const choice = {
    id: skill,
    name: 'Networking',
    category: 'Networking',
    definitionRevision: 1,
    levels: [],
  };
  const claims = {
    options: async (caller: string, search: string) => {
      assert.equal(caller, actor);
      assert.ok(search.length <= 60);
      return { skills: [choice] };
    },
  } as unknown as ClaimsStore;
  const provider = {
    name: 'gemini',
    complete: async (messages: any[], tools: any[]) => {
      assert.equal(tools.length, 0);
      calls++;
      if (revoked) current.people[0].active = false;
      return {
        calls: [],
        content: JSON.stringify(
          calls % 2
            ? {
                fields: {
                  ...fields,
                  certificationDate: '2026-02-30',
                  expiryDate: '2027-02-30',
                  rank: 5,
                  credentialUrl: 'javascript:alert(1)',
                },
                searchTerms: ['Networking'],
              }
            : {
                skills: [
                  { id: skill, reason: 'Credential mentions networking' },
                  { id: cert, reason: 'Invented candidate' },
                ],
              },
        ),
      };
    },
  } as Provider;
  const service = new CertificateAutofillService(access, claims, new MemoryAiBudget(), provider);
  const result = await service.extract(
    actor,
    { data: Buffer.from('credential facts'), mimeType: 'text/plain', fileName: 'fixture.txt' },
    new AbortController().signal,
  );
  assert.equal(result.fields.certificationDate, '');
  assert.equal(result.fields.expiryDate, '');
  assert.equal(result.fields.credentialUrl, '');
  assert.equal(result.fields.rank, undefined);
  assert.equal(result.suggestions.length, 1);
  assert.equal(result.suggestions[0].skill.id, skill);
  revoked = true;
  await assert.rejects(
    service.extract(
      actor,
      { data: Buffer.from('credential facts'), mimeType: 'text/plain', fileName: 'fixture.txt' },
      new AbortController().signal,
    ),
    /access|Access|assigned/,
  );
});

test('certificate autofill distinguishes explicit non-expiring dates from unknown and invalid expiry', async () => {
  const current = state();
  const access = {
    snapshot: () => structuredClone(current),
    person: () => current.people[0],
    save: async () => current,
  } as AccessStore;
  for (const [expiry, expected] of [
    [null, null],
    ['', ''],
    [undefined, ''],
    ['2027-02-30', ''],
    ['2027-01-01', '2027-01-01'],
  ]) {
    const provider = {
      name: 'gemini',
      complete: async (messages: any[]) => {
        assert.match(messages[0].content, /null only when explicitly non-expiring/);
        return {
          calls: [],
          content: JSON.stringify({ fields: { ...fields, expiryDate: expiry }, searchTerms: [] }),
        };
      },
    } as Provider;
    const result = await new CertificateAutofillService(
      access,
      {} as ClaimsStore,
      new MemoryAiBudget(),
      provider,
    ).extract(
      actor,
      { data: Buffer.from('Synthetic credential'), mimeType: 'text/plain', fileName: 'qa.txt' },
      new AbortController().signal,
    );
    assert.equal(result.fields.expiryDate, expected);
  }
});
test('capability HTTP binds verified actor, validates revision sets and conceals private Blob keys', async t => {
  const current = state(),
    seen: string[] = [];
  const server = createApp({
    verify: async h => {
      if (h !== 'Bearer trusted') throw Error();
      return { tenantId: actor, objectId: actor };
    },
    resolveAccess: async () => actor,
    profile: async () => undefined,
    access: { snapshot: () => current, person: () => current.people[0], save: async () => current },
    capabilitySubmissions: {
      run: async (caller, op, payload) => {
        assert.equal(caller, actor);
        seen.push(op);
        return { id, revision: 1 };
      },
      files: async caller => {
        assert.equal(caller, actor);
        return {
          items: [
            {
              id: cert,
              blobName: 'private-key',
              mimeType: 'application/pdf',
              fileName: 'fixture.pdf',
              bytes: 3,
            },
          ],
        };
      },
    },
  }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => server.close());
  const root = `http://127.0.0.1:${(server.address() as any).port}/api/capability-submissions`,
    headers = { Authorization: 'Bearer trusted', 'Content-Type': 'application/json' };
  assert.equal((await fetch(root)).status, 401);
  assert.equal(
    (
      await fetch(root, {
        method: 'POST',
        headers,
        body: JSON.stringify({ ...command(), actorId: cert }),
      })
    ).status,
    400,
  );
  assert.equal(
    (await fetch(root, { method: 'POST', headers, body: JSON.stringify(command()) })).status,
    200,
  );
  assert.deepEqual(seen, ['SAVE']);
  for (const action of ['discard', 'restore']) {
    assert.equal(
      (
        await fetch(`${root}/${id}/${action}`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ revision: 1, actorId: cert }),
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await fetch(`${root}/${id}/${action}`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ revision: 1 }),
        })
      ).status,
      200,
    );
  }
  assert.deepEqual(seen, ['SAVE', 'DISCARD', 'RESTORE']);

  const file = await fetch(root + '/' + id + '/files/' + cert, { headers });
  assert.equal(file.status, 200);
  assert.equal(file.headers.get('cache-control'), 'no-store');
  assert.equal((await file.json()).items[0].blobName, undefined);
  assert.equal(
    (
      await fetch(root + '/submit', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          id,
          revision: 1,
          skills: [{ id: skill, revision: 0 }],
          certifications: [],
        }),
      })
    ).status,
    400,
  );
});

test('SQL JSON IDs normalize consistently for draft recovery, membership and private file reads without changing text', () => {
  const source = {
    id: id.toUpperCase(),
    skills: [{ id: skill.toUpperCase(), skillId: skill.toUpperCase(), name: 'AZURE' }],
    certifications: [{ id: cert.toUpperCase(), fields: { credentialId: actor.toUpperCase() } }],
    items: [{ id: cert.toUpperCase(), blobName: 'Private/CASE' }],
  };
  const normalized = normalizeCapabilityIds(source);
  assert.equal(normalized.id, id);
  assert.equal(normalized.skills[0].id, skill);
  assert.equal(normalized.items[0].id, cert);
  assert.equal(normalized.items[0].blobName, 'Private/CASE');
  assert.equal(normalized.certifications[0].fields.credentialId, actor.toUpperCase());
});

test('private incomplete draft DTOs retain empty record arrays without inventing profile credentials', () => {
  const result = capabilityResult('GET', {
    id: id.toUpperCase(),
    revision: 1,
    status: 'DRAFT',
    intake: { certifications: [{ id: cert }] },
  });
  assert.equal(result.id, id);
  assert.deepEqual(result.skills, []);
  assert.deepEqual(result.certifications, []);
  assert.deepEqual(result.stagedFiles, []);
  assert.equal(result.intake.certifications.length, 1);
  assert.throws(() => capabilityResult('GET', null));
  assert.throws(() => capabilityResult('GET', { skills: 'corrupt' }));
});

test('certificate AI can return several canonical skills, bounded to six without inventing proficiency', async () => {
  const current = state();
  const access = {
    snapshot: () => structuredClone(current),
    person: () => current.people[0],
    save: async () => current,
  } as AccessStore;
  const choices = Array.from({ length: 7 }, (_, index) => ({
    id: `00000000-0000-4000-8000-${String(index + 10).padStart(12, '0')}`,
    name: `Networking ${index}`,
    category: 'Networking',
    definitionRevision: 1,
    levels: [],
  }));
  const claims = { options: async () => ({ skills: choices }) } as unknown as ClaimsStore;
  let phase = 0;
  const provider = {
    name: 'gemini',
    complete: async () => ({
      calls: [],
      content: JSON.stringify(
        ++phase === 1
          ? { fields, searchTerms: ['Networking'] }
          : {
              skills: [
                { id: 'invented', reason: 'Invalid' },
                ...choices.map(choice => ({ id: choice.id, reason: 'Credential topic' })),
              ],
              rank: 4,
            },
      ),
    }),
  } as Provider;
  const result = await new CertificateAutofillService(
    access,
    claims,
    new MemoryAiBudget(),
    provider,
  ).extract(
    actor,
    { data: Buffer.from('networking credential'), mimeType: 'text/plain', fileName: 'fixture.txt' },
    new AbortController().signal,
  );
  assert.equal(result.suggestions.length, 6);
  assert.ok(
    result.suggestions.every((suggestion: any) =>
      choices.some(choice => choice.id === suggestion.skill.id),
    ),
  );
  assert.equal(result.fields.rank, undefined);
});

test('certificate claims still need a linked skill and allow independently chosen extra skills', () => {
  assert.throws(() => capabilityCommand({ ...command(), skills: [] }), /1.10 skills/);
  assert.throws(
    () =>
      capabilityCommand({
        ...command(),
        certifications: [{ ...command().certifications[0], skillIds: [] }],
      }),
    /at least one/,
  );
  const extra = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const selected = command();
  selected.skills.push({ ...selected.skills[0], id: extra, skillId: extra });
  selected.certifications[0].skillIds = [extra];
  const result = capabilityCommand(selected);
  assert.equal(result.skills.length, 2);
  assert.deepEqual(result.certifications[0].skillIds, [extra]);
});
