import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canRecoverDeployment } from '../src/deployment-recovery';

test('deployment recovery preserves open forms and avoids offline or repeated reload loops', () => {
  assert.equal(canRecoverDeployment(true, false, NaN, 1_000_000), true);
  assert.equal(canRecoverDeployment(true, true, NaN, 1_000_000), false);
  assert.equal(canRecoverDeployment(false, false, NaN, 1_000_000), false);
  assert.equal(canRecoverDeployment(true, false, 990_000, 1_000_000), false);
  assert.equal(canRecoverDeployment(true, false, 1_100_000, 1_000_000), false);
  assert.equal(canRecoverDeployment(true, false, 700_000, 1_000_000), true);
});
