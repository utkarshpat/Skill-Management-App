import type { CertificationFields, CertificationRecord } from './types';
import { certificationFields } from './certification-model';

export function uncertainCertificationSave(error: unknown) {
  const status = (error as { status?: number } | null)?.status;
  return status === undefined || status === 409 || status >= 500;
}

export function reconcileCertificationSave(
  record: CertificationRecord,
  id: string,
  expected: CertificationFields,
  minimumRevision: number,
) {
  if (
    record.id !== id ||
    !Number.isSafeInteger(record.revision) ||
    record.revision < minimumRevision
  )
    throw Error('Saved credential could not be verified. Your entries are still here.');
  if (record.revision === minimumRevision && record.canEdit)
    return { revision: record.revision, complete: false };
  const saved = certificationFields(record);
  const same = (Object.keys(expected) as (keyof CertificationFields)[]).every(
    key =>
      saved[key] === (typeof expected[key] === 'string' ? expected[key].trim() : expected[key]),
  );
  if (!same)
    throw Error(
      'Saved details changed. Review the saved credential before replacing anything. Your entries are still here.',
    );
  return { revision: record.revision, complete: ['SUBMITTED', 'APPROVED'].includes(record.status) };
}
