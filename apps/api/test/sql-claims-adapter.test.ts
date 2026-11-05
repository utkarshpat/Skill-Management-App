import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sqlAdapterFixture } from './sql-adapter-fixture.js';
import { SqlClaimsStore } from '../src/modules/skills/sql-claims-store.js';
import { claimChange, claimTransition } from '../src/modules/skills/claims.js';
const account = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  actor = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  skill = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const at = new Date('2026-11-04T10:00:00Z');
const row = {
  id: id.toUpperCase(),
  skillId: skill.toUpperCase(),
  personId: actor.toUpperCase(),
  reviewerId: account.toUpperCase(),
  activeSubmissionId: skill.toUpperCase(),
  updatedAt: at,
  skillName: 'SQL',
  name: 'Aditi Menon',
  status: 'SUBMITTED',
};

test('claim SQL adapter scopes every call and reconstructs versions, team aggregates and review history', async () => {
  assert.throws(() => new SqlClaimsStore('not-a-workspace'), /UUID/);
  const f = sqlAdapterFixture();
  try {
    const store = new SqlClaimsStore(account);
    f.reply(
      'dbo.ReadOwnSkillClaims',
      [{ total: 2, canClaim: true }],
      [row, { ...row, personId: undefined, reviewerId: undefined, activeSubmissionId: undefined }],
    );
    const own = await store.read(actor, 2);
    assert.equal(own.page, 2);
    assert.equal(own.claims[0].reviewerId, account);
    assert.equal(own.claims[0].activeSubmissionId, skill);
    assert.equal(own.claims[0].updatedAt, at.toISOString());
    assert.equal(own.claims[1].reviewerId, undefined);
    f.reply('dbo.ReadOwnGrowthClaims', [{ total: 1 }], [row]);
    assert.equal((await store.journey(actor)).claims[0].id, id);
    f.reply(
      'dbo.ReadOwnSkillSummary',
      [{ total: 2 }],
      [{ id: skill.toUpperCase(), skillName: 'SQL', rank: 3 }],
    );
    assert.equal((await store.summary(actor)).topSkills?.[0].id, skill);
    f.reply('dbo.ReadOwnSkillSummary', [{ total: 0 }]);
    assert.equal((await store.summary(actor)).topSkills, undefined);
    f.reply(
      'dbo.ReadClaimSkills',
      [{ total: 1 }],
      [{ id: skill.toUpperCase(), name: 'SQL' }],
      [
        {
          skillId: skill.toUpperCase(),
          rank: 3,
          name: 'Experienced',
          description: 'Independent delivery',
        },
        { skillId: id, rank: 1, name: 'Foundation' },
      ],
      [{ name: 'Databases', count: 1 }],
    );
    const choices = await store.options(actor, "SQL'; DROP TABLE skills;--", 2, 'Databases', 12);
    assert.equal(choices.skills[0].levels.length, 1);
    assert.equal(choices.pageSize, 12);
    assert.equal(f.calls.at(-1)?.inputs.query, "SQL'; DROP TABLE skills;--");
    f.reply('dbo.ReadClaimSkills', [{ total: 0 }], [], []);
    const empty = await store.options(actor, '', 1);
    assert.ok('categories' in empty);
    assert.deepEqual(empty.categories, []);
    f.reply(
      'dbo.ReadDirectReportCapability',
      [{ total: 1 }],
      [{ id: actor.toUpperCase(), name: 'Aditi Menon' }],
      [{ personId: actor.toUpperCase(), skillName: 'SQL' }],
      [{ members: 2, reviewed: 1, pending: 1 }],
      [
        {
          skillName: 'SQL',
          rank: 3,
          people: 2,
          memberIds: actor.toUpperCase() + ',' + id.toUpperCase(),
        },
      ],
      [{ rank: 3, count: 1, memberIds: actor.toUpperCase() }],
      [{ category: 'Databases', count: 1 }],
    );
    const team = await store.team(actor, { page: 1, search: 'Aditi', person: undefined });
    assert.equal(team.scope, 'DIRECT_REPORTS');
    assert.deepEqual(team.analytics?.coverage[0].memberIds, [actor, id]);
    assert.equal(team.people[0].id, actor);
    f.reply('dbo.ReadDirectReportCapability', [{ total: 0 }], [], []);
    assert.equal(
      (await store.team(actor, { page: 1, search: '', person: id })).analytics,
      undefined,
    );
    f.reply(
      'dbo.ReadSkillReviewWorkbench',
      [{ total: 1 }],
      [row],
      [{ category: 'Databases' }],
      [{ pending: 1 }],
    );
    assert.equal((await store.reviews(actor, 2)).claims[0].personId, actor);
    f.reply(
      'dbo.ReadSkillReviewWorkbench',
      [{}],
      [row],
      [],
      [],
      [
        {
          revision: 3,
          action: 'claim.submitted',
          at,
          actorName: 'Aditi Menon',
          feedback: 'Please review',
        },
      ],
      [{ total: 1 }],
    );
    const detail = await store.reviewDetail(actor, id, 2);
    assert.equal(detail.history[0].at, at.toISOString());
    assert.equal(detail.page, 2);
    assert.equal(f.calls.at(-1)?.inputs.claim_id, id);
    f.reply('dbo.ReadSkillReviewWorkbench', [{}], [], [], [], [], [{ total: 0 }]);
    await assert.rejects(store.reviewDetail(actor, id, 1), { status: 404 });
    const draft = claimChange({
      id,
      skillId: skill,
      revision: 3,
      definitionRevision: 2,
      rank: 3,
      experienceMonths: 18,
      description: 'Optimised customer reporting queries',
      projects: 'Customer Insights Modernisation',
    });
    f.reply('dbo.SaveOwnSkillClaim');
    await store.save(actor, draft);
    assert.equal(f.calls.at(-1)?.inputs.payload, JSON.stringify(draft));
    const transition = claimTransition({ id, revision: 3, action: 'SUBMIT' });
    f.reply('dbo.TransitionSkillClaim');
    await store.transition(actor, transition);
    assert.equal(f.calls.at(-1)?.inputs.expected_revision, 3);
    f.reply('dbo.ReadSkillClaimNotifications', [
      { id, at, title: 'SQL review', body: 'Changes requested', href: '/my-skills' },
    ]);
    f.reply('dbo.ReadCapabilitySubmissionNotifications', [
      { id: skill, at, title: 'Capability review', body: 'Reviewed', href: '/my-skills' },
    ]);
    assert.equal((await store.notifications(actor)).length, 2);
    for (const call of f.calls) {
      assert.equal(call.inputs.account_id, account);
      assert.equal(call.inputs.actor_id, actor);
    }
  } finally {
    await f.finish();
  }
});

