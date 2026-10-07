import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DatabaseAvailability,
  DatabaseQuotaUnavailable,
} from '../src/shared/database-availability.js';
test('quota pause suppresses repeat connection attempts and permits recovery after cooldown', async () => {
  let time = 0,
    calls = 0;
  const availability = new DatabaseAvailability(() => time);
  await assert.rejects(
    availability.run(async () => {
      calls++;
      throw Error(
        'This database has reached the monthly free amount allowance and is paused for the remainder of the month.',
      );
    }),
    DatabaseQuotaUnavailable,
  );
  await assert.rejects(
    availability.run(async () => {
      calls++;
      return 1;
    }),
    DatabaseQuotaUnavailable,
  );
  assert.equal(calls, 1);
  time = 60_000;
  assert.equal(
    await availability.run(async () => {
      calls++;
      return 1;
    }),
    1,
  );
  assert.equal(calls, 2);
});
test('ordinary SQL/auth errors retain their identity and do not trip quota cooldown', async () => {
  const availability = new DatabaseAvailability();
  const failure = Error('Permission denied');
  await assert.rejects(
    availability.run(async () => {
      throw failure;
    }),
    error => error === failure,
  );
  assert.equal(await availability.run(async () => 42), 42);
});
