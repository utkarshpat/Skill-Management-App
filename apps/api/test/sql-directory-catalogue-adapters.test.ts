import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sqlAdapterFixture } from './sql-adapter-fixture.js';
import { SqlOrganizationStore } from '../src/modules/organization/sql-store.js';
import { SqlCatalogueStore } from '../src/modules/skills/sql-store.js';
import { catalogueQuery } from '../src/modules/skills/skill-catalogue.js';
import { commonLevels } from '../src/modules/skills/proficiency.js';
import { SqlCertificationRecommendationStore } from '../src/modules/skills/sql-certification-recommendation-store.js';
import {
  certificationRecommendationInput as certificationRecommendation,
  certificationRecommendationResponse as certificationResponse,
} from '../src/modules/skills/certification-recommendations.js';
const account = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  actor = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  at = new Date('2026-11-04T10:00:00Z');
test('organization adapter preserves null managers and parents, and rejects conflicts without replacing topology', async () => {
  const f = sqlAdapterFixture(),
    store = new SqlOrganizationStore(account);
  try {
    assert.throws(() => new SqlOrganizationStore('invalid'));
    f.reply('dbo.ReadOwnOrganization', [
      { managerName: 'Rohan Mehta', projectName: 'Customer Insights Modernisation' },
    ]);
    assert.equal((await store.ownOrganization(actor)).managerName, 'Rohan Mehta');
    f.reply('dbo.ReadOwnOrganization', []);
    await assert.rejects(store.ownOrganization(actor), { status: 404 });
    f.reply(
      'dbo.ReadOrganization',
      [{ revision: 3 }],
      [
        { id: id.toUpperCase(), parentId: null, name: 'Analytics' },
        { id: actor.toUpperCase(), parentId: id.toUpperCase(), name: 'Customer Reporting' },
      ],
      [
        {
          personId: actor.toUpperCase(),
          managerId: account.toUpperCase(),
          teamId: id.toUpperCase(),
        },
        { personId: account.toUpperCase(), managerId: null, departmentId: id.toUpperCase() },
      ],
      [{ id: actor.toUpperCase(), displayName: 'Aditi Menon' }],
    );
    const data = await store.snapshot();
    assert.equal(data.nodes[0].parentId, null);
    assert.equal(data.nodes[1].parentId, id);
    assert.equal(data.assignments[1].managerId, null);
    assert.equal(data.people[0].id, actor);
    const change = {
      revision: 3,
      kind: 'assignment',
      personId: actor,
      teamId: id,
      managerId: account,
    };
    f.reply('dbo.SaveOrganizationChange');
    await store.save(actor, change);
    assert.equal(f.calls.at(-1)?.inputs.expected_revision, 3);
    assert.equal(JSON.parse(String(f.calls.at(-1)?.inputs.payload)).managerId, account);
    for (const [number, status] of [
      [51009, 409],
      [51003, 403],
      [51004, 404],
      [51000, 400],
      [2601, 400],
      [2627, 400],
      [547, 400],
    ]) {
      f.reject('dbo.SaveOrganizationChange', { number, message: 'Rejected' });
      await assert.rejects(store.save(actor, change), { status });
    }
    for (const [number, status] of [
      [51003, 403],
      [51004, 404],
    ]) {
      f.reject('dbo.ReadOwnOrganization', { number });
      await assert.rejects(store.ownOrganization(actor), { status });
    }
    const fault = new Error('offline');
    for (const [proc, run] of [
      ['dbo.ReadOwnOrganization', () => store.ownOrganization(actor)],
      ['dbo.SaveOrganizationChange', () => store.save(actor, change)],
    ] as const) {
      f.reject(proc, fault);
      await assert.rejects(run(), e => e === fault);
    }
  } finally {
    await f.finish();
  }
});
test('catalogue adapter binds search text as data and retains correct levels and credential mappings', async () => {
  const f = sqlAdapterFixture(),
    store = new SqlCatalogueStore(account),
    query = catalogueQuery({ search: 'SQL', page: 2 });
  const change = {
    revision: 3,
    id,
    name: 'SQL',
    category: 'Databases',
    description: 'Customer reporting queries',
    status: 'PUBLISHED',
    levels: commonLevels(),
  };
  try {
    assert.throws(() => new SqlCatalogueStore('invalid'));
    f.reply(
      'dbo.ReadSkillCatalogue',
      [{ revision: 3, total: 1, canManage: true }],
      [{ id: id.toUpperCase(), name: 'SQL' }],
      [{ skillId: id.toUpperCase(), rank: 1, name: 'Foundation', description: 'Guided queries' }],
      [
        { skillId: id, id: actor.toUpperCase(), name: 'Oracle SQL', provider: 'Oracle' },
        { skillId: account, id: account },
      ],
    );
    const data = await store.read(actor, query);
    assert.equal(data.skills[0].relatedCertifications?.length, 1);
    assert.equal(data.skills[0].relatedCertifications?.[0].id, actor);
    assert.equal(data.skills[0].levels[0].name, 'Foundation');
    assert.equal(data.page, 2);
    f.reply('dbo.ReadSkillCatalogue', [{ revision: 3, total: 1 }], [{ id, name: 'SQL' }], []);
    assert.deepEqual((await store.read(actor, query)).skills[0].relatedCertifications, []);
    f.reply(
      'dbo.ReadCatalogueCertifications',
      [{ total: 1, revision: 3 }],
      [{ id: actor.toUpperCase(), name: 'Oracle SQL', provider: 'Oracle' }],
    );
    assert.equal((await store.certifications(actor, query)).certifications[0].id, actor);
    f.reply('dbo.SaveSkillCatalogue');
    await store.save(actor, change);
    assert.equal(f.calls.at(-1)?.inputs.target_id, id);
    assert.equal(f.calls.at(-1)?.inputs.is_new, false);
    for (const [number, status] of [
      [51003, 403],
      [51004, 404],
      [51009, 409],
      [51000, 400],
      [2601, 409],
      [2627, 409],
      [547, 400],
    ])
      for (const [proc, run] of [
        ['dbo.ReadSkillCatalogue', () => store.read(actor, query)],
        ['dbo.ReadCatalogueCertifications', () => store.certifications(actor, query)],
        ['dbo.SaveSkillCatalogue', () => store.save(actor, change)],
      ] as const) {
        f.reject(proc, { number, message: 'Rejected' });
        await assert.rejects(run(), { status });
      }
    const fault = new Error('offline');
    f.reject('dbo.ReadSkillCatalogue', fault);
    await assert.rejects(store.read(actor, query), e => e === fault);
  } finally {
    await f.finish();
  }
});
test('certification recommendation adapter normalizes identities and explains missing migrations or revoked reporting access', async () => {
  const f = sqlAdapterFixture(),
    store = new SqlCertificationRecommendationStore(account);
  try {
    f.reply(
      'dbo.CertificationRecommendations',
      [{ total: 1 }],
      [{ id: id.toUpperCase(), personId: actor.toUpperCase(), senderId: account.toUpperCase() }],
    );
    assert.equal((await store.read(actor, 'received', 1, 'Oracle', id)).items[0].personId, actor);
    f.reply('dbo.CertificationRecommendations', [{ id: actor.toUpperCase(), name: 'Aditi Menon' }]);
    assert.equal((await store.people(actor, 'Aditi')).people[0].id, actor);
    const input = certificationRecommendation({
      id,
      personId: actor,
      certificationName: 'Oracle SQL',
      provider: 'Oracle',
      category: 'Databases',
      reason: 'Customer reporting delivery',
      credentialUrl: 'https://education.oracle.com/',
    });
    f.reply('dbo.CertificationRecommendations');
    assert.deepEqual(await store.send(actor, input), { saved: true, id });
    const response = certificationResponse({
      id,
      revision: 1,
      action: 'ACCEPT',
      message: 'Added to my learning goals',
    });
    f.reply('dbo.CertificationRecommendations');
    assert.deepEqual(await store.respond(actor, response), { saved: true });
    f.reply(
      'dbo.CertificationReviewAnalytics',
      [{ reviewed: 2 }],
      [{ category: 'Databases', count: 2 }],
    );
    assert.equal((await store.analytics(actor)).categories.length, 1);
    f.reply('dbo.CertificationRecommendations', [
      { id, at, title: 'Oracle SQL', body: 'Recommended', href: '/certifications' },
      { id: actor, at: at.toISOString(), title: 'Power BI', body: 'Reviewed', href: '/my-skills' },
    ]);
    assert.equal((await store.notifications(actor))[0].at, at.toISOString());
    for (const [number, status] of [
      [2812, 503],
      [208, 503],
      [51003, 403],
      [51004, 404],
      [51009, 409],
      [2627, 409],
      [2601, 409],
      [51000, 400],
    ]) {
      f.reject('dbo.CertificationRecommendations', { number });
      await assert.rejects(store.read(actor, 'sent', 1, ''), { status });
    }
    for (const [number, status] of [
      [2812, 503],
      [208, 503],
      [51003, 403],
    ]) {
      f.reject('dbo.CertificationReviewAnalytics', { number });
      await assert.rejects(store.analytics(actor), { status });
    }
    const fault = new Error('offline');
    for (const [proc, run] of [
      ['dbo.CertificationRecommendations', () => store.read(actor, 'sent', 1, '')],
      ['dbo.CertificationReviewAnalytics', () => store.analytics(actor)],
    ] as const) {
      f.reject(proc, fault);
      await assert.rejects(run(), e => e === fault);
    }
  } finally {
    await f.finish();
  }
});