test('claim SQL errors fail closed across reads and writes without swallowing unexpected faults', async () => {
  const f = sqlAdapterFixture();
  try {
    const store = new SqlClaimsStore(account);
    const draft = claimChange({
        id,
        skillId: skill,
        revision: 3,
        definitionRevision: 2,
        rank: 3,
        experienceMonths: 18,
        description: 'Customer reporting work',
      }),
      transition = claimTransition({ id, revision: 3, action: 'SUBMIT' });
    const operations: [string, () => Promise<unknown>][] = [
      ['dbo.ReadOwnSkillClaims', () => store.read(actor, 1)],
      ['dbo.ReadOwnGrowthClaims', () => store.journey(actor)],
      ['dbo.ReadOwnSkillSummary', () => store.summary(actor)],
      ['dbo.ReadClaimSkills', () => store.options(actor, 'SQL', 1)],
      [
        'dbo.ReadDirectReportCapability',
        () => store.team(actor, { page: 1, search: '', person: undefined }),
      ],
      ['dbo.ReadSkillReviewWorkbench', () => store.reviews(actor, 1)],
      ['dbo.ReadSkillReviewWorkbench', () => store.reviewDetail(actor, id, 1)],
      ['dbo.SaveOwnSkillClaim', () => store.save(actor, draft)],
      ['dbo.TransitionSkillClaim', () => store.transition(actor, transition)],
    ];
    for (const [number, status] of [
      [51003, 403],
      [51004, 404],
      [51009, 409],
      [51010, 409],
      [51011, 409],
      [2601, 409],
      [2627, 409],
      [51000, 400],
      [547, 400],
    ])
      for (const [proc, run] of operations) {
        f.reject(proc, { number });
        await assert.rejects(run(), { status });
      }
    const error = new Error('connection lost');
    for (const [proc, run] of operations) {
      f.reject(proc, error);
      await assert.rejects(run(), e => e === error);
    }
  } finally {
    await f.finish();
  }
});
