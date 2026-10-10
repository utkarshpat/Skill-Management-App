import test from 'node:test';
import assert from 'node:assert/strict';
import {
  certificationResponseFailure,
  currentCertificationResponse,
  canRespondToCertification,
} from '../src/certifications/certification-response';

test('response failures retain the editor for validation, conflicts and uncertain saves, but clear revoked data', () => {
  for (const error of [
    new TypeError('Network failure'),
    Object.assign(Error('Timeout'), { status: 503 }),
    Object.assign(Error('Changed'), { status: 409 }),
  ]) {
    const recovery = certificationResponseFailure(error);
    assert.equal(recovery.clear, false);
    assert.equal(recovery.recheck, true);
    assert.match(recovery.message, /note is still here/);
  }
  const validation = certificationResponseFailure(
    Object.assign(Error('Add a message.'), { status: 400 }),
  );
  assert.deepEqual(validation, { clear: false, recheck: false, message: 'Add a message.' });
  for (const status of [401, 403, 404]) {
    assert.equal(
      certificationResponseFailure(Object.assign(Error('Unavailable'), { status })).clear,
      true,
    );
  }
});

test('reconciliation requires the exact record and uses fresh revision, state and response authority', () => {
  const resolved = {
    id: 'own',
    revision: 3,
    status: 'ACCEPTED',
    canRespond: true,
    response: 'Saved note',
  };
  const current = currentCertificationResponse([resolved], 'own');
  assert.equal(current.revision, 3);
  assert.equal(current.response, 'Saved note');
  assert.equal(canRespondToCertification(current), false);
  for (const status of ['DECLINED', 'UNKNOWN'])
    assert.equal(canRespondToCertification({ canRespond: true, status }), false);
  for (const status of ['PENDING', 'DISCUSSION']) {
    assert.equal(canRespondToCertification({ canRespond: true, status }), true);
    assert.equal(canRespondToCertification({ canRespond: false, status }), false);
  }
  for (const items of [[], [{ id: 'foreign' }], [{ id: 'own' }, { id: 'foreign' }]])
    assert.throws(
      () => currentCertificationResponse(items, 'own'),
      (error: any) => error.status === 404,
    );
});
