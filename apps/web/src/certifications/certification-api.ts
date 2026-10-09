import { authenticatedFetch } from '../auth';
import { readApiResponse } from '../api-response';
import type { CertificationChange, CertificationPage, CertificationRecord } from './types';

function validId(value: unknown) {
  return (
    typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
  );
}
function validDate(value: unknown) {
  return (
    typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 10) === value
  );
}
function validTimestamp(value: unknown) {
  return (
    typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(value) &&
    Number.isFinite(Date.parse(value))
  );
}
export function parseCertificationPage(value: unknown): CertificationPage {
  if (!value || typeof value !== 'object') throw Error('The certification response is incomplete.');
  const v = value as Record<string, unknown>;
  for (const key of ['total', 'activeCount', 'expiringSoonCount', 'revision', 'page', 'pageSize'])
    if (
      !Number.isSafeInteger(v[key]) ||
      Number(v[key]) < (['revision', 'page', 'pageSize'].includes(key) ? 1 : 0)
    )
      throw Error('The certification response is incomplete.');
  if (
    !Array.isArray(v.items) ||
    v.items.length > Number(v.pageSize) ||
    v.items.length > Number(v.total)
  )
    throw Error('The certification response is incomplete.');
  for (const row of v.items) {
    if (!row || typeof row !== 'object') throw Error('A certification record is incomplete.');
    for (const key of [
      'id',
      'personId',
      'name',
      'employeeCode',
      'du',
      'certificationName',
      'provider',
      'category',
      'certificationDate',
      'credentialId',
      'credentialUrl',
      'feedbackNote',
      'reviewReason',
    ])
      if (typeof row[key] !== 'string') throw Error('A certification record is incomplete.');
    for (const key of ['canEdit', 'canReview', 'routingMismatch', 'verified'])
      if (typeof row[key] !== 'boolean') throw Error('Certification access could not be resolved.');
    if (
      !Number.isSafeInteger(row.revision) ||
      row.revision < 1 ||
      !validId(row.id) ||
      !validId(row.personId) ||
      !(row.reviewerId === null || validId(row.reviewerId)) ||
      !(row.reviewedBy === null || typeof row.reviewedBy === 'string') ||
      !(row.reviewedAt === null || validTimestamp(row.reviewedAt)) ||
      !(row.submittedAt === null || validTimestamp(row.submittedAt)) ||
      !validDate(row.certificationDate) ||
      !['DRAFT', 'SUBMITTED', 'APPROVED', 'CHANGES_REQUESTED', 'REJECTED'].includes(row.status) ||
      !['Y', 'N'].includes(row.active) ||
      !['Yes', 'No'].includes(row.doesNotExpire) ||
      !(row.expiryDate === null || validDate(row.expiryDate)) ||
      (row.doesNotExpire === 'Yes') !== (row.expiryDate === null) ||
      row.verified !== (row.status === 'APPROVED') ||
      (row.active === 'Y' && !row.verified) ||
      !Array.isArray(row.history) ||
      row.history.length > 20 ||
      row.history.some(
        (event: Record<string, unknown>) =>
          !event ||
          !Number.isSafeInteger(event.revision) ||
          Number(event.revision) < 1 ||
          Number(event.revision) > row.revision ||
          typeof event.action !== 'string' ||
          !['SUBMIT', 'REROUTE', 'APPROVED', 'CHANGES_REQUESTED', 'REJECTED'].includes(
            event.action,
          ) ||
          !validTimestamp(event.at) ||
          typeof event.actorName !== 'string' ||
          (event.feedback !== undefined && typeof event.feedback !== 'string'),
      )
    )
      throw Error('A certification record is incomplete.');
  }
  if (
    Number(v.activeCount) > Number(v.total) ||
    Number(v.expiringSoonCount) > Number(v.activeCount)
  )
    throw Error('The certification totals are inconsistent.');
  return value as CertificationPage;
}
export async function fetchCertifications(
  query: URLSearchParams,
  signal?: AbortSignal,
  exporting = false,
): Promise<CertificationPage> {
  const value = await readApiResponse<unknown>(
    await authenticatedFetch('/api/certifications' + (exporting ? '/export' : '') + '?' + query, {
      signal,
    }),
    'Certifications could not be loaded.',
  );
  const page = parseCertificationPage(value);
  if (exporting && page.items.length !== page.total)
    throw Error('The report is incomplete. Narrow the filters and retry.');
  return page;
}
export async function saveCertification(input: CertificationChange): Promise<void> {
  const value = await readApiResponse<{ saved?: boolean; id?: string }>(
    await authenticatedFetch('/api/certifications', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    }),
    'The certification could not be saved. Refresh to check its state before retrying.',
  );
  if (!value || value.saved !== true || value.id !== input.id)
    throw Error('Save confirmation is incomplete. Refresh to check whether it was saved.');
}
export function editableFields(record: CertificationRecord) {
  return {
    certificationName: record.certificationName,
    provider: record.provider,
    category: record.category,
    certificationDate: record.certificationDate,
    expiryDate: record.expiryDate,
    credentialId: record.credentialId,
    credentialUrl: record.credentialUrl,
  };
}
