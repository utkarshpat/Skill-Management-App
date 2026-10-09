import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import type { LocalAccessState } from '../src/modules/access/index.js';
import {
  canRecommendCertification,
  certificationRecommendationInput,
  certificationRecommendationResponse,
} from '../src/modules/skills/certification-recommendations.js';

const managerId = '00000000-0000-4000-8000-000000000001';
const reportId = '00000000-0000-4000-8000-000000000002';
const certificationId = '00000000-0000-4000-8000-000000000003';
const state = (): LocalAccessState => ({
  revision: 1,
  audit: [],
  roles: [
    {
      id: 'member',
      name: 'Renamed template',
      permissions: [
        { permission: 'profile.view', scope: 'OWN', effect: 'ALLOW' },
        { permission: 'skill.view', scope: 'ORGANIZATION', effect: 'ALLOW' },
        { permission: 'learning.view', scope: 'OWN', effect: 'ALLOW' },
        { permission: 'learning.recommend', scope: 'ORGANIZATION', effect: 'ALLOW' },
        { permission: 'learning.manage', scope: 'OWN', effect: 'ALLOW' },
      ],
    },
  ],
  people: [
    {
      id: managerId,
      displayName: 'Manager',
      employeeCode: 'M1',
      active: true,
      roleIds: ['member'],
      overrides: [],
    },
    {
      id: reportId,
      displayName: 'Report',
      employeeCode: 'E1',
      active: true,
      roleIds: ['member'],
      overrides: [],
    },
  ],
  reporting: [{ personId: reportId, managerId }],
});

test('credential recommendations require current manager, active people and both personal read policies', () => {
  const access = state();
  assert.equal(canRecommendCertification(access, access.people[0], reportId), true);
  assert.equal(canRecommendCertification(access, access.people[0], managerId), false);
  access.reporting![0].managerId = reportId;
  assert.equal(canRecommendCertification(access, access.people[0], reportId), false);
  access.reporting![0].managerId = managerId;
  access.people[1].active = false;
  assert.equal(canRecommendCertification(access, access.people[0], reportId), false);
});

test('credential recommendation payloads are bounded and reject forged fields and unsafe links', () => {
  const value = {
    id: certificationId,
    personId: reportId,
    certificationName: 'Cloud Architect',
    provider: 'Example',
    category: 'Cloud',
    reason: 'This supports the team cloud migration.',
    credentialUrl: 'https://example.org/certification',
    targetDate: '2027-01-31',
  };
  assert.equal(certificationRecommendationInput(value).targetDate, '2027-01-31');
  for (const change of [
    { action: 'APPROVED' },
    { personId: 'bad' },
    { credentialUrl: 'javascript:alert(1)' },
    { targetDate: '2026-02-30' },
    { reason: '' },
  ])
    assert.throws(() => certificationRecommendationInput({ ...value, ...change }));
  assert.equal(
    certificationRecommendationResponse({
      id: certificationId,
      revision: 1,
      action: 'DISCUSS',
      message: 'Can we review the timing?',
    }).action,
    'DISCUSS',
  );
  assert.throws(() =>
    certificationRecommendationResponse({
      id: certificationId,
      revision: 1,
      action: 'DISCUSS',
      message: '',
    }),
  );
});

test('certification review workspace SQL stays within assigned queue and current-manager recommendations', async () => {
  const sql = await readFile(
    new URL('../../../database/migrations/058_certification_review_workspace.sql', import.meta.url),
    'utf8',
  );
  assert.match(sql, /CertificationCanReview\(@account_id,@actor_id,c\.id\)=1/);
  assert.match(sql, /CertificationRecommendationCan\(@account_id,@actor_id,p\.person_id\)=1/);
  assert.match(sql, /status='SUBMITTED'/);
  assert.match(sql, /r\.sender_id=@actor_id AND dbo\.CertificationRecommendationCan/);
  assert.match(
    sql,
    /r\.person_id=@actor_id AND dbo\.AccessCan\(@account_id,@actor_id,'learning\.view',1\)=1/,
  );
  assert.match(sql, /CertificationRecommendationEvent/);
});
