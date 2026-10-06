import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readApiResponse } from '../src/api-response';
import { requestRead } from '../src/request-model';

test('API response failures retain status and safe server message for authorization recovery', async () => {
  await assert.rejects(
    readApiResponse(
      Response.json({ error: { message: 'Access changed' } }, { status: 403 }),
      'Fallback',
    ),
    (error: unknown) =>
      (error as { status: number; message: string }).status === 403 &&
      (error as Error).message === 'Access changed',
  );
  await assert.rejects(
    readApiResponse(Response.json({}, { status: 401 }), 'Please sign in again.'),
    (error: unknown) =>
      (error as { status: number; message: string }).status === 401 &&
      (error as Error).message === 'Please sign in again.',
  );
  await assert.rejects(
    requestRead(Response.json({}, { status: 403 })),
    (error: unknown) => (error as { status: number }).status === 403,
  );
  assert.deepEqual(await readApiResponse(Response.json({ value: 7 }), 'Fallback'), { value: 7 });
});
