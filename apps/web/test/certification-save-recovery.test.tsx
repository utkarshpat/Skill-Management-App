import test from 'node:test';
import assert from 'node:assert/strict';
import {
  reconcileCertificationSave,
  uncertainCertificationSave,
} from '../src/certifications/certification-save-recovery';
import type { CertificationRecord } from '../src/certifications/types';
const fields = {
  certificationName: 'Azure',
  provider: 'Microsoft',
  category: 'Cloud',
  certificationDate: '2026-01-01',
  expiryDate: '2027-01-01',
  credentialId: '',
  credentialUrl: '',
  notes: '',
};
const record: CertificationRecord = {
  ...fields,
  id: 'own',
  revision: 2,
  personId: 'person',
  name: 'Person',
  employeeCode: 'EMP',
  status: 'DRAFT',
  feedback: '',
  canEdit: true,
  canReview: false,
  canSubmit: true,
};
test('uncertain saves require an exact read; unchanged saved revision permits explicit retry', () => {
  assert.ok(uncertainCertificationSave(Error('Network')));
  for (const status of [409, 500, 503]) assert.ok(uncertainCertificationSave({ status }));
  for (const status of [400, 401, 403, 404])
    assert.equal(uncertainCertificationSave({ status }), false);
  assert.deepEqual(
    reconcileCertificationSave({ ...record, certificationName: 'Before edit' }, 'own', fields, 2),
    { revision: 2, complete: false },
  );
});
test('lost save/upload response recovers only matching normalized facts and never another record', () => {
  assert.deepEqual(
    reconcileCertificationSave(
      { ...record, revision: 4 },
      'own',
      { ...fields, provider: ' Microsoft ' },
      2,
    ),
    { revision: 4, complete: false },
  );
  assert.throws(
    () =>
      reconcileCertificationSave(
        { ...record, revision: 4, notes: 'Changed in another tab' },
        'own',
        fields,
        2,
      ),
    /Saved details changed/,
  );
  assert.throws(
    () => reconcileCertificationSave({ ...record, id: 'foreign' }, 'own', fields, 2),
    /could not be verified/,
  );
  assert.throws(
    () => reconcileCertificationSave({ ...record, revision: 1 }, 'own', fields, 2),
    /could not be verified/,
  );
  assert.throws(
    () => reconcileCertificationSave({ ...record, revision: NaN }, 'own', fields, 2),
    /could not be verified/,
  );
});
test('a confirmed submission is complete, not another submission replay', () => {
  assert.deepEqual(
    reconcileCertificationSave(
      { ...record, revision: 5, status: 'SUBMITTED', canEdit: false },
      'own',
      fields,
      2,
    ),
    { revision: 5, complete: true },
  );
  assert.deepEqual(
    reconcileCertificationSave(
      { ...record, revision: 6, status: 'APPROVED', canEdit: false },
      'own',
      fields,
      2,
    ),
    { revision: 6, complete: true },
  );
});
