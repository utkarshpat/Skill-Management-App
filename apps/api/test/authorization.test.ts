import { test } from 'node:test';
import assert from 'node:assert/strict';
import { authorize, resolveNPlusOne, type Actor, type Resource, type Grant, type ReportingRelationship } from '../src/modules/access/domain/authorization.js';

const at = new Date('2026-10-02T06:00:00Z');
const actor: Actor = { id: 'manager', accountId: 'acme', active: true };
const resource: Resource = { id: 'claim', type: 'SKILL_CLAIM', accountId: 'acme', ownerUserId: 'employee', teamId: 'team-a', assignedReviewerId: 'manager' };
const grant: Grant = { accountId: 'acme', userId: 'manager', permission: 'skill.verify', source: 'ROLE', effect: 'ALLOW', scope: {kind: 'TEAM', id: 'team-a'}, validFrom: '2026-10-01T00:00:00Z' };

test('valid permission permits an assigned reviewer inside scope', () => {
  assert.equal(authorize(actor, 'skill.verify', resource, [grant], at).allowed, true);
  assert.equal(authorize(actor, 'reports.export', resource, [grant], at).reason, 'DEFAULT_DENY');
});
test('explicit deny overrides role and individual allow only inside its scope', () => {
  const deny: Grant = {...grant, source: 'USER', effect: 'DENY'};
  assert.equal(authorize(actor, 'skill.verify', resource, [grant, {...grant, source: 'USER'}, deny], at).reason, 'EXPLICIT_DENY');
  assert.equal(authorize(actor, 'skill.verify', resource, [grant, {...deny, scope: {kind: 'TEAM', id: 'team-b'}}], at).allowed, true);
});
test('cross-account, cross-team, inactive and unrelated user grants cannot authorize', () => {
  assert.equal(authorize(actor, 'skill.verify', {...resource, accountId: 'other'}, [grant], at).reason, 'ACCOUNT_MISMATCH');
  assert.equal(authorize(actor, 'skill.verify', {...resource, teamId: 'team-b'}, [grant], at).reason, 'DEFAULT_DENY');
  assert.equal(authorize({...actor, active: false}, 'skill.verify', resource, [grant], at).reason, 'INACTIVE_ACTOR');
  for (const invalid of [{...grant, accountId: 'other'}, {...grant, userId: 'another-manager'}]) {
    assert.equal(authorize(actor, 'skill.verify', resource, [invalid], at).allowed, false);
  }
});
test('expired, future, malformed and revoked grants fail closed', () => {
  for (const invalid of [
    {...grant, validUntil: at.toISOString()},
    {...grant, validFrom: '2026-10-03T00:00:00Z'},
    {...grant, validFrom: 'invalid'},
    {...grant, validUntil: 'invalid'},
    {...grant, revokedAt: '2026-10-01T03:00:00Z'},
  ]) assert.equal(authorize(actor, 'skill.verify', resource, [invalid], at).allowed, false);
  assert.equal(authorize(actor, 'skill.verify', resource, [grant], new Date(NaN)).reason, 'INVALID_TIME');
});
test('self approval and unassigned reviewers stay blocked even with organization access', () => {
  const broad: Grant = {...grant, scope: {kind: 'ORGANIZATION'}};
  assert.equal(authorize(actor, 'skill.verify', {...resource, ownerUserId: actor.id}, [broad], at).reason, 'SELF_APPROVAL');
  assert.equal(authorize(actor, 'skill.verify', {...resource, assignedReviewerId: 'new-manager'}, [broad], at).reason, 'NOT_ASSIGNED_REVIEWER');
});
test('own, resource-specific and capability scopes do not expose unrelated evidence', () => {
  const view: Grant = {...grant, permission: 'evidence.view', scope: {kind: 'OWN'}};
  assert.equal(authorize(actor, 'evidence.view', resource, [view], at).allowed, false);
  assert.equal(authorize(actor, 'evidence.view', {...resource, ownerUserId: actor.id}, [view], at).allowed, true);
  const specific: Grant = {...view, scope: {kind: 'SPECIFIC_RESOURCE', resourceType: 'OTHER', id: resource.id}};
  assert.equal(authorize(actor, 'evidence.view', resource, [specific], at).allowed, false);
  const capability: Grant = {...view, scope: {kind: 'CAPABILITY'}};
  assert.equal(authorize(actor, 'evidence.view', resource, [capability], at).allowed, false);
});
test('N+1 follows current reporting data; gaps, duplicate relationships and self-routing block', () => {
  const old: ReportingRelationship = {accountId: 'acme', employeeId: 'employee', managerId: 'old-manager', validFrom: '2026-01-01T00:00:00Z', validUntil: at.toISOString()};
  const current: ReportingRelationship = {...old, managerId: 'new-manager', validFrom: at.toISOString(), validUntil: undefined};
  assert.equal(resolveNPlusOne('acme', 'employee', [old, current], at), 'new-manager');
  assert.equal(resolveNPlusOne('other', 'employee', [current], at), undefined);
  assert.equal(resolveNPlusOne('acme', 'employee', [current, {...current, managerId: 'third'}], at), undefined);
  assert.equal(resolveNPlusOne('acme', 'employee', [{...current, managerId: 'employee'}], at), undefined);
});
