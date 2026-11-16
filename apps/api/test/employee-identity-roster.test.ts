import assert from 'node:assert/strict';
import test from 'node:test';
import { identityRoster, resolveEmployeeIdentities } from '../src/employee-identity-roster.js';

const row = { employeeCode: '710904', workEmail: ' Priya.Nair@example.test ' };
const user = {
  id: '4a9678ab-ccbc-4acb-8c41-5ddb0adf0444',
  userPrincipalName: 'Priya.Nair@example.test',
  userType: 'Member',
  employeeId: row.employeeCode,
  accountEnabled: true,
};
test('matches the company UPN exactly and returns only the stable link data', async () => {
  const links = await resolveEmployeeIdentities(
    identityRoster([row]),
    async () => 'fixture',
    async (input, init) => {
      const url = new URL(String(input));
      assert.equal(url.origin, 'https://graph.microsoft.com');
      assert.equal(decodeURIComponent(url.pathname), '/v1.0/users/priya.nair@example.test');
      assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer fixture');
      assert.equal(init?.redirect, 'error');
      return Response.json(user);
    },
  );
  assert.deepEqual(links, [{ employeeCode: row.employeeCode, objectId: user.id }]);
});

test('rejects ambiguous roster input before contacting Graph', () => {
  assert.throws(
    () => identityRoster([row, { ...row, workEmail: 'other@example.test' }]),
    /duplicate/,
  );
  assert.throws(() => identityRoster([row, { ...row, employeeCode: '710905' }]), /duplicate/);
  assert.throws(() => identityRoster([{ ...row, workEmail: 'invalid' }]), /Invalid/);
});

test('rejects missing, disabled, guest and mismatched directory accounts', async () => {
  for (const response of [
    new Response(null, { status: 404 }),
    Response.json({ ...user, userType: 'Guest' }),
    Response.json({ ...user, accountEnabled: false }),
    Response.json({ ...user, employeeId: 'other' }),
    Response.json({ ...user, userPrincipalName: 'different@example.test' }),
  ]) {
    await assert.rejects(
      resolveEmployeeIdentities(
        identityRoster([row]),
        async () => 'fixture',
        async () => response,
      ),
      /Directory (lookup returned HTTP 404|identity could not be confirmed)/,
    );
  }
});
